import { jest } from '@jest/globals';
import { ConfigServiceReadError, configService } from './configService.js';

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

describe('ConfigService read results', () => {
    beforeEach(() => {
        installSuccessfulStorageReads();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reports stored, canonicalized, and defaulted values with provenance', async () => {
        installSuccessfulStorageReads({
            sync: {
                uiLanguage: 'es',
                targetLanguage: 'EN-us',
                loggingLevel: 99,
            },
        });

        const result = await configService.readMultipleResultStrict([
            'uiLanguage',
            'targetLanguage',
            'loggingLevel',
        ]);

        expect(result).toMatchObject({
            ok: true,
            degraded: false,
            failedAreas: [],
            values: {
                uiLanguage: 'es',
                targetLanguage: 'en-US',
                loggingLevel: 3,
            },
            sources: {
                uiLanguage: { scope: 'sync', source: 'stored' },
                targetLanguage: { scope: 'sync', source: 'stored' },
                loggingLevel: {
                    scope: 'sync',
                    source: 'schema-default-invalid',
                },
            },
            areas: {
                sync: { status: 'ok' },
                local: { status: 'not-requested' },
            },
        });
    });

    it('reads requested sync and local keys through one authoritative bundle', async () => {
        installSuccessfulStorageReads({
            sync: { uiLanguage: 'ja' },
            local: { debugMode: true },
        });

        await expect(
            configService.readMultipleResultStrict(['uiLanguage', 'debugMode'])
        ).resolves.toMatchObject({
            ok: true,
            degraded: false,
            values: { uiLanguage: 'ja', debugMode: true },
            areas: {
                sync: { status: 'ok' },
                local: { status: 'ok' },
            },
        });
    });

    it('rejects a strict read when either requested storage area fails', async () => {
        installSuccessfulStorageReads({ local: { debugMode: true } });
        failStorageRead('sync', 'sync read failed');

        await expect(
            configService.readMultipleResultStrict(['uiLanguage', 'debugMode'])
        ).rejects.toMatchObject({
            name: 'ConfigServiceReadError',
            failedAreas: ['sync'],
            result: expect.objectContaining({
                degraded: true,
                failedAreas: ['sync'],
            }),
        });
    });

    it('excludes sensitive keys unless access is explicitly enabled', async () => {
        installSuccessfulStorageReads({
            local: { debugMode: true, openaiApiKey: 'explicit-secret' },
        });

        const projected = await configService.readMultipleResultStrict([
            'debugMode',
            'openaiApiKey',
        ]);
        const sensitive = await configService.readResultStrict('openaiApiKey', {
            includeSensitive: true,
        });

        expect(projected.values).toEqual({ debugMode: true });
        expect(sensitive.values).toEqual({
            openaiApiKey: 'explicit-secret',
        });
    });

    it('keeps sensitive storage failures out of logs and serialized results', async () => {
        const rawCause = 'private-storage-cause must-not-leak';
        failStorageRead('local', rawCause);
        const previousLevel = configService.logger.currentLevel;
        configService.logger.currentLevel = 4;

        try {
            let error;
            try {
                await configService.readResultStrict('openaiApiKey', {
                    includeSensitive: true,
                });
            } catch (caught) {
                error = caught;
            }
            const output = [
                ...console.debug.mock.calls.flat(),
                ...console.error.mock.calls.flat(),
            ].join('\n');

            expect(error).toBeInstanceOf(ConfigServiceReadError);
            expect(output).not.toContain('openaiApiKey');
            expect(output).not.toContain(rawCause);
            expect(JSON.stringify(error)).not.toContain(rawCause);
        } finally {
            configService.logger.currentLevel = previousLevel;
        }
    });

    it('reports unknown keys without making a storage read fail', async () => {
        await expect(
            configService.readResultStrict('notASetting')
        ).resolves.toMatchObject({ ok: true, values: {} });
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('reads all non-sensitive settings by default', async () => {
        installSuccessfulStorageReads({
            sync: { subtitlesEnabled: false },
            local: { debugMode: true, openaiApiKey: 'must-not-leak' },
        });

        const result = await configService.readAllResultStrict();

        expect(result.values).toMatchObject({
            subtitlesEnabled: false,
            debugMode: true,
        });
        expect(result.values).not.toHaveProperty('openaiApiKey');
    });

    it.each([true, false])(
        'returns an explicitly stored Boolean value %p',
        async (value) => {
            installSuccessfulStorageReads({
                sync: { aiContextEnabled: value },
            });

            await expect(
                configService.readStoredBooleanStrict('aiContextEnabled')
            ).resolves.toBe(value);
        }
    );

    it.each([
        ['missing', {}],
        ['invalid', { aiContextEnabled: 'not-a-boolean' }],
    ])('rejects a %s stored Boolean', async (_condition, sync) => {
        installSuccessfulStorageReads({ sync });

        await expect(
            configService.readStoredBooleanStrict('aiContextEnabled')
        ).rejects.toThrow('Stored boolean configuration is unavailable');
    });

    it('preserves a typed, secret-safe error when Boolean storage fails', async () => {
        const secret = 'private-stored-boolean-secret';
        failStorageRead('sync', secret);

        let error;
        try {
            await configService.readStoredBooleanStrict('aiContextEnabled');
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(ConfigServiceReadError);
        expect(error.failedAreas).toEqual(['sync']);
        expect(error.message).not.toContain(secret);
        expect(JSON.stringify(error)).not.toContain(secret);
    });
});
