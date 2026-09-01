import { describe, expect, it, jest } from '@jest/globals';
import { configService } from './configService.js';

function expectNoStorageWrites() {
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
}

describe('ConfigService write validation', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('stores and returns a canonical value for a single setting', async () => {
        await expect(
            configService.set('targetLanguage', 'EN-us')
        ).resolves.toBe('en-US');

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            { targetLanguage: 'en-US' },
            expect.any(Function)
        );
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('rejects invalid input without writing or logging its raw value', async () => {
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

    it('detaches a collection from both the input and persisted acknowledgement', async () => {
        const contextTypes = ['cultural'];

        const canonicalValue = await configService.set(
            'aiContextTypes',
            contextTypes
        );
        const stored = chrome.storage.sync.set.mock.calls[0][0].aiContextTypes;
        contextTypes[0] = 'invalid-after-write';

        expect(stored).toEqual(['cultural']);
        expect(stored).not.toBe(contextTypes);
        expect(canonicalValue).toEqual(['cultural']);
        expect(canonicalValue).not.toBe(stored);
    });

    it('canonicalizes and acknowledges every value in a batch write', async () => {
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

    it('keeps persisted batch authority when the logger refresh fails', async () => {
        const rejectedDetail = 'logger-refresh-private-detail';
        jest.spyOn(configService.logger, 'updateLevel').mockRejectedValue(
            new Error(rejectedDetail)
        );
        const errorLog = jest.spyOn(configService.logger, 'error');

        await expect(
            configService.setMultiple({ loggingLevel: 1, uiLanguage: 'es' })
        ).resolves.toEqual({ loggingLevel: 1, uiLanguage: 'es' });

        expect(chrome.storage.sync.set).toHaveBeenCalledWith(
            { loggingLevel: 1, uiLanguage: 'es' },
            expect.any(Function)
        );
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

    it.each([
        ['local', true],
        ['sync', false],
    ])(
        'updates logging only when its sync write persists before a %s failure',
        async (failedArea, shouldUpdate) => {
            chrome.storage[failedArea].set.mockImplementationOnce(
                (_items, callback) => {
                    chrome.runtime.lastError = {
                        message: `${failedArea} unavailable`,
                    };
                    callback();
                    chrome.runtime.lastError = null;
                }
            );
            const updateLevel = jest
                .spyOn(configService.logger, 'updateLevel')
                .mockResolvedValue();

            await expect(
                configService.setMultiple({
                    loggingLevel: 4,
                    openaiCompatibleApiKey: 'local-secret',
                })
            ).rejects.toMatchObject({ partialFailure: true });

            if (shouldUpdate) {
                expect(updateLevel).toHaveBeenCalledTimes(1);
                expect(updateLevel).toHaveBeenCalledWith(4);
            } else {
                expect(updateLevel).not.toHaveBeenCalled();
            }
        }
    );

    it('rejects an invalid batch without persisting or logging valid sensitive values', async () => {
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
});
