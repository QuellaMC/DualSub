import { jest } from '@jest/globals';
import { isRetryableContextError } from './retryPolicy.js';

const readMultipleResultStrict = jest.fn();

jest.unstable_mockModule('../services/configService.js', () => ({
    configService: { readMultipleResultStrict },
}));

const { readRequiredProviderConfig } = await import('./providerConfig.js');

describe('required provider configuration', () => {
    beforeEach(() => {
        readMultipleResultStrict.mockReset();
    });

    it('returns the values from one sensitive strict read', async () => {
        const keys = ['openaiApiKey', 'openaiModel'];
        const values = {
            openaiApiKey: 'provider-key',
            openaiModel: 'provider-model',
        };
        readMultipleResultStrict.mockResolvedValue({ values });

        await expect(readRequiredProviderConfig(keys)).resolves.toBe(values);
        expect(readMultipleResultStrict).toHaveBeenCalledTimes(1);
        expect(readMultipleResultStrict).toHaveBeenCalledWith(keys, {
            includeSensitive: true,
        });
    });

    it('leaves semantic validation of present values to the provider', async () => {
        const values = { geminiApiKey: '', aiContextTimeout: 0 };
        readMultipleResultStrict.mockResolvedValue({ values });

        await expect(
            readRequiredProviderConfig(['geminiApiKey', 'aiContextTimeout'])
        ).resolves.toBe(values);
    });

    it('fails closed when a required value is missing', async () => {
        readMultipleResultStrict.mockResolvedValue({
            values: { openaiApiKey: 'provider-key' },
        });

        await expect(
            readRequiredProviderConfig(['openaiApiKey', 'openaiModel'])
        ).rejects.toMatchObject({
            message: 'Required provider configuration is unavailable',
        });
    });

    it('normalizes strict-read failures without making them retryable', async () => {
        const storageFailure = new Error('storage failed with provider-secret');
        readMultipleResultStrict.mockRejectedValue(storageFailure);

        let error;
        try {
            await readRequiredProviderConfig(['openaiApiKey']);
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({
            message: 'Required provider configuration is unavailable',
        });
        expect(isRetryableContextError(error)).toBe(false);
        expect(error).not.toHaveProperty('cause');
        expect(error.message).not.toContain('provider-secret');
    });
});
