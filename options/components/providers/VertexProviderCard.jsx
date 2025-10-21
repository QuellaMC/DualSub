import React, { useEffect, useRef } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { SparkleButton } from '../SparkleButton.jsx';
import { AppleStyleFileButton } from '../AppleStyleFileButton.jsx';
import { TestResultDisplay } from '../TestResultDisplay.jsx';
import { useVertexTest } from '../../hooks/useVertexTest.js';

export function VertexProviderCard({
    t,
    accessToken,
    projectId,
    location,
    model,
    onAccessTokenChange,
    onProjectIdChange,
    onLocationChange,
    onModelChange,
    onProviderChange,
}) {
    const fileInputRef = useRef(null);
    const { 
        testResult, 
        importResult, 
        testing, 
        importing,
        testConnection, 
        importServiceAccountJson,
        refreshToken,
        checkTokenExpiration,
        initializeStatus 
    } = useVertexTest(t, onAccessTokenChange, onProjectIdChange, onProviderChange);

    // Initialize status and setup auto-refresh on mount
    useEffect(() => {
        const checkAndRefreshToken = async () => {
            const expirationInfo = await checkTokenExpiration();
            
            if (expirationInfo) {
                // Auto-refresh if token is expired or will expire in less than 5 minutes
                if (expirationInfo.isExpired || expirationInfo.shouldRefresh) {
                    try {
                        // Silent refresh - don't show UI notifications
                        await refreshToken(true);
                        console.log('[Vertex AI] Token auto-refreshed');
                    } catch (error) {
                        // Error already handled in hook
                        console.error('[Vertex AI] Auto-refresh failed:', error);
                    }
                }
            }
        };

        // Initial check
        initializeStatus(accessToken, projectId);
        checkAndRefreshToken();

        // Setup periodic check every 5 minutes
        const interval = setInterval(() => {
            checkAndRefreshToken();
        }, 5 * 60 * 1000); // Check every 5 minutes

        return () => clearInterval(interval);
    }, [accessToken, projectId, initializeStatus, checkTokenExpiration, refreshToken]);

    const handleTest = () => {
        const loc = location || 'us-central1';
        const mdl = model || 'gemini-2.5-flash';
        testConnection(accessToken, projectId, loc, mdl);
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                await importServiceAccountJson(file);
                // Auto-test connection after successful import
                setTimeout(() => {
                    const loc = location || 'us-central1';
                    const mdl = model || 'gemini-2.5-flash';
                    testConnection(accessToken, projectId, loc, mdl);
                }, 300);
            } catch (error) {
                // Error already handled in hook
            }
            // Clear file input so same file can be re-selected
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleRefreshToken = async () => {
        try {
            await refreshToken();
        } catch (error) {
            // Error already handled in hook
        }
    };

    return (
        <SettingCard
            title={t('cardVertexGeminiTitle', 'Vertex AI Gemini (API Key Required)')}
            description={t(
                'cardVertexGeminiDesc',
                'Enter your access token and Vertex project settings, or import a service account JSON file.'
            )}
        >
            {/* Hidden file input for service account JSON */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                aria-label="Upload service account JSON"
            />

            {/* Service Account Import Section */}
            <div className="setting">
                <label>{t('vertexServiceAccountLabel', 'Service Account JSON:')}</label>
                <AppleStyleFileButton
                    onClick={handleImportClick}
                    disabled={importing}
                    loading={importing}
                    className="vertex-import-btn"
                >
                    {importing
                        ? t('vertexImporting', 'Importing...')
                        : t('vertexImportButton', 'Import JSON File')
                    }
                </AppleStyleFileButton>
                <TestResultDisplay result={importResult} />
            </div>

            {/* Manual Configuration */}
            <div className="setting">
                <label htmlFor="vertexAccessToken">
                    {t('vertexAccessTokenLabel', 'Access Token:')}
                </label>
                <input
                    type="password"
                    id="vertexAccessToken"
                    placeholder="ya29...."
                    value={accessToken}
                    onChange={(e) => onAccessTokenChange(e.target.value)}
                />
            </div>

            <div className="setting">
                <label htmlFor="vertexProjectId">
                    {t('vertexProjectIdLabel', 'Project ID:')}
                </label>
                <input
                    type="text"
                    id="vertexProjectId"
                    placeholder="your-gcp-project-id"
                    value={projectId}
                    onChange={(e) => onProjectIdChange(e.target.value)}
                />
            </div>

            <div className="setting">
                <label htmlFor="vertexLocation">
                    {t('vertexLocationLabel', 'Location:')}
                </label>
                <input
                    type="text"
                    id="vertexLocation"
                    placeholder="us-central1"
                    value={location}
                    onChange={(e) => onLocationChange(e.target.value)}
                />
            </div>

            <div className="setting">
                <label htmlFor="vertexModel">
                    {t('vertexModelLabel', 'Model:')}
                </label>
                <input
                    type="text"
                    id="vertexModel"
                    placeholder="gemini-2.5-flash"
                    value={model}
                    onChange={(e) => onModelChange(e.target.value)}
                />
            </div>

            {/* Test Connection */}
            <div className="setting openai-test-setting">
                <TestResultDisplay result={testResult} />
                <SparkleButton
                    onClick={handleTest}
                    disabled={testing || !accessToken || !projectId}
                >
                    {testing
                        ? t('testingButton', 'Testing...')
                        : t('testConnectionButton', 'Test Connection')
                    }
                </SparkleButton>
            </div>

            {/* Provider Info */}
            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerFeatures', 'Features:')}</strong>
                    <ul>
                        <li>{t('featureVertexServiceAccount', 'Service account JSON import')}</li>
                        <li>{t('featureVertexAutoToken', 'Automatic token generation')}</li>
                        <li>{t('featureVertexGemini', 'Google Gemini models via Vertex AI')}</li>
                        <li>{t('featureWideLanguageSupport', 'Wide language support')}</li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}

