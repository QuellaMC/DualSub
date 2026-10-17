import { browser } from 'wxt/browser';
import { PLATFORM_IDS } from '@/shared/platforms';
import { Interpolate } from '../../design/Interpolate';
import type { Translate } from '../../hooks/useI18n';
import type { SectionId } from '../sections';
import { followAllSites, useFeedback } from '../shell/feedback';

const SOURCE_URL = 'https://github.com/QuellaMC/DualSub';

export function HelpSection({
    t,
    fallback,
    go,
}: {
    t: Translate;
    /** Whether free services cover for the chosen one when it fails, which
     *  sends them subtitle text too. */
    fallback: boolean;
    go: (section: SectionId) => void;
}) {
    const feedback = useFeedback();

    /** Hide every site's own subtitles in one write: the shared value, and
     *  no site keeping its own. */
    const hideEverywhere = (): void => {
        void followAllSites(
            feedback,
            PLATFORM_IDS,
            ['hideOfficialSubtitles'],
            t('toastHiddenEverywhere'),
            { hideOfficialSubtitles: true }
        );
    };

    return (
        <section className="section" aria-labelledby="help-title">
            <h1 id="help-title" tabIndex={-1}>
                {t('navHelp')}
            </h1>
            <p className="lead">{t('helpLead')}</p>

            <div className="card" id="help-none">
                <h2 className="label">{t('helpNoSubtitlesTitle')}</h2>
                <ol className="checklist">
                    <li>{t('helpNoSubtitlesPlaying')}</li>
                    <li>{t('helpNoSubtitlesTracks')}</li>
                    <li>
                        <Interpolate text={t('helpNoSubtitlesSite')}>
                            <button
                                type="button"
                                className="link-button"
                                onClick={() => go('sites')}
                            >
                                {t('navSites')}
                            </button>
                        </Interpolate>
                    </li>
                    <li>{t('helpNoSubtitlesReload')}</li>
                </ol>
            </div>

            <div className="card">
                <div className="row">
                    <div className="grow">
                        <h2 className="label">{t('helpTwiceTitle')}</h2>
                        <p className="help">{t('helpTwiceHelp')}</p>
                    </div>
                    <button
                        type="button"
                        className="button primary"
                        onClick={hideEverywhere}
                    >
                        {t('helpFixIt')}
                    </button>
                </div>
            </div>

            <div className="card">
                <div className="row">
                    <div className="grow">
                        <h2 className="label">{t('helpTimingTitle')}</h2>
                        <p className="help">{t('helpTimingHelp')}</p>
                    </div>
                    <button
                        type="button"
                        className="button"
                        onClick={() => go('timing')}
                    >
                        {t('helpGoTiming')}
                    </button>
                </div>
            </div>

            <div className="card">
                <div className="row">
                    <div className="grow">
                        <h2 className="label">{t('helpTranslationTitle')}</h2>
                        <p className="help">{t('helpTranslationHelp')}</p>
                    </div>
                    <button
                        type="button"
                        className="button"
                        onClick={() => go('translation')}
                    >
                        {t('helpGoTranslation')}
                    </button>
                </div>
            </div>

            <div className="card">
                <h2 className="label">{t('helpAboutTitle')}</h2>
                <p className="help">
                    {t('helpVersion', browser.runtime.getManifest().version)} ·{' '}
                    {t('helpMadeBy')} ·{' '}
                    <a
                        href={SOURCE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t('helpSource')}
                    </a>
                </p>
                <p className="help">
                    {t(fallback ? 'helpPrivacyFallback' : 'helpPrivacy')}
                </p>
            </div>
        </section>
    );
}
