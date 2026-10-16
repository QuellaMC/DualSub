import { useState } from 'react';
import { resolveLook } from '@/content/renderer/looks';
import { toDisplaySettings } from '@/content/renderer/styling';
import {
    PLATFORM_IDS,
    PLATFORM_NAMES,
    type PlatformId,
} from '@/shared/platforms';
import {
    AUTO_LANGUAGE,
    type SubtitleLanguage,
} from '@/shared/subtitleLanguages';
import type { Translate } from '../../hooks/useI18n';
import { languageName } from '../../languageLabels';
import { LookPreview } from '../../preview/LookPreview';
import { sampleSubtitles, sampleVideoLanguage } from '../../preview/sample';
import { PLATFORM_PRESETS } from '../../subtitleStyle';
import type { OptionsSettings, Scope } from '../types';

/** What the sample video speaks, to show an automatic top line at work. */
const SAMPLE_VIDEOS = [
    { language: 'en', labelKey: 'previewEnglishFilm' },
    { language: 'ko', labelKey: 'previewKoreanDrama' },
] as const satisfies readonly {
    language: SubtitleLanguage;
    labelKey: string;
}[];

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
    const [spoken, setSpoken] = useState<SubtitleLanguage>(() =>
        sampleVideoLanguage(settings.targetLanguage)
    );
    const [previewSite, setPreviewSite] = useState<PlatformId>('netflix');
    const site = scope === 'all' ? previewSite : scope;
    const automatic = settings.originalLanguage === AUTO_LANGUAGE;
    const sample = sampleSubtitles(settings, spoken);
    const oneLine = sample.translatedText === '';
    const display = toDisplaySettings(settings);

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
                        originalText={sample.originalText}
                        translatedText={sample.translatedText}
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
                        className="segmented"
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
                            className="segmented"
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
                        automatic
                            ? 'previewCaptionAuto'
                            : 'previewCaptionFixed',
                        languageName(t, sample.originalLanguage),
                        languageName(t, sample.targetLanguage)
                    )}
                </p>
                {sample.standIns.map((language) => (
                    <p key={language} className="help">
                        {t('previewStandIn', languageName(t, language))}
                    </p>
                ))}
            </div>
        </aside>
    );
}
