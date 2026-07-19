import { describe, expect, it, jest } from '@jest/globals';
import { configService } from './configService.js';

function expectNoStorageWrites() {
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
}

describe('ConfigService write key validation', () => {
    it('stores a canonical language tag for a single setting', async () => {
        await expect(
            configService.set('targetLanguage', 'EN-us')
        ).resolves.toBe('en-US');

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            { targetLanguage: 'en-US' },
            expect.any(Function)
        );
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('stores an allowed provider base URL without trailing slashes', async () => {
        await expect(
            configService.set(
                'openaiCompatibleBaseUrl',
                'https://MODELS.EXAMPLE.TEST:443/v1///'
            )
        ).resolves.toBe('https://models.example.test/v1');

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            { openaiCompatibleBaseUrl: 'https://models.example.test/v1' },
            expect.any(Function)
        );
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('uses a fixed validation failure without logging rejected raw input', async () => {
        const secret = 'provider-token-must-not-leak';
        const rawValue = `https://models.example.test/v1?access_token=${secret}`;
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(
            configService.set('openaiCompatibleBaseUrl', rawValue)
        ).rejects.toThrow(
            'Invalid value for key "openaiCompatibleBaseUrl". Expected type: String'
        );

        expectNoStorageWrites();
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(rawValue);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('applies a prepared logging level directly after a single write', async () => {
        const configRead = jest
            .spyOn(configService, 'get')
            .mockRejectedValue(new Error('transient read failure'));
        const updateLevel = jest.spyOn(configService.logger, 'updateLevel');
        configService.logger.currentLevel = 3;

        await expect(configService.set('loggingLevel', 4)).resolves.toBe(4);

        expect(updateLevel).toHaveBeenCalledTimes(1);
        expect(updateLevel).toHaveBeenCalledWith(4);
        expect(configRead).not.toHaveBeenCalled();
        expect(configService.logger.currentLevel).toBe(4);
    });

    it('returns a persisted logging level when the logger refresh rejects', async () => {
        const rejectedDetail = 'logger-refresh-private-detail';
        const updateLevel = jest
            .spyOn(configService.logger, 'updateLevel')
            .mockRejectedValue(new Error(rejectedDetail));
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(configService.set('loggingLevel', 4)).resolves.toBe(4);

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            { loggingLevel: 4 },
            expect.any(Function)
        );
        expect(updateLevel).toHaveBeenCalledTimes(1);
        expect(errorLog).toHaveBeenCalledWith(
            'Failed to update logging level after persisted configuration write',
            null,
            {
                method: 'set',
                category: 'update-failed',
            }
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
            rejectedDetail
        );
    });

    it('detaches a prepared collection for a single write', async () => {
        const contextTypes = ['cultural'];

        const canonicalValue = await configService.set(
            'aiContextTypes',
            contextTypes
        );
        contextTypes[0] = 'attacker-controlled-invalid';

        const stored = chrome.storage.sync.set.mock.calls[0][0];
        expect(stored.aiContextTypes).toEqual(['cultural']);
        expect(stored.aiContextTypes).not.toBe(contextTypes);
        expect(canonicalValue).toEqual(['cultural']);
        expect(canonicalValue).not.toBe(stored.aiContextTypes);
    });

    it('canonicalizes every prepared sync value in a batch write', async () => {
        await expect(
            configService.setMultiple({
                targetLanguage: 'EN-us',
                originalLanguage: 'ZH-hant-tw',
                openaiCompatibleBaseUrl:
                    'https://MODELS.EXAMPLE.TEST:443/v1///',
            })
        ).resolves.toEqual({
            targetLanguage: 'en-US',
            originalLanguage: 'zh-Hant-TW',
            openaiCompatibleBaseUrl: 'https://models.example.test/v1',
        });

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            {
                targetLanguage: 'en-US',
                originalLanguage: 'zh-Hant-TW',
                openaiCompatibleBaseUrl: 'https://models.example.test/v1',
            },
            expect.any(Function)
        );
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('detaches a prepared array before inspecting later batch descriptors', async () => {
        const contextTypes = ['cultural'];
        let laterDescriptorReads = 0;
        const target = {
            aiContextTypes: contextTypes,
            uiLanguage: 'es',
        };
        const settings = new Proxy(target, {
            getOwnPropertyDescriptor(object, key) {
                if (key === 'uiLanguage') {
                    laterDescriptorReads += 1;
                    if (laterDescriptorReads > 1) {
                        contextTypes[0] = 'attacker-controlled-invalid';
                    }
                }
                return Reflect.getOwnPropertyDescriptor(object, key);
            },
        });

        await configService.setMultiple(settings);

        const stored = chrome.storage.sync.set.mock.calls[0][0];
        expect(contextTypes).toEqual(['attacker-controlled-invalid']);
        expect(stored.aiContextTypes).toEqual(['cultural']);
        expect(stored.aiContextTypes).not.toBe(contextTypes);
    });

    it('deeply detaches a prepared object before later descriptor side effects', async () => {
        const subtitleBlacklist = { netflix: ['rule'] };
        let laterDescriptorReads = 0;
        const target = {
            subtitleBlacklist,
            uiLanguage: 'es',
        };
        const settings = new Proxy(target, {
            getOwnPropertyDescriptor(object, key) {
                if (key === 'uiLanguage') {
                    laterDescriptorReads += 1;
                    if (laterDescriptorReads > 1) {
                        subtitleBlacklist.netflix[0] = '';
                    }
                }
                return Reflect.getOwnPropertyDescriptor(object, key);
            },
        });

        const canonicalValues = await configService.setMultiple(settings);

        const stored = chrome.storage.sync.set.mock.calls[0][0];
        expect(subtitleBlacklist).toEqual({ netflix: [''] });
        expect(stored.subtitleBlacklist).toEqual({ netflix: ['rule'] });
        expect(stored.subtitleBlacklist).not.toBe(subtitleBlacklist);
        expect(stored.subtitleBlacklist.netflix).not.toBe(
            subtitleBlacklist.netflix
        );
        expect(canonicalValues).toEqual({
            subtitleBlacklist: { netflix: ['rule'] },
            uiLanguage: 'es',
        });
        expect(canonicalValues.subtitleBlacklist).not.toBe(
            stored.subtitleBlacklist
        );
        expect(canonicalValues.subtitleBlacklist.netflix).not.toBe(
            stored.subtitleBlacklist.netflix
        );
    });

    it('applies a prepared logging level directly after a batch write', async () => {
        const configRead = jest
            .spyOn(configService, 'get')
            .mockRejectedValue(new Error('transient read failure'));
        const updateLevel = jest.spyOn(configService.logger, 'updateLevel');
        configService.logger.currentLevel = 3;

        await expect(
            configService.setMultiple({ loggingLevel: 1, uiLanguage: 'es' })
        ).resolves.toEqual({ loggingLevel: 1, uiLanguage: 'es' });

        expect(updateLevel).toHaveBeenCalledTimes(1);
        expect(updateLevel).toHaveBeenCalledWith(1);
        expect(configRead).not.toHaveBeenCalled();
        expect(configService.logger.currentLevel).toBe(1);
    });

    it('returns persisted batch values when the logger refresh throws', async () => {
        const rejectedDetail = 'logger-refresh-private-detail';
        const updateLevel = jest
            .spyOn(configService.logger, 'updateLevel')
            .mockImplementation(() => {
                throw new Error(rejectedDetail);
            });
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(
            configService.setMultiple({ loggingLevel: 1, uiLanguage: 'es' })
        ).resolves.toEqual({ loggingLevel: 1, uiLanguage: 'es' });

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            { loggingLevel: 1, uiLanguage: 'es' },
            expect.any(Function)
        );
        expect(updateLevel).toHaveBeenCalledTimes(1);
        expect(errorLog).toHaveBeenCalledWith(
            'Failed to update logging level after persisted configuration write',
            null,
            {
                method: 'setMultiple',
                category: 'update-failed',
            }
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
            rejectedDetail
        );
    });

    it('applies loggingLevel when sync succeeds before a local partial failure', async () => {
        chrome.storage.local.set.mockImplementationOnce((_items, callback) => {
            chrome.runtime.lastError = { message: 'local unavailable' };
            callback();
            chrome.runtime.lastError = null;
        });
        const updateLevel = jest
            .spyOn(configService.logger, 'updateLevel')
            .mockResolvedValue();

        await expect(
            configService.setMultiple({
                loggingLevel: 4,
                openaiCompatibleApiKey: 'local-secret',
            })
        ).rejects.toMatchObject({ partialFailure: true });

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            { loggingLevel: 4 },
            expect.any(Function)
        );
        expect(updateLevel).toHaveBeenCalledTimes(1);
        expect(updateLevel).toHaveBeenCalledWith(4);
    });

    it('does not apply loggingLevel when its sync write fails', async () => {
        chrome.storage.sync.set.mockImplementationOnce((_items, callback) => {
            chrome.runtime.lastError = { message: 'sync unavailable' };
            callback();
            chrome.runtime.lastError = null;
        });
        const updateLevel = jest
            .spyOn(configService.logger, 'updateLevel')
            .mockResolvedValue();

        await expect(
            configService.setMultiple({
                loggingLevel: 4,
                openaiCompatibleApiKey: 'local-secret',
            })
        ).rejects.toMatchObject({ partialFailure: true });

        expect(updateLevel).not.toHaveBeenCalled();
    });

    it.each(['__proto__', 'constructor', 'toString'])(
        'rejects prototype-chain key %s before schema access',
        async (key) => {
            await expect(configService.set(key, true)).rejects.toThrow(
                `Invalid key "${key}" provided for set`
            );
            expectNoStorageWrites();
        }
    );

    it('rejects non-string keys without invoking coercion accessors', async () => {
        let accessorReads = 0;
        const hostileKey = {};
        Object.defineProperty(hostileKey, Symbol.toPrimitive, {
            get() {
                accessorReads += 1;
                throw new Error('must not coerce a rejected key');
            },
        });

        await expect(configService.set(hostileKey, true)).rejects.toThrow(
            'Invalid key of type "object" provided for set'
        );
        expect(accessorReads).toBe(0);
        expectNoStorageWrites();
    });

    it('aggregates own prototype-chain keys from a null-prototype batch', async () => {
        const settings = Object.create(null);
        settings.__proto__ = true;
        settings.constructor = true;
        settings.toString = true;
        settings.uiLanguage = 'es';

        await expect(configService.setMultiple(settings)).rejects.toMatchObject(
            {
                validationErrors: [
                    expect.objectContaining({
                        key: '__proto__',
                        type: 'invalid_key',
                    }),
                    expect.objectContaining({
                        key: 'constructor',
                        type: 'invalid_key',
                    }),
                    expect.objectContaining({
                        key: 'toString',
                        type: 'invalid_key',
                    }),
                ],
                totalSettings: 4,
                validSettings: 1,
            }
        );
        expectNoStorageWrites();
    });

    it('rejects own accessor settings without invoking the getter', async () => {
        let accessorReads = 0;
        const settings = {};
        Object.defineProperty(settings, 'uiLanguage', {
            enumerable: true,
            get() {
                accessorReads += 1;
                return 'es';
            },
        });

        await expect(configService.setMultiple(settings)).rejects.toMatchObject(
            {
                validationErrors: [
                    expect.objectContaining({
                        key: 'uiLanguage',
                        type: 'invalid_value',
                        actualType: 'accessor',
                    }),
                ],
            }
        );
        expect(accessorReads).toBe(0);
        expectNoStorageWrites();
    });

    it('does not write or log a valid sensitive value when its batch is invalid', async () => {
        const secret = 'valid-sensitive-token-must-not-leak';
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(
            configService.setMultiple({
                openaiCompatibleApiKey: secret,
                targetLanguage: 'not a language tag',
            })
        ).rejects.toMatchObject({
            validationErrors: [
                expect.objectContaining({
                    key: 'targetLanguage',
                    type: 'invalid_value',
                }),
            ],
        });

        expectNoStorageWrites();
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('normalizes hostile batch proxy failures without leaking sensitive data', async () => {
        const secret = 'raw-access-token-must-not-leak';
        const settings = new Proxy(
            { openaiCompatibleApiKey: secret },
            {
                getOwnPropertyDescriptor() {
                    throw new Error(secret);
                },
            }
        );
        const debugLog = jest.spyOn(configService.logger, 'debug');
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(configService.setMultiple(settings)).rejects.toThrow(
            'Invalid settings provided for setMultiple'
        );

        expectNoStorageWrites();
        expect(JSON.stringify(debugLog.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('fails closed when a batch data descriptor becomes inaccessible', async () => {
        const secret = 'descriptor-token-must-not-leak';
        let descriptorReads = 0;
        const settings = new Proxy(
            { openaiCompatibleApiKey: secret },
            {
                getOwnPropertyDescriptor(target, key) {
                    descriptorReads += 1;
                    if (descriptorReads > 1) {
                        throw new Error(secret);
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            }
        );
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(configService.setMultiple(settings)).rejects.toMatchObject(
            {
                validationErrors: [
                    expect.objectContaining({
                        key: 'openaiCompatibleApiKey',
                        type: 'invalid_value',
                        actualType: 'inaccessible',
                    }),
                ],
            }
        );

        expectNoStorageWrites();
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('ignores inherited settings without invoking accessors', async () => {
        let accessorReads = 0;
        const inheritedSettings = {};
        Object.defineProperty(inheritedSettings, 'loggingLevel', {
            enumerable: true,
            get() {
                accessorReads += 1;
                throw new Error('must not read inherited settings');
            },
        });

        const settings = Object.create(inheritedSettings);
        await expect(configService.setMultiple(settings)).resolves.toEqual({});
        expect(accessorReads).toBe(0);
        expectNoStorageWrites();
    });

    it('accepts valid own data from a null-prototype batch', async () => {
        const settings = Object.create(null);
        settings.uiLanguage = 'es';

        await expect(configService.setMultiple(settings)).resolves.toEqual({
            uiLanguage: 'es',
        });
        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            { uiLanguage: 'es' },
            expect.any(Function)
        );
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
});
