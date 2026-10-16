import { useState, type ReactNode } from 'react';
import {
    detectBrowserLanguage,
    siteProfileOf,
    type SettingsValues,
    type SiteSettingKey,
} from '@/config/schema';
import { createLogger } from '@/shared/logger';
import { PLATFORM_NAMES, type PlatformId } from '@/shared/platforms';
import {
    clampPosition,
    namedSize,
    nextSize,
    NUDGE_SECONDS,
    POSITION_BOUNDS,
    POSITION_STEP,
    positionLabelKey,
    roundSeconds,
    timingLabel,
} from '../adjustments';
import { reloadActiveTab, type TabStatus } from '../contentTab';
import { Icon } from '../design/Icon';
import { LanguageSelect } from '../design/LanguageSelect';
import { Switch } from '../design/Switch';
import { HealthNotice } from '../HealthNotice';
import { useDraft } from '../hooks/useDraft';
import { useI18n, type Translate } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { languageName } from '../languageLabels';
import { openSettings, PopupShell } from './PopupShell';

const SITE_POPUP_KEYS = [
    'uiLanguage',
    'targetLanguage',
    'originalLanguage',
    'subtitleFontScale',
    'subtitleTimeOffset',
    'subtitleVerticalPosition',
    'selectedProvider',
    'siteProfiles',
] as const;

type SitePopupSettings = Pick<SettingsValues, (typeof SITE_POPUP_KEYS)[number]>;

const logger = createLogger('Popup');

/** One adjustment: what it is, where it stands, and two buttons. */
function Adjustment({
    label,
    value,
    tag,
    children,
}: {
    label: string;
    value: string;
    tag: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="row">
            <div className="grow">
                <div className="strong">
                    {label} {tag}
                </div>
                <div className="help" aria-live="polite">
                    {value}
                </div>
            </div>
            <div className="inline">{children}</div>
        </div>
    );
}

/** Whether DualSub runs on the page, and what it is doing there. */
function Status({
    t,
    site,
    status,
    enabled,
    targetLanguage,
}: {
    t: Translate;
    site: PlatformId;
    status: TabStatus;
    enabled: boolean;
    targetLanguage: string;
}) {
    const name = PLATFORM_NAMES[site];
    if (status === 'notRunning') {
        return (
            <div className="status">
                <span className="status-icon off" aria-hidden="true">
                    <Icon name="alert" />
                </span>
                <div className="stack">
                    <h1 className="label">{t('popupReloadTitle')}</h1>
                    <p className="help">{t('popupReloadHelp')}</p>
                    <button
                        type="button"
                        className="button primary"
                        onClick={() =>
                            void reloadActiveTab().then(() => window.close())
                        }
                    >
                        {t('popupReload')}
                    </button>
                </div>
            </div>
        );
    }
    return (
        <div className="status">
            <span
                className={`status-icon ${enabled ? 'ok' : 'off'}`}
                aria-hidden="true"
            >
                <Icon name="check" />
            </span>
            <div>
                <h1 className="label">
                    {enabled
                        ? status === 'player'
                            ? t('popupWorkingTitle')
                            : t('popupReadyTitle', name)
                        : t('popupOffTitle', name)}
                </h1>
                <p className="help">
                    {enabled
                        ? status === 'player'
                            ? t(
                                  'popupWorkingHelp',
                                  languageName(t, targetLanguage)
                              )
                            : t('popupReadyHelp')
                        : t('startStatusOffHelp')}
                </p>
            </div>
        </div>
    );
}

