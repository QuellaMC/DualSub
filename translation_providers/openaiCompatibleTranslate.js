// disneyplus-dualsub-chrome-extension/translation_providers/openaiCompatibleTranslate.js

import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';

// Initialize logger for OpenAI-compatible translation provider
const logger = Logger.create('OpenAICompatibleTranslate');

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
        (!config.apiKey.startsWith('AIza') || config.apiKey.length < 35)) {
        const error = new Error('Invalid Google Gemini API key format. Gemini API keys should start with "AIza" and be at least 35 characters long.');
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
        max_tokens: Math.min(4000, text.length * 3), // Reasonable max tokens based on input length
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
                responsePreview: errorText.substring(0, 500),
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
            
            throw new Error(`Translation API HTTP error ${response.status}: ${errorText.substring(0, 200)}`);
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
 * Retrieves the configuration from configService.
 * @returns {Promise<Object>} Configuration object with apiKey, baseUrl, and model.
 */
async function getConfig() {
    try {
        logger.debug('Retrieving configuration from configService');
        
        // Get all OpenAI-compatible settings from configService
        const config = await configService.getMultiple([
            'openaiCompatibleApiKey',
            'openaiCompatibleBaseUrl', 
            'openaiCompatibleModel'
        ]);

        const result = {
            apiKey: config.openaiCompatibleApiKey || null,
            baseUrl: config.openaiCompatibleBaseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai',
            model: config.openaiCompatibleModel || 'gemini-1.5-flash'
        };

        logger.debug('Configuration retrieved successfully', {
            hasApiKey: !!result.apiKey,
            apiKeySource: config.openaiCompatibleApiKey ? 'configService' : 'null',
            baseUrl: result.baseUrl,
            baseUrlSource: config.openaiCompatibleBaseUrl ? 'configService' : 'default',
            model: result.model,
            modelSource: config.openaiCompatibleModel ? 'configService' : 'default',
            configServiceResponse: JSON.stringify(config)
        });

        return result;
    } catch (error) {
        logger.error('Error retrieving configuration from configService', error, {
            errorName: error.name,
            errorMessage: error.message,
            fallbackAction: 'Attempting chrome.storage fallback'
        });
        
        // Fallback to direct chrome.storage for backward compatibility
        logger.warn('Falling back to direct chrome.storage access');
        
        try {
            // Check if we're in a Chrome extension environment
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                return new Promise((resolve) => {
                    chrome.storage.sync.get([
                        'openaiCompatibleApiKey', 
                        'openaiCompatibleBaseUrl', 
                        'openaiCompatibleModel'
                    ], (result) => {
                        const config = {
                            apiKey: result.openaiCompatibleApiKey || null,
                            baseUrl: result.openaiCompatibleBaseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai',
                            model: result.openaiCompatibleModel || 'gemini-1.5-flash'
                        };
                        
                        logger.debug('Configuration retrieved via chrome.storage fallback', {
                            hasApiKey: !!config.apiKey,
                            baseUrl: config.baseUrl,
                            model: config.model,
                            chromeStorageResponse: JSON.stringify(result)
                        });
                        
                        resolve(config);
                    });
                });
            }
            
            // Final fallback to localStorage for testing/development
            const config = {
                apiKey: localStorage.getItem('openaiCompatibleApiKey'),
                baseUrl: localStorage.getItem('openaiCompatibleBaseUrl') || 'https://generativelanguage.googleapis.com/v1beta/openai',
                model: localStorage.getItem('openaiCompatibleModel') || 'gemini-1.5-flash'
            };
            
            logger.debug('Configuration retrieved via localStorage fallback', {
                hasApiKey: !!config.apiKey,
                baseUrl: config.baseUrl,
                model: config.model,
                localStorageKeys: ['openaiCompatibleApiKey', 'openaiCompatibleBaseUrl', 'openaiCompatibleModel']
            });
            
            return config;
        } catch (fallbackError) {
            logger.error('All configuration retrieval methods failed', fallbackError, {
                originalError: error.message,
                fallbackError: fallbackError.message,
                availableMethods: {
                    configService: false,
                    chromeStorage: typeof chrome !== 'undefined' && !!chrome.storage,
                    localStorage: typeof localStorage !== 'undefined'
                }
            });
            return {
                apiKey: null,
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
                model: 'gemini-1.5-flash'
            };
        }
    }
}

