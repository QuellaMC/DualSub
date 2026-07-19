import { jest } from '@jest/globals';

import { configSchema } from '../config/configSchema.js';
import { isRetryableContextError } from './retryPolicy.js';

const readMultipleResultStrict = jest.fn();

jest.unstable_mockModule('../services/configService.js', () => ({
    configService: { readMultipleResultStrict },
}));

const { ProviderConfigReadError, readRequiredProviderConfig } =
    await import('./providerConfig.js');

function createAuthoritativeResult(values) {
    return {
        ok: true,
        values,
        degraded: false,
        failedAreas: [],
        areas: {
            sync: { status: 'ok' },
            local: { status: 'ok' },
        },
    };
}

function createGetGuardProxy(target, { allowPromiseThen = false } = {}) {
    const forbiddenGetter = jest.fn((record, key, receiver) =>
        Reflect.get(record, key, receiver)
    );
    return {
        proxy: new Proxy(target, {
            get(record, key, receiver) {
                if (allowPromiseThen && key === 'then') {
                    return Reflect.get(record, key, receiver);
                }
                return forbiddenGetter(record, key, receiver);
            },
        }),
        forbiddenGetter,
    };
}

describe('provider configuration snapshots', () => {
    beforeEach(() => {
        readMultipleResultStrict.mockReset();
    });

    it('reads a healthy cross-area snapshot through one exact sensitive bulk call', async () => {
        const keys = ['openaiApiKey', 'openaiBaseUrl', 'openaiModel'];
        const values = Object.assign(Object.create(null), {
            openaiApiKey: 'provider-key',
            openaiBaseUrl: 'https://provider.example/v1',
            openaiModel: 'provider-model',
            unrelated: 'must-not-be-returned',
        });
        readMultipleResultStrict.mockResolvedValue(
            createAuthoritativeResult(values)
        );

        const snapshot = await readRequiredProviderConfig(keys);

        expect(Object.getPrototypeOf(snapshot)).toBeNull();
        expect(snapshot).toEqual({
            openaiApiKey: 'provider-key',
            openaiBaseUrl: 'https://provider.example/v1',
            openaiModel: 'provider-model',
        });
        expect(snapshot).not.toHaveProperty('unrelated');
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isExtensible(snapshot)).toBe(false);
        for (const key of keys) {
            expect(
                Object.getOwnPropertyDescriptor(snapshot, key)
            ).toMatchObject({
                value: values[key],
                enumerable: true,
                configurable: false,
                writable: false,
            });
        }
        expect(readMultipleResultStrict).toHaveBeenCalledTimes(1);
        const [calledKeys, options] = readMultipleResultStrict.mock.calls[0];
        expect(calledKeys).toEqual(keys);
        expect(calledKeys).not.toBe(keys);
        expect(Object.isFrozen(calledKeys)).toBe(true);
        expect(Object.isExtensible(calledKeys)).toBe(false);
        expect(Object.getOwnPropertyDescriptor(calledKeys, '0')).toMatchObject({
            value: keys[0],
            enumerable: true,
            configurable: false,
            writable: false,
        });
        expect(options).toEqual({ includeSensitive: true });
        expect(Object.hasOwn(options, 'includeSensitive')).toBe(true);
        expect(Object.keys(options)).toEqual(['includeSensitive']);
        expect(
            Object.getOwnPropertyDescriptor(options, 'includeSensitive')
        ).toMatchObject({
            value: true,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    });

    it('fails closed before storage when native structuredClone is unavailable', async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'structuredClone'
        );
        Object.defineProperty(globalThis, 'structuredClone', {
            ...originalDescriptor,
            value: undefined,
        });
        try {
            await expect(
                readRequiredProviderConfig(['openaiApiKey'])
            ).rejects.toBeInstanceOf(ProviderConfigReadError);
            expect(readMultipleResultStrict).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(
                globalThis,
                'structuredClone',
                originalDescriptor
            );
        }
    });

    it('fails closed when cloning a selected value fails after one read', async () => {
        const selectedValue = { nested: 'provider-secret' };
        readMultipleResultStrict.mockResolvedValue(
            createAuthoritativeResult({ openaiApiKey: selectedValue })
        );

        const realStructuredClone = globalThis.structuredClone;
        const cloneSpy = jest
            .spyOn(globalThis, 'structuredClone')
            .mockImplementation((value) => {
                if (value === selectedValue) {
                    throw new Error(
                        'clone failed with provider-secret and openaiApiKey'
                    );
                }
                return realStructuredClone(value);
            });

        try {
            await expect(
                readRequiredProviderConfig(['openaiApiKey'])
            ).rejects.toBeInstanceOf(ProviderConfigReadError);
            expect(readMultipleResultStrict).toHaveBeenCalledTimes(1);
        } finally {
            cloneSpy.mockRestore();
        }
    });

    it('returns an independent recursively frozen cyclic value graph', async () => {
        const selectedValue = {
            nested: {
                label: 'original',
                items: [{ count: 1 }],
            },
        };
        selectedValue.self = selectedValue;
        readMultipleResultStrict.mockResolvedValue(
            createAuthoritativeResult({ openaiApiKey: selectedValue })
        );

        const snapshot = await readRequiredProviderConfig(['openaiApiKey']);
        const clonedValue = snapshot.openaiApiKey;

        expect(clonedValue).not.toBe(selectedValue);
        expect(clonedValue.nested).not.toBe(selectedValue.nested);
        expect(clonedValue.nested.items).not.toBe(selectedValue.nested.items);
        expect(clonedValue.self).toBe(clonedValue);
        expect(Object.isFrozen(clonedValue)).toBe(true);
        expect(Object.isFrozen(clonedValue.nested)).toBe(true);
        expect(Object.isFrozen(clonedValue.nested.items)).toBe(true);
        expect(Object.isFrozen(clonedValue.nested.items[0])).toBe(true);

        selectedValue.nested.label = 'mutated-source';
        selectedValue.nested.items[0].count = 2;
        expect(clonedValue.nested.label).toBe('original');
        expect(clonedValue.nested.items[0].count).toBe(1);
        expect(() => {
            clonedValue.nested.label = 'mutated-snapshot';
        }).toThrow(TypeError);
        expect(() => {
            clonedValue.nested.items.push({ count: 3 });
        }).toThrow();
    });

    it.each([
        ['sync', 'local', 'local storage still contained a credential'],
        ['local', 'sync', 'sync storage still contained an endpoint'],
    ])(
        'normalizes a failed %s area when %s succeeds in a cross-area read',
        async (failedArea, healthyArea, rawMessage) => {
            const storageFailure = Object.assign(new Error(rawMessage), {
                failedAreas: [failedArea],
                result: {
                    degraded: true,
                    failedAreas: [failedArea],
                    areas: {
                        [failedArea]: { status: 'error' },
                        [healthyArea]: { status: 'ok' },
                    },
                },
            });
            readMultipleResultStrict.mockRejectedValue(storageFailure);

            await expect(
                readRequiredProviderConfig(['openaiApiKey', 'openaiBaseUrl'])
            ).rejects.toMatchObject({
                name: 'ProviderConfigReadError',
                code: 'PROVIDER_CONFIG_READ_FAILED',
                retryable: false,
                shouldRetry: false,
                cause: storageFailure,
            });
        }
    );

    it('rejects a degraded result even if a mocked strict reader returns values', async () => {
        readMultipleResultStrict.mockResolvedValue({
            values: { openaiApiKey: 'secret', openaiBaseUrl: 'https://wrong' },
            degraded: true,
            failedAreas: ['sync'],
        });

        await expect(
            readRequiredProviderConfig(['openaiApiKey', 'openaiBaseUrl'])
        ).rejects.toBeInstanceOf(ProviderConfigReadError);
    });

    it.each([undefined, false])(
        'rejects an otherwise healthy result when own ok is %#',
        async (ok) => {
            const result = createAuthoritativeResult({
                openaiApiKey: 'must-not-be-returned',
            });
            if (ok === undefined) {
                delete result.ok;
            } else {
                result.ok = ok;
            }
            readMultipleResultStrict.mockResolvedValue(result);

            await expect(
                readRequiredProviderConfig(['openaiApiKey'])
            ).rejects.toBeInstanceOf(ProviderConfigReadError);
        }
    );

    it('does not accept required values inherited from a polluted prototype', async () => {
        const values = Object.create({
            openaiApiKey: 'inherited-secret',
            polluted: true,
        });
        values.openaiBaseUrl = 'https://provider.example/v1';
        readMultipleResultStrict.mockResolvedValue(
            createAuthoritativeResult(values)
        );

        await expect(
            readRequiredProviderConfig(['openaiApiKey', 'openaiBaseUrl'])
        ).rejects.toBeInstanceOf(ProviderConfigReadError);
    });

    it('returns a null-prototype projection from values with a polluted prototype', async () => {
        const values = Object.create({ polluted: 'inherited-value' });
        Object.assign(values, {
            openaiApiKey: 'own-secret',
            openaiBaseUrl: 'https://provider.example/v1',
        });
        readMultipleResultStrict.mockResolvedValue(
            createAuthoritativeResult(values)
        );

        const snapshot = await readRequiredProviderConfig([
            'openaiApiKey',
            'openaiBaseUrl',
        ]);

        expect(Object.getPrototypeOf(snapshot)).toBeNull();
        expect(Object.hasOwn(snapshot, 'polluted')).toBe(false);
        expect(snapshot.polluted).toBeUndefined();
    });

    it('rejects an authoritative result missing any required own key', async () => {
        readMultipleResultStrict.mockResolvedValue(
            createAuthoritativeResult({
                openaiApiKey: 'present',
            })
        );

        await expect(
            readRequiredProviderConfig(['openaiApiKey', 'openaiBaseUrl'])
        ).rejects.toBeInstanceOf(ProviderConfigReadError);
    });

    it('rejects contradictory area metadata even when values are present', async () => {
        const result = createAuthoritativeResult({
            openaiApiKey: 'present',
            openaiBaseUrl: 'https://provider.example/v1',
        });
        result.areas.sync = { status: 'error' };
        readMultipleResultStrict.mockResolvedValue(result);

        await expect(
            readRequiredProviderConfig(['openaiApiKey', 'openaiBaseUrl'])
        ).rejects.toBeInstanceOf(ProviderConfigReadError);
    });

    it('rejects authoritative metadata inherited from polluted prototypes', async () => {
        const result = Object.create({
            degraded: false,
            failedAreas: [],
            values: { openaiApiKey: 'inherited-container' },
            areas: { local: { status: 'ok' } },
        });
        readMultipleResultStrict.mockResolvedValue(result);

        await expect(
            readRequiredProviderConfig(['openaiApiKey'])
        ).rejects.toBeInstanceOf(ProviderConfigReadError);
    });

    it('rejects inherited area health even when required values are own', async () => {
        const result = createAuthoritativeResult({
            openaiApiKey: 'own-value',
        });
        result.areas = Object.create({ local: { status: 'ok' } });
        result.areas.sync = { status: 'not-requested' };
        readMultipleResultStrict.mockResolvedValue(result);

        await expect(
            readRequiredProviderConfig(['openaiApiKey'])
        ).rejects.toBeInstanceOf(ProviderConfigReadError);
    });

    it.each([
        [
            'top-level transparent proxy',
            (result) => {
                const { proxy, forbiddenGetter } = createGetGuardProxy(result, {
                    allowPromiseThen: true,
                });
                return { result: proxy, forbiddenGetter };
            },
        ],
        [
            'top-level revoked proxy',
            (result) => {
                const revocable = Proxy.revocable(result, {});
                revocable.revoke();
                return { result: revocable.proxy };
            },
        ],
        [
            'own ok accessor',
            (result) => {
                const forbiddenGetter = jest.fn(() => true);
                Object.defineProperty(result, 'ok', {
                    get: forbiddenGetter,
                    enumerable: true,
                });
                return { result, forbiddenGetter };
            },
        ],
        [
            'own degraded accessor',
            (result) => {
                const forbiddenGetter = jest.fn(() => false);
                Object.defineProperty(result, 'degraded', {
                    get: forbiddenGetter,
                    enumerable: true,
                });
                return { result, forbiddenGetter };
            },
        ],
        [
            'own failedAreas accessor',
            (result) => {
                const forbiddenGetter = jest.fn(() => []);
                Object.defineProperty(result, 'failedAreas', {
                    get: forbiddenGetter,
                    enumerable: true,
                });
                return { result, forbiddenGetter };
            },
        ],
        [
            'transparent failedAreas proxy',
            (result) => {
                const { proxy, forbiddenGetter } = createGetGuardProxy([]);
                result.failedAreas = proxy;
                return { result, forbiddenGetter };
            },
        ],
        [
            'failedAreas with extra own data',
            (result) => {
                result.failedAreas.extra = 'must-reject';
                return { result };
            },
        ],
        [
            'own areas accessor',
            (result) => {
                const areas = result.areas;
                const forbiddenGetter = jest.fn(() => areas);
                Object.defineProperty(result, 'areas', {
                    get: forbiddenGetter,
                    enumerable: true,
                });
                return { result, forbiddenGetter };
            },
        ],
        [
            'transparent areas proxy',
            (result) => {
                const { proxy, forbiddenGetter } = createGetGuardProxy(
                    result.areas
                );
                result.areas = proxy;
                return { result, forbiddenGetter };
            },
        ],
        [
            'transparent area-status proxy',
            (result) => {
                const { proxy, forbiddenGetter } = createGetGuardProxy(
                    result.areas.local
                );
                result.areas.local = proxy;
                return { result, forbiddenGetter };
            },
        ],
        [
            'own status accessor',
            (result) => {
                const forbiddenGetter = jest.fn(() => 'ok');
                Object.defineProperty(result.areas.local, 'status', {
                    get: forbiddenGetter,
                    enumerable: true,
                });
                return { result, forbiddenGetter };
            },
        ],
        [
            'own values accessor',
            (result) => {
                const values = result.values;
                const forbiddenGetter = jest.fn(() => values);
                Object.defineProperty(result, 'values', {
                    get: forbiddenGetter,
                    enumerable: true,
                });
                return { result, forbiddenGetter };
            },
        ],
        [
            'transparent values proxy',
            (result) => {
                const { proxy, forbiddenGetter } = createGetGuardProxy(
                    result.values
                );
                result.values = proxy;
                return { result, forbiddenGetter };
            },
        ],
        [
            'own selected-value accessor',
            (result) => {
                const forbiddenGetter = jest.fn(() => 'provider-secret');
                Object.defineProperty(result.values, 'openaiApiKey', {
                    get: forbiddenGetter,
                    enumerable: true,
                });
                return { result, forbiddenGetter };
            },
        ],
        [
            'transparent selected-value proxy',
            (result) => {
                const { proxy, forbiddenGetter } = createGetGuardProxy({
                    nested: 'provider-secret',
                });
                result.values.openaiApiKey = proxy;
                return { result, forbiddenGetter };
            },
        ],
        [
            'throwing top-level descriptor proxy',
            (result) => ({
                result: new Proxy(result, {
                    getOwnPropertyDescriptor() {
                        throw new Error(
                            'strict-result-descriptor-provider-secret'
                        );
                    },
                }),
            }),
        ],
        [
            'throwing nested descriptor proxy',
            (result) => {
                result.values = new Proxy(result.values, {
                    getOwnPropertyDescriptor() {
                        throw new Error(
                            'strict-values-descriptor-provider-secret'
                        );
                    },
                });
                return { result };
            },
        ],
        [
            'revoked selected-value proxy',
            (result) => {
                const revocable = Proxy.revocable(
                    { nested: 'provider-secret' },
                    {}
                );
                revocable.revoke();
                result.values.openaiApiKey = revocable.proxy;
                return { result };
            },
        ],
    ])(
        'normalizes hostile strict-read structure without invoking getters: %s',
        async (_label, createVariant) => {
            const baseResult = createAuthoritativeResult({
                openaiApiKey: 'provider-secret',
            });
            const { result, forbiddenGetter } = createVariant(baseResult);
            readMultipleResultStrict.mockResolvedValue(result);

            await expect(
                readRequiredProviderConfig(['openaiApiKey'])
            ).rejects.toBeInstanceOf(ProviderConfigReadError);
            expect(readMultipleResultStrict).toHaveBeenCalledTimes(1);
            if (forbiddenGetter) {
                expect(forbiddenGetter).not.toHaveBeenCalled();
            }
        }
    );

    it('uses the validated key snapshot if the caller mutates its array in flight', async () => {
        const keys = ['openaiApiKey', 'openaiBaseUrl'];
        let resolveRead;
        readMultipleResultStrict.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRead = resolve;
                })
        );

        const read = readRequiredProviderConfig(keys);
        keys.splice(0, keys.length, '__proto__');
        resolveRead(
            createAuthoritativeResult({
                openaiApiKey: 'provider-key',
                openaiBaseUrl: 'https://provider.example/v1',
            })
        );

        await expect(read).resolves.toEqual({
            openaiApiKey: 'provider-key',
            openaiBaseUrl: 'https://provider.example/v1',
        });
        expect(readMultipleResultStrict).toHaveBeenCalledWith(
            ['openaiApiKey', 'openaiBaseUrl'],
            { includeSensitive: true }
        );
    });

    it.each([
        undefined,
        null,
        {},
        [],
        ['openaiApiKey', 'openaiApiKey'],
        ['__proto__'],
        ['unknown-caller-secret-text'],
        ['openaiApiKey', 7],
    ])('rejects malformed required keys before storage %#', async (keys) => {
        await expect(readRequiredProviderConfig(keys)).rejects.toBeInstanceOf(
            ProviderConfigReadError
        );
        expect(readMultipleResultStrict).not.toHaveBeenCalled();
    });

    it('normalizes a throwing array proxy before any storage call', async () => {
        const { proxy, revoke } = Proxy.revocable(['openaiApiKey'], {});
        revoke();

        await expect(readRequiredProviderConfig(proxy)).rejects.toBeInstanceOf(
            ProviderConfigReadError
        );
        expect(readMultipleResultStrict).not.toHaveBeenCalled();
    });

    it.each([
        ['sparse array', () => new Array(1)],
        [
            'array with inherited index',
            () => {
                const keys = new Array(1);
                Object.setPrototypeOf(keys, { 0: 'openaiApiKey' });
                return keys;
            },
        ],
        [
            'accessor index',
            () => {
                const getter = jest.fn(() => 'openaiApiKey');
                const keys = ['placeholder'];
                Object.defineProperty(keys, '0', { get: getter });
                return { keys, forbiddenReads: getter };
            },
        ],
        [
            'extra own string property',
            () => Object.assign(['openaiApiKey'], { extra: 'caller-secret' }),
        ],
        [
            'extra own symbol property',
            () => {
                const keys = ['openaiApiKey'];
                keys[Symbol('caller-secret')] = true;
                return keys;
            },
        ],
        [
            'own custom iterator accessor',
            () => {
                const getter = jest.fn(
                    () =>
                        function* customIterator() {
                            yield 'openaiApiKey';
                        }
                );
                const keys = ['openaiApiKey'];
                Object.defineProperty(keys, Symbol.iterator, { get: getter });
                return { keys, forbiddenReads: getter };
            },
        ],
        [
            'own custom iterator data property',
            () => {
                const keys = ['openaiApiKey'];
                Object.defineProperty(keys, Symbol.iterator, {
                    value: function* customIterator() {
                        yield 'openaiApiKey';
                    },
                });
                return keys;
            },
        ],
        [
            'array subclass',
            () => {
                class RequiredKeys extends Array {}
                return new RequiredKeys('openaiApiKey');
            },
        ],
        [
            'transparent array proxy',
            () => {
                const { proxy, forbiddenGetter } = createGetGuardProxy([
                    'openaiApiKey',
                ]);
                return { keys: proxy, forbiddenReads: forbiddenGetter };
            },
        ],
        [
            'throwing ownKeys proxy',
            () =>
                new Proxy(['openaiApiKey'], {
                    ownKeys() {
                        throw new Error('caller-secret-ownKeys');
                    },
                }),
        ],
        [
            'throwing descriptor proxy',
            () =>
                new Proxy(['openaiApiKey'], {
                    getOwnPropertyDescriptor() {
                        throw new Error('caller-secret-descriptor');
                    },
                }),
        ],
        [
            'throwing prototype proxy',
            () =>
                new Proxy(['openaiApiKey'], {
                    getPrototypeOf() {
                        throw new Error('caller-secret-prototype');
                    },
                }),
        ],
    ])('rejects hostile required keys: %s', async (_label, createKeys) => {
        const created = createKeys();
        const isDirectArray = Array.isArray(created);
        const keys = isDirectArray ? created : created.keys;
        const forbiddenReads = isDirectArray
            ? undefined
            : created.forbiddenReads;

        await expect(readRequiredProviderConfig(keys)).rejects.toBeInstanceOf(
            ProviderConfigReadError
        );
        expect(readMultipleResultStrict).not.toHaveBeenCalled();
        if (forbiddenReads) expect(forbiddenReads).not.toHaveBeenCalled();
    });

    it('rejects an oversized required-key array before indexed inspection', async () => {
        let indexedReads = 0;
        const keys = new Proxy(
            new Array(Object.keys(configSchema).length + 1),
            {
                get(target, key, receiver) {
                    if (typeof key === 'string' && /^\d+$/.test(key)) {
                        indexedReads += 1;
                    }
                    return Reflect.get(target, key, receiver);
                },
            }
        );

        await expect(readRequiredProviderConfig(keys)).rejects.toBeInstanceOf(
            ProviderConfigReadError
        );
        expect(indexedReads).toBe(0);
        expect(readMultipleResultStrict).not.toHaveBeenCalled();
    });

    it.each([
        ['null result', () => null],
        ['empty result', () => ({})],
        ['null values', () => createAuthoritativeResult(null)],
        ['array values', () => createAuthoritativeResult([])],
        [
            'non-array failedAreas',
            () => {
                const result = createAuthoritativeResult({
                    openaiApiKey: 'present',
                });
                result.failedAreas = 'none';
                return result;
            },
        ],
        [
            'null areas',
            () => {
                const result = createAuthoritativeResult({
                    openaiApiKey: 'present',
                });
                result.areas = null;
                return result;
            },
        ],
    ])(
        'normalizes a malformed strict-read result: %s',
        async (_label, makeResult) => {
            readMultipleResultStrict.mockResolvedValue(makeResult());

            await expect(
                readRequiredProviderConfig(['openaiApiKey'])
            ).rejects.toBeInstanceOf(ProviderConfigReadError);
        }
    );

    it('keeps credentials, raw storage text, and caller text out of public error surfaces', async () => {
        const rawStorageText = 'sync unavailable: credential=raw-secret-value';
        const storageFailure = new Error(rawStorageText);
        readMultipleResultStrict.mockRejectedValue(storageFailure);

        let error;
        try {
            await readRequiredProviderConfig(['openaiApiKey', 'openaiBaseUrl']);
        } catch (caughtError) {
            error = caughtError;
        }

        expect(error).toBeInstanceOf(ProviderConfigReadError);
        expect(isRetryableContextError(error)).toBe(false);
        expect(error.message).toBe(
            'Required provider configuration is unavailable'
        );
        expect(error.cause).toBe(storageFailure);
        expect(Object.getOwnPropertyDescriptor(error, 'cause')).toMatchObject({
            enumerable: false,
            value: storageFailure,
        });
        for (const rendered of [
            error.message,
            String(error),
            JSON.stringify(error),
        ]) {
            expect(rendered).not.toContain(rawStorageText);
            expect(rendered).not.toContain('raw-secret-value');
            expect(rendered).not.toContain('openaiApiKey');
            expect(rendered).not.toContain('openaiBaseUrl');
        }

        const callerText = 'unknown-caller-secret-text';
        try {
            await readRequiredProviderConfig([callerText]);
        } catch (callerError) {
            expect(callerError.message).not.toContain(callerText);
            expect(String(callerError)).not.toContain(callerText);
            expect(JSON.stringify(callerError)).not.toContain(callerText);
        }
    });

    it('normalizes a hostile rejected value without inspecting its prototype', async () => {
        const rawStorageText =
            'storage-stack: openaiApiKey=hostile-provider-secret';
        let prototypeReads = 0;
        const hostileCause = new Proxy(Object.create(null), {
            getPrototypeOf() {
                prototypeReads += 1;
                throw new Error(rawStorageText);
            },
        });
        readMultipleResultStrict.mockRejectedValue(hostileCause);

        let error;
        try {
            await readRequiredProviderConfig(['openaiApiKey']);
        } catch (caughtError) {
            error = caughtError;
        }

        expect(error).toBeInstanceOf(ProviderConfigReadError);
        expect(error).toMatchObject({
            name: 'ProviderConfigReadError',
            code: 'PROVIDER_CONFIG_READ_FAILED',
            retryable: false,
            shouldRetry: false,
        });
        expect(error.cause).toBe(hostileCause);
        const causeDescriptor = Object.getOwnPropertyDescriptor(error, 'cause');
        expect(causeDescriptor.value).toBe(hostileCause);
        expect(causeDescriptor.enumerable).toBe(false);
        expect(causeDescriptor.configurable).toBe(true);
        expect(causeDescriptor.writable).toBe(true);
        expect(prototypeReads).toBe(0);
        expect(readMultipleResultStrict).toHaveBeenCalledTimes(1);

        for (const rendered of [
            error.message,
            String(error),
            error.stack,
            JSON.stringify(error),
        ]) {
            expect(rendered).not.toContain(rawStorageText);
            expect(rendered).not.toContain('hostile-provider-secret');
            expect(rendered).not.toContain('openaiApiKey');
        }
    });
});
