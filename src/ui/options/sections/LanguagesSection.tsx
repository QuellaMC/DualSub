import { closestLanguage } from '@/shared/languageNormalization';
import { AUTO_LANGUAGE, SUBTITLE_LANGUAGES } from '@/shared/subtitleLanguages';
import { Switch } from '../../design/Switch';
import { languageName } from '../../languageLabels';
import { LanguageSelect } from '../controls/LanguageSelect';
import { SharedTag, SiteTag } from '../shell/scopeContext';
import type { SectionProps } from '../types';

export function LanguagesSection({ t, settings, save }: SectionProps) {
    const automatic = settings.originalLanguage === AUTO_LANGUAGE;
    // A fixed language to start from when the viewer leaves Automatic.
    const fixedLanguage = automatic
        ? 'en'
        : (closestLanguage(settings.originalLanguage, SUBTITLE_LANGUAGES) ??
          settings.originalLanguage);

    return (
        <section className="section" aria-labelledby="languages-title">
            <h1 id="languages-title" tabIndex={-1}>
                {t('navLanguages')}
            </h1>
            <p className="lead">{t('languagesLead')}</p>

            <div className="card" id="target-language">
                <div className="row">
                    <div className="grow">
                        <div className="label" id="languages-speak">
                            {t('languagesSpeakTitle')}
                        </div>
                        <div className="help">{t('languagesSpeakHelp')}</div>
                    </div>
                    <LanguageSelect
                        t={t}
                        id="target-language-menu"
                        labelledBy="languages-speak"
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
                <SharedTag />
            </div>

            <div className="card" id="top-line">
                <div className="label" id="languages-top">
                    {t('languagesTopTitle')}
                </div>
                <SiteTag keys={['originalLanguage']} />
                <div
                    className="choices"
                    role="group"
                    aria-labelledby="languages-top"
                >
                    <button
                        type="button"
                        className="choice"
                        aria-pressed={automatic}
                        onClick={() =>
                            void save(
                                { originalLanguage: AUTO_LANGUAGE },
                                { message: t('toastTopAuto') }
                            )
                        }
                    >
                        <span className="choice-title">
                            {t('languagesTopAuto')}
                            <span className="tag ok">
                                {t('commonRecommended')}
                            </span>
                        </span>
                        <span className="help">
                            {t('languagesTopAutoHelp')}
                        </span>
                    </button>
                    <button
                        type="button"
                        className="choice"
                        aria-pressed={!automatic}
                        onClick={() =>
                            void save(
                                { originalLanguage: fixedLanguage },
                                {
                                    message: t(
                                        'toastTopFixed',
                                        languageName(t, fixedLanguage)
                                    ),
                                }
                            )
                        }
                    >
                        <span className="choice-title">
                            {t('languagesTopFixed')}
                        </span>
                        <span className="help">
                            {t('languagesTopFixedHelp')}
                        </span>
                    </button>
                </div>
                {!automatic && (
                    <div className="row">
                        <span className="strong" id="languages-top-fixed">
                            {t('languagesTopFixedMenu')}
                        </span>
                        <LanguageSelect
                            t={t}
                            id="original-language-menu"
                            labelledBy="languages-top-fixed"
                            value={fixedLanguage}
                            onChange={(language) =>
                                void save(
                                    { originalLanguage: language },
                                    {
                                        message: t(
                                            'toastTopFixed',
                                            languageName(t, language)
                                        ),
                                    }
                                )
                            }
                        />
                    </div>
                )}
            </div>

            <div className="card" id="official-translation">
                <div className="row">
                    <div className="grow">
                        <div className="label" id="languages-official">
                            {t('languagesOfficialTitle')}
                        </div>
                        <div className="help">{t('languagesOfficialHelp')}</div>
                    </div>
                    <Switch
                        checked={settings.useOfficialTranslations}
                        labelledBy="languages-official"
                        onChange={(useOfficial) =>
                            save(
                                { useOfficialTranslations: useOfficial },
                                {
                                    message: t(
                                        useOfficial
                                            ? 'toastOfficialOn'
                                            : 'toastOfficialOff'
                                    ),
                                }
                            )
                        }
                    />
                </div>
                <SiteTag keys={['useOfficialTranslations']} />
            </div>
        </section>
    );
}
