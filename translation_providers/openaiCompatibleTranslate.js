// disneyplus-dualsub-chrome-extension/translation_providers/openaiCompatibleTranslate.js

import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';

// Initialize logger for OpenAI-compatible translation provider
const logger = Logger.create('OpenAICompatibleTranslate');

// --- Helper Functions from openaiApi.js ---

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
        originalUrl: url,
        normalizedUrl: normalized,
        hadTrailingSlash: url !== normalized,
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

    if (baseUrl && baseUrl.includes('generativelanguage.googleapis.com')) {
        const normalized = model.startsWith('models/')
            ? model.substring(7)
            : model;

        logger.debug('Model name normalized for Gemini', {
            originalModel: model,
            normalizedModel: normalized,
            hadModelsPrefix: model.startsWith('models/'),
        });

        return normalized;
    }

    return model;
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
        baseUrl: result.baseUrl,
        model: result.model,
    });

    return result;
}

// -----------------------------------------

// Constants for API key validation
const GEMINI_API_KEY_PREFIX = 'AIza';
const GEMINI_API_KEY_MIN_LENGTH = 35;

// Constants for token calculation
const TOKEN_MULTIPLIER = 3; // Approximate tokens per character ratio for text estimation
const MAX_TOKENS = 4000;
const ERROR_TEXT_PREVIEW_LENGTH = 500;
const ERROR_TEXT_TRUNCATION_LIMIT = 200;

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
        textPreview: text?.substring(0, 50) + (text?.length > 50 ? '...' : ''),
    });

    // Get configuration from storage
    const config = await getConfig();

    // Enhanced logging for configuration debugging
    logger.debug('Configuration retrieved for translation', {
        hasApiKey: !!config.apiKey,
        apiKeyLength: config.apiKey ? config.apiKey.length : 0,
        baseUrl: config.baseUrl,
        model: config.model,
        isDefaultBaseUrl:
            config.baseUrl ===
            'https://generativelanguage.googleapis.com/v1beta/openai',
    });

    if (!config.apiKey) {
        const error = new Error(
            'OpenAI-compatible API key not configured. Please set your API key in the extension options.'
        );
        logger.error('API key not configured', error, {
            hasBaseUrl: !!config.baseUrl,
            hasModel: !!config.model,
            configDetails: JSON.stringify(config, null, 2),
        });
        throw error;
    }

    // Validate API key format for Gemini
    if (
        config.baseUrl?.includes('generativelanguage.googleapis.com') &&
        (!config.apiKey.startsWith(GEMINI_API_KEY_PREFIX) ||
            config.apiKey.length < GEMINI_API_KEY_MIN_LENGTH)
    ) {
        const error = new Error(
            `Invalid Google Gemini API key format. Gemini API keys should start with "${GEMINI_API_KEY_PREFIX}" and be at least ${GEMINI_API_KEY_MIN_LENGTH} characters long.`
        );
        logger.error('Invalid Gemini API key format detected', error, {
            apiKeyPrefix: config.apiKey.substring(0, 4),
            apiKeyLength: config.apiKey.length,
        });
        throw error;
    }

    // Normalize baseUrl to remove trailing slashes/backslashes
    const normalizedBaseUrl =
        normalizeBaseUrl(config.baseUrl) ||
        'https://generativelanguage.googleapis.com/v1beta/openai';
    const rawModel = config.model || 'gemini-1.5-flash';
    const model = normalizeModelName(rawModel, normalizedBaseUrl);
    const OPENAI_COMPATIBLE_URL = `${normalizedBaseUrl}/chat/completions`;

    logger.debug('API configuration prepared', {
        baseUrl: normalizedBaseUrl,
        rawModel: rawModel,
        normalizedModel: model,
        endpointUrl: OPENAI_COMPATIBLE_URL,
        originalBaseUrl: config.baseUrl,
        isGeminiEndpoint: normalizedBaseUrl.includes(
            'generativelanguage.googleapis.com'
        ),
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
        max_tokens: Math.min(MAX_TOKENS, text.length * TOKEN_MULTIPLIER), // Reasonable max tokens based on input length and multiplier
    };

    try {
        logger.debug('Making API request', {
            model: model,
            temperature: requestBody.temperature,
            maxTokens: requestBody.max_tokens,
            messageCount: requestBody.messages.length,
            endpointUrl: OPENAI_COMPATIBLE_URL,
            requestSize: JSON.stringify(requestBody).length,
        });

        const response = await fetch(OPENAI_COMPATIBLE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        logger.debug('API response received', {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            responseSize: response.headers.get('content-length'),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('OpenAI-Compatible API HTTP error', null, {
                status: response.status,
                statusText: response.statusText,
                responsePreview: errorText.substring(
                    0,
                    ERROR_TEXT_PREVIEW_LENGTH
                ),
                endpointUrl: OPENAI_COMPATIBLE_URL,
                fullErrorText: errorText,
                requestModel: model,
                isGeminiEndpoint: normalizedBaseUrl.includes(
                    'generativelanguage.googleapis.com'
                ),
            });

            // Enhanced error messages for common issues
            if (response.status === 401) {
                if (
                    normalizedBaseUrl.includes(
                        'generativelanguage.googleapis.com'
                    )
                ) {
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
                if (
                    normalizedBaseUrl.includes(
                        'generativelanguage.googleapis.com'
                    )
                ) {
                    throw new Error(
                        'API access forbidden. Please verify your API key has proper permissions and the Generative Language API is enabled.'
                    );
                }
                throw new Error(
                    'Translation API access forbidden. Please check your API permissions.'
                );
            } else if (response.status === 404) {
                if (
                    normalizedBaseUrl.includes(
                        'generativelanguage.googleapis.com'
                    )
                ) {
                    throw new Error(
                        `API endpoint not found. The OpenAI-compatible endpoint may not be available. Try using the correct base URL: https://generativelanguage.googleapis.com/v1beta/openai (without trailing slash)`
                    );
                }
                throw new Error(
                    `Translation API endpoint not found. Please verify the base URL: ${normalizedBaseUrl}`
                );
            } else if (response.status >= 500) {
                if (
                    normalizedBaseUrl.includes(
                        'generativelanguage.googleapis.com'
                    )
                ) {
                    throw new Error(
                        `API server error (${response.status}). The OpenAI-compatible endpoint may be experiencing issues. You might want to check Google's service status or try again later.`
                    );
                }
                throw new Error(
                    `Translation API server error (${response.status}). The service may be temporarily unavailable.`
                );
            }

            throw new Error(
                `Translation API HTTP error ${response.status}: ${errorText.substring(0, ERROR_TEXT_TRUNCATION_LIMIT)}`
            );
        }

        const data = await response.json();

        logger.debug('API response parsed', {
            hasChoices: !!data?.choices,
            choicesLength: data?.choices?.length || 0,
            hasUsage: !!data?.usage,
            tokensUsed: data?.usage?.total_tokens || 'unknown',
            responseStructure: Object.keys(data),
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
                    originalPreview: text.substring(0, 30),
                    translatedPreview: translatedText.substring(0, 30),
                });
                return translatedText;
            } else {
                logger.error('Empty translation received', null, {
                    responseData: data,
                    originalText: text.substring(0, 100),
                    fullResponse: JSON.stringify(data),
                });
                throw new Error(
                    'Translation Error: Empty response from translation service.'
                );
            }
        } else {
            logger.error(
                'Translation JSON parsing failed or unexpected structure',
                null,
                {
                    responseData: data,
                    hasChoices: !!data?.choices,
                    choicesLength: data?.choices?.length || 0,
                    fullResponse: JSON.stringify(data),
                    expectedStructure: 'data.choices[0].message.content',
                }
            );
            throw new Error(
                'Translation Error: Malformed response from OpenAI-compatible translation service.'
            );
        }
    } catch (error) {
        logger.error('API request/processing error occurred', error, {
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
            sourceLang,
            targetLang,
            textLength: text?.length || 0,
            textPreview: text?.substring(0, 50),
            endpointUrl: OPENAI_COMPATIBLE_URL,
            model: model,
            isNetworkError:
                error.name === 'TypeError' && error.message.includes('fetch'),
            configSnapshot: {
                hasApiKey: !!config.apiKey,
                baseUrl: config.baseUrl,
                model: config.model,
            },
        });

        // Provide more specific error messages for common network issues
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            throw new Error(
                'Translation Error: Network connection failed. Please check your internet connection and verify the API endpoint URL.'
            );
        }

        // Check for CORS issues
        if (error.message.includes('CORS')) {
            throw new Error(
                'Translation Error: CORS policy violation. This may indicate an incorrect API endpoint URL.'
            );
        }

        // Re-throw the error to be caught by the caller
        throw error;
    }
}

