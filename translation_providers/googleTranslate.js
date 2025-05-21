// disneyplus-dualsub-chrome-extension/translation_providers/googleTranslate.js

/**
 * Translates text using the Google Translate API.
 *
 * @param {string} text The text to translate.
 * @param {string} sourceLang The source language code (e.g., 'auto', 'en').
 * @param {string} targetLang The target language code (e.g., 'es', 'zh-CN').
 * @returns {Promise<string>} A Promise that resolves with the translated text.
 * @throws {Error} If the translation API request or processing fails.
 */
export async function translate(text, sourceLang, targetLang) {
    const G_TRANSLATE_URL = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    try {
        const response = await fetch(G_TRANSLATE_URL);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`GoogleTranslate: API HTTP error! Status: ${response.status}, Response: ${errorText.substring(0, 200)}`);
            throw new Error(`Translation API HTTP error ${response.status}.`);
        }

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            const data = await response.json();
            if (data && data[0] && Array.isArray(data[0]) && data[0][0] && typeof data[0][0][0] === 'string') {
                return data[0].map(sentence => sentence[0]).join('');
            } else {
                console.error("GoogleTranslate: Translation JSON parsing failed or unexpected structure. Response data:", data);
                throw new Error("Translation Error: Malformed JSON response from Google Translate.");
            }
        } else {
            const textResponse = await response.text();
            console.error(`GoogleTranslate: API did not return JSON. Content-Type: ${contentType}. Response (first 500 chars):`, textResponse.substring(0, 500));
            if (textResponse.includes("<title>Google</title>") && textResponse.includes("unusual traffic")) {
                throw new Error("Translation API blocked by Google: CAPTCHA or unusual traffic detected.");
            }
            throw new Error(`Translation API returned non-JSON (Content-Type: ${contentType}).`);
        }
    } catch (error) {
        console.error("GoogleTranslate: API request/processing error:", error);
        // Re-throw the error to be caught by the caller in background.js
        // or provide a more specific error message if desired.
        throw error; // Rethrowing the original error preserves its type and message
    }
}
