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
        sourceLanguage = 'unknown',
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
