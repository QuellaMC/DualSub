import type { Translate } from '../hooks/useI18n';
import type { SectionId } from './sections';

export interface SearchEntry {
    readonly labelKey: string;
    /** Everyday words people type for it, besides its label. */
    readonly wordsKey: string;
    readonly section: SectionId;
    /** The control lives among the advanced options. */
    readonly advanced?: true;
    /** The elements to bring into view, in order of preference: the first
     *  one on the page takes focus, and a folded disclosure there opens. A
     *  setting shown only after a choice names that choice last, so the
     *  search lands where the choice is made. */
    readonly anchors?: readonly string[];
}

const ENTRIES: readonly SearchEntry[] = [
    {
        labelKey: 'languagesSpeakTitle',
        wordsKey: 'searchWordsSpeak',
        section: 'languages',
        anchors: ['target-language'],
    },
    {
        labelKey: 'languagesTopTitle',
        wordsKey: 'searchWordsTopLine',
        section: 'languages',
        anchors: ['top-line'],
    },
    {
        labelKey: 'languagesOfficialTitle',
        wordsKey: 'searchWordsOfficial',
        section: 'languages',
        anchors: ['official-translation'],
    },
    {
        labelKey: 'lookSizeTitle',
        wordsKey: 'searchWordsSize',
        section: 'look',
        anchors: ['text-size'],
    },
    {
        labelKey: 'lookPositionTitle',
        wordsKey: 'searchWordsPosition',
        section: 'look',
        anchors: ['position'],
    },
    {
        labelKey: 'lookStyleTitle',
        wordsKey: 'searchWordsStyle',
        section: 'look',
        anchors: ['style'],
    },
    {
        labelKey: 'lookCustomizeButton',
        wordsKey: 'searchWordsCustomLook',
        section: 'look',
        anchors: ['look-customize', 'look-style-custom'],
    },
    {
        labelKey: 'lookTranslationColorTitle',
        wordsKey: 'searchWordsTranslationColor',
        section: 'look',
        anchors: ['translation-color'],
    },
    {
        labelKey: 'lookOrderTitle',
        wordsKey: 'searchWordsOrder',
        section: 'look',
        anchors: ['layout'],
    },
    {
        labelKey: 'lookArrangementTitle',
        wordsKey: 'searchWordsArrangement',
        section: 'look',
        anchors: ['layout'],
    },
    {
        labelKey: 'lookFineTuneButton',
        wordsKey: 'searchWordsFineTune',
        section: 'look',
        anchors: ['fine-tune'],
    },
    {
        labelKey: 'timingTitle',
        wordsKey: 'searchWordsTiming',
        section: 'timing',
        anchors: ['timing'],
    },
    {
        labelKey: 'translationServiceTitle',
        wordsKey: 'searchWordsService',
        section: 'translation',
        anchors: ['translation-service'],
    },
    {
        labelKey: 'translationDeepLSetupTitle',
        wordsKey: 'searchWordsDeepL',
        section: 'translation',
        anchors: ['deepl-card', 'provider-deepl'],
    },
    {
        labelKey: 'translationAiSetupTitle',
        wordsKey: 'searchWordsAiTranslation',
        section: 'translation',
        anchors: ['ai-translation-card', 'provider-openai_compatible'],
    },
    {
        labelKey: 'translationFallbackTitle',
        wordsKey: 'searchWordsFallback',
        section: 'translation',
        anchors: ['translation-fallback'],
    },
    {
        labelKey: 'translationDelayTitle',
        wordsKey: 'searchWordsDelay',
        section: 'translation',
        advanced: true,
        anchors: ['translation-delay'],
    },
    {
        labelKey: 'explainTitle',
        wordsKey: 'searchWordsExplanations',
        section: 'explanations',
        anchors: ['explanations'],
    },
    {
        labelKey: 'explainPauseTitle',
        wordsKey: 'searchWordsPause',
        section: 'explanations',
        anchors: ['explain-reading'],
    },
    {
        labelKey: 'explainThemeTitle',
        wordsKey: 'searchWordsTheme',
        section: 'explanations',
        anchors: ['explain-reading'],
    },
    {
        labelKey: 'explainLimitsTitle',
        wordsKey: 'searchWordsLimits',
        section: 'explanations',
        advanced: true,
        anchors: ['explain-limits'],
    },
    {
        labelKey: 'setupAddress',
        wordsKey: 'searchWordsAddress',
        section: 'explanations',
        advanced: true,
        anchors: ['explain-address', 'explain-provider-openai'],
    },
    {
        labelKey: 'sitesUseHere',
        wordsKey: 'searchWordsSiteOnOff',
        section: 'sites',
        anchors: ['sites'],
    },
    {
        labelKey: 'sitesHideTitle',
        wordsKey: 'searchWordsHide',
        section: 'sites',
        anchors: ['hide-all'],
    },
    {
        labelKey: 'searchSiteOwn',
        wordsKey: 'searchWordsSiteOwn',
        section: 'sites',
        advanced: true,
        anchors: ['sites'],
    },
    {
        labelKey: 'sitesFiltersTitle',
        wordsKey: 'searchWordsFilters',
        section: 'sites',
        advanced: true,
        anchors: ['filters-disneyplus'],
    },
    {
        labelKey: 'advancedBackupTitle',
        wordsKey: 'searchWordsBackup',
        section: 'advanced',
        advanced: true,
        anchors: ['backup'],
    },
    {
        labelKey: 'advancedJsonTitle',
        wordsKey: 'searchWordsJson',
        section: 'advanced',
        advanced: true,
        anchors: ['json'],
    },
    {
        labelKey: 'advancedLoggingTitle',
        wordsKey: 'searchWordsLogging',
        section: 'advanced',
        advanced: true,
        anchors: ['troubleshooting'],
    },
    {
        labelKey: 'advancedResetTitle',
        wordsKey: 'searchWordsReset',
        section: 'advanced',
        advanced: true,
        anchors: ['reset'],
    },
    {
        labelKey: 'topMenuLanguage',
        wordsKey: 'searchWordsPageLanguage',
        section: 'start',
        anchors: ['ui-language'],
    },
    {
        labelKey: 'helpNoSubtitlesTitle',
        wordsKey: 'searchWordsNoSubtitles',
        section: 'help',
        anchors: ['help-none'],
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
