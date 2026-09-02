export const PROVIDER_IDS = [
    'google',
    'microsoft_edge',
    'deepl',
    'openai_compatible',
    'vertex_gemini',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
    google: 'Google Translate (Free)',
    microsoft_edge: 'Microsoft Translate (Free)',
    deepl: 'DeepL Translate (API Key Required)',
    openai_compatible: 'OpenAI Compatible (API Key Required)',
    vertex_gemini: 'Vertex AI Gemini (API Key Required)',
};

export const VERTEX_LOCATIONS = [
    'us-central1',
    'us-east1',
    'us-west1',
    'europe-west1',
    'europe-west4',
    'asia-northeast1',
    'asia-southeast1',
] as const;

export type VertexLocation = (typeof VERTEX_LOCATIONS)[number];
