import { useState, useCallback } from 'react';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';
import {
    getAccessTokenFromServiceAccount,
    checkTokenExpiration as checkExpiration,
} from '../../utils/vertexAuth.js';

/**
 * Hook for testing Vertex AI and importing service account JSON
 * @param {Function} t - Translation function
 * @param {Function} onAccessTokenChange - Callback when access token changes
 * @param {Function} onProjectIdChange - Callback when project ID changes
 * @param {Function} onProviderChange - Callback to switch provider
 * @param {Function} onCredentialsChange - Grouped callback for imported credentials
 * @returns {Object} Test functions and state
 */
export function useVertexTest(
    t,
    onAccessTokenChange,
    onProjectIdChange,
    onProviderChange,
    onCredentialsChange
) {
    const [testResult, setTestResult] = useState({
        visible: false,
        message: '',
        type: 'info',
    });
    const [importResult, setImportResult] = useState({
        visible: false,
        message: '',
        type: 'info',
    });
    const [testing, setTesting] = useState(false);
    const [importing, setImporting] = useState(false);

    const showTestResult = useCallback((message, type) => {
        setTestResult({
            visible: true,
            message,
            type,
        });
    }, []);

    const showImportResult = useCallback((message, type) => {
        setImportResult({
            visible: true,
            message,
            type,
        });
    }, []);

    const clearLegacyServiceAccount = useCallback(async () => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local?.remove) {
            await chrome.storage.local.remove('vertexServiceAccount');
        }
    }, []);

    const updateManualAccessToken = useCallback(
        async (accessToken) => {
            try {
                const saved = await onAccessTokenChange(accessToken);
                if (saved === false) {
                    throw new Error('Failed to save the access token.');
                }
                if (
                    typeof chrome !== 'undefined' &&
                    chrome.storage?.local?.remove
                ) {
                    await chrome.storage.local.remove('vertexTokenExpiresAt');
                }
                return true;
            } catch (error) {
                showTestResult(
                    t(
                        'vertexManualTokenSaveFailed',
                        'Could not save the access token: %s',
                        error.message
                    ),
                    'error'
                );
                return false;
            }
        },
        [onAccessTokenChange, showTestResult, t]
    );

    const testConnection = useCallback(
        async (accessToken, projectId, location, model) => {
            if (!accessToken || !projectId) {
                showTestResult(
                    t(
                        'vertexMissingConfig',
                        'Please enter access token and project ID.'
                    ),
                    'error'
                );
                return;
            }

            setTesting(true);
            showTestResult(
                t('openaiTestingConnection', 'Testing connection...'),
                'info'
            );

            try {
                const normalizedModel = model.startsWith('models/')
                    ? model.split('/').pop()
                    : model;
                const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${normalizedModel}:generateContent`;

                const body = {
                    contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                    generationConfig: { temperature: 0 },
                };
                const res = await fetchWithTimeout(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify(body),
                });

                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`${res.status} ${res.statusText}: ${text}`);
                }

                showTestResult(
                    t('openaiConnectionSuccessful', 'Connection successful!'),
                    'success'
                );
            } catch (error) {
                showTestResult(
                    t(
                        'vertexConnectionFailed',
                        'Connection failed: %s',
                        error.message
                    ),
                    'error'
                );
            } finally {
                setTesting(false);
            }
        },
        [t, showTestResult]
    );

    const importServiceAccountJson = useCallback(
        async (file) => {
            if (!file) return;

            setImporting(true);
            showImportResult(
                t('vertexImporting', 'Importing service account...'),
                'info'
            );

            try {
                const text = await file.text();
                let sa;
                try {
                    sa = JSON.parse(text);
                } catch {
                    throw new Error('Invalid JSON file.');
                }

                const required = [
                    'type',
                    'project_id',
                    'private_key',
                    'client_email',
                ];
                const missing = required.filter(
                    (k) =>
                        !sa[k] ||
                        typeof sa[k] !== 'string' ||
                        sa[k].trim() === ''
                );
                if (missing.length > 0) {
                    throw new Error(`Missing fields: ${missing.join(', ')}`);
                }
                if (sa.type !== 'service_account') {
                    throw new Error('JSON is not a service account key.');
                }

                showImportResult(
                    t('vertexGeneratingToken', 'Generating access token...'),
                    'info'
                );
                const { accessToken, expiresIn } =
                    await getAccessTokenFromServiceAccount(sa);

                // Calculate token expiration time
                const expiresAt = Date.now() + expiresIn * 1000;

                // The imported service-account key is used once in memory and is
                // deliberately never persisted.
                if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    await clearLegacyServiceAccount();
                }

                const credentialsSaved = onCredentialsChange
                    ? await onCredentialsChange({
                          vertexProjectId: sa.project_id,
                          vertexAccessToken: accessToken,
                      })
                    : (await onProjectIdChange(sa.project_id)) !== false &&
                      (await onAccessTokenChange(accessToken)) !== false;
                if (credentialsSaved === false) {
                    throw new Error('Failed to save imported credentials.');
                }

                // Associate expiry metadata only after the corresponding token
                // has been persisted successfully.
                if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    await chrome.storage.local.set({
                        vertexTokenExpiresAt: expiresAt,
                    });
                }

                // Switch provider to Vertex
                if (onProviderChange) {
                    const providerSaved =
                        await onProviderChange('vertex_gemini');
                    if (providerSaved === false) {
                        throw new Error(
                            'Failed to select the Vertex provider.'
                        );
                    }
                }

                showImportResult(
                    '✅ ' +
                        t(
                            'vertexImportSuccessEphemeral',
                            'Access token generated. The service-account key was not stored; re-import the JSON when the token expires.'
                        ),
                    'success'
                );

                return { projectId: sa.project_id, accessToken, expiresAt };
            } catch (error) {
                showImportResult(
                    t('vertexImportFailed', 'Import failed: %s', error.message),
                    'error'
                );
                throw error;
            } finally {
                setImporting(false);
            }
        },
        [
            t,
            showImportResult,
            onAccessTokenChange,
            onProjectIdChange,
            onProviderChange,
            onCredentialsChange,
            clearLegacyServiceAccount,
        ]
    );

    const checkTokenExpiration = useCallback(async () => {
        return await checkExpiration();
    }, []);

    const initializeStatus = useCallback(
        async (accessToken, projectId) => {
            try {
                await clearLegacyServiceAccount();
            } catch (error) {
                console.error(
                    '[Vertex AI] Failed to remove a legacy stored service account:',
                    error
                );
            }

            if (accessToken && projectId) {
                const expirationInfo = await checkTokenExpiration();

                if (expirationInfo) {
                    if (expirationInfo.isExpired) {
                        showTestResult(
                            t(
                                'vertexTokenExpiredReimport',
                                '⚠️ Access token expired. Re-import the service account JSON or paste a new access token.'
                            ),
                            'warning'
                        );
                    } else if (expirationInfo.isExpiringSoon) {
                        showTestResult(
                            t(
                                'vertexTokenExpiringReimport',
                                '⚠️ Token expires in %s minutes. Re-import the service account JSON or prepare a replacement access token.',
                                expirationInfo.expiresInMinutes
                            ),
                            'warning'
                        );
                    } else {
                        showTestResult(
                            t(
                                'vertexConfigured',
                                '⚠️ Vertex AI configured. Please test connection.'
                            ),
                            'warning'
                        );
                    }
                } else {
                    showTestResult(
                        t(
                            'vertexConfigured',
                            '⚠️ Vertex AI configured. Please test connection.'
                        ),
                        'warning'
                    );
                }
            } else {
                showTestResult(
                    t(
                        'vertexNotConfiguredEphemeral',
                        'Import a service account JSON once to generate a short-lived token, or paste a token manually.'
                    ),
                    'error'
                );
            }
        },
        [t, showTestResult, checkTokenExpiration, clearLegacyServiceAccount]
    );

    return {
        testResult,
        importResult,
        testing,
        importing,
        testConnection,
        importServiceAccountJson,
        checkTokenExpiration,
        initializeStatus,
        updateManualAccessToken,
        showTestResult,
        showImportResult,
    };
}
