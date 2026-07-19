// disneyplus-dualsub-chrome-extension/translation_providers/openaiCompatibleTranslate.js

import Logger from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import { configService } from '../services/configService.js';

// Initialize logger for OpenAI-compatible translation provider
const logger = Logger.create('OpenAICompatibleTranslate');

// --- Helper Functions from openaiApi.js ---

/**
 * Identifies the service provider based on the base URL.
 * @param {string} url The base URL.
 * @returns {'openai' | 'google' | 'unknown'} The provider type.
 */
function getProviderType(url) {
    if (typeof url !== 'string' || !url) {
        return 'unknown';
    }
    if (url.includes('api.openai.com')) {
        return 'openai';
    }
    if (url.includes('generativelanguage.googleapis.com')) {
        return 'google';
    }
    return 'unknown';
}

/**
 * Normalizes baseUrl by removing trailing slashes and backslashes
 * @param {string} url - The base URL to normalize
 * @returns {string} Normalized URL without trailing slashes
 */
function normalizeBaseUrl(url) {
    if (!url || typeof url !== 'string') {
        return url;
    }

    const normalized = url.replace(/[/\\]+$/, '');

    logger.debug('Base URL normalized', {
        hadTrailingSlash: url !== normalized,
        provider: getProviderType(normalized),
    });

    return normalized;
}

/**
 * Normalizes model name for OpenAI-compatible endpoints
 * @param {string} model - The model name to normalize
 * @param {string} baseUrl - The base URL to determine provider type
 * @returns {string} Normalized model name
 */
function normalizeModelName(model, baseUrl) {
    if (!model || typeof model !== 'string') {
        return model;
    }

    const provider = getProviderType(baseUrl);

    if (provider === 'google') {
        const normalized = model.startsWith('models/')
            ? model.substring(7)
            : model;

        logger.debug('Model name normalized for Gemini', {
            hadModelsPrefix: model.startsWith('models/'),
        });

        return normalized;
    }

    return model;
}

// New function to fetch available models
export async function fetchAvailableModels(apiKey, baseUrl) {
    const normalizedBaseUrl =
        normalizeBaseUrl(baseUrl) || 'https://api.openai.com/v1';
    const modelsUrl = `${normalizedBaseUrl}/models`;
    const provider = getProviderType(normalizedBaseUrl);

    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
    };

    try {
        const response = await fetchWithTimeout(modelsUrl, {
            method: 'GET',
            headers,
        });

        if (!response.ok) {
            const errorBody = await response.json();
            const errorMessage =
                errorBody?.error?.message ||
                `HTTP error! status: ${response.status}`;
            logger.error('Failed to fetch models', {
                status: response.status,
                provider,
                contentType: response.headers?.get?.('content-type') || null,
            });
            throw new Error(errorMessage);
        }

        const data = await response.json();
        let models;

        // Standard OpenAI format
        if (data.data && Array.isArray(data.data)) {
            models = data.data.map((model) => model.id);
        }
        // Google's format
        else if (data.models && Array.isArray(data.models)) {
            models = data.models
                .map((model) => model.name)
                .filter((name) => name.includes('models/gemini'));
        } else {
            throw new Error('Unsupported models format');
        }

        logger.info('Successfully fetched models', {
            modelCount: models.length,
            provider,
        });
        return models;
    } catch (error) {
        logger.error('Error fetching available models:', {
            errorType: error?.name || 'UnknownError',
            provider,
        });
        throw error;
    }
}

/**
 * Retrieves the configuration from storage using the config service.
 * @returns {Promise<Object>} Configuration object with apiKey, baseUrl, and model.
 */
async function getConfig() {
    logger.debug('Retrieving configuration via configService');

    const config = await configService.getMultiple([
        'openaiCompatibleApiKey',
        'openaiCompatibleBaseUrl',
        'openaiCompatibleModel',
    ]);

    const result = {
        apiKey: config.openaiCompatibleApiKey,
        baseUrl: config.openaiCompatibleBaseUrl,
        model: config.openaiCompatibleModel,
    };

    logger.debug('Configuration retrieved successfully via configService', {
        hasApiKey: !!result.apiKey,
        hasBaseUrl: !!result.baseUrl,
        hasModel: !!result.model,
    });

    return result;
}

