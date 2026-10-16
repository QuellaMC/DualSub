import { siteProfileOf } from '@/config/schema';
import {
    PLATFORM_IDS,
    PLATFORM_NAMES,
    type PlatformId,
} from '@/shared/platforms';
import { KEYLESS_PROVIDERS, missingCredentials } from '@/shared/providers';
import {
    AUTO_LANGUAGE,
    browserTargetLanguage,
} from '@/shared/subtitleLanguages';
import { Icon } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import { HealthNotice } from '../../HealthNotice';
import type { Translate } from '../../hooks/useI18n';
import { useSettings } from '../../hooks/useSettings';
import { languageName } from '../../languageLabels';
import { SiteLinks } from '../../SiteLinks';
import { LanguageSelect } from '../../design/LanguageSelect';
import { PROVIDER_NAME_KEYS } from '../../providerNames';
import { SizePicker } from '../controls/SizePicker';
import { useHostPermission } from '../hooks/useHostPermission';
import { useNow } from '../hooks/useNow';
import type { SectionId } from '../sections';
import { SharedTag, SiteTag } from '../shell/scopeContext';
import type { SectionProps } from '../types';

const PROVIDER_SUMMARIES = {
    microsoft_edge: 'startProviderMicrosoft',
    google: 'startProviderGoogle',
    deepl: 'startProviderDeepL',
    openai_compatible: 'startProviderAi',
    vertex_gemini: 'startProviderVertex',
} as const;

interface SitesOn {
    readonly on: PlatformId[];
    readonly off: PlatformId[];
}

/** The sites DualSub runs on and those it is off on, each as the site sees
 *  its settings; null until they are read, or when they cannot be. */
function useSitesOn(): {
    readonly sites: SitesOn | null;
    readonly unreadable: boolean;
} {
    const { settings, status } = useSettings([
        'subtitlesEnabled',
        'siteProfiles',
    ]);
    if (!settings) {
        return { sites: null, unreadable: status === 'unavailable' };
    }
    const on = PLATFORM_IDS.filter(
        (site) =>
            siteProfileOf(settings.siteProfiles, site).subtitlesEnabled ??
            settings.subtitlesEnabled
    );
    return {
        sites: { on, off: PLATFORM_IDS.filter((site) => !on.includes(site)) },
        unreadable: false,
    };
}

/** What the switch leaves running: where dual subtitles are on and off, or
 *  the switch's own state while the sites are not read. */
function statusTitle(
    t: Translate,
    language: string,
    enabled: boolean,
    sites: SitesOn | null
): string {
    const names = (ids: PlatformId[]): string =>
        new Intl.ListFormat(language, { type: 'conjunction' }).format(
            ids.map((id) => PLATFORM_NAMES[id])
        );
    if (!sites) {
        return t(enabled ? 'startStatusOn' : 'startStatusOff');
    }
    if (sites.on.length === 0) {
        return t('startStatusOff');
    }
    return sites.off.length === 0
        ? t('startStatusWorking', names(sites.on))
        : t('startStatusWorkingSome', names(sites.on), names(sites.off));
}

