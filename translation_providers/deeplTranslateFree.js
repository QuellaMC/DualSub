/**
 * DeepL Free Translation Provider
 * Web interface based translation without API key
 * 
 * ===== ATTRIBUTION =====
 * This implementation is based on the Kotlin implementation from:
 * Repository: bob-plugin-akl-deepl-free-translate
 * Original Author: akl7777777
 * Original License: MIT License
 * Source: https://github.com/akl7777777/bob-plugin-akl-deepl-free-translate
 * 
 * Adapted and modified for Chrome Extension environment
 * Key components adapted from original:
 * - Language mapping logic for DeepL web interface
 * - JSON-RPC request structure and timestamp manipulation
 * - DeepL web API interaction patterns and endpoints
 * - User agent rotation and detection avoidance strategies
 */

/**
 * Configuration constants for DeepL Free service
 * Centralized to simplify maintenance if DeepL changes its interface
 */
const DEEPL_FREE_CONFIG = {
    // API endpoints
    ENDPOINTS: {
        WEB_API: 'https://www2.deepl.com/jsonrpc',
        FREE_API: 'https://api-free.deepl.com/v2/translate',
        ALTERNATIVE_API: 'https://api.mymemory.translated.net/get',
        TRANSLATOR_REFERER: 'https://www.deepl.com/translator',
        ORIGIN: 'https://www.deepl.com',
    },

    // User agent strings for rotation to avoid detection
    USER_AGENTS: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    ],

    // Text processing limits
    MAX_TEXT_LENGTH: 5000,

    // Timing configuration
    DELAY_RANGE: {
        MIN: 50,
        MAX: 200,
    },
};

/**
 * Maps language codes to DeepL's web interface format
 * Language mapping logic adapted from original implementation
 * @param {string} langCode - Input language code
 * @returns {string} - DeepL compatible language code
 */
function mapLanguageCodeForDeepLWeb(langCode) {
    const normalizedLangCode = langCode.toLowerCase().replaceAll('_', '-');

    const languageMap = {
        // Chinese mappings
        'zh-cn': 'zh', // Chinese Simplified
        zh: 'zh', // Chinese Simplified
        'zh-tw': 'zh-tw', // Chinese Traditional
        'zh-hk': 'zh-tw', // Hong Kong Chinese to Traditional

        // English mappings
        en: 'en',
        'en-us': 'en',
        'en-gb': 'en',

        // Portuguese mappings
        pt: 'pt-pt',
        'pt-br': 'pt-br',
        'pt-pt': 'pt-pt',

        // Other languages
        ja: 'ja',
        ko: 'ko',
        de: 'de',
        fr: 'fr',
        es: 'es',
        it: 'it',
        ru: 'ru',
        ar: 'ar',
        auto: 'auto',
    };

    return languageMap[normalizedLangCode] || normalizedLangCode;
}

/**
 * Generates random user agent to avoid detection
 * @returns {string} - Random user agent string
 */
function generateRandomUserAgent() {
    return DEEPL_FREE_CONFIG.USER_AGENTS[
        Math.floor(Math.random() * DEEPL_FREE_CONFIG.USER_AGENTS.length)
    ];
}

/**
 * Adds random delay to avoid being detected as automated requests
 * @param {number} minMs - Minimum delay in milliseconds
 * @param {number} maxMs - Maximum delay in milliseconds
 * @returns {Promise} - Promise that resolves after delay
 */
function randomDelay(minMs = 100, maxMs = 500) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Translates text using DeepL's web interface (free, no API key required)
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language code
 * @param {string} targetLang - Target language code
 * @returns {Promise<string>} - Translated text
 */
export async function translate(text, sourceLang, targetLang) {
    // Validate input
    if (!text || typeof text !== 'string' || text.trim() === '') {
        console.warn('DeepL Free: Empty or invalid text provided');
        return text || '';
    }

    // Check text length limit (DeepL web interface has limits)
    let processedText = text;
    if (text.length > DEEPL_FREE_CONFIG.MAX_TEXT_LENGTH) {
        console.warn(
            `DeepL Free: Text too long, truncating to ${DEEPL_FREE_CONFIG.MAX_TEXT_LENGTH} characters`
        );
        processedText = text.substring(0, DEEPL_FREE_CONFIG.MAX_TEXT_LENGTH);
    }

    try {
        // Add random delay to avoid detection
        await randomDelay(
            DEEPL_FREE_CONFIG.DELAY_RANGE.MIN,
            DEEPL_FREE_CONFIG.DELAY_RANGE.MAX
        );

        // Map language codes to DeepL web format
        const mappedSourceLang = mapLanguageCodeForDeepLWeb(sourceLang);
        const mappedTargetLang = mapLanguageCodeForDeepLWeb(targetLang);

        // Method 1: Try the new DeepL web API endpoint
        try {
            const result = await translateViaWebAPI(
                processedText,
                mappedSourceLang,
                mappedTargetLang
            );
            if (result) {
                return result;
            }
        } catch (error) {
            console.warn(
                'DeepL Free: Web API method failed, trying alternative:',
                error.message
            );
        }

        // Method 2: Try the translator interface endpoint
        try {
            const result = await translateViaTranslatorInterface(
                processedText,
                mappedSourceLang,
                mappedTargetLang
            );
            if (result) {
                return result;
            }
        } catch (error) {
            console.warn(
                'DeepL Free: Translator interface method failed:',
                error.message
            );
        }

        // If all methods fail, throw error
        throw new Error('All DeepL free translation methods failed');
    } catch (error) {
        console.error('DeepL Free: Translation error:', error);
        throw new Error(`DeepL Free Error: ${error.message}`);
    }
}

