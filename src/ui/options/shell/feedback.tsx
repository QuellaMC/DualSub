import { createContext, useContext } from 'react';
import type { SettingsValues, SiteSettingKey } from '@/config/schema';
import { configService, type SettingsChange } from '@/config/service';
import type { PlatformId } from '@/shared/platforms';
import type { SaveFeedback } from '../../hooks/useDraft';

export type ToastTone = 'done' | 'problem';

export interface Feedback {
    /**
     * Make a change, once every change asked for before it is made. Asking
     * takes back an Undo still offered, which would put back this change
     * too. A failure shows the page's banner and resolves false. A success
     * clears the banner and, given a message, confirms it in a toast whose
     * Undo makes `undo` the same way.
     */
    readonly apply: (
        change: () => Promise<unknown>,
        message?: string,
        undo?: () => Promise<unknown>
    ) => Promise<boolean>;
    /** Take back an Undo still offered for an edit on its way, though not
     *  asked for yet, which the Undo would put back too. */
    readonly takeBackUndo: () => void;
    /** Say something that changed nothing, such as a blocked copy. */
    readonly notify: (message: string, tone: ToastTone) => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export const FeedbackProvider = FeedbackContext.Provider;

/** A settings handle's save that confirms a named change in a toast whose
 *  Undo puts back what the write replaced, as the write read it in its
 *  turn. */
export function feedbackSave<Values extends Partial<SettingsValues>>(
    handle: {
        readonly save: (changes: Partial<Values>) => Promise<SettingsChange>;
    },
    feedback: Feedback
): (changes: Partial<Values>, notice?: SaveFeedback) => Promise<boolean> {
    return (changes, notice = 'quiet') => {
        if (notice === 'quiet') {
            return feedback.apply(() => handle.save(changes));
        }
        let change: SettingsChange = { before: {}, after: {} };
        return feedback.apply(
            async () => {
                change = await handle.save(changes);
            },
            notice.message,
            () => configService.putBack(change)
        );
    };
}

/** Drop `sites`' own values for `keys`, so they follow the settings for all
 *  sites again, with `shared` written alongside; Undo gives them back. */
export function followAllSites(
    feedback: Feedback,
    sites: readonly PlatformId[],
    keys: readonly SiteSettingKey[],
    message: string,
    shared: Partial<Omit<SettingsValues, 'siteProfiles'>> = {}
): Promise<boolean> {
    let change: SettingsChange = { before: {}, after: {} };
    return feedback.apply(
        async () => {
            change = await configService.removeSiteValues(sites, keys, shared);
        },
        message,
        () => configService.putBack(change)
    );
}

export function useFeedback(): Feedback {
    const feedback = useContext(FeedbackContext);
    if (!feedback) {
        throw new Error('useFeedback needs a FeedbackProvider');
    }
    return feedback;
}
