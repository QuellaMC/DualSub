// Centralized provider identifiers and metadata

export const Providers = {
    GOOGLE: 'google',
    MICROSOFT_EDGE_AUTH: 'microsoft_edge_auth',
    DEEPL: 'deepl',
    OPENAI_COMPATIBLE: 'openai_compatible',
    VERTEX_GEMINI: 'vertex_gemini',
};

export const ProviderNames = {
    [Providers.GOOGLE]: 'Google Translate (Free)',
    [Providers.MICROSOFT_EDGE_AUTH]: 'Microsoft Translate (Free)',
    [Providers.DEEPL]: 'DeepL Translate (API Key Required)',
    [Providers.OPENAI_COMPATIBLE]: 'OpenAI Compatible (API Key Required)',
    [Providers.VERTEX_GEMINI]: 'Vertex AI Gemini (API Key Required)',
};

// Limits for providers that implement a real multi-text request.
export const ProviderBatchConfigs = {
    [Providers.OPENAI_COMPATIBLE]: {
        maxBatchSize: 15,
        delimiter: '|SUBTITLE_BREAK|',
    },
    [Providers.VERTEX_GEMINI]: {
        maxBatchSize: 15,
        delimiter: '|SUBTITLE_BREAK|',
    },
};
