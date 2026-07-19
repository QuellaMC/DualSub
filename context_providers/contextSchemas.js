export const CONTEXT_SCHEMA_NAME = 'context_analysis';

const culturalSchema = {
    type: 'object',
    properties: {
        definition: { type: 'string' },
        cultural_context: {
            type: 'object',
            properties: {
                origins: { type: 'string' },
                social_context: { type: 'string' },
                regional_variations: { type: 'string' },
            },
            required: ['origins', 'social_context', 'regional_variations'],
            additionalProperties: false,
        },
        usage: {
            type: 'object',
            properties: {
                examples: { type: 'array', items: { type: 'string' } },
                when_to_use: { type: 'string' },
                formality_level: { type: 'string' },
            },
            required: ['examples', 'when_to_use', 'formality_level'],
            additionalProperties: false,
        },
        cultural_significance: { type: 'string' },
        learning_tips: { type: 'string' },
        related_expressions: { type: 'array', items: { type: 'string' } },
        sensitivities: { type: 'string' },
    },
    required: [
        'definition',
        'cultural_context',
        'usage',
        'cultural_significance',
        'learning_tips',
        'related_expressions',
        'sensitivities',
    ],
    additionalProperties: false,
};

const historicalSchema = {
    type: 'object',
    properties: {
        definition: { type: 'string' },
        historical_context: {
            type: 'object',
            properties: {
                time_period: { type: 'string' },
                historical_figures: { type: 'string' },
                events: { type: 'string' },
            },
            required: ['time_period', 'historical_figures', 'events'],
            additionalProperties: false,
        },
        evolution: {
            type: 'object',
            properties: {
                original_meaning: { type: 'string' },
                changes_over_time: { type: 'string' },
                modern_usage: { type: 'string' },
            },
            required: ['original_meaning', 'changes_over_time', 'modern_usage'],
            additionalProperties: false,
        },
        historical_significance: { type: 'string' },
        examples: { type: 'array', items: { type: 'string' } },
        related_terms: { type: 'array', items: { type: 'string' } },
        learning_context: { type: 'string' },
    },
    required: [
        'definition',
        'historical_context',
        'evolution',
        'historical_significance',
        'examples',
        'related_terms',
        'learning_context',
    ],
    additionalProperties: false,
};

const linguisticSchema = {
    type: 'object',
    properties: {
        definition: { type: 'string' },
        etymology: {
            type: 'object',
            properties: {
                word_origins: { type: 'string' },
                historical_development: { type: 'string' },
            },
            required: ['word_origins', 'historical_development'],
            additionalProperties: false,
        },
        grammar: {
            type: 'object',
            properties: {
                structure: { type: 'string' },
                usage_rules: { type: 'string' },
            },
            required: ['structure', 'usage_rules'],
            additionalProperties: false,
        },
        semantics: {
            type: 'object',
            properties: {
                literal_meaning: { type: 'string' },
                connotations: { type: 'string' },
                register: { type: 'string' },
            },
            required: ['literal_meaning', 'connotations', 'register'],
            additionalProperties: false,
        },
        translation_notes: { type: 'string' },
        examples: { type: 'array', items: { type: 'string' } },
        related_forms: { type: 'array', items: { type: 'string' } },
        learning_tips: { type: 'string' },
    },
    required: [
        'definition',
        'etymology',
        'grammar',
        'semantics',
        'translation_notes',
        'examples',
        'related_forms',
        'learning_tips',
    ],
    additionalProperties: false,
};

const allSchema = {
    type: 'object',
    properties: {
        definition: { type: 'string' },
        cultural_analysis: {
            type: 'object',
            properties: {
                cultural_context: { type: 'string' },
                social_usage: { type: 'string' },
                regional_notes: { type: 'string' },
            },
            required: ['cultural_context', 'social_usage', 'regional_notes'],
            additionalProperties: false,
        },
        historical_analysis: {
            type: 'object',
            properties: {
                origins: { type: 'string' },
                evolution: { type: 'string' },
                historical_significance: { type: 'string' },
            },
            required: ['origins', 'evolution', 'historical_significance'],
            additionalProperties: false,
        },
        linguistic_analysis: {
            type: 'object',
            properties: {
                etymology: { type: 'string' },
                grammar_notes: { type: 'string' },
                translation_notes: { type: 'string' },
            },
            required: ['etymology', 'grammar_notes', 'translation_notes'],
            additionalProperties: false,
        },
        practical_usage: {
            type: 'object',
            properties: {
                examples: { type: 'array', items: { type: 'string' } },
                when_to_use: { type: 'string' },
                formality: { type: 'string' },
            },
            required: ['examples', 'when_to_use', 'formality'],
            additionalProperties: false,
        },
        learning_tips: { type: 'string' },
        related_expressions: { type: 'array', items: { type: 'string' } },
        key_insights: { type: 'string' },
    },
    required: [
        'definition',
        'cultural_analysis',
        'historical_analysis',
        'linguistic_analysis',
        'practical_usage',
        'learning_tips',
        'related_expressions',
        'key_insights',
    ],
    additionalProperties: false,
};

export function getContextSchema(contextType = 'all') {
    switch (contextType) {
        case 'cultural':
            return culturalSchema;
        case 'historical':
            return historicalSchema;
        case 'linguistic':
            return linguisticSchema;
        default:
            return allSchema;
    }
}

function toGeminiSchema(node) {
    if (!node) return node;
    if (node.type === 'object') {
        const properties = {};
        const order = [];
        for (const [key, value] of Object.entries(node.properties || {})) {
            properties[key] = toGeminiSchema(value);
            order.push(key);
        }
        const result = { type: 'OBJECT', properties };
        if (order.length) result.propertyOrdering = order;
        // Note: Gemini API doesn't support 'required' or 'additionalProperties' fields
        // These are handled through the prompt instructions instead
        return result;
    }
    if (node.type === 'array') {
        return { type: 'ARRAY', items: toGeminiSchema(node.items) };
    }
    return { type: String(node.type || 'string').toUpperCase() };
}

export function getGeminiSchema(contextType = 'all') {
    return toGeminiSchema(getContextSchema(contextType));
}

export function validateAgainstSchema(schema, data) {
    function validate(node, value) {
        if (node.type === 'object') {
            if (
                typeof value !== 'object' ||
                value === null ||
                Array.isArray(value)
            )
                return false;
            if (node.required) {
                for (const key of node.required) {
                    if (!(key in value)) return false;
                }
            }
            if (node.properties) {
                for (const [key, schemaChild] of Object.entries(
                    node.properties
                )) {
                    if (key in value && !validate(schemaChild, value[key]))
                        return false;
                }
            }
            if (node.additionalProperties === false) {
                for (const key of Object.keys(value)) {
                    if (!node.properties || !(key in node.properties))
                        return false;
                }
            }
            return true;
        }
        if (node.type === 'array') {
            if (!Array.isArray(value)) return false;
            if (node.items) {
                return value.every((item) => validate(node.items, item));
            }
            return true;
        }
        if (node.type === 'string') {
            return typeof value === 'string';
        }
        // Basic handling for other primitive types
        if (node.type === 'number') {
            return typeof value === 'number';
        }
        if (node.type === 'boolean') {
            return typeof value === 'boolean';
        }
        return true;
    }

    return validate(schema, data);
}
