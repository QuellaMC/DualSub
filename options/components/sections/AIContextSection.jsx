import React, { useEffect, useRef, useState } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { ToggleSwitch } from '../ToggleSwitch.jsx';
import {
    getAvailableModels as getOpenAIModels,
    getDefaultModel as getOpenAIDefaultModel,
} from '../../../context_providers/openaiContextProvider.js';
import {
    getAvailableModels as getGeminiModels,
    getDefaultModel as getGeminiDefaultModel,
} from '../../../context_providers/geminiContextProvider.js';
import { requestHostPermission } from '../../../utils/hostPermissions.js';

const OPENAI_MODELS = getOpenAIModels();
const GEMINI_MODELS = getGeminiModels();
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function getConfiguredModel(configuredModel, defaultModel) {
    return typeof configuredModel === 'string' && configuredModel.trim()
        ? configuredModel
        : defaultModel;
}

function getUnlistedConfiguredModel(models, configuredModel) {
    return configuredModel && !models.some(({ id }) => id === configuredModel)
        ? configuredModel
        : null;
}

function getHostLabel(baseUrl) {
    const configuredUrl = baseUrl || DEFAULT_OPENAI_BASE_URL;
    try {
        return new URL(configuredUrl).host;
    } catch {
        return configuredUrl;
    }
}

