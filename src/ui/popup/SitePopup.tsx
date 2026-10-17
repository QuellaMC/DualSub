import { useState, type ReactNode } from 'react';
import {
    detectBrowserLanguage,
    siteProfileOf,
    type SettingsValues,
    type SiteSettingKey,
} from '@/config/schema';
import { isSameLanguage } from '@/shared/languageNormalization';
import { createLogger } from '@/shared/logger';
import { PLATFORM_NAMES, type PlatformId } from '@/shared/platforms';
import { AUTO_LANGUAGE } from '@/shared/subtitleLanguages';
import {
    clampPosition,
    namedSize,
    nextSize,
    NUDGE_SECONDS,
    POSITION_BOUNDS,
    POSITION_STEP,
    positionWordKey,
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
import { openSettings, PopupShell, PopupUnavailable } from './PopupShell';

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

/** One adjustment: what it is, and where it stands between a button
 *  either side. */
function Stepper({
    label,
    tag,
    value,
    less,
    more,
}: {
    label: string;
    tag: ReactNode;
    value: string;
    less: ReactNode;
    more: ReactNode;
}) {
    return (
        <div className="row">
            <span className="strong">
                {label} {tag}
            </span>
            <div className="stepper">
                {less}
                <span className="stepper-value" aria-live="polite">
                    {value}
                </span>
                {more}
            </div>
        </div>
    );
}

/** What DualSub shows over the video playing: the site, the language on
 *  top once the player has told it, and the viewer's line. */
function workingHelp(
    t: Translate,
    site: PlatformId,
    topLanguage: string | null,
    targetLanguage: string
): string {
    const name = PLATFORM_NAMES[site];
    if (topLanguage === null) {
        return t('popupWorkingHelpSoon', name);
    }
    return t(
        isSameLanguage(topLanguage, targetLanguage)
            ? 'popupWorkingHelpOne'
            : 'popupWorkingHelp',
        name,
        languageName(t, topLanguage)
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
    if (status.kind === 'notRunning') {
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
                        ? status.kind === 'player'
                            ? t('popupWorkingTitle')
                            : t('popupReadyTitle', name)
                        : t('popupOffTitle', name)}
                </h1>
                <p className="help">
                    {enabled
                        ? status.kind === 'player'
                            ? workingHelp(
                                  t,
                                  site,
                                  status.topLanguage,
                                  targetLanguage
                              )
                            : t('popupReadyHelp')
                        : t('popupOffHelp')}
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
    save: (changes: Partial<SitePopupSettings>) => Promise<unknown>;
    enabled: boolean;
    saveEnabled: (enabled: boolean) => Promise<unknown>;
}) {
    const [saveFailed, setSaveFailed] = useState(false);
    const write = async (change: () => Promise<unknown>): Promise<boolean> => {
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
    const topLanguage = status.kind === 'player' ? status.topLanguage : null;
    const topLine =
        settings.originalLanguage !== AUTO_LANGUAGE
            ? languageName(t, settings.originalLanguage)
            : topLanguage === null
              ? t('popupTopAutomatic')
              : t('popupTopAutomaticIs', languageName(t, topLanguage));

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
                        {t('startEnabled')}
                    </span>
                    <Switch
                        checked={enabled}
                        labelledBy="popup-enabled"
                        onChange={(next) => write(() => saveEnabled(next))}
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
                        short
                        value={settings.targetLanguage}
                        onChange={(targetLanguage) =>
                            void write(() => save({ targetLanguage }))
                        }
                    />
                </div>
                <div className="row">
                    <span className="strong">
                        {t('startTopTitle')} {siteTag('originalLanguage')}
                    </span>
                    <span className="help">{topLine}</span>
                </div>
            </section>

            <section className="card">
                <Stepper
                    label={t('lookSizeTitle')}
                    tag={siteTag('subtitleFontScale')}
                    value={
                        size
                            ? t(size.labelKey)
                            : t(
                                  'sizeExact',
                                  Math.round(scale.value * 100) / 100
                              )
                    }
                    less={
                        <button
                            type="button"
                            className="button step"
                            aria-label={t('sizeSmaller')}
                            disabled={!smaller}
                            onClick={() =>
                                smaller && scale.set(smaller.scale, 'quiet')
                            }
                        >
                            A−
                        </button>
                    }
                    more={
                        <button
                            type="button"
                            className="button step"
                            aria-label={t('sizeBigger')}
                            disabled={!bigger}
                            onClick={() =>
                                bigger && scale.set(bigger.scale, 'quiet')
                            }
                        >
                            A+
                        </button>
                    }
                />
                <Stepper
                    label={t('navTiming')}
                    tag={siteTag('subtitleTimeOffset')}
                    value={timingLabel(t, offset.value)}
                    less={
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
                    }
                    more={
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
                    }
                />
                <Stepper
                    label={t('popupPosition')}
                    tag={siteTag('subtitleVerticalPosition')}
                    value={t(positionWordKey(position.value))}
                    less={
                        <button
                            type="button"
                            className="button step"
                            aria-label={t('lookMoveUp')}
                            disabled={position.value >= POSITION_BOUNDS.max}
                            onClick={() =>
                                position.set(
                                    clampPosition(
                                        position.value + POSITION_STEP
                                    ),
                                    'quiet'
                                )
                            }
                        >
                            <Icon name="up" />
                        </button>
                    }
                    more={
                        <button
                            type="button"
                            className="button step"
                            aria-label={t('lookMoveDown')}
                            disabled={position.value <= POSITION_BOUNDS.min}
                            onClick={() =>
                                position.set(
                                    clampPosition(
                                        position.value - POSITION_STEP
                                    ),
                                    'quiet'
                                )
                            }
                        >
                            <Icon name="down" />
                        </button>
                    }
                />
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
        return <PopupUnavailable t={t} />;
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