/**
 * Translates multiple texts in a single batch request using OpenAI-compatible API
 * @param {Array<string>} texts Array of texts to translate
 * @param {string} sourceLang The source language code (e.g., 'auto', 'en')
 * @param {string} targetLang The target language code (e.g., 'es', 'zh-CN')
 * @param {string} delimiter Delimiter to separate texts (default: '|SUBTITLE_BREAK|')
 * @returns {Promise<Array<string>>} A Promise that resolves with array of translated texts
 * @throws {Error} If the batch translation API request or processing fails
 */
export async function translateBatch(
    texts,
    sourceLang,
    targetLang,
    delimiter = '|SUBTITLE_BREAK|'
) {
    logger.info('Batch translation request initiated', {
        sourceLang,
        targetLang,
        textCount: texts.length,
        delimiter,
        totalLength: texts.reduce((sum, text) => sum + (text?.length || 0), 0),
    });

    if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('Invalid texts array for batch translation');
    }

    // For single text, use regular translate function
    if (texts.length === 1) {
        const result = await translate(texts[0], sourceLang, targetLang);
        return [result];
    }

    try {
        // Get configuration
        const config = await getConfig();

        if (!config.apiKey) {
            throw new Error(
                'OpenAI-compatible API key not configured for batch translation'
            );
        }

        // Prepare batch request
        const combinedText = texts.join(delimiter);
        const normalizedBaseUrl =
            normalizeBaseUrl(config.baseUrl) ||
            'https://generativelanguage.googleapis.com/v1beta/openai';
        const model = normalizeModelName(
            config.model || 'gemini-1.5-flash',
            normalizedBaseUrl
        );
        const OPENAI_COMPATIBLE_URL = `${normalizedBaseUrl}/chat/completions`;

        logger.debug('Batch translation configuration prepared', {
            textCount: texts.length,
            combinedLength: combinedText.length,
            model,
            endpointUrl: OPENAI_COMPATIBLE_URL,
        });

        // Create batch translation prompt
        const prompt = createBatchTranslationPrompt(
            combinedText,
            sourceLang,
            targetLang,
            delimiter
        );

        const requestBody = {
            model: model,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.3,
            max_tokens: Math.min(4000, combinedText.length * 2), // Estimate response length
        };

        logger.debug('Sending batch translation request', {
            model,
            promptLength: prompt.length,
            maxTokens: requestBody.max_tokens,
            textCount: texts.length,
        });

        const response = await fetch(OPENAI_COMPATIBLE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            const error = new Error(
                `Batch translation API request failed: ${response.status} ${response.statusText}. Response: ${errorText}`
            );
            logger.error('Batch translation API request failed', error, {
                status: response.status,
                statusText: response.statusText,
                responseText: errorText.substring(0, 500),
                textCount: texts.length,
            });
            throw error;
        }

        const data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            const error = new Error(
                'Invalid batch translation response structure'
            );
            logger.error('Invalid batch translation response', error, {
                hasChoices: !!data.choices,
                choicesLength: data.choices?.length || 0,
                responseStructure: JSON.stringify(data, null, 2).substring(
                    0,
                    500
                ),
            });
            throw error;
        }

        const translatedContent = data.choices[0].message.content;

        // Parse batch response
        const translatedTexts = parseBatchTranslationResponse(
            translatedContent,
            delimiter,
            texts.length
        );

        logger.info('Batch translation completed successfully', {
            originalCount: texts.length,
            translatedCount: translatedTexts.length,
            tokensUsed: data.usage?.total_tokens || 'unknown',
        });

        return translatedTexts;
    } catch (error) {
        logger.error(
            'Batch translation failed, falling back to individual translations',
            error,
            {
                textCount: texts.length,
                errorType: error.constructor.name,
            }
        );

        // Fallback to individual translations
        return await fallbackToIndividualTranslations(
            texts,
            sourceLang,
            targetLang
        );
    }
}

