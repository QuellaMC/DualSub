import React, { useEffect, useRef } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { SparkleButton } from '../SparkleButton.jsx';
import { TestResultDisplay } from '../TestResultDisplay.jsx';
import { useOpenAITest } from '../../hooks/index.js';
import { fetchAvailableModels } from '../../../translation_providers/openaiCompatibleTranslate.js';

// Debounce utility
function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

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
    const { testResult, testing, fetchingModels, testConnection, fetchModels, initializeStatus } = 
        useOpenAITest(t, fetchAvailableModels);

    // Create debounced model fetching
    const debouncedFetchRef = useRef(
        debounce((key, url) => {
            fetchModels(key, url, onModelsLoaded);
        }, 1000)
    );

    // Initialize status
    useEffect(() => {
        initializeStatus(apiKey);
        
        // Auto-fetch models if API key exists
        if (apiKey) {
            fetchModels(apiKey, baseUrl, onModelsLoaded);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only on mount - intentionally not including dependencies

    // Handle API key changes with debounced model fetching
    const handleApiKeyChange = (value) => {
        onApiKeyChange(value);
        if (value.trim()) {
            debouncedFetchRef.current(value, baseUrl);
        }
    };

    // Handle base URL changes with debounced model fetching
    const handleBaseUrlChange = (value) => {
        onBaseUrlChange(value);
        if (apiKey.trim()) {
            debouncedFetchRef.current(apiKey, value);
        }
    };

    const handleTest = () => {
        testConnection(apiKey, baseUrl);
    };

    return (
        <SettingCard
            title={t('cardOpenAICompatibleTitle', 'OpenAI Compatible (API Key Required)')}
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
                    placeholder={t('openaiApiKeyPlaceholder', 'Enter your OpenAI-compatible API key')}
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                />
            </div>

            <div className="setting">
                <label htmlFor="openaiCompatibleBaseUrl">
                    {t('baseUrlLabel', 'Base URL:')}
                </label>
                <input
                    type="text"
                    id="openaiCompatibleBaseUrl"
                    placeholder={t('openaiBaseUrlPlaceholder', 'e.g., https://api.openai.com/v1')}
                    value={baseUrl}
                    onChange={(e) => handleBaseUrlChange(e.target.value)}
                />
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
                        <option value="">{fetchingModels ? 'Loading...' : 'No models available'}</option>
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
                        : t('testConnectionButton', 'Test Connection')
                    }
                </SparkleButton>
            </div>

            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerFeatures', 'Features:')}</strong>
                    <ul>
                        <li>{t('featureCustomizable', 'Customizable endpoint and model')}</li>
                        <li>{t('featureApiKeyRequired', 'API key required')}</li>
                        <li>{t('featureWideLanguageSupport', 'Wide language support')}</li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
