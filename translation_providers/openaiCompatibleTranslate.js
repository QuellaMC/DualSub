// disneyplus-dualsub-chrome-extension/translation_providers/openaiCompatibleTranslate.js

import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';

// Initialize logger for OpenAI-compatible translation provider
const logger = Logger.create('OpenAICompatibleTranslate');

// Constants for API key validation
const GEMINI_API_KEY_PREFIX = 'AIza';
const GEMINI_API_KEY_MIN_LENGTH = 35;

// Constants for token calculation
const TOKEN_MULTIPLIER = 3; // Approximate tokens per character ratio for text estimation
const MAX_TOKENS = 4000;
const ERROR_TEXT_PREVIEW_LENGTH = 500;
const ERROR_TEXT_TRUNCATION_LIMIT = 200;

/**
 * Normalizes baseUrl by removing trailing slashes and backslashes
 * @param {string} url - The base URL to normalize
 * @returns {string} Normalized URL without trailing slashes
 */
function normalizeBaseUrl(url) {
    if (!url || typeof url !== 'string') {
        return url;
    }
    
    // Remove trailing slashes and backslashes
    const normalized = url.replace(/[/\\]+$/, '');
    
    logger.debug('Base URL normalized', {
        originalUrl: url,
        normalizedUrl: normalized,
        hadTrailingSlash: url !== normalized
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
    
    // For Google Gemini API, remove "models/" prefix if present
    if (baseUrl && baseUrl.includes('generativelanguage.googleapis.com')) {
        const normalized = model.startsWith('models/') ? model.substring(7) : model;
        
        logger.debug('Model name normalized for Gemini', {
            originalModel: model,
            normalizedModel: normalized,
            hadModelsPrefix: model.startsWith('models/')
        });
        
        return normalized;
    }
    
    return model;
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
        isDefaultBaseUrl: config.baseUrl === 'https://generativelanguage.googleapis.com/v1beta/openai'
    });
    
    if (!config.apiKey) {
        const error = new Error('OpenAI-compatible API key not configured. Please set your API key in the extension options.');
        logger.error('API key not configured', error, {
            hasBaseUrl: !!config.baseUrl,
            hasModel: !!config.model,
            configDetails: JSON.stringify(config, null, 2)
        });
        throw error;
    }
    
    // Validate API key format for Gemini
    if (config.baseUrl?.includes('generativelanguage.googleapis.com') && 
        (!config.apiKey.startsWith(GEMINI_API_KEY_PREFIX) || config.apiKey.length < GEMINI_API_KEY_MIN_LENGTH)) {
        const error = new Error(`Invalid Google Gemini API key format. Gemini API keys should start with "${GEMINI_API_KEY_PREFIX}" and be at least ${GEMINI_API_KEY_MIN_LENGTH} characters long.`);
        logger.error('Invalid Gemini API key format detected', error, {
            apiKeyPrefix: config.apiKey.substring(0, 4),
            apiKeyLength: config.apiKey.length
        });
        throw error;
    }
    
    // Normalize baseUrl to remove trailing slashes/backslashes
    const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta/openai';
    const rawModel = config.model || 'gemini-1.5-flash';
    const model = normalizeModelName(rawModel, normalizedBaseUrl);
    const OPENAI_COMPATIBLE_URL = `${normalizedBaseUrl}/chat/completions`;

    logger.debug('API configuration prepared', {
        baseUrl: normalizedBaseUrl,
        rawModel: rawModel,
        normalizedModel: model,
        endpointUrl: OPENAI_COMPATIBLE_URL,
        originalBaseUrl: config.baseUrl,
        isGeminiEndpoint: normalizedBaseUrl.includes('generativelanguage.googleapis.com'),
        modelNormalized: rawModel !== model
    });

    // Map language codes to full language names for better model understanding
    const languageNameMap = {
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian',
        'pt': 'Portuguese',
        'ru': 'Russian',
        'ja': 'Japanese',
        'ko': 'Korean',
        'zh': 'Chinese',
        'zh-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)',
        'ar': 'Arabic',
        'hi': 'Hindi',
        'th': 'Thai',
        'vi': 'Vietnamese',
        'nl': 'Dutch',
        'sv': 'Swedish',
        'da': 'Danish',
        'no': 'Norwegian',
        'fi': 'Finnish',
        'pl': 'Polish',
        'tr': 'Turkish',
        'he': 'Hebrew',
        'auto': 'auto-detected language'
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
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: userPrompt
            }
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
            requestSize: JSON.stringify(requestBody).length
        });

        const response = await fetch(OPENAI_COMPATIBLE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        logger.debug('API response received', {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            responseSize: response.headers.get('content-length')
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('OpenAI-Compatible API HTTP error', null, {
                status: response.status,
                statusText: response.statusText,
                responsePreview: errorText.substring(0, ERROR_TEXT_PREVIEW_LENGTH),
                endpointUrl: OPENAI_COMPATIBLE_URL,
                fullErrorText: errorText,
                requestModel: model,
                isGeminiEndpoint: normalizedBaseUrl.includes('generativelanguage.googleapis.com')
            });
            
            // Enhanced error messages for common issues
            if (response.status === 401) {
                if (normalizedBaseUrl.includes('generativelanguage.googleapis.com')) {
                    throw new Error('Gemini API authentication failed. Please check your Google API key and ensure the Generative Language API is enabled in your Google Cloud project.');
                }
                throw new Error('Translation API authentication failed. Please check your API key.');
            } else if (response.status === 429) {
                throw new Error('Translation API rate limit exceeded. Please try again later or check your quota limits.');
            } else if (response.status === 403) {
                if (normalizedBaseUrl.includes('generativelanguage.googleapis.com')) {
                    throw new Error('Gemini API access forbidden. Please verify your API key has proper permissions and the Generative Language API is enabled.');
                }
                throw new Error('Translation API access forbidden. Please check your API permissions.');
            } else if (response.status === 404) {
                if (normalizedBaseUrl.includes('generativelanguage.googleapis.com')) {
                    throw new Error(`Gemini API endpoint not found. The OpenAI-compatible endpoint may not be available. Try using the correct base URL: https://generativelanguage.googleapis.com/v1beta/openai (without trailing slash)`);
                }
                throw new Error(`Translation API endpoint not found. Please verify the base URL: ${normalizedBaseUrl}`);
            } else if (response.status >= 500) {
                if (normalizedBaseUrl.includes('generativelanguage.googleapis.com')) {
                    throw new Error(`Gemini API server error (${response.status}). The OpenAI-compatible endpoint may be experiencing issues. You might want to check Google's service status or try again later.`);
                }
                throw new Error(`Translation API server error (${response.status}). The service may be temporarily unavailable.`);
            }
            
            throw new Error(`Translation API HTTP error ${response.status}: ${errorText.substring(0, ERROR_TEXT_TRUNCATION_LIMIT)}`);
        }

        const data = await response.json();
        
        logger.debug('API response parsed', {
            hasChoices: !!data?.choices,
            choicesLength: data?.choices?.length || 0,
            hasUsage: !!data?.usage,
            tokensUsed: data?.usage?.total_tokens || 'unknown',
            responseStructure: Object.keys(data)
        });
        
        if (data && data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
            const translatedText = data.choices[0].message.content.trim();
            
            // Basic validation to ensure we got a translation
            if (translatedText && translatedText.length > 0) {
                logger.info('Translation completed successfully', {
                    originalLength: text.length,
                    translatedLength: translatedText.length,
                    model: model,
                    tokensUsed: data.usage?.total_tokens || 'unknown',
                    originalPreview: text.substring(0, 30),
                    translatedPreview: translatedText.substring(0, 30)
                });
                return translatedText;
            } else {
                logger.error('Empty translation received', null, {
                    responseData: data,
                    originalText: text.substring(0, 100),
                    fullResponse: JSON.stringify(data)
                });
                throw new Error('Translation Error: Empty response from translation service.');
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
                    expectedStructure: 'data.choices[0].message.content'
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
            isNetworkError: error.name === 'TypeError' && error.message.includes('fetch'),
            configSnapshot: {
                hasApiKey: !!config.apiKey,
                baseUrl: config.baseUrl,
                model: config.model
            }
        });
        
        // Provide more specific error messages for common network issues
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            throw new Error('Translation Error: Network connection failed. Please check your internet connection and verify the API endpoint URL.');
        }
        
        // Check for CORS issues
        if (error.message.includes('CORS')) {
            throw new Error('Translation Error: CORS policy violation. This may indicate an incorrect API endpoint URL.');
        }
        
        // Re-throw the error to be caught by the caller
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
        'openaiCompatibleModel'
    ]);

    const result = {
        apiKey: config.openaiCompatibleApiKey,
        baseUrl: config.openaiCompatibleBaseUrl,
        model: config.openaiCompatibleModel
    };

    logger.debug('Configuration retrieved successfully via configService', {
        hasApiKey: !!result.apiKey,
        baseUrl: result.baseUrl,
        model: result.model
    });

    return result;
}

