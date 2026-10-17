import { KEYLESS_PROVIDERS } from '@/shared/providers';
import {
    AUTO_LANGUAGE,
    browserTargetLanguage,
} from '@/shared/subtitleLanguages';
import { Icon } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import { HealthNotice } from '../../HealthNotice';
import {
    translationStopped,
    useServiceUnset,
} from '../../hooks/useServiceUnset';
import {
    callsForTranslation,
    sitesOn,
    sitesOnTitle,
    useSiteViews,
} from '../../hooks/useSitesOn';
import { languageName } from '../../languageLabels';
import { SiteLinks } from '../../SiteLinks';
import { LanguageSelect } from '../../design/LanguageSelect';
import { PROVIDER_NAME_KEYS } from '../../providerNames';
import { SizePicker } from '../controls/SizePicker';
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

export function StartSection({
    t,
    settings,
    save,
    go,
}: SectionProps & { go: (section: SectionId) => void }) {
    // Start shows one site's view under its scope, so every site's is read
    // from the shared settings.
    const { settings: shared, unreadable } = useSiteViews();
    const sites = shared ? sitesOn(shared) : null;
    const working = sites ? sites.on.length > 0 : settings.subtitlesEnabled;
    const translating = shared ? callsForTranslation(shared) : working;
    const fromBrowser = settings.targetLanguage === browserTargetLanguage();
    const provider = settings.selectedProvider;
    const providerName = t(PROVIDER_NAME_KEYS[provider]);
    const unset = useServiceUnset(settings);
    const stopped = translationStopped({
        translating,
        unset,
        fallback: settings.translationFallback,
    });
    const covered = translating && unset && settings.translationFallback;
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
                                    {sitesOnTitle(
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

            {covered && (
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
