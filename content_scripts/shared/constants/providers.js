// Centralized provider identifiers and metadata

export const Providers = {
    GOOGLE: 'google',
    MICROSOFT_EDGE_AUTH: 'microsoft_edge_auth',
    DEEPL: 'deepl',
    OPENAI_COMPATIBLE: 'openai_compatible',
    VERTEX_GEMINI: 'vertex_gemini',
};

export const VERTEX_LOCATIONS = Object.freeze([
    'us-central1',
    'us-east1',
    'us-west1',
    'europe-west1',
    'europe-west4',
    'asia-northeast1',
    'asia-southeast1',
]);

export const ProviderNames = {
    [Providers.GOOGLE]: 'Google Translate (Free)',
    [Providers.MICROSOFT_EDGE_AUTH]: 'Microsoft Translate (Free)',
    [Providers.DEEPL]: 'DeepL Translate (API Key Required)',
    [Providers.OPENAI_COMPATIBLE]: 'OpenAI Compatible (API Key Required)',
    [Providers.VERTEX_GEMINI]: 'Vertex AI Gemini (API Key Required)',
};