/**
 * Get human-readable language name from language code
 * @param {string} langCode Language code
 * @returns {string} Human-readable language name
 */
function getLanguageName(langCode) {
    const languageMap = {
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
        uk: 'Ukrainian',
        be: 'Belarusian',
        mk: 'Macedonian',
        sq: 'Albanian',
        sr: 'Serbian',
        bs: 'Bosnian',
        mt: 'Maltese',
        is: 'Icelandic',
        ga: 'Irish',
        cy: 'Welsh',
        eu: 'Basque',
        ca: 'Catalan',
        gl: 'Galician',
        tr: 'Turkish',
        he: 'Hebrew',
        fa: 'Persian',
        ur: 'Urdu',
        bn: 'Bengali',
        ta: 'Tamil',
        te: 'Telugu',
        ml: 'Malayalam',
        kn: 'Kannada',
        gu: 'Gujarati',
        pa: 'Punjabi',
        mr: 'Marathi',
        ne: 'Nepali',
        si: 'Sinhala',
        my: 'Myanmar',
        km: 'Khmer',
        lo: 'Lao',
        ka: 'Georgian',
        am: 'Amharic',
        sw: 'Swahili',
        zu: 'Zulu',
        af: 'Afrikaans',
        xh: 'Xhosa',
        st: 'Sesotho',
        tn: 'Setswana',
        ss: 'Siswati',
        ve: 'Venda',
        ts: 'Tsonga',
        nr: 'Ndebele',
    };

    return languageMap[langCode] || langCode;
}

