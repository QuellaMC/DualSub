import { z } from 'zod';
import { MessageActions } from '../actions';
import { nonNegativeSafeInteger, positiveSafeInteger } from './primitives';
import { selectionState } from './selection';

export const SIDEPANEL_PORT_NAME = 'sidepanel';

/** Identity of one panel registration bound to one tab. */
export const sidePanelBinding = z.strictObject({
    registrationId: positiveSafeInteger,
    tabId: nonNegativeSafeInteger,
    windowId: nonNegativeSafeInteger,
});
export type SidePanelBinding = z.infer<typeof sidePanelBinding>;

const tabBinding = z.strictObject({
    tabId: nonNegativeSafeInteger,
    windowId: nonNegativeSafeInteger,
});

export const removalStatus = z.enum(['applied', 'rejected']);

export const panelToBackground = z.discriminatedUnion('action', [
    z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_REGISTER),
        data: sidePanelBinding,
        source: z.literal('sidepanel'),
        timestamp: nonNegativeSafeInteger,
    }),
    z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_UPDATE_STATE),
        data: z.strictObject({
            binding: sidePanelBinding,
            requestId: positiveSafeInteger,
            selectionOwnerGeneration: positiveSafeInteger,
            selectionRevision: positiveSafeInteger,
            renderRevision: positiveSafeInteger,
            wordIndex: nonNegativeSafeInteger,
        }),
    }),
]);
export type PanelToBackgroundFrame = z.infer<typeof panelToBackground>;

export const backgroundToPanel = z.discriminatedUnion('action', [
    z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_BINDING_CONFIRMED),
        data: sidePanelBinding,
    }),
    z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_SELECTION_SYNC),
        data: z.strictObject({
            binding: sidePanelBinding,
            selection: z.union([z.null(), selectionState]),
        }),
    }),
    z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_TAB_ACTIVATED),
        data: tabBinding,
    }),
    z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_FORCE_BIND_TAB),
        data: tabBinding,
    }),
    z.strictObject({
        action: z.literal(MessageActions.SIDEPANEL_UPDATE_STATE),
        data: z.strictObject({
            binding: sidePanelBinding,
            requestId: positiveSafeInteger,
            selectionOwnerGeneration: positiveSafeInteger,
            status: removalStatus,
        }),
    }),
]);
export type BackgroundToPanelFrame = z.infer<typeof backgroundToPanel>;
