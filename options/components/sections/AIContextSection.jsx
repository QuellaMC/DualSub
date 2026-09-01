import React, { useEffect, useRef, useState } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { ToggleSwitch } from '../ToggleSwitch.jsx';
import { getAvailableModels as getOpenAIModels } from '../../../context_providers/openaiContextProvider.js';
import {
    getAvailableModels as getGeminiModels,
    getDefaultModel as getGeminiDefaultModel,
} from '../../../context_providers/geminiContextProvider.js';
import {
    configSchema,
    getDefaultValue,
    validateSetting,
} from '../../../config/configSchema.js';
import {
    requestHostPermission,
    toHostPermissionPattern,
} from '../../../utils/hostPermissions.js';
import { useCommittedTextField } from '../../hooks/useCommittedTextField.js';
import { CONTEXT_TYPES as SHARED_CONTEXT_TYPES } from '../../../content_scripts/shared/constants/contextTypes.js';

const OPENAI_MODELS = getOpenAIModels();
const GEMINI_MODELS = getGeminiModels();
const AI_CONTEXT_TIMEOUT_SCHEMA = configSchema.aiContextTimeout;
const AI_CONTEXT_RATE_LIMIT_SCHEMA = configSchema.aiContextRateLimit;
const CONTEXT_TYPE_LABELS = Object.freeze({
    cultural: [
        'contextTypeCultural',
        'contextTypeCulturalLabel',
        'Cultural Context:',
    ],
    historical: [
        'contextTypeHistorical',
        'contextTypeHistoricalLabel',
        'Historical Context:',
    ],
    linguistic: [
        'contextTypeLinguistic',
        'contextTypeLinguisticLabel',
        'Linguistic Context:',
    ],
});
const CONTEXT_TYPES = SHARED_CONTEXT_TYPES.map((type) => [
    type,
    ...CONTEXT_TYPE_LABELS[type],
]);

function getNumericDraft(value) {
    if (value === '') {
        return value;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : value;
}

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
    try {
        return new URL(baseUrl).host;
    } catch {
        return baseUrl;
    }
}

function getHostPermissionScope(baseUrl) {
    try {
        return toHostPermissionPattern(baseUrl);
    } catch {
        return '';
    }
}

