import { useCallback, useEffect, useRef, useState } from 'react';
import {
    checkDeepLConnection,
    type DeepLCheck,
} from '@/background/translation/providers/deepl';
import type { Translate } from '../../hooks/useI18n';
import { errorMessage, type TestResult } from '../types';

function describeFailure(
    t: Translate,
    check: Extract<DeepLCheck, { ok: false }>
): TestResult {
    switch (check.reason) {
        case 'invalid-key':
            return { tone: 'error', message: t('deeplTestInvalidKey') };
        case 'quota':
            return { tone: 'error', message: t('deeplTestQuotaExceeded') };
        case 'network':
            return { tone: 'error', message: t('deeplTestNetworkError') };
        case 'malformed':
            return { tone: 'warning', message: t('deeplTestUnexpectedFormat') };
        case 'http':
            return {
                tone: 'error',
                message: t(
                    'deeplTestApiError',
                    check.status ?? 0,
                    `HTTP ${check.status ?? '?'}`
                ),
            };
    }
}

/** Status line and one-click connection check for the DeepL card. */
export function useDeepLCheck(
    t: Translate,
    apiKey: string,
    plan: 'free' | 'pro'
): {
    readonly result: TestResult;
    readonly testing: boolean;
    readonly run: () => void;
} {
    const [result, setResult] = useState<TestResult>(null);
    const [testing, setTesting] = useState(false);
    const generation = useRef(0);

    useEffect(() => {
        generation.current += 1;
        setTesting(false);
        setResult(
            apiKey
                ? { tone: 'warning', message: t('deeplTestNeedsTesting') }
                : { tone: 'error', message: t('deeplApiKeyError') }
        );
    }, [apiKey, t]);

    const run = useCallback(() => {
        if (!apiKey) {
            setResult({ tone: 'error', message: t('deeplApiKeyError') });
            return;
        }
        generation.current += 1;
        const current = generation.current;
        setTesting(true);
        setResult({ tone: 'info', message: t('testingConnection') });
        void checkDeepLConnection({ apiKey, plan })
            .then((check) =>
                check.ok
                    ? {
                          tone: 'success' as const,
                          message: t('deeplTestSuccessSimple'),
                      }
                    : describeFailure(t, check)
            )
            .catch((error: unknown) => ({
                tone: 'error' as const,
                message: t('deeplTestGenericError', errorMessage(error)),
            }))
            .then((next) => {
                if (current === generation.current) {
                    setResult(next);
                    setTesting(false);
                }
            });
    }, [apiKey, plan, t]);

    return { result, testing, run };
}
