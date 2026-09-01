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

const PROVIDER = 'vertex_gemini';
const SETTINGS_KEYS = [
    'vertexAccessToken',
    'vertexProjectId',
    'vertexLocation',
    'vertexModel',
] as const;

/** Accepts `gemini-x`, `models/gemini-x`, or a full publisher path. */
function shortModelName(model: string): string {
    const segments = model.split('/');
    return segments[segments.length - 1] || model;
}

export function buildVertexEndpoint(
    projectId: string,
    location: string,
    model: string
): string {
    return (
        `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
        `/locations/${encodeURIComponent(location)}/publishers/google/models/` +
        `${encodeURIComponent(shortModelName(model))}:generateContent`
    );
}

export function readCandidateText(data: unknown): string | null {
    if (!isRecord(data)) {
        return null;
    }
    const candidates = data['candidates'];
    if (!Array.isArray(candidates) || !isRecord(candidates[0])) {
        return null;
    }
    const content = candidates[0]['content'];
    if (!isRecord(content) || !Array.isArray(content['parts'])) {
        return null;
    }
    const part: unknown = content['parts'][0];
    if (!isRecord(part) || typeof part['text'] !== 'string') {
        return null;
    }
    const text = part['text'].trim();
    return text === '' ? null : text;
}

export const geminiVertexProvider: TranslationProvider = {
    id: PROVIDER,
    pacing: {
        policy: { kind: 'requests', limit: 3000, windowMs: 60_000 },
        minDelayMs: 100,
    },
    async translate(text, sourceLang, targetLang) {
        const settings = await readProviderSettings(PROVIDER, SETTINGS_KEYS);
        if (SETTINGS_KEYS.some((key) => settings[key].trim() === '')) {
            throw missingCredential(PROVIDER, 'Vertex AI configuration');
        }
        const response = await providerFetch(
            PROVIDER,
            buildVertexEndpoint(
                settings.vertexProjectId,
                settings.vertexLocation,
                settings.vertexModel
            ),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${settings.vertexAccessToken}`,
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    text: `${translationInstruction(sourceLang, targetLang)}\n\n${text}`,
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        maxOutputTokens: Math.max(
                            256,
                            Math.min(2048, Math.ceil(text.length * 3))
                        ),
                    },
                }),
            }
        );
        if (!response.ok) {
            throw httpFailureFrom(PROVIDER, response);
        }
        const translated = readCandidateText(
            await readProviderJson(PROVIDER, response)
        );
        if (translated === null) {
            throw malformedResponse(PROVIDER);
        }
        return translated;
    },
};
