import { z } from 'zod';
import { CONTEXT_TYPES } from '@/shared/contextTypes';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import { boundedText, nonBlankString } from './primitives';

/** 1–3 unique canonical context types. */
const contextTypes = z
    .array(z.enum(CONTEXT_TYPES))
    .min(1)
    .max(3)
    .refine((types) => new Set(types).size === types.length);

const contentRequest = z.strictObject({
    action: z.literal(MessageActions.ANALYZE_CONTEXT),
    text: nonBlankString,
    contextTypes,
    language: nonBlankString,
    targetLanguage: nonBlankString,
    platform: nonBlankString,
    requestId: nonBlankString,
});

// The side-panel variant may carry `contextType` exactly when it requests a
// single type, and it must match.
const sidepanelRequest = z
    .strictObject({
        action: z.literal(MessageActions.ANALYZE_CONTEXT),
        text: nonBlankString,
        contextTypes,
        targetLanguage: nonBlankString,
        requestId: nonBlankString,
        contextType: z.enum(CONTEXT_TYPES).optional(),
    })
    .refine((request) =>
        request.contextType === undefined
            ? request.contextTypes.length !== 1
            : request.contextTypes.length === 1 &&
              request.contextType === request.contextTypes[0]
    );

export const analyzeContext = defineContract({
    action: MessageActions.ANALYZE_CONTEXT,
    transport: 'runtime',
    senders: ['content', 'sidepanel'],
    request: z.union([contentRequest, sidepanelRequest]),
    requestByRole: {
        content: contentRequest,
        sidepanel: sidepanelRequest,
    },
    response: z.discriminatedUnion('success', [
        z.strictObject({
            success: z.literal(true),
            result: z.strictObject({
                analysis: z.record(z.string(), z.unknown()),
                contextType: z.enum([...CONTEXT_TYPES, 'all', 'combined']),
                contextTypes,
                isStructured: z.literal(true),
            }),
        }),
        z.strictObject({
            success: z.literal(false),
            error: boundedText(512),
            shouldRetry: z.boolean(),
        }),
    ]),
});

/** 'all' when every type is requested, one type verbatim, else 'combined'. */
export function deriveAnalyzeContextType(
    types: readonly (typeof CONTEXT_TYPES)[number][]
): (typeof CONTEXT_TYPES)[number] | 'all' | 'combined' {
    if (types.length === 1) {
        return types[0]!;
    }
    if (
        types.length === CONTEXT_TYPES.length &&
        CONTEXT_TYPES.every((type) => types.includes(type))
    ) {
        return 'all';
    }
    return 'combined';
}
