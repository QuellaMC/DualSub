// disneyplus-dualsub-chrome-extension/translation_providers/microsoftTranslateEdgeAuth.js
// Thanks to: https://github.com/Chewawi/microsoft-translate-api/

import Logger from '../utils/logger.js';

const API_AUTH_EDGE = 'https://edge.microsoft.com/translate/auth';
const API_TRANSLATE_COGNITIVE =
    'https://api.cognitive.microsofttranslator.com/translate';

// Initialize logger for Microsoft Translate provider
const logger = Logger.create('MicrosoftTranslate');

// Safe User-Agent that works in both browser and service worker environments
function getDefaultUserAgent() {
    // Check if we're in a service worker environment
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
        return navigator.userAgent;
    }
    // Fallback for service worker or other environments where navigator is not available
    return 'Mozilla/5.0 (Windows; U; Windows NT 6.3; WOW64; en-US) AppleWebKit/603.43 (KHTML, like Gecko) Chrome/47.0.2805.119 Safari/603';
}

const DEFAULT_USER_AGENT = getDefaultUserAgent();

// --- Token Management ---
let globalAuthToken = null;
let tokenExpiresAt = 0;
let ongoingAuthPromise = null;

/**
 * Fetches or refreshes the authentication token from Microsoft Edge's auth service.
 */
async function fetchAuthToken() {
    logger.debug('Attempting to fetch new auth token');
    try {
        const response = await fetch(API_AUTH_EDGE, {
            headers: { 'User-Agent': DEFAULT_USER_AGENT },
        });
        if (!response.ok) {
            throw new Error(`Auth API HTTP error! Status: ${response.status}`);
        }
        const authJWT = await response.text();

        // Decode JWT payload to get expiration (exp is in seconds)
        // Use a safe base64 decode function that works in all environments
        const payloadBase64 = authJWT.split('.')[1];

        // Safe base64 decode for service worker and browser environments
        let decodedPayload;
        try {
            if (typeof atob !== 'undefined') {
                decodedPayload = atob(
                    payloadBase64.replace(/-/g, '+').replace(/_/g, '/')
                );
            } else {
                // Fallback for environments where atob is not available
                decodedPayload = Buffer.from(
                    payloadBase64.replace(/-/g, '+').replace(/_/g, '/'),
                    'base64'
                ).toString();
            }
        } catch (decodeError) {
            // Manual base64 decode as a last resort (simple implementation)
            logger.warn('Standard base64 decode failed, using fallback', {
                errorMessage: decodeError.message,
            });
            const base64chars =
                'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            const normalizedPayload = payloadBase64
                .replace(/-/g, '+')
                .replace(/_/g, '/');
            let result = '';
            let buffer = 0;
            let bitsCollected = 0;

            for (let i = 0; i < normalizedPayload.length; i++) {
                const char = normalizedPayload[i];
                if (char === '=') break;

                const charIndex = base64chars.indexOf(char);
                if (charIndex === -1) continue;

                buffer = (buffer << 6) | charIndex;
                bitsCollected += 6;

                if (bitsCollected >= 8) {
                    result += String.fromCharCode(
                        (buffer >> (bitsCollected - 8)) & 0xff
                    );
                    bitsCollected -= 8;
                }
            }
            decodedPayload = result;
        }

        const jwtPayload = JSON.parse(decodedPayload);

        if (!jwtPayload.exp) {
            throw new Error(
                "Auth token payload does not contain 'exp' (expiration time)."
            );
        }

        globalAuthToken = authJWT;
        tokenExpiresAt = jwtPayload.exp * 1000; // Convert to milliseconds
        logger.debug('New auth token fetched successfully', {
            expiresAt: new Date(tokenExpiresAt).toISOString(),
            tokenLength: authJWT.length,
        });
        return globalAuthToken;
    } catch (e) {
        logger.error('Failed to fetch auth token', e);
        globalAuthToken = null;
        tokenExpiresAt = 0;
        throw new Error('Failed to fetch auth token for Microsoft Translator.');
    }
}

/**
 * Checks if the current token is expired or about to expire (within 60 seconds).
 * @returns {boolean} True if token is expired or nearing expiration.
 */