/**
 * Translates text using OpenAI-compatible API with Gemini models.
 * This provider uses Gemini's OpenAI compatibility endpoint to leverage
 * advanced language models for translation tasks.
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
        textLength: text?.length || 0,
    });

    // Get configuration from storage
    const config = await getConfig();

    // Enhanced logging for configuration debugging
    logger.debug('Configuration retrieved for translation', {
        hasApiKey: !!config.apiKey,
        hasBaseUrl: !!config.baseUrl,
        hasModel: !!config.model,
    });

    if (!config.apiKey) {
        const error = new Error(
            'OpenAI-compatible API key not configured. Please set your API key in the extension options.'
        );
        logger.error('API key not configured', error, {
            hasBaseUrl: !!config.baseUrl,
            hasModel: !!config.model,
        });
        throw error;
    }

    // Normalize baseUrl to remove trailing slashes/backslashes
    const normalizedBaseUrl =
        normalizeBaseUrl(config.baseUrl) || 'https://api.openai.com/v1';
    const rawModel = config.model || 'gemini-3.5-flash';
    const model = normalizeModelName(rawModel, normalizedBaseUrl);
    const OPENAI_COMPATIBLE_URL = `${normalizedBaseUrl}/chat/completions`;
    const provider = getProviderType(normalizedBaseUrl);

    logger.debug('API configuration prepared', {
        provider,
        modelNormalized: rawModel !== model,
    });

    // Map language codes to full language names for better model understanding
    const languageNameMap = {
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
        tr: 'Turkish',
        he: 'Hebrew',
        auto: 'auto-detected language',
    };

    const sourceLangName = languageNameMap[sourceLang] || sourceLang;
    const targetLangName = languageNameMap[targetLang] || targetLang;

    // Create the prompt for translation
    const systemPrompt = `You are a professional translator. Translate the given text accurately from ${sourceLangName} to ${targetLangName}. Only return the translated text without any additional comments, explanations, or formatting.`;

    const userPrompt = text;

    const requestBody = {
        model: model,
        messages: [
            {
                role: 'system',
                content: systemPrompt,
            },
            {
                role: 'user',
                content: userPrompt,
            },
        ],
        temperature: 0.1, // Low temperature for consistent translations
        max_tokens: 10000, // Increased token allocation
    };

    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
    };

    try {
        logger.debug('Making API request', {
            model: model,
            temperature: requestBody.temperature,
            maxTokens: requestBody.max_tokens,
            messageCount: requestBody.messages.length,
            requestSize: JSON.stringify(requestBody).length,
            provider,
        });

        const response = await fetchWithTimeout(OPENAI_COMPATIBLE_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
        });

        logger.debug('API response received', {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            responseSize: response.headers.get('content-length'),
        });

        if (!response.ok) {
            logger.error('OpenAI-Compatible API HTTP error', null, {
                status: response.status,
                contentType: response.headers?.get?.('content-type') || null,
                responseSize: response.headers?.get?.('content-length') || null,
                provider,
            });

            // Enhanced error messages for common issues
            if (response.status === 401) {
                if (provider === 'google') {
                    throw new Error(
                        'API authentication failed. Please check your Google API key and ensure the Generative Language API is enabled in your Google Cloud project.'
                    );
                }
                throw new Error(
                    'Translation API authentication failed. Please check your API key.'
                );
            } else if (response.status === 429) {
                throw new Error(
                    'Translation API rate limit exceeded. Please try again later or check your quota limits.'
                );
            } else if (response.status === 403) {
                if (provider === 'google') {
                    throw new Error(
                        'API access forbidden. Please verify your API key has proper permissions and the Generative Language API is enabled.'
                    );
                }
                throw new Error(
                    'Translation API access forbidden. Please check your API permissions.'
                );
            } else if (response.status === 404) {
                if (provider === 'google') {
                    throw new Error(
                        `API endpoint not found. The OpenAI-compatible endpoint may not be available. Try using the correct base URL: https://generativelanguage.googleapis.com/v1beta/openai (without trailing slash)`
                    );
                }
                throw new Error(
                    'Translation API endpoint not found. Please verify the configured base URL.'
                );
            } else if (response.status >= 500) {
                if (provider === 'google') {
                    throw new Error(
                        `API server error (${response.status}). The OpenAI-compatible endpoint may be experiencing issues. You might want to check Google's service status or try again later.`
                    );
                }
                throw new Error(
                    `Translation API server error (${response.status}). The service may be temporarily unavailable.`
                );
            }

            throw new Error(`Translation API HTTP error ${response.status}.`);
        }

        const data = await response.json();

        logger.debug('API response parsed', {
            hasChoices: !!data?.choices,
            choicesLength: data?.choices?.length || 0,
            hasUsage: !!data?.usage,
            tokensUsed: data?.usage?.total_tokens || 'unknown',
            topLevelKeyCount:
                data && typeof data === 'object' ? Object.keys(data).length : 0,
        });

        if (
            data &&
            data.choices &&
            data.choices.length > 0 &&
            data.choices[0].message &&
            data.choices[0].message.content
        ) {
            const translatedText = data.choices[0].message.content.trim();

            // Basic validation to ensure we got a translation
            if (translatedText && translatedText.length > 0) {
                logger.info('Translation completed successfully', {
                    originalLength: text.length,
                    translatedLength: translatedText.length,
                    model: model,
                    tokensUsed: data.usage?.total_tokens || 'unknown',
                });
                return translatedText;
            } else {
                logger.error('Empty translation received', null, {
                    originalLength: text.length,
                    hasChoices: true,
                    choicesLength: data.choices.length,
                    hasUsage: !!data.usage,
                });
                throw new Error(
                    'Translation Error: Empty response from translation service.'
                );
            }
        } else if (
            data?.output?.[0]?.content &&
            Array.isArray(data.output[0].content)
        ) {
            // Flexible parsing for 'output' format
            const contentArray = data.output[0].content;
            const textBlock = contentArray.find(
                (item) => item && typeof item.text === 'string'
            );

            if (textBlock) {
                const translatedText = textBlock.text.trim();
                logger.info(
                    'Parsed translation from OpenAI "Responses" API format (flexible).',
                    {
                        status: data.status,
                        outputCount: data.output.length,
                    }
                );
                if (translatedText.length > 0) {
                    logger.info('Translation completed successfully', {
                        originalLength: text.length,
                        translatedLength: translatedText.length,
                        model: model,
                        tokensUsed: data.usage?.total_tokens || 'unknown',
                    });
                    return translatedText;
                } else {
                    logger.error('Empty translation received', null, {
                        originalLength: text.length,
                        hasOutput: true,
                        outputCount: data.output.length,
                        hasUsage: !!data.usage,
                    });
                    throw new Error(
                        'Translation Error: Empty response from translation service.'
                    );
                }
            }
        } else {
            logger.error(
                'Translation JSON parsing failed or unexpected structure',
                null,
                {
                    hasChoices: !!data?.choices,
                    choicesLength: data?.choices?.length || 0,
                    hasOutput: Array.isArray(data?.output),
                    outputCount: Array.isArray(data?.output)
                        ? data.output.length
                        : 0,
                    responseType: Array.isArray(data) ? 'array' : typeof data,
                    expectedStructure:
                        'data.choices[0].message.content or data.output[0].content[0].text',
                }
            );
            throw new Error(
                'Translation Error: Malformed response from OpenAI-compatible translation service.'
            );
        }
    } catch (error) {
        const errorMessage =
            typeof error?.message === 'string' ? error.message : '';
        logger.error('API request/processing error occurred', null, {
            errorType: error?.name || 'UnknownError',
            sourceLang,
            targetLang,
            textLength: text?.length || 0,
            isNetworkError:
                error?.name === 'TypeError' && errorMessage.includes('fetch'),
            isCorsError: errorMessage.includes('CORS'),
            provider,
            configSnapshot: {
                hasApiKey: !!config.apiKey,
                hasBaseUrl: !!config.baseUrl,
                hasModel: !!config.model,
            },
        });

        // Provide more specific error messages for common network issues
        if (error?.name === 'TypeError' && errorMessage.includes('fetch')) {
            throw new Error(
                'Translation Error: Network connection failed. Please check your internet connection and verify the API endpoint URL.'
            );
        }

        // Check for CORS issues
        if (errorMessage.includes('CORS')) {
            throw new Error(
                'Translation Error: CORS policy violation. This may indicate an incorrect API endpoint URL.'
            );
        }

        // Re-throw the error to be caught by the caller
        throw error;
    }
}
