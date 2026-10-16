import { browser } from 'wxt/browser';
import type { SettingsValues } from '@/config/schema';
import { configService } from '@/config/service';
import { PLATFORM_IDS } from '@/shared/platforms';
import type { Translate } from '../../hooks/useI18n';
import type { SectionId } from '../sections';
import { useFeedback } from '../shell/feedback';

const SOURCE_URL = 'https://github.com/QuellaMC/DualSub';

export function HelpSection({
    t,
    go,
}: {
    t: Translate;
    go: (section: SectionId) => void;
}) {
    const feedback = useFeedback();

    /** Hide every site's own subtitles in one write: the shared value, and
     *  no site keeping its own. Undo puts back the shared value and every
     *  site's own choice as they were. */
    const hideEverywhere = (): void => {
        let before: Partial<SettingsValues> = {};
        void feedback.apply(
            async () => {
                before = await configService.removeSiteValues(
                    PLATFORM_IDS,
                    ['hideOfficialSubtitles'],
                    { hideOfficialSubtitles: true }
                );
            },
            t('toastHiddenEverywhere'),
            () =>
                configService.restoreSiteValues(before, PLATFORM_IDS, [
                    'hideOfficialSubtitles',
                ])
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
                        {t('helpNoSubtitlesSite')}{' '}
                        <button
                            type="button"
                            className="link-button"
                            onClick={() => go('sites')}
                        >
                            {t('helpOpenSites')}
                        </button>
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
                    <a
                        href={SOURCE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t('helpSource')}
                    </a>
                </p>
                <p className="help">{t('aboutDevelopment')}</p>
                <p className="help">{t('helpPrivacy')}</p>
            </div>
        </section>
    );
}
