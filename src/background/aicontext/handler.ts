import type { MessageRouter } from '@/messaging/router';
import {
    analyzeContext,
    deriveAnalyzeContextType,
} from '@/messaging/contracts/analyzeContext';
import type { ContextType } from '@/shared/contextTypes';
import { whenServiceReady } from '../readiness';
import { combineAnalyses, type Analysis, type AnalysisType } from './schemas';
import type { AiContextService, AnalysisOutcome } from './service';

export const ANALYZE_CONTEXT_REJECTED_ERROR = 'Context analysis rejected';

/**
 * One request may name one, two, or all three context types. One type is
 * one provider call; all three is one combined call; two are two calls
 * merged into one document.
 */
async function analyzeRequestedTypes(
    analyze: (type: AnalysisType) => Promise<AnalysisOutcome>,
    types: readonly ContextType[]
): Promise<AnalysisOutcome> {
    if (types.length === 1) {
        return analyze(types[0]!);
    }
    if (deriveAnalyzeContextType(types) === 'all') {
        return analyze('all');
    }
    const byType: Partial<Record<ContextType, Analysis>> = {};
    for (const type of types) {
        const outcome = await analyze(type);
        if (!outcome.success) {
            return outcome;
        }
        byType[type] = outcome.analysis;
    }
    return {
        success: true,
        analysis: combineAnalyses(types, byType),
        cached: false,
    };
}

export function registerAiContextHandler(
    router: MessageRouter,
    service: Pick<AiContextService, 'analyze'>
): void {
    router.handle(analyzeContext, async (request, sender) => {
        if (
            sender.role === 'content' &&
            'platform' in request &&
            request.platform !== sender.platform
        ) {
            return {
                success: false as const,
                error: ANALYZE_CONTEXT_REJECTED_ERROR,
                shouldRetry: false,
            };
        }
        await whenServiceReady('aiContextInitialized');
        const sourceLanguage =
            'language' in request ? request.language : 'auto';
        const outcome = await analyzeRequestedTypes(
            (type) =>
                service.analyze({
                    text: request.text,
                    type,
                    sourceLanguage,
                    targetLanguage: request.targetLanguage,
                }),
            request.contextTypes
        );
        if (!outcome.success) {
            return {
                success: false as const,
                error: outcome.error,
                shouldRetry: outcome.shouldRetry,
            };
        }
        return {
            success: true as const,
            result: {
                analysis: outcome.analysis,
                contextType: deriveAnalyzeContextType(request.contextTypes),
                contextTypes: request.contextTypes,
                isStructured: true as const,
            },
        };
    });
}
