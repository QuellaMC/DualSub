import React from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { ToggleSwitch } from '../ToggleSwitch.jsx';

/**
 * Word Lists Settings Section
 * 
 * Configuration for the Words Lists feature in the side panel.
 * Currently provides a simple toggle as the feature is in development.
 */
export function WordListsSection({ t, settings, onSettingChange }) {
    return (
        <section id="word-lists">
            <h2>{t('wordListsTitle', 'Word Lists')}</h2>

            <SettingCard
                title={t('wordListsEnableTitle', 'Enable Words Lists Tab')}
                description={t(
                    'wordListsEnableDescription',
                    'Show the Words Lists tab in the side panel to manage your vocabulary collections. Note: This feature is in preview and not all functionality is available yet.'
                )}
            >
                <div className="setting">
                    <label htmlFor="sidePanelWordsListsEnabled">
                        {t('wordListsEnableLabel', 'Enable Words Lists:')}
                    </label>
                    <ToggleSwitch
                        id="sidePanelWordsListsEnabled"
                        checked={settings.sidePanelWordsListsEnabled || false}
                        onChange={(checked) =>
                            onSettingChange('sidePanelWordsListsEnabled', checked)
                        }
                    />
                </div>
            </SettingCard>

            <SettingCard
                title={t('wordListsComingSoonTitle', 'Coming Soon')}
                description={t(
                    'wordListsComingSoonDescription',
                    'Full word list management features are coming in a future update, including: word saving, translation lookup, filtering by starred words, and export/import functionality.'
                )}
            >
                <div className="info-message">
                    <span className="material-symbols-outlined" style={{ color: '#137fec', marginRight: '0.5rem' }}>info</span>
                    {t(
                        'wordListsPreview',
                        'This feature is currently in development. Enable it to see the preview UI.'
                    )}
                </div>
            </SettingCard>
        </section>
    );
}
