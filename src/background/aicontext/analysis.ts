import { createContextPrompt, SYSTEM_PROMPT } from './prompt';
import type { ContextProvider, ProviderSettings } from './provider';
import { ContextProviderError } from './providerError';
import {
    analysisJsonSchema,
    parseAnalysis,
    type Analysis,
    type AnalysisType,
} from './schemas';

export interface AnalysisInput {
    readonly text: string;
    readonly type: AnalysisType;
    readonly targetLanguage: string;
}

function isTimeout(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
    );
}

/**
 * One provider round trip: prompt → request → response text → validated
 * analysis. Every failure surfaces as a ContextProviderError so the caller
 * decides about retries from the code alone.
 *
 * @throws {ContextProviderError}
 */
export async function runProviderAnalysis(
    provider: ContextProvider,
    settings: ProviderSettings,
    input: AnalysisInput,
    options: { timeoutMs: number; fetch: typeof fetch }
): Promise<Analysis> {
    const request = provider.buildRequest(
        settings,
        {
            system: SYSTEM_PROMPT,
            user: createContextPrompt(
                input.text,
                input.type,
                input.targetLanguage
            ),
        },
        analysisJsonSchema(input.type)
    );

    let response: Response;
    try {
        response = await options.fetch(request.url, {
            ...request.init,
            signal: AbortSignal.timeout(options.timeoutMs),
        });
    } catch (error) {
        throw new ContextProviderError(
            isTimeout(error) ? 'TIMEOUT' : 'NETWORK_ERROR',
            isTimeout(error)
                ? 'Context analysis request timed out'
                : 'Context analysis request failed',
            { cause: error }
        );
    }
    if (!response.ok) {
        throw new ContextProviderError(
            'UPSTREAM_ERROR',
            `API request failed: ${response.status}`,
            { status: response.status }
        );
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch (error) {
        throw new ContextProviderError(
            'MALFORMED_RESPONSE',
            'Invalid response format from API',
            { cause: error }
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(provider.readResponseText(payload).trim());
    } catch (error) {
        if (error instanceof ContextProviderError) {
            throw error;
        }
        throw new ContextProviderError(
            'MALFORMED_RESPONSE',
            'Malformed JSON response',
            { cause: error }
        );
    }
    const analysis = parseAnalysis(input.type, parsed);
    if (!analysis) {
        throw new ContextProviderError(
            'MALFORMED_RESPONSE',
            'Schema validation failed'
        );
    }
    return analysis;
}
