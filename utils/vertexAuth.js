/**
 * Shared Vertex AI authentication utilities
 * Used by both options page and background script for token management
 */

/**
 * Base64 URL encode a string
 */
function base64UrlEncodeString(input) {
    const base64 = btoa(input);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Base64 URL encode bytes
 */
function base64UrlEncodeBytes(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return base64UrlEncodeString(binary);
}

/**
 * Convert PEM to ArrayBuffer
 */
function pemToArrayBuffer(pem) {
    const cleaned = pem
        .replace(/-----BEGIN [^-]+-----/g, '')
        .replace(/-----END [^-]+-----/g, '')
        .replace(/\s+/g, '');
    const raw = atob(cleaned);
    const buffer = new ArrayBuffer(raw.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < raw.length; i++) {
        view[i] = raw.charCodeAt(i);
    }
    return buffer;
}

/**
 * Import private key from PEM format
 */
async function importPrivateKey(pem) {
    const keyData = pemToArrayBuffer(pem);
    return await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
}

/**
 * Sign JWT using RS256
 */
async function signJwtRS256(headerObj, payloadObj, privateKeyPem) {
    const encoder = new TextEncoder();
    const header = base64UrlEncodeString(JSON.stringify(headerObj));
    const payload = base64UrlEncodeString(JSON.stringify(payloadObj));
    const unsignedToken = `${header}.${payload}`;
    const key = await importPrivateKey(privateKeyPem);
    const signature = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        encoder.encode(unsignedToken)
    );
    const sig = base64UrlEncodeBytes(signature);
    return `${unsignedToken}.${sig}`;
}

/**
 * Generate access token from service account JSON
 * @param {Object} serviceAccountJson - The service account JSON object
 * @returns {Promise<{accessToken: string, expiresIn: number}>}
 */
export async function getAccessTokenFromServiceAccount(serviceAccountJson) {
    const now = Math.floor(Date.now() / 1000);
    const iat = now;
    const exp = now + 3600; // 1 hour
    const tokenUri = serviceAccountJson.token_uri || 'https://oauth2.googleapis.com/token';
    const scope = 'https://www.googleapis.com/auth/cloud-platform';

    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: serviceAccountJson.client_email,
        scope,
        aud: tokenUri,
        iat,
        exp,
    };

    const jwt = await signJwtRS256(header, claims, serviceAccountJson.private_key);

    const body = new URLSearchParams();
    body.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    body.set('assertion', jwt);

    const res = await fetch(tokenUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed: ${res.status} ${res.statusText} ${text}`);
    }

    const data = await res.json();
    if (!data.access_token) {
        throw new Error('Token exchange response missing access_token');
    }
    return { accessToken: data.access_token, expiresIn: data.expires_in || 3600 };
}

/**
 * Check if token is expired or about to expire
 * @returns {Promise<{isExpired: boolean, shouldRefresh: boolean, expiresInMinutes: number} | null>}
 */
export async function checkTokenExpiration() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
        return null;
    }

    try {
        const result = await chrome.storage.local.get(['vertexTokenExpiresAt']);
        const expiresAt = result.vertexTokenExpiresAt;

        if (!expiresAt) {
            return null;
        }

        const now = Date.now();
        const timeUntilExpiry = expiresAt - now;
        const isExpired = timeUntilExpiry <= 0;
        const expiresInMinutes = Math.floor(timeUntilExpiry / 60000);

        return {
            expiresAt,
            timeUntilExpiry,
            isExpired,
            expiresInMinutes,
            shouldRefresh: timeUntilExpiry < 5 * 60 * 1000, // Refresh if less than 5 minutes left
        };
    } catch (error) {
        console.error('[VertexAuth] Failed to check token expiration:', error);
        return null;
    }
}

/**
 * Refresh the access token using stored service account
 * @param {boolean} updateConfig - Whether to update configService
 * @returns {Promise<{accessToken: string, expiresAt: number}>}
 */
export async function refreshAccessToken(updateConfig = true) {
    if (typeof chrome === 'undefined' || !chrome.storage) {
        throw new Error('Chrome storage not available');
    }

    const result = await chrome.storage.local.get(['vertexServiceAccount']);
    const sa = result.vertexServiceAccount;

    if (!sa) {
        throw new Error('No stored service account found');
    }

    // Generate new token
    const { accessToken, expiresIn } = await getAccessTokenFromServiceAccount(sa);

    // Calculate new expiration time
    const expiresAt = Date.now() + (expiresIn * 1000);

    // Update expiration time in storage
    await chrome.storage.local.set({
        vertexTokenExpiresAt: expiresAt,
    });

    // Update config if requested
    if (updateConfig && typeof chrome.storage.sync !== 'undefined') {
        try {
            const { configService } = await import('../services/configService.js');
            await configService.set('vertexAccessToken', accessToken);
        } catch (error) {
            console.error('[VertexAuth] Failed to update config:', error);
        }
    }

    return { accessToken, expiresAt };
}

/**
 * Auto-refresh token if needed (silently)
 * @returns {Promise<string | null>} The new access token if refreshed, null if no refresh needed
 */
export async function autoRefreshIfNeeded() {
    const expirationInfo = await checkTokenExpiration();
    
    if (!expirationInfo) {
        return null;
    }

    if (expirationInfo.isExpired || expirationInfo.shouldRefresh) {
        try {
            const { accessToken } = await refreshAccessToken();
            console.log('[VertexAuth] Token auto-refreshed successfully');
            return accessToken;
        } catch (error) {
            console.error('[VertexAuth] Auto-refresh failed:', error);
            return null;
        }
    }

    return null;
}

