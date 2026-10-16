import type { Translate } from '../hooks/useI18n';
import type { SectionId } from './sections';

export interface SearchEntry {
    readonly labelKey: string;
    /** Everyday words people type for it, besides its label. */
    readonly wordsKey: string;
    readonly section: SectionId;
    /** The control lives among the advanced options. */
    readonly advanced?: true;
    /** The element to bring into view. */
    readonly anchor?: string;
}

const ENTRIES: readonly SearchEntry[] = [
    {
        labelKey: 'languagesSpeakTitle',
        wordsKey: 'searchWordsSpeak',
        section: 'languages',
        anchor: 'target-language',
    },
    {
        labelKey: 'languagesTopTitle',
        wordsKey: 'searchWordsTopLine',
        section: 'languages',
        anchor: 'top-line',
    },
    {
        labelKey: 'languagesOfficialTitle',
        wordsKey: 'searchWordsOfficial',
        section: 'languages',
        anchor: 'official-translation',
    },
    {
        labelKey: 'lookSizeTitle',
        wordsKey: 'searchWordsSize',
        section: 'look',
        anchor: 'text-size',
    },
    {
        labelKey: 'lookPositionTitle',
        wordsKey: 'searchWordsPosition',
        section: 'look',
        anchor: 'position',
    },
    {
        labelKey: 'lookStyleTitle',
        wordsKey: 'searchWordsStyle',
        section: 'look',
        anchor: 'style',
    },
    {
        labelKey: 'lookCustomizeButton',
        wordsKey: 'searchWordsCustomLook',
        section: 'look',
        anchor: 'style',
    },
    {
        labelKey: 'lookTranslationColorTitle',
        wordsKey: 'searchWordsTranslationColor',
        section: 'look',
        anchor: 'translation-color',
    },
    {
        labelKey: 'lookOrderTitle',
        wordsKey: 'searchWordsOrder',
        section: 'look',
        anchor: 'layout',
    },
    {
        labelKey: 'lookArrangementTitle',
        wordsKey: 'searchWordsArrangement',
        section: 'look',
        anchor: 'layout',
    },
    {
        labelKey: 'lookFineTuneButton',
        wordsKey: 'searchWordsFineTune',
        section: 'look',
        anchor: 'fine-tune',
    },
    {
        labelKey: 'timingTitle',
        wordsKey: 'searchWordsTiming',
        section: 'timing',
        anchor: 'timing',
    },
    {
        labelKey: 'translationServiceTitle',
        wordsKey: 'searchWordsService',
        section: 'translation',
        anchor: 'translation-service',
    },
    {
        labelKey: 'translationDeepLSetupTitle',
        wordsKey: 'searchWordsDeepL',
        section: 'translation',
        anchor: 'translation-service',
    },
    {
        labelKey: 'translationAiSetupTitle',
        wordsKey: 'searchWordsAiTranslation',
        section: 'translation',
        anchor: 'translation-service',
    },
    {
        labelKey: 'translationFallbackTitle',
        wordsKey: 'searchWordsFallback',
        section: 'translation',
        anchor: 'translation-fallback',
    },
    {
        labelKey: 'translationDelayTitle',
        wordsKey: 'searchWordsDelay',
        section: 'translation',
        advanced: true,
        anchor: 'translation-delay',
    },
    {
        labelKey: 'explainTitle',
        wordsKey: 'searchWordsExplanations',
        section: 'explanations',
        anchor: 'explanations',
    },
    {
        labelKey: 'explainPauseTitle',
        wordsKey: 'searchWordsPause',
        section: 'explanations',
        anchor: 'explain-reading',
    },
    {
        labelKey: 'explainThemeTitle',
        wordsKey: 'searchWordsTheme',
        section: 'explanations',
        anchor: 'explain-reading',
    },
    {
        labelKey: 'explainLimitsTitle',
        wordsKey: 'searchWordsLimits',
        section: 'explanations',
        advanced: true,
        anchor: 'explain-limits',
    },
    {
        labelKey: 'sitesUseHere',
        wordsKey: 'searchWordsSiteOnOff',
        section: 'sites',
        anchor: 'sites',
    },
    {
        labelKey: 'sitesHideTitle',
        wordsKey: 'searchWordsHide',
        section: 'sites',
        anchor: 'hide-all',
    },
    {
        labelKey: 'searchSiteOwn',
        wordsKey: 'searchWordsSiteOwn',
        section: 'sites',
        advanced: true,
        anchor: 'sites',
    },
    {
        labelKey: 'sitesFiltersTitle',
        wordsKey: 'searchWordsFilters',
        section: 'sites',
        advanced: true,
        anchor: 'filters-disneyplus',
    },
    {
        labelKey: 'advancedBackupTitle',
        wordsKey: 'searchWordsBackup',
        section: 'advanced',
        advanced: true,
        anchor: 'backup',
    },
    {
        labelKey: 'advancedJsonTitle',
        wordsKey: 'searchWordsJson',
        section: 'advanced',
        advanced: true,
        anchor: 'json',
    },
    {
        labelKey: 'advancedLoggingTitle',
        wordsKey: 'searchWordsLogging',
        section: 'advanced',
        advanced: true,
        anchor: 'troubleshooting',
    },
    {
        labelKey: 'advancedResetTitle',
        wordsKey: 'searchWordsReset',
        section: 'advanced',
        advanced: true,
        anchor: 'reset',
    },
    {
        labelKey: 'topMenuLanguage',
        wordsKey: 'searchWordsPageLanguage',
        section: 'start',
    },
    {
        labelKey: 'helpNoSubtitlesTitle',
        wordsKey: 'searchWordsNoSubtitles',
        section: 'help',
        anchor: 'help-none',
    },
];

/** Whether `word` starts one of the words of `text`. Chinese and Japanese
 *  run words together, so for them only the start of a phrase counts. */
function startsAWord(text: string, word: string): boolean {
    return text
        .split(/[^\p{L}\p{N}]+/u)
        .some((candidate) => candidate.startsWith(word));
}

/** Settings whose label or everyday words contain every word typed. Those
 *  where more typed words start a word come first, so a short word such as
 *  the Spanish "ia" finds the AI settings before every word that holds it. */
export function searchSettings(query: string, t: Translate): SearchEntry[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return [];
    }
    return ENTRIES.flatMap((entry) => {
        const text = `${t(entry.labelKey)} ${t(entry.wordsKey)}`.toLowerCase();
        return words.every((word) => text.includes(word))
            ? [
                  {
                      entry,
                      starts: words.filter((word) => startsAWord(text, word))
                          .length,
                  },
              ]
            : [];
    })
        .sort((left, right) => right.starts - left.starts)
        .map(({ entry }) => entry)
        .slice(0, 8);
}
