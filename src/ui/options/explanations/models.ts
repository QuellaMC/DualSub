/** The models offered for AI explanations, the recommended one first. */
interface ModelChoice {
    readonly id: string;
    readonly name: string;
}

export const OPENAI_MODELS: readonly ModelChoice[] = [
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6', name: 'GPT-5.6' },
];

export const GEMINI_MODELS: readonly ModelChoice[] = [
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
];
