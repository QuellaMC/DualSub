import type { SubtitleLanguage } from '@/shared/subtitleLanguages';

/** One proverb in every subtitle language, for the preview. */
export const SAMPLE_LINES: Record<SubtitleLanguage, string> = {
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
