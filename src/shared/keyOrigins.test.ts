import { describe, expect, it } from 'vitest';
import { keyEntry, originOf, usableCredential } from './keyOrigins';

const ENTERED = {
    openaiApiKey: 'sk-1',
    openaiApiKeyOrigin: 'https://api.openai.com',
    openaiBaseUrl: 'https://api.openai.com/v1',
};

describe('key origins', () => {
    it('reads where an address sends its requests', () => {
        expect(originOf('https://api.openai.com/v1')).toBe(
            'https://api.openai.com'
        );
        expect(originOf('http://localhost:11434/v1')).toBe(
            'http://localhost:11434'
        );
        expect(originOf('not a url')).toBeNull();
    });

    it('uses a key at the origin it was entered for, whatever the path', () => {
        expect(usableCredential('openaiApiKey', ENTERED)).toBe('sk-1');
        expect(
            usableCredential('openaiApiKey', {
                ...ENTERED,
                openaiBaseUrl: 'https://api.openai.com/v2/',
            })
        ).toBe('sk-1');
    });

    it('treats a key as missing at another host, scheme, or port', () => {
        for (const address of [
            'https://openrouter.ai/api/v1',
            'http://api.openai.com/v1',
            'https://api.openai.com:8443/v1',
        ]) {
            expect(
                usableCredential('openaiApiKey', {
                    ...ENTERED,
                    openaiBaseUrl: address,
                }),
                address
            ).toBe('');
        }
    });

    it('treats a key as missing with no origin or no address to match', () => {
        const { openaiApiKeyOrigin: _, ...unbound } = ENTERED;
        expect(usableCredential('openaiApiKey', unbound)).toBe('');
        const { openaiBaseUrl: __, ...addressless } = ENTERED;
        expect(usableCredential('openaiApiKey', addressless)).toBe('');
        expect(
            usableCredential('openaiApiKey', {
                ...ENTERED,
                openaiApiKeyOrigin: '',
                openaiBaseUrl: 'not a url',
            })
        ).toBe('');
    });

    it('passes a credential for a fixed host through', () => {
        expect(usableCredential('deeplApiKey', { deeplApiKey: 'dk' })).toBe(
            'dk'
        );
        expect(usableCredential('deeplApiKey', {})).toBe('');
    });

    it('enters a key for the origin of its address, or for none', () => {
        expect(
            keyEntry(
                'openaiCompatibleApiKey',
                'sk-2',
                'https://llm.example.com/v1'
            )
        ).toEqual({
            openaiCompatibleApiKey: 'sk-2',
            openaiCompatibleApiKeyOrigin: 'https://llm.example.com',
        });
        expect(keyEntry('openaiApiKey', 'sk-3', 'not a url')).toEqual({
            openaiApiKey: 'sk-3',
            openaiApiKeyOrigin: '',
        });
    });
});
