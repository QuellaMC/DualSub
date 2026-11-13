import { z } from 'zod';
import { CONTEXT_TYPES } from '@/shared/contextTypes';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import { boundedNonBlankString, languageTag } from './primitives';

/** The kinds of explanation the viewer asks for, each at most once; none
 *  leaves the meaning in the line and how it sounds. */
const contextTypes = z
    .array(z.enum(CONTEXT_TYPES))
    .max(CONTEXT_TYPES.length)
    .refine((types) => new Set(types).size === types.length);

/** How the words sound to people who speak the language. */
export const ANSWER_REGISTERS = [
    'everyday',
    'casual',
    'formal',
    'slang',
    'offensive',
] as const;

export type AnswerRegister = (typeof ANSWER_REGISTERS)[number];

const answerText = boundedNonBlankString(4096);

export const MAX_ANSWER_EXAMPLES = 5;
export const MAX_ANSWER_SIMILAR = 8;

/**
 * One explanation of picked words, in the viewer's language. The meaning
 * in the line and how the words sound always come; the rest comes with
 * the kind that asks for it: examples, similar words and a tip with the
 * meaning, `culture` with the culture, `history` with the history.
 */
export const aiAnswer = z.strictObject({
    meaning: answerText,
    register: z.enum(ANSWER_REGISTERS),
    examples: z
        .array(
            z.strictObject({
                text: boundedNonBlankString(1024),
                translation: boundedNonBlankString(1024),
            })
        )
        .max(MAX_ANSWER_EXAMPLES)
        .optional(),
    similar: z
        .array(boundedNonBlankString(256))
        .max(MAX_ANSWER_SIMILAR)
        .optional(),
    tip: answerText.optional(),
    culture: answerText.optional(),
    history: answerText.optional(),
});

export type AiAnswer = z.infer<typeof aiAnswer>;

/** Why there is no answer: no usable key yet, a key the service refused,
 *  or anything else. */
export const ANSWER_FAILURES = ['setup', 'auth', 'failed'] as const;

export type AnswerFailure = (typeof ANSWER_FAILURES)[number];

/** The side panel asks for an explanation of the picked words in their
 *  line. */
export const analyzeContext = defineContract({
    action: MessageActions.ANALYZE_CONTEXT,
    transport: 'runtime',
    senders: ['sidepanel'],
    request: z.strictObject({
        action: z.literal(MessageActions.ANALYZE_CONTEXT),
        text: boundedNonBlankString(4096),
        line: boundedNonBlankString(2048),
        /** The language of the line, when it is known. */
        language: languageTag.nullable(),
        contextTypes,
        targetLanguage: languageTag,
    }),
    response: z.discriminatedUnion('success', [
        z.strictObject({ success: z.literal(true), answer: aiAnswer }),
        z.strictObject({
            success: z.literal(false),
            reason: z.enum(ANSWER_FAILURES),
        }),
    ]),
});

export type AnalyzeContextRequest = z.infer<typeof analyzeContext.request>;
export type AnalyzeContextResponse = z.infer<typeof analyzeContext.response>;
