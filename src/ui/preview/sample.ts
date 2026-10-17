import type { SettingsValues } from '@/config/schema';
import {
    closestLanguage,
    isSameLanguage,
} from '@/shared/languageNormalization';
import {
    AUTO_LANGUAGE,
    SUBTITLE_LANGUAGES,
    type SubtitleLanguage,
} from '@/shared/subtitleLanguages';
import type { Translate } from '../hooks/useI18n';
import { languageName } from '../languageLabels';

/** One proverb in every subtitle language. */
const SAMPLE_LINES: Record<SubtitleLanguage, string> = {
    en: 'Where there’s a will, there’s a way.',
    es: 'Querer es poder.',
    fr: 'Vouloir, c’est pouvoir.',
    de: 'Wo ein Wille ist, ist auch ein Weg.',
    it: 'Volere è potere.',
    pt: 'Querer é poder.',
    ja: '意志あるところに道は開ける。',
    ko: '뜻이 있는 곳에 길이 있다.',
    'zh-CN': '有志者事竟成。',
    'zh-TW': '有志者事竟成。',
    ru: 'Где хотенье, там и уменье.',
    ar: 'حيثما وُجدت الإرادة وُجد الطريق.',
    hi: 'जहाँ चाह, वहाँ राह।',
};

/** The language the sample shows for `language`: the closest one it has
 *  lines in, else English, standing in. */
function offered(language: string): SubtitleLanguage {
    return closestLanguage(language, SUBTITLE_LANGUAGES) ?? 'en';
}

/** A sample video's language other than the viewer's own, so both lines
 *  show. */
export function sampleVideoLanguage(targetLanguage: string): SubtitleLanguage {
    return offered(targetLanguage) === 'en' ? 'ko' : 'en';
}

export interface SampleSubtitles {
    /** The languages picked, as the video would show them: the spoken one
     *  on an automatic top line, else the stored one, and the viewer's. */
    readonly originalLanguage: string;
    readonly targetLanguage: string;
    readonly originalText: string;
    /** Empty when the video already speaks the viewer's language, where
     *  DualSub shows one line. */
    readonly translatedText: string;
    /** The languages picked that the sample has no lines in, where English
     *  stands in; a backup or another computer can store one. */
    readonly standIns: readonly string[];
}

/** The sample proverb as these settings show it over a video speaking
 *  `spoken`. */
export function sampleSubtitles(
    settings: Pick<SettingsValues, 'originalLanguage' | 'targetLanguage'>,
    spoken: SubtitleLanguage
): SampleSubtitles {
    const automatic = settings.originalLanguage === AUTO_LANGUAGE;
    const { targetLanguage } = settings;
    const originalLanguage = automatic ? spoken : settings.originalLanguage;
    return {
        originalLanguage,
        targetLanguage,
        originalText: SAMPLE_LINES[offered(originalLanguage)],
        // The lines are counted as the video shows them, by the languages
        // picked, before English stands in for any the sample lacks.
        translatedText: isSameLanguage(originalLanguage, targetLanguage)
            ? ''
            : SAMPLE_LINES[offered(targetLanguage)],
        standIns: [
            ...new Set([
                settings.targetLanguage,
                ...(automatic ? [] : [settings.originalLanguage]),
            ]),
        ].filter(
            (language) => closestLanguage(language, SUBTITLE_LANGUAGES) === null
        ),
    };
}

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

/** What the sample's lines are, in words: the video's, and the viewer's,
 *  from the show or translated by DualSub. */
export function sampleCaption(
    t: Translate,
    settings: Pick<
        SettingsValues,
        'originalLanguage' | 'useOfficialTranslations'
    >,
    sample: SampleSubtitles
): string {
    const lines =
        CAPTIONS[
            settings.originalLanguage === AUTO_LANGUAGE ? 'auto' : 'fixed'
        ];
    return t(
        sample.translatedText === ''
            ? lines.none
            : settings.useOfficialTranslations
              ? lines.official
              : lines.translated,
        languageName(t, sample.originalLanguage),
        languageName(t, sample.targetLanguage)
    );
}
