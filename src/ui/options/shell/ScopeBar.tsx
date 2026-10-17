import { PLATFORM_IDS, PLATFORM_NAMES } from '@/shared/platforms';
import type { Translate } from '../../hooks/useI18n';
import type { Scope } from '../types';

/** Choose whether the page edits the settings for all sites or one site's
 *  own; a site with its own values shows how many. */
export function ScopeBar({
    t,
    scope,
    ownCounts,
    onScope,
}: {
    t: Translate;
    scope: Scope;
    ownCounts: Readonly<Record<string, number>>;
    onScope: (scope: Scope) => void;
}) {
    const scopes: { id: Scope; label: string }[] = [
        { id: 'all', label: t('scopeAll') },
        ...PLATFORM_IDS.map((id) => ({ id, label: PLATFORM_NAMES[id] })),
    ];
    return (
        <div className="scope">
            <div className="scope-bar">
                <span className="strong" id="scope-label">
                    {t('scopeLabel')}
                </span>
                <div
                    className="segmented"
                    role="group"
                    aria-labelledby="scope-label"
                >
                    {scopes.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={scope === id}
                            onClick={() => onScope(id)}
                        >
                            {label}
                            {(ownCounts[id] ?? 0) > 0 && (
                                <span
                                    className="count"
                                    aria-label={t(
                                        'scopeOwnCount',
                                        ownCounts[id] ?? 0
                                    )}
                                >
                                    {ownCounts[id]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>
            {scope !== 'all' && (
                <div className="notice scope-banner">
                    <div className="grow">
                        <strong>
                            {t('scopeEditingSite', PLATFORM_NAMES[scope])}
                        </strong>{' '}
                        {t('scopeEditingSiteHelp')}
                    </div>
                    <button
                        type="button"
                        className="button"
                        onClick={() => onScope('all')}
                    >
                        {t('scopeBackToAll')}
                    </button>
                </div>
            )}
        </div>
    );
}
