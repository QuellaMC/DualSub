import { useState } from 'react';
import { closestLanguage } from '@/shared/languageNormalization';
import { AUTO_LANGUAGE, SUBTITLE_LANGUAGES } from '@/shared/subtitleLanguages';
import { Switch } from '../../design/Switch';
import { languageName } from '../../languageLabels';
import { LanguageSelect } from '../../design/LanguageSelect';
import { sampleVideoLanguage } from '../../preview/sample';
import { FromBrowserTag } from '../controls/FromBrowserTag';
import { SampleVideoChoice } from '../preview/SampleVideoChoice';
import { Specimen } from '../preview/Specimen';
import { SharedTag, SiteTag, useScope } from '../shell/scopeContext';
import type { SectionProps } from '../types';

export function LanguagesSection({
    t,
    settings,
    save,
    advanced,
}: SectionProps & { advanced: boolean }) {
    const scope = useScope();
    const [spoken, setSpoken] = useState(() =>
        sampleVideoLanguage(settings.targetLanguage)
    );
    const automatic = settings.originalLanguage === AUTO_LANGUAGE;
    // A fixed language to start from when the viewer leaves Automatic.
    const fixedLanguage = automatic
        ? 'en'
        : (closestLanguage(settings.originalLanguage, SUBTITLE_LANGUAGES) ??
          settings.originalLanguage);

    return (
        <section className="section" aria-labelledby="languages-title">
            <h1 id="languages-title" className="sr-only" tabIndex={-1}>
                {t('navLanguages')}
            </h1>

            <Specimen
                t={t}
                settings={settings}
                scope={scope}
                spoken={spoken}
                corner={
                    <SampleVideoChoice
                        t={t}
                        spoken={spoken}
                        onPick={setSpoken}
                        overPicture
                    />
                }
            />

            <div className="card" id="target-language">
                <div className="row">
                    <label className="label" htmlFor="target-language-menu">
                        {t('languagesSpeakTitle')}
                    </label>
                    <LanguageSelect
                        t={t}
                        id="target-language-menu"
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
                <FromBrowserTag t={t} language={settings.targetLanguage} />
                <SharedTag />
            </div>

            <div className="card" id="original-line">
                <div className="label" id="languages-top">
                    {t('languagesOriginalTitle')}
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
                                { message: t('toastOriginalAuto') }
                            )
                        }
                    >
                        <span className="choice-title">
                            {t('languagesOriginalAuto')}
                            <span className="tag ok">
                                {t('commonRecommended')}
                            </span>
                        </span>
                        <span className="help">
                            {t('languagesOriginalAutoHelp')}
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
                                        'toastOriginalFixed',
                                        languageName(t, fixedLanguage)
                                    ),
                                }
                            )
                        }
                    >
                        <span className="choice-title">
                            {t('languagesOriginalFixed')}
                        </span>
                        <span className="help">
                            {t('languagesOriginalFixedHelp')}
                        </span>
                    </button>
                </div>
                {!automatic && (
                    <div className="row">
                        <span className="strong" id="languages-top-fixed">
                            {t('languagesOriginalFixedMenu')}
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
                                            'toastOriginalFixed',
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
                {advanced && settings.useOfficialTranslations && (
                    <div className="divided stack" id="official-pairing">
                        <div className="row">
                            <div className="grow">
                                <div className="label">
                                    <span id="languages-pair">
                                        {t('languagesPairTitle')}
                                    </span>{' '}
                                    <span className="tag advanced">
                                        {t('commonAdvanced')}
                                    </span>
                                </div>
                                <div className="help">
                                    {t('languagesPairHelp')}
                                </div>
                            </div>
                            <Switch
                                checked={settings.pairOfficialTranslations}
                                labelledBy="languages-pair"
                                onChange={(pair) =>
                                    save(
                                        { pairOfficialTranslations: pair },
                                        {
                                            message: t(
                                                pair
                                                    ? 'toastPairOn'
                                                    : 'toastPairOff'
                                            ),
                                        }
                                    )
                                }
                            />
                        </div>
                        <SharedTag />
                    </div>
                )}
            </div>
        </section>
    );
}
