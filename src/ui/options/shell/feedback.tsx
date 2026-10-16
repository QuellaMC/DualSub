import { createContext, useContext } from 'react';
import {
    isSiteSettingKey,
    type SettingsValues,
    type SiteSettingKey,
} from '@/config/schema';
import { configService } from '@/config/service';
import type { PlatformId } from '@/shared/platforms';
import type { SaveFeedback, Scope } from '../types';

export type ToastTone = 'done' | 'problem';

export interface Feedback {
    /**
     * Make a change. A failure shows the page's banner and resolves false.
     * A success clears the banner and, given a message, confirms it in a
     * toast whose Undo makes `undo` the same way.
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
 * Undo puts back what the change replaced: the shared values, and for a
 * site, the site profiles exactly as they were. Writing a site's previous
 * values back through the site would drop one equal to the shared value,
 * turning a site's own value into one it follows.
 */
export function feedbackSave<
    Values extends { readonly siteProfiles: SettingsValues['siteProfiles'] },
>(
    handle: {
        readonly settings: Values | null;
        readonly save: (changes: Partial<Values>) => Promise<void>;
    },
    scope: Scope,
    feedback: Feedback
): (changes: Partial<Values>, notice?: SaveFeedback) => Promise<boolean> {
    return (changes, notice = 'quiet') => {
        const previous: Record<string, unknown> = {};
        for (const key of Object.keys(changes)) {
            if (scope !== 'all' && isSiteSettingKey(key)) {
                previous.siteProfiles = handle.settings?.siteProfiles;
            } else {
                previous[key] = handle.settings?.[key as keyof Values];
            }
        }
        return feedback.apply(
            () => handle.save(changes),
            notice === 'quiet' ? undefined : notice.message,
            () => configService.setMultiple(previous)
        );
    };
}

/** Drop a site's own values for `keys`, so the site follows the settings
 *  for all sites again; Undo puts `profiles` back as they were. */
export function followAllSites(
    feedback: Feedback,
    site: PlatformId,
    profiles: SettingsValues['siteProfiles'],
    keys: readonly SiteSettingKey[],
    message: string
): Promise<boolean> {
    return feedback.apply(
        () => configService.removeSiteValues(site, keys),
        message,
        () => configService.setMultiple({ siteProfiles: profiles })
    );
}

export function useFeedback(): Feedback {
    const feedback = useContext(FeedbackContext);
    if (!feedback) {
        throw new Error('useFeedback needs a FeedbackProvider');
    }
    return feedback;
}
