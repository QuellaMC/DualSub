export const PROVIDER_IDS = [
    'google',
    'microsoft_edge',
    'deepl',
    'openai_compatible',
    'vertex_gemini',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Providers that need no account, in the order they cover for a failing
 *  one. */
export const KEYLESS_PROVIDERS = [
    'microsoft_edge',
    'google',
] as const satisfies readonly ProviderId[];

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
