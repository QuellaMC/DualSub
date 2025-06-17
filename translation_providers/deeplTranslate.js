// DeepL Translation Provider - Self-contained version for service worker compatibility

function mapLanguageCodeForDeepL(langCode) {
    // Normalize the language code to lowercase for consistent lookup
    const normalizedLangCode = langCode.toLowerCase().replace('_', '-');
    
    const languageMap = {
        // Chinese mappings
        'zh-cn': 'ZH-HANS',  // Chinese Simplified
        'zh': 'ZH-HANS',   
        'zh-tw': 'ZH-HANT',  // Chinese Traditional
        'zh-hk': 'ZH-HANT',  // Hong Kong Chinese to Traditional
        
        // English mappings
        'en': 'EN',
        'en-us': 'EN-US',
        'en-gb': 'EN-GB',
        
        // Portuguese mappings
        'pt': 'PT-PT',
        'pt-br': 'PT-BR',
        'pt-pt': 'PT-PT',
        
        // Other common mappings
        'ja': 'JA',
        'ko': 'KO',
        'de': 'DE',
        'fr': 'FR',
        'es': 'ES',
        'it': 'IT',
        'ru': 'RU',
        'ar': 'AR'
    };

    return languageMap[normalizedLangCode] || langCode.toUpperCase();
}

/**
 * Translates text using the DeepL API.
 *
 * @param {string} text The text to translate.
 * @param {string} sourceLang The source language code (e.g., 'auto', 'EN').
 * @param {string} targetLang The target language code (e.g., 'ES', 'ZH').
 * @returns {Promise<string>} A Promise that resolves with the translated text.
 * @throws {Error} If the translation API request or processing fails.
 */
export async function translate(text, sourceLang, targetLang) {
    console.log("DeepL: translate function called, checking environment...");
    
    // Check environment immediately to debug the window issue
    const isServiceWorker = typeof window === 'undefined' && typeof self !== 'undefined';
    const isBrowser = typeof window !== 'undefined';
    console.log("DeepL: Environment check - Service Worker:", isServiceWorker, "Browser:", isBrowser);
    
    try {
        // Get API credentials from storage
        const { deeplApiKey: apiKey, deeplApiPlan: apiPlan } = await new Promise((resolve, reject) => {
            try {
                chrome.storage.sync.get(['deeplApiKey', 'deeplApiPlan'], (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(`Storage error: ${chrome.runtime.lastError.message}`));
                    } else {
                        resolve(result);
                    }
                });
            } catch (storageError) {
                reject(new Error(`Chrome storage access failed: ${storageError.message}`));
            }
        });

        if (!apiKey) {
            throw new Error("DeepL API key is not set. Please add your key in the extension options.");
        }

        // Validate input
        if (!text || typeof text !== 'string' || text.trim() === '') {
            console.warn("DeepL: Empty or invalid text provided");
            return text || '';
        }

        // Determine API URL
        const apiUrl = apiPlan === 'pro'
            ? 'https://api.deepl.com/v2/translate'
            : 'https://api-free.deepl.com/v2/translate';

        // Map language codes to DeepL format
        const mappedTargetLang = mapLanguageCodeForDeepL(targetLang);
        const mappedSourceLang = sourceLang !== 'auto' ? mapLanguageCodeForDeepL(sourceLang) : sourceLang;

        // Create request body manually to avoid any URLSearchParams issues
        let bodyParts = [`text=${encodeURIComponent(text)}`];
        if (mappedSourceLang !== 'auto') {
            bodyParts.push(`source_lang=${encodeURIComponent(mappedSourceLang)}`);
        }
        bodyParts.push(`target_lang=${encodeURIComponent(mappedTargetLang)}`);
        const requestBody = bodyParts.join('&');

        console.log(`DeepL API request: source=${mappedSourceLang}, target=${mappedTargetLang}`);

        // Make the API request
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Dualsub/1.0.0'
            },
            body: requestBody
        });

        // Handle response
        if (!response.ok) {
            let errorMessage;
            if (response.status === 403) {
                errorMessage = "DeepL API key is invalid or has been rejected.";
            } else if (response.status === 456) {
                errorMessage = "DeepL API quota exceeded. Please check your usage limits.";
            } else if (response.status === 400) {
                try {
                    const errorData = await response.json();
                    errorMessage = `DeepL API request invalid: ${errorData.message || 'Bad request parameters'}`;
                    console.error("DeepL 400 error details:", errorData);
                } catch {
                    errorMessage = `DeepL API request invalid: ${response.statusText}`;
                }
            } else {
                try {
                    const errorData = await response.json();
                    errorMessage = `DeepL API request failed with status ${response.status}: ${errorData.message || 'Unknown error'}`;
                    console.error(`DeepL API Error: ${response.status}`, errorData);
                } catch {
                    errorMessage = `DeepL API request failed with status ${response.status}: ${response.statusText}`;
                }
            }
            throw new Error(errorMessage);
        }

        // Parse response
        const data = await response.json();

        if (data && data.translations && data.translations.length > 0) {
            const translatedText = data.translations[0].text;
            console.log("DeepL: Translation successful");
            return translatedText;
        } else {
            console.error("DeepLProvider: Invalid response structure from API", data);
            throw new Error("DeepL translation response was empty or malformed.");
        }

    } catch (error) {
        console.error("DeepLProvider: Translation error -", error);
        
        // Handle specific error types
        if (error.message.includes("Failed to fetch")) {
            throw new Error("Network error: Could not connect to DeepL API.");
        }
        
        // This should help us identify the window issue
        if (error.message.includes("window is not defined")) {
            console.error("DeepL: Window access error detected in service worker context");
            throw new Error("DeepL Error: Browser compatibility issue - service worker environment detected");
        }
        
        // Re-throw with DeepL prefix for consistency
        throw new Error(`DeepL Error: ${error.message}`);
    }
}