function CommittedInput({
    t,
    id,
    label,
    field,
    parse = (value) => value,
    ...inputProps
}) {
    const errorId = `${id}Error`;
    return (
        <div className="setting">
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                {...inputProps}
                value={field.value}
                aria-invalid={field.invalid}
                aria-describedby={field.invalid ? errorId : undefined}
                onChange={(event) => field.change(parse(event.target.value))}
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

export function AIContextSection({ t, settings, onSettingChange }) {
    const [contextTypes, setContextTypes] = useState({
        cultural: false,
        historical: false,
        linguistic: false,
    });
    const [hostPermissionStatus, setHostPermissionStatus] = useState(null);
    const persistedOpenAIBaseUrl =
        settings.openaiBaseUrl ?? getDefaultValue('openaiBaseUrl');
    const openAIBaseUrlField = useCommittedTextField({
        value: persistedOpenAIBaseUrl,
        validate: (value) => validateSetting('openaiBaseUrl', value),
        onCommit: (value) => onSettingChange('openaiBaseUrl', value),
    });
    const configuredOpenAIBaseUrl = openAIBaseUrlField.value;
    const openAIModelField = useCommittedTextField({
        value: settings.openaiModel ?? getDefaultValue('openaiModel'),
        validate: (value) => validateSetting('openaiModel', value),
        onCommit: (value) => onSettingChange('openaiModel', value),
    });
    const aiContextTimeoutField = useCommittedTextField({
        value: settings.aiContextTimeout ?? getDefaultValue('aiContextTimeout'),
        validate: (value) => validateSetting('aiContextTimeout', value),
        onCommit: (value) => onSettingChange('aiContextTimeout', value),
    });
    const aiContextRateLimitField = useCommittedTextField({
        value:
            settings.aiContextRateLimit ??
            getDefaultValue('aiContextRateLimit'),
        validate: (value) => validateSetting('aiContextRateLimit', value),
        onCommit: (value) => onSettingChange('aiContextRateLimit', value),
    });
    const hostPermissionRequestSequence = useRef(0);
    const latestOpenAIBaseUrl = useRef(configuredOpenAIBaseUrl);
    latestOpenAIBaseUrl.current = configuredOpenAIBaseUrl;

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

        const typesArray = Object.entries(newTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type]) => type);

        onSettingChange('aiContextTypes', typesArray);
    };

    const handleRequestHostPermission = async () => {
        if (!openAIBaseUrlField.valid) {
            return;
        }
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
    const configuredHostPermissionScope = getHostPermissionScope(
        configuredOpenAIBaseUrl
    );

    return (
        <section id="ai-context">
            <h2>{t('sectionAIContext', 'AI Context Assistant')}</h2>

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
                                value={openAIBaseUrlField.value}
                                aria-invalid={openAIBaseUrlField.invalid}
                                aria-describedby={
                                    [
                                        configuredHostPermissionScope
                                            ? 'openaiHostPermissionScope'
                                            : null,
                                        currentHostPermissionStatus
                                            ? 'openaiHostPermissionStatus'
                                            : null,
                                        openAIBaseUrlField.invalid
                                            ? 'openaiBaseUrlError'
                                            : null,
                                    ]
                                        .filter(Boolean)
                                        .join(' ') || undefined
                                }
                                onChange={(e) => {
                                    hostPermissionRequestSequence.current += 1;
                                    setHostPermissionStatus(null);
                                    openAIBaseUrlField.change(e.target.value);
                                }}
                                onBlur={() => void openAIBaseUrlField.commit()}
                                onKeyDown={openAIBaseUrlField.handleKeyDown}
                                placeholder="https://api.openai.com/v1"
                            />
                            {openAIBaseUrlField.invalid && (
                                <span
                                    id="openaiBaseUrlError"
                                    className="settings-field-error"
                                >
                                    {t(
                                        'invalidSettingValue',
                                        'Enter a valid value before saving.'
                                    )}
                                </span>
                            )}
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
                                    disabled={
                                        hostPermissionPending ||
                                        !openAIBaseUrlField.valid
                                    }
                                    aria-busy={hostPermissionPending}
                                    aria-describedby={`openaiHostPermissionHost${
                                        configuredHostPermissionScope
                                            ? ' openaiHostPermissionScope'
                                            : ''
                                    }${
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
                                {configuredHostPermissionScope && (
                                    <span
                                        id="openaiHostPermissionScope"
                                        className="api-host-permission-status"
                                    >
                                        {t(
                                            'openaiHostPermissionScope',
                                            'Configured endpoint: %s. Chrome permission scope: %s (all paths and ports on this host).',
                                            configuredOpenAIBaseUrl,
                                            configuredHostPermissionScope
                                        )}
                                    </span>
                                )}
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

                    <CommittedInput
                        t={t}
                        id="openaiModel"
                        label={t('openaiModelLabel', 'Model:')}
                        type="text"
                        list="openaiModelOptions"
                        field={openAIModelField}
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
                </SettingCard>
            )}

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

            {aiContextEnabled && (
                <SettingCard
                    title={t('cardAIContextTypesTitle', 'Context Types')}
                    description={t(
                        'cardAIContextTypesDesc',
                        'Enable the types of context analysis you want to use. You can enable multiple types.'
                    )}
                >
                    {CONTEXT_TYPES.map(
                        ([type, id, labelKey, fallbackLabel]) => (
                            <div className="setting" key={type}>
                                <label htmlFor={id}>
                                    {t(labelKey, fallbackLabel)}
                                </label>
                                <ToggleSwitch
                                    id={id}
                                    checked={contextTypes[type]}
                                    onChange={(checked) =>
                                        handleContextTypeChange(type, checked)
                                    }
                                />
                            </div>
                        )
                    )}
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

            {aiContextEnabled && (
                <SettingCard
                    title={t('cardAIContextAdvancedTitle', 'Advanced Settings')}
                    description={t(
                        'cardAIContextAdvancedDesc',
                        'Configure advanced options for AI context analysis behavior.'
                    )}
                >
                    <CommittedInput
                        t={t}
                        id="aiContextTimeout"
                        label={t(
                            'aiContextTimeoutLabel',
                            'Request Timeout (ms):'
                        )}
                        type="number"
                        min={AI_CONTEXT_TIMEOUT_SCHEMA.min}
                        max={AI_CONTEXT_TIMEOUT_SCHEMA.max}
                        step="1000"
                        parse={getNumericDraft}
                        field={aiContextTimeoutField}
                    />

                    <CommittedInput
                        t={t}
                        id="aiContextRateLimit"
                        label={t(
                            'aiContextRateLimitLabel',
                            'Rate Limit (requests/min):'
                        )}
                        type="number"
                        min={AI_CONTEXT_RATE_LIMIT_SCHEMA.min}
                        max={AI_CONTEXT_RATE_LIMIT_SCHEMA.max}
                        step="10"
                        parse={getNumericDraft}
                        field={aiContextRateLimitField}
                    />

                    <div className="setting">
                        <label htmlFor="aiContextCacheEnabled">
                            {t('aiContextCacheEnabledLabel', 'Enable Caching:')}
                        </label>
                        <ToggleSwitch
                            id="aiContextCacheEnabled"
                            checked={
                                settings.aiContextCacheEnabled ??
                                getDefaultValue('aiContextCacheEnabled')
                            }
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
                            value={
                                settings.aiContextRetryAttempts ??
                                getDefaultValue('aiContextRetryAttempts')
                            }
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