export function StartSection({
    t,
    settings,
    save,
    go,
}: SectionProps & { go: (section: SectionId) => void }) {
    const { sites, unreadable } = useSitesOn();
    const working = sites ? sites.on.length > 0 : settings.subtitlesEnabled;
    const fromBrowser = settings.targetLanguage === browserTargetLanguage();
    const provider = settings.selectedProvider;
    const providerName = t(PROVIDER_NAME_KEYS[provider]);
    // An AI service at its own address works only once Chrome lets DualSub
    // reach it.
    const access = useHostPermission(settings.openaiCompatibleBaseUrl);
    const now = useNow([settings.vertexTokenExpiresAt]);
    const unset =
        missingCredentials(provider, settings, now).length > 0 ||
        (provider === 'openai_compatible' && access.permitted === false);
    // Without fallback, a service still to be set up translates nothing.
    const stopped =
        settings.subtitlesEnabled && unset && !settings.translationFallback;
    const toTranslation = (
        <button
            type="button"
            className="link-button"
            onClick={() => go('translation')}
        >
            {t('helpGoTranslation')}
        </button>
    );
    const fixes: { labelKey: string; section: SectionId }[] = [
        { labelKey: 'startFixTiming', section: 'timing' },
        { labelKey: 'startFixTwice', section: 'sites' },
        { labelKey: 'startFixNone', section: 'help' },
        { labelKey: 'startFixTranslation', section: 'translation' },
    ];

    return (
        <section className="section" aria-labelledby="start-title">
            <h1 id="start-title" tabIndex={-1}>
                {t('startTitle')}
            </h1>
            <p className="lead">{t('startLead')}</p>

            <div className="card">
                <div className="row">
                    <div className="status">
                        <span
                            className={`status-icon ${working && !stopped ? 'ok' : 'off'}`}
                            aria-hidden="true"
                        >
                            <Icon name={stopped ? 'alert' : 'check'} />
                        </span>
                        {stopped ? (
                            <div className="stack">
                                <div className="label">
                                    {t('startNeedsSetupTitle', providerName)}
                                </div>
                                <div className="help">
                                    {t('startNeedsSetupStopped')}
                                </div>
                                {toTranslation}
                            </div>
                        ) : (
                            <div>
                                <div className="label">
                                    {statusTitle(
                                        t,
                                        settings.uiLanguage,
                                        settings.subtitlesEnabled,
                                        sites
                                    )}
                                </div>
                                <div className="help">
                                    {t(
                                        working
                                            ? 'startStatusReadyHelp'
                                            : 'startStatusOffHelp'
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="inline" id="dual-subtitles">
                        <span className="strong" id="start-enabled">
                            {t('startEnabled')}
                        </span>
                        <Switch
                            checked={settings.subtitlesEnabled}
                            labelledBy="start-enabled"
                            onChange={(enabled) =>
                                save(
                                    { subtitlesEnabled: enabled },
                                    {
                                        message: t(
                                            enabled
                                                ? 'toastSubtitlesOn'
                                                : 'toastSubtitlesOff'
                                        ),
                                    }
                                )
                            }
                        />
                    </div>
                </div>
                <SiteTag keys={['subtitlesEnabled']} />
                {unreadable && (
                    <p className="notice danger" role="alert">
                        {t('startSitesUnreadable')}
                    </p>
                )}
                <div className="inline wrap">
                    <SiteLinks t={t} className="button" />
                </div>
            </div>

            {settings.subtitlesEnabled && unset && !stopped && (
                <div className="notice" role="status">
                    <Icon name="alert" />
                    <div className="stack">
                        <strong>
                            {t('startNeedsSetupTitle', providerName)}
                        </strong>
                        <span>
                            {t(
                                'startNeedsSetupCovered',
                                t(PROVIDER_NAME_KEYS[KEYLESS_PROVIDERS[0]])
                            )}
                        </span>
                        {toTranslation}
                    </div>
                </div>
            )}
            <HealthNotice t={t} provider={provider}>
                {toTranslation}
            </HealthNotice>

            <h2>{t('startSetUpTitle')}</h2>
            <div className="card list">
                <div className="list-row">
                    <div className="grow">
                        <div className="label" id="start-speak">
                            {t('languagesSpeakTitle')}
                        </div>
                        <div className="help">{t('languagesSpeakHelp')}</div>
                        {fromBrowser && (
                            <span className="tag ok">
                                {t('startFromBrowser')}
                            </span>
                        )}
                        <SharedTag />
                    </div>
                    <LanguageSelect
                        t={t}
                        id="start-target-language"
                        labelledBy="start-speak"
                        value={settings.targetLanguage}
                        onChange={(language) =>
                            void save(
                                { targetLanguage: language },
                                {
                                    message: t(
                                        'toastSpeak',
                                        languageName(t, language)
                                    ),
                                }
                            )
                        }
                    />
                </div>
                <div className="list-row">
                    <div className="grow">
                        <div className="label">{t('startTopTitle')}</div>
                        <div className="help">
                            {settings.originalLanguage === AUTO_LANGUAGE
                                ? t('startTopAuto')
                                : t(
                                      'startTopFixed',
                                      languageName(t, settings.originalLanguage)
                                  )}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="button"
                        onClick={() => go('languages')}
                    >
                        {t('commonChange')}
                    </button>
                </div>
                <div className="list-row">
                    <div className="grow">
                        <div className="label">{t('navTranslation')}</div>
                        <div className="help">
                            {t(PROVIDER_SUMMARIES[settings.selectedProvider])}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="button"
                        onClick={() => go('translation')}
                    >
                        {t('commonChange')}
                    </button>
                </div>
            </div>

            <h2 id="start-size">{t('lookSizeTitle')}</h2>
            <SizePicker
                t={t}
                scale={settings.subtitleFontScale}
                labelledBy="start-size"
                onPick={(scale, label) =>
                    void save(
                        { subtitleFontScale: scale },
                        { message: t('toastSize', label) }
                    )
                }
            />
            <SiteTag keys={['subtitleFontScale']} />

            <h2>{t('startProblemsTitle')}</h2>
            <div className="fixes">
                {fixes.map((fix) => (
                    <button
                        key={fix.labelKey}
                        type="button"
                        className="fix"
                        onClick={() => go(fix.section)}
                    >
                        <span>{t(fix.labelKey)}</span>
                        <Icon name="chevron" />
                    </button>
                ))}
            </div>
        </section>
    );
}
