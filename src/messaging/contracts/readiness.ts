import { z } from 'zod';
import { MessageActions } from '../actions';
import { defineContract } from '../registry';

const readinessResponse = z
    .strictObject({
        ready: z.boolean(),
        services: z.strictObject({
            translation: z.boolean(),
            subtitle: z.boolean(),
            aiContext: z.boolean(),
            aiContextInitialized: z.boolean(),
        }),
    })
    .refine(
        ({ ready, services }) =>
            (!services.aiContextInitialized || services.aiContext) &&
            ready ===
                (services.translation &&
                    services.subtitle &&
                    services.aiContext &&
                    services.aiContextInitialized)
    );

export const ping = defineContract({
    action: MessageActions.PING,
    transport: 'runtime',
    senders: ['content', 'sidepanel'],
    request: z.strictObject({ action: z.literal(MessageActions.PING) }),
    response: readinessResponse,
});

export const checkBackgroundReady = defineContract({
    action: MessageActions.CHECK_BACKGROUND_READY,
    transport: 'runtime',
    senders: ['content', 'sidepanel'],
    request: z.strictObject({
        action: z.literal(MessageActions.CHECK_BACKGROUND_READY),
    }),
    response: readinessResponse,
});
