import { jest } from '@jest/globals';
import { testDeepLConnection } from './deepl-api.js';

describe('DeepL API connection test', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test('rejects a missing API key without making a request', async () => {
        await expect(testDeepLConnection('', 'free')).resolves.toEqual(
            expect.objectContaining({
                success: false,
                error: 'API_KEY_MISSING',
            })
        );
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('uses the selected endpoint and returns the translated text', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                translations: [{ text: 'Hola' }],
            }),
        });

        await expect(
            testDeepLConnection('secret', 'pro', 'Hello', 'ES')
        ).resolves.toEqual(
            expect.objectContaining({
                success: true,
                translatedText: 'Hola',
            })
        );
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.deepl.com/v2/translate',
            expect.objectContaining({
                method: 'POST',
                body: 'text=Hello&target_lang=ES',
            })
        );
    });

    test('normalizes HTTP failures for the UI', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 403,
            json: jest.fn().mockResolvedValue({ message: 'Forbidden' }),
        });

        await expect(testDeepLConnection('invalid', 'free')).resolves.toEqual(
            expect.objectContaining({
                success: false,
                error: 'HTTP_403',
                message: 'Forbidden',
            })
        );
    });
});
