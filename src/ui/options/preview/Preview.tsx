import { useMemo, useState } from 'react';
import { customLook, resolveLook } from '@/content/renderer/looks';
import type { DisplaySettings } from '@/content/renderer/styling';
import {
    closestLanguage,
    isSameLanguage,
} from '@/shared/languageNormalization';
import {
    PLATFORM_IDS,
    PLATFORM_NAMES,
    type PlatformId,
} from '@/shared/platforms';
import {
    AUTO_LANGUAGE,
    SUBTITLE_LANGUAGES,
    type SubtitleLanguage,
} from '@/shared/subtitleLanguages';
import type { Translate } from '../../hooks/useI18n';
import { languageName } from '../../languageLabels';
import { PLATFORM_PRESETS } from '../../subtitleStyle';
import { LookPreview } from '../LookPreview';
import type { OptionsSettings, Scope } from '../types';
import { SAMPLE_LINES } from './sampleLines';

/** What the sample video speaks, to show an automatic top line at work. */
const SAMPLE_VIDEOS = [
    { language: 'en', labelKey: 'previewEnglishFilm' },
    { language: 'ko', labelKey: 'previewKoreanDrama' },
] as const satisfies readonly {
    language: SubtitleLanguage;
    labelKey: string;
}[];

/** The preview draws its text as on a picture this many pixels tall: small
 *  enough to sit in the frame as subtitles sit in a video, large enough to
 *  read. */
const PICTURE_HEIGHT = 700;

const CAPTIONS = {
    auto: {
        official: 'previewCaptionAuto',
        translated: 'previewCaptionAutoTranslated',
        none: 'previewCaptionAutoOne',
    },
    fixed: {
        official: 'previewCaptionFixed',
        translated: 'previewCaptionFixedTranslated',
        none: 'previewCaptionFixedOne',
    },
} as const;

/** The language the sample shows for `language`: the closest one it has
 *  lines in, else English, standing in. */
function offered(language: string): SubtitleLanguage {
    return closestLanguage(language, SUBTITLE_LANGUAGES) ?? 'en';
}

/** The subtitles as they will look, drawn by the overlay's own styling. */
export function Preview({
    t,
    settings,
    scope,
}: {
    t: Translate;
    settings: OptionsSettings;
    scope: Scope;
}) {
    const target = offered(settings.targetLanguage);
    // A sample in the viewer's own language would show one line only.
    const [spoken, setSpoken] = useState<SubtitleLanguage>(
        target === 'en' ? 'ko' : 'en'
    );
    const [previewSite, setPreviewSite] = useState<PlatformId>('netflix');
    const site = scope === 'all' ? previewSite : scope;
    const automatic = settings.originalLanguage === AUTO_LANGUAGE;
    const topLanguage = automatic ? spoken : settings.originalLanguage;
    // The lines are counted as the video shows them, by the languages
    // picked, before English stands in for any the sample lacks.
    const oneLine = isSameLanguage(topLanguage, settings.targetLanguage);
    const top = offered(topLanguage);
    /** The languages picked that the sample has no lines in. */
    const standIns = [
        ...new Set([
            settings.targetLanguage,
            ...(automatic ? [] : [settings.originalLanguage]),
        ]),
    ].filter(
        (language) => closestLanguage(language, SUBTITLE_LANGUAGES) === null
    );

    const display = useMemo<DisplaySettings>(
        () => ({
            style: settings.subtitleStyle,
            customLook: customLook(settings.subtitleCustomLook),
            translationColor: settings.subtitleTranslationColor,
            fontScale: settings.subtitleFontScale,
            gap: settings.subtitleGap,
            verticalPosition: settings.subtitleVerticalPosition,
            orientation: settings.subtitleLayoutOrientation,
            order: settings.subtitleLayoutOrder,
            timeOffset: 0,
        }),
        [
            settings.subtitleStyle,
            settings.subtitleCustomLook,
            settings.subtitleTranslationColor,
            settings.subtitleFontScale,
            settings.subtitleGap,
            settings.subtitleVerticalPosition,
            settings.subtitleLayoutOrientation,
            settings.subtitleLayoutOrder,
        ]
    );

    return (
        <aside className="preview" aria-labelledby="preview-title">
            <div className="card">
                <div className="row">
                    <h2 className="strong" id="preview-title">
                        {t('previewTitle')}
                    </h2>
                    {scope !== 'all' && (
                        <span className="tag site">
                            {PLATFORM_NAMES[scope]}
                        </span>
                    )}
                </div>
                {settings.subtitlesEnabled ? (
                    <LookPreview
                        display={display}
                        look={resolveLook(
                            display,
                            PLATFORM_PRESETS[site],
                            null
                        )}
                        pictureHeight={PICTURE_HEIGHT}
                        originalText={SAMPLE_LINES[top]}
                        translatedText={oneLine ? '' : SAMPLE_LINES[target]}
                        label={t('previewLabel')}
                    />
                ) : (
                    <div className="screen preview-off">
                        <span>{t('previewOff')}</span>
                    </div>
                )}
                <div className="row">
                    <span className="help" id="preview-sample">
                        {t('previewSampleVideo')}
                    </span>
                    <div
                        className="segmented small"
                        role="group"
                        aria-labelledby="preview-sample"
                    >
                        {SAMPLE_VIDEOS.map((video) => (
                            <button
                                key={video.language}
                                type="button"
                                aria-pressed={spoken === video.language}
                                onClick={() => setSpoken(video.language)}
                            >
                                {t(video.labelKey)}
                            </button>
                        ))}
                    </div>
                </div>
                {settings.subtitleStyle === 'platform' && scope === 'all' && (
                    <div className="row">
                        <span className="help" id="preview-site">
                            {t('previewShownOn')}
                        </span>
                        <div
                            className="segmented small"
                            role="group"
                            aria-labelledby="preview-site"
                        >
                            {PLATFORM_IDS.map((id) => (
                                <button
                                    key={id}
                                    type="button"
                                    aria-pressed={previewSite === id}
                                    onClick={() => setPreviewSite(id)}
                                >
                                    {PLATFORM_NAMES[id]}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {oneLine && settings.subtitlesEnabled && (
                    <p className="notice">{t('previewOneLine')}</p>
                )}
                <p className="help">
                    {t(
                        CAPTIONS[automatic ? 'auto' : 'fixed'][
                            oneLine
                                ? 'none'
                                : settings.useOfficialTranslations
                                  ? 'official'
                                  : 'translated'
                        ],
                        languageName(t, topLanguage),
                        languageName(t, settings.targetLanguage)
                    )}
                </p>
                {standIns.map((language) => (
                    <p key={language} className="help">
                        {t('previewStandIn', languageName(t, language))}
                    </p>
                ))}
            </div>
        </aside>
    );
}
