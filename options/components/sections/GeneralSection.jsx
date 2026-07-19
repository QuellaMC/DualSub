import React from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { ToggleSwitch } from '../ToggleSwitch.jsx';

export function GeneralSection({ t, settings, onSettingChange }) {
    return (
        <section id="general">
            <h2>{t('sectionGeneral', 'General')}</h2>

            <SettingCard
                title={t('cardUILanguageTitle', 'UI Language')}
                description={t(
                    'cardUILanguageDesc',
                    "Choose the display language for the extension's interface."
                )}
            >
                <div className="setting">
                    <label htmlFor="uiLanguage">
                        {t('uiLanguageLabel', 'Language:')}
                    </label>
                    <select
                        id="uiLanguage"
                        value={settings.uiLanguage || 'en'}
                        onChange={(e) =>
                            onSettingChange('uiLanguage', e.target.value)
                        }
                    >
                        <option value="en">English</option>
                        <option value="es">Español</option>
                        <option value="ja">日本語</option>
                        <option value="ko">한국어</option>
                        <option value="zh-CN">中文 (简体)</option>
                        <option value="zh-TW">中文 (繁體)</option>
                    </select>
                </div>
            </SettingCard>

            <SettingCard
                title={t(
                    'cardHideOfficialSubtitlesTitle',
                    'Hide Official Subtitles'
                )}
                description={t(
                    'cardHideOfficialSubtitlesDesc',
                    'Hide the official subtitles from the video platform when DualSub is active.'
                )}
            >
                <div className="setting">
                    <label htmlFor="hideOfficialSubtitles">
                        {t(
                            'hideOfficialSubtitlesLabel',
                            'Hide official subtitles:'
                        )}
                    </label>
                    <ToggleSwitch
                        id="hideOfficialSubtitles"
                        checked={settings.hideOfficialSubtitles || false}
                        onChange={(checked) =>
                            onSettingChange('hideOfficialSubtitles', checked)
                        }
                    />
                </div>
            </SettingCard>

            <SettingCard
                title={t('cardLoggingLevelTitle', 'Logging Level')}
                description={t(
                    'cardLoggingLevelDesc',
                    'Control the amount of debug information displayed in browser console. Higher levels include all lower level messages.'
                )}
            >
                <div className="setting">
                    <label htmlFor="loggingLevel">
                        {t('loggingLevelLabel', 'Logging Level:')}
                    </label>
                    <select
                        id="loggingLevel"
                        value={settings.loggingLevel || 3}
                        onChange={(e) =>
                            onSettingChange(
                                'loggingLevel',
                                parseInt(e.target.value)
                            )
                        }
                    >
                        <option value="0">{t('loggingLevelOff', 'Off')}</option>
                        <option value="1">
                            {t('loggingLevelError', 'Error Only')}
                        </option>
                        <option value="2">
                            {t('loggingLevelWarn', 'Warnings & Errors')}
                        </option>
                        <option value="3">
                            {t('loggingLevelInfo', 'Info & Above')}
                        </option>
                        <option value="4">
                            {t('loggingLevelDebug', 'Debug (All)')}
                        </option>
                    </select>
                </div>
            </SettingCard>
        </section>
    );
}
