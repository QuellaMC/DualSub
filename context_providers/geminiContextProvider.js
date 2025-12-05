/**
 * Google Gemini Context Provider
 *
 * Provides AI-powered cultural, historical, and linguistic context analysis
 * using Google's Gemini models through the Generative AI API.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import {
    getContextSchema,
    getGeminiSchema,
    validateAgainstSchema,
} from './contextSchemas.js';

const logger = Logger.create('GeminiContextProvider');

/**
 * Available Gemini models for context analysis
 */
export const GEMINI_MODELS = [
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Fast and efficient model for quick context analysis',
        contextWindow: 1000000,
        recommended: true,
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description:
            'Advanced model with superior reasoning for complex cultural analysis',
        contextWindow: 2000000,
        recommended: false,
    },
    {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Previous generation fast model (legacy)',
        contextWindow: 1000000,
        recommended: false,
    },
    {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Previous generation advanced model (legacy)',
        contextWindow: 2000000,
        recommended: false,
    },
];

/**
 * Get available models for this provider
 * @returns {Array} Array of model objects
 */
export function getAvailableModels() {
    return GEMINI_MODELS;
}

/**
 * Get the default model for this provider
 * @returns {string} Default model ID
 */
export function getDefaultModel() {
    const recommended = GEMINI_MODELS.find((model) => model.recommended);
    return recommended ? recommended.id : GEMINI_MODELS[0].id;
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
        targetLanguage = 'unknown',
        surroundingContext = '',
    } = metadata;

    // Get language name for the target language code
    const getLanguageName = (langCode) => {
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
            languageNames[langCode] ||
            (langCode === 'auto' ? 'Unknown' : langCode)
        );
    };

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
 * Analyzes text for cultural, historical, and linguistic context using Google Gemini API
 * @param {string} text - The text to analyze
 * @param {string} contextType - Type of context analysis ('cultural', 'historical', 'linguistic', 'all')
 * @param {Object} metadata - Additional context metadata
 * @returns {Promise<Object>} Context analysis result
 */
export async function analyzeContext(text, contextType = 'all', metadata = {}) {
    logger.info('Gemini context analysis request initiated', {
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
            geminiApiKey,
            geminiModel = 'gemini-2.5-flash',
            aiContextTimeout = 30000,
        } = config;

        if (!geminiApiKey) {
            throw new Error('Gemini API key not configured');
        }

        // Create context-specific prompt
        const prompt = createContextPrompt(text, contextType, metadata);
        const jsonSchema = getContextSchema(contextType);
        const geminiSchema = getGeminiSchema(contextType);

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

        const requestBody = {
            contents: [
                {
                    parts: [
                        {
                            text: prompt,
                        },
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.3,
                topP: 0.95,
                maxOutputTokens: 80000,
                stopSequences: [],
                responseMimeType: 'application/json',
                responseSchema: geminiSchema,
            },
            safetySettings: [
                {
                    category: 'HARM_CATEGORY_HARASSMENT',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
                },
                {
                    category: 'HARM_CATEGORY_HATE_SPEECH',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
                },
                {
                    category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
                },
                {
                    category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE',
                },
            ],
        };

        logger.debug('Making Gemini context analysis request', {
            apiUrl: apiUrl.split('?')[0], // Log URL without API key
            model: geminiModel,
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
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('Gemini context analysis API request failed', {
                status: response.status,
                statusText: response.statusText,
                errorText: errorText.substring(0, 500),
            });
            throw new Error(
                `Gemini API request failed: ${response.status} ${response.statusText}`
            );
        }

        const data = await response.json();

        if (
            !data.candidates ||
            !data.candidates[0] ||
            !data.candidates[0].content
        ) {
            logger.error(
                'Invalid response format from Gemini context analysis API',
                { data }
            );
            throw new Error('Invalid response format from Gemini API');
        }

        const candidate = data.candidates[0];

        // Check for safety blocks
        if (candidate.finishReason === 'SAFETY') {
            logger.warn('Gemini response blocked for safety reasons', {
                safetyRatings: candidate.safetyRatings,
            });
            throw new Error('Content blocked by safety filters');
        }

        const rawResponse = candidate.content.parts[0].text.trim();

        let structuredAnalysis;

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
                    finishReason: candidate.finishReason,
                    safetyRatings: candidate.safetyRatings,
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
                finishReason: candidate.finishReason,
                safetyRatings: candidate.safetyRatings,
            };
        }

        logger.info('Gemini context analysis completed successfully', {
            contextType,
            responseLength: rawResponse.length,
            finishReason: candidate.finishReason,
        });

        const result = {
            success: true,
            contextType,
            analysis: structuredAnalysis,
            isStructured: true,
            originalText: text,
            metadata,
            finishReason: candidate.finishReason,
            safetyRatings: candidate.safetyRatings,
            shouldCache: true,
        };

        logger.debug('Gemini provider returning result', {
            success: result.success,
            hasAnalysis: !!result.analysis,
            isStructured: result.isStructured,
            analysisType: typeof result.analysis,
            contextType: result.contextType,
            resultKeys: Object.keys(result),
        });

        return result;
    } catch (error) {
        logger.error('Gemini context analysis failed', error, {
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
    logger.info('Gemini batch context analysis initiated', {
        requestCount: requests.length,
    });

    // For now, process sequentially to avoid rate limits
    // Future enhancement: implement proper batching
    const results = [];
    for (const request of requests) {
        const result = await analyzeContext(
            request.text,
            request.contextType,
            request.metadata
        );
        results.push(result);

        // Add small delay between requests to respect rate limits
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('Gemini batch context analysis completed', {
        requestCount: requests.length,
        successCount: results.filter((r) => r.success).length,
    });

    return results;
}
