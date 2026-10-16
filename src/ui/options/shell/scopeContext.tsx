import { createContext, useContext, useEffect } from 'react';
import type { SiteSettingKey } from '@/config/schema';
import { PLATFORM_NAMES } from '@/shared/platforms';
import type { Translate } from '../../hooks/useI18n';
import { useDraft, type Draft } from '../controls/useDraft';
import type { SaveFeedback, Scope } from '../types';

interface ScopeContextValue {
    readonly t: Translate;
    readonly scope: Scope;
    /** The keys the scoped site holds its own values for. */
    readonly ownKeys: ReadonlySet<string>;
    readonly followShared: (keys: readonly SiteSettingKey[]) => void;
    /** Lets following the value for all sites cancel `key`'s draft first;
     *  returns the way to stop. */
    readonly registerDraft: (
        key: SiteSettingKey,
        cancel: () => void
    ) => () => void;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export const ScopeProvider = ScopeContext.Provider;

/**
 * Under a site's scope, says whether a control shows that site's own value,
 * with the way back to the value for all sites, or the shared value it
 * follows. Nothing shows while editing all sites.
 */
export function SiteTag({ keys }: { keys: readonly SiteSettingKey[] }) {
    const context = useContext(ScopeContext);
    if (!context || context.scope === 'all') {
        return null;
    }
    const { t, scope, ownKeys, followShared } = context;
    if (!keys.some((key) => ownKeys.has(key))) {
        return (
            <div className="site-tag">
                <span className="tag muted">{t('scopeSameAsAll')}</span>
            </div>
        );
    }
    return (
        <div className="site-tag">
            <span className="tag site">
                {t('scopeSiteOnly', PLATFORM_NAMES[scope])}
            </span>
            <button
                type="button"
                className="link-button"
                onClick={() => followShared(keys)}
            >
                {t('scopeUseShared')}
            </button>
        </div>
    );
}

/** A site setting's draft. Following the value for all sites cancels it, so
 *  an edit still waiting to be written cannot bring the site's own value
 *  back. */
export function useSiteDraft<T>(
    key: SiteSettingKey,
    saved: T,
    write: (value: T, notice: SaveFeedback) => Promise<boolean>
): Draft<T> {
    const draft = useDraft(saved, write);
    const registerDraft = useContext(ScopeContext)?.registerDraft;
    const { cancel } = draft;
    useEffect(() => registerDraft?.(key, cancel), [registerDraft, key, cancel]);
    return draft;
}

/** Under a site's scope, marks a setting that every site shares. */
export function SharedTag() {
    const context = useContext(ScopeContext);
    if (!context || context.scope === 'all') {
        return null;
    }
    return (
        <div className="site-tag">
            <span className="tag muted">{context.t('scopeSharedSetting')}</span>
        </div>
    );
}
