import Logger from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import { configService } from '../services/configService.js';
import {
    getTrustedTranslationProviderErrorMetadata,
    TranslationProviderError,
} from './translationProviderError.js';

// Initialize logger for the Vertex AI Gemini translation provider
const logger = Logger.create('VertexGeminiTranslate');
const PROVIDER = 'vertex_gemini';
const CONFIG_KEYS = Object.freeze([
    'vertexAccessToken',
    'vertexProjectId',
    'vertexLocation',
    'vertexModel',
]);
const OWN_DATA_MISSING = Symbol('own-data-missing');
const NETWORK_ERROR_METADATA = Object.freeze({
    code: 'NETWORK_ERROR',
    retryable: true,
});
const AUTHENTICATION_ERROR_METADATA = Object.freeze({
    code: 'AUTHENTICATION_ERROR',
    retryable: false,
});
const REQUEST_ERROR_METADATA = Object.freeze({
    code: 'REQUEST_FAILED',
    retryable: false,
});

function createOperationContext() {
    return {
        failureMessage: 'Vertex AI translation failed.',
    };
}

function readOwnDataValue(record, key) {
    if (
        record === null ||
        (typeof record !== 'object' && typeof record !== 'function')
    ) {
        return OWN_DATA_MISSING;
    }

    try {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return descriptor && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : OWN_DATA_MISSING;
    } catch {
        return OWN_DATA_MISSING;
    }
}

function copyStrictConfigValues(result) {
    // ConfigService authenticates the outer result identity. Keep this
    // consumer bounded to the exact values projection and ignore all public
    // compatibility metadata on the result object.
    const values = readOwnDataValue(result, 'values');
    if (
        values === OWN_DATA_MISSING ||
        values === null ||
        (typeof values !== 'object' && typeof values !== 'function')
    ) {
        return null;
    }

    let ownKeys;
    try {
        ownKeys = Reflect.ownKeys(values);
    } catch {
        return null;
    }
    if (
        ownKeys.length !== CONFIG_KEYS.length ||
        CONFIG_KEYS.some((key) => !ownKeys.includes(key))
    ) {
        return null;
    }

    const copied = {};
    for (const key of CONFIG_KEYS) {
        const value = readOwnDataValue(values, key);
        if (typeof value !== 'string' || value.trim() === '') {
            return null;
        }
        copied[key] = value;
    }

    try {
        if (typeof globalThis.structuredClone !== 'function') return null;
        globalThis.structuredClone(values);
    } catch {
        return null;
    }
    return Object.freeze(copied);
}

function createStageError(context, stage, metadata) {
    const trustedStatus =
        Number.isSafeInteger(metadata.status) &&
        metadata.status >= 100 &&
        metadata.status <= 599
            ? metadata.status
            : undefined;
    const error = new TranslationProviderError(
        context.failureMessage,
        PROVIDER,
        metadata
    );
    try {
        logger.error('Vertex Gemini translation stage failed', null, {
            stage,
            ...(trustedStatus === undefined ? {} : { status: trustedStatus }),
        });
    } catch {}
    return error;
}

async function runAsyncStage(context, stage, metadata, operation) {
    try {
        return await operation();
    } catch {
        throw createStageError(context, stage, metadata);
    }
}

function runSyncStage(context, stage, metadata, operation) {
    try {
        return operation();
    } catch {
        throw createStageError(context, stage, metadata);
    }
}

function rethrowTrustedOrRequestError(error, context) {
    if (getTrustedTranslationProviderErrorMetadata(error) !== null) {
        throw error;
    }
    throw createStageError(context, 'request', REQUEST_ERROR_METADATA);
}

function createHttpError(context, status) {
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
        return createStageError(context, 'response', REQUEST_ERROR_METADATA);
    }

    const metadata = {
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
    return createStageError(context, 'http', metadata);
}

function readHttpFailureStatus(context, response) {
    return runSyncStage(context, 'response', REQUEST_ERROR_METADATA, () => {
        if (response.ok === true) return null;
        const status = response.status;
        if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
            throw new Error('Vertex response status is invalid.');
        }
        return status;
    });
}

async function readResponseText(context, response) {
    return await runAsyncStage(
        context,
        'response',
        REQUEST_ERROR_METADATA,
        async () => {
            const data = await response.json();
            const responseText =
                data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (
                typeof responseText !== 'string' ||
                responseText.trim() === ''
            ) {
                throw new Error('Empty response from Vertex AI');
            }
            return responseText.trim();
        }
    );
}

/**
 * Retrieves the necessary configuration for the Vertex AI API from the extension's settings.
 * Mirrors the Rust code's separation of endpoint/model and auth, but uses an
 * already-provisioned OAuth access token from settings (service worker cannot run SA OAuth).
 * @returns {Promise<{accessToken: string, projectId: string, location: string, model: string}>}
 */
async function getConfig(context) {
    return await runAsyncStage(
        context,
        'config',
        AUTHENTICATION_ERROR_METADATA,
        async () => {
            const result = await configService.readMultipleResultStrict(
                CONFIG_KEYS,
                { includeSensitive: true }
            );
            const values = copyStrictConfigValues(result);
            if (values === null) {
                throw new Error('Vertex configuration is incomplete.');
            }
            return {
                accessToken: values.vertexAccessToken,
                projectId: values.vertexProjectId,
                location: values.vertexLocation,
                model: values.vertexModel,
            };
        }
    );
}

// Ensure model name is in short form (e.g., "gemini-1.5-flash"), removing any leading path like
// "models/gemini-1.5-flash" or "publishers/google/models/gemini-1.5-flash".
function normalizeModelName(model) {
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
 * Translates text using the Google Cloud Vertex AI Gemini API.
 *
 * @param {string} text - The text to translate.
 * @param {string} sourceLang - The source language code (e.g., 'en').
 * @param {string} targetLang - The target language code (e.g., 'es').
 * @returns {Promise<string>} A promise that resolves to translated text.
 */
export async function translate(text, sourceLang, targetLang) {
    if (typeof text !== 'string' || text.trim() === '') {
        return '';
    }

    const operationContext = createOperationContext();
    try {
        const { accessToken, projectId, location, model } =
            await getConfig(operationContext);

        const request = runSyncStage(
            operationContext,
            'request',
            REQUEST_ERROR_METADATA,
            () => {
                const endpoint = buildVertexEndpoint(
                    projectId,
                    location,
                    model,
                    'generateContent'
                );
                const systemPrompt = `You are a professional subtitle translator.`;
                const userPrompt = `Translate the following text from ${sourceLang} to ${targetLang}. Return only the translated text with no extra commentary.`;
                const requestBody = {
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    text: `${systemPrompt}\n\n${userPrompt}\n\n${text}`,
                                },
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
                return {
                    endpoint,
                    init: {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${accessToken}`,
                        },
                        body: JSON.stringify(requestBody),
                    },
                };
            }
        );

        const response = await runAsyncStage(
            operationContext,
            'fetch',
            NETWORK_ERROR_METADATA,
            () => fetchWithTimeout(request.endpoint, request.init)
        );

        const failureStatus = readHttpFailureStatus(operationContext, response);
        if (failureStatus !== null) {
            throw createHttpError(operationContext, failureStatus);
        }

        const responseText = await readResponseText(operationContext, response);
        return responseText;
    } catch (error) {
        rethrowTrustedOrRequestError(error, operationContext);
    }
}
