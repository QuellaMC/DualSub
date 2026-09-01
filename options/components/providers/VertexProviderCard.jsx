import React, { useEffect, useRef } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { SparkleButton } from '../SparkleButton.jsx';
import { AppleStyleFileButton } from '../AppleStyleFileButton.jsx';
import { TestResultDisplay } from '../TestResultDisplay.jsx';
import { useVertexTest } from '../../hooks/useVertexTest.js';
import { useCommittedTextField } from '../../hooks/useCommittedTextField.js';
import { VERTEX_LOCATIONS } from '../../../content_scripts/shared/constants/providers.js';
import { validateSetting } from '../../../config/configSchema.js';

const DEFAULT_LOCATION = 'us-central1';
const DEFAULT_MODEL = 'gemini-2.5-flash';

function CommittedProviderField({ t, id, label, placeholder, field }) {
    const errorId = `${id}Error`;
    return (
        <div className="setting">
            <label htmlFor={id}>{label}</label>
            <input
                type="text"
                id={id}
                placeholder={placeholder}
                value={field.value}
                aria-invalid={field.invalid}
                aria-describedby={field.invalid ? errorId : undefined}
                onChange={(event) => field.change(event.target.value)}
                onBlur={() => void field.commit()}
                onKeyDown={field.handleKeyDown}
            />
            {field.invalid && (
                <span id={errorId} className="settings-field-error">
                    {t(
                        'invalidSettingValue',
                        'Enter a valid value before saving.'
                    )}
                </span>
            )}
        </div>
    );
}

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
    const modelField = useCommittedTextField({
        value: model,
        validate: (value) => validateSetting('vertexModel', value),
        onCommit: onModelChange,
    });
    const projectIdField = useCommittedTextField({
        value: projectId,
        validate: (value) => validateSetting('vertexProjectId', value),
        onCommit: onProjectIdChange,
    });

    useEffect(() => {
        void initializeStatus(accessToken, projectId);
    }, [accessToken, projectId, initializeStatus]);

    const testCredentials = (token, importedProjectId) =>
        testConnection(
            token,
            importedProjectId,
            location || DEFAULT_LOCATION,
            model || DEFAULT_MODEL
        );

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const credentials = await importServiceAccountJson(file);
            if (credentials) {
                await testCredentials(
                    credentials.accessToken,
                    credentials.projectId
                );
            }
        } catch {
            // The hook owns import feedback.
        } finally {
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
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                aria-label="Upload service account JSON"
            />

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

            <CommittedProviderField
                t={t}
                id="vertexProjectId"
                label={t('vertexProjectIdLabel', 'Project ID:')}
                placeholder="your-gcp-project-id"
                field={projectIdField}
            />

            <div className="setting">
                <label htmlFor="vertexLocation">
                    {t('vertexLocationLabel', 'Location:')}
                </label>
                <select
                    id="vertexLocation"
                    value={location || DEFAULT_LOCATION}
                    onChange={(e) => onLocationChange(e.target.value)}
                >
                    {VERTEX_LOCATIONS.map((region) => (
                        <option key={region} value={region}>
                            {region}
                        </option>
                    ))}
                </select>
            </div>

            <CommittedProviderField
                t={t}
                id="vertexModel"
                label={t('vertexModelLabel', 'Model:')}
                placeholder={DEFAULT_MODEL}
                field={modelField}
            />

            <div className="setting openai-test-setting">
                <TestResultDisplay result={testResult} />
                <SparkleButton
                    onClick={() => testCredentials(accessToken, projectId)}
                    disabled={testing || !accessToken || !projectId}
                >
                    {testing
                        ? t('testingButton', 'Testing...')
                        : t('testConnectionButton', 'Test Connection')}
                </SparkleButton>
            </div>

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
