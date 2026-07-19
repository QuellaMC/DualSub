/**
 * OpenAI Context Provider
 *
 * Provides AI-powered cultural, historical, and linguistic context analysis
 * using OpenAI's GPT models through OpenAI-compatible endpoints.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import Logger from '../utils/logger.js';
import { validateSetting } from '../config/configSchema.js';
import {
    getContextSchema,
    CONTEXT_SCHEMA_NAME,
    validateAgainstSchema,
} from './contextSchemas.js';
import { isRetryableContextError } from './retryPolicy.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import { readRequiredProviderConfig } from './providerConfig.js';

const logger = Logger.create('OpenAIContextProvider');
const OPENAI_CONFIGURATION_ERROR_MESSAGE =
    'OpenAI provider configuration is invalid';
const OPENAI_REQUIRED_CONFIG_KEYS = Object.freeze([
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
    'aiContextTimeout',
]);

/**
 * Available OpenAI models for context analysis
 */
export const OPENAI_MODELS = [
    {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        description: 'Optimized for cost-sensitive context analysis',
        contextWindow: 1050000,
        recommended: true,
    },
    {
        id: 'gpt-5.6-terra',
        name: 'GPT-5.6 Terra',
        description: 'Balances analysis quality and cost',
        contextWindow: 1050000,
        recommended: false,
    },
    {
        id: 'gpt-5.6',
        name: 'GPT-5.6',
        description: 'Frontier model for the most demanding analysis',
        contextWindow: 1050000,
        recommended: false,
    },
];

/**
 * Get available models for this provider
 * @returns {Array} Array of model objects
 */
export function getAvailableModels() {
    return OPENAI_MODELS;
}

/**
 * Get the default model for this provider
 * @returns {string} Default model ID
 */
export function getDefaultModel() {
    const recommended = OPENAI_MODELS.find((model) => model.recommended);
    return recommended ? recommended.id : OPENAI_MODELS[0].id;
}

/**
 * Normalizes a provider base URL to the versioned OpenAI-compatible API root.
 * @param {string} url - The base URL to normalize
 * @returns {string} Normalized URL ending in /v1
 */
function normalizeBaseUrl(url) {
    if (!url || typeof url !== 'string') {
        return url;
    }

    const withoutTrailingSeparators = url.replace(/[/\\]+$/, '');
    const normalized = /\/v1$/i.test(withoutTrailingSeparators)
        ? withoutTrailingSeparators
        : `${withoutTrailingSeparators}/v1`;

    logger.debug('Base URL normalized', {
        changed: url !== normalized,
        isGoogleEndpoint: normalized.includes(
            'generativelanguage.googleapis.com'
        ),
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
            hadModelsPrefix: model.startsWith('models/'),
        });

        return normalized;
    }

    return model;
}

/**
 * Get language name for the target language code
 * @param {string} langCode - Language code (e.g., 'en', 'es', 'fr')
 * @returns {string} Human-readable language name
 */
function getLanguageName(langCode) {
    const languageNames = {
        en: 'English',
        es: 'Spanish',
        fr: 'French',
        de: 'German',
        it: 'Italian',
        pt: 'Portuguese',
        ru: 'Russian',
        ja: 'Japanese',
        ko: 'Korean',
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
        tr: 'Turkish',
        he: 'Hebrew',
    };
    return (
        languageNames[langCode] || (langCode === 'auto' ? 'Unknown' : langCode)
    );
}

/**
 * Creates specialized prompts for different types of context analysis
 * @param {string} text - The text to analyze
 * @param {string} contextType - Type of context ('cultural', 'historical', 'linguistic')
 * @param {Object} metadata - Additional context metadata
 * @returns {string} Formatted prompt for the AI model
 */
function createContextPrompt(text, contextType, metadata = {}) {
    const { targetLanguage = 'unknown', surroundingContext = '' } = metadata;

    // Get language name for the target language code
    const targetLanguageName = getLanguageName(targetLanguage);

    const baseContext = `
Analyze this text for ${contextType} context:

Text to analyze: "${text}"
Target language for response: ${targetLanguage} (${targetLanguageName})
${surroundingContext ? `Context: "${surroundingContext}"` : ''}

CRITICAL INSTRUCTIONS:
1. First, IDENTIFY the language of the "Text to analyze"
2. Write your ENTIRE response in ${targetLanguageName} language
3. Analyze and discuss the content, culture, and context of the identified source language
4. Explain cultural/historical/linguistic aspects TO a ${targetLanguageName} speaker
5. Do NOT analyze ${targetLanguageName} language or culture - focus on the source material
6. Help ${targetLanguageName} speakers understand this text better

Provide a clear, educational explanation that helps ${targetLanguageName} speakers understand the deeper meaning of this content.
`;

    switch (contextType) {
        case 'cultural':
            return (
                baseContext +
                `
Provide a comprehensive cultural analysis of this text in the following JSON structure:
{
  "definition": "Clear definition or meaning of this expression",
  "cultural_context": {
    "origins": "Cultural origins and background of this expression",
    "social_context": "How this is used in the source culture and conversational context",
    "regional_variations": "How this expression varies across different regions speaking the source language"
  },
  "usage": {
    "examples": ["Usage example 1", "Usage example 2", "Usage example 3"],
    "when_to_use": "When speakers of the source language use this expression",
    "formality_level": "Formality level in the source culture"
  },
  "cultural_significance": "Why this expression is culturally important in the source culture",
  "learning_tips": "Practical advice for ${targetLanguageName} speakers learning the source language",
  "related_expressions": ["Similar expression 1", "Similar expression 2"],
  "sensitivities": "Cultural sensitivities ${targetLanguageName} speakers should know about this expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${targetLanguageName} but analyze the source content.`
            );

        case 'historical':
            return (
                baseContext +
                `
Provide a detailed historical analysis of this text in the following JSON structure:
{
  "definition": "Clear definition or meaning of this expression",
  "historical_context": {
    "time_period": "Historical period relevant to this expression",
    "historical_figures": "Important historical figures connected to this expression",
    "events": "Historical events that shaped this expression"
  },
  "evolution": {
    "original_meaning": "How this expression was originally used",
    "changes_over_time": "How this expression's meaning evolved",
    "modern_usage": "How this expression is used today"
  },
  "historical_significance": "Why this expression is historically important in the source culture/history",
  "examples": ["Historical usage example 1", "Historical usage example 2"],
  "related_terms": ["Related historical term 1", "Related historical term 2"],
  "learning_context": "How understanding the source history helps ${targetLanguageName} speakers learn this expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${targetLanguageName} but analyze the historical context of the source.`
            );

        case 'linguistic':
            return (
                baseContext +
                `
Provide an in-depth linguistic analysis of this text in the following JSON structure:
{
  "definition": "Clear definition or meaning of this expression",
  "etymology": {
    "word_origins": "Language family and root origins of this expression",
    "historical_development": "How this word/phrase developed linguistically"
  },
  "grammar": {
    "structure": "Grammatical structure and patterns of this expression",
    "usage_rules": "Grammar rules for proper usage"
  },
  "semantics": {
    "literal_meaning": "Literal meaning before translation",
    "connotations": "Implied meanings and connotations",
    "register": "Formal/informal/technical classification"
  },
  "translation_notes": "Why this expression is challenging to translate to ${targetLanguageName}",
  "examples": ["Linguistic example 1", "Linguistic example 2"],
  "related_forms": ["Related word 1", "Related word 2"],
  "learning_tips": "Specific tips for ${targetLanguageName} speakers to master this expression linguistically"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${targetLanguageName} but analyze the linguistic aspects of the source.`
            );

        default:
            return (
                baseContext +
                `
Provide a comprehensive analysis of this text covering cultural, historical, and linguistic aspects in the following JSON structure:
{
  "definition": "Clear definition or meaning of this expression",
  "cultural_analysis": {
    "cultural_context": "Cultural background and significance",
    "social_usage": "How this is used socially in the source culture",
    "regional_notes": "Regional or cultural variations within the source language-speaking areas"
  },
  "historical_analysis": {
    "origins": "Historical origins and background",
    "evolution": "How this expression evolved over time",
    "historical_significance": "Historical importance in the source culture"
  },
  "linguistic_analysis": {
    "etymology": "Word origins and linguistic development",
    "grammar_notes": "Grammatical considerations",
    "translation_notes": "Why this expression is challenging to translate to ${targetLanguageName}"
  },
  "practical_usage": {
    "examples": ["Example 1", "Example 2", "Example 3"],
    "when_to_use": "When speakers of the source language use this expression",
    "formality": "Formality level in the source culture"
  },
  "learning_tips": "Comprehensive advice for ${targetLanguageName} speakers learning the source language",
  "related_expressions": ["Related expression 1", "Related expression 2"],
  "key_insights": "Most important things for ${targetLanguageName} speakers to understand about this expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${targetLanguageName} but analyze the source content.`
            );
    }
}

/**
 * Analyzes text for cultural, historical, and linguistic context using OpenAI-compatible API
 * @param {string} text - The text to analyze
 * @param {string} contextType - Type of context analysis ('cultural', 'historical', 'linguistic', 'all')
 * @param {Object} metadata - Additional context metadata
 * @returns {Promise<Object>} Context analysis result
 */
export async function analyzeContext(text, contextType = 'all', metadata = {}) {
    logger.info('Context analysis request initiated', {
        textLength: text?.length || 0,
        contextType,
        sourceLanguage: metadata.sourceLanguage,
        targetLanguage: metadata.targetLanguage,
    });

    // Validate input
    if (!text || typeof text !== 'string' || text.trim() === '') {
        logger.warn('Empty or invalid text provided for context analysis', {
            valueType: typeof text,
            textLength: typeof text === 'string' ? text.length : 0,
        });
        return {
            success: false,
            error: 'Invalid text provided',
            contextType,
            text: text || '',
        };
    }

    try {
        const config = await readRequiredProviderConfig(
            OPENAI_REQUIRED_CONFIG_KEYS
        );
        const { openaiApiKey, openaiBaseUrl, openaiModel, aiContextTimeout } =
            config;

        if (
            !validateSetting('openaiApiKey', openaiApiKey) ||
            openaiApiKey.trim() === ''
        ) {
            throw new Error('OpenAI API key not configured');
        }
        if (
            !validateSetting('openaiBaseUrl', openaiBaseUrl) ||
            !validateSetting('openaiModel', openaiModel) ||
            !validateSetting('aiContextTimeout', aiContextTimeout)
        ) {
            throw new Error(OPENAI_CONFIGURATION_ERROR_MESSAGE);
        }

        const normalizedBaseUrl = normalizeBaseUrl(openaiBaseUrl);
        const normalizedModel = normalizeModelName(
            openaiModel,
            normalizedBaseUrl
        );
        const apiUrl = `${normalizedBaseUrl}/chat/completions`;

        const prompt = createContextPrompt(text, contextType, metadata);
        const jsonSchema = getContextSchema(contextType);

        const requestBody = {
            model: normalizedModel,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are an expert cultural, historical, and linguistic analyst specializing in helping language learners understand nuanced context. Provide comprehensive yet concise explanations that include specific details, examples, and actionable insights. Focus on practical understanding that enhances language learning and cultural awareness.',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: CONTEXT_SCHEMA_NAME,
                    schema: jsonSchema,
                    strict: true,
                },
            },
        };

        logger.debug('Making context analysis request', {
            contextType,
            promptLength: prompt.length,
            isGoogleEndpoint: normalizedBaseUrl.includes(
                'generativelanguage.googleapis.com'
            ),
        });

        const response = await fetchWithTimeout(
            apiUrl,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${openaiApiKey}`,
                },
                body: JSON.stringify(requestBody),
            },
            aiContextTimeout
        );

        if (!response.ok) {
            logger.error('Context analysis API request failed', {
                status: response.status,
                contentType: response.headers?.get?.('content-type') || null,
            });
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            logger.error('Invalid response format from context analysis API', {
                responseType: Array.isArray(data) ? 'array' : typeof data,
                hasChoices: Array.isArray(data?.choices),
                choicesLength: Array.isArray(data?.choices)
                    ? data.choices.length
                    : 0,
            });
            throw new Error('Invalid response format from API');
        }

        const rawResponse = data.choices[0].message.content.trim();

        let structuredAnalysis;

        try {
            structuredAnalysis = JSON.parse(rawResponse);
            if (!validateAgainstSchema(jsonSchema, structuredAnalysis)) {
                logger.warn('Schema validation failed', {
                    responseLength: rawResponse.length,
                    analysisType: Array.isArray(structuredAnalysis)
                        ? 'array'
                        : typeof structuredAnalysis,
                });
                return {
                    success: false,
                    error: 'Schema validation failed',
                    contextType,
                    originalText: text,
                    metadata,
                    shouldRetry: true,
                    shouldCache: false,
                };
            }
        } catch (error) {
            logger.warn('Failed to parse JSON response', {
                errorType: error?.name || 'UnknownError',
                responseLength: rawResponse.length,
            });
            return {
                success: false,
                error: 'Malformed JSON response',
                contextType,
                originalText: text,
                metadata,
                shouldRetry: true,
                shouldCache: false,
            };
        }

        logger.info('Context analysis completed successfully', {
            contextType,
            responseLength: rawResponse.length,
            tokensUsed: data.usage?.total_tokens || 'unknown',
        });

        return {
            success: true,
            contextType,
            analysis: structuredAnalysis,
            isStructured: true,
            originalText: text,
            metadata,
            usage: data.usage,
            shouldCache: true,
        };
    } catch (error) {
        logger.error('Context analysis failed', null, {
            errorType: error?.name || 'UnknownError',
            textLength: text?.length || 0,
            contextType,
            shouldRetry: isRetryableContextError(error),
        });

        return {
            success: false,
            error: error.message,
            contextType,
            originalText: text,
            metadata,
            shouldRetry: isRetryableContextError(error),
            shouldCache: false,
        };
    }
}
