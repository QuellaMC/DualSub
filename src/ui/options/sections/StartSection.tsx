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

/** Whether DualSub runs on one site, as that site sees its settings. */
function SiteStatus({ t, site }: { t: Translate; site: PlatformId }) {
    const { settings } = useSettings(['subtitlesEnabled'], { site });
    if (!settings) {
        return null;
    }
    return (
        <span className={`tag ${settings.subtitlesEnabled ? 'ok' : 'muted'}`}>
            {t(
                settings.subtitlesEnabled ? 'startSiteOn' : 'startSiteOff',
                PLATFORM_NAMES[site]
            )}
        </span>
    );
}

export function StartSection({
    t,
    settings,
    save,
    go,
}: SectionProps & { go: (section: SectionId) => void }) {
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
                            className={`status-icon ${settings.subtitlesEnabled && !stopped ? 'ok' : 'off'}`}
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
                                    {t(
                                        settings.subtitlesEnabled
                                            ? 'startStatusReady'
                                            : 'startStatusOff'
                                    )}
                                </div>
                                <div className="help">
                                    {t(
                                        settings.subtitlesEnabled
                                            ? 'startStatusReadyHelp'
                                            : 'startStatusOffHelp'
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="inline">
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
                <div className="inline wrap">
                    {PLATFORM_IDS.map((site) => (
                        <SiteStatus key={site} t={t} site={site} />
                    ))}
                </div>
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
                        <div className="label">{t('languagesTopTitle')}</div>
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