function SiteControls({
    t,
    site,
    status,
    settings,
    save,
    enabled,
    saveEnabled,
}: {
    t: Translate;
    site: PlatformId;
    status: TabStatus;
    settings: SitePopupSettings;
    save: (changes: Partial<SitePopupSettings>) => Promise<void>;
    enabled: boolean;
    saveEnabled: (enabled: boolean) => Promise<void>;
}) {
    const [saveFailed, setSaveFailed] = useState(false);
    const write = async (change: () => Promise<void>): Promise<boolean> => {
        try {
            await change();
            setSaveFailed(false);
            return true;
        } catch (error) {
            logger.error('Failed to save settings', error);
            setSaveFailed(true);
            return false;
        }
    };
    const scale = useDraft(settings.subtitleFontScale, (value) =>
        write(() => save({ subtitleFontScale: value }))
    );
    const offset = useDraft(settings.subtitleTimeOffset, (value) =>
        write(() => save({ subtitleTimeOffset: value }))
    );
    const position = useDraft(settings.subtitleVerticalPosition, (value) =>
        write(() => save({ subtitleVerticalPosition: value }))
    );
    const name = PLATFORM_NAMES[site];
    const own = siteProfileOf(settings.siteProfiles, site);
    const siteTag = (key: SiteSettingKey): ReactNode =>
        Object.hasOwn(own, key) && (
            <span className="tag site">{t('scopeSiteOnly', name)}</span>
        );
    const size = namedSize(scale.value);
    const bigger = nextSize(scale.value, 1);
    const smaller = nextSize(scale.value, -1);

    return (
        <>
            {saveFailed && (
                <p role="alert" className="notice danger">
                    {t('settingsSaveFailed')}
                </p>
            )}
            <section className="card">
                <Status
                    t={t}
                    site={site}
                    status={status}
                    enabled={enabled}
                    targetLanguage={settings.targetLanguage}
                />
                <div className="row">
                    <span className="strong" id="popup-enabled">
                        {t('sitesUseHere')}
                    </span>
                    <Switch
                        checked={enabled}
                        labelledBy="popup-enabled"
                        onChange={(next) => void write(() => saveEnabled(next))}
                    />
                </div>
            </section>

            <HealthNotice t={t} provider={settings.selectedProvider}>
                <button
                    type="button"
                    className="link-button"
                    onClick={() => openSettings('translation')}
                >
                    {t('helpGoTranslation')}
                </button>
            </HealthNotice>

            <section className="card">
                <div className="row">
                    <label className="strong" htmlFor="popup-target">
                        {t('languagesSpeakTitle')}
                    </label>
                    <LanguageSelect
                        t={t}
                        id="popup-target"
                        value={settings.targetLanguage}
                        onChange={(targetLanguage) =>
                            void write(() => save({ targetLanguage }))
                        }
                    />
                </div>
                <div className="row">
                    <label className="strong" htmlFor="popup-top">
                        {t('languagesTopTitle')} {siteTag('originalLanguage')}
                    </label>
                    <LanguageSelect
                        t={t}
                        id="popup-top"
                        automatic
                        value={settings.originalLanguage}
                        onChange={(originalLanguage) =>
                            void write(() => save({ originalLanguage }))
                        }
                    />
                </div>
            </section>

            <section className="card">
                <Adjustment
                    label={t('lookSizeTitle')}
                    value={
                        size
                            ? t(size.labelKey)
                            : t(
                                  'lookExactSize',
                                  Math.round(scale.value * 100) / 100
                              )
                    }
                    tag={siteTag('subtitleFontScale')}
                >
                    <button
                        type="button"
                        className="button step"
                        aria-label={t('popupSmaller')}
                        disabled={!smaller}
                        onClick={() =>
                            smaller && scale.set(smaller.scale, 'quiet')
                        }
                    >
                        A−
                    </button>
                    <button
                        type="button"
                        className="button step"
                        aria-label={t('popupBigger')}
                        disabled={!bigger}
                        onClick={() =>
                            bigger && scale.set(bigger.scale, 'quiet')
                        }
                    >
                        A+
                    </button>
                </Adjustment>
                <Adjustment
                    label={t('timingTitle')}
                    value={timingLabel(t, offset.value)}
                    tag={siteTag('subtitleTimeOffset')}
                >
                    <button
                        type="button"
                        className="button step"
                        aria-label={t('timingEarlier')}
                        onClick={() =>
                            offset.set(
                                roundSeconds(offset.value + NUDGE_SECONDS),
                                'quiet'
                            )
                        }
                    >
                        <Icon name="earlier" />
                    </button>
                    <button
                        type="button"
                        className="button step"
                        aria-label={t('timingLater')}
                        onClick={() =>
                            offset.set(
                                roundSeconds(offset.value - NUDGE_SECONDS),
                                'quiet'
                            )
                        }
                    >
                        <Icon name="later" />
                    </button>
                </Adjustment>
                <Adjustment
                    label={t('lookPositionTitle')}
                    value={t(positionLabelKey(position.value))}
                    tag={siteTag('subtitleVerticalPosition')}
                >
                    <button
                        type="button"
                        className="button step"
                        aria-label={t('lookMoveUp')}
                        disabled={position.value >= POSITION_BOUNDS.max}
                        onClick={() =>
                            position.set(
                                clampPosition(position.value + POSITION_STEP),
                                'quiet'
                            )
                        }
                    >
                        <Icon name="up" />
                    </button>
                    <button
                        type="button"
                        className="button step"
                        aria-label={t('lookMoveDown')}
                        disabled={position.value <= POSITION_BOUNDS.min}
                        onClick={() =>
                            position.set(
                                clampPosition(position.value - POSITION_STEP),
                                'quiet'
                            )
                        }
                    >
                        <Icon name="down" />
                    </button>
                </Adjustment>
            </section>
        </>
    );
}

/**
 * The popup on a site DualSub works on. Each control edits the value this
 * site uses, where it comes from; the on/off switch is this site's own, so
 * turning DualSub off here leaves the other sites as they are.
 */
export function SitePopup({
    site,
    status,
}: {
    site: PlatformId;
    status: TabStatus;
}) {
    const handle = useSettings(SITE_POPUP_KEYS, { site, siteTarget: 'source' });
    const here = useSettings(['subtitlesEnabled'], { site, siteTarget: 'own' });
    const { t, loadedLocale } = useI18n(
        handle.settings?.uiLanguage ??
            (handle.status === 'unavailable' ? detectBrowserLanguage() : null)
    );

    if (
        loadedLocale !== null &&
        (handle.status === 'unavailable' || here.status === 'unavailable')
    ) {
        return (
            <PopupShell t={t}>
                <p role="alert" className="notice danger">
                    {t('settingsLoadFailed')}
                </p>
            </PopupShell>
        );
    }
    if (!handle.settings || !here.settings || loadedLocale === null) {
        return <div className="popup" aria-busy="true" />;
    }
    return (
        <PopupShell t={t}>
            <SiteControls
                t={t}
                site={site}
                status={status}
                settings={handle.settings}
                save={handle.save}
                enabled={here.settings.subtitlesEnabled}
                saveEnabled={(subtitlesEnabled) =>
                    here.save({ subtitlesEnabled })
                }
            />
        </PopupShell>
    );
}
