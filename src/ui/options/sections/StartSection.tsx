import { KEYLESS_PROVIDERS, type ProviderId } from '@/shared/providers';
import { namedSize, nextSize } from '../../adjustments';
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
import { sampleVideoLanguage } from '../../preview/sample';
import { SiteLinks } from '../../SiteLinks';
import { LanguageSelect } from '../../design/LanguageSelect';
import { PROVIDER_NAME_KEYS } from '../../providerNames';
import { FromBrowserTag } from '../controls/FromBrowserTag';
import { Specimen } from '../preview/Specimen';
import type { SectionId } from '../sections';
import {
    SharedTag,
    SiteTag,
    useScope,
    useSiteDraft,
} from '../shell/scopeContext';
import type { SectionProps } from '../types';

/** What a service asks of the viewer, in a word. */
const PROVIDER_TAGS: Record<ProviderId, { textKey: string; tone: string }> = {
    microsoft_edge: { textKey: 'tagFree', tone: 'ok' },
    google: { textKey: 'tagFree', tone: 'ok' },
    deepl: { textKey: 'tagYourKey', tone: 'muted' },
    openai_compatible: { textKey: 'tagYourKey', tone: 'muted' },
    vertex_gemini: { textKey: 'tagCloud', tone: 'advanced' },
};

export function StartSection({
    t,
    settings,
    save,
    go,
}: SectionProps & { go: (section: SectionId) => void }) {
    const scope = useScope();
    // Start shows one site's view under its scope, so every site's is read
    // from the shared settings.
    const { settings: shared, unreadable } = useSiteViews();
    const sites = shared ? sitesOn(shared) : null;
    const working = sites ? sites.on.length > 0 : settings.subtitlesEnabled;
    const translating = shared ? callsForTranslation(shared) : working;
    const provider = settings.selectedProvider;
    const providerName = t(PROVIDER_NAME_KEYS[provider]);
    const unset = useServiceUnset(settings);
    const stopped = translationStopped({
        translating,
        unset,
        fallback: settings.translationFallback,
    });
    const covered = translating && unset && settings.translationFallback;
    // Presses build on the size last shown, saved or not.
    const scale = useSiteDraft(
        'subtitleFontScale',
        settings.subtitleFontScale,
        (value, notice) => save({ subtitleFontScale: value }, notice)
    );
    const size = namedSize(scale.value);
    const smaller = nextSize(scale.value, -1);
    const bigger = nextSize(scale.value, 1);
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
            <h1 id="start-title" className="sr-only" tabIndex={-1}>
                {t('navStart')}
            </h1>

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
                            <div className="label">
                                {sitesOnTitle(
                                    t,
                                    settings.uiLanguage,
                                    settings.subtitlesEnabled,
                                    sites
                                )}
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

            <Specimen
                t={t}
                settings={{ ...settings, subtitleFontScale: scale.value }}
                scope={scope}
                spoken={sampleVideoLanguage(settings.targetLanguage)}
                corner={
                    <button
                        type="button"
                        className="corner-button"
                        onClick={() => go('look')}
                    >
                        {t('startChangeStyle')}
                        <Icon name="chevron" />
                    </button>
                }
            />

            <div className="basics">
                <div className="card tile">
                    <label
                        className="tile-label"
                        htmlFor="start-target-language"
                    >
                        {t('languagesSpeakTitle')}
                    </label>
                    <LanguageSelect
                        t={t}
                        id="start-target-language"
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
                    <FromBrowserTag t={t} language={settings.targetLanguage} />
                    <SharedTag />
                </div>
                <div className="card tile">
                    <span className="tile-label" id="start-size">
                        {t('lookSizeTitle')}
                    </span>
                    <div
                        className="size-stepper"
                        role="group"
                        aria-labelledby="start-size"
                    >
                        <button
                            type="button"
                            aria-label={t('sizeSmaller')}
                            disabled={!smaller}
                            onClick={() =>
                                smaller &&
                                scale.set(smaller.scale, {
                                    message: t(
                                        'toastSize',
                                        t(smaller.labelKey)
                                    ),
                                })
                            }
                        >
                            <span className="glyph-small">A</span>−
                        </button>
                        <span className="size-stepper-value" aria-live="polite">
                            {size
                                ? t(size.labelKey)
                                : t(
                                      'sizeExact',
                                      Math.round(scale.value * 100) / 100
                                  )}
                        </span>
                        <button
                            type="button"
                            aria-label={t('sizeBigger')}
                            disabled={!bigger}
                            onClick={() =>
                                bigger &&
                                scale.set(bigger.scale, {
                                    message: t('toastSize', t(bigger.labelKey)),
                                })
                            }
                        >
                            <span className="glyph-large">A</span>+
                        </button>
                    </div>
                    <SiteTag keys={['subtitleFontScale']} />
                </div>
                <button
                    type="button"
                    className="card tile tile-link"
                    onClick={() => go('translation')}
                >
                    <span className="tile-label">{t('navTranslation')}</span>
                    <span className="tile-value">{providerName}</span>
                    <span>
                        <span className={`tag ${PROVIDER_TAGS[provider].tone}`}>
                            {t(PROVIDER_TAGS[provider].textKey)}
                        </span>
                    </span>
                    <Icon name="chevron" />
                </button>
            </div>

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
