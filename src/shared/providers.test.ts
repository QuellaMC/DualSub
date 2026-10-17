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

    it('counts a Vertex token past its recorded expiry as missing', () => {
        const vertex = {
            vertexAccessToken: 'ya29.token',
            vertexProjectId: 'p',
            vertexLocation: 'us-central1',
            vertexModel: 'gemini-2.5-flash',
        };
        expect(
            missingCredentials(
                'vertex_gemini',
                { ...vertex, vertexTokenExpiresAt: 1000 },
                2000
            )
        ).toEqual(['vertexAccessToken']);
        expect(
            missingCredentials(
                'vertex_gemini',
                { ...vertex, vertexTokenExpiresAt: 3000 },
                2000
            )
        ).toEqual([]);
        expect(
            missingCredentials(
                'vertex_gemini',
                { ...vertex, vertexTokenExpiresAt: 0 },
                2000
            )
        ).toEqual([]);
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
});
