import { createContext, useContext } from 'react';
import type { SiteSettingKey } from '@/config/schema';
import { PLATFORM_NAMES } from '@/shared/platforms';
import type { Translate } from '../../hooks/useI18n';
import type { Scope } from '../types';

interface ScopeContextValue {
    readonly t: Translate;
    readonly scope: Scope;
    /** The keys the scoped site holds its own values for. */
    readonly ownKeys: ReadonlySet<string>;
    readonly followShared: (keys: readonly SiteSettingKey[]) => void;
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
