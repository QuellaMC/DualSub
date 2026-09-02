import type { TranslationProvider } from '../provider';
import { deeplProvider } from './deepl';
import { geminiVertexProvider } from './geminiVertex';
import { googleProvider } from './google';
import { microsoftEdgeProvider } from './microsoftEdge';
import { openaiCompatibleProvider } from './openaiCompatible';

export const TRANSLATION_PROVIDERS: readonly TranslationProvider[] = [
    googleProvider,
    microsoftEdgeProvider,
    deeplProvider,
    openaiCompatibleProvider,
    geminiVertexProvider,
];
