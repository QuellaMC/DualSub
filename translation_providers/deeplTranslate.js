// DeepL Translation Provider - Self-contained version for service worker compatibility

const DEEPL_API_URL_PRO = 'https://api.deepl.com/v2/translate';
const DEEPL_API_URL_FREE = 'https://api-free.deepl.com/v2/translate';

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
 * Safely detects the current environment (service worker vs browser)
 * @returns {Object} Environment detection result
 */
function detectEnvironment() {
    try {
        const isServiceWorker = typeof window === 'undefined' && typeof self !== 'undefined' && typeof importScripts === 'function';
        const isBrowser = typeof window !== 'undefined';
        
        return {
            isServiceWorker,
            isBrowser,
            environmentType: isServiceWorker ? 'service-worker' : (isBrowser ? 'browser' : 'unknown')
        };
    } catch (error) {
        console.warn("DeepL: Environment detection failed:", error.message);
        return {
            isServiceWorker: false,
            isBrowser: false,
            environmentType: 'unknown'
        };
    }
}

/**
 * Centralized error handling for DeepL translation operations
 * @param {Error} error - The original error object
 * @param {Object} envInfo - Environment information from detectEnvironment()
 * @throws {Error} Processed error with appropriate message
 */
function handleDeepLError(error, envInfo) {
    console.error("DeepLProvider: Translation error -", error);
    
    // Network connectivity errors
    if (error.message.includes("Failed to fetch")) {
        throw new Error("Network error: Could not connect to DeepL API.");
    }
    
    // Service worker environment compatibility issues
    if (envInfo.isServiceWorker && error.message.includes("window")) {
        console.error("DeepL: Service worker environment compatibility issue detected");
        throw new Error("DeepL Error: Service worker environment compatibility issue");
    }
    
    // Chrome storage access errors
    if (error.message.includes("Chrome storage")) {
        throw new Error("DeepL Error: Cannot access extension storage");
    }
    
    // API key validation errors
    if (error.message.includes("API key is not set")) {
        throw new Error("DeepL Error: API key is not configured");
    }
    
    // API quota and authentication errors
    if (error.message.includes("quota exceeded")) {
        throw new Error("DeepL Error: API quota exceeded");
    }
    
    if (error.message.includes("API key is invalid")) {
        throw new Error("DeepL Error: Invalid API key");
    }
    
    // Generic error with DeepL prefix for consistency
    const errorMessage = error.message.startsWith("DeepL Error:") 
        ? error.message 
        : `DeepL Error: ${error.message}`;
    
    throw new Error(errorMessage);
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
    
    // Safe environment detection
    const envInfo = detectEnvironment();
    console.log("DeepL: Environment check -", envInfo);
    
    // Explicitly check for service worker environment and handle accordingly
    if (envInfo.isServiceWorker) {
        console.log("DeepL: Service worker environment detected, proceeding with SW-compatible operations");
        // Service worker environment is supported, but we log it for debugging
    }
    
    try {
        // Get API credentials from storage with enhanced error handling
        const { deeplApiKey: apiKey, deeplApiPlan: apiPlan } = await new Promise((resolve, reject) => {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage) {
                    reject(new Error("Chrome storage API is not available"));
                    return;
                }
                
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
            ? DEEPL_API_URL_PRO
            : DEEPL_API_URL_FREE;

        // Map language codes to DeepL format
        const mappedTargetLang = mapLanguageCodeForDeepL(targetLang);
        const mappedSourceLang = sourceLang !== 'auto' ? mapLanguageCodeForDeepL(sourceLang) : sourceLang;

        // Create request body manually to avoid any URLSearchParams issues in service worker environment
        let bodyParts = [`text=${encodeURIComponent(text)}`];
        if (mappedSourceLang !== 'auto') {
            bodyParts.push(`source_lang=${encodeURIComponent(mappedSourceLang)}`);
        }
        bodyParts.push(`target_lang=${encodeURIComponent(mappedTargetLang)}`);
        const requestBody = bodyParts.join('&');

        console.log(`DeepL API request: source=${mappedSourceLang}, target=${mappedTargetLang}, environment=${envInfo.environmentType}`);

        // Make the API request with enhanced error handling
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
        // Use centralized error handling
        handleDeepLError(error, envInfo);
    }
}
