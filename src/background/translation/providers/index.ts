import type { TranslationProvider } from '../provider';
import { deeplProvider } from './deepl';
import { geminiVertexProvider } from './geminiVertex';
import { googleProvider } from './google';
import { microsoftEdgeAuthProvider } from './microsoftEdgeAuth';
import { openaiCompatibleProvider } from './openaiCompatible';

export const TRANSLATION_PROVIDERS: readonly TranslationProvider[] = [
    googleProvider,
    microsoftEdgeAuthProvider,
    deeplProvider,
    openaiCompatibleProvider,
    geminiVertexProvider,
];
