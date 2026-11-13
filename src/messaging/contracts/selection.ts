import { z } from 'zod';
import { lineWords } from '@/shared/words';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import { utf8ByteLength } from '../snapshot';
import {
    languageTag,
    nonNegativeSafeInteger,
    positiveSafeInteger,
} from './primitives';

export const SELECTION_SNAPSHOT_LIMITS = Object.freeze({
    maxDepth: 4,
    maxEntries: 256,
    maxStringBytes: 4096,
    maxTotalBytes: 12_288,
});

const MAX_SELECTION_ENTRIES = 64;
const MAX_SELECTION_WORD_BYTES = 256;
const MAX_SELECTION_JOINED_CODE_UNITS = 500;
const MAX_SELECTION_JOINED_BYTES = 4096;

export const selectionReason = z.enum([
    'toggle',
    'add',
    'remove',
    'clear',
    'restore',
    'subtitle-change',
    'translation',
]);
export type SelectionReason = z.infer<typeof selectionReason>;

const selectionWord = z
    .string()
    .refine(
        (word) =>
            word.length > 0 &&
            word.isWellFormed() &&
            utf8ByteLength(word) <= MAX_SELECTION_WORD_BYTES
    );

/**
 * Selection entries stay in sentence order: wordIndex strictly increasing,
 * with caps on the joined phrase so a hostile page cannot smuggle bulk text
 * through the selection channel.
 */
export const selectionEntries = z
    .array(
        z.strictObject({
            wordIndex: nonNegativeSafeInteger,
            word: selectionWord,
        })
    )
    .max(MAX_SELECTION_ENTRIES)
    .superRefine((entries, context) => {
        let previousWordIndex = -1;
        let joinedCodeUnits = 0;
        let joinedBytes = 0;
        for (const [index, entry] of entries.entries()) {
            if (entry.wordIndex <= previousWordIndex) {
                context.addIssue({
                    code: 'custom',
                    message: 'wordIndex must be strictly increasing',
                });
                return;
            }
            previousWordIndex = entry.wordIndex;
            if (index > 0) {
                joinedCodeUnits += 1;
                joinedBytes += 1;
            }
            joinedCodeUnits += entry.word.length;
            joinedBytes += utf8ByteLength(entry.word);
            if (
                joinedCodeUnits > MAX_SELECTION_JOINED_CODE_UNITS ||
                joinedBytes > MAX_SELECTION_JOINED_BYTES
            ) {
                context.addIssue({
                    code: 'custom',
                    message: 'joined selection exceeds size limits',
                });
                return;
            }
        }
    });

export type SelectionEntry = z.infer<typeof selectionEntries>[number];

/** Painted text up to `maxCodeUnits` and `maxBytes`, kept as painted. */
const paintedText = (maxCodeUnits: number, maxBytes: number) =>
    z
        .string()
        .refine(
            (value) =>
                value.trim().length > 0 &&
                value.length <= maxCodeUnits &&
                value.isWellFormed() &&
                utf8ByteLength(value) <= maxBytes
        );

/** The translation painted under a line; one longer than this is not sent.
 *  It may run longer than its line, as translations do. */
export const lineTranslation = paintedText(1000, 3072);

/** The line the selection belongs to, as content painted and split it. */
export const selectionLine = z.strictObject({
    text: paintedText(500, 2048),
    language: languageTag.nullable(),
    translation: lineTranslation.nullable(),
});

export type SelectionLine = z.infer<typeof selectionLine>;

/** A new line or a cleared selection carries nothing; every other snapshot
 *  carries its line, and each entry is the word at its index in that line. */
function coherent(data: {
    reason: SelectionReason;
    entries: readonly SelectionEntry[];
    line: SelectionLine | null;
}): boolean {
    if (data.reason === 'clear' || data.reason === 'subtitle-change') {
        return data.entries.length === 0 && data.line === null;
    }
    if (data.line === null) {
        return false;
    }
    if (
        (data.reason === 'add' || data.reason === 'restore') &&
        data.entries.length === 0
    ) {
        return false;
    }
    const words = lineWords(data.line);
    return data.entries.every(
        (entry) => words[entry.wordIndex]?.word === entry.word
    );
}

