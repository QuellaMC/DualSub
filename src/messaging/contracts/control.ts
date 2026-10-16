import { z } from 'zod';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';
import { boundedText } from './primitives';

/** Shared ack for background → content control messages. */
const controlAck = z.discriminatedUnion('success', [
    z.strictObject({ success: z.literal(true) }),
    z.strictObject({ success: z.literal(false), error: boundedText(512) }),
]);

/** Whether DualSub is serving a video player on this tab. */
export const playerStatus = defineContract({
    action: MessageActions.PLAYER_STATUS,
    transport: 'tab',
    senders: ['popup'],
    request: z.strictObject({
        action: z.literal(MessageActions.PLAYER_STATUS),
    }),
    response: z.strictObject({ onPlayer: z.boolean() }),
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