/**
 * Create batch translation prompt
 * @param {string} combinedText Combined text with delimiters
 * @param {string} sourceLang Source language
 * @param {string} targetLang Target language
 * @param {string} delimiter Delimiter used
 * @returns {string} Translation prompt
 */
function createBatchTranslationPrompt(
    combinedText,
    sourceLang,
    targetLang,
    delimiter
) {
    const sourceLanguageName = getLanguageName(sourceLang);
    const targetLanguageName = getLanguageName(targetLang);

    return `Translate the following subtitle texts from ${sourceLanguageName} to ${targetLanguageName}.

The texts are separated by "${delimiter}". Please translate each text segment individually and return the translations in the same order, separated by the same delimiter "${delimiter}".

Important instructions:
1. Maintain the exact same number of text segments in your response
2. Preserve the meaning and context of each subtitle
3. Keep the translations natural and appropriate for subtitles
4. Do not add any additional text or explanations
5. Use "${delimiter}" to separate each translated segment

Text to translate:
${combinedText}

Translated text:`;
}

/**
 * Parse batch translation response
 * @param {string} response API response content
 * @param {string} delimiter Delimiter used
 * @param {number} expectedCount Expected number of translations
 * @returns {Array<string>} Array of translated texts
 */
function parseBatchTranslationResponse(response, delimiter, expectedCount) {
    if (!response || typeof response !== 'string') {
        throw new Error('Invalid batch translation response content');
    }

    // Split by delimiter and clean up
    const translations = response
        .split(delimiter)
        .map((text) => text.trim())
        .filter((text) => text.length > 0);

    logger.debug('Parsed batch translation response', {
        expectedCount,
        actualCount: translations.length,
        delimiter,
        responseLength: response.length,
    });

    // Validate count
    if (translations.length !== expectedCount) {
        logger.warn('Batch translation count mismatch', {
            expected: expectedCount,
            actual: translations.length,
            response: response.substring(0, 200),
        });

        // Pad with empty strings if we got fewer translations
        while (translations.length < expectedCount) {
            translations.push('');
        }

        // Trim if we got more translations
        if (translations.length > expectedCount) {
            translations.splice(expectedCount);
        }
    }

    return translations;
}

/**
 * Fallback to individual translations when batch fails
 * @param {Array<string>} texts Texts to translate
 * @param {string} sourceLang Source language
 * @param {string} targetLang Target language
 * @returns {Promise<Array<string>>} Array of translated texts
 */
async function fallbackToIndividualTranslations(texts, sourceLang, targetLang) {
    logger.info('Processing individual translations as fallback', {
        textCount: texts.length,
    });

    const results = [];
    for (let i = 0; i < texts.length; i++) {
        try {
            const translated = await translate(
                texts[i],
                sourceLang,
                targetLang
            );
            results.push(translated);

            // Add small delay between requests to avoid rate limiting
            if (i < texts.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        } catch (error) {
            logger.error('Individual translation failed in fallback', error, {
                textIndex: i,
                text: texts[i].substring(0, 50),
            });
            results.push(texts[i]); // Use original text as fallback
        }
    }

    return results;
}
