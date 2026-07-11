import { jest } from '@jest/globals';
import { configService } from '../services/configService.js';
import { translate } from './deeplTranslate.js';

describe('DeepL translation configuration', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        jest.restoreAllMocks();
        global.fetch = originalFetch;
    });

    it('uses the device-local API key resolved by ConfigService', async () => {
        const getFromStorage = jest
            .spyOn(configService, 'getFromStorage')
            .mockImplementation(async (area) =>
                area === 'local'
                    ? { deeplApiKey: 'device-local-key' }
                    : { deeplApiPlan: 'pro' }
            );
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                translations: [{ text: 'Hola' }],
            }),
        });

        await expect(translate('Hello', 'en', 'es')).resolves.toBe('Hola');

        expect(getFromStorage).toHaveBeenCalledWith(
            'local',
            ['deeplApiKey'],
            expect.any(Object)
        );
        expect(getFromStorage).toHaveBeenCalledWith(
            'sync',
            ['deeplApiPlan'],
            expect.any(Object)
        );
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.deepl.com/v2/translate',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'DeepL-Auth-Key device-local-key',
                }),
            })
        );
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
    });
});
