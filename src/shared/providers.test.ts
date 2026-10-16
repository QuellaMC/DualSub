import { describe, expect, it } from 'vitest';
import {
    KEYLESS_PROVIDERS,
    missingCredentials,
    PROVIDER_CREDENTIALS,
    PROVIDER_IDS,
} from './providers';

describe('provider credentials', () => {
    it('names none for the keyless providers and some for every other', () => {
        for (const id of PROVIDER_IDS) {
            expect(PROVIDER_CREDENTIALS[id].length === 0, id).toBe(
                (KEYLESS_PROVIDERS as readonly string[]).includes(id)
            );
        }
    });

    it('lists what a provider still lacks', () => {
        expect(missingCredentials('deepl', { deeplApiKey: '  ' })).toEqual([
            'deeplApiKey',
        ]);
        expect(
            missingCredentials('vertex_gemini', {
                vertexAccessToken: 'token',
                vertexProjectId: 'project',
                vertexLocation: 'us-central1',
                vertexModel: 'gemini',
            })
        ).toEqual([]);
        expect(missingCredentials('google', {})).toEqual([]);
    });

    it('counts a key entered for another origin as missing', () => {
        const entered = {
            openaiCompatibleApiKey: 'sk',
            openaiCompatibleApiKeyOrigin: 'https://api.openai.com',
            openaiCompatibleBaseUrl: 'https://api.openai.com/v1',
        };
        expect(missingCredentials('openai_compatible', entered)).toEqual([]);
        expect(
            missingCredentials('openai_compatible', {
                ...entered,
                openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
            })
        ).toEqual(['openaiCompatibleApiKey']);
    });
});
