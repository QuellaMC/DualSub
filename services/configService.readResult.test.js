import { jest } from '@jest/globals';
import {
    configService,
    ConfigServiceReadError,
    requireConfigServiceRead,
} from './configService.js';
import { configSchema, getDefaultValue } from '../config/configSchema.js';

function installSuccessfulStorageReads({ sync = {}, local = {} } = {}) {
    chrome.runtime.lastError = null;
    chrome.storage.sync.get.mockImplementation((keys, callback) => {
        callback(
            Object.fromEntries(
                keys
                    .filter((key) => Object.hasOwn(sync, key))
                    .map((key) => [key, sync[key]])
            )
        );
    });
    chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback(
            Object.fromEntries(
                keys
                    .filter((key) => Object.hasOwn(local, key))
                    .map((key) => [key, local[key]])
            )
        );
    });
}

function failStorageRead(area, message = `${area} unavailable`) {
    chrome.storage[area].get.mockImplementation((_keys, callback) => {
        chrome.runtime.lastError = { message };
        callback(null);
        chrome.runtime.lastError = null;
    });
}

function createStoredBooleanReadResult(value = true) {
    return {
        ok: true,
        values: { aiContextEnabled: value },
        sources: {
            aiContextEnabled: {
                scope: 'sync',
                source: 'stored',
            },
        },
        areas: {
            sync: { status: 'ok' },
            local: { status: 'not-requested' },
        },
        degraded: false,
        failedAreas: [],
    };
}

function createFailedBooleanReadResult(rawCause) {
    const areaResult = { status: 'error' };
    Object.defineProperty(areaResult, 'error', {
        value: rawCause,
        enumerable: false,
    });
    return {
        ok: false,
        values: {},
        sources: {},
        areas: {
            sync: areaResult,
            local: { status: 'not-requested' },
        },
        degraded: true,
        failedAreas: ['sync'],
    };
}

function createRevokedProxy(target) {
    const { proxy, revoke } = Proxy.revocable(target, {});
    revoke();
    return proxy;
}

function createTraversalTrackingProxy(target, { onDescriptor } = {}) {
    const traversal = {
        nonThenGets: [],
        descriptors: [],
        ownKeys: 0,
        prototypes: 0,
    };
    const proxy = new Proxy(target, {
        get(current, key, receiver) {
            // Promise/await assimilation may probe `then`; it is not parser
            // traversal and is intentionally excluded from this assertion.
            if (key !== 'then') traversal.nonThenGets.push(key);
            return Reflect.get(current, key, receiver);
        },
        getOwnPropertyDescriptor(current, key) {
            traversal.descriptors.push(key);
            onDescriptor?.(current, key);
            return Reflect.getOwnPropertyDescriptor(current, key);
        },
        ownKeys(current) {
            traversal.ownKeys += 1;
            return Reflect.ownKeys(current);
        },
        getPrototypeOf(current) {
            traversal.prototypes += 1;
            return Reflect.getPrototypeOf(current);
        },
    });
    return { proxy, traversal };
}

function expectNoProxyTraversal(traversal) {
    expect(traversal).toEqual({
        nonThenGets: [],
        descriptors: [],
        ownKeys: 0,
        prototypes: 0,
    });
}

async function captureRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('Expected promise to reject');
}

function expectOnlyPrivacySafeLogFields(...logMocks) {
    const allowedFields = new Set([
        'operation',
        'area',
        'keyCount',
        'resultCount',
        'duration',
        'category',
    ]);
    const messages = logMocks.flatMap((logMock) =>
        logMock.mock.calls.map(([message]) => message)
    );
    expect(messages.length).toBeGreaterThan(0);

    for (const message of messages) {
        const marker = ' | Data: ';
        const markerIndex = message.indexOf(marker);
        expect(markerIndex).toBeGreaterThanOrEqual(0);
        const data = JSON.parse(message.slice(markerIndex + marker.length));
        expect(Object.keys(data).every((key) => allowedFields.has(key))).toBe(
            true
        );
    }
}

