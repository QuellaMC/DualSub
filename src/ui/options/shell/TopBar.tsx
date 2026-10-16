import { useState } from 'react';
import { isUiLanguage, UI_LANGUAGES, type UiLanguage } from '@/config/schema';
import { Icon } from '../../design/Icon';
import type { Translate } from '../../hooks/useI18n';
import { NATIVE_LANGUAGE_NAMES } from '../controls/nativeLanguageNames';
import { searchSettings, type SearchEntry } from '../search';
import { SECTIONS } from '../sections';

export function TopBar({
    t,
    uiLanguage,
    onUiLanguage,
    onOpen,
    onHelp,
}: {
    t: Translate;
    uiLanguage: UiLanguage;
    onUiLanguage: (language: UiLanguage) => void;
    onOpen: (entry: SearchEntry) => void;
    onHelp: () => void;
}) {
    const [query, setQuery] = useState('');
    const results = searchSettings(query, t);

    return (
        <header className="top-bar">
            <div className="brand">
                <img src="/icons/icon48.png" alt="" width="32" height="32" />
                <span>DualSub</span>
                <span className="brand-page">{t('topSettings')}</span>
            </div>
            <div className="search" role="search">
                <label htmlFor="settings-search" className="sr-only">
                    {t('topSearchLabel')}
                </label>
                <Icon name="search" />
                <input
                    id="settings-search"
                    type="search"
                    className="field"
                    placeholder={t('topSearchPlaceholder')}
                    value={query}
                    autoComplete="off"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setQuery('');
                        }
                    }}
                />
                {query.trim() !== '' && (
                    <div className="search-results">
                        {results.length === 0 ? (
                            <p className="help">
                                {t('topSearchNothing', query.trim())}
                            </p>
                        ) : (
                            <ul>
                                {results.map((entry) => (
                                    <li key={entry.labelKey}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setQuery('');
                                                onOpen(entry);
                                            }}
                                        >
                                            <span>{t(entry.labelKey)}</span>
                                            <span className="help">
                                                {t(
                                                    SECTIONS[entry.section]
                                                        .labelKey
                                                )}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>
            <div className="top-actions">
                <Icon name="globe" />
                <label htmlFor="ui-language" className="sr-only">
                    {t('topMenuLanguage')}
                </label>
                <select
                    id="ui-language"
                    className="field"
                    value={uiLanguage}
                    onChange={(event) => {
                        if (isUiLanguage(event.target.value)) {
                            onUiLanguage(event.target.value);
                        }
                    }}
                >
                    {UI_LANGUAGES.map((language) => (
                        <option key={language} value={language}>
                            {NATIVE_LANGUAGE_NAMES[language]}
                        </option>
                    ))}
                </select>
                <button type="button" className="button quiet" onClick={onHelp}>
                    {t('navHelp')}
                </button>
            </div>
        </header>
    );
}
