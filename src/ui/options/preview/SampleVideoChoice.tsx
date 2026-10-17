import type { SubtitleLanguage } from '@/shared/subtitleLanguages';
import type { Translate } from '../../hooks/useI18n';

/** What the sample video speaks, to show an automatic top line at work. */
const SAMPLE_VIDEOS = [
    { language: 'ko', labelKey: 'previewKoreanDrama' },
    { language: 'en', labelKey: 'previewEnglishFilm' },
] as const satisfies readonly {
    language: SubtitleLanguage;
    labelKey: string;
}[];

export function SampleVideoChoice({
    t,
    spoken,
    onPick,
    overPicture = false,
}: {
    t: Translate;
    spoken: SubtitleLanguage;
    onPick: (language: SubtitleLanguage) => void;
    overPicture?: boolean;
}) {
    return (
        <div
            className={overPicture ? 'segmented dark' : 'segmented'}
            role="group"
            aria-label={t('previewSampleVideo')}
        >
            {SAMPLE_VIDEOS.map((video) => (
                <button
                    key={video.language}
                    type="button"
                    aria-pressed={spoken === video.language}
                    onClick={() => onPick(video.language)}
                >
                    {t(video.labelKey)}
                </button>
            ))}
        </div>
    );
}
