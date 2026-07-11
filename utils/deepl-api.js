/**
 * Shared DeepL API utility functions
 * This module provides common functionality for making DeepL API requests
 * to avoid code duplication across different parts of the extension.
 */

import { fetchWithTimeout } from './fetchWithTimeout.js';

/**
 * Makes a DeepL API translation request
 * @param {string} apiKey - The DeepL API key
 * @param {string} apiPlan - The API plan ('free' or 'pro')
 * @param {string} requestBody - The request body as a URL-encoded string
 * @returns {Promise<Response>} The fetch response
 */
async function fetchDeepL(apiKey, apiPlan, requestBody) {
    const apiUrl =
        apiPlan === 'pro'
            ? 'https://api.deepl.com/v2/translate'
            : 'https://api-free.deepl.com/v2/translate';

    return fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Dualsub/1.0.0',
        },
        body: requestBody,
    });
}

/**
 * Creates a simple test translation request
 * @param {string} apiKey - The DeepL API key
 * @param {string} apiPlan - The API plan ('free' or 'pro')
 * @param {string} [text='Hello'] - The text to translate (defaults to 'Hello')
 * @param {string} [targetLang='ZH-HANS'] - The target language (defaults to 'ZH-HANS')
 * @returns {Promise<Object>} Object with success flag and data/error
 */
async function testDeepLConnection(
    apiKey,
    apiPlan,
    text = 'Hello',
    targetLang = 'ZH-HANS'
) {
    if (!apiKey) {
        return {
            success: false,
            error: 'API_KEY_MISSING',
            message: 'API key is required',
        };
    }

    try {
        // Create request body manually to avoid URLSearchParams issues in service worker
        const requestBody = `text=${encodeURIComponent(text)}&target_lang=${encodeURIComponent(targetLang)}`;

        const response = await fetchDeepL(apiKey, apiPlan, requestBody);

        if (response.ok) {
            const data = await response.json();
            if (data && data.translations && data.translations.length > 0) {
                return {
                    success: true,
                    data: data,
                    translatedText: data.translations[0].text,
                };
            } else {
                return {
                    success: false,
                    error: 'UNEXPECTED_FORMAT',
                    message: 'API responded but with unexpected format',
                };
            }
        } else {
            let errorData;
            try {
                errorData = await response.json();
            } catch (e) {
                errorData = { message: await response.text() };
            }

            return {
                success: false,
                error: `HTTP_${response.status}`,
                status: response.status,
                message: errorData.message || 'Unknown error',
                rawError: errorData,
            };
        }
    } catch (error) {
        return {
            success: false,
            error: 'NETWORK_ERROR',
            message: error.message,
            originalError: error,
        };
    }
}

export { fetchDeepL, testDeepLConnection };
