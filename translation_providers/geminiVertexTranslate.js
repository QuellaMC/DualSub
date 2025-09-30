import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';

// Initialize logger for the Vertex AI Gemini translation provider
const logger = Logger.create('VertexGeminiTranslate');

/**
 * Retrieves the necessary configuration for the Vertex AI API from the extension's settings.
 * Mirrors the Rust code's separation of endpoint/model and auth, but uses an
 * already-provisioned OAuth access token from settings (service worker cannot run SA OAuth).
 * @returns {Promise<{accessToken: string, projectId: string, location: string, model: string}>}
 */
async function getConfig() {
    logger.debug('Retrieving Vertex AI config via configService');
    const config = await configService.getMultiple([
        'vertexAccessToken',
        'vertexProjectId',
        'vertexLocation',
        'vertexModel',
    ]);
    // test gpg sign

    const model = config.vertexModel || 'gemini-1.5-flash';

    logger.debug('Vertex AI configuration retrieved', {
        hasAccessToken: !!config.vertexAccessToken,
        hasProjectId: !!config.vertexProjectId,
        location: config.vertexLocation,
        model,
    });

    return {
        accessToken: config.vertexAccessToken,
        projectId: config.vertexProjectId,
        location: config.vertexLocation || 'us-central1',
        model,
    };
}

/**
 * Parses a text response that may contain JSON wrapped in markdown code fences.
 * Accepts either raw delimited text or a JSON array string.
 * @param {string} responseText - The raw text from the API response.
 * @returns {any} The parsed JSON object/array or raw string.
 */
function parsePossiblyJson(responseText) {
    if (typeof responseText !== 'string' || responseText.trim() === '') {
        return '';
    }
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```|(\[[\s\S]*\])/);
    const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : null;
    if (!jsonString) {
        return responseText;
    }
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        logger.warn('Response looked like JSON but failed to parse, using raw text.');
        return responseText;
    }
}


// Ensure model name is in short form (e.g., "gemini-1.5-flash"), removing any leading path like
// "models/gemini-1.5-flash" or "publishers/google/models/gemini-1.5-flash".
function normalizeModelName(model) {
    if (typeof model !== 'string' || !model) {
        return 'gemini-1.5-flash';
    }
    const parts = model.split('/');
    const last = parts[parts.length - 1];
    return last || model;
}

function buildVertexEndpoint(projectId, location, model, method) {
    const host = `https://${location}-aiplatform.googleapis.com`;
    const normalizedModel = normalizeModelName(model);
    return `${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(
        location
    )}/publishers/google/models/${encodeURIComponent(normalizedModel)}:${method}`;
}

/**
 * Translates a batch of texts using the Google Cloud Vertex AI Gemini API.
 *
 * @param {string|string[]} text - The text or array of texts to translate.
 * @param {string} sourceLang - The source language code (e.g., 'en').
 * @param {string} targetLang - The target language code (e.g., 'es').
 * @returns {Promise<string[]>} A promise that resolves to an array of translated texts.
 */
