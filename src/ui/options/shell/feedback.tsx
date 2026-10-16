import { createContext, useContext } from 'react';
import {
    isSettingsKey,
    isSiteSettingKey,
    type SettingsKey,
    type SettingsValues,
    type SiteSettingKey,
} from '@/config/schema';
import { configService, type SettingsChange } from '@/config/service';
import type { PlatformId } from '@/shared/platforms';
import type { SaveFeedback } from '../../hooks/useDraft';
import type { Scope } from '../types';

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
    /** Say something that changed nothing, such as a blocked copy. */
    readonly notify: (message: string, tone: ToastTone) => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export const FeedbackProvider = FeedbackContext.Provider;

/**
 * A settings handle's save that confirms a named change in a toast whose
 * Undo puts back what the change replaced, read as the change is written.
 * Under a site's scope its settings land in the site's own values, so the
 * change is to the shared values and the site profiles.
 */
export function feedbackSave<Values extends Partial<SettingsValues>>(
    handle: {
        readonly save: (
            changes: Partial<Values>
        ) => Promise<Partial<SettingsValues>>;
    },
    scope: Scope,
    feedback: Feedback
): (changes: Partial<Values>, notice?: SaveFeedback) => Promise<boolean> {
    return (changes, notice = 'quiet') => {
        if (notice === 'quiet') {
            return feedback.apply(() => handle.save(changes));
        }
        const keys = Object.keys(changes).filter(isSettingsKey);
        const shared = keys.filter(
            (key) => scope === 'all' || !isSiteSettingKey(key)
        );
        const touched: SettingsKey[] =
            shared.length < keys.length ? [...shared, 'siteProfiles'] : shared;
        let change: SettingsChange = { before: {}, after: {} };
        return feedback.apply(
            async () => {
                const before = await configService.getMultiple(touched);
                const written = await handle.save(changes);
                change = {
                    before,
                    after: Object.fromEntries(
                        touched.map((key) => [key, written[key]])
                    ),
                };
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
