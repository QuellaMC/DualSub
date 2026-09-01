import { z } from 'zod';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import { boundedNonBlankString, boundedText } from './primitives';

// Passing this contract is necessary, not sufficient: the background subtitle
// policy independently re-checks route identity against the classified sender
// and canonicalizes every URL against the CDN allowlist before any fetch.
// Track entries stay unknown here — the policy owns their deep sanitization
// because it selects and transforms, not merely validates.

const MAX_ROUTE_ID_BYTES = 256;
const MAX_LANGUAGE_BYTES = 64;

/** Sized for the Netflix track ceiling (128 tracks × 16 KiB URLs ≈ 2 MiB). */
const FETCH_VTT_BUDGET = Object.freeze({
    maxDepth: 8,
    maxEntries: 8192,
    maxStringBytes: 16 * 1024,
    maxTotalBytes: 3 * 1024 * 1024,
});

export const fetchVtt = defineContract({
    action: MessageActions.FETCH_VTT,
    transport: 'runtime',
    senders: ['content'],
    budget: FETCH_VTT_BUDGET,
    request: z.discriminatedUnion('source', [
        z.strictObject({
            action: z.literal(MessageActions.FETCH_VTT),
            source: z.literal('disneyplus'),
            videoId: boundedNonBlankString(MAX_ROUTE_ID_BYTES),
            url: z.string(),
            targetLanguage: boundedNonBlankString(MAX_LANGUAGE_BYTES),
            originalLanguage: boundedNonBlankString(MAX_LANGUAGE_BYTES),
        }),
        z.strictObject({
            action: z.literal(MessageActions.FETCH_VTT),
            source: z.literal('netflix'),
            videoId: boundedNonBlankString(MAX_ROUTE_ID_BYTES),
            targetLanguage: boundedNonBlankString(MAX_LANGUAGE_BYTES),
            originalLanguage: boundedNonBlankString(MAX_LANGUAGE_BYTES),
            useOfficialTranslations: z.boolean(),
            data: z.strictObject({
                tracks: z.array(z.unknown()).min(1).max(128),
            }),
        }),
    ]),
    response: z.discriminatedUnion('success', [
        z.strictObject({
            success: z.literal(true),
            vttText: z.string(),
            targetVttText: z.union([z.null(), z.string()]),
            sourceLanguage: z.string(),
            targetLanguage: z.string(),
            useNativeTarget: z.boolean(),
            selectedLanguage: z.strictObject({
                normalizedCode: z.string(),
                displayName: z.string(),
            }),
        }),
        z.strictObject({
            success: z.literal(false),
            error: boundedText(512),
            stage: z.string().optional(),
            errorCode: z.string().optional(),
        }),
    ]),
});

export type FetchVttRequest = z.infer<typeof fetchVtt.request>;
export type FetchVttResponse = z.infer<typeof fetchVtt.response>;