function isTokenExpired() {
    if (!globalAuthToken) return true;
    return tokenExpiresAt - Date.now() < 60000; // Refresh if less than 60s validity left
}

/**
 * Ensures a valid authentication token is available, fetching/refreshing if necessary.
 */
async function ensureAuthentication() {
    if (isTokenExpired()) {
        if (ongoingAuthPromise) {
            logger.debug('Waiting for ongoing auth token refresh');
            await ongoingAuthPromise;
        } else {
            logger.debug('Token expired or missing, refreshing');
            ongoingAuthPromise = fetchAuthToken();
            try {
                await ongoingAuthPromise;
            } finally {
                ongoingAuthPromise = null;
            }
        }
    }
    if (!globalAuthToken) {
        throw new Error(
            'Microsoft Translator authentication failed or token is unavailable.'
        );
    }
    return globalAuthToken;
}

/**
 * Translates text using the Microsoft Translator API (Cognitive Services endpoint with Edge auth).
 *
 * @param {string} text The text to translate.
 * @param {string} sourceLang The source language code (e.g., 'auto', 'en'). 'auto' will become undefined for the API.
 * @param {string} targetLang The target language code (e.g., 'es', 'zh-CN').
 * @returns {Promise<string>} A Promise that resolves with the translated text.
 * @throws {Error} If the translation API request or processing fails.
 */
export async function translate(text, sourceLang, targetLang) {
    logger.info('Translation request initiated', {
        sourceLang,
        targetLang,
        textLength: text?.length || 0,
    });

    if (!text || typeof text !== 'string' || text.trim() === '') {
        logger.warn('Empty or invalid text provided for translation', {
            text: text?.substring(0, 50),
        });
        return ''; // Return empty string for empty input
    }

    const actualSourceLang =
        sourceLang && sourceLang.toLowerCase() === 'auto'
            ? undefined
            : sourceLang;

    try {
        const authToken = await ensureAuthentication();

        const requestBody = [{ Text: text }];

        // Create query parameters manually to avoid URLSearchParams issues in service worker
        let queryParts = [
            `api-version=3.0`,
            `to=${encodeURIComponent(targetLang)}`,
        ];

        if (actualSourceLang) {
            queryParts.push(`from=${encodeURIComponent(actualSourceLang)}`);
        }

        const queryString = queryParts.join('&');

        const response = await fetch(
            `${API_TRANSLATE_COGNITIVE}?${queryString}`,
            {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + authToken,
                    'Content-Type': 'application/json',
                    'User-Agent': DEFAULT_USER_AGENT,
                },
                body: JSON.stringify(requestBody),
            }
        );

        if (!response.ok) {
            let errorDetails = 'No details available.';
            try {
                const errorJson = await response.json();
                errorDetails = JSON.stringify(errorJson.error || errorJson);
            } catch (e) {
                errorDetails = await response.text();
            }
            logger.error('Microsoft Translate API HTTP error', null, {
                status: response.status,
                statusText: response.statusText,
                errorDetails: errorDetails.substring(0, 200),
            });
            throw new Error(
                `Translation API HTTP error ${response.status}. Details: ${errorDetails.substring(0, 200)}`
            );
        }

        const result = await response.json();

        if (
            Array.isArray(result) &&
            result.length > 0 &&
            result[0].translations &&
            Array.isArray(result[0].translations) &&
            result[0].translations.length > 0 &&
            typeof result[0].translations[0].text === 'string'
        ) {
            const translatedText = result[0].translations[0].text;
            logger.info('Translation completed successfully', {
                translatedLength: translatedText.length,
                detectedSourceLang: result[0].detectedLanguage?.language,
            });
            return translatedText;
        } else {
            logger.error(
                'Translation JSON parsing failed or unexpected structure',
                null,
                {
                    responseData: result,
                }
            );
            throw new Error(
                'Translation Error: Malformed JSON response from Microsoft Translator.'
            );
        }
    } catch (error) {
        logger.error('API request/processing error occurred', error, {
            sourceLang: actualSourceLang,
            targetLang,
            textLength: text?.length || 0,
        });
        // Re-throw the error to be caught by the caller in background.js
        throw error;
    }
}
