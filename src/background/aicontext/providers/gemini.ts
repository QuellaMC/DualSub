import { z } from 'zod';
import type { ContextProvider } from '../provider';
import { ContextProviderError } from '../providerError';

const GENERATE_CONTENT_BASE =
    'https://generativelanguage.googleapis.com/v1beta/models';

const SAFETY_SETTINGS = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_MEDIUM_AND_ABOVE' }));

const generation = z.object({
    candidates: z
        .array(
            z.object({
                finishReason: z.string().optional(),
                content: z
                    .object({
                        parts: z.array(z.object({ text: z.string() })).min(1),
                    })
                    .optional(),
            })
        )
        .min(1),
});

export const geminiContextProvider: ContextProvider = {
    id: 'gemini',

    identity(settings) {
        return `gemini:${settings.geminiModel}`;
    },

    buildRequest(settings, prompt, responseSchema) {
        const apiKey = settings.geminiApiKey.trim();
        if (apiKey === '') {
            throw new ContextProviderError(
                'NOT_CONFIGURED',
                'Gemini API key not configured'
            );
        }
        const model = encodeURIComponent(settings.geminiModel);
        return {
            url: `${GENERATE_CONTENT_BASE}/${model}:generateContent`,
            init: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: prompt.system }] },
                    contents: [{ parts: [{ text: prompt.user }] }],
                    generationConfig: {
                        temperature: 0.3,
                        topP: 0.95,
                        maxOutputTokens: 8192,
                        responseMimeType: 'application/json',
                        responseJsonSchema: responseSchema,
                    },
                    safetySettings: SAFETY_SETTINGS,
                }),
            },
        };
    },

    readResponseText(payload) {
        const parsed = generation.safeParse(payload);
        if (!parsed.success) {
            throw new ContextProviderError(
                'MALFORMED_RESPONSE',
                'Invalid response format from Gemini API'
            );
        }
        const candidate = parsed.data.candidates[0]!;
        if (candidate.finishReason === 'SAFETY') {
            throw new ContextProviderError(
                'SAFETY_BLOCKED',
                'Content blocked by safety filters'
            );
        }
        if (!candidate.content) {
            throw new ContextProviderError(
                'MALFORMED_RESPONSE',
                'Invalid response format from Gemini API'
            );
        }
        return candidate.content.parts[0]!.text;
    },
};
