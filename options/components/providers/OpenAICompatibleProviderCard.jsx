import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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

    const fetchModelsRef = useRef(fetchModels);
    const testConnectionRef = useRef(testConnection);
    const invalidateRequestsRef = useRef(invalidateRequests);
    const initializeStatusRef = useRef(initializeStatus);
    const onModelsLoadedRef = useRef(onModelsLoaded);
    const apiKeyRef = useRef(apiKey);
    const baseUrlRef = useRef(baseUrl);
    const modelRequestGenerationRef = useRef(0);
    const currentModelRequestIdentityRef = useRef(null);
    const renderedIdentityRef = useRef(null);
    const pendingModelFetchRef = useRef(null);
    const modelFetchTimerRef = useRef(null);
    fetchModelsRef.current = fetchModels;
    testConnectionRef.current = testConnection;
    invalidateRequestsRef.current = invalidateRequests;
    initializeStatusRef.current = initializeStatus;
    onModelsLoadedRef.current = onModelsLoaded;
    apiKeyRef.current = apiKey;
    baseUrlRef.current = baseUrl;

    const cancelPendingModelFetch = useCallback(() => {
        if (modelFetchTimerRef.current !== null) {
            clearTimeout(modelFetchTimerRef.current);
            modelFetchTimerRef.current = null;
        }
        pendingModelFetchRef.current = null;
    }, []);

    const createGenerationCallback = useCallback((generation, key, url) => {
        return (loadedModels) => {
            if (
                generation !== modelRequestGenerationRef.current ||
                key !== apiKeyRef.current ||
                url !== baseUrlRef.current
            ) {
                return;
            }
            onModelsLoadedRef.current?.(loadedModels, {
                apiKey: key,
                baseUrl: url,
            });
        };
    }, []);

    const invalidateModelRequests = useCallback(() => {
        cancelPendingModelFetch();
        modelRequestGenerationRef.current += 1;
        currentModelRequestIdentityRef.current = null;
        invalidateRequestsRef.current();
        return modelRequestGenerationRef.current;
    }, [cancelPendingModelFetch]);

    const invalidateModelIdentity = useCallback(() => {
        const generation = invalidateModelRequests();
        onModelsLoadedRef.current?.([]);
        return generation;
    }, [invalidateModelRequests]);

    const fetchModelsNow = useCallback(
        (key, url) => {
            const generation = invalidateModelRequests();
            currentModelRequestIdentityRef.current = {
                generation,
                key,
                url,
            };
            void fetchModelsRef.current(
                key,
                url,
                createGenerationCallback(generation, key, url)
            );
        },
        [createGenerationCallback, invalidateModelRequests]
    );

    const scheduleModelFetch = useCallback(
        (key, url, clearPublishedCatalog = false) => {
            const generation = clearPublishedCatalog
                ? invalidateModelIdentity()
                : invalidateModelRequests();
            currentModelRequestIdentityRef.current = {
                generation,
                key,
                url,
            };
            pendingModelFetchRef.current = { generation, key, url };
            modelFetchTimerRef.current = setTimeout(() => {
                modelFetchTimerRef.current = null;
                const request = pendingModelFetchRef.current;
                pendingModelFetchRef.current = null;
                if (
                    !request ||
                    request.generation !== modelRequestGenerationRef.current
                ) {
                    return;
                }
                void fetchModelsRef.current(
                    request.key,
                    request.url,
                    createGenerationCallback(
                        request.generation,
                        request.key,
                        request.url
                    )
                );
            }, 1000);
        },
        [
            createGenerationCallback,
            invalidateModelIdentity,
            invalidateModelRequests,
        ]
    );

    const testModelsNow = useCallback(
        (key, url) => {
            const generation = invalidateModelRequests();
            currentModelRequestIdentityRef.current = {
                generation,
                key,
                url,
            };
            void testConnectionRef.current(
                key,
                url,
                createGenerationCallback(generation, key, url)
            );
        },
        [createGenerationCallback, invalidateModelRequests]
    );

    const baseUrlField = useCommittedTextField({
        value: baseUrl,
        validate: (value) => validateSetting('openaiCompatibleBaseUrl', value),
        onCommit: async (value) => {
            const committed = await onBaseUrlChange(value);
            if (committed === false) {
                return false;
            }
            return true;
        },
    });

    // Initialize status
    useEffect(() => {
        initializeStatusRef.current(apiKeyRef.current);

        // Auto-fetch models if API key exists
        if (apiKeyRef.current) {
            fetchModelsNow(apiKeyRef.current, baseUrlRef.current);
        }
        return invalidateModelRequests;
    }, [fetchModelsNow, invalidateModelRequests]);

    useLayoutEffect(() => {
        const previousIdentity = renderedIdentityRef.current;
        const isInitialIdentity = previousIdentity === null;
        if (
            previousIdentity?.apiKey === apiKey &&
            previousIdentity.baseUrl === baseUrl
        ) {
            return;
        }
        renderedIdentityRef.current = { apiKey, baseUrl };
        if (isInitialIdentity) {
            invalidateModelIdentity();
            return;
        }
        const currentRequest = currentModelRequestIdentityRef.current;
        if (
            currentRequest &&
            currentRequest.generation === modelRequestGenerationRef.current &&
            currentRequest.key === apiKey &&
            currentRequest.url === baseUrl
        ) {
            return;
        }
        if (apiKey.trim()) {
            scheduleModelFetch(apiKey, baseUrl, true);
        } else {
            invalidateModelIdentity();
        }
    }, [apiKey, baseUrl, invalidateModelIdentity, scheduleModelFetch]);

    // Handle API key changes with debounced model fetching
    const handleApiKeyChange = (value) => {
        apiKeyRef.current = value;
        onApiKeyChange(value);
        if (value.trim()) {
            scheduleModelFetch(value, baseUrlRef.current, true);
        } else {
            invalidateModelIdentity();
        }
    };

    const handleTest = () => {
        testModelsNow(apiKeyRef.current, baseUrlRef.current);
    };

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
                    onChange={(event) => {
                        invalidateModelIdentity();
                        baseUrlField.change(event.target.value);
                    }}
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
