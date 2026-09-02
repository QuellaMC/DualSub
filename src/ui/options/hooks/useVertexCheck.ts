import { useCallback, useEffect, useRef, useState } from 'react';
import {
    checkVertexConnection,
    type VertexCredentials,
} from '@/background/translation/providers/geminiVertex';
import { mintAccessToken, parseServiceAccountKey } from '@/shared/vertexAuth';
import type { Translate } from '../../hooks/useI18n';
import { errorMessage, type SaveSettings, type TestResult } from '../types';

const EXPIRING_SOON_MS = 5 * 60 * 1000;

function configuredStatus(
    t: Translate,
    expiresAt: number,
    now: number
): TestResult {
    if (expiresAt > 0) {
        if (expiresAt <= now) {
            return {
                tone: 'warning',
                message: t('vertexTokenExpiredReimport'),
            };
        }
        if (expiresAt - now < EXPIRING_SOON_MS) {
            return {
                tone: 'warning',
                message: t(
                    'vertexTokenExpiringReimport',
                    Math.floor((expiresAt - now) / 60_000)
                ),
            };
        }
    }
    return { tone: 'warning', message: t('vertexConfigured') };
}

export interface VertexCheckHandle {
    readonly result: TestResult;
    readonly importResult: TestResult;
    readonly testing: boolean;
    readonly importing: boolean;
    readonly test: () => void;
    /** Mint a token from a service-account key file; the key itself is
     *  used once in memory and never stored. */
    readonly importKeyFile: (file: File) => void;
}

export function useVertexCheck(
    t: Translate,
    credentials: VertexCredentials,
    tokenExpiresAt: number,
    save: SaveSettings
): VertexCheckHandle {
    const [result, setResult] = useState<TestResult>(null);
    const [importResult, setImportResult] = useState<TestResult>(null);
    const [testing, setTesting] = useState(false);
    const [importing, setImporting] = useState(false);
    const generation = useRef(0);
    const { accessToken, projectId } = credentials;

    useEffect(() => {
        generation.current += 1;
        setTesting(false);
        setResult(
            accessToken && projectId
                ? configuredStatus(t, tokenExpiresAt, Date.now())
                : { tone: 'error', message: t('vertexNotConfiguredEphemeral') }
        );
    }, [accessToken, projectId, tokenExpiresAt, t]);

    const runCheck = useCallback(
        (target: VertexCredentials) => {
            if (!target.accessToken || !target.projectId) {
                setResult({ tone: 'error', message: t('vertexMissingConfig') });
                return;
            }
            generation.current += 1;
            const current = generation.current;
            setTesting(true);
            setResult({ tone: 'info', message: t('openaiTestingConnection') });
            void checkVertexConnection(target).then(
                () => {
                    if (current === generation.current) {
                        setTesting(false);
                        setResult({
                            tone: 'success',
                            message: t('openaiConnectionSuccessful'),
                        });
                    }
                },
                (error: unknown) => {
                    if (current === generation.current) {
                        setTesting(false);
                        setResult({
                            tone: 'error',
                            message: t(
                                'vertexConnectionFailed',
                                errorMessage(error)
                            ),
                        });
                    }
                }
            );
        },
        [t]
    );

    const test = useCallback(
        () => runCheck(credentials),
        [credentials, runCheck]
    );

    const importKeyFile = useCallback(
        (file: File) => {
            setImporting(true);
            setImportResult({ tone: 'info', message: t('vertexImporting') });
            void (async () => {
                try {
                    const key = parseServiceAccountKey(await file.text());
                    setImportResult({
                        tone: 'info',
                        message: t('vertexGeneratingToken'),
                    });
                    const minted = await mintAccessToken(key);
                    const saved = await save({
                        vertexProjectId: key.projectId,
                        vertexAccessToken: minted.accessToken,
                        vertexTokenExpiresAt: minted.expiresAt,
                        selectedProvider: 'vertex_gemini',
                    });
                    if (!saved) {
                        throw new Error('Failed to save imported credentials.');
                    }
                    setImportResult({
                        tone: 'success',
                        message: t('vertexImportSuccessEphemeral'),
                    });
                    runCheck({
                        ...credentials,
                        accessToken: minted.accessToken,
                        projectId: key.projectId,
                    });
                } catch (error) {
                    setImportResult({
                        tone: 'error',
                        message: t('vertexImportFailed', errorMessage(error)),
                    });
                } finally {
                    setImporting(false);
                }
            })();
        },
        [credentials, runCheck, save, t]
    );

    return { result, importResult, testing, importing, test, importKeyFile };
}
