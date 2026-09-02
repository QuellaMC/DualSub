import type { SettingsValues } from '@/config/schema';
import type { ContextProviderError } from './providerError';

export type AiContextProviderId = SettingsValues['aiContextProvider'];

export const PROVIDER_SETTINGS_KEYS = [
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
    'geminiApiKey',
    'geminiModel',
] as const;

export type ProviderSettings = Pick<
    SettingsValues,
    (typeof PROVIDER_SETTINGS_KEYS)[number]
>;

export interface Prompt {
    readonly system: string;
    readonly user: string;
}

export interface ProviderRequest {
    readonly url: string;
    readonly init: RequestInit;
}

/**
 * A structured-output model endpoint. Providers only shape the HTTP
 * exchange; the shared analysis runner owns transport, timeouts, JSON
 * decoding, and schema validation.
 */
export interface ContextProvider {
    readonly id: AiContextProviderId;
    /** The endpoint and model that determine an answer (cache identity). */
    identity(settings: ProviderSettings): string;
    /**
     * @throws {ContextProviderError} NOT_CONFIGURED when a required
     *   credential is missing.
     */
    buildRequest(
        settings: ProviderSettings,
        prompt: Prompt,
        responseSchema: Record<string, unknown>
    ): ProviderRequest;
    /**
     * The model's text from a decoded response body.
     * @throws {ContextProviderError} MALFORMED_RESPONSE or SAFETY_BLOCKED.
     */
    readResponseText(payload: unknown): string;
}

export type { ContextProviderError };
