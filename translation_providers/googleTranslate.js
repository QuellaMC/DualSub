// disneyplus-dualsub-chrome-extension/translation_providers/googleTranslate.js

import Logger from '../utils/logger.js';

// Initialize logger for Google Translate provider
const logger = Logger.create('GoogleTranslate');

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
    logger.info('Translation request initiated', { 
        sourceLang, 
        targetLang, 
        textLength: text?.length || 0 
    });
    const G_TRANSLATE_URL = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    try {
        const response = await fetch(G_TRANSLATE_URL);
        if (!response.ok) {
            const errorText = await response.text();
            logger.error('Google Translate API HTTP error', null, {
                status: response.status,
                statusText: response.statusText,
                responsePreview: errorText.substring(0, 200)
            });
            throw new Error(`Translation API HTTP error ${response.status}.`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (
                data &&
                data[0] &&
                Array.isArray(data[0]) &&
                data[0][0] &&
                typeof data[0][0][0] === 'string'
            ) {
                const translatedText = data[0].map((sentence) => sentence[0]).join('');
                logger.info('Translation completed successfully', {
                    translatedLength: translatedText.length,
                    sentenceCount: data[0].length
                });
                return translatedText;
            } else {
                logger.error('Translation JSON parsing failed or unexpected structure', null, {
                    responseData: data
                });
                throw new Error(
                    'Translation Error: Malformed JSON response from Google Translate.'
                );
            }
        } else {
            const textResponse = await response.text();
            logger.error('Google Translate API did not return JSON', null, {
                contentType,
                responsePreview: textResponse.substring(0, 500)
            });
            if (
                textResponse.includes('<title>Google</title>') &&
                textResponse.includes('unusual traffic')
            ) {
                throw new Error(
                    'Translation API blocked by Google: CAPTCHA or unusual traffic detected.'
                );
            }
            throw new Error(
                `Translation API returned non-JSON (Content-Type: ${contentType}).`
            );
        }
    } catch (error) {
        logger.error('API request/processing error occurred', error, {
            sourceLang,
            targetLang,
            textLength: text?.length || 0
        });
        // Re-throw the error to be caught by the caller in background.js
        // or provide a more specific error message if desired.
        throw error; // Rethrowing the original error preserves its type and message
    }
}
