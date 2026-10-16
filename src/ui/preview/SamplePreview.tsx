import type { SettingsValues } from '@/config/schema';
import { resolveLook } from '@/content/renderer/looks';
import { toDisplaySettings } from '@/content/renderer/styling';
import { PLATFORM_IDS } from '@/shared/platforms';
import type { Translate } from '../hooks/useI18n';
import { PLATFORM_PRESETS } from '../subtitleStyle';
import { LookPreview } from './LookPreview';
import { languageName } from '../languageLabels';
import {
    sampleCaption,
    sampleSubtitles,
    sampleVideoLanguage,
    type SampleSubtitles,
} from './sample';

/** The settings a sample of the subtitles is drawn from. */
export const SAMPLE_SETTINGS_KEYS = [
    'targetLanguage',
    'originalLanguage',
    'subtitleStyle',
    'subtitleCustomLook',
    'subtitleTranslationColor',
    'subtitleFontScale',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleLayoutOrientation',
    'subtitleLayoutOrder',
    'subtitleTimeOffset',
] as const;

export type SampleSettings = Pick<
    SettingsValues,
    (typeof SAMPLE_SETTINGS_KEYS)[number]
>;

/** The two lines as these settings show them over a sample video in
 *  another language, with what each line is when `caption` asks. */
export function SamplePreview({
    t,
    settings,
    caption = false,
}: {
    t: Translate;
    settings: SampleSettings;
    caption?: boolean;
}) {
    const sample = sampleSubtitles(
        settings,
        sampleVideoLanguage(settings.targetLanguage)
    );
    const display = toDisplaySettings(settings);
    return (
        <>
            <LookPreview
                display={display}
                look={resolveLook(
                    display,
                    PLATFORM_PRESETS[PLATFORM_IDS[0]],
                    null
                )}
                originalText={sample.originalText}
                translatedText={sample.translatedText}
                label={t('previewLabel')}
            />
            {caption && (
                <SampleCaption t={t} settings={settings} sample={sample} />
            )}
        </>
    );
}

/** What each sample line is, and each language English stands in for. */
export function SampleCaption({
    t,
    settings,
    sample,
}: {
    t: Translate;
    settings: Pick<SettingsValues, 'originalLanguage'>;
    sample: SampleSubtitles;
}) {
    return (
        <>
            <p className="help">{sampleCaption(t, settings, sample)}</p>
            {sample.standIns.map((language) => (
                <p key={language} className="help">
                    {t('previewStandIn', languageName(t, language))}
                </p>
            ))}
        </>
    );
}
