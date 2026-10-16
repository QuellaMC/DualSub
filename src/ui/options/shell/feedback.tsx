import { createContext, useContext } from 'react';
import type { SiteProfile, SiteSettingKey } from '@/config/schema';
import { configService, type SiteWrite } from '@/config/service';
import type { PlatformId } from '@/shared/platforms';
import type { SaveFeedback } from '../../hooks/useDraft';
import type { Scope } from '../types';

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

export function siteWriteFor(scope: Scope): SiteWrite | undefined {
    return scope === 'all' ? undefined : { site: scope, target: 'own' };
}

/** A settings handle's save that confirms a named change in a toast whose
 *  Undo writes the previous values back to the same scope. */
export function feedbackSave<Values extends object>(
    handle: {
        readonly settings: Values | null;
        readonly save: (changes: Partial<Values>) => Promise<void>;
    },
    scope: Scope,
    feedback: Feedback
): (changes: Partial<Values>, notice?: SaveFeedback) => Promise<boolean> {
    return (changes, notice = 'quiet') => {
        const previous = Object.fromEntries(
            Object.keys(changes).map((key) => [
                key,
                handle.settings?.[key as keyof Values],
            ])
        );
        return feedback.apply(
            () => handle.save(changes),
            notice === 'quiet' ? undefined : notice.message,
            () => configService.setMultiple(previous, siteWriteFor(scope))
        );
    };
}

/** Drop a site's own values for `keys`, so the site follows the settings
 *  for all sites again; Undo gives the values back. */
export function followAllSites(
    feedback: Feedback,
    site: PlatformId,
    profile: SiteProfile,
    keys: readonly SiteSettingKey[],
    message: string
): Promise<boolean> {
    const previous = Object.fromEntries(
        keys
            .filter((key) => Object.hasOwn(profile, key))
            .map((key) => [key, profile[key]])
    );
    return feedback.apply(
        () => configService.removeSiteValues(site, keys),
        message,
        () => configService.setMultiple(previous, siteWriteFor(site))
    );
}

export function useFeedback(): Feedback {
    const feedback = useContext(FeedbackContext);
    if (!feedback) {
        throw new Error('useFeedback needs a FeedbackProvider');
    }
    return feedback;
}