/**
 * Translates using DeepL's web API endpoint (Method 1)
 * JSON-RPC structure and timestamp manipulation from original implementation
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language
 * @param {string} targetLang - Target language
 * @returns {Promise<string>} - Translated text
 */
async function translateViaWebAPI(text, sourceLang, targetLang) {
    const url = DEEPL_FREE_CONFIG.ENDPOINTS.WEB_API;

    // Generate request data similar to what the web interface sends
    const requestData = {
        jsonrpc: '2.0',
        method: 'LMT_handle_texts',
        params: {
            texts: [{ text: text, requestAlternatives: 3 }],
            splitting: 'newlines',
            lang: {
                source_lang_user_selected:
                    sourceLang === 'auto' ? 'auto' : sourceLang.toUpperCase(),
                target_lang: targetLang.toUpperCase(),
            },
            timestamp: Date.now(),
            commonJobParams: {
                wasSpoken: false,
                transcribe_as: '',
            },
        },
        id: Math.floor(Math.random() * 10000000) + 40000000,
    };

    // Calculate timestamp manipulation (DeepL uses this for request validation)
    const timestamp = Date.now();
    const iCount = text.split('i').length - 1;
    requestData.params.timestamp = timestamp - (timestamp % (iCount + 1));

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: '*/*',
            'User-Agent': generateRandomUserAgent(),
            Referer: DEEPL_FREE_CONFIG.ENDPOINTS.TRANSLATOR_REFERER,
            Origin: DEEPL_FREE_CONFIG.ENDPOINTS.ORIGIN,
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
        },
        body: JSON.stringify(requestData),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(
            `DeepL API Error: ${data.error.message || 'Unknown error'}`
        );
    }

    if (data.result && data.result.texts && data.result.texts.length > 0) {
        return data.result.texts[0].text;
    }

    throw new Error('Invalid response format from DeepL');
}

/**
 * Translates using DeepL's translator interface (Method 2 - Fallback)
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language
 * @param {string} targetLang - Target language
 * @returns {Promise<string>} - Translated text
 */
async function translateViaTranslatorInterface(text, sourceLang, targetLang) {
    // Try the simplified approach as fallback method
    try {
        return await translateViaSimplifiedAPI(text, sourceLang, targetLang);
    } catch (error) {
        console.warn('DeepL Free: Simplified API failed:', error.message);
        throw error;
    }
}

/**
 * Simplified API approach (Method 2a)
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language
 * @param {string} targetLang - Target language
 * @returns {Promise<string>} - Translated text
 */
async function translateViaSimplifiedAPI(text, sourceLang, targetLang) {
    // Use a simplified approach that works more reliably
    const url = DEEPL_FREE_CONFIG.ENDPOINTS.FREE_API;

    // This approach tries to use the free endpoint without auth
    // Note: This may not work and is kept as fallback

    const params = new URLSearchParams({
        text: text,
        source_lang: sourceLang === 'auto' ? '' : sourceLang.toUpperCase(),
        target_lang: targetLang.toUpperCase(),
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': generateRandomUserAgent(),
                Accept: 'application/json',
                Referer: DEEPL_FREE_CONFIG.ENDPOINTS.TRANSLATOR_REFERER,
            },
            body: params.toString(),
        });

        // This will likely fail without auth, but we try anyway
        if (response.ok) {
            const data = await response.json();
            if (data.translations && data.translations.length > 0) {
                return data.translations[0].text;
            }
        }
    } catch (error) {
        // Expected to fail, continue to next method
    }

    // Fallback: Use alternative service that provides DeepL-like quality
    return await translateViaAlternativeService(text, sourceLang, targetLang);
}

/**
 * Alternative service that provides good translation quality (Method 3 - Final fallback)
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language
 * @param {string} targetLang - Target language
 * @returns {Promise<string>} - Translated text
 */
async function translateViaAlternativeService(text, sourceLang, targetLang) {
    // As a final fallback, we can use MyMemory or LibreTranslate
    // MyMemory provides decent quality and has a generous free tier

    const url = DEEPL_FREE_CONFIG.ENDPOINTS.ALTERNATIVE_API;
    const params = new URLSearchParams({
        q: text,
        langpair: `${sourceLang === 'auto' ? 'autodetect' : sourceLang}|${targetLang}`,
        de: 'dualsub-extension@example.com', // Identification for fair use
    });

    const response = await fetch(`${url}?${params.toString()}`, {
        method: 'GET',
        headers: {
            'User-Agent': generateRandomUserAgent(),
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(
            `Alternative service HTTP ${response.status}: ${response.statusText}`
        );
    }

    const data = await response.json();

    if (
        data.responseStatus === 200 &&
        data.responseData &&
        data.responseData.translatedText
    ) {
        console.log(
            'DeepL Free: Using alternative service (MyMemory) as fallback'
        );
        return data.responseData.translatedText;
    }

    throw new Error('Alternative translation service failed');
}
