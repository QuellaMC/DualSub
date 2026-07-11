import React, { useEffect, useRef } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { SparkleButton } from '../SparkleButton.jsx';
import { AppleStyleFileButton } from '../AppleStyleFileButton.jsx';
import { TestResultDisplay } from '../TestResultDisplay.jsx';
import { useVertexTest } from '../../hooks/useVertexTest.js';

export const VERTEX_LOCATIONS = [
    'us-central1',
    'us-east1',
    'us-west1',
    'europe-west1',
    'europe-west4',
    'asia-northeast1',
    'asia-southeast1',
];

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
    onCredentialsChange,
}) {
    const fileInputRef = useRef(null);
    const {
        testResult,
        importResult,
        testing,
        importing,
        testConnection,
        importServiceAccountJson,
        initializeStatus,
        updateManualAccessToken,
    } = useVertexTest(
        t,
        onAccessTokenChange,
        onProjectIdChange,
        onProviderChange,
        onCredentialsChange
    );

    useEffect(() => {
        void initializeStatus(accessToken, projectId);
    }, [accessToken, projectId, initializeStatus]);

    const handleTest = () => {
        const loc = location || 'us-central1';
        const mdl = model || 'gemini-2.5-flash';
        testConnection(accessToken, projectId, loc, mdl);
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const importedCredentials =
                    await importServiceAccountJson(file);
                if (importedCredentials) {
                    const loc = location || 'us-central1';
                    const mdl = model || 'gemini-2.5-flash';
                    await testConnection(
                        importedCredentials.accessToken,
                        importedCredentials.projectId,
                        loc,
                        mdl
                    );
                }
            } catch {
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

    return (
        <SettingCard
            title={t(
                'cardVertexGeminiTitle',
                'Vertex AI Gemini (API Key Required)'
            )}
            description={t(
                'cardVertexGeminiEphemeralDesc',
                'Enter a short-lived access token, or import a service account JSON once to generate one. The service-account key is never stored.'
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
                <label>
                    {t('vertexServiceAccountLabel', 'Service Account JSON:')}
                </label>
                <AppleStyleFileButton
                    onClick={handleImportClick}
                    disabled={importing}
                    loading={importing}
                    className="vertex-import-btn"
                >
                    {importing
                        ? t('vertexImporting', 'Importing...')
                        : t('vertexImportButton', 'Import JSON File')}
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
                    onChange={(e) =>
                        void updateManualAccessToken(e.target.value)
                    }
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
                <select
                    id="vertexLocation"
                    value={location || 'us-central1'}
                    onChange={(e) => onLocationChange(e.target.value)}
                >
                    {VERTEX_LOCATIONS.map((region) => (
                        <option key={region} value={region}>
                            {region}
                        </option>
                    ))}
                </select>
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
                        : t('testConnectionButton', 'Test Connection')}
                </SparkleButton>
            </div>

            {/* Provider Info */}
            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerFeatures', 'Features:')}</strong>
                    <ul>
                        <li>
                            {t(
                                'featureVertexServiceAccount',
                                'Service account JSON import'
                            )}
                        </li>
                        <li>
                            {t(
                                'featureVertexEphemeralToken',
                                'One-time token generation without storing the service-account key'
                            )}
                        </li>
                        <li>
                            {t(
                                'featureVertexGemini',
                                'Google Gemini models via Vertex AI'
                            )}
                        </li>
                        <li>
                            {t(
                                'featureWideLanguageSupport',
                                'Wide language support'
                            )}
                        </li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
