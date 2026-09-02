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

const MAX_ERROR_DETAIL_BYTES = 2048;
const MAX_ERROR_DETAIL_CHARS = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

/** The upstream error's own words, when its body offers any: OpenAI-style
 *  `{error:{message}}`, plain `{detail}`/`{message}`/`{title}`, or text. */
async function readErrorDetail(response: Response): Promise<string> {
    let body: string;
    try {
        body = (await response.text()).slice(0, MAX_ERROR_DETAIL_BYTES);
    } catch {
        return '';
    }
    let detail: unknown = body;
    try {
        const parsed: unknown = JSON.parse(body);
        if (isRecord(parsed)) {
            const error = parsed['error'];
            detail = isRecord(error)
                ? error['message']
                : (error ??
                  parsed['detail'] ??
                  parsed['message'] ??
                  parsed['title']);
        }
    } catch {
        // Not JSON; the text itself is the detail.
    }
    if (typeof detail !== 'string') {
        return '';
    }
    const collapsed = detail.replace(/\s+/g, ' ').trim();
    return collapsed.length > MAX_ERROR_DETAIL_CHARS
        ? `${collapsed.slice(0, MAX_ERROR_DETAIL_CHARS - 1)}…`
        : collapsed;
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

    // Called unbound on purpose: the global fetch throws "Illegal invocation"
    // when invoked as a method of another object.
    const { fetch: send } = options;
    let response: Response;
    try {
        response = await send(request.url, {
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
        const detail = await readErrorDetail(response);
        throw new ContextProviderError(
            'UPSTREAM_ERROR',
            `API request failed: ${response.status}${detail ? ` (${detail})` : ''}`,
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
