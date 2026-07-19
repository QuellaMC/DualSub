import { jest } from '@jest/globals';
import { getDefaultValue } from '../config/configSchema.js';
import { ConfigServiceReadError, configService } from './configService.js';

describe('ConfigService stored-value validation', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns undefined for a hostile non-string get key without coercion', async () => {
        const secret = 'hostile-get-key-must-not-leak';
        let coercionReads = 0;
        const hostileKey = {};
        Object.defineProperty(hostileKey, Symbol.toPrimitive, {
            get() {
                coercionReads += 1;
                throw new Error(secret);
            },
        });
        const debugLog = jest.spyOn(configService.logger, 'debug');
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(configService.get(hostileKey)).resolves.toBeUndefined();

        expect(coercionReads).toBe(0);
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
        expect(JSON.stringify(debugLog.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('returns a prepared stored value without writing during a regular read', async () => {
        jest.spyOn(configService, 'getFromStorage').mockResolvedValue({
            targetLanguage: 'EN-us',
        });
        const setToStorage = jest.spyOn(configService, 'setToStorage');

        await expect(configService.get('targetLanguage')).resolves.toBe(
            'en-US'
        );
        expect(setToStorage).not.toHaveBeenCalled();
    });

    it('detaches a collection returned by a single read', async () => {
        const contextTypes = ['cultural'];
        jest.spyOn(configService, 'getFromStorage').mockResolvedValue({
            aiContextTypes: contextTypes,
        });

        const result = await configService.get('aiContextTypes');
        contextTypes[0] = 'attacker-controlled-invalid';

        expect(result).toEqual(['cultural']);
        expect(result).not.toBe(contextTypes);
    });

    it('resolves descriptor-safe storage results without enumerating them', async () => {
        const secret = 'storage-callback-own-keys-token-must-not-leak';
        const syncItems = new Proxy(
            { targetLanguage: 'EN-us' },
            {
                ownKeys() {
                    throw new Error(secret);
                },
            }
        );
        chrome.storage.sync.get.mockImplementation((_keys, callback) => {
            callback(syncItems);
        });
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(configService.get('targetLanguage')).resolves.toBe(
            'en-US'
        );
        expect(chrome.storage.sync.get).toHaveBeenCalledWith(
            ['targetLanguage'],
            expect.any(Function)
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('returns prepared values through multiple and result-oriented reads', async () => {
        jest.spyOn(configService, 'getFromStorage').mockResolvedValue({
            targetLanguage: 'EN-us',
            openaiCompatibleBaseUrl: 'https://MODELS.EXAMPLE.TEST:443/v1///',
        });
        const setToStorage = jest.spyOn(configService, 'setToStorage');

        await expect(
            configService.getMultiple([
                'targetLanguage',
                'openaiCompatibleBaseUrl',
            ])
        ).resolves.toEqual({
            targetLanguage: 'en-US',
            openaiCompatibleBaseUrl: 'https://models.example.test/v1',
        });

        await expect(
            configService.readResult('targetLanguage')
        ).resolves.toEqual(
            expect.objectContaining({
                values: expect.objectContaining({ targetLanguage: 'en-US' }),
                sources: expect.objectContaining({
                    targetLanguage: {
                        scope: 'sync',
                        source: 'stored',
                    },
                }),
            })
        );

        await expect(
            configService.readMultipleResult([
                'targetLanguage',
                'openaiCompatibleBaseUrl',
            ])
        ).resolves.toEqual(
            expect.objectContaining({
                values: expect.objectContaining({
                    targetLanguage: 'en-US',
                    openaiCompatibleBaseUrl: 'https://models.example.test/v1',
                }),
            })
        );
        expect(setToStorage).not.toHaveBeenCalled();
    });

    it('rejects a custom key iterator without coercing yielded objects', async () => {
        const secret = 'custom-key-iterator-must-not-leak';
        let coercionReads = 0;
        const hostileKey = {};
        Object.defineProperty(hostileKey, Symbol.toPrimitive, {
            get() {
                coercionReads += 1;
                throw new Error(secret);
            },
        });
        const keys = ['uiLanguage'];
        Object.defineProperty(keys, Symbol.iterator, {
            value: function* customIterator() {
                yield hostileKey;
            },
        });

        await expect(configService.getMultiple(keys)).rejects.toThrow(
            'ConfigService getMultiple requires an array of string keys'
        );
        await expect(configService.readMultipleResult(keys)).rejects.toThrow(
            'ConfigService result reads require an array of string keys'
        );
        expect(coercionReads).toBe(0);
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('rejects malformed key-array shapes without invoking indexed accessors', async () => {
        let accessorReads = 0;

        const sparseKeys = new Array(1);

        const accessorKeys = [];
        Object.defineProperty(accessorKeys, '0', {
            enumerable: true,
            configurable: true,
            get() {
                accessorReads += 1;
                return 'uiLanguage';
            },
        });

        const inheritedIndexPrototype = Object.create(Array.prototype);
        Object.defineProperty(inheritedIndexPrototype, '0', {
            enumerable: true,
            get() {
                accessorReads += 1;
                return 'uiLanguage';
            },
        });
        const inheritedIndexKeys = new Array(1);
        Object.setPrototypeOf(inheritedIndexKeys, inheritedIndexPrototype);

        const symbolExtraKeys = ['uiLanguage'];
        Object.defineProperty(symbolExtraKeys, Symbol('extra'), {
            value: 'targetLanguage',
            enumerable: true,
        });

        const stringExtraKeys = ['uiLanguage'];
        Object.defineProperty(stringExtraKeys, 'extra', {
            value: 'targetLanguage',
            enumerable: true,
        });

        const nonEnumerableIndexKeys = ['uiLanguage'];
        Object.defineProperty(nonEnumerableIndexKeys, '0', {
            value: 'uiLanguage',
            enumerable: false,
        });

        const malformedKeyArrays = [
            sparseKeys,
            accessorKeys,
            inheritedIndexKeys,
            symbolExtraKeys,
            stringExtraKeys,
            nonEnumerableIndexKeys,
        ];

        for (const keys of malformedKeyArrays) {
            await expect(configService.getMultiple(keys)).rejects.toThrow(
                'ConfigService getMultiple requires an array of string keys'
            );
            await expect(
                configService.readMultipleResult(keys)
            ).rejects.toThrow(
                'ConfigService result reads require an array of string keys'
            );
        }

        expect(accessorReads).toBe(0);
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('rejects non-string keys without coercing their values', async () => {
        const secret = 'non-string-key-coercion-must-not-leak';
        let coercionReads = 0;
        const hostileKey = {};
        Object.defineProperty(hostileKey, Symbol.toPrimitive, {
            get() {
                coercionReads += 1;
                throw new Error(secret);
            },
        });
        const symbolKey = Symbol('uiLanguage');

        await expect(configService.getMultiple([hostileKey])).rejects.toThrow(
            'ConfigService getMultiple requires an array of string keys'
        );
        await expect(configService.getMultiple([symbolKey])).rejects.toThrow(
            'ConfigService getMultiple requires an array of string keys'
        );
        await expect(configService.readResult(hostileKey)).rejects.toThrow(
            'ConfigService result reads require an array of string keys'
        );
        await expect(
            configService.readMultipleResult([symbolKey])
        ).rejects.toThrow(
            'ConfigService result reads require an array of string keys'
        );

        expect(coercionReads).toBe(0);
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('detaches getMultiple collections before later descriptor side effects', async () => {
        const contextTypes = ['cultural'];
        const storedItems = new Proxy(
            {
                aiContextTypes: contextTypes,
                uiLanguage: 'es',
            },
            {
                getOwnPropertyDescriptor(target, key) {
                    if (key === 'uiLanguage') {
                        contextTypes[0] = 'attacker-controlled-invalid';
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            }
        );
        jest.spyOn(configService, 'getFromStorage').mockResolvedValue(
            storedItems
        );

        await expect(
            configService.getMultiple(['aiContextTypes', 'uiLanguage'])
        ).resolves.toEqual({
            aiContextTypes: ['cultural'],
            uiLanguage: 'es',
        });
        expect(contextTypes).toEqual(['attacker-controlled-invalid']);
    });

    it('omits prototype-name keys while preserving valid duplicates', async () => {
        const getFromStorage = jest
            .spyOn(configService, 'getFromStorage')
            .mockResolvedValue({ uiLanguage: 'es' });

        const result = await configService.getMultiple([
            '__proto__',
            'constructor',
            'uiLanguage',
            'toString',
            'uiLanguage',
        ]);

        expect(result).toEqual({ uiLanguage: 'es' });
        expect(Object.hasOwn(result, '__proto__')).toBe(false);
        expect(Object.hasOwn(result, 'constructor')).toBe(false);
        expect(Object.hasOwn(result, 'toString')).toBe(false);
        expect(getFromStorage).toHaveBeenCalledTimes(1);
        expect(getFromStorage).toHaveBeenCalledWith(
            'sync',
            ['uiLanguage', 'uiLanguage'],
            expect.objectContaining({ method: 'getMultiple' })
        );
    });

    it('keeps healthy getAll values when raw storage enumeration is hostile', async () => {
        const secret = 'get-all-own-keys-token-must-not-leak';
        const syncItems = new Proxy(
            {
                uiLanguage: 'es',
                targetLanguage: 'EN-us',
            },
            {
                ownKeys() {
                    throw new Error(secret);
                },
            }
        );
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (area) => (area === 'sync' ? syncItems : {})
        );
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(configService.getAll()).resolves.toMatchObject({
            uiLanguage: 'es',
            targetLanguage: 'en-US',
        });
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('evaluates getAll sensitive access once through the strict read seam', async () => {
        let sensitiveDescriptorReads = 0;
        const options = new Proxy(
            { includeSensitive: true },
            {
                getOwnPropertyDescriptor(target, key) {
                    if (key === 'includeSensitive') {
                        sensitiveDescriptorReads += 1;
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            }
        );
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) =>
                Object.fromEntries(
                    keys.map((key) => [
                        key,
                        key === 'openaiApiKey'
                            ? 'explicit-sensitive-value'
                            : getDefaultValue(key),
                    ])
                )
        );

        const config = await configService.getAll(options);

        expect(config.openaiApiKey).toBe('explicit-sensitive-value');
        expect(sensitiveDescriptorReads).toBe(1);
    });

    it('rejects getAll without values when both storage areas fail', async () => {
        const syncFailure = new Error('sync unavailable');
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (area) => {
                throw area === 'sync'
                    ? syncFailure
                    : new Error('local unavailable');
            }
        );

        const error = await configService.getAll().catch((caught) => caught);

        expect(error).toBeInstanceOf(ConfigServiceReadError);
        expect(error.failedAreas).toEqual(['sync', 'local']);
        expect(error.cause).toBe(syncFailure);
        expect(error).not.toHaveProperty('values');
        expect(error).not.toHaveProperty('uiLanguage');
        expect(error).not.toHaveProperty('debugMode');
    });

    it('returns canonical stored values and schema defaults after healthy reads', async () => {
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (area) =>
                area === 'sync'
                    ? {
                          uiLanguage: 'invalid-locale',
                          targetLanguage: 'EN-us',
                      }
                    : {}
        );

        await expect(configService.getAll()).resolves.toMatchObject({
            uiLanguage: getDefaultValue('uiLanguage'),
            targetLanguage: 'en-US',
            debugMode: getDefaultValue('debugMode'),
        });
    });

    it('detaches getAll collections before later descriptor side effects', async () => {
        const subtitleBlacklist = { netflix: ['rule'] };
        const syncItems = new Proxy(
            {
                subtitleBlacklist,
                aiContextEnabled: true,
            },
            {
                getOwnPropertyDescriptor(target, key) {
                    if (key === 'aiContextEnabled') {
                        subtitleBlacklist.netflix[0] = '';
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            }
        );
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (area) => (area === 'sync' ? syncItems : {})
        );

        const result = await configService.getAll();

        expect(subtitleBlacklist).toEqual({ netflix: [''] });
        expect(result.subtitleBlacklist).toEqual({ netflix: ['rule'] });
        expect(result.subtitleBlacklist).not.toBe(subtitleBlacklist);
    });

    it('falls back when a stored scalar has the wrong type or range', async () => {
        jest.spyOn(configService, 'getFromStorage').mockResolvedValue({
            loggingLevel: 99,
        });

        await expect(configService.get('loggingLevel')).resolves.toBe(3);
    });

    it('fails closed on inherited, accessor, and proxy-backed stored values', async () => {
        const secret = 'access-token-should-never-leak';
        let getterReads = 0;
        const inheritedValues = {};
        Object.defineProperty(inheritedValues, 'targetLanguage', {
            enumerable: true,
            get() {
                getterReads += 1;
                return secret;
            },
        });
        const inherited = Object.create(inheritedValues);
        const accessor = {};
        Object.defineProperty(accessor, 'targetLanguage', {
            enumerable: true,
            get() {
                getterReads += 1;
                return secret;
            },
        });
        const descriptorProxy = new Proxy(
            {},
            {
                getOwnPropertyDescriptor() {
                    throw new Error(secret);
                },
            }
        );
        const valueProxy = new Proxy([], {
            getPrototypeOf() {
                throw new Error(secret);
            },
        });
        jest.spyOn(configService, 'getFromStorage')
            .mockResolvedValueOnce(inherited)
            .mockResolvedValueOnce(accessor)
            .mockResolvedValueOnce(descriptorProxy)
            .mockResolvedValueOnce({ subtitleBlacklist: valueProxy });
        const setToStorage = jest.spyOn(configService, 'setToStorage');
        const debugLog = jest.spyOn(configService.logger, 'debug');
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(configService.get('targetLanguage')).resolves.toBe(
            getDefaultValue('targetLanguage')
        );
        await expect(configService.get('targetLanguage')).resolves.toBe(
            getDefaultValue('targetLanguage')
        );
        await expect(configService.get('targetLanguage')).resolves.toBe(
            getDefaultValue('targetLanguage')
        );
        await expect(configService.get('subtitleBlacklist')).resolves.toEqual(
            getDefaultValue('subtitleBlacklist')
        );

        expect(getterReads).toBe(0);
        expect(setToStorage).not.toHaveBeenCalled();
        expect(JSON.stringify(debugLog.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('validates every value returned by getMultiple', async () => {
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) =>
                Object.fromEntries(
                    keys.map((key) => {
                        const values = {
                            uiLanguage: 'es',
                            aiContextTypes: { cultural: true },
                            subtitleBlacklist: [],
                        };
                        return [key, values[key]];
                    })
                )
        );

        await expect(
            configService.getMultiple([
                'uiLanguage',
                'aiContextTypes',
                'subtitleBlacklist',
            ])
        ).resolves.toEqual({
            uiLanguage: 'es',
            aiContextTypes: ['cultural', 'historical', 'linguistic'],
            subtitleBlacklist: getDefaultValue('subtitleBlacklist'),
        });
    });

    it.each([
        {
            failedArea: 'local',
            storedValues: { uiLanguage: 'es' },
        },
        {
            failedArea: 'sync',
            storedValues: { debugMode: true },
        },
    ])(
        'rejects getAll without mixed/default values when the $failedArea read fails',
        async ({ failedArea, storedValues }) => {
            const storageFailure = new Error(`${failedArea} unavailable`);
            jest.spyOn(configService, 'getFromStorage').mockImplementation(
                async (area) => {
                    if (area === failedArea) {
                        throw storageFailure;
                    }
                    return storedValues;
                }
            );

            const error = await configService
                .getAll()
                .catch((caught) => caught);

            expect(error).toBeInstanceOf(ConfigServiceReadError);
            expect(error.failedAreas).toEqual([failedArea]);
            expect(error.cause).toBe(storageFailure);
            expect(error).not.toHaveProperty('values');
            expect(error).not.toHaveProperty('uiLanguage');
            expect(error).not.toHaveProperty('debugMode');
        }
    );

    it('repairs a noncanonical stored value once without rewriting exact defaults', async () => {
        let canonicalValuePersisted = false;
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) => {
                const stored = Object.fromEntries(
                    keys.map((key) => [key, getDefaultValue(key)])
                );
                if (keys.includes('targetLanguage')) {
                    stored.targetLanguage = canonicalValuePersisted
                        ? 'en-US'
                        : 'EN-us';
                }
                return stored;
            }
        );
        const setToStorage = jest
            .spyOn(configService, 'setToStorage')
            .mockImplementation(async (_area, values) => {
                if (values.targetLanguage === 'en-US') {
                    canonicalValuePersisted = true;
                }
            });

        await configService.setDefaultsForMissingKeys();
        await configService.setDefaultsForMissingKeys();

        expect(setToStorage).toHaveBeenCalledTimes(1);
        expect(setToStorage).toHaveBeenCalledWith(
            'sync',
            { targetLanguage: 'en-US' },
            expect.objectContaining({
                operation: 'initialization-set-sync',
            })
        );
    });

    it('repairs invalid persisted values during startup default verification', async () => {
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) => {
                const stored = Object.fromEntries(
                    keys.map((key) => [key, getDefaultValue(key)])
                );
                if (keys.includes('loggingLevel')) {
                    stored.loggingLevel = Number.NaN;
                }
                return stored;
            }
        );
        const setToStorage = jest
            .spyOn(configService, 'setToStorage')
            .mockResolvedValue();

        await configService.setDefaultsForMissingKeys();

        expect(setToStorage).toHaveBeenCalledTimes(1);
        expect(setToStorage).toHaveBeenCalledWith(
            'sync',
            { loggingLevel: 3 },
            expect.objectContaining({
                operation: 'initialization-set-sync',
            })
        );
    });

    it('never repairs a storage area whose startup read failed', async () => {
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (area, keys) => {
                if (area === 'sync') {
                    throw new Error('sync unavailable');
                }

                const stored = Object.fromEntries(
                    keys.map((key) => [key, getDefaultValue(key)])
                );
                stored.debugMode = 'invalid';
                return stored;
            }
        );
        const setToStorage = jest
            .spyOn(configService, 'setToStorage')
            .mockResolvedValue();

        await expect(
            configService.setDefaultsForMissingKeys()
        ).resolves.toBeUndefined();

        expect(setToStorage).toHaveBeenCalledTimes(1);
        expect(setToStorage).toHaveBeenCalledWith(
            'local',
            { debugMode: false },
            expect.objectContaining({
                operation: 'initialization-set-local',
            })
        );
        expect(setToStorage).not.toHaveBeenCalledWith(
            'sync',
            expect.anything(),
            expect.anything()
        );
    });

    it('repairs an inaccessible stored property without leaking its proxy error', async () => {
        const secret = 'opaque-proxy-token-must-not-leak';
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (area, keys) => {
                const stored = Object.fromEntries(
                    keys.map((key) => [key, getDefaultValue(key)])
                );
                if (area !== 'sync') return stored;

                return new Proxy(stored, {
                    getOwnPropertyDescriptor(target, key) {
                        if (key === 'targetLanguage') {
                            throw new Error(secret);
                        }
                        return Reflect.getOwnPropertyDescriptor(target, key);
                    },
                });
            }
        );
        const setToStorage = jest
            .spyOn(configService, 'setToStorage')
            .mockResolvedValue();
        const errorLog = jest.spyOn(configService.logger, 'error');

        await configService.setDefaultsForMissingKeys();

        expect(setToStorage).toHaveBeenCalledTimes(1);
        expect(setToStorage).toHaveBeenCalledWith(
            'sync',
            { targetLanguage: getDefaultValue('targetLanguage') },
            expect.objectContaining({
                operation: 'initialization-set-sync',
            })
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });
});