describe('ConfigService read results', () => {
    beforeEach(() => {
        installSuccessfulStorageReads();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reports a stored value and its storage provenance', async () => {
        installSuccessfulStorageReads({ sync: { uiLanguage: 'es' } });

        await expect(configService.readResult('uiLanguage')).resolves.toEqual({
            ok: true,
            values: { uiLanguage: 'es' },
            sources: {
                uiLanguage: { scope: 'sync', source: 'stored' },
            },
            displayFallbacks: {},
            areas: {
                sync: { status: 'ok' },
                local: { status: 'not-requested' },
            },
            degraded: false,
            failedAreas: [],
            unknownKeys: [],
            excludedSensitiveKeys: [],
        });
    });

    it('reports a schema default when a readable area is missing the key', async () => {
        await expect(
            configService.readResult('subtitlesEnabled')
        ).resolves.toMatchObject({
            values: { subtitlesEnabled: true },
            sources: {
                subtitlesEnabled: {
                    scope: 'sync',
                    source: 'schema-default-missing',
                },
            },
            areas: {
                sync: { status: 'ok' },
                local: { status: 'not-requested' },
            },
            degraded: false,
        });
    });

    it('reports a schema default when a stored value is invalid', async () => {
        installSuccessfulStorageReads({ sync: { loggingLevel: 99 } });

        await expect(
            configService.readResult('loggingLevel')
        ).resolves.toMatchObject({
            values: { loggingLevel: 3 },
            sources: {
                loggingLevel: {
                    scope: 'sync',
                    source: 'schema-default-invalid',
                },
            },
            degraded: false,
        });
    });

    it.each([
        {
            condition: 'missing',
            stored: {},
        },
        {
            condition: 'invalid',
            stored: {
                aiContextTypes: { not: 'an array' },
                subtitleBlacklist: [],
            },
        },
    ])(
        'returns caller-owned nested defaults when stored values are $condition',
        async ({ stored }) => {
            const expectedTypes = [...getDefaultValue('aiContextTypes')];
            const expectedBlacklist = Object.fromEntries(
                Object.entries(getDefaultValue('subtitleBlacklist')).map(
                    ([platform, patterns]) => [platform, [...patterns]]
                )
            );
            installSuccessfulStorageReads({ sync: stored });

            const first = await configService.readMultipleResult([
                'aiContextTypes',
                'subtitleBlacklist',
            ]);

            expect(first.values.aiContextTypes).not.toBe(
                getDefaultValue('aiContextTypes')
            );
            expect(first.values.subtitleBlacklist).not.toBe(
                getDefaultValue('subtitleBlacklist')
            );
            expect(first.values.subtitleBlacklist.netflix).not.toBe(
                getDefaultValue('subtitleBlacklist').netflix
            );

            first.values.aiContextTypes.push('poison-array');
            first.values.subtitleBlacklist.netflix.push('poison-nested');

            const second = await configService.readMultipleResult([
                'aiContextTypes',
                'subtitleBlacklist',
            ]);

            expect(getDefaultValue('aiContextTypes')).toEqual(expectedTypes);
            expect(getDefaultValue('subtitleBlacklist')).toEqual(
                expectedBlacklist
            );
            expect(second.values.aiContextTypes).toEqual(expectedTypes);
            expect(second.values.subtitleBlacklist).toEqual(expectedBlacklist);
            expect(second.values.aiContextTypes).not.toBe(
                first.values.aiContextTypes
            );
            expect(second.values.subtitleBlacklist).not.toBe(
                first.values.subtitleBlacklist
            );
            expect(second.values.subtitleBlacklist.netflix).not.toBe(
                first.values.subtitleBlacklist.netflix
            );
        }
    );

    it('reads requested sync and local keys through one result bundle', async () => {
        installSuccessfulStorageReads({
            sync: { uiLanguage: 'ja' },
            local: { debugMode: true },
        });

        await expect(
            configService.readMultipleResult(['uiLanguage', 'debugMode'])
        ).resolves.toMatchObject({
            values: { uiLanguage: 'ja', debugMode: true },
            sources: {
                uiLanguage: { scope: 'sync', source: 'stored' },
                debugMode: { scope: 'local', source: 'stored' },
            },
            areas: {
                sync: { status: 'ok' },
                local: { status: 'ok' },
            },
            degraded: false,
        });
    });

    it('keeps a failed area out of authoritative values while preserving healthy-area values', async () => {
        installSuccessfulStorageReads({ local: { debugMode: true } });
        failStorageRead('sync');

        const result = await configService.readMultipleResult([
            'uiLanguage',
            'debugMode',
        ]);

        expect(result.values).toEqual({ debugMode: true });
        expect(result.values).not.toHaveProperty('uiLanguage');
        expect(result.sources).toEqual({
            debugMode: { scope: 'local', source: 'stored' },
        });
        expect(result.displayFallbacks).toEqual({ uiLanguage: 'en' });
        expect(result.areas.sync).toMatchObject({
            status: 'error',
            error: expect.objectContaining({
                name: 'ConfigServiceStorageError',
            }),
        });
        expect(result.areas.local).toEqual({ status: 'ok' });
        expect(
            Object.getOwnPropertyDescriptor(result.areas.sync, 'error')
        ).toMatchObject({ enumerable: false });
        expect(JSON.stringify(result.areas.sync)).toBe('{"status":"error"}');
        expect(result.ok).toBe(false);
        expect(result.degraded).toBe(true);
        expect(result.failedAreas).toEqual(['sync']);
    });

    it('preserves readable sync values when the requested local area fails', async () => {
        installSuccessfulStorageReads({ sync: { uiLanguage: 'zh-TW' } });
        failStorageRead('local');

        const result = await configService.readMultipleResult([
            'uiLanguage',
            'debugMode',
        ]);

        expect(result.values).toEqual({ uiLanguage: 'zh-TW' });
        expect(result.sources).toEqual({
            uiLanguage: { scope: 'sync', source: 'stored' },
        });
        expect(result.displayFallbacks).toEqual({ debugMode: false });
        expect(result.areas.sync).toEqual({ status: 'ok' });
        expect(result.areas.local).toMatchObject({
            status: 'error',
            error: expect.objectContaining({
                name: 'ConfigServiceStorageError',
            }),
        });
        expect(result.failedAreas).toEqual(['local']);
    });

    it('reports both failed areas without writing repair defaults', async () => {
        failStorageRead('sync', 'sync read failed');
        failStorageRead('local', 'local read failed');

        const result = await configService.readMultipleResult([
            'subtitlesEnabled',
            'debugMode',
        ]);

        expect(result.values).toEqual({});
        expect(result.sources).toEqual({});
        expect(result.displayFallbacks).toEqual({
            subtitlesEnabled: true,
            debugMode: false,
        });
        expect(result.areas.sync.error).toMatchObject({
            name: 'ConfigServiceStorageError',
            originalError: { message: 'sync read failed' },
        });
        expect(result.areas.local.error).toMatchObject({
            name: 'ConfigServiceStorageError',
            originalError: { message: 'local read failed' },
        });
        expect(result.failedAreas).toEqual(['sync', 'local']);
        expect(result.degraded).toBe(true);
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('returns caller-owned nested display fallbacks for an unreadable area', async () => {
        const expectedTypes = [...getDefaultValue('aiContextTypes')];
        const expectedBlacklist = Object.fromEntries(
            Object.entries(getDefaultValue('subtitleBlacklist')).map(
                ([platform, patterns]) => [platform, [...patterns]]
            )
        );
        failStorageRead('sync');

        const first = await configService.readMultipleResult([
            'aiContextTypes',
            'subtitleBlacklist',
        ]);
        first.displayFallbacks.aiContextTypes.push('poison-array');
        first.displayFallbacks.subtitleBlacklist.netflix.push('poison-nested');

        const second = await configService.readMultipleResult([
            'aiContextTypes',
            'subtitleBlacklist',
        ]);

        expect(getDefaultValue('aiContextTypes')).toEqual(expectedTypes);
        expect(getDefaultValue('subtitleBlacklist')).toEqual(expectedBlacklist);
        expect(second.displayFallbacks.aiContextTypes).toEqual(expectedTypes);
        expect(second.displayFallbacks.subtitleBlacklist).toEqual(
            expectedBlacklist
        );
        expect(second.displayFallbacks.aiContextTypes).not.toBe(
            first.displayFallbacks.aiContextTypes
        );
        expect(second.displayFallbacks.subtitleBlacklist).not.toBe(
            first.displayFallbacks.subtitleBlacklist
        );
        expect(second.displayFallbacks.subtitleBlacklist.netflix).not.toBe(
            first.displayFallbacks.subtitleBlacklist.netflix
        );
    });

    it('does not implicitly read a sensitive key from a mixed request', async () => {
        installSuccessfulStorageReads({
            local: { debugMode: true, openaiApiKey: 'must-not-leak' },
        });

        const result = await configService.readMultipleResult([
            'debugMode',
            'openaiApiKey',
        ]);

        expect(result.values).toEqual({ debugMode: true });
        expect(result.excludedSensitiveKeys).toEqual(['openaiApiKey']);
        expect(chrome.storage.local.get).toHaveBeenCalledWith(
            ['debugMode'],
            expect.any(Function)
        );
        expect(JSON.stringify(result)).not.toContain('must-not-leak');
    });

    it('reads a sensitive key with a valid own data opt-in', async () => {
        installSuccessfulStorageReads({
            local: { openaiApiKey: 'explicit-secret' },
        });
        const options = { includeSensitive: true };
        expect(
            Object.getOwnPropertyDescriptor(options, 'includeSensitive')
        ).toMatchObject({ value: true });

        const result = await configService.readResult('openaiApiKey', options);

        expect(result.values).toEqual({ openaiApiKey: 'explicit-secret' });
        expect(result.sources).toEqual({
            openaiApiKey: { scope: 'local', source: 'stored' },
        });
        expect(result.excludedSensitiveKeys).toEqual([]);
    });

    it('logs only counts and fixed categories for a successful sensitive result read', async () => {
        installSuccessfulStorageReads({
            sync: { openaiBaseUrl: 'https://privacy-provider.example/v1' },
            local: { openaiApiKey: 'privacy-secret-value' },
        });
        const previousLevel = configService.logger.currentLevel;
        configService.logger.currentLevel = 4;

        try {
            await configService.readMultipleResult(
                ['openaiApiKey', 'openaiBaseUrl'],
                { includeSensitive: true }
            );

            expect(chrome.storage.local.get).toHaveBeenCalledWith(
                ['openaiApiKey'],
                expect.any(Function)
            );
            expect(chrome.storage.sync.get).toHaveBeenCalledWith(
                ['openaiBaseUrl'],
                expect.any(Function)
            );
            const output = console.debug.mock.calls.flat().join('\n');
            expect(output).toContain('"category":"start"');
            expect(output).toContain('"category":"success"');
            expect(output).toContain('"keyCount":1');
            expect(output).toContain('"resultCount":1');
            expect(output).not.toContain('openaiApiKey');
            expect(output).not.toContain('openaiBaseUrl');
            expect(output).not.toContain('privacy-secret-value');
            expect(output).not.toContain('privacy-provider.example');
            expect(console.error).not.toHaveBeenCalled();
            expectOnlyPrivacySafeLogFields(console.debug);
        } finally {
            configService.logger.currentLevel = previousLevel;
        }
    });

    it('keeps sensitive callback failures out of logs while retaining a non-enumerable cause', async () => {
        const rawCause = 'opaque-callback-cause raw-secret-value';
        failStorageRead('local', rawCause);
        const previousLevel = configService.logger.currentLevel;
        configService.logger.currentLevel = 4;

        try {
            const result = await configService.readResult('openaiApiKey', {
                includeSensitive: true,
            });

            expect(result.ok).toBe(false);
            expect(chrome.storage.local.get).toHaveBeenCalledWith(
                ['openaiApiKey'],
                expect.any(Function)
            );
            expect(
                Object.getOwnPropertyDescriptor(result.areas.local, 'error')
            ).toMatchObject({ enumerable: false });
            expect(result.areas.local.error.originalError.message).toBe(
                rawCause
            );
            const output = [
                ...console.debug.mock.calls.flat(),
                ...console.error.mock.calls.flat(),
            ].join('\n');
            expect(output).toContain('"category":"runtime-error"');
            expect(output).toContain('"keyCount":1');
            expect(output).not.toContain('openaiApiKey');
            expect(output).not.toContain(rawCause);
            expect(output).not.toContain('raw-secret-value');
            expect(JSON.stringify(result)).not.toContain(rawCause);
            expectOnlyPrivacySafeLogFields(console.debug, console.error);
        } finally {
            configService.logger.currentLevel = previousLevel;
        }
    });

    it('normalizes sensitive quota failures without logging their raw cause', async () => {
        const rawCause = 'quota exceeded opaque-quota-cause raw-secret-value';
        failStorageRead('local', rawCause);
        const previousLevel = configService.logger.currentLevel;
        configService.logger.currentLevel = 4;

        try {
            const result = await configService.readResult('openaiApiKey', {
                includeSensitive: true,
            });

            expect(result.ok).toBe(false);
            const output = console.error.mock.calls.flat().join('\n');
            expect(output).toContain('"category":"quota-error"');
            expect(output).not.toContain('openaiApiKey');
            expect(output).not.toContain(rawCause);
            expect(output).not.toContain('raw-secret-value');
            expectOnlyPrivacySafeLogFields(console.debug, console.error);
        } finally {
            configService.logger.currentLevel = previousLevel;
        }
    });

    it('uses privacy-safe logs when sensitive result storage is unavailable', async () => {
        const originalLocalStorage = chrome.storage.local;
        const previousLevel = configService.logger.currentLevel;
        configService.logger.currentLevel = 4;
        chrome.storage.local = undefined;

        try {
            const result = await configService.readResult('openaiApiKey', {
                includeSensitive: true,
            });

            expect(result.ok).toBe(false);
            const output = console.error.mock.calls.flat().join('\n');
            expect(output).toContain('"category":"unavailable"');
            expect(output).toContain('"keyCount":1');
            expect(output).not.toContain('openaiApiKey');
            expect(output).not.toContain('requestedKeys');
            expect(output).not.toContain('errorMessage');
            expect(output).not.toContain('errorStack');
            expectOnlyPrivacySafeLogFields(console.error);
        } finally {
            chrome.storage.local = originalLocalStorage;
            configService.logger.currentLevel = previousLevel;
        }
    });

    it('keeps synchronous sensitive storage failures out of logs', async () => {
        const rawCause = 'opaque-synchronous-cause raw-secret-value';
        chrome.storage.local.get.mockImplementation(() => {
            throw new Error(rawCause);
        });
        const previousLevel = configService.logger.currentLevel;
        configService.logger.currentLevel = 4;

        try {
            const result = await configService.readResult('openaiApiKey', {
                includeSensitive: true,
            });

            expect(result.ok).toBe(false);
            expect(chrome.storage.local.get).toHaveBeenCalledWith(
                ['openaiApiKey'],
                expect.any(Function)
            );
            expect(result.areas.local.error.originalError.message).toBe(
                rawCause
            );
            const output = [
                ...console.debug.mock.calls.flat(),
                ...console.error.mock.calls.flat(),
            ].join('\n');
            expect(output).toContain('"category":"synchronous-error"');
            expect(output).toContain('"keyCount":1');
            expect(output).not.toContain('openaiApiKey');
            expect(output).not.toContain(rawCause);
            expect(output).not.toContain('raw-secret-value');
            expectOnlyPrivacySafeLogFields(console.debug, console.error);
        } finally {
            configService.logger.currentLevel = previousLevel;
        }
    });

    it.each([false, 'true', 1, {}, null])(
        'does not treat non-true opt-in %p as permission to read secrets',
        async (includeSensitive) => {
            installSuccessfulStorageReads({
                local: { openaiApiKey: 'must-not-leak' },
            });

            const result = await configService.readResult('openaiApiKey', {
                includeSensitive,
            });

            expect(result.values).toEqual({});
            expect(result.excludedSensitiveKeys).toEqual(['openaiApiKey']);
            expect(chrome.storage.local.get).not.toHaveBeenCalled();
        }
    );

    it('does not accept inherited sensitive-read permission', async () => {
        installSuccessfulStorageReads({
            local: { openaiApiKey: 'must-not-leak' },
        });
        const inheritedPermission = Object.create({ includeSensitive: true });

        const result = await configService.readResult(
            'openaiApiKey',
            inheritedPermission
        );

        expect(result.values).toEqual({});
        expect(result.excludedSensitiveKeys).toEqual(['openaiApiKey']);
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('does not invoke accessor-based sensitive-read permission', async () => {
        let accessorReads = 0;
        const options = {};
        Object.defineProperty(options, 'includeSensitive', {
            get() {
                accessorReads += 1;
                return true;
            },
        });

        const result = await configService.readResult('openaiApiKey', options);

        expect(accessorReads).toBe(0);
        expect(result.values).toEqual({});
        expect(result.excludedSensitiveKeys).toEqual(['openaiApiKey']);
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('does not invoke a throwing sensitive-read permission getter', async () => {
        let accessorReads = 0;
        const options = {};
        Object.defineProperty(options, 'includeSensitive', {
            get() {
                accessorReads += 1;
                throw new Error('must-not-run');
            },
        });

        await expect(
            configService.readResult('openaiApiKey', options)
        ).resolves.toMatchObject({
            values: {},
            excludedSensitiveKeys: ['openaiApiKey'],
        });
        expect(accessorReads).toBe(0);
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it.each([
        ['enumerable', true],
        ['non-enumerable', false],
    ])(
        'does not inspect an unrelated %s accessor when sensitive access is explicitly enabled',
        async (_label, enumerable) => {
            installSuccessfulStorageReads({
                local: { openaiApiKey: 'explicit-secret' },
            });
            let unrelatedReads = 0;
            const options = { includeSensitive: true };
            Object.defineProperty(options, 'unrelated', {
                enumerable,
                get() {
                    unrelatedReads += 1;
                    throw new Error('unrelated option must not be read');
                },
            });

            const result = await configService.readResult(
                'openaiApiKey',
                options
            );

            expect(unrelatedReads).toBe(0);
            expect(result.values).toEqual({
                openaiApiKey: 'explicit-secret',
            });
            expect(result.excludedSensitiveKeys).toEqual([]);
            expect(chrome.storage.local.get).toHaveBeenCalledWith(
                ['openaiApiKey'],
                expect.any(Function)
            );
        }
    );

    it('does not traverse a large cyclic unrelated option graph when sensitive access is explicitly enabled', async () => {
        installSuccessfulStorageReads({
            local: { openaiApiKey: 'explicit-secret' },
        });
        let nestedReads = 0;
        const unrelatedGraph = Array.from({ length: 2048 }, (_, index) => ({
            index,
        }));
        Object.defineProperty(unrelatedGraph[1024], 'mustNotBeRead', {
            enumerable: true,
            get() {
                nestedReads += 1;
                throw new Error('unrelated graph must not be traversed');
            },
        });
        unrelatedGraph.push(unrelatedGraph);
        const options = {
            includeSensitive: true,
            unrelatedGraph,
        };

        const result = await configService.readResult('openaiApiKey', options);

        expect(nestedReads).toBe(0);
        expect(result.values).toEqual({ openaiApiKey: 'explicit-secret' });
        expect(result.excludedSensitiveKeys).toEqual([]);
        expect(chrome.storage.local.get).toHaveBeenCalledWith(
            ['openaiApiKey'],
            expect.any(Function)
        );
    });

    it('safely denies throwing and revoked sensitive-permission proxies', async () => {
        const throwingProxy = new Proxy(
            { includeSensitive: true },
            {
                getOwnPropertyDescriptor() {
                    throw new Error('descriptor trap must be normalized');
                },
            }
        );
        const { proxy: revokedProxy, revoke } = Proxy.revocable(
            { includeSensitive: true },
            {}
        );
        revoke();

        for (const options of [throwingProxy, revokedProxy]) {
            await expect(
                configService.readResult('openaiApiKey', options)
            ).resolves.toMatchObject({
                values: {},
                excludedSensitiveKeys: ['openaiApiKey'],
            });
        }
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('does not accept sensitive-read permission from Object.prototype', async () => {
        installSuccessfulStorageReads({
            local: { openaiApiKey: 'must-not-leak' },
        });
        Object.defineProperty(Object.prototype, 'includeSensitive', {
            value: true,
            configurable: true,
        });

        try {
            const result = await configService.readResult('openaiApiKey');

            expect(result.values).toEqual({});
            expect(result.excludedSensitiveKeys).toEqual(['openaiApiKey']);
            expect(chrome.storage.local.get).not.toHaveBeenCalled();
        } finally {
            delete Object.prototype.includeSensitive;
        }
    });

    it('never places a sensitive default in failed-area display fallbacks', async () => {
        failStorageRead('local');

        const result = await configService.readMultipleResult(
            ['debugMode', 'openaiApiKey'],
            { includeSensitive: true }
        );

        expect(result.values).toEqual({});
        expect(result.displayFallbacks).toEqual({ debugMode: false });
        expect(result.displayFallbacks).not.toHaveProperty('openaiApiKey');
    });

    it('reports unknown keys once in request order without treating prototype names as settings', async () => {
        installSuccessfulStorageReads({ sync: { uiLanguage: 'ko' } });

        const result = await configService.readMultipleResult([
            'notASetting',
            '__proto__',
            'uiLanguage',
            'notASetting',
            'constructor',
            'toString',
        ]);

        expect(result.values).toEqual({ uiLanguage: 'ko' });
        expect(result.unknownKeys).toEqual([
            'notASetting',
            '__proto__',
            'constructor',
            'toString',
        ]);
        expect(Object.getPrototypeOf(result.values)).toBeNull();
        expect(Object.getPrototypeOf(result.sources)).toBeNull();
        expect(Object.getPrototypeOf(result.displayFallbacks)).toBeNull();
        expect(result.values.__proto__).toBeUndefined();
        expect(result.sources.constructor).toBeUndefined();
        expect(result.displayFallbacks.toString).toBeUndefined();
    });

    it.each([
        ['a non-array collection', 'uiLanguage'],
        ['a non-string key', ['uiLanguage', 42]],
    ])(
        'rejects %s before making a partial storage read',
        async (_label, keys) => {
            await expect(
                configService.readMultipleResult(keys)
            ).rejects.toThrow(
                'ConfigService result reads require an array of string keys'
            );
            expect(chrome.storage.sync.get).not.toHaveBeenCalled();
            expect(chrome.storage.local.get).not.toHaveBeenCalled();
        }
    );

    it('rejects a non-string single key before reading storage', async () => {
        await expect(configService.readResult({})).rejects.toThrow(
            'ConfigService result reads require an array of string keys'
        );
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('returns an empty, non-degraded bundle without reading storage', async () => {
        await expect(configService.readMultipleResult([])).resolves.toEqual({
            ok: true,
            values: {},
            sources: {},
            displayFallbacks: {},
            areas: {
                sync: { status: 'not-requested' },
                local: { status: 'not-requested' },
            },
            degraded: false,
            failedAreas: [],
            unknownKeys: [],
            excludedSensitiveKeys: [],
        });
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('reads all non-sensitive settings by default', async () => {
        installSuccessfulStorageReads({
            sync: { subtitlesEnabled: false },
            local: { debugMode: true, openaiApiKey: 'must-not-leak' },
        });

        const result = await configService.readAllResult();

        expect(result.values).toMatchObject({
            subtitlesEnabled: false,
            debugMode: true,
        });
        expect(result.values).not.toHaveProperty('openaiApiKey');
        expect(result.excludedSensitiveKeys).toContain('openaiApiKey');
        for (const [keys] of chrome.storage.local.get.mock.calls) {
            expect(keys).not.toContain('openaiApiKey');
        }
        expect(JSON.stringify(result)).not.toContain('must-not-leak');
    });

    it('resolves the dynamic UI-language default at read time', async () => {
        const languageSpy = jest
            .spyOn(navigator, 'language', 'get')
            .mockReturnValue('ja-JP');

        try {
            const result = await configService.readResult('uiLanguage');

            expect(result.values.uiLanguage).toBe('ja');
            expect(result.sources.uiLanguage.source).toBe(
                'schema-default-missing'
            );
        } finally {
            languageSpy.mockRestore();
        }
    });

    it('returns an authoritative result unchanged from the strict adapter', async () => {
        installSuccessfulStorageReads({ sync: { uiLanguage: 'es' } });
        const result = await configService.readResult('uiLanguage');

        expect(Object.getOwnPropertyDescriptor(result, 'ok')).toMatchObject({
            value: true,
            enumerable: true,
        });
        expect(requireConfigServiceRead(result)).toBe(result);
    });

    it('returns a stored boolean through one exact strict read', async () => {
        installSuccessfulStorageReads({
            sync: { aiContextEnabled: true },
        });
        const strictRead = jest.spyOn(configService, 'readResultStrict');

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).resolves.toBe(true);

        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
    });

    it('preserves an explicitly stored false boolean', async () => {
        installSuccessfulStorageReads({
            sync: { aiContextEnabled: false },
        });

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).resolves.toBe(false);
    });

    it('uses the schema scope for a stored local boolean', async () => {
        installSuccessfulStorageReads({
            local: { debugMode: true },
        });
        const strictRead = jest.spyOn(configService, 'readResultStrict');

        await expect(
            configService.readStoredBooleanStrict('debugMode')
        ).resolves.toBe(true);
        expect(strictRead.mock.calls).toEqual([['debugMode']]);
    });

    it('rejects a schema-default boolean when storage is missing', async () => {
        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');
    });

    it('rejects a schema-default boolean when storage is invalid', async () => {
        installSuccessfulStorageReads({
            sync: { aiContextEnabled: 'not-a-boolean' },
        });

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');
    });

    it('preserves the exact genuine secret-safe strict-read error', async () => {
        failStorageRead(
            'sync',
            'sync failed with PRIVATE_STORED_BOOLEAN_SECRET'
        );
        const actualStrictRead =
            configService.readResultStrict.bind(configService);
        let producedError;
        const strictRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockImplementation(async (...args) => {
                try {
                    return await actualStrictRead(...args);
                } catch (error) {
                    producedError = error;
                    throw error;
                }
            });

        const error = await captureRejection(
            configService.readStoredBooleanStrict('aiContextEnabled')
        );

        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
        expect(error).toBe(producedError);
        expect(error).toBeInstanceOf(ConfigServiceReadError);
        expect(error.message).not.toContain('PRIVATE_STORED_BOOLEAN_SECRET');
        expect(JSON.stringify(error)).not.toContain(
            'PRIVATE_STORED_BOOLEAN_SECRET'
        );
    });

    it.each(['notASetting', 'uiLanguage'])(
        'rejects unknown or non-boolean stored key %s with a fixed error',
        async (key) => {
            const strictRead = jest.spyOn(configService, 'readResultStrict');

            await expect(
                configService.readStoredBooleanStrict(key)
            ).rejects.toThrow('Stored boolean configuration is unavailable');
            expect(strictRead).not.toHaveBeenCalled();
        }
    );

    it.each([
        {
            name: 'missing values record',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                delete result.values;
                return { result, getters: [] };
            },
        },
        {
            name: 'inherited boolean value',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.values = Object.create({ aiContextEnabled: true });
                return { result, getters: [] };
            },
        },
        {
            name: 'values accessor',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const getter = jest.fn(() => ({
                    aiContextEnabled: true,
                    secret: 'PRIVATE_VALUES_ACCESSOR',
                }));
                Object.defineProperty(result, 'values', {
                    get: getter,
                    enumerable: true,
                    configurable: true,
                });
                return { result, getters: [getter] };
            },
        },
        {
            name: 'provenance accessor',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const getter = jest.fn(() => ({
                    scope: 'sync',
                    source: 'stored',
                }));
                Object.defineProperty(result.sources, 'aiContextEnabled', {
                    get: getter,
                    enumerable: true,
                    configurable: true,
                });
                return { result, getters: [getter] };
            },
        },
        {
            name: 'sources accessor',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const getter = jest.fn(() => ({
                    aiContextEnabled: {
                        scope: 'sync',
                        source: 'stored',
                    },
                }));
                Object.defineProperty(result, 'sources', {
                    get: getter,
                    enumerable: true,
                    configurable: true,
                });
                return { result, getters: [getter] };
            },
        },
        {
            name: 'areas accessor',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const getter = jest.fn(() => ({
                    sync: { status: 'ok' },
                }));
                Object.defineProperty(result, 'areas', {
                    get: getter,
                    enumerable: true,
                    configurable: true,
                });
                return { result, getters: [getter] };
            },
        },
        {
            name: 'inherited provenance fields',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.sources.aiContextEnabled = Object.create({
                    scope: 'sync',
                    source: 'stored',
                });
                return { result, getters: [] };
            },
        },
        {
            name: 'wrong provenance scope',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.sources.aiContextEnabled.scope = 'local';
                return { result, getters: [] };
            },
        },
        {
            name: 'wrong provenance source',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.sources.aiContextEnabled.source =
                    'schema-default-missing';
                return { result, getters: [] };
            },
        },
        {
            name: 'malformed area authority',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.areas.sync.status = 'error';
                return { result, getters: [] };
            },
        },
        {
            name: 'degraded result',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.ok = false;
                result.degraded = true;
                result.failedAreas = ['sync'];
                return { result, getters: [] };
            },
        },
        {
            name: 'sparse failed areas',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.failedAreas = new Array(1);
                return { result, getters: [] };
            },
        },
        {
            name: 'extra-key empty failed areas',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.failedAreas.extra = 'forged';
                return { result, getters: [] };
            },
        },
        {
            name: 'revoked failed-area proxy',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.failedAreas = createRevokedProxy([]);
                return { result, getters: [] };
            },
        },
        {
            name: 'revoked values record',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.values = createRevokedProxy({});
                return { result, getters: [] };
            },
        },
        {
            name: 'revoked sources record',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.sources = createRevokedProxy({});
                return { result, getters: [] };
            },
        },
        {
            name: 'revoked area record',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                result.areas.sync = createRevokedProxy({});
                return { result, getters: [] };
            },
        },
        {
            name: 'non-boolean own value',
            makeResult: () => ({
                result: createStoredBooleanReadResult({
                    secret: 'PRIVATE_NON_BOOLEAN_VALUE',
                }),
                getters: [],
            }),
        },
    ])('rejects $name without reading accessors', async ({ makeResult }) => {
        const { result, getters } = makeResult();
        const strictRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockResolvedValue(result);

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');

        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
        for (const getter of getters) {
            expect(getter).not.toHaveBeenCalled();
        }
    });

    it('rejects an authoritative-looking manual result forgery', async () => {
        const strictRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockResolvedValue(createStoredBooleanReadResult());

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');
        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
    });

    it('rejects a clone of a producer result identity', async () => {
        installSuccessfulStorageReads({
            sync: { aiContextEnabled: true },
        });
        const actualStrictRead =
            configService.readResultStrict.bind(configService);
        const strictRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockImplementation(async (...args) =>
                structuredClone(await actualStrictRead(...args))
            );

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');
        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
    });

    it('rejects a transparent outer proxy identity without traversing it', async () => {
        const { proxy, traversal } = createTraversalTrackingProxy(
            createStoredBooleanReadResult()
        );
        const strictRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockReturnValue(proxy);

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');
        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
        expectNoProxyTraversal(traversal);
    });

    it('does not run descriptor side effects on a forged outer proxy', async () => {
        const target = createStoredBooleanReadResult();
        const { proxy, traversal } = createTraversalTrackingProxy(target, {
            onDescriptor: () => {
                target.values.aiContextEnabled = false;
                target.sources.aiContextEnabled.source =
                    'schema-default-missing';
            },
        });
        const strictRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockReturnValue(proxy);

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');
        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
        expectNoProxyTraversal(traversal);
    });

    it.each([
        {
            name: 'values',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const tracked = createTraversalTrackingProxy(result.values);
                result.values = tracked.proxy;
                return { result, traversal: tracked.traversal };
            },
        },
        {
            name: 'sources',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const tracked = createTraversalTrackingProxy(result.sources);
                result.sources = tracked.proxy;
                return { result, traversal: tracked.traversal };
            },
        },
        {
            name: 'provenance',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const tracked = createTraversalTrackingProxy(
                    result.sources.aiContextEnabled
                );
                result.sources.aiContextEnabled = tracked.proxy;
                return { result, traversal: tracked.traversal };
            },
        },
        {
            name: 'areas',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const tracked = createTraversalTrackingProxy(result.areas);
                result.areas = tracked.proxy;
                return { result, traversal: tracked.traversal };
            },
        },
        {
            name: 'requested area',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const tracked = createTraversalTrackingProxy(result.areas.sync);
                result.areas.sync = tracked.proxy;
                return { result, traversal: tracked.traversal };
            },
        },
        {
            name: 'failed areas',
            makeResult: () => {
                const result = createStoredBooleanReadResult();
                const tracked = createTraversalTrackingProxy(
                    result.failedAreas
                );
                result.failedAreas = tracked.proxy;
                return { result, traversal: tracked.traversal };
            },
        },
    ])(
        'rejects a transparent nested $name proxy without traversing it',
        async ({ makeResult }) => {
            const { result, traversal } = makeResult();
            const strictRead = jest
                .spyOn(configService, 'readResultStrict')
                .mockResolvedValue(result);

            await expect(
                configService.readStoredBooleanStrict('aiContextEnabled')
            ).rejects.toThrow('Stored boolean configuration is unavailable');
            expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
            expectNoProxyTraversal(traversal);
        }
    );

    it('uses the producer snapshot after the public graph mutates', async () => {
        installSuccessfulStorageReads({
            sync: { aiContextEnabled: true },
        });
        const actualStrictRead =
            configService.readResultStrict.bind(configService);
        const unrelatedGetter = jest.fn(
            () => 'PRIVATE_POST_PRODUCTION_ACCESSOR'
        );
        const strictRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockImplementation(async (...args) => {
                const result = await actualStrictRead(...args);
                result.ok = false;
                result.degraded = true;
                result.failedAreas.push('sync');
                result.values.aiContextEnabled = false;
                result.sources.aiContextEnabled.source =
                    'schema-default-missing';
                result.areas.sync.status = 'error';
                Object.defineProperty(result, 'unrelated', {
                    get: unrelatedGetter,
                    enumerable: true,
                    configurable: true,
                });
                return result;
            });

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).resolves.toBe(true);
        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
        expect(unrelatedGetter).not.toHaveBeenCalled();
    });

    describe.each([
        {
            name: 'readResultStrict',
            read: () => configService.readResult('aiContextEnabled'),
            mockRead: (result) =>
                jest
                    .spyOn(configService, 'readResult')
                    .mockResolvedValue(result),
            mockReadRejection: (error) =>
                jest
                    .spyOn(configService, 'readResult')
                    .mockRejectedValue(error),
            strictRead: () =>
                configService.readResultStrict('aiContextEnabled'),
        },
        {
            name: 'readMultipleResultStrict',
            read: () => configService.readMultipleResult(['aiContextEnabled']),
            mockRead: (result) =>
                jest
                    .spyOn(configService, 'readMultipleResult')
                    .mockResolvedValue(result),
            mockReadRejection: (error) =>
                jest
                    .spyOn(configService, 'readMultipleResult')
                    .mockRejectedValue(error),
            strictRead: () =>
                configService.readMultipleResultStrict(['aiContextEnabled']),
        },
        {
            name: 'readAllResultStrict',
            read: () => configService.readAllResult(),
            mockRead: (result) =>
                jest
                    .spyOn(configService, 'readAllResult')
                    .mockResolvedValue(result),
            mockReadRejection: (error) =>
                jest
                    .spyOn(configService, 'readAllResult')
                    .mockRejectedValue(error),
            strictRead: () => configService.readAllResultStrict(),
        },
    ])(
        '$name producer snapshot authority',
        ({ read, mockRead, mockReadRejection, strictRead }) => {
            it('A: keeps authentic success authoritative after public failure forgery', async () => {
                installSuccessfulStorageReads({
                    sync: { aiContextEnabled: true },
                });
                const result = await read();
                const forgedCause = new Error('PRIVATE_FORGED_SUCCESS_CAUSE');
                const { proxy: forgedAreas, traversal } =
                    createTraversalTrackingProxy(
                        createFailedBooleanReadResult(forgedCause).areas
                    );
                result.ok = false;
                result.degraded = true;
                result.failedAreas = ['sync'];
                result.areas = forgedAreas;
                mockRead(result);

                await expect(strictRead()).resolves.toBe(result);
                expectNoProxyTraversal(traversal);
            });

            it('B: preserves producer failure metadata after public cause replacement', async () => {
                failStorageRead('sync', 'ACTUAL_PRODUCER_FAILURE');
                const result = await read();
                const producerCause = result.areas.sync.error;
                const localStatus = result.areas.local.status;
                const unknownKeyCount = result.unknownKeys.length;
                const excludedSensitiveKeyCount =
                    result.excludedSensitiveKeys.length;
                const attackerCause = new Error('PRIVATE_REPLACEMENT_FAILURE');
                const { proxy: forgedArea, traversal } =
                    createTraversalTrackingProxy(
                        createFailedBooleanReadResult(attackerCause).areas.sync
                    );
                result.areas.sync = forgedArea;
                mockRead(result);

                const error = await captureRejection(strictRead());

                expect(error).toBeInstanceOf(ConfigServiceReadError);
                expect(error.cause).toBe(producerCause);
                expect(error.cause).not.toBe(attackerCause);
                expect(error.message).not.toContain(
                    'PRIVATE_REPLACEMENT_FAILURE'
                );
                expect(error.failedAreas).toEqual(['sync']);
                expect(error.result).toEqual({
                    ok: false,
                    degraded: true,
                    failedAreas: ['sync'],
                    areas: {
                        sync: { status: 'error' },
                        local: { status: localStatus },
                    },
                    unknownKeyCount,
                    excludedSensitiveKeyCount,
                });
                expectNoProxyTraversal(traversal);
            });

            it('C: keeps authentic failure authoritative after public success forgery', async () => {
                failStorageRead('sync', 'ACTUAL_FAILURE_BEATS_PUBLIC_SUCCESS');
                const result = await read();
                const producerCause = result.areas.sync.error;
                const { proxy: forgedAreas, traversal } =
                    createTraversalTrackingProxy({
                        sync: { status: 'ok' },
                        local: { status: 'not-requested' },
                    });
                result.ok = true;
                result.degraded = false;
                result.failedAreas = [];
                result.areas = forgedAreas;
                result.values = { aiContextEnabled: true };
                result.sources = {
                    aiContextEnabled: { scope: 'sync', source: 'stored' },
                };
                mockRead(result);

                const error = await captureRejection(strictRead());

                expect(error).toBeInstanceOf(ConfigServiceReadError);
                expect(error.cause).toBe(producerCause);
                expectNoProxyTraversal(traversal);
            });

            it('D: rejects a manual success forgery without traversing it', async () => {
                const marker = 'PRIVATE_MANUAL_SUCCESS_FORGERY';
                const manualResult = createStoredBooleanReadResult({ marker });
                const { proxy, traversal } =
                    createTraversalTrackingProxy(manualResult);
                mockRead(proxy);

                const firstError = await captureRejection(strictRead());
                const secondError = await captureRejection(strictRead());

                for (const error of [firstError, secondError]) {
                    expect(error).toBeInstanceOf(ConfigServiceReadError);
                    expect(error.message).toBe(
                        'ConfigService read failed for storage area(s): unknown'
                    );
                    expect(Object.hasOwn(error, 'cause')).toBe(false);
                    expect(JSON.stringify(error)).not.toContain(marker);
                }
                expect(secondError).not.toBe(firstError);
                expectNoProxyTraversal(traversal);
            });

            it('E: rejects a manual failed graph cause-free without traversing it', async () => {
                const marker = 'PRIVATE_MANUAL_FAILURE_CAUSE';
                const manualResult = createFailedBooleanReadResult(
                    new Error(marker)
                );
                const { proxy, traversal } =
                    createTraversalTrackingProxy(manualResult);
                mockRead(proxy);

                const error = await captureRejection(strictRead());

                expect(error).toBeInstanceOf(ConfigServiceReadError);
                expect(error.message).toBe(
                    'ConfigService read failed for storage area(s): unknown'
                );
                expect(error.failedAreas).toEqual([]);
                expect(Object.hasOwn(error, 'cause')).toBe(false);
                expect(JSON.stringify(error)).not.toContain(marker);
                expectNoProxyTraversal(traversal);
            });

            it('F: preserves an untrusted delegated strict-error rejection without branding or parsing it', async () => {
                const marker = 'PRIVATE_DELEGATED_STRICT_ERROR';
                const publicError = new ConfigServiceReadError(
                    createFailedBooleanReadResult(new Error(marker))
                );
                mockReadRejection(publicError);

                const error = await captureRejection(strictRead());

                expect(error).toBe(publicError);
                expect(error.cause?.message).toBe(marker);

                jest.spyOn(configService, 'readResultStrict').mockRejectedValue(
                    publicError
                );
                const downstreamError = await captureRejection(
                    configService.readStoredBooleanStrict('aiContextEnabled')
                );

                expect(downstreamError).not.toBe(publicError);
                expect(downstreamError.message).toBe(
                    'Stored boolean configuration is unavailable'
                );
                expect(Object.hasOwn(downstreamError, 'cause')).toBe(false);
                expect(JSON.stringify(downstreamError)).not.toContain(marker);
            });
        }
    );

    it.each([
        {
            name: 'prototype forgery',
            makeError: () =>
                Object.assign(Object.create(ConfigServiceReadError.prototype), {
                    message: 'PRIVATE_PROTOTYPE_FORGERY',
                }),
            marker: 'PRIVATE_PROTOTYPE_FORGERY',
        },
        {
            name: 'direct unbranded instance',
            makeError: () => {
                const error = new ConfigServiceReadError({
                    ok: false,
                    degraded: true,
                    failedAreas: ['sync'],
                    areas: { sync: { status: 'error' } },
                });
                error.message = 'PRIVATE_DIRECT_INSTANCE';
                return error;
            },
            marker: 'PRIVATE_DIRECT_INSTANCE',
        },
        {
            name: 'subclass instance',
            makeError: () => {
                class ForgedConfigServiceReadError extends ConfigServiceReadError {}
                const error = new ForgedConfigServiceReadError({
                    ok: false,
                    degraded: true,
                    failedAreas: ['sync'],
                    areas: { sync: { status: 'error' } },
                });
                error.message = 'PRIVATE_SUBCLASS_INSTANCE';
                return error;
            },
            marker: 'PRIVATE_SUBCLASS_INSTANCE',
        },
    ])(
        'normalizes a rejected $name instead of trusting instanceof',
        async ({ makeError, marker }) => {
            const forgedError = makeError();
            jest.spyOn(configService, 'readResultStrict').mockRejectedValue(
                forgedError
            );

            const error = await captureRejection(
                configService.readStoredBooleanStrict('aiContextEnabled')
            );

            expect(error).not.toBe(forgedError);
            expect(error.message).toBe(
                'Stored boolean configuration is unavailable'
            );
            expect(JSON.stringify(error)).not.toContain(marker);
        }
    );

    it('does not brand a forged error rejected by the awaited read phase', async () => {
        const forgedError = Object.assign(
            Object.create(ConfigServiceReadError.prototype),
            { message: 'PRIVATE_AWAIT_PHASE_FORGERY' }
        );
        jest.spyOn(configService, 'readResult').mockRejectedValue(forgedError);
        const strictRead = jest.spyOn(configService, 'readResultStrict');

        const error = await captureRejection(
            configService.readStoredBooleanStrict('aiContextEnabled')
        );

        expect(error).not.toBe(forgedError);
        expect(error.message).toBe(
            'Stored boolean configuration is unavailable'
        );
        expect(JSON.stringify(error)).not.toContain(
            'PRIVATE_AWAIT_PHASE_FORGERY'
        );
        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
    });

    it('normalizes a public strict error rejected by the delegated read phase', async () => {
        const marker = 'PRIVATE_PUBLIC_DELEGATED_STRICT_ERROR';
        const publicError = new ConfigServiceReadError(
            createFailedBooleanReadResult(new Error(marker))
        );
        jest.spyOn(configService, 'readResult').mockRejectedValue(publicError);

        const error = await captureRejection(
            configService.readStoredBooleanStrict('aiContextEnabled')
        );

        expect(error).not.toBe(publicError);
        expect(error.message).toBe(
            'Stored boolean configuration is unavailable'
        );
        expect(Object.hasOwn(error, 'cause')).toBe(false);
        expect(JSON.stringify(error)).not.toContain(marker);
    });

    it('does not trust a strict error derived from an unbranded failed result', async () => {
        const marker = 'PRIVATE_UNBRANDED_RESULT_CAUSE';
        const rawCause = new Error(marker);
        jest.spyOn(configService, 'readResult').mockResolvedValue(
            createFailedBooleanReadResult(rawCause)
        );
        const strictRead = jest.spyOn(configService, 'readResultStrict');

        const error = await captureRejection(
            configService.readStoredBooleanStrict('aiContextEnabled')
        );

        expect(error).not.toBeInstanceOf(ConfigServiceReadError);
        expect(error.message).toBe(
            'Stored boolean configuration is unavailable'
        );
        expect(Object.hasOwn(error, 'cause')).toBe(false);
        expect(JSON.stringify(error)).not.toContain(marker);
        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
    });

    it('does not trust a strict error derived from a transparent unbranded result proxy', async () => {
        const marker = 'PRIVATE_TRANSPARENT_RESULT_CAUSE';
        const { proxy, traversal } = createTraversalTrackingProxy(
            createFailedBooleanReadResult(new Error(marker))
        );
        jest.spyOn(configService, 'readResult').mockReturnValue(proxy);

        const error = await captureRejection(
            configService.readStoredBooleanStrict('aiContextEnabled')
        );

        expect(error).not.toBeInstanceOf(ConfigServiceReadError);
        expect(error.message).toBe(
            'Stored boolean configuration is unavailable'
        );
        expect(Object.hasOwn(error, 'cause')).toBe(false);
        expect(JSON.stringify(error)).not.toContain(marker);
        expectNoProxyTraversal(traversal);
    });

    it('normalizes a revoked unbranded result during strict-read await', async () => {
        const marker = 'PRIVATE_REVOKED_RESULT_CAUSE';
        const result = createRevokedProxy(
            createFailedBooleanReadResult(new Error(marker))
        );
        jest.spyOn(configService, 'readResult').mockReturnValue(result);

        const error = await captureRejection(
            configService.readStoredBooleanStrict('aiContextEnabled')
        );

        expect(error).not.toBeInstanceOf(ConfigServiceReadError);
        expect(error.message).toBe(
            'Stored boolean configuration is unavailable'
        );
        expect(Object.hasOwn(error, 'cause')).toBe(false);
        expect(JSON.stringify(error)).not.toContain(marker);
    });

    it('normalizes a proxy around a genuine strict error without prototype traversal', async () => {
        failStorageRead('sync', 'PRIVATE_PROXIED_GENUINE_ERROR');
        const actualStrictRead =
            configService.readResultStrict.bind(configService);
        let traversal;
        const strictRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockImplementation(async (...args) => {
                try {
                    return await actualStrictRead(...args);
                } catch (error) {
                    const tracked = createTraversalTrackingProxy(error);
                    traversal = tracked.traversal;
                    throw tracked.proxy;
                }
            });

        const error = await captureRejection(
            configService.readStoredBooleanStrict('aiContextEnabled')
        );

        expect(error.message).toBe(
            'Stored boolean configuration is unavailable'
        );
        expect(JSON.stringify(error)).not.toContain(
            'PRIVATE_PROXIED_GENUINE_ERROR'
        );
        expect(strictRead.mock.calls).toEqual([['aiContextEnabled']]);
        expectNoProxyTraversal(traversal);
    });

    it('normalizes a revoked outer result during await assimilation', async () => {
        const result = createRevokedProxy(createStoredBooleanReadResult());
        jest.spyOn(configService, 'readResultStrict').mockReturnValue(result);

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');
    });

    it('requires an own data authority flag without invoking hostile values', () => {
        let accessorReads = 0;
        const accessorResult = {};
        for (const [key, value] of [
            ['ok', true],
            ['degraded', false],
            ['failedAreas', []],
            ['areas', {}],
            ['unknownKeys', []],
            ['excludedSensitiveKeys', []],
        ]) {
            Object.defineProperty(accessorResult, key, {
                get() {
                    accessorReads += 1;
                    return value;
                },
            });
        }
        const inheritedResult = Object.create({ ok: true });
        const { proxy, revoke } = Proxy.revocable({ ok: true }, {});
        revoke();

        for (const result of [
            null,
            {},
            { ok: false },
            accessorResult,
            inheritedResult,
            proxy,
        ]) {
            expect(() => requireConfigServiceRead(result)).toThrow(
                ConfigServiceReadError
            );
        }
        expect(accessorReads).toBe(0);
    });

    it('defines strict reads as storage-authoritative rather than request-complete', async () => {
        const excludedSensitive =
            await configService.readResultStrict('openaiApiKey');
        const unknown = await configService.readResultStrict('notASetting');

        expect(excludedSensitive).toMatchObject({
            ok: true,
            values: {},
            degraded: false,
            excludedSensitiveKeys: ['openaiApiKey'],
        });
        expect(unknown).toMatchObject({
            ok: true,
            values: {},
            degraded: false,
            unknownKeys: ['notASetting'],
        });
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('throws a typed strict-read error with secret-free result metadata', async () => {
        installSuccessfulStorageReads({
            local: { openaiApiKey: 'super-secret-value' },
        });
        failStorageRead('sync');

        const result = await configService.readMultipleResult(
            ['uiLanguage', 'openaiApiKey'],
            { includeSensitive: true }
        );
        const originalAreaError = result.areas.sync.error;

        expect(() => requireConfigServiceRead(result)).toThrow(
            ConfigServiceReadError
        );

        try {
            requireConfigServiceRead(result);
        } catch (error) {
            expect(error).toMatchObject({
                name: 'ConfigServiceReadError',
                failedAreas: ['sync'],
                cause: originalAreaError,
                result: {
                    ok: false,
                    degraded: true,
                    failedAreas: ['sync'],
                    areas: {
                        sync: { status: 'error' },
                        local: { status: 'ok' },
                    },
                    unknownKeyCount: 0,
                    excludedSensitiveKeyCount: 0,
                },
            });
            expect(error.result).not.toHaveProperty('values');
            expect(error.result).not.toHaveProperty('displayFallbacks');
            expect(error.result.areas.sync).not.toHaveProperty('error');
            expect(
                Object.getOwnPropertyDescriptor(error, 'cause')
            ).toMatchObject({ enumerable: false, value: originalAreaError });
            expect(JSON.stringify(error)).not.toContain('super-secret-value');
        }
    });

    it('strictly evaluates result records without relying on Object prototypes', () => {
        const areaError = new Error('unreadable');
        const areas = Object.create(null);
        areas.sync = { status: 'error', error: areaError };
        areas.local = { status: 'not-requested' };
        const result = Object.assign(Object.create(null), {
            degraded: true,
            failedAreas: ['sync'],
            areas,
            unknownKeys: [],
            excludedSensitiveKeys: [],
        });

        expect(() => requireConfigServiceRead(result)).toThrow(
            expect.objectContaining({ cause: areaError })
        );
    });

    it('does not copy caller-controlled unknown key text into strict errors', async () => {
        const secretLikeUnknownKey = 'unknown-super-secret-token-123';
        failStorageRead('sync');
        const result = await configService.readMultipleResult([
            'uiLanguage',
            secretLikeUnknownKey,
        ]);

        try {
            requireConfigServiceRead(result);
            throw new Error('Expected requireConfigServiceRead to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigServiceReadError);
            expect(error.result).toMatchObject({
                unknownKeyCount: 1,
                excludedSensitiveKeyCount: 0,
            });
            expect(error.result).not.toHaveProperty('unknownKeys');
            expect(error.result).not.toHaveProperty('excludedSensitiveKeys');
            expect(error.message).not.toContain(secretLikeUnknownKey);
            expect(String(error)).not.toContain(secretLikeUnknownKey);
            expect(JSON.stringify(error)).not.toContain(secretLikeUnknownKey);
        }
    });

    it('delegates every result reader to the same bulk-read seam', async () => {
        const sentinel = { degraded: false };
        const bulkRead = jest
            .spyOn(configService, '_readResultBundle')
            .mockResolvedValue(sentinel);
        const options = { includeSensitive: true };

        await expect(
            configService.readResult('uiLanguage', options)
        ).resolves.toBe(sentinel);
        expect(bulkRead).toHaveBeenLastCalledWith(['uiLanguage'], options);

        await expect(
            configService.readMultipleResult(
                ['uiLanguage', 'debugMode'],
                options
            )
        ).resolves.toBe(sentinel);
        expect(bulkRead).toHaveBeenLastCalledWith(
            ['uiLanguage', 'debugMode'],
            options
        );

        await expect(configService.readAllResult(options)).resolves.toBe(
            sentinel
        );
        expect(bulkRead).toHaveBeenLastCalledWith(
            Object.keys(configSchema),
            options
        );
    });

    it.each([
        {
            strictMethod: 'readResultStrict',
            resultMethod: 'readResult',
            args: ['uiLanguage', { includeSensitive: true }],
        },
        {
            strictMethod: 'readMultipleResultStrict',
            resultMethod: 'readMultipleResult',
            args: [['uiLanguage', 'debugMode'], { includeSensitive: true }],
        },
        {
            strictMethod: 'readAllResultStrict',
            resultMethod: 'readAllResult',
            args: [{ includeSensitive: true }],
        },
    ])(
        '$strictMethod delegates to $resultMethod and applies the strict adapter',
        async ({ strictMethod, resultMethod, args }) => {
            const degradedResult = {
                degraded: true,
                failedAreas: ['sync'],
                areas: {
                    sync: { status: 'error', error: new Error('failed') },
                    local: { status: 'not-requested' },
                },
                unknownKeys: [],
                excludedSensitiveKeys: [],
            };
            const resultReader = jest
                .spyOn(configService, resultMethod)
                .mockResolvedValue(degradedResult);

            await expect(
                configService[strictMethod](...args)
            ).rejects.toBeInstanceOf(ConfigServiceReadError);
            expect(resultReader).toHaveBeenCalledWith(...args);
        }
    );
});
