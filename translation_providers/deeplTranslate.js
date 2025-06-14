
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
    const { deeplApiKey: apiKey, deeplApiPlan: apiPlan } = await new Promise(resolve => {
        chrome.storage.sync.get(['deeplApiKey', 'deeplApiPlan'], resolve);
    });

    if (!apiKey) {
        throw new Error("DeepL API key is not set. Please add your key in the extension options.");
    }

    // Add input validation
    if (!text || typeof text !== 'string' || text.trim() === '') {
        console.warn("DeepL: Empty or invalid text provided");
        return text || '';
    }

    const apiUrl = apiPlan === 'pro'
        ? 'https://api.deepl.com/v2/translate'
        : 'https://api-free.deepl.com/v2/translate';

    // Map language codes to DeepL format
    const mappedTargetLang = mapLanguageCodeForDeepL(targetLang);
    const mappedSourceLang = sourceLang !== 'auto' ? mapLanguageCodeForDeepL(sourceLang) : sourceLang;

    // Use URLSearchParams for proper DeepL API format (application/x-www-form-urlencoded)
    const params = new URLSearchParams();
    params.append('text', text);
    if (mappedSourceLang !== 'auto') {
        params.append('source_lang', mappedSourceLang);
    }
    params.append('target_lang', mappedTargetLang);

    console.log(`DeepL API request: source=${mappedSourceLang}, target=${mappedTargetLang}`);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Dualsub/1.0.0'
            },
            body: params.toString()
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw new Error("DeepL API key is invalid or has been rejected.");
            }
            if (response.status === 456) {
                throw new Error("DeepL API quota exceeded. Please check your usage limits.");
            }
            if (response.status === 400) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }));
                console.error("DeepL 400 error details:", errorData);
                throw new Error(`DeepL API request invalid: ${errorData.message || 'Bad request parameters'}`);
            }
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            console.error(`DeepL API Error: ${response.status}`, errorData);
            throw new Error(`DeepL API request failed with status ${response.status}: ${errorData.message || 'Unknown error'}`);
        }

        const data = await response.json();

        if (data && data.translations && data.translations.length > 0) {
            return data.translations[0].text;
        } else {
            console.error("DeepLProvider: Invalid response structure from API", data);
            throw new Error("DeepL translation response was empty or malformed.");
        }
    } catch (error) {
        console.error("DeepLProvider: Translation error -", error);
        // Add a more user-friendly check for network errors.
        if (error.message.includes("Failed to fetch")) {
            throw new Error("Network error: Could not connect to DeepL API.");
        }
        throw new Error(`DeepL Error: ${error.message}`);
    }
}
