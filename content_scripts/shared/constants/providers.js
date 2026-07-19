// Centralized provider identifiers and metadata

export const Providers = {
    GOOGLE: 'google',
    MICROSOFT_EDGE_AUTH: 'microsoft_edge_auth',
    DEEPL: 'deepl',
    DEEPL_FREE: 'deepl_free',
    OPENAI_COMPATIBLE: 'openai_compatible',
    VERTEX_GEMINI: 'vertex_gemini',
};

export const ProviderNames = {
    [Providers.GOOGLE]: 'Google Translate (Free)',
    [Providers.MICROSOFT_EDGE_AUTH]: 'Microsoft Translate (Free)',
    [Providers.DEEPL]: 'DeepL Translate (API Key Required)',
    [Providers.DEEPL_FREE]: 'DeepL Translate (Free)',
    [Providers.OPENAI_COMPATIBLE]: 'OpenAI Compatible (API Key Required)',
    [Providers.VERTEX_GEMINI]: 'Vertex AI Gemini (API Key Required)',
};

// Centralized provider-specific batch configuration
export const ProviderBatchConfigs = {
    [Providers.OPENAI_COMPATIBLE]: {
        defaultBatchSize: 8,
        maxBatchSize: 15,
        delimiter: '|SUBTITLE_BREAK|',
        supportsBatch: true,
        batchMethod: 'delimiter',
        delayConfigKey: 'openaieDelay',
    },
    [Providers.VERTEX_GEMINI]: {
        defaultBatchSize: 8,
        maxBatchSize: 15,
        delimiter: '|SUBTITLE_BREAK|',
        supportsBatch: true,
        batchMethod: 'delimiter',
        // Reuse the OpenAI-compatible delay setting for simplicity
        delayConfigKey: 'openaieDelay',
    },
    [Providers.GOOGLE]: {
        defaultBatchSize: 4,
        maxBatchSize: 8,
        delimiter: '\n---SUBTITLE---\n',
        supportsBatch: false,
        batchMethod: 'simulated',
        delayConfigKey: 'googleDelay',
    },
    [Providers.DEEPL]: {
        defaultBatchSize: 3,
        maxBatchSize: 6,
        delimiter: '\n[SUBTITLE]\n',
        supportsBatch: false,
        batchMethod: 'simulated',
        delayConfigKey: 'deeplDelay',
    },
    [Providers.DEEPL_FREE]: {
        defaultBatchSize: 2,
        maxBatchSize: 4,
        delimiter: '\n[SUBTITLE]\n',
        supportsBatch: false,
        batchMethod: 'simulated',
        delayConfigKey: 'deeplFreeDelay',
    },
    [Providers.MICROSOFT_EDGE_AUTH]: {
        defaultBatchSize: 4,
        maxBatchSize: 8,
        delimiter: '\n||SUBTITLE||\n',
        supportsBatch: false,
        batchMethod: 'simulated',
        delayConfigKey: 'microsoftDelay',
    },
};
