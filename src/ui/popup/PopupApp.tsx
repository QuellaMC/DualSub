import { useEffect, useRef } from 'react';
import { browser } from 'wxt/browser';
import { detectBrowserLanguage, type SettingsValues } from '@/config/schema';
import { createLogger } from '@/shared/logger';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { useStatusMessage } from '../hooks/useStatusMessage';
import { previewContentSettings } from '../livePreview';
import { AppearanceSettings, type SliderKey } from './AppearanceSettings';
import { Header } from './Header';
import { LanguageSelector, languageLabelKey } from './LanguageSelector';
import { SettingToggle } from './SettingToggle';
import { StatusMessage } from './StatusMessage';

export const POPUP_SETTINGS_KEYS = [
    'uiLanguage',
    'subtitlesEnabled',
    'useOfficialTranslations',
    'originalLanguage',
    'targetLanguage',
    'subtitleLayoutOrder',
    'subtitleLayoutOrientation',
    'subtitleFontSize',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleTimeOffset',
    'appearanceAccordionOpen',
] as const;

type PopupSettings = Pick<SettingsValues, (typeof POPUP_SETTINGS_KEYS)[number]>;

const GITHUB_URL = 'https://github.com/QuellaMC/DualSub';

const SLIDER_STATUS: Record<SliderKey, { key: string; unit: string }> = {
    subtitleFontSize: { key: 'statusFontSize', unit: 'vw' },
    subtitleGap: { key: 'statusVerticalGap', unit: 'em' },
    subtitleVerticalPosition: { key: 'statusVerticalPosition', unit: '' },
};

const logger = createLogger('Popup');

function sliderChange(
    key: SliderKey,
    value: number
): Partial<Record<SliderKey, number>> {
    return { [key]: value };
}

export function PopupApp() {
    const { settings, status, save } = useSettings(POPUP_SETTINGS_KEYS);
    const { t, ready } = useI18n(
        settings?.uiLanguage ??
            (status === 'unavailable' ? detectBrowserLanguage() : null)
    );
    const { message, show } = useStatusMessage();
    const settingsRef = useRef(settings);
    // Ordered per slider key: a failed commit rolls the page back only when
    // no newer preview or commit has superseded it.
    const sliderGeneration = useRef(new Map<SliderKey, number>());

    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

    useEffect(() => {
        if (status === 'unavailable') {
            logger.error('Settings initial load unavailable');
        }
    }, [status]);

    if (status === 'unavailable') {
        return <div role="alert">{t('settingsLoadFailed')}</div>;
    }
    if (!settings || !ready) {
        return <div role="status">Loading...</div>;
    }

    const persist = async (
        changes: Partial<PopupSettings>,
        statusText: string
    ): Promise<boolean> => {
        try {
            await save(changes);
            show(statusText);
            return true;
        } catch (error) {
            logger.error('Failed to save settings', error, {
                keys: Object.keys(changes),
            });
            show(t('settingsSaveFailed'));
            return false;
        }
    };

    const bumpSlider = (key: SliderKey): number => {
        const generation = (sliderGeneration.current.get(key) ?? 0) + 1;
        sliderGeneration.current.set(key, generation);
        return generation;
    };

    const previewSlider = (key: SliderKey, value: number): void => {
        bumpSlider(key);
        void previewContentSettings(sliderChange(key, value));
    };

    const commitSlider = async (
        key: SliderKey,
        value: number
    ): Promise<boolean> => {
        const generation = bumpSlider(key);
        const { key: statusKey, unit } = SLIDER_STATUS[key];
        const saved = await persist(
            sliderChange(key, value),
            `${t(statusKey)}${value.toFixed(1)}${unit}.`
        );
        if (!saved && generation === sliderGeneration.current.get(key)) {
            const confirmed = settingsRef.current?.[key];
            if (confirmed !== undefined) {
                void previewContentSettings(sliderChange(key, confirmed));
            }
        }
        return saved;
    };

    const changeTimeOffset = (raw: string): void => {
        const parsed = Number.parseFloat(raw);
        if (Number.isNaN(parsed)) {
            show(t('statusInvalidOffset'));
            return;
        }
        const offset = Number(parsed.toFixed(2));
        void persist(
            { subtitleTimeOffset: offset },
            `${t('statusTimeOffset')}${offset}s.`
        );
    };

    return (
        <>
            <Header
                title={t('h1Title')}
                onOpenOptions={() => void browser.runtime.openOptionsPage()}
                onOpenGitHub={() =>
                    void browser.tabs.create({ url: GITHUB_URL })
                }
            />

            <SettingToggle
                id="enableSubtitles"
                label={t('enableSubtitlesLabel')}
                checked={settings.subtitlesEnabled}
                onChange={(enabled) =>
                    void persist(
                        { subtitlesEnabled: enabled },
                        t(enabled ? 'statusDualEnabled' : 'statusDualDisabled')
                    )
                }
            />

            <SettingToggle
                id="useOfficialTranslations"
                label={t('useNativeSubtitlesLabel')}
                checked={settings.useOfficialTranslations}
                onChange={(useOfficial) =>
                    void persist(
                        { useOfficialTranslations: useOfficial },
                        t(
                            useOfficial
                                ? 'statusSmartTranslationEnabled'
                                : 'statusSmartTranslationDisabled'
                        )
                    )
                }
            />

            <LanguageSelector
                t={t}
                originalLanguage={settings.originalLanguage}
                targetLanguage={settings.targetLanguage}
                onOriginalChange={(code) =>
                    void persist(
                        { originalLanguage: code },
                        `${t('statusOriginalLanguage')}${t(languageLabelKey(code))}`
                    )
                }
                onTargetChange={(code) =>
                    void persist(
                        { targetLanguage: code },
                        `${t('statusLanguageSetTo')}${t(languageLabelKey(code))}`
                    )
                }
            />

            <AppearanceSettings
                t={t}
                isOpen={settings.appearanceAccordionOpen}
                onToggle={(open) => {
                    if (open !== settings.appearanceAccordionOpen) {
                        save({ appearanceAccordionOpen: open }).catch(
                            (error: unknown) => {
                                logger.error(
                                    'Failed to save accordion state',
                                    error
                                );
                            }
                        );
                    }
                }}
                layoutOrder={settings.subtitleLayoutOrder}
                layoutOrientation={settings.subtitleLayoutOrientation}
                sliderValues={{
                    subtitleFontSize: settings.subtitleFontSize,
                    subtitleGap: settings.subtitleGap,
                    subtitleVerticalPosition: settings.subtitleVerticalPosition,
                }}
                timeOffset={settings.subtitleTimeOffset}
                onLayoutOrderChange={(value) =>
                    void persist(
                        { subtitleLayoutOrder: value },
                        t('statusDisplayOrderUpdated')
                    )
                }
                onLayoutOrientationChange={(value) =>
                    void persist(
                        { subtitleLayoutOrientation: value },
                        t('statusLayoutOrientationUpdated')
                    )
                }
                onSliderPreview={previewSlider}
                onSliderCommit={commitSlider}
                onTimeOffsetChange={changeTimeOffset}
            />

            <StatusMessage message={message} />
        </>
    );
}
