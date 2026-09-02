import { fetchWithTimeout } from './fetchWithTimeout';

const GOOGLE_OAUTH_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_LIFETIME_SECONDS = 3600;

export interface ServiceAccountKey {
    readonly projectId: string;
    readonly clientEmail: string;
    readonly privateKey: string;
}

function readField(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parse a downloaded service-account JSON key. Only the fields needed to
 * mint a token are kept; the private key lives in memory for that one call.
 * @throws {Error} with a user-facing reason
 */
export function parseServiceAccountKey(text: string): ServiceAccountKey {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('Invalid JSON file.');
    }
    if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
    ) {
        throw new Error('JSON is not a service account key.');
    }
    const record = parsed as Record<string, unknown>;
    const missing = [
        'type',
        'project_id',
        'private_key',
        'client_email',
    ].filter((key) => readField(record, key) === '');
    if (missing.length > 0) {
        throw new Error(`Missing fields: ${missing.join(', ')}`);
    }
    if (readField(record, 'type') !== 'service_account') {
        throw new Error('JSON is not a service account key.');
    }
    const tokenUri = readField(record, 'token_uri');
    if (tokenUri !== '' && tokenUri !== GOOGLE_OAUTH_TOKEN_URI) {
        throw new Error(
            'Service-account token_uri must use the canonical Google OAuth endpoint.'
        );
    }
    return {
        projectId: readField(record, 'project_id'),
        clientEmail: readField(record, 'client_email'),
        privateKey: readField(record, 'private_key'),
    };
}

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function base64UrlEncodeJson(value: unknown): string {
    return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem: string): ArrayBuffer {
    const base64 = pem
        .replace(/-----BEGIN [^-]+-----/g, '')
        .replace(/-----END [^-]+-----/g, '')
        .replace(/\s+/g, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
}

async function signJwt(
    claims: Record<string, unknown>,
    privateKeyPem: string
): Promise<string> {
    const unsigned = `${base64UrlEncodeJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlEncodeJson(claims)}`;
    const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToPkcs8(privateKeyPem),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        new TextEncoder().encode(unsigned)
    );
    return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export interface MintedAccessToken {
    readonly accessToken: string;
    /** Epoch milliseconds. */
    readonly expiresAt: number;
}

/** Exchange a service-account key for a short-lived OAuth access token. */
export async function mintAccessToken(
    key: ServiceAccountKey
): Promise<MintedAccessToken> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const assertion = await signJwt(
        {
            iss: key.clientEmail,
            scope: CLOUD_PLATFORM_SCOPE,
            aud: GOOGLE_OAUTH_TOKEN_URI,
            iat: issuedAt,
            exp: issuedAt + TOKEN_LIFETIME_SECONDS,
        },
        key.privateKey
    );
    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
    });
    const response = await fetchWithTimeout(GOOGLE_OAUTH_TOKEN_URI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
        access_token?: unknown;
        expires_in?: unknown;
    };
    if (
        typeof payload.access_token !== 'string' ||
        payload.access_token === ''
    ) {
        throw new Error('Token exchange response missing access_token');
    }
    const expiresIn =
        typeof payload.expires_in === 'number' && payload.expires_in > 0
            ? payload.expires_in
            : TOKEN_LIFETIME_SECONDS;
    return {
        accessToken: payload.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
    };
}
