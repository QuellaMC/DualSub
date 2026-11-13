import type { ProviderId } from '@/shared/providers';

/** Each translation service's name in the catalog. */
export const PROVIDER_NAME_KEYS: Record<ProviderId, string> = {
    microsoft_edge: 'providerMicrosoft',
    google: 'providerGoogle',
    deepl: 'providerDeepL',
    openai_compatible: 'providerAi',
    vertex_gemini: 'providerVertex',
};
