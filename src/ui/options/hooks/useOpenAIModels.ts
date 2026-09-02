import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAvailableModels } from '@/background/translation/providers/openaiCompatible';
import {
    hasHostPermission,
    requestHostPermission,
} from '@/shared/hostPermissions';
import type { Translate } from '../../hooks/useI18n';
import { errorMessage, type TestResult } from '../types';

/** The API key is saved per keystroke; wait for typing to settle. */
const MODEL_FETCH_DEBOUNCE_MS = 1000;

export interface OpenAIModelsHandle {
    readonly models: readonly string[];
    readonly result: TestResult;
    readonly busy: 'idle' | 'fetching' | 'testing';
    /** Grant the endpoint's host permission (must run inside a user
     *  gesture) and list its models. */
    readonly test: () => void;
}

/**
 * Model catalog and connection status for an OpenAI-compatible endpoint.
 * The catalog belongs to one (key, base URL) identity: any change clears it
 * and, once the host is already permitted, refetches after a pause. Only the
 * newest request may publish.
 */
export function useOpenAIModels(
    t: Translate,
    apiKey: string,
    baseUrl: string
): OpenAIModelsHandle {
    const [models, setModels] = useState<readonly string[]>([]);
    const [result, setResult] = useState<TestResult>(null);
    const [busy, setBusy] = useState<'idle' | 'fetching' | 'testing'>('idle');
    const generation = useRef(0);

    const publish = useCallback(
        (
            current: number,
            next: { models?: readonly string[]; result: TestResult }
        ) => {
            if (current !== generation.current) {
                return;
            }
            if (next.models) {
                setModels(next.models);
            }
            setResult(next.result);
            setBusy('idle');
        },
        []
    );

    useEffect(() => {
        generation.current += 1;
        const current = generation.current;
        setModels([]);
        setBusy('idle');
        if (!apiKey.trim()) {
            setResult({ tone: 'error', message: t('openaiApiKeyError') });
            return;
        }
        setResult({ tone: 'warning', message: t('openaiTestNeedsTesting') });
        const timer = setTimeout(() => {
            void (async () => {
                let permitted = false;
                try {
                    permitted = await hasHostPermission(baseUrl);
                } catch {
                    permitted = false;
                }
                if (current !== generation.current) {
                    return;
                }
                if (!permitted) {
                    publish(current, {
                        result: {
                            tone: 'warning',
                            message: t('openaiEndpointPermissionRequired'),
                        },
                    });
                    return;
                }
                setBusy('fetching');
                setResult({
                    tone: 'info',
                    message: t('openaieFetchingModels'),
                });
                try {
                    const fetched = await fetchAvailableModels(apiKey, baseUrl);
                    publish(current, {
                        models: fetched,
                        result: {
                            tone: 'success',
                            message: t('openaiModelsFetchedSuccessfully'),
                        },
                    });
                } catch (error) {
                    publish(current, {
                        result: {
                            tone: 'error',
                            message: t(
                                'openaiFailedToFetchModels',
                                errorMessage(error)
                            ),
                        },
                    });
                }
            })();
        }, MODEL_FETCH_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [apiKey, baseUrl, publish, t]);

    const test = useCallback(() => {
        if (!apiKey.trim()) {
            setResult({ tone: 'error', message: t('openaiApiKeyError') });
            return;
        }
        generation.current += 1;
        const current = generation.current;
        setBusy('testing');
        setResult({ tone: 'info', message: t('openaiTestingConnection') });
        // The permission prompt must open inside this click: no await first.
        let permission: Promise<boolean>;
        try {
            permission = requestHostPermission(baseUrl);
        } catch (error) {
            publish(current, {
                result: {
                    tone: 'error',
                    message: t('openaiConnectionFailed', errorMessage(error)),
                },
            });
            return;
        }
        void permission
            .then(async (granted) => {
                if (!granted) {
                    throw new Error(t('openaiHostPermissionDenied'));
                }
                return fetchAvailableModels(apiKey, baseUrl);
            })
            .then(
                (fetched) =>
                    publish(current, {
                        models: fetched,
                        result: {
                            tone: 'success',
                            message: t('openaiConnectionSuccessful'),
                        },
                    }),
                (error: unknown) =>
                    publish(current, {
                        result: {
                            tone: 'error',
                            message: t(
                                'openaiConnectionFailed',
                                errorMessage(error)
                            ),
                        },
                    })
            );
    }, [apiKey, baseUrl, publish, t]);

    return { models, result, busy, test };
}
