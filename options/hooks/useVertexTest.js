import { useState, useCallback } from 'react';
import { getAccessTokenFromServiceAccount, checkTokenExpiration as checkExpiration } from '../../utils/vertexAuth.js';

/**
 * Hook for testing Vertex AI and importing service account JSON
 * @param {Function} t - Translation function
 * @param {Function} onAccessTokenChange - Callback when access token changes
 * @param {Function} onProjectIdChange - Callback when project ID changes
 * @param {Function} onProviderChange - Callback to switch provider
 * @returns {Object} Test functions and state
 */
export function useVertexTest(t, onAccessTokenChange, onProjectIdChange, onProviderChange) {
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

    const testConnection = useCallback(async (accessToken, projectId, location, model) => {
        if (!accessToken || !projectId) {
            showTestResult(
                t('vertexMissingConfig', 'Please enter access token and project ID.'),
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
            const normalizedModel = model.startsWith('models/') ? model.split('/').pop() : model;
            const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${normalizedModel}:generateContent`;

            const body = {
                contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                generationConfig: { temperature: 0 },
            };
            const res = await fetch(endpoint, {
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
                t('vertexConnectionFailed', 'Connection failed: %s', error.message),
                'error'
            );
        } finally {
            setTesting(false);
        }
    }, [t, showTestResult]);

    const importServiceAccountJson = useCallback(async (file) => {
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
            } catch (e) {
                throw new Error('Invalid JSON file.');
            }

            const required = ['type', 'project_id', 'private_key', 'client_email'];
            const missing = required.filter((k) => !sa[k] || typeof sa[k] !== 'string' || sa[k].trim() === '');
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
            const { accessToken, expiresIn } = await getAccessTokenFromServiceAccount(sa);

            // Calculate token expiration time
            const expiresAt = Date.now() + (expiresIn * 1000);

            // Store the service account JSON for auto-refresh
            // Security Note: Storing the complete service account (including private_key) in 
            // chrome.storage.local is a security trade-off to enable automatic token refresh.
            // Chrome extension storage is isolated per-extension and encrypted at rest by the OS.
            // Alternative approaches (e.g., storing only the token) would require manual 
            // re-import every hour when tokens expire. Users with high security requirements 
            // should use short-lived tokens and manual refresh instead of storing credentials.
            if (typeof chrome !== 'undefined' && chrome.storage) {
                await chrome.storage.local.set({
                    vertexServiceAccount: sa,
                    vertexTokenExpiresAt: expiresAt,
                });
            }

            // Update settings via callbacks
            await onProjectIdChange(sa.project_id);
            await onAccessTokenChange(accessToken);

            showImportResult(
                '✅ ' + t('vertexImportSuccess', 'Service account imported and token generated.'),
                'success'
            );

            // Switch provider to Vertex
            if (onProviderChange) {
                await onProviderChange('vertex_gemini');
            }

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
    }, [t, showImportResult, onAccessTokenChange, onProjectIdChange, onProviderChange]);

    const refreshToken = useCallback(async (silent = false) => {
        if (!silent) {
            setImporting(true);
            showImportResult(
                t('vertexRefreshingToken', 'Refreshing access token...'),
                'info'
            );
        }

        try {
            // Retrieve stored service account
            if (typeof chrome === 'undefined' || !chrome.storage) {
                throw new Error('Chrome storage not available');
            }

            const result = await chrome.storage.local.get(['vertexServiceAccount']);
            const sa = result.vertexServiceAccount;

            if (!sa) {
                throw new Error('No stored service account found. Please import the JSON file again.');
            }

            // Generate new token
            const { accessToken, expiresIn } = await getAccessTokenFromServiceAccount(sa);

            // Calculate new expiration time
            const expiresAt = Date.now() + (expiresIn * 1000);

            // Update expiration time in storage
            await chrome.storage.local.set({
                vertexTokenExpiresAt: expiresAt,
            });

            // Update settings via callback
            await onAccessTokenChange(accessToken);

            if (!silent) {
                showImportResult(
                    '✅ ' + t('vertexTokenRefreshed', 'Access token refreshed successfully.'),
                    'success'
                );
            } else {
                console.log('[Vertex AI] Access token auto-refreshed successfully');
            }

            return { accessToken, expiresAt };
        } catch (error) {
            if (!silent) {
                showImportResult(
                    t('vertexRefreshFailed', 'Token refresh failed: %s', error.message),
                    'error'
                );
            } else {
                console.error('[Vertex AI] Auto-refresh failed:', error);
            }
            throw error;
        } finally {
            if (!silent) {
                setImporting(false);
            }
        }
    }, [t, showImportResult, onAccessTokenChange]);

    const checkTokenExpiration = useCallback(async () => {
        return await checkExpiration();
    }, []);

    const initializeStatus = useCallback(async (accessToken, projectId) => {
        if (accessToken && projectId) {
            // Check if token is about to expire
            const expirationInfo = await checkTokenExpiration();
            
            if (expirationInfo) {
                if (expirationInfo.isExpired) {
                    showTestResult(
                        t('vertexTokenExpired', '⚠️ Access token expired. Click refresh to renew.'),
                        'warning'
                    );
                } else if (expirationInfo.shouldRefresh) {
                    showTestResult(
                        t('vertexTokenExpiringSoon', `⚠️ Token expires in ${expirationInfo.expiresInMinutes} minutes. Consider refreshing.`),
                        'warning'
                    );
                } else {
                    showTestResult(
                        t('vertexConfigured', '⚠️ Vertex AI configured. Please test connection.'),
                        'warning'
                    );
                }
            } else {
                showTestResult(
                    t('vertexConfigured', '⚠️ Vertex AI configured. Please test connection.'),
                    'warning'
                );
            }
        } else {
            showTestResult(
                t('vertexNotConfigured', 'Please import service account JSON or enter credentials.'),
                'error'
            );
        }
    }, [t, showTestResult, checkTokenExpiration]);

    return {
        testResult,
        importResult,
        testing,
        importing,
        testConnection,
        importServiceAccountJson,
        refreshToken,
        checkTokenExpiration,
        initializeStatus,
        showTestResult,
        showImportResult,
    };
}

