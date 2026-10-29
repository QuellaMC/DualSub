import type { ContextType } from '@/shared/contextTypes';

export const SYSTEM_PROMPT =
    'You explain words from film and TV subtitles to language learners. Be accurate, brief and concrete, and write for someone who may know no grammar terms.';

const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    ja: 'Japanese',
    ko: 'Korean',
    'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)',
    ar: 'Arabic',
    hi: 'Hindi',
    th: 'Thai',
    vi: 'Vietnamese',
    nl: 'Dutch',
    sv: 'Swedish',
    da: 'Danish',
    no: 'Norwegian',
    fi: 'Finnish',
    pl: 'Polish',
    cs: 'Czech',
    hu: 'Hungarian',
    tr: 'Turkish',
    he: 'Hebrew',
};

export function languageName(code: string): string {
    return LANGUAGE_NAMES[code] ?? (code === 'auto' ? 'Unknown' : code);
}

export interface AnswerPromptInput {
    readonly text: string;
    readonly line: string;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
    readonly kinds: readonly ContextType[];
}

/** What each kind of explanation asks the model to fill in. */
function kindInstructions(kind: ContextType, target: string): string[] {
    switch (kind) {
        case 'linguistic':
            return [
                `- "examples": two short sentences in the language of the line that use the words, each as "text" (the sentence) and "translation" (in ${target}).`,
                '- "similar": up to four words or sayings in the language of the line that mean much the same, without explanations.',
                '- "tip": one practical tip for using the words correctly.',
            ];
        case 'cultural':
            return [
                '- "culture": who uses the words and where, and anything a learner should know about how they come across.',
            ];
        case 'historical':
            return [
                '- "history": where the words come from and how their meaning developed.',
            ];
    }
}

/** The user turn: the words, the line they appear in, and what to answer. */
export function createAnswerPrompt(input: AnswerPromptInput): string {
    const target = languageName(input.targetLanguage);
    const source =
        input.sourceLanguage === 'auto'
            ? 'unknown; tell it from the line'
            : languageName(input.sourceLanguage);
    return [
        'Explain these words from a subtitle line.',
        '',
        `Words: "${input.text}"`,
        `The line they appear in: "${input.line}"`,
        `Language of the line: ${source}`,
        `Write everything except example sentences in ${target} (${input.targetLanguage}).`,
        '',
        'Fill in this JSON:',
        '- "meaning": what the words mean in this line, in one to three sentences.',
        '- "register": how the words sound to people who speak the language: "everyday", "casual", "formal", "slang" or "offensive".',
        ...input.kinds.flatMap((kind) => kindInstructions(kind, target)),
        '',
        'Respond only with the JSON.',
    ].join('\n');
}
