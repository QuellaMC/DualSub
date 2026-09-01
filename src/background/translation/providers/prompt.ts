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
    zh: 'Chinese',
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
    tr: 'Turkish',
    he: 'Hebrew',
    auto: 'the auto-detected language',
};

export function languageName(code: string): string {
    return LANGUAGE_NAMES[code] ?? code;
}

/** The one instruction both LLM-backed providers send. */
export function translationInstruction(
    sourceLang: string,
    targetLang: string
): string {
    return (
        'You are a professional translator. ' +
        `Translate the given text accurately from ${languageName(sourceLang)} to ${languageName(targetLang)}. ` +
        'Only return the translated text without any additional comments, explanations, or formatting.'
    );
}