/**
 * Sets the API key using the config service.
 * @param {string} apiKey The API key to store.
 * @returns {Promise<void>}
 */
export async function setApiKey(apiKey) {
    logger.debug('Setting API key via configService');
    await configService.set('openaiCompatibleApiKey', apiKey);
    logger.info('API key stored successfully');
}

/**
 * Sets the base URL using the config service.
 * @param {string} baseUrl The base URL to store.
 * @returns {Promise<void>}
 */
export async function setBaseUrl(baseUrl) {
    // Normalize the URL before storing
    const normalizedUrl = normalizeBaseUrl(baseUrl);
    
    logger.debug('Setting base URL via configService', {
        originalUrl: baseUrl,
        normalizedUrl: normalizedUrl
    });
    
    await configService.set('openaiCompatibleBaseUrl', normalizedUrl);
    logger.info('Base URL stored successfully');
}

/**
 * Sets the model using the config service.
 * @param {string} model The model to store.
 * @returns {Promise<void>}
 */
export async function setModel(model) {
    logger.debug('Setting model via configService', { model });
    await configService.set('openaiCompatibleModel', model);
    logger.info('Model stored successfully', { model });
}

/**
 * Fetches available models from the API.
 * @returns {Promise<Array>} Array of available models.
 */
export async function getAvailableModels() {
    try {
        logger.debug('Fetching available models from API');
        
        const config = await getConfig();
        if (!config.apiKey) {
            const error = new Error('API key not configured');
            logger.error('Cannot fetch models: API key not configured', error);
            throw error;
        }

        const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta/openai';
        const modelsUrl = `${normalizedBaseUrl}/models`;

        logger.debug('Making models API request', {
            modelsUrl: modelsUrl,
            hasApiKey: !!config.apiKey
        });

        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('Models API HTTP error', null, {
                status: response.status,
                statusText: response.statusText,
                responsePreview: errorText.substring(0, 200),
                modelsUrl: modelsUrl
            });
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const models = data.data || [];
        
        logger.info('Available models fetched successfully', {
            modelCount: models.length,
            modelNames: models.map(m => m.id || m.name).slice(0, 5) // Log first 5 model names
        });
        
        return models;
    } catch (error) {
        logger.error('Error fetching available models', error);
        throw error;
    }
}

