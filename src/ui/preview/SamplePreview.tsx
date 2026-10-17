import type { SettingsValues } from '@/config/schema';
import { resolveLook } from '@/content/renderer/looks';
import { toDisplaySettings } from '@/content/renderer/styling';
import { PLATFORM_IDS } from '@/shared/platforms';
import type { Translate } from '../hooks/useI18n';
import { languageName } from '../languageLabels';
import { PLATFORM_PRESETS } from '../subtitleStyle';
import { LookPreview } from './LookPreview';
import {
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
 *  another language, their text sized as on a picture `pictureHeight`
 *  pixels tall, and each language English stands in for. */
export function SamplePreview({
    t,
    settings,
    pictureHeight,
}: {
    t: Translate;
    settings: SampleSettings;
    pictureHeight: number;
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
                pictureHeight={pictureHeight}
                originalText={sample.originalText}
                translatedText={sample.translatedText}
                label={t('previewLabel')}
            />
            <SampleStandIns t={t} sample={sample} />
        </>
    );
}

/** A language picked that the sample has no lines in, from a backup or
 *  another computer, shows as English; each says so. */
export function SampleStandIns({
    t,
    sample,
}: {
    t: Translate;
    sample: SampleSubtitles;
}) {
    return sample.standIns.map((language) => (
        <p key={language} className="help">
            {t('previewStandIn', languageName(t, language))}
        </p>
    ));
}
