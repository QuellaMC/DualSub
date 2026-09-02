import { z } from 'zod';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import { utf8ByteLength } from '../snapshot';
import { nonNegativeSafeInteger, positiveSafeInteger } from './primitives';

export const SELECTION_SNAPSHOT_LIMITS = Object.freeze({
    maxDepth: 4,
    maxEntries: 256,
    maxStringBytes: 4096,
    maxTotalBytes: 6144,
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

function entriesMatchReason(data: {
    reason: SelectionReason;
    entries: readonly unknown[];
}): boolean {
    if (data.reason === 'clear' || data.reason === 'subtitle-change') {
        return data.entries.length === 0;
    }
    if (data.reason === 'add' || data.reason === 'restore') {
        return data.entries.length > 0;
    }
    return true;
}

/** Content-authored snapshot: the single source of selection truth. */
export const contentSelectionSnapshot = z
    .strictObject({
        lifecycleGeneration: positiveSafeInteger,
        selectionRevision: positiveSafeInteger,
        renderRevision: positiveSafeInteger,
        reason: selectionReason,
        entries: selectionEntries,
    })
    .refine(entriesMatchReason);

export type ContentSelectionSnapshot = z.infer<typeof contentSelectionSnapshot>;

/** Panel-facing state: owner generation instead of raw lifecycle. */
export const selectionState = z
    .strictObject({
        selectionOwnerGeneration: positiveSafeInteger,
        selectionRevision: positiveSafeInteger,
        renderRevision: positiveSafeInteger,
        reason: selectionReason,
        entries: selectionEntries,
    })
    .refine(entriesMatchReason);

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

/** Background asks content to republish its authoritative selection;
 *  `accepted` says the replay reached the background before the ack. */
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
        accepted: z.boolean(),
    }),
});

/**
 * Phase two of panel-initiated removal: background commands content, content
 * applies authoritatively and answers applied/rejected. The panel only
 * updates from the republished snapshot, never optimistically.
 */
export const selectionRemovalCommand = defineContract({
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
        }),
    }),
    response: z.strictObject({
        success: z.boolean(),
        requestId: positiveSafeInteger,
    }),
});
