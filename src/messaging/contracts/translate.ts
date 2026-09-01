import { z } from 'zod';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import {
    nonBlankString,
    nonBlankTrimmedString,
    nonNegativeSafeInteger,
} from './primitives';

export const MAX_TRANSLATION_RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// The response never echoes request identity: the sendMessage promise binds a
// reply to its request, and the caller's closure carries the cue.
export const translate = defineContract({
    action: MessageActions.TRANSLATE,
    transport: 'runtime',
    senders: ['content'],
    request: z.strictObject({
        action: z.literal(MessageActions.TRANSLATE),
        text: nonBlankString,
        targetLang: nonBlankTrimmedString,
        cueStart: z.number().finite().nonnegative(),
        cueVideoId: nonBlankTrimmedString,
    }),
    response: z.discriminatedUnion('success', [
        z.strictObject({
            success: z.literal(true),
            translatedText: nonBlankString,
            cached: z.boolean(),
            processingTime: nonNegativeSafeInteger,
        }),
        z.strictObject({
            success: z.literal(false),
            retryable: z.boolean(),
            retryAfter: z.union([
                z.null(),
                z.number().int().min(0).max(MAX_TRANSLATION_RETRY_AFTER_MS),
            ]),
        }),
    ]),
});

export type TranslateRequest = z.infer<typeof translate.request>;
export type TranslateResponse = z.infer<typeof translate.response>;
