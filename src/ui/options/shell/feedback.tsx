import { createContext, useContext } from 'react';
import type { SettingsValues, SiteSettingKey } from '@/config/schema';
import {
    configService,
    leftAsFound,
    type SettingsChange,
} from '@/config/service';
import type { PlatformId } from '@/shared/platforms';
import type { SaveFeedback } from '../../hooks/useDraft';

export type ToastTone = 'done' | 'problem';

/** What a change says once made, and how to take it back, if it can be. */
export interface Confirmation {
    readonly message: string;
    readonly undo: (() => Promise<unknown>) | null;
}

export interface Feedback {
    /**
     * Make a change, once every change asked for before it is made. A
     * failure shows the page's banner and resolves false. A success clears
     * the banner and shows the confirmation the change resolves to, its
     * Undo made the same way. A change that confirms nothing leaves the
     * toast as it was, with the Undo it offers.
     */
    readonly apply: (
        change: () => Promise<Confirmation | undefined>
    ) => Promise<boolean>;
    /** Take back the Undo offered, and the one each change asked for until
     *  now would offer: an edit is on its way, not asked for yet, that
     *  builds on them. */
    readonly takeBackUndo: () => void;
    /** Say something that changed nothing, such as a blocked copy. */
    readonly notify: (message: string, tone: ToastTone) => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export const FeedbackProvider = FeedbackContext.Provider;

/** `change` confirmed with `message` and an Undo that puts it back; none
 *  for a change that left everything as it was, such as a second press of
 *  the same choice, whose first Undo stays the one offered. */
export function confirmChange(
    change: SettingsChange,
    message: string
): Confirmation | undefined {
    return leftAsFound(change)
        ? undefined
        : { message, undo: () => configService.putBack(change) };
}

/** A settings handle's save that confirms a named change in a toast whose
 *  Undo puts back what the write replaced, as the write read it in its
 *  turn. */
export function feedbackSave<Values extends Partial<SettingsValues>>(
    handle: {
        readonly save: (changes: Partial<Values>) => Promise<SettingsChange>;
    },
    feedback: Feedback
): (changes: Partial<Values>, notice?: SaveFeedback) => Promise<boolean> {
    return (changes, notice = 'quiet') =>
        feedback.apply(async () => {
            const change = await handle.save(changes);
            return notice === 'quiet'
                ? undefined
                : confirmChange(change, notice.message);
        });
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
    return feedback.apply(async () =>
        confirmChange(
            await configService.removeSiteValues(sites, keys, shared),
            message
        )
    );
}

export function useFeedback(): Feedback {
    const feedback = useContext(FeedbackContext);
    if (!feedback) {
        throw new Error('useFeedback needs a FeedbackProvider');
    }
    return feedback;
}