export function AIContextSection({ t, settings, onSettingChange }) {
    const [contextTypes, setContextTypes] = useState({
        cultural: false,
        historical: false,
        linguistic: false,
    });
    const [hostPermissionStatus, setHostPermissionStatus] = useState(null);
    const configuredOpenAIBaseUrl =
        settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL;
    const hostPermissionRequestSequence = useRef(0);
    const latestOpenAIBaseUrl = useRef(configuredOpenAIBaseUrl);
    latestOpenAIBaseUrl.current = configuredOpenAIBaseUrl;

    // Load context types from settings
    useEffect(() => {
        const types = settings.aiContextTypes || [];
        setContextTypes({
            cultural: types.includes('cultural'),
            historical: types.includes('historical'),
            linguistic: types.includes('linguistic'),
        });
    }, [settings.aiContextTypes]);

    useEffect(() => {
        hostPermissionRequestSequence.current += 1;
        setHostPermissionStatus(null);
    }, [configuredOpenAIBaseUrl]);

    const handleContextTypeChange = (type, checked) => {
        const newTypes = { ...contextTypes, [type]: checked };
        setContextTypes(newTypes);

        // Convert to array for storage
        const typesArray = Object.entries(newTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type]) => type);

        onSettingChange('aiContextTypes', typesArray);
    };

    const handleRequestHostPermission = async () => {
        const requestedBaseUrl = configuredOpenAIBaseUrl;
        const requestSequence = ++hostPermissionRequestSequence.current;
        const isCurrentRequest = () =>
            requestSequence === hostPermissionRequestSequence.current &&
            requestedBaseUrl === latestOpenAIBaseUrl.current;

        setHostPermissionStatus({
            baseUrl: requestedBaseUrl,
            state: 'pending',
            message: t(
                'openaiHostPermissionChecking',
                'Checking API host access…'
            ),
        });

        try {
            // Keep the native request in this click call stack. Chrome may
            // reject permissions.request() if any async work precedes it.
            const permissionRequest = requestHostPermission(requestedBaseUrl);
            const granted = await permissionRequest;
            if (!isCurrentRequest()) {
                return;
            }
            setHostPermissionStatus({
                baseUrl: requestedBaseUrl,
                state: granted ? 'granted' : 'denied',
                message: granted
                    ? t(
                          'openaiHostPermissionGranted',
                          'API host access granted.'
                      )
                    : t(
                          'openaiHostPermissionDenied',
                          'API host access was not granted.'
                      ),
            });
        } catch (error) {
            if (!isCurrentRequest()) {
                return;
            }
            setHostPermissionStatus({
                baseUrl: requestedBaseUrl,
                state: 'error',
                message: t(
                    'openaiHostPermissionError',
                    'Could not request API host access: %s',
                    error instanceof Error ? error.message : String(error)
                ),
            });
        }
    };

    const aiContextEnabled = settings.aiContextEnabled || false;
    const aiContextProvider = settings.aiContextProvider || 'openai';
    const hasSelectedContextType = Object.values(contextTypes).some(Boolean);
    const currentHostPermissionStatus =
        hostPermissionStatus?.baseUrl === configuredOpenAIBaseUrl
            ? hostPermissionStatus
            : null;
    const hostPermissionState = currentHostPermissionStatus?.state || 'idle';
    const hostPermissionMessage = currentHostPermissionStatus?.message || '';
    const hostPermissionPending = hostPermissionState === 'pending';
    const configuredOpenAIHost = getHostLabel(configuredOpenAIBaseUrl);

    return (
        <section id="ai-context">
            <h2>{t('sectionAIContext', 'AI Context Assistant')}</h2>

            {/* Card 1: Feature Toggle */}
            <SettingCard
                title={t(
                    'cardAIContextToggleTitle',
                    'Enable AI Context Analysis'
                )}
                description={t(
                    'cardAIContextToggleDesc',
                    'Enable AI-powered cultural, historical, and linguistic context analysis for subtitle text. Click on words or phrases in subtitles to get detailed explanations.'
                )}
            >
                <div className="setting">
                    <label htmlFor="aiContextEnabled">
                        {t('aiContextEnabledLabel', 'Enable AI Context:')}
                    </label>
                    <ToggleSwitch
                        id="aiContextEnabled"
                        checked={aiContextEnabled}
                        onChange={(checked) =>
                            onSettingChange('aiContextEnabled', checked)
                        }
                    />
                </div>
            </SettingCard>

            {/* Card 2: Provider Selection */}
            {aiContextEnabled && (
                <SettingCard
                    title={t('cardAIContextProviderTitle', 'AI Provider')}
                    description={t(
                        'cardAIContextProviderDesc',
                        'Choose the AI service provider for context analysis. Different providers may offer varying quality and response times.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="aiContextProvider">
                            {t('aiContextProviderLabel', 'Provider:')}
                        </label>
                        <select
                            id="aiContextProvider"
                            value={aiContextProvider}
                            onChange={(e) =>
                                onSettingChange(
                                    'aiContextProvider',
                                    e.target.value
                                )
                            }
                        >
                            <option value="openai">OpenAI GPT</option>
                            <option value="gemini">Google Gemini</option>
                        </select>
                    </div>
                </SettingCard>
            )}

            {/* Card 3: OpenAI Configuration */}
            {aiContextEnabled && aiContextProvider === 'openai' && (
                <SettingCard
                    title={t('cardOpenAIContextTitle', 'OpenAI Configuration')}
                    description={t(
                        'cardOpenAIContextDesc',
                        'Configure your OpenAI API settings for context analysis. You need a valid OpenAI API key.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="openaiApiKey">
                            {t('openaiApiKeyLabel', 'API Key:')}
                        </label>
                        <input
                            type="password"
                            id="openaiApiKey"
                            value={settings.openaiApiKey || ''}
                            onChange={(e) =>
                                onSettingChange('openaiApiKey', e.target.value)
                            }
                            placeholder="sk-..."
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="openaiBaseUrl">
                            {t('openaiBaseUrlLabel', 'Base URL:')}
                        </label>
                        <div className="api-host-control">
                            <input
                                type="url"
                                id="openaiBaseUrl"
                                value={
                                    settings.openaiBaseUrl ||
                                    DEFAULT_OPENAI_BASE_URL
                                }
                                aria-describedby={
                                    currentHostPermissionStatus
                                        ? 'openaiHostPermissionStatus'
                                        : undefined
                                }
                                onChange={(e) => {
                                    hostPermissionRequestSequence.current += 1;
                                    setHostPermissionStatus(null);
                                    onSettingChange(
                                        'openaiBaseUrl',
                                        e.target.value
                                    );
                                }}
                                placeholder="https://api.openai.com/v1"
                            />
                            <div
                                className={`api-host-permission ${hostPermissionState}`}
                                role="group"
                                aria-labelledby="openaiHostPermissionHost"
                            >
                                <div className="api-host-permission-heading">
                                    <span
                                        className="api-host-permission-icon"
                                        aria-hidden="true"
                                    >
                                        <svg viewBox="0 0 20 20">
                                            <path d="M10 1.75 16 4v4.2c0 4.05-2.42 7.68-6 9.3-3.58-1.62-6-5.25-6-9.3V4l6-2.25Z" />
                                            {hostPermissionState ===
                                                'granted' && (
                                                <path
                                                    className="api-host-permission-mark"
                                                    d="m7.15 9.7 1.75 1.75 3.95-4.1"
                                                />
                                            )}
                                            {(hostPermissionState ===
                                                'denied' ||
                                                hostPermissionState ===
                                                    'error') && (
                                                <path
                                                    className="api-host-permission-mark"
                                                    d="M10 6.25v4.25m0 2.5h.01"
                                                />
                                            )}
                                        </svg>
                                    </span>
                                    <span
                                        id="openaiHostPermissionHost"
                                        className="api-host-permission-title"
                                    >
                                        {configuredOpenAIHost}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="api-host-permission-button"
                                    onClick={() =>
                                        void handleRequestHostPermission()
                                    }
                                    disabled={hostPermissionPending}
                                    aria-busy={hostPermissionPending}
                                    aria-describedby={`openaiHostPermissionHost${
                                        currentHostPermissionStatus
                                            ? ' openaiHostPermissionStatus'
                                            : ''
                                    }`}
                                >
                                    {t(
                                        'openaiHostPermissionButton',
                                        'Allow API host'
                                    )}
                                </button>
                                <span
                                    id="openaiHostPermissionStatus"
                                    className="api-host-permission-status"
                                    role="status"
                                >
                                    {hostPermissionMessage}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="setting">
                        <label htmlFor="openaiModel">
                            {t('openaiModelLabel', 'Model:')}
                        </label>
                        <input
                            type="text"
                            id="openaiModel"
                            value={getConfiguredModel(
                                settings.openaiModel,
                                getOpenAIDefaultModel()
                            )}
                            list="openaiModelOptions"
                            onChange={(e) =>
                                onSettingChange('openaiModel', e.target.value)
                            }
                        />
                        <datalist id="openaiModelOptions">
                            {OPENAI_MODELS.map((model) => (
                                <option
                                    key={model.id}
                                    value={model.id}
                                    title={model.description}
                                    label={`${model.name}${model.recommended ? ' (Recommended)' : ''}`}
                                />
                            ))}
                        </datalist>
                    </div>
                </SettingCard>
            )}

            {/* Card 4: Gemini Configuration */}
            {aiContextEnabled && aiContextProvider === 'gemini' && (
                <SettingCard
                    title={t(
                        'cardGeminiContextTitle',
                        'Google Gemini Configuration'
                    )}
                    description={t(
                        'cardGeminiContextDesc',
                        'Configure your Google Gemini API settings for context analysis. You need a valid Gemini API key.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="geminiApiKey">
                            {t('geminiApiKeyLabel', 'API Key:')}
                        </label>
                        <input
                            type="password"
                            id="geminiApiKey"
                            value={settings.geminiApiKey || ''}
                            onChange={(e) =>
                                onSettingChange('geminiApiKey', e.target.value)
                            }
                            placeholder="AIza..."
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="geminiModel">
                            {t('geminiModelLabel', 'Model:')}
                        </label>
                        <select
                            id="geminiModel"
                            value={getConfiguredModel(
                                settings.geminiModel,
                                getGeminiDefaultModel()
                            )}
                            onChange={(e) =>
                                onSettingChange('geminiModel', e.target.value)
                            }
                        >
                            {getUnlistedConfiguredModel(
                                GEMINI_MODELS,
                                settings.geminiModel
                            ) && (
                                <option value={settings.geminiModel}>
                                    {settings.geminiModel} (Configured)
                                </option>
                            )}
                            {GEMINI_MODELS.map((model) => (
                                <option
                                    key={model.id}
                                    value={model.id}
                                    title={model.description}
                                >
                                    {model.name}
                                    {model.recommended ? ' (Recommended)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </SettingCard>
            )}

            {/* Card 5: Context Types */}
            {aiContextEnabled && (
                <SettingCard
                    title={t('cardAIContextTypesTitle', 'Context Types')}
                    description={t(
                        'cardAIContextTypesDesc',
                        'Enable the types of context analysis you want to use. You can enable multiple types.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="contextTypeCultural">
                            {t('contextTypeCulturalLabel', 'Cultural Context:')}
                        </label>
                        <ToggleSwitch
                            id="contextTypeCultural"
                            checked={contextTypes.cultural}
                            onChange={(checked) =>
                                handleContextTypeChange('cultural', checked)
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="contextTypeHistorical">
                            {t(
                                'contextTypeHistoricalLabel',
                                'Historical Context:'
                            )}
                        </label>
                        <ToggleSwitch
                            id="contextTypeHistorical"
                            checked={contextTypes.historical}
                            onChange={(checked) =>
                                handleContextTypeChange('historical', checked)
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="contextTypeLinguistic">
                            {t(
                                'contextTypeLinguisticLabel',
                                'Linguistic Context:'
                            )}
                        </label>
                        <ToggleSwitch
                            id="contextTypeLinguistic"
                            checked={contextTypes.linguistic}
                            onChange={(checked) =>
                                handleContextTypeChange('linguistic', checked)
                            }
                        />
                    </div>
                    {!hasSelectedContextType && (
                        <p className="setting-help" role="alert">
                            {t(
                                'aiContextTypesRequired',
                                'Select at least one context type.'
                            )}
                        </p>
                    )}
                </SettingCard>
            )}

            {/* Card 6: Advanced Settings */}
            {aiContextEnabled && (
                <SettingCard
                    title={t('cardAIContextAdvancedTitle', 'Advanced Settings')}
                    description={t(
                        'cardAIContextAdvancedDesc',
                        'Configure advanced options for AI context analysis behavior.'
                    )}
                >
                    <div className="setting">
                        <label htmlFor="aiContextTimeout">
                            {t(
                                'aiContextTimeoutLabel',
                                'Request Timeout (ms):'
                            )}
                        </label>
                        <input
                            type="number"
                            id="aiContextTimeout"
                            min="5000"
                            max="60000"
                            step="1000"
                            value={settings.aiContextTimeout || 10000}
                            onChange={(e) =>
                                onSettingChange(
                                    'aiContextTimeout',
                                    parseInt(e.target.value)
                                )
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="aiContextRateLimit">
                            {t(
                                'aiContextRateLimitLabel',
                                'Rate Limit (requests/min):'
                            )}
                        </label>
                        <input
                            type="number"
                            id="aiContextRateLimit"
                            min="10"
                            max="300"
                            step="10"
                            value={settings.aiContextRateLimit || 60}
                            onChange={(e) =>
                                onSettingChange(
                                    'aiContextRateLimit',
                                    parseInt(e.target.value)
                                )
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="aiContextCacheEnabled">
                            {t('aiContextCacheEnabledLabel', 'Enable Caching:')}
                        </label>
                        <ToggleSwitch
                            id="aiContextCacheEnabled"
                            checked={settings.aiContextCacheEnabled || false}
                            onChange={(checked) =>
                                onSettingChange(
                                    'aiContextCacheEnabled',
                                    checked
                                )
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="aiContextRetryAttempts">
                            {t(
                                'aiContextRetryAttemptsLabel',
                                'Retry Attempts:'
                            )}
                        </label>
                        <input
                            type="number"
                            id="aiContextRetryAttempts"
                            min="1"
                            max="5"
                            step="1"
                            value={settings.aiContextRetryAttempts || 2}
                            onChange={(e) =>
                                onSettingChange(
                                    'aiContextRetryAttempts',
                                    parseInt(e.target.value)
                                )
                            }
                        />
                    </div>
                </SettingCard>
            )}
        </section>
    );
}
