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

function offered(language: string): SubtitleLanguage {
    return closestLanguage(language, SUBTITLE_LANGUAGES) ?? 'en';
}

/** A sample video's language other than the viewer's own, so both lines
 *  show. */
export function sampleVideoLanguage(targetLanguage: string): SubtitleLanguage {
    return offered(targetLanguage) === 'en' ? 'ko' : 'en';
}

export interface SampleSubtitles {
    readonly originalLanguage: SubtitleLanguage;
    readonly targetLanguage: SubtitleLanguage;
    readonly originalText: string;
    /** Empty when the video already speaks the viewer's language, where
     *  DualSub shows one line. */
    readonly translatedText: string;
}

/** The sample proverb as these settings show it over a video speaking
 *  `spoken`. */
export function sampleSubtitles(
    settings: Pick<SettingsValues, 'originalLanguage' | 'targetLanguage'>,
    spoken: SubtitleLanguage
): SampleSubtitles {
    const targetLanguage = offered(settings.targetLanguage);
    const originalLanguage =
        settings.originalLanguage === AUTO_LANGUAGE
            ? spoken
            : offered(settings.originalLanguage);
    return {
        originalLanguage,
        targetLanguage,
        originalText: SAMPLE_LINES[originalLanguage],
        translatedText: isSameLanguage(originalLanguage, targetLanguage)
            ? ''
            : SAMPLE_LINES[targetLanguage],
    };
}

/** What the sample's two lines are, in words. */
export function sampleCaption(
    t: Translate,
    settings: Pick<SettingsValues, 'originalLanguage'>,
    sample: SampleSubtitles
): string {
    return t(
        settings.originalLanguage === AUTO_LANGUAGE
            ? 'previewCaptionAuto'
            : 'previewCaptionFixed',
        languageName(t, sample.originalLanguage),
        languageName(t, sample.targetLanguage)
    );
}
