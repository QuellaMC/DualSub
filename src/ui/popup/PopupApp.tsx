import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { detectBrowserLanguage, type SettingsValues } from '@/config/schema';
import { createLogger } from '@/shared/logger';
import type { PlatformId } from '@/shared/platforms';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { useStatusMessage } from '../hooks/useStatusMessage';
import {
    activeTabPlatform,
    previewContentSettings,
    readPlatformLookStatus,
    type PlatformLookStatus,
} from '../contentTab';
import { AppearanceSettings, type SliderKey } from './AppearanceSettings';
import { Header } from './Header';
import { languageLabelKey } from '../languageLabels';
import { LOOK_EDITOR_ANCHORS } from '../options/search';
import { LanguageSelector } from './LanguageSelector';
import { SettingToggle } from './SettingToggle';
import { StatusMessage } from './StatusMessage';

export const POPUP_SETTINGS_KEYS = [
    'uiLanguage',
    'subtitlesEnabled',
    'useOfficialTranslations',
    'originalLanguage',
    'targetLanguage',
    'subtitleStyle',
    'subtitleLayoutOrder',
    'subtitleLayoutOrientation',
    'subtitleFontScale',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleTimeOffset',
    'appearanceAccordionOpen',
] as const;

type PopupSettings = Pick<SettingsValues, (typeof POPUP_SETTINGS_KEYS)[number]>;

const GITHUB_URL = 'https://github.com/QuellaMC/DualSub';

const SLIDER_STATUS: Record<SliderKey, { key: string; unit: string }> = {
    subtitleFontScale: { key: 'statusFontSize', unit: '×' },
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

/** The popup edits the settings the active tab's site sees, each where
 *  that site gets it from. */
export function PopupApp() {
    const [site, setSite] = useState<PlatformId | null | undefined>();
    const [tabUnreadable, setTabUnreadable] = useState(false);

    useEffect(() => {
        let active = true;
        activeTabPlatform().then(
            (platform) => {
                if (active) {
                    setSite(platform);
                }
            },
            (error: unknown) => {
                logger.error('Active tab unreadable', error);
                if (active) {
                    setTabUnreadable(true);
                }
            }
        );
        return () => {
            active = false;
        };
    }, []);

    if (tabUnreadable) {
        return <Unavailable />;
    }
    return site === undefined ? (
        <div role="status">Loading...</div>
    ) : (
        <PopupControls site={site} />
    );
}

/** What the popup shows when it cannot tell what to edit: settings it
 *  cannot read, or a tab it cannot place, where a change meant for one
 *  site could land on every site. */
function Unavailable() {
    const { t } = useI18n(detectBrowserLanguage());
    return <div role="alert">{t('settingsLoadFailed')}</div>;
}

function PopupControls({ site }: { site: PlatformId | null }) {
    const { settings, status, save } = useSettings(POPUP_SETTINGS_KEYS, {
        site,
        siteTarget: 'source',
    });
    const { t, ready } = useI18n(settings?.uiLanguage ?? null);
    const { message, show } = useStatusMessage();
    const settingsRef = useRef(settings);
    const [platformLook, setPlatformLook] = useState<PlatformLookStatus | null>(
        null
    );
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

    useEffect(() => {
        let active = true;
        void readPlatformLookStatus().then((platformLookStatus) => {
            if (active) {
                setPlatformLook(platformLookStatus);
            }
        });
        return () => {
            active = false;
        };
    }, []);

    if (status === 'unavailable') {
        return <Unavailable />;
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
    ): Promise<void> => {
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
                subtitleStyle={settings.subtitleStyle}
                platformLook={platformLook}
                layoutOrder={settings.subtitleLayoutOrder}
                layoutOrientation={settings.subtitleLayoutOrientation}
                sliderValues={{
                    subtitleFontScale: settings.subtitleFontScale,
                    subtitleGap: settings.subtitleGap,
                    subtitleVerticalPosition: settings.subtitleVerticalPosition,
                }}
                timeOffset={settings.subtitleTimeOffset}
                onSubtitleStyleChange={(value) =>
                    void persist(
                        { subtitleStyle: value },
                        t('statusSubtitleStyleUpdated')
                    )
                }
                onEditCustomLook={() =>
                    void browser.tabs.create({
                        url: `${browser.runtime.getURL('/options.html')}#look/${LOOK_EDITOR_ANCHORS.join('/')}`,
                    })
                }
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
