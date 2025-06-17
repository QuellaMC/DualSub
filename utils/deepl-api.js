/**
 * Shared DeepL API utility functions
 * This module provides common functionality for making DeepL API requests
 * to avoid code duplication across different parts of the extension.
 */

/**
 * Makes a DeepL API translation request
 * @param {string} apiKey - The DeepL API key
 * @param {string} apiPlan - The API plan ('free' or 'pro')
 * @param {string} requestBody - The request body as a URL-encoded string
 * @returns {Promise<Response>} The fetch response
 */
async function fetchDeepL(apiKey, apiPlan, requestBody) {
    const apiUrl = apiPlan === 'pro'
        ? 'https://api.deepl.com/v2/translate'
        : 'https://api-free.deepl.com/v2/translate';

    return fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Dualsub/1.0.0'
        },
        body: requestBody
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
async function testDeepLConnection(apiKey, apiPlan, text = 'Hello', targetLang = 'ZH-HANS') {
    if (!apiKey) {
        return {
            success: false,
            error: 'API_KEY_MISSING',
            message: 'API key is required'
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
                    translatedText: data.translations[0].text
                };
            } else {
                return {
                    success: false,
                    error: 'UNEXPECTED_FORMAT',
                    message: 'API responded but with unexpected format'
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
                rawError: errorData
            };
        }
    } catch (error) {
        return {
            success: false,
            error: 'NETWORK_ERROR',
            message: error.message,
            originalError: error
        };
    }
}

// Universal export that works in both Node.js, browser, and service worker environments
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = { fetchDeepL, testDeepLConnection };
} else {
    // Browser or service worker environment
    // Check for global object availability before using
    const globalObj = (function() {
        if (typeof globalThis !== 'undefined') return globalThis;
        if (typeof window !== 'undefined') return window;
        if (typeof global !== 'undefined') return global;
        if (typeof self !== 'undefined') return self;
        throw new Error('Unable to locate global object');
    })();
    
    // Only attach to global object if it exists and is writable
    try {
        globalObj.DeepLAPI = { fetchDeepL, testDeepLConnection };
    } catch (error) {
        // In strict environments where we can't modify the global object, just log and continue
        console.warn('Could not attach DeepLAPI to global object:', error.message);
    }
} 