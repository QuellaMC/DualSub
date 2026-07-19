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
import { configService } from '../services/configService.js';
import {
    getContextSchema,
    CONTEXT_SCHEMA_NAME,
    validateAgainstSchema,
} from './contextSchemas.js';

const logger = Logger.create('OpenAIContextProvider');

/**
 * Available OpenAI models for context analysis
 */
export const OPENAI_MODELS = [
    {
        id: 'gpt-4.1-nano-2025-04-14',
        name: 'GPT-4.1 Nano',
        description: 'Cost-effective for most context analysis tasks',
        contextWindow: 8192,
        recommended: false,
    },
    {
        id: 'gpt-4.1-mini-2025-04-14',
        name: 'GPT-4.1 Mini',
        description: 'High-quality analysis with better cultural understanding',
        contextWindow: 128000,
        recommended: true,
    },
    {
        id: 'gpt-4o-mini-2024-07-18',
        name: 'GPT-4o Mini',
        description: 'Optimized for speed and efficiency',
        contextWindow: 128000,
        recommended: false,
    },
    {
        id: 'gpt-4o-2024-08-06',
        name: 'GPT-4o',
        description: 'Optimized for speed and efficiency',
        contextWindow: 128000,
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
    const {
        sourceLanguage = 'unknown',
        targetLanguage = 'unknown',
        surroundingContext = '',
    } = metadata;

    // Get language name for the target language code
    const targetLanguageName = getLanguageName(targetLanguage);
    const sourceLanguageName = getLanguageName(sourceLanguage);

    const baseContext = `
Analyze this ${sourceLanguageName} text for ${contextType} context:

Text to analyze: "${text}"
Source language: ${sourceLanguage} (${sourceLanguageName})
Target language for response: ${targetLanguage} (${targetLanguageName})
${surroundingContext ? `Context: "${surroundingContext}"` : ''}

CRITICAL INSTRUCTIONS:
1. Write your ENTIRE response in ${targetLanguageName} language
2. Analyze and discuss the ${sourceLanguageName} language content, culture, and context
3. Explain ${sourceLanguageName} cultural/historical/linguistic aspects TO a ${targetLanguageName} speaker
4. Do NOT analyze ${targetLanguageName} language or culture - focus on the ${sourceLanguageName} source material
5. Help ${targetLanguageName} speakers understand this ${sourceLanguageName} text better

Provide a clear, educational explanation that helps ${targetLanguageName} speakers understand the deeper meaning of this ${sourceLanguageName} content.
`;

    switch (contextType) {
        case 'cultural':
            return (
                baseContext +
                `
Provide a comprehensive cultural analysis of this ${sourceLanguageName} text in the following JSON structure:
{
  "definition": "Clear definition or meaning of this ${sourceLanguageName} expression",
  "cultural_context": {
    "origins": "${sourceLanguageName} cultural origins and background of this expression",
    "social_context": "How this is used in ${sourceLanguageName} society and conversational context",
    "regional_variations": "How this ${sourceLanguageName} expression varies across different ${sourceLanguageName}-speaking regions"
  },
  "usage": {
    "examples": ["${sourceLanguageName} usage example 1", "${sourceLanguageName} usage example 2", "${sourceLanguageName} usage example 3"],
    "when_to_use": "When ${sourceLanguageName} speakers use this expression",
    "formality_level": "Formality level in ${sourceLanguageName} culture"
  },
  "cultural_significance": "Why this expression is culturally important in ${sourceLanguageName} culture",
  "learning_tips": "Practical advice for ${targetLanguageName} speakers learning ${sourceLanguageName}",
  "related_expressions": ["Similar ${sourceLanguageName} expression 1", "Similar ${sourceLanguageName} expression 2"],
  "sensitivities": "Cultural sensitivities ${targetLanguageName} speakers should know about this ${sourceLanguageName} expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${targetLanguageName} but analyze the ${sourceLanguageName} content.`
            );

        case 'historical':
            return (
                baseContext +
                `
Provide a detailed historical analysis of this ${sourceLanguageName} text in the following JSON structure:
{
  "definition": "Clear definition or meaning of this ${sourceLanguageName} expression",
  "historical_context": {
    "time_period": "Historical period relevant to this ${sourceLanguageName} expression",
    "historical_figures": "Important ${sourceLanguageName} historical figures connected to this expression",
    "events": "${sourceLanguageName} historical events that shaped this expression"
  },
  "evolution": {
    "original_meaning": "How this ${sourceLanguageName} expression was originally used",
    "changes_over_time": "How this ${sourceLanguageName} expression's meaning evolved",
    "modern_usage": "How this ${sourceLanguageName} expression is used today"
  },
  "historical_significance": "Why this expression is historically important in ${sourceLanguageName} culture/history",
  "examples": ["${sourceLanguageName} historical usage example 1", "${sourceLanguageName} historical usage example 2"],
  "related_terms": ["Related ${sourceLanguageName} historical term 1", "Related ${sourceLanguageName} historical term 2"],
  "learning_context": "How understanding ${sourceLanguageName} history helps ${targetLanguageName} speakers learn this expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${targetLanguageName} but analyze the ${sourceLanguageName} historical context.`
            );

        case 'linguistic':
            return (
                baseContext +
                `
Provide an in-depth linguistic analysis of this ${sourceLanguageName} text in the following JSON structure:
{
  "definition": "Clear definition or meaning of this ${sourceLanguageName} expression",
  "etymology": {
    "word_origins": "${sourceLanguageName} language family and root origins of this expression",
    "historical_development": "How this ${sourceLanguageName} word/phrase developed linguistically"
  },
  "grammar": {
    "structure": "${sourceLanguageName} grammatical structure and patterns of this expression",
    "usage_rules": "${sourceLanguageName} grammar rules for proper usage"
  },
  "semantics": {
    "literal_meaning": "Literal ${sourceLanguageName} meaning before translation",
    "connotations": "Implied meanings and connotations in ${sourceLanguageName}",
    "register": "Formal/informal/technical classification in ${sourceLanguageName}"
  },
  "translation_notes": "Why this ${sourceLanguageName} expression is challenging to translate to ${targetLanguageName}",
  "examples": ["${sourceLanguageName} linguistic example 1", "${sourceLanguageName} linguistic example 2"],
  "related_forms": ["Related ${sourceLanguageName} word 1", "Related ${sourceLanguageName} word 2"],
  "learning_tips": "Specific tips for ${targetLanguageName} speakers to master this ${sourceLanguageName} expression linguistically"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${targetLanguageName} but analyze the ${sourceLanguageName} linguistic aspects.`
            );

        default:
            return (
                baseContext +
                `
Provide a comprehensive analysis of this ${sourceLanguageName} text covering cultural, historical, and linguistic aspects in the following JSON structure:
{
  "definition": "Clear definition or meaning of this ${sourceLanguageName} expression",
  "cultural_analysis": {
    "cultural_context": "${sourceLanguageName} cultural background and significance",
    "social_usage": "How this is used socially in ${sourceLanguageName} culture",
    "regional_notes": "Regional or cultural variations within ${sourceLanguageName}-speaking areas"
  },
  "historical_analysis": {
    "origins": "${sourceLanguageName} historical origins and background",
    "evolution": "How this ${sourceLanguageName} expression evolved over time",
    "historical_significance": "Historical importance in ${sourceLanguageName} culture"
  },
  "linguistic_analysis": {
    "etymology": "${sourceLanguageName} word origins and linguistic development",
    "grammar_notes": "${sourceLanguageName} grammatical considerations",
    "translation_notes": "Why this ${sourceLanguageName} expression is challenging to translate to ${targetLanguageName}"
  },
  "practical_usage": {
    "examples": ["${sourceLanguageName} example 1", "${sourceLanguageName} example 2", "${sourceLanguageName} example 3"],
    "when_to_use": "When ${sourceLanguageName} speakers use this expression",
    "formality": "Formality level in ${sourceLanguageName} culture"
  },
  "learning_tips": "Comprehensive advice for ${targetLanguageName} speakers learning ${sourceLanguageName}",
  "related_expressions": ["Related ${sourceLanguageName} expression 1", "Related ${sourceLanguageName} expression 2"],
  "key_insights": "Most important things for ${targetLanguageName} speakers to understand about this ${sourceLanguageName} expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${targetLanguageName} but analyze the ${sourceLanguageName} content.`
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
            text: text?.substring(0, 50),
        });
        return {
            success: false,
            error: 'Invalid text provided',
            contextType,
            text: text || '',
        };
    }

    try {
        const config = await configService.getAll();
        const {
            openaiApiKey,
            openaiBaseUrl = 'https://api.openai.com',
            openaiModel = 'gpt-4.1-mini-2025-04-14',
            aiContextTimeout = 30000,
        } = config;

        if (!openaiApiKey) {
            throw new Error('OpenAI API key not configured');
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
            apiUrl,
            model: normalizedModel,
            contextType,
            promptLength: prompt.length,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            aiContextTimeout
        );

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${openaiApiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('Context analysis API request failed', {
                status: response.status,
                statusText: response.statusText,
                errorText: errorText.substring(0, 500),
            });
            throw new Error(
                `API request failed: ${response.status} ${response.statusText} - ${errorText.substring(0, 500)}`
            );
        }

        const data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            logger.error('Invalid response format from context analysis API', {
                data,
            });
            throw new Error('Invalid response format from API');
        }

        const rawResponse = data.choices[0].message.content.trim();

        let structuredAnalysis;
        let isStructured = true;

        try {
            structuredAnalysis = JSON.parse(rawResponse);
            if (!validateAgainstSchema(jsonSchema, structuredAnalysis)) {
                logger.warn('Schema validation failed', {
                    rawResponsePreview: rawResponse.substring(0, 200),
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
                error: error.message,
                rawResponsePreview: rawResponse.substring(0, 200),
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
        logger.error('Context analysis failed', error, {
            textLength: text?.length || 0,
            contextType,
            errorMessage: error.message,
        });

        return {
            success: false,
            error: error.message,
            contextType,
            originalText: text,
            metadata,
        };
    }
}

/**
 * Batch context analysis for multiple texts (future enhancement)
 * @param {Array<Object>} requests - Array of context analysis requests
 * @returns {Promise<Array<Object>>} Array of context analysis results
 */
export async function analyzeBatchContext(requests) {
    logger.info('Batch context analysis initiated', {
        requestCount: requests.length,
    });

    // For now, process sequentially to avoid rate limits
    // Future enhancement: implement proper batching with rate limiting
    const results = [];
    for (const request of requests) {
        const result = await analyzeContext(
            request.text,
            request.contextType,
            request.metadata
        );
        results.push(result);
    }

    logger.info('Batch context analysis completed', {
        requestCount: requests.length,
        successCount: results.filter((r) => r.success).length,
    });

    return results;
}
