import type { SettingsValues } from '@/config/schema';
import { SettingCard } from '../SettingCard';
import { ToggleSwitch } from '../ToggleSwitch';
import type { SectionProps } from '../types';

const THEMES: { id: SettingsValues['sidePanelTheme']; labelKey: string }[] = [
    { id: 'auto', labelKey: 'themeAuto' },
    { id: 'light', labelKey: 'themeLight' },
    { id: 'dark', labelKey: 'themeDark' },
];

function isTheme(value: string): value is SettingsValues['sidePanelTheme'] {
    return THEMES.some((theme) => theme.id === value);
}

export function AdvancedSection({ t, settings, save }: SectionProps) {
    return (
        <section id="advanced">
            <h2>{t('advancedTitle')}</h2>

            <SettingCard
                title={t('sidePanelBehaviorTitle')}
                description={t('sidePanelBehaviorDescription')}
            >
                <div className="setting">
                    <label htmlFor="sidePanelAutoOpen">
                        {t('autoOpenSidePanel')}
                    </label>
                    <ToggleSwitch
                        id="sidePanelAutoOpen"
                        checked={settings.sidePanelAutoOpen}
                        onChange={(checked) =>
                            void save({ sidePanelAutoOpen: checked })
                        }
                    />
                </div>
                <p className="setting-description">
                    {t('autoOpenSidePanelDescription')}
                </p>

                <div className="setting">
                    <label htmlFor="sidePanelTheme">
                        {t('sidePanelTheme')}
                    </label>
                    <select
                        id="sidePanelTheme"
                        value={settings.sidePanelTheme}
                        onChange={(event) => {
                            if (isTheme(event.target.value)) {
                                void save({
                                    sidePanelTheme: event.target.value,
                                });
                            }
                        }}
                    >
                        {THEMES.map((theme) => (
                            <option key={theme.id} value={theme.id}>
                                {t(theme.labelKey)}
                            </option>
                        ))}
                    </select>
                </div>
            </SettingCard>

            <SettingCard
                title={t('videoControlTitle')}
                description={t('videoControlDescription')}
            >
                <div className="setting">
                    <label htmlFor="sidePanelAutoPauseVideo">
                        {t('autoPauseVideo')}
                    </label>
                    <ToggleSwitch
                        id="sidePanelAutoPauseVideo"
                        checked={settings.sidePanelAutoPauseVideo}
                        onChange={(checked) =>
                            void save({ sidePanelAutoPauseVideo: checked })
                        }
                    />
                </div>
                <p className="setting-description">
                    {t('autoPauseVideoDescription')}
                </p>
            </SettingCard>

            <SettingCard
                title={t('advancedWarningTitle')}
                description={t('advancedWarningDescription')}
            >
                <div className="info-message">
                    <span className="info-message-icon" aria-hidden="true">
                        ⚠
                    </span>
                    {t('advancedNote')}
                </div>
            </SettingCard>
        </section>
    );
}
