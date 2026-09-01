import { createLogger } from '@/shared/logger';
import type { MessageRouter } from '@/messaging/router';
import {
    MAX_TRANSLATION_RETRY_AFTER_MS,
    translate,
    type TranslateResponse,
} from '@/messaging/contracts/translate';
import { whenServiceReady } from '../readiness';
import { TranslationProviderError } from './providerError';
import { RateLimitExhaustedError } from './rateLimiter';
import {
    TranslationConfigurationChangedError,
    type TranslationService,
} from './service';

const logger = createLogger('TranslationHandler');

const REJECTED: TranslateResponse = {
    success: false,
    retryable: false,
    retryAfter: null,
};

function toRetryAfter(resetAt: number | null, now: number): number | null {
    if (resetAt === null || !Number.isFinite(resetAt)) {
        return null;
    }
    const retryAfter = Math.ceil(resetAt - now);
    return retryAfter >= 0 && retryAfter <= MAX_TRANSLATION_RETRY_AFTER_MS
        ? retryAfter
        : null;
}

/** The failure envelope's retry hints, derived from the error class only. */
export function describeTranslationFailure(
    error: unknown,
    now: number
): { retryable: boolean; retryAfter: number | null } {
    if (error instanceof RateLimitExhaustedError) {
        return {
            retryable: true,
            retryAfter: toRetryAfter(error.resetAt, now),
        };
    }
    if (error instanceof TranslationProviderError) {
        return { retryable: error.retryable, retryAfter: null };
    }
    if (error instanceof TranslationConfigurationChangedError) {
        return { retryable: true, retryAfter: null };
    }
    return { retryable: false, retryAfter: null };
}

function failureLabel(error: unknown): string {
    if (error instanceof TranslationProviderError) {
        return error.code;
    }
    return error instanceof Error ? error.name : 'unknown';
}

export function registerTranslationHandler(
    router: MessageRouter,
    service: Pick<TranslationService, 'translate'>
): void {
    router.handle(
        translate,
        async (request, sender): Promise<TranslateResponse> => {
            if (sender.role !== 'content') {
                return REJECTED;
            }
            await whenServiceReady('translation');
            const startedAt = Date.now();
            try {
                const outcome = await service.translate(
                    request.text,
                    'auto',
                    request.targetLang
                );
                return {
                    success: true,
                    translatedText: outcome.translatedText,
                    cached: outcome.cached,
                    processingTime: Math.max(0, Date.now() - startedAt),
                };
            } catch (error) {
                const failure = describeTranslationFailure(error, Date.now());
                logger.warn('Translation failed', {
                    targetLang: request.targetLang,
                    textLength: request.text.length,
                    reason: failureLabel(error),
                    ...failure,
                });
                return { success: false, ...failure };
            }
        }
    );
}
