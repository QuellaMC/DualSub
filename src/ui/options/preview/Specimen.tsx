import type { ReactNode } from 'react';
import { resolveLook } from '@/content/renderer/looks';
import { toDisplaySettings } from '@/content/renderer/styling';
import { PLATFORM_IDS } from '@/shared/platforms';
import {
    AUTO_LANGUAGE,
    type SubtitleLanguage,
} from '@/shared/subtitleLanguages';
import type { Translate } from '../../hooks/useI18n';
import { languageName } from '../../languageLabels';
import { sampleSubtitles } from '../../preview/sample';
import { SampleStandIns } from '../../preview/SamplePreview';
import { Scene } from '../../preview/Scene';
import { useSubtitleBlock } from '../../preview/useSubtitleBlock';
import { PLATFORM_PRESETS } from '../../subtitleStyle';
import type { OptionsSettings, Scope } from '../types';

/** Text at scale 1 is 19px here, as on a picture this tall: large enough
 *  to judge a look by. */
const PICTURE_HEIGHT = 950;

/**
 * The sample subtitles in a band at a size to read, with what each line
 * is. It shows how they look and which line is on top; where they sit on
 * the picture is the Style section's to show.
 */
export function Specimen({
    t,
    settings,
    scope,
    spoken,
    corner,
}: {
    t: Translate;
    settings: OptionsSettings;
    scope: Scope;
    /** What the sample video speaks. */
    spoken: SubtitleLanguage;
    /** Controls in the band's top corner. */
    corner: ReactNode;
}) {
    const sample = sampleSubtitles(settings, spoken);
    const display = toDisplaySettings(settings);
    const look = resolveLook(
        display,
        PLATFORM_PRESETS[scope === 'all' ? PLATFORM_IDS[0] : scope],
        null
    );
    const [, attach] = useSubtitleBlock({
        display,
        look,
        pictureHeight: PICTURE_HEIGHT,
        originalText: sample.originalText,
        translatedText: sample.translatedText,
    });

    const original = {
        text: sample.originalText,
        color: look.originalColor,
        about: t(
            settings.originalLanguage === AUTO_LANGUAGE
                ? 'previewLegendSpoken'
                : 'previewLegendChosen',
            languageName(t, sample.originalLanguage)
        ),
    };
    const translated = {
        text: sample.translatedText,
        color: display.translationColor,
        about: t('previewLegendYours', languageName(t, sample.targetLanguage)),
    };
    const lines =
        sample.translatedText === ''
            ? [
                  {
                      ...original,
                      about: t(
                          'previewLegendOneLine',
                          languageName(t, sample.originalLanguage)
                      ),
                  },
              ]
            : display.order === 'translation_top'
              ? [translated, original]
              : [original, translated];

    return (
        <>
            <div className="specimen">
                <Scene />
                <div className="specimen-corner">{corner}</div>
                {settings.subtitlesEnabled ? (
                    <div
                        className="specimen-block"
                        ref={attach}
                        role="img"
                        aria-label={t(
                            'previewLinesLabel',
                            lines.map((line) => line.text).join(' / ')
                        )}
                    />
                ) : (
                    <p className="specimen-off">{t('previewOff')}</p>
                )}
            </div>
            <ul className="legend">
                {lines.map((line) => (
                    <li key={line.about}>
                        <span
                            className="legend-dot"
                            style={{ background: line.color }}
                        />
                        {line.about}
                    </li>
                ))}
            </ul>
            <SampleStandIns t={t} sample={sample} />
        </>
    );
}
