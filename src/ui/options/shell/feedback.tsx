import { createContext, useContext } from 'react';
import {
    isSiteSettingKey,
    type SettingsValues,
    type SiteSettingKey,
} from '@/config/schema';
import { configService } from '@/config/service';
import type { PlatformId } from '@/shared/platforms';
import type { SaveFeedback } from '../../hooks/useDraft';
import type { Scope } from '../types';

export type ToastTone = 'done' | 'problem';

export interface Feedback {
    /**
     * Make a change, once every change asked for before it is made. A
     * failure shows the page's banner and resolves false. A success clears
     * the banner and, given a message, confirms it in a toast whose Undo
     * makes `undo` the same way; a success without one takes back an Undo
     * still offered, which would put back this change too.
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
 * Undo puts back what the change replaced, read as the change is written:
 * the shared values, and for a site, its own values for the changed keys
 * exactly as they were, merged into the profiles stored by then. Writing a
 * site's previous values back through the site would drop one equal to the
 * shared value, turning a site's own value into one it follows.
 */
export function feedbackSave<Values>(
    handle: { readonly save: (changes: Partial<Values>) => Promise<void> },
    scope: Scope,
    feedback: Feedback
): (changes: Partial<Values>, notice?: SaveFeedback) => Promise<boolean> {
    return (changes, notice = 'quiet') => {
        if (notice === 'quiet') {
            return feedback.apply(() => handle.save(changes));
        }
        const keys = Object.keys(changes);
        const siteKeys = scope === 'all' ? [] : keys.filter(isSiteSettingKey);
        const sharedKeys = keys.filter(
            (key) => scope === 'all' || !isSiteSettingKey(key)
        );
        let before: Partial<SettingsValues> = {};
        return feedback.apply(
            async () => {
                before = await configService.getMultiple(
                    siteKeys.length === 0
                        ? sharedKeys
                        : [...sharedKeys, 'siteProfiles']
                );
                await handle.save(changes);
            },
            notice.message,
            () =>
                siteKeys.length === 0
                    ? configService.setMultiple(before)
                    : configService.restoreSiteValues(
                          before,
                          siteKeys.map((key) => [scope, key] as const)
                      )
        );
    };
}

/** Drop a site's own values for `keys`, so the site follows the settings
 *  for all sites again; Undo gives the site those values back. */
export function followAllSites(
    feedback: Feedback,
    site: PlatformId,
    keys: readonly SiteSettingKey[],
    message: string
): Promise<boolean> {
    let before: Partial<SettingsValues> = {};
    return feedback.apply(
        async () => {
            before = await configService.removeSiteValues([site], keys);
        },
        message,
        () =>
            configService.restoreSiteValues(
                before,
                keys.map((key) => [site, key] as const)
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
