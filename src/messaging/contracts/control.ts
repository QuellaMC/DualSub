import { z } from 'zod';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import { boundedText } from './primitives';

const MAX_CONFIG_CHANGED_KEYS = 32;

export const CONFIG_CHANGED_LIMITS = Object.freeze({
    maxDepth: 6,
    maxEntries: 64,
    maxStringBytes: 4096,
    maxTotalBytes: 16384,
});

/** Shared ack for background/popup → content control messages. */
const controlAck = z.discriminatedUnion('success', [
    z.strictObject({ success: z.literal(true) }),
    z.strictObject({ success: z.literal(false), error: boundedText(512) }),
]);

// Values are re-validated by the content side against the settings schema
// before use; the contract bounds shape and size only.
export const configChanged = defineContract({
    action: MessageActions.CONFIG_CHANGED,
    transport: 'tab',
    senders: ['popup'],
    budget: CONFIG_CHANGED_LIMITS,
    request: z.strictObject({
        action: z.literal(MessageActions.CONFIG_CHANGED),
        changes: z
            .record(z.string(), z.unknown())
            .refine(
                (changes) =>
                    Object.keys(changes).length >= 1 &&
                    Object.keys(changes).length <= MAX_CONFIG_CHANGED_KEYS
            ),
    }),
    response: controlAck,
});

/** Whether Match Platform on this tab follows the viewer's own platform
 *  subtitle settings, or the platform's preset until they are read. */
export const platformLookStatus = defineContract({
    action: MessageActions.PLATFORM_LOOK_STATUS,
    transport: 'tab',
    senders: ['popup'],
    request: z.strictObject({
        action: z.literal(MessageActions.PLATFORM_LOOK_STATUS),
    }),
    response: z.strictObject({
        platform: z.enum(['netflix', 'disneyplus']),
        captured: z.boolean(),
    }),
});

export const loggingLevelChanged = defineContract({
    action: MessageActions.LOGGING_LEVEL_CHANGED,
    transport: 'tab',
    senders: ['background'],
    request: z.strictObject({
        action: z.literal(MessageActions.LOGGING_LEVEL_CHANGED),
        level: z.number().int().min(0).max(4),
    }),
    response: controlAck,
});

export const sidePanelPauseVideo = defineContract({
    action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
    transport: 'tab',
    senders: ['background'],
    request: z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_PAUSE_VIDEO),
    }),
    response: controlAck,
});
