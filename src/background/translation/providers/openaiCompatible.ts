import {
    httpFailureFrom,
    isRecord,
    malformedResponse,
    missingCredential,
    providerFetch,
    readProviderJson,
    readProviderSettings,
    type TranslationProvider,
} from '../provider';
import { translationInstruction } from './prompt';

const PROVIDER = 'openai_compatible';

function isGoogleEndpoint(baseUrl: string): boolean {
    return baseUrl.includes('generativelanguage.googleapis.com');
}

/** Gemini's OpenAI-compatible endpoint rejects the `models/` prefix its own
 *  model listing uses. */
export function normalizeModelName(model: string, baseUrl: string): string {
    return isGoogleEndpoint(baseUrl) && model.startsWith('models/')
        ? model.slice('models/'.length)
        : model;
}

function nonBlank(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/** Chat Completions shape first, then the Responses API `output` shape. */
export function readCompletionText(data: unknown): string | null {
    if (!isRecord(data)) {
        return null;
    }
    const choices = data['choices'];
    if (Array.isArray(choices) && isRecord(choices[0])) {
        const message = choices[0]['message'];
        if (isRecord(message)) {
            return nonBlank(message['content']);
        }
        return null;
    }
    const output = data['output'];
    if (Array.isArray(output) && isRecord(output[0])) {
        const content = output[0]['content'];
        if (Array.isArray(content)) {
            for (const block of content) {
                if (isRecord(block) && typeof block['text'] === 'string') {
                    return nonBlank(block['text']);
                }
            }
        }
    }
    return null;
}

function readModelIds(data: unknown): string[] | null {
    if (!isRecord(data)) {
        return null;
    }
    const openai = data['data'];
    if (Array.isArray(openai)) {
        return openai.flatMap((entry: unknown) =>
            isRecord(entry) && typeof entry['id'] === 'string'
                ? [entry['id']]
                : []
        );
    }
    const gemini = data['models'];
    if (Array.isArray(gemini)) {
        return gemini.flatMap((entry: unknown) =>
            isRecord(entry) &&
            typeof entry['name'] === 'string' &&
            entry['name'].includes('models/gemini')
                ? [entry['name']]
                : []
        );
    }
    return null;
}

/** The model ids an endpoint advertises: OpenAI's `data[].id`, or the
 *  Gemini models from Google's `models[].name`. */
export async function fetchAvailableModels(
    apiKey: string,
    baseUrl: string
): Promise<string[]> {
    const response = await providerFetch(PROVIDER, `${baseUrl}/models`, {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
    });
    if (!response.ok) {
        throw httpFailureFrom(PROVIDER, response);
    }
    const models = readModelIds(await readProviderJson(PROVIDER, response));
    if (models === null) {
        throw malformedResponse(PROVIDER);
    }
    return models;
}

export const openaiCompatibleProvider: TranslationProvider = {
    id: PROVIDER,
    pacing: {
        policy: { kind: 'requests', limit: 3500, windowMs: 60_000 },
        minDelayMs: 100,
    },
    async translate(text, sourceLang, targetLang) {
        const settings = await readProviderSettings(PROVIDER, [
            'openaiCompatibleApiKey',
            'openaiCompatibleBaseUrl',
            'openaiCompatibleModel',
        ]);
        if (settings.openaiCompatibleApiKey.trim() === '') {
            throw missingCredential(PROVIDER, 'OpenAI-compatible API key');
        }
        const baseUrl = settings.openaiCompatibleBaseUrl;
        const response = await providerFetch(
            PROVIDER,
            `${baseUrl}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${settings.openaiCompatibleApiKey}`,
                },
                body: JSON.stringify({
                    model: normalizeModelName(
                        settings.openaiCompatibleModel,
                        baseUrl
                    ),
                    messages: [
                        {
                            role: 'system',
                            content: translationInstruction(
                                sourceLang,
                                targetLang
                            ),
                        },
                        { role: 'user', content: text },
                    ],
                    temperature: 0.1,
                    max_tokens: 10000,
                }),
            }
        );
        if (!response.ok) {
            throw httpFailureFrom(PROVIDER, response);
        }
        const translated = readCompletionText(
            await readProviderJson(PROVIDER, response)
        );
        if (translated === null) {
            throw malformedResponse(PROVIDER);
        }
        return translated;
    },
};
