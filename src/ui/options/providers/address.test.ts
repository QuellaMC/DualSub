import { describe, expect, it } from 'vitest';
import { addressChange } from './address';

describe('addressChange', () => {
    it('keeps the key on the same host and clears it for another', () => {
        expect(
            addressChange(
                'openaiCompatibleBaseUrl',
                'https://api.openai.com/v1',
                'https://api.openai.com/v2'
            )
        ).toEqual({ openaiCompatibleBaseUrl: 'https://api.openai.com/v2' });
        expect(
            addressChange(
                'openaiBaseUrl',
                'https://api.openai.com/v1',
                'https://openrouter.ai/api/v1'
            )
        ).toEqual({
            openaiBaseUrl: 'https://openrouter.ai/api/v1',
            openaiApiKey: '',
        });
    });
});
