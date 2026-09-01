import React, { useCallback, useEffect, useRef } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { SparkleButton } from '../SparkleButton.jsx';
import { TestResultDisplay } from '../TestResultDisplay.jsx';
import { useOpenAITest } from '../../hooks/index.js';
import { useCommittedTextField } from '../../hooks/useCommittedTextField.js';
import { fetchAvailableModels } from '../../../translation_providers/openaiCompatibleTranslate.js';
import { validateSetting } from '../../../config/configSchema.js';

export function OpenAICompatibleProviderCard({
    t,
    apiKey,
    baseUrl,
    model,
    models,
    onApiKeyChange,
    onBaseUrlChange,
    onModelChange,
    onModelsLoaded,
}) {
    const {
        testResult,
        testing,
        fetchingModels,
        testConnection,
        fetchModels,
        invalidateRequests,
        initializeStatus,
    } = useOpenAITest(t, fetchAvailableModels);

    const modelFetchTimerRef = useRef(null);

    const cancelPendingModelFetch = useCallback(() => {
        if (modelFetchTimerRef.current !== null) {
            clearTimeout(modelFetchTimerRef.current);
            modelFetchTimerRef.current = null;
        }
    }, []);

    const baseUrlField = useCommittedTextField({
        value: baseUrl,
        validate: (value) => validateSetting('openaiCompatibleBaseUrl', value),
        onCommit: onBaseUrlChange,
    });

    useEffect(() => {
        initializeStatus(apiKey);
        if (!apiKey.trim()) {
            return invalidateRequests;
        }
        modelFetchTimerRef.current = setTimeout(() => {
            modelFetchTimerRef.current = null;
            void fetchModels(apiKey, baseUrl, onModelsLoaded);
        }, 1000);

        return () => {
            cancelPendingModelFetch();
            invalidateRequests();
        };
    }, [
        apiKey,
        baseUrl,
        cancelPendingModelFetch,
        fetchModels,
        initializeStatus,
        invalidateRequests,
        onModelsLoaded,
    ]);

    const handleTest = useCallback(() => {
        cancelPendingModelFetch();
        void testConnection(apiKey, baseUrl, onModelsLoaded);
    }, [
        apiKey,
        baseUrl,
        cancelPendingModelFetch,
        onModelsLoaded,
        testConnection,
    ]);

    return (
        <SettingCard
            title={t(
                'cardOpenAICompatibleTitle',
                'OpenAI Compatible (API Key Required)'
            )}
            description={t(
                'cardOpenAICompatibleDesc',
                'Enter your API key and settings for OpenAI-compatible services like Gemini.'
            )}
        >
            <div className="setting">
                <label htmlFor="openaiCompatibleApiKey">
                    {t('apiKeyLabel', 'API Key:')}
                </label>
                <input
                    type="password"
                    id="openaiCompatibleApiKey"
                    placeholder={t(
                        'openaiApiKeyPlaceholder',
                        'Enter your OpenAI-compatible API key'
                    )}
                    value={apiKey}
                    onChange={(event) => onApiKeyChange(event.target.value)}
                />
            </div>

            <div className="setting">
                <label htmlFor="openaiCompatibleBaseUrl">
                    {t('baseUrlLabel', 'Base URL:')}
                </label>
                <input
                    type="text"
                    id="openaiCompatibleBaseUrl"
                    placeholder={t(
                        'openaiBaseUrlPlaceholder',
                        'e.g., https://api.openai.com/v1'
                    )}
                    value={baseUrlField.value}
                    aria-invalid={baseUrlField.invalid}
                    aria-describedby={
                        baseUrlField.invalid
                            ? 'openaiCompatibleBaseUrlError'
                            : undefined
                    }
                    onChange={(event) =>
                        baseUrlField.change(event.target.value)
                    }
                    onBlur={() => void baseUrlField.commit()}
                    onKeyDown={baseUrlField.handleKeyDown}
                />
                {baseUrlField.invalid && (
                    <span
                        id="openaiCompatibleBaseUrlError"
                        className="settings-field-error"
                    >
                        {t(
                            'invalidSettingValue',
                            'Enter a valid value before saving.'
                        )}
                    </span>
                )}
            </div>

            <div className="setting">
                <label htmlFor="openaiCompatibleModel">
                    {t('modelLabel', 'Model:')}
                </label>
                <select
                    id="openaiCompatibleModel"
                    value={model}
                    onChange={(e) => onModelChange(e.target.value)}
                    disabled={!models || models.length === 0}
                >
                    {models && models.length > 0 ? (
                        models.map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))
                    ) : (
                        <option value="">
                            {fetchingModels
                                ? 'Loading...'
                                : 'No models available'}
                        </option>
                    )}
                </select>
            </div>

            <div className="setting openai-test-setting">
                <TestResultDisplay result={testResult} />
                <SparkleButton
                    onClick={handleTest}
                    disabled={testing || !apiKey}
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
                                'featureCustomizable',
                                'Customizable endpoint and model'
                            )}
                        </li>
                        <li>
                            {t('featureApiKeyRequired', 'API key required')}
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
