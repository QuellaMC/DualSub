import type { ContextProvider } from '../provider';
import { geminiContextProvider } from './gemini';
import { openaiContextProvider } from './openai';

export const CONTEXT_PROVIDERS: readonly ContextProvider[] = [
    openaiContextProvider,
    geminiContextProvider,
];
