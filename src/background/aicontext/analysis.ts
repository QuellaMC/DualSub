import type { AiAnswer } from '@/messaging/contracts/analyzeContext';
import {
    createAnswerPrompt,
    SYSTEM_PROMPT,
    type AnswerPromptInput,
} from './prompt';
import type { ContextProvider, ProviderSettings } from './provider';
import { ContextProviderError } from './providerError';
import { answerJsonSchema, parseAnswer } from './schemas';

const MAX_ERROR_BODY_BYTES = 2048;
const MAX_ERROR_DETAIL_CHARS = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

/** The upstream error's body: decoded when it is JSON, otherwise its text. */
async function readErrorBody(response: Response): Promise<unknown> {
    let text: string;
    try {
        text = (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
    } catch {
        return '';
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

/** The upstream error's own words, when its body offers any: OpenAI-style
 *  `{error:{message}}`, plain `{detail}`/`{message}`/`{title}`, or text. */
function errorDetail(body: unknown): string {
    let detail = body;
    if (isRecord(body)) {
        const error = body['error'];
        detail = isRecord(error)
            ? error['message']
            : (error ?? body['detail'] ?? body['message'] ?? body['title']);
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
    input: AnswerPromptInput,
    options: { timeoutMs: number; fetch: typeof fetch }
): Promise<AiAnswer> {
    const request = provider.buildRequest(
        settings,
        { system: SYSTEM_PROMPT, user: createAnswerPrompt(input) },
        answerJsonSchema(input.kinds)
    );

    // Called unbound on purpose: the global fetch throws "Illegal invocation"
    // when invoked as a method of another object.
    const { fetch: send } = options;
    let response: Response;
    try {
        response = await send(request.url, {
            ...request.init,
            // The API key is the only credential; browser cookies for the
            // provider's domain must not ride along.
            credentials: 'omit',
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
        const body = await readErrorBody(response);
        const detail = errorDetail(body);
        const refused =
            response.status === 401 ||
            response.status === 403 ||
            provider.refusesKey?.(body) === true;
        throw new ContextProviderError(
            refused ? 'KEY_REFUSED' : 'UPSTREAM_ERROR',
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
    const answer = parseAnswer(input.kinds, parsed);
    if (!answer) {
        throw new ContextProviderError(
            'MALFORMED_RESPONSE',
            'Schema validation failed'
        );
    }
    return answer;
}
