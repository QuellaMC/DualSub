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
    const { deeplApiKey: API_KEY } = await new Promise(resolve => {
        chrome.storage.sync.get('deeplApiKey', resolve);
    });

    if (!API_KEY) {
        throw new Error("DeepL API key is not set. Please add your key in the extension popup.");
    }

    const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

    const params = {
        text: [text],
        source_lang: sourceLang === 'auto' ? undefined : sourceLang,
        target_lang: targetLang,
    };

    try {
        const response = await fetch(DEEPL_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            if (response.status === 403) {
                 throw new Error("DeepL API key is invalid or has been rejected.");
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