/** Content-authored snapshot: the single source of selection truth. */
export const contentSelectionSnapshot = z
    .strictObject({
        lifecycleGeneration: positiveSafeInteger,
        selectionRevision: positiveSafeInteger,
        renderRevision: positiveSafeInteger,
        reason: selectionReason,
        entries: selectionEntries,
        line: selectionLine.nullable(),
    })
    .refine(coherent);

export type ContentSelectionSnapshot = z.infer<typeof contentSelectionSnapshot>;

/** Panel-facing state: owner generation instead of raw lifecycle. */
/** The content document and lifecycle a selection belongs to, opaque to
 *  the panel: equal strings mean the same session, so the same words. */
const selectionSession = z.string().min(1).max(256);

export const selectionState = z
    .strictObject({
        session: selectionSession,
        selectionOwnerGeneration: positiveSafeInteger,
        selectionRevision: positiveSafeInteger,
        renderRevision: positiveSafeInteger,
        reason: selectionReason,
        entries: selectionEntries,
        line: selectionLine.nullable(),
    })
    .refine(coherent);

export type SelectionState = z.infer<typeof selectionState>;

export const sidePanelSelectionSync = defineContract({
    action: MessageActions.SIDEPANEL_SELECTION_SYNC,
    transport: 'runtime',
    senders: ['content'],
    budget: SELECTION_SNAPSHOT_LIMITS,
    request: z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_SELECTION_SYNC),
        data: contentSelectionSnapshot,
    }),
    response: z.strictObject({ success: z.boolean() }),
});

export const sidePanelWordSelected = defineContract({
    action: MessageActions.SIDEPANEL_WORD_SELECTED,
    transport: 'runtime',
    senders: ['content'],
    budget: Object.freeze({
        maxDepth: 2,
        maxEntries: 8,
        maxStringBytes: 64,
        maxTotalBytes: 256,
    }),
    request: z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_WORD_SELECTED),
        options: z.strictObject({
            autoOpen: z.boolean(),
            pauseVideo: z.boolean(),
        }),
    }),
    response: z.strictObject({ success: z.boolean() }),
});

/** What a republish request found: the current snapshot was replayed and
 *  accepted before the reply, there is no snapshot at all, or there is one
 *  but publishing it failed (so nothing is known either way). */
export const selectionRepublishResult = z.enum(['replayed', 'empty', 'failed']);

export type SelectionRepublishResult = z.infer<typeof selectionRepublishResult>;

/** Background asks content to republish its authoritative selection. */
export const selectionRepublishRequest = defineContract({
    action: MessageActions.SIDEPANEL_GET_STATE,
    transport: 'tab',
    senders: ['background'],
    request: z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_GET_STATE),
        data: z.strictObject({ requestId: positiveSafeInteger }),
    }),
    response: z.strictObject({
        requestId: positiveSafeInteger,
        result: selectionRepublishResult,
    }),
});

/** What a panel asks of one word of the line. */
export const selectionEditOp = z.enum(['add', 'remove']);

export type SelectionEditOp = z.infer<typeof selectionEditOp>;

/**
 * Phase two of a panel-initiated edit: background commands content, content
 * applies authoritatively and answers applied/rejected. The panel only
 * updates from the republished snapshot, never optimistically.
 */
export const selectionEditCommand = defineContract({
    action: MessageActions.SIDEPANEL_UPDATE_STATE,
    transport: 'tab',
    senders: ['background'],
    request: z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_UPDATE_STATE),
        data: z.strictObject({
            requestId: positiveSafeInteger,
            lifecycleGeneration: positiveSafeInteger,
            selectionRevision: positiveSafeInteger,
            renderRevision: positiveSafeInteger,
            wordIndex: nonNegativeSafeInteger,
            op: selectionEditOp,
        }),
    }),
    response: z.strictObject({
        success: z.boolean(),
        requestId: positiveSafeInteger,
    }),
});
