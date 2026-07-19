import React from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { ToggleSwitch } from '../ToggleSwitch.jsx';

/**
 * Advanced Settings Section
 *
 * Advanced configuration options for side panel behavior,
 * video control, and state persistence.
 */
export function AdvancedSection({ t, settings, onSettingChange }) {
    return (
        <section id="advanced">
            <h2>{t('advancedTitle', 'Advanced Settings')}</h2>

            {/* Side Panel Behavior */}
            <SettingCard
                title={t('sidePanelBehaviorTitle', 'Side Panel Behavior')}
                description={t(
                    'sidePanelBehaviorDescription',
                    'Configure how the AI analysis side panel opens and looks.'
                )}
            >
                <div className="setting">
                    <label htmlFor="sidePanelUseSidePanel">
                        {t('useSidePanel', 'Use Side Panel:')}
                    </label>
                    <ToggleSwitch
                        id="sidePanelUseSidePanel"
                        checked={settings.sidePanelUseSidePanel !== false}
                        onChange={(checked) =>
                            onSettingChange('sidePanelUseSidePanel', checked)
                        }
                    />
                </div>
                <p className="setting-description">
                    {t(
                        'useSidePanelDescription',
                        'Use Chrome Side Panel instead of the modal for AI context analysis. Disable to use the legacy modal.'
                    )}
                </p>

                <div className="setting">
                    <label htmlFor="sidePanelAutoOpen">
                        {t('autoOpenSidePanel', 'Auto-Open Side Panel:')}
                    </label>
                    <ToggleSwitch
                        id="sidePanelAutoOpen"
                        checked={settings.sidePanelAutoOpen !== false}
                        onChange={(checked) =>
                            onSettingChange('sidePanelAutoOpen', checked)
                        }
                    />
                </div>
                <p className="setting-description">
                    {t(
                        'autoOpenSidePanelDescription',
                        'Automatically open the side panel when you click on subtitle words.'
                    )}
                </p>

                <div className="setting">
                    <label htmlFor="sidePanelTheme">
                        {t('sidePanelTheme', 'Side Panel Theme:')}
                    </label>
                    <select
                        id="sidePanelTheme"
                        value={settings.sidePanelTheme || 'auto'}
                        onChange={(e) =>
                            onSettingChange('sidePanelTheme', e.target.value)
                        }
                    >
                        <option value="auto">
                            {t('themeAuto', 'Auto (System)')}
                        </option>
                        <option value="light">
                            {t('themeLight', 'Light')}
                        </option>
                        <option value="dark">{t('themeDark', 'Dark')}</option>
                    </select>
                </div>
            </SettingCard>

            {/* Video Control */}
            <SettingCard
                title={t('videoControlTitle', 'Video Control')}
                description={t(
                    'videoControlDescription',
                    'Control how the video player behaves when the side panel opens.'
                )}
            >
                <div className="setting">
                    <label htmlFor="sidePanelAutoPauseVideo">
                        {t('autoPauseVideo', 'Auto-Pause Video:')}
                    </label>
                    <ToggleSwitch
                        id="sidePanelAutoPauseVideo"
                        checked={settings.sidePanelAutoPauseVideo !== false}
                        onChange={(checked) =>
                            onSettingChange('sidePanelAutoPauseVideo', checked)
                        }
                    />
                </div>
                <p className="setting-description">
                    {t(
                        'autoPauseVideoDescription',
                        'Automatically pause the video when you open the side panel to select words.'
                    )}
                </p>
            </SettingCard>

            <SettingCard
                title={t('advancedWarningTitle', 'Important Note')}
                description={t(
                    'advancedWarningDescription',
                    'These settings can affect the behavior of the side panel. If you experience issues, try resetting to default values by disabling and re-enabling the side panel feature.'
                )}
            >
                <div className="info-message">
                    <span
                        aria-hidden="true"
                        style={{
                            color: 'var(--color-warning)',
                            marginRight: 'var(--spacing-2)',
                        }}
                    >
                        ⚠
                    </span>
                    {t(
                        'advancedNote',
                        'Automatic side-panel opening requires Chrome 116 or newer.'
                    )}
                </div>
            </SettingCard>
        </section>
    );
}