export async function translate(text, sourceLang, targetLang) {
    if (typeof text !== 'string' || text.trim() === '') {
        return '';
    }

    try {
        const { accessToken, projectId, location, model } = await getConfig();
        if (!accessToken || !projectId || !location || !model) {
            throw new Error('Vertex access token, project, location, or model not configured.');
        }

        const endpoint = buildVertexEndpoint(
            projectId,
            location,
            model,
            'generateContent'
        );

        logger.debug('Vertex single request prepared', {
            endpoint,
            projectId,
            location,
            model: normalizeModelName(model),
            textLength: text.length,
            sourceLang,
            targetLang,
        });

        const systemPrompt = `You are a professional subtitle translator.`;
        const userPrompt = `Translate the following text from ${sourceLang} to ${targetLang}. Return only the translated text with no extra commentary.`;

        const requestBody = {
            contents: [
                { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}\n\n${text}` }] },
            ],
            generationConfig: {
                temperature: 0.1,
                topP: 0.95,
                maxOutputTokens: Math.max(256, Math.min(2048, Math.ceil(text.length * 3))),
            },
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = errorText.substring(0, 500);
            try {
                const parsed = JSON.parse(errorText);
                if (parsed && parsed.error && parsed.error.message) {
                    errorMessage = parsed.error.message;
                }
            } catch (e) {}
            logger.error(
                'Vertex AI single translation failed',
                null,
                {
                    status: response.status,
                    statusText: response.statusText,
                    endpoint,
                    errorMessage,
                }
            );
            throw new Error(`Vertex translation error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!responseText) {
            throw new Error('Empty response from Vertex AI');
        }
        return typeof responseText === 'string' ? responseText.trim() : String(responseText);
    } catch (error) {
        logger.error(
            'Fatal error during Vertex AI single translation',
            error,
            {
                sourceLang,
                targetLang,
            }
        );
        return text; // Fallback to original
    }
}

/**
 * Translates multiple texts in a single request using Vertex Gemini generateContent.
 * Uses a delimiter strategy similar to the OpenAI-compatible provider.
 * @param {Array<string>} texts
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {string} delimiter
 * @returns {Promise<Array<string>>}
 */
export async function translateBatch(
    texts,
    sourceLang,
    targetLang,
    delimiter = '|SUBTITLE_BREAK|'
) {
    if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('Invalid texts array for batch translation');
    }
    if (texts.length === 1) {
        const single = await translate(texts[0], sourceLang, targetLang);
        return [single];
    }

    try {
        const { accessToken, projectId, location, model } = await getConfig();
        if (!accessToken || !projectId || !location || !model) {
            throw new Error('Vertex access token, project, location, or model not configured.');
        }

        const endpoint = buildVertexEndpoint(
            projectId,
            location,
            model,
            'generateContent'
        );

        const combinedText = texts.join(delimiter);
        const sourceLanguageName = getLanguageName(sourceLang);
        const targetLanguageName = getLanguageName(targetLang);

        const instructions = `You are a professional subtitle translator. Translate the following subtitle segments from ${sourceLanguageName} to ${targetLanguageName}. The segments are separated by the delimiter "${delimiter}".

Important:
1. Preserve the number of segments and their order.
2. Only return the translated segments, separated by the same delimiter "${delimiter}".
3. Do not add the delimiter at the start or end.
4. Keep style concise and natural for subtitles.`;

        const requestBody = {
            contents: [
                { role: 'user', parts: [{ text: `${instructions}\n\n${combinedText}` }] },
            ],
            generationConfig: {
                temperature: 0.1,
                topP: 0.95,
                maxOutputTokens: Math.min(4096, Math.max(500, combinedText.length * 3)),
            },
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = errorText.substring(0, 500);
            try {
                const parsed = JSON.parse(errorText);
                if (parsed && parsed.error && parsed.error.message) {
                    errorMessage = parsed.error.message;
                }
            } catch (e) {}
            logger.error(
                'Vertex AI batch translation failed',
                null,
                {
                    status: response.status,
                    statusText: response.statusText,
                    endpoint,
                    errorMessage,
                }
            );
            throw new Error(`Vertex batch translation error: ${response.status}`);
        }

        const data = await response.json();
        const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!responseText) {
            throw new Error('Empty response from Vertex AI');
        }

        // Some models might return JSON instead; handle that gracefully
        const parsed = parsePossiblyJson(responseText);
        if (Array.isArray(parsed)) {
            // Ensure array length matches input size
            if (parsed.length !== texts.length) {
                throw new Error('Translated array length does not match input array length.');
            }
            return parsed.map((s) => (typeof s === 'string' ? s : String(s)));
        }

        const split = String(parsed).split(delimiter);
        if (split.length !== texts.length) {
            // Try trimming and re-splitting as a small recovery attempt
            const alt = String(parsed).trim();
            const altSplit = alt.split(delimiter);
            if (altSplit.length !== texts.length) {
                throw new Error('Translated segments count mismatch');
            }
            return altSplit.map((s) => s.trim());
        }
        return split.map((s) => s.trim());
    } catch (error) {
        logger.error(
            'Fatal error during Vertex AI batch translation',
            error,
            {
                sourceLang,
                targetLang,
                textCount: texts.length,
            }
        );
        return texts; // Fallback to original array
    }
}

// Minimal language code to name mapping for better prompts (kept local to avoid extra deps)
function getLanguageName(langCode) {
    const map = {
        auto: 'auto-detected language',
        en: 'English',
        es: 'Spanish',
        fr: 'French',
        de: 'German',
        it: 'Italian',
        pt: 'Portuguese',
        ru: 'Russian',
        ja: 'Japanese',
        ko: 'Korean',
        zh: 'Chinese',
        'zh-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)',
        ar: 'Arabic',
        hi: 'Hindi',
        th: 'Thai',
        vi: 'Vietnamese',
        nl: 'Dutch',
        sv: 'Swedish',
        da: 'Danish',
        no: 'Norwegian',
        fi: 'Finnish',
        pl: 'Polish',
        cs: 'Czech',
        hu: 'Hungarian',
        ro: 'Romanian',
        bg: 'Bulgarian',
        hr: 'Croatian',
        sk: 'Slovak',
        sl: 'Slovenian',
        et: 'Estonian',
        lv: 'Latvian',
        lt: 'Lithuanian',
        tr: 'Turkish',
    };
    return map[langCode] || langCode;
}
