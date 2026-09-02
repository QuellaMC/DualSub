import { z } from 'zod';
import { normalizeModelName } from '@/background/translation/providers/openaiCompatible';
import type { ContextProvider } from '../provider';
import { ContextProviderError } from '../providerError';
import { ANALYSIS_SCHEMA_NAME } from '../schemas';

const completion = z.object({
    choices: z
        .array(z.object({ message: z.object({ content: z.string() }) }))
        .min(1),
});

/** The configured base URL, with the `/v1` API prefix ensured. */
export function openaiApiBase(baseUrl: string): string {
    const trimmed = baseUrl.replace(/[/\\]+$/, '');
    return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export const openaiContextProvider: ContextProvider = {
    id: 'openai',

    identity(settings) {
        return `openai:${settings.openaiBaseUrl}:${settings.openaiModel}`;
    },

    buildRequest(settings, prompt, responseSchema) {
        const apiKey = settings.openaiApiKey.trim();
        if (apiKey === '') {
            throw new ContextProviderError(
                'NOT_CONFIGURED',
                'OpenAI API key not configured'
            );
        }
        const base = openaiApiBase(settings.openaiBaseUrl);
        return {
            url: `${base}/chat/completions`,
            init: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: normalizeModelName(settings.openaiModel, base),
                    messages: [
                        { role: 'system', content: prompt.system },
                        { role: 'user', content: prompt.user },
                    ],
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: ANALYSIS_SCHEMA_NAME,
                            schema: responseSchema,
                            strict: true,
                        },
                    },
                }),
            },
        };
    },

    readResponseText(payload) {
        const parsed = completion.safeParse(payload);
        if (!parsed.success) {
            throw new ContextProviderError(
                'MALFORMED_RESPONSE',
                'Invalid response format from API'
            );
        }
        return parsed.data.choices[0]!.message.content;
    },
};
