import { readRequiredProviderConfig } from '../context_providers/providerConfig.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import Logger from '../utils/logger.js';
import { TranslationProviderError } from './translationProviderError.js';

const logger = Logger.create('VertexGeminiTranslate');
const PROVIDER = 'vertex_gemini';
const FAILURE_MESSAGE = 'Vertex AI translation failed.';
const CONFIG_KEYS = [
    'vertexAccessToken',
    'vertexProjectId',
    'vertexLocation',
    'vertexModel',
];

function providerError(stage, metadata) {
    const status = Number.isSafeInteger(metadata?.status)
        ? metadata.status
        : undefined;
    try {
        logger.error('Vertex Gemini translation failed', null, {
            stage,
            ...(status === undefined ? {} : { status }),
        });
    } catch {}
    return new TranslationProviderError(FAILURE_MESSAGE, PROVIDER, metadata);
}

function classifyHttpStatus(status) {
    return {
        status,
        code:
            status === 401 || status === 403
                ? 'AUTHENTICATION_ERROR'
                : status === 429
                  ? 'RATE_LIMIT_EXCEEDED'
                  : status >= 500
                    ? 'UPSTREAM_ERROR'
                    : 'REQUEST_FAILED',
        retryable: status === 429 || status >= 500,
    };
}

async function readConfig() {
    try {
        const values = await readRequiredProviderConfig(CONFIG_KEYS);
        if (
            CONFIG_KEYS.some(
                (key) =>
                    typeof values[key] !== 'string' || values[key].trim() === ''
            )
        ) {
            throw new Error('Invalid Vertex configuration');
        }
        return values;
    } catch {
        throw providerError('config', {
            code: 'AUTHENTICATION_ERROR',
            retryable: false,
        });
    }
}

function buildRequest(text, sourceLang, targetLang, config) {
    try {
        const model = config.vertexModel.split('/').at(-1);
        const endpoint = `https://${config.vertexLocation}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(
            config.vertexProjectId
        )}/locations/${encodeURIComponent(
            config.vertexLocation
        )}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
        const prompt = [
            'You are a professional subtitle translator.',
            `Translate the following text from ${sourceLang} to ${targetLang}. Return only the translated text with no extra commentary.`,
            text,
        ].join('\n\n');

        return {
            endpoint,
            init: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.vertexAccessToken}`,
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        maxOutputTokens: Math.max(
                            256,
                            Math.min(2048, Math.ceil(text.length * 3))
                        ),
                    },
                }),
            },
        };
    } catch {
        throw providerError('request', {
            code: 'REQUEST_FAILED',
            retryable: false,
        });
    }
}

async function fetchTranslation(request) {
    let response;
    try {
        response = await fetchWithTimeout(request.endpoint, request.init);
    } catch {
        throw providerError('fetch', {
            code: 'NETWORK_ERROR',
            retryable: true,
        });
    }

    let ok;
    let status;
    try {
        ok = response.ok;
        status = response.status;
    } catch {
        throw providerError('response', {
            code: 'REQUEST_FAILED',
            retryable: false,
        });
    }

    if (ok !== true) {
        if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
            throw providerError('response', {
                code: 'REQUEST_FAILED',
                retryable: false,
            });
        }
        throw providerError('http', classifyHttpStatus(status));
    }

    try {
        const data = await response.json();
        const translatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (
            typeof translatedText !== 'string' ||
            translatedText.trim() === ''
        ) {
            throw new Error('Empty Vertex response');
        }
        return translatedText.trim();
    } catch {
        throw providerError('response', {
            code: 'REQUEST_FAILED',
            retryable: false,
        });
    }
}

export async function translate(text, sourceLang, targetLang) {
    if (typeof text !== 'string' || text.trim() === '') return '';

    const config = await readConfig();
    return fetchTranslation(buildRequest(text, sourceLang, targetLang, config));
}
