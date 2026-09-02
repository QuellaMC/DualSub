import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintAccessToken, parseServiceAccountKey } from './vertexAuth';

const SAMPLE_KEY = {
    type: 'service_account',
    project_id: 'my-project-123',
    private_key:
        '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    client_email: 'robot@my-project-123.iam.gserviceaccount.com',
};

function base64UrlDecode(segment: string): string {
    return atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
}

async function generatePem(): Promise<string> {
    const pair = await crypto.subtle.generateKey(
        {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['sign', 'verify']
    );
    const pkcs8 = new Uint8Array(
        await crypto.subtle.exportKey('pkcs8', pair.privateKey)
    );
    let binary = '';
    for (const byte of pkcs8) {
        binary += String.fromCharCode(byte);
    }
    return `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----\n`;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('parseServiceAccountKey', () => {
    it('keeps only the fields needed to mint a token', () => {
        expect(parseServiceAccountKey(JSON.stringify(SAMPLE_KEY))).toEqual({
            projectId: 'my-project-123',
            clientEmail: 'robot@my-project-123.iam.gserviceaccount.com',
            privateKey: SAMPLE_KEY.private_key.trim(),
        });
    });

    it.each([
        ['invalid JSON', '{', 'Invalid JSON file.'],
        ['a non-object', '[]', 'JSON is not a service account key.'],
        [
            'missing fields',
            JSON.stringify({ type: 'service_account', project_id: 'p' }),
            'Missing fields: private_key, client_email',
        ],
        [
            'the wrong key type',
            JSON.stringify({ ...SAMPLE_KEY, type: 'authorized_user' }),
            'JSON is not a service account key.',
        ],
        [
            'a foreign token endpoint',
            JSON.stringify({
                ...SAMPLE_KEY,
                token_uri: 'https://evil.example/token',
            }),
            'Service-account token_uri must use the canonical Google OAuth endpoint.',
        ],
    ])('rejects %s', (_label, text, message) => {
        expect(() => parseServiceAccountKey(text)).toThrow(message);
    });
});

describe('mintAccessToken', () => {
    it('signs a one-hour cloud-platform assertion and returns the token with its expiry', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        const fetchMock = vi.fn(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({
                        access_token: 'ya29.token',
                        expires_in: 1800,
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    }
                )
            )
        );
        vi.stubGlobal('fetch', fetchMock);
        const key = parseServiceAccountKey(
            JSON.stringify({ ...SAMPLE_KEY, private_key: await generatePem() })
        );

        const minted = await mintAccessToken(key);
        expect(minted).toEqual({
            accessToken: 'ya29.token',
            expiresAt: 1_700_000_000_000 + 1800 * 1000,
        });

        const [url, init] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(url).toBe('https://oauth2.googleapis.com/token');
        expect(typeof init.body).toBe('string');
        const params = new URLSearchParams(init.body as string);
        expect(params.get('grant_type')).toBe(
            'urn:ietf:params:oauth:grant-type:jwt-bearer'
        );
        const [header, claims, signature] = params.get('assertion')!.split('.');
        expect(JSON.parse(base64UrlDecode(header!))).toEqual({
            alg: 'RS256',
            typ: 'JWT',
        });
        expect(JSON.parse(base64UrlDecode(claims!))).toEqual({
            iss: key.clientEmail,
            scope: 'https://www.googleapis.com/auth/cloud-platform',
            aud: 'https://oauth2.googleapis.com/token',
            iat: 1_700_000_000,
            exp: 1_700_003_600,
        });
        expect(signature!.length).toBeGreaterThan(300);
    });

    it('rejects a failed exchange or a response without a token', async () => {
        const key = parseServiceAccountKey(
            JSON.stringify({ ...SAMPLE_KEY, private_key: await generatePem() })
        );
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response('', { status: 401 })))
        );
        await expect(mintAccessToken(key)).rejects.toThrow(
            'Token exchange failed: 401'
        );

        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
        );
        await expect(mintAccessToken(key)).rejects.toThrow(
            'missing access_token'
        );
    });
});
