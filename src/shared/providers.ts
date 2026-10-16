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

/** What each provider needs filled in before it can translate; the keyless
 *  ones need nothing. */
export const PROVIDER_CREDENTIALS = {
    google: [],
    microsoft_edge: [],
    deepl: ['deeplApiKey'],
    openai_compatible: ['openaiCompatibleApiKey'],
    vertex_gemini: [
        'vertexAccessToken',
        'vertexProjectId',
        'vertexLocation',
        'vertexModel',
    ],
} as const satisfies Record<ProviderId, readonly string[]>;

export type CredentialKey = (typeof PROVIDER_CREDENTIALS)[ProviderId][number];

/** The credentials `provider` still lacks in `settings`. */
export function missingCredentials(
    provider: ProviderId,
    settings: Partial<Record<CredentialKey, string>>
): CredentialKey[] {
    const needed: readonly CredentialKey[] = PROVIDER_CREDENTIALS[provider];
    return needed.filter((key) => (settings[key] ?? '').trim() === '');
}

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