/**
 * Tests the API connection and key validity using lightweight endpoints.
 * @returns {Promise<boolean>} True if the API key is valid and working.
 */
export async function testConnection() {
    try {
        logger.debug('Testing API connection');
        
        const config = await getConfig();
        if (!config.apiKey) {
            logger.warn('Cannot test connection: API key not configured');
            return false;
        }

        const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta/openai';
        
        // Method 1: Try /models endpoint (lightweight and doesn't consume quota)
        try {
            const models = await getAvailableModels();
            if (models && models.length > 0) {
                logger.info('Connection test successful via models API', {
                    modelCount: models.length
                });
                return true;
            }
        } catch (modelsError) {
            logger.debug('Models endpoint failed, trying alternative methods', {
                error: modelsError.message
            });
        }
        
        // Method 2: Try HEAD request to base URL (most lightweight)
        try {
            logger.debug('Testing connection with HEAD request', {
                baseUrl: normalizedBaseUrl
            });
            
            const headResponse = await fetch(normalizedBaseUrl, {
                method: 'HEAD',
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`
                }
            });
            
            // Consider 2xx, 4xx responses as connection success (server is reachable)
            // 401/403 means server is reachable but auth issue
            if (headResponse.status < 500) {
                logger.info('Connection test successful via HEAD request', {
                    status: headResponse.status,
                    statusText: headResponse.statusText
                });
                return true;
            }
        } catch (headError) {
            logger.debug('HEAD request failed, trying health endpoint', {
                error: headError.message
            });
        }
        
        // Method 3: Try common health endpoints
        const healthEndpoints = ['/health', '/v1/health', '/status'];
        
        for (const healthPath of healthEndpoints) {
            try {
                const healthUrl = `${normalizedBaseUrl}${healthPath}`;
                logger.debug('Testing health endpoint', { healthUrl });
                
                const healthResponse = await fetch(healthUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${config.apiKey}`
                    }
                });
                
                if (healthResponse.ok) {
                    logger.info('Connection test successful via health endpoint', {
                        healthUrl: healthUrl,
                        status: healthResponse.status
                    });
                    return true;
                }
            } catch (healthError) {
                logger.debug('Health endpoint failed', {
                    endpoint: healthPath,
                    error: healthError.message
                });
            }
        }
        
        // Method 4: Minimal API test (avoid translation to save quota)
        // Try a very simple chat completion with minimal tokens
        try {
            logger.debug('Testing with minimal API call');
            
            const model = normalizeModelName(config.model || 'gemini-1.5-flash', normalizedBaseUrl);
            const testUrl = `${normalizedBaseUrl}/chat/completions`;
            
            const minimalRequest = {
                model: model,
                messages: [
                    {
                        role: "user",
                        content: "Hi"
                    }
                ],
                max_tokens: 1, // Minimal token usage
                temperature: 0
            };
            
            const testResponse = await fetch(testUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify(minimalRequest)
            });
            
            if (testResponse.ok) {
                logger.info('Connection test successful via minimal API call', {
                    status: testResponse.status
                });
                return true;
            } else {
                logger.debug('Minimal API call failed', {
                    status: testResponse.status,
                    statusText: testResponse.statusText
                });
            }
        } catch (apiError) {
            logger.debug('Minimal API call failed', {
                error: apiError.message
            });
        }
        
        // If all methods fail, log warning and return false
        logger.warn('All connection test methods failed - API may be unreachable or misconfigured');
        return false;
        
    } catch (error) {
        logger.error('Connection test failed with unexpected error', error);
        return false;
    }
} 