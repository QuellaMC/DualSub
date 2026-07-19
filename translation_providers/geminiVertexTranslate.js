import Logger from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import { configService } from '../services/configService.js';
import { parseTranslationArray } from './batchResponseParser.js';
import { TranslationProviderError } from './translationProviderError.js';

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

    const model = config.vertexModel || 'gemini-2.5-flash';

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

// Ensure model name is in short form (e.g., "gemini-1.5-flash"), removing any leading path like
// "models/gemini-1.5-flash" or "publishers/google/models/gemini-1.5-flash".
function normalizeModelName(model) {
    if (typeof model !== 'string' || !model) {
        return 'gemini-2.5-flash';
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

function createVertexHttpError(operation, response) {
    const error = new Error(
        `${operation}: ${response.status} ${response.statusText || ''}`.trim()
    );
    error.name = 'VertexHttpError';
    error.status = response.status;
    error.code =
        response.status === 401 || response.status === 403
            ? 'AUTHENTICATION_ERROR'
            : response.status === 429
              ? 'RATE_LIMIT_EXCEEDED'
              : response.status >= 500
                ? 'UPSTREAM_ERROR'
                : 'REQUEST_FAILED';
    error.retryable = response.status === 429 || response.status >= 500;
    return error;
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
            throw new Error(
                'Vertex access token, project, location, or model not configured.'
            );
        }

        const endpoint = buildVertexEndpoint(
            projectId,
            location,
            model,
            'generateContent'
        );

        logger.debug('Vertex single request prepared', {
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
                {
                    role: 'user',
                    parts: [
                        { text: `${systemPrompt}\n\n${userPrompt}\n\n${text}` },
                    ],
                },
            ],
            generationConfig: {
                maxOutputTokens: Math.max(
                    256,
                    Math.min(2048, Math.ceil(text.length * 3))
                ),
            },
        };

        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            logger.error('Vertex AI single translation failed', null, {
                status: response.status,
                contentType: response.headers?.get?.('content-type') || null,
            });
            throw createVertexHttpError(
                'Vertex translation request failed',
                response
            );
        }

        const data = await response.json();
        const responseText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!responseText) {
            throw new Error('Empty response from Vertex AI');
        }
        return typeof responseText === 'string'
            ? responseText.trim()
            : String(responseText);
    } catch (error) {
        logger.error('Fatal error during Vertex AI single translation', null, {
            errorType: error?.name || 'UnknownError',
            sourceLang,
            targetLang,
        });
        throw new TranslationProviderError(
            'Vertex AI translation failed.',
            'vertex_gemini',
            error
        );
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
    _delimiter = '|SUBTITLE_BREAK|'
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
            throw new Error(
                'Vertex access token, project, location, or model not configured.'
            );
        }

        const endpoint = buildVertexEndpoint(
            projectId,
            location,
            model,
            'generateContent'
        );

        const combinedText = JSON.stringify(texts);
        const sourceLanguageName = getLanguageName(sourceLang);
        const targetLanguageName = getLanguageName(targetLang);

        const instructions = `You are a professional subtitle translator. The user will provide a JSON array of subtitle strings. Translate every item from ${sourceLanguageName} to ${targetLanguageName}.

Important:
1. Return one valid JSON array containing exactly ${texts.length} strings in the original order.
2. Return only the JSON array with no explanations or markdown.
3. Preserve empty items as empty strings at the same indexes.
4. Keep style concise and natural for subtitles.`;

        const requestBody = {
            contents: [
                {
                    role: 'user',
                    parts: [{ text: `${instructions}\n\n${combinedText}` }],
                },
            ],
            generationConfig: {
                maxOutputTokens: Math.min(
                    4096,
                    Math.max(500, combinedText.length * 3)
                ),
            },
        };

        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            logger.error('Vertex AI batch translation failed', null, {
                status: response.status,
                contentType: response.headers?.get?.('content-type') || null,
            });
            throw createVertexHttpError(
                'Vertex batch translation request failed',
                response
            );
        }

        const data = await response.json();
        const responseText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!responseText) {
            throw new Error('Empty response from Vertex AI');
        }

        return parseTranslationArray(responseText, texts.length);
    } catch (error) {
        logger.error('Fatal error during Vertex AI batch translation', null, {
            errorType: error?.name || 'UnknownError',
            sourceLang,
            targetLang,
            textCount: texts.length,
        });
        throw new TranslationProviderError(
            'Vertex AI batch translation failed.',
            'vertex_gemini',
            error
        );
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
