import type { UiLanguage } from '@/config/schema';
import { SettingCard } from '../SettingCard';
import { ToggleSwitch } from '../ToggleSwitch';
import type { SectionProps } from '../types';

const UI_LANGUAGES: { id: UiLanguage; label: string }[] = [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Español' },
    { id: 'ja', label: '日本語' },
    { id: 'ko', label: '한국어' },
    { id: 'zh-CN', label: '中文 (简体)' },
    { id: 'zh-TW', label: '中文 (繁體)' },
];

const LOGGING_LEVELS: { level: number; labelKey: string }[] = [
    { level: 0, labelKey: 'loggingLevelOff' },
    { level: 1, labelKey: 'loggingLevelError' },
    { level: 2, labelKey: 'loggingLevelWarn' },
    { level: 3, labelKey: 'loggingLevelInfo' },
    { level: 4, labelKey: 'loggingLevelDebug' },
];

function isUiLanguage(value: string): value is UiLanguage {
    return UI_LANGUAGES.some((language) => language.id === value);
}

export function GeneralSection({ t, settings, save }: SectionProps) {
    return (
        <section id="general">
            <h2>{t('sectionGeneral')}</h2>

            <SettingCard
                title={t('cardUILanguageTitle')}
                description={t('cardUILanguageDesc')}
            >
                <div className="setting">
                    <label htmlFor="uiLanguage">{t('uiLanguageLabel')}</label>
                    <select
                        id="uiLanguage"
                        value={settings.uiLanguage}
                        onChange={(event) => {
                            if (isUiLanguage(event.target.value)) {
                                void save({ uiLanguage: event.target.value });
                            }
                        }}
                    >
                        {UI_LANGUAGES.map((language) => (
                            <option key={language.id} value={language.id}>
                                {language.label}
                            </option>
                        ))}
                    </select>
                </div>
            </SettingCard>

            <SettingCard
                title={t('cardHideOfficialSubtitlesTitle')}
                description={t('cardHideOfficialSubtitlesDesc')}
            >
                <div className="setting">
                    <label htmlFor="hideOfficialSubtitles">
                        {t('hideOfficialSubtitlesLabel')}
                    </label>
                    <ToggleSwitch
                        id="hideOfficialSubtitles"
                        checked={settings.hideOfficialSubtitles}
                        onChange={(checked) =>
                            void save({ hideOfficialSubtitles: checked })
                        }
                    />
                </div>
            </SettingCard>

            <SettingCard
                title={t('cardLoggingLevelTitle')}
                description={t('cardLoggingLevelDesc')}
            >
                <div className="setting">
                    <label htmlFor="loggingLevel">
                        {t('loggingLevelLabel')}
                    </label>
                    <select
                        id="loggingLevel"
                        value={settings.loggingLevel}
                        onChange={(event) =>
                            void save({
                                loggingLevel: Number(event.target.value),
                            })
                        }
                    >
                        {LOGGING_LEVELS.map(({ level, labelKey }) => (
                            <option key={level} value={level}>
                                {t(labelKey)}
                            </option>
                        ))}
                    </select>
                </div>
            </SettingCard>
        </section>
    );
}