/**
 * Sets the API key using configService.
 * @param {string} apiKey The API key to store.
 * @returns {Promise<void>}
 */
export async function setApiKey(apiKey) {
    try {
        logger.debug('Setting API key via configService');
        await configService.set('openaiCompatibleApiKey', apiKey);
        logger.info('API key stored successfully');
    } catch (error) {
        logger.error('Error storing API key via configService', error);
        
        // Fallback to direct chrome.storage
        logger.warn('Falling back to direct chrome.storage for API key storage');
        
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                return new Promise((resolve, reject) => {
                    chrome.storage.sync.set({ openaiCompatibleApiKey: apiKey }, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            logger.info('API key stored via chrome.storage fallback');
                            resolve();
                        }
                    });
                });
            }
            
            // Fallback to localStorage for testing/development
            localStorage.setItem('openaiCompatibleApiKey', apiKey);
            logger.info('API key stored via localStorage fallback');
        } catch (fallbackError) {
            logger.error('All API key storage methods failed', fallbackError);
            throw fallbackError;
        }
    }
}

/**
 * Sets the base URL using configService.
 * @param {string} baseUrl The base URL to store.
 * @returns {Promise<void>}
 */
export async function setBaseUrl(baseUrl) {
    try {
        // Normalize the URL before storing
        const normalizedUrl = normalizeBaseUrl(baseUrl);
        
        logger.debug('Setting base URL via configService', {
            originalUrl: baseUrl,
            normalizedUrl: normalizedUrl
        });
        
        await configService.set('openaiCompatibleBaseUrl', normalizedUrl);
        logger.info('Base URL stored successfully');
    } catch (error) {
        logger.error('Error storing base URL via configService', error);
        
        // Fallback to direct chrome.storage
        logger.warn('Falling back to direct chrome.storage for base URL storage');
        
        const normalizedUrl = normalizeBaseUrl(baseUrl);
        
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                return new Promise((resolve, reject) => {
                    chrome.storage.sync.set({ openaiCompatibleBaseUrl: normalizedUrl }, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            logger.info('Base URL stored via chrome.storage fallback');
                            resolve();
                        }
                    });
                });
            }
            
            // Fallback to localStorage for testing/development
            localStorage.setItem('openaiCompatibleBaseUrl', normalizedUrl);
            logger.info('Base URL stored via localStorage fallback');
        } catch (fallbackError) {
            logger.error('All base URL storage methods failed', fallbackError);
            throw fallbackError;
        }
    }
}

/**
 * Sets the model using configService.
 * @param {string} model The model to store.
 * @returns {Promise<void>}
 */
export async function setModel(model) {
    try {
        logger.debug('Setting model via configService', { model });
        await configService.set('openaiCompatibleModel', model);
        logger.info('Model stored successfully', { model });
    } catch (error) {
        logger.error('Error storing model via configService', error);
        
        // Fallback to direct chrome.storage
        logger.warn('Falling back to direct chrome.storage for model storage');
        
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                return new Promise((resolve, reject) => {
                    chrome.storage.sync.set({ openaiCompatibleModel: model }, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            logger.info('Model stored via chrome.storage fallback');
                            resolve();
                        }
                    });
                });
            }
            
            // Fallback to localStorage for testing/development
            localStorage.setItem('openaiCompatibleModel', model);
            logger.info('Model stored via localStorage fallback');
        } catch (fallbackError) {
            logger.error('All model storage methods failed', fallbackError);
            throw fallbackError;
        }
    }
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
 * Tests the API connection and key validity.
 * @returns {Promise<boolean>} True if the API key is valid and working.
 */
export async function testConnection() {
    try {
        logger.debug('Testing API connection');
        
        // Test by fetching available models first
        const models = await getAvailableModels();
        if (models && models.length > 0) {
            logger.info('Connection test successful via models API', {
                modelCount: models.length
            });
            return true;
        }
        
        // Fallback: test with a simple translation
        logger.debug('Models API returned no results, testing with translation');
        const testResult = await translate('Hello', 'en', 'es');
        const isSuccess = testResult && testResult.length > 0;
        
        if (isSuccess) {
            logger.info('Connection test successful via translation test', {
                testResultLength: testResult.length
            });
        } else {
            logger.warn('Connection test failed: empty translation result');
        }
        
        return isSuccess;
    } catch (error) {
        logger.error('Connection test failed', error);
        return false;
    }
} 