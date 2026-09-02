import type { AnalysisType } from './schemas';

export const SYSTEM_PROMPT =
    'You are an expert cultural, historical, and linguistic analyst specializing in helping language learners understand nuanced context. Provide comprehensive yet concise explanations that include specific details, examples, and actionable insights. Focus on practical understanding that enhances language learning and cultural awareness.';

const LANGUAGE_NAMES: Record<string, string> = {
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

export function languageName(code: string): string {
    return LANGUAGE_NAMES[code] ?? (code === 'auto' ? 'Unknown' : code);
}

function structureFor(type: AnalysisType, target: string): string {
    switch (type) {
        case 'cultural':
            return `
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
  "learning_tips": "Practical advice for ${target} speakers learning the source language",
  "related_expressions": ["Similar expression 1", "Similar expression 2"],
  "sensitivities": "Cultural sensitivities ${target} speakers should know about this expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${target} but analyze the source content.`;
        case 'historical':
            return `
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
  "learning_context": "How understanding the source history helps ${target} speakers learn this expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${target} but analyze the historical context of the source.`;
        case 'linguistic':
            return `
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
  "translation_notes": "Why this expression is challenging to translate to ${target}",
  "examples": ["Linguistic example 1", "Linguistic example 2"],
  "related_forms": ["Related word 1", "Related word 2"],
  "learning_tips": "Specific tips for ${target} speakers to master this expression linguistically"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${target} but analyze the linguistic aspects of the source.`;
        case 'all':
            return `
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
    "translation_notes": "Why this expression is challenging to translate to ${target}"
  },
  "practical_usage": {
    "examples": ["Example 1", "Example 2", "Example 3"],
    "when_to_use": "When speakers of the source language use this expression",
    "formality": "Formality level in the source culture"
  },
  "learning_tips": "Comprehensive advice for ${target} speakers learning the source language",
  "related_expressions": ["Related expression 1", "Related expression 2"],
  "key_insights": "Most important things for ${target} speakers to understand about this expression"
}

Respond ONLY with valid JSON in this exact structure. All text content within the JSON must be written in ${target} but analyze the source content.`;
    }
}

/** The user turn: the text, the answer language, and the JSON shape. */
export function createContextPrompt(
    text: string,
    type: AnalysisType,
    targetLanguage: string
): string {
    const target = languageName(targetLanguage);
    return `
Analyze this text for ${type} context:

Text to analyze: "${text}"
Target language for response: ${targetLanguage} (${target})

CRITICAL INSTRUCTIONS:
1. First, IDENTIFY the language of the "Text to analyze"
2. Write your ENTIRE response in ${target} language
3. Analyze and discuss the content, culture, and context of the identified source language
4. Explain cultural/historical/linguistic aspects TO a ${target} speaker
5. Do NOT analyze ${target} language or culture - focus on the source material
6. Help ${target} speakers understand this text better

Provide a clear, educational explanation that helps ${target} speakers understand the deeper meaning of this content.
${structureFor(type, target)}`;
}
