import { useRef, useState } from 'react';
import {
    SETTING_BOUNDS,
    validateSetting,
    type SettingsValues,
} from '@/config/schema';
import { CONTEXT_TYPES, type ContextType } from '@/shared/contextTypes';
import {
    requestHostPermission,
    toHostPermissionPattern,
} from '@/shared/hostPermissions';
import type { Translate } from '../../hooks/useI18n';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { FieldError } from '../FieldError';
import { SettingCard } from '../SettingCard';
import { ToggleSwitch } from '../ToggleSwitch';
import { errorMessage, type SaveSettings, type SectionProps } from '../types';

interface ModelChoice {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly recommended: boolean;
}

export const OPENAI_MODELS: readonly ModelChoice[] = [
    {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        description: 'Optimized for cost-sensitive context analysis',
        recommended: true,
    },
    {
        id: 'gpt-5.6-terra',
        name: 'GPT-5.6 Terra',
        description: 'Balances analysis quality and cost',
        recommended: false,
    },
    {
        id: 'gpt-5.6',
        name: 'GPT-5.6',
        description: 'Frontier model for the most demanding analysis',
        recommended: false,
    },
];

export const GEMINI_MODELS: readonly ModelChoice[] = [
    {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        description: 'Latest stable Flash model for context analysis',
        recommended: true,
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Fast and efficient model for quick context analysis',
        recommended: false,
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description:
            'Advanced model with superior reasoning for complex cultural analysis',
        recommended: false,
    },
];

const CONTEXT_TYPE_LABELS: Record<ContextType, string> = {
    cultural: 'contextTypeCulturalLabel',
    historical: 'contextTypeHistoricalLabel',
    linguistic: 'contextTypeLinguisticLabel',
};

type HostPermissionStatus = {
    readonly baseUrl: string;
    readonly state: 'pending' | 'granted' | 'denied' | 'error';
    readonly message: string;
} | null;

function hostLabel(baseUrl: string): string {
    try {
        return new URL(baseUrl).host;
    } catch {
        return baseUrl;
    }
}

function hostPermissionScope(baseUrl: string): string {
    try {
        return toHostPermissionPattern(baseUrl);
    } catch {
        return '';
    }
}

function isAiProvider(
    value: string
): value is SettingsValues['aiContextProvider'] {
    return value === 'openai' || value === 'gemini';
}

/** A numeric setting edited as text: the draft commits as a number. */
function useNumericField(
    key: 'aiContextTimeout' | 'aiContextRateLimit',
    value: number,
    save: SaveSettings
) {
    return useCommittedTextField<string>({
        value: String(value),
        validate: (draft) =>
            draft.trim() !== '' && validateSetting(key, Number(draft)),
        onCommit: (draft) => save({ [key]: Number(draft) }),
    });
}

function NumericSetting({
    id,
    label,
    field,
    bounds,
    step,
    t,
}: {
    id: string;
    label: string;
    field: ReturnType<typeof useNumericField>;
    bounds: { readonly min: number; readonly max: number };
    step: number;
    t: Translate;
}) {
    return (
        <div className="setting">
            <label htmlFor={id}>{label}</label>
            <div>
                <input
                    type="number"
                    id={id}
                    min={bounds.min}
                    max={bounds.max}
                    step={step}
                    value={field.value}
                    aria-invalid={field.invalid}
                    aria-describedby={field.invalid ? `${id}Error` : undefined}
                    onChange={(event) => field.change(event.target.value)}
                    onBlur={() => void field.commit()}
                    onKeyDown={field.handleKeyDown}
                />
                <FieldError id={`${id}Error`} visible={field.invalid} t={t} />
            </div>
        </div>
    );
}

function OpenAIHostPermission({
    t,
    baseUrl,
    valid,
}: {
    t: Translate;
    baseUrl: string;
    valid: boolean;
}) {
    const [status, setStatus] = useState<HostPermissionStatus>(null);
    const sequence = useRef(0);
    const current = status?.baseUrl === baseUrl ? status : null;
    const state = current?.state ?? 'idle';
    const pending = state === 'pending';
    const scope = hostPermissionScope(baseUrl);

    const request = (): void => {
        if (!valid) {
            return;
        }
        sequence.current += 1;
        const mine = sequence.current;
        const requested = baseUrl;
        setStatus({
            baseUrl: requested,
            state: 'pending',
            message: t('openaiHostPermissionChecking'),
        });
        // The prompt must open inside this click: no await before it.
        let permission: Promise<boolean>;
        try {
            permission = requestHostPermission(requested);
        } catch (error) {
            setStatus({
                baseUrl: requested,
                state: 'error',
                message: t('openaiHostPermissionError', errorMessage(error)),
            });
            return;
        }
        void permission.then(
            (granted) => {
                if (mine !== sequence.current) {
                    return;
                }
                setStatus({
                    baseUrl: requested,
                    state: granted ? 'granted' : 'denied',
                    message: t(
                        granted
                            ? 'openaiHostPermissionGranted'
                            : 'openaiHostPermissionDenied'
                    ),
                });
            },
            (error: unknown) => {
                if (mine !== sequence.current) {
                    return;
                }
                setStatus({
                    baseUrl: requested,
                    state: 'error',
                    message: t(
                        'openaiHostPermissionError',
                        errorMessage(error)
                    ),
                });
            }
        );
    };

    return (
        <div
            className={`api-host-permission ${state}`}
            role="group"
            aria-labelledby="openaiHostPermissionHost"
        >
            <div className="api-host-permission-heading">
                <span className="api-host-permission-icon" aria-hidden="true">
                    <svg viewBox="0 0 20 20">
                        <path d="M10 1.75 16 4v4.2c0 4.05-2.42 7.68-6 9.3-3.58-1.62-6-5.25-6-9.3V4l6-2.25Z" />
                        {state === 'granted' && (
                            <path
                                className="api-host-permission-mark"
                                d="m7.15 9.7 1.75 1.75 3.95-4.1"
                            />
                        )}
                        {(state === 'denied' || state === 'error') && (
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
                    {hostLabel(baseUrl)}
                </span>
            </div>
            <button
                type="button"
                className="api-host-permission-button"
                onClick={request}
                disabled={pending || !valid}
                aria-busy={pending}
            >
                {t('openaiHostPermissionButton')}
            </button>
            {scope !== '' && (
                <span className="api-host-permission-status">
                    {t('openaiHostPermissionScope', baseUrl, scope)}
                </span>
            )}
            <span className="api-host-permission-status" role="status">
                {current?.message ?? ''}
            </span>
        </div>
    );
}

export function AIContextSection({ t, settings, save }: SectionProps) {
    const baseUrlField = useCommittedTextField({
        value: settings.openaiBaseUrl,
        validate: (draft) => validateSetting('openaiBaseUrl', draft),
        onCommit: (draft) => save({ openaiBaseUrl: draft }),
    });
    const openaiModelField = useCommittedTextField({
        value: settings.openaiModel,
        validate: (draft) => validateSetting('openaiModel', draft),
        onCommit: (draft) => save({ openaiModel: draft }),
    });
    const timeoutField = useNumericField(
        'aiContextTimeout',
        settings.aiContextTimeout,
        save
    );
    const rateLimitField = useNumericField(
        'aiContextRateLimit',
        settings.aiContextRateLimit,
        save
    );
    const enabled = settings.aiContextEnabled;
    const provider = settings.aiContextProvider;
    const geminiListed = GEMINI_MODELS.some(
        (model) => model.id === settings.geminiModel
    );

    const setContextType = (type: ContextType, checked: boolean): void => {
        const next = CONTEXT_TYPES.filter((candidate) =>
            candidate === type
                ? checked
                : settings.aiContextTypes.includes(candidate)
        );
        void save({ aiContextTypes: next });
    };

    return (
        <section id="ai-context">
            <h2>{t('sectionAIContext')}</h2>

            <SettingCard
                title={t('cardAIContextToggleTitle')}
                description={t('cardAIContextToggleDesc')}
            >
                <div className="setting">
                    <label htmlFor="aiContextEnabled">
                        {t('aiContextEnabledLabel')}
                    </label>
                    <ToggleSwitch
                        id="aiContextEnabled"
                        checked={enabled}
                        onChange={(checked) =>
                            void save({ aiContextEnabled: checked })
                        }
                    />
                </div>
            </SettingCard>

            {enabled && (
                <SettingCard
                    title={t('cardAIContextProviderTitle')}
                    description={t('cardAIContextProviderDesc')}
                >
                    <div className="setting">
                        <label htmlFor="aiContextProvider">
                            {t('aiContextProviderLabel')}
                        </label>
                        <select
                            id="aiContextProvider"
                            value={provider}
                            onChange={(event) => {
                                if (isAiProvider(event.target.value)) {
                                    void save({
                                        aiContextProvider: event.target.value,
                                    });
                                }
                            }}
                        >
                            <option value="openai">OpenAI GPT</option>
                            <option value="gemini">Google Gemini</option>
                        </select>
                    </div>
                </SettingCard>
            )}

            {enabled && provider === 'openai' && (
                <SettingCard
                    title={t('cardOpenAIContextTitle')}
                    description={t('cardOpenAIContextDesc')}
                >
                    <div className="setting">
                        <label htmlFor="openaiApiKey">
                            {t('openaiApiKeyLabel')}
                        </label>
                        <input
                            type="password"
                            id="openaiApiKey"
                            autoComplete="off"
                            placeholder="sk-..."
                            value={settings.openaiApiKey}
                            onChange={(event) =>
                                void save({ openaiApiKey: event.target.value })
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="openaiBaseUrl">
                            {t('openaiBaseUrlLabel')}
                        </label>
                        <div className="api-host-control">
                            <input
                                type="url"
                                id="openaiBaseUrl"
                                placeholder="https://api.openai.com/v1"
                                value={baseUrlField.value}
                                aria-invalid={baseUrlField.invalid}
                                aria-describedby={
                                    baseUrlField.invalid
                                        ? 'openaiBaseUrlError'
                                        : undefined
                                }
                                onChange={(event) =>
                                    baseUrlField.change(event.target.value)
                                }
                                onBlur={() => void baseUrlField.commit()}
                                onKeyDown={baseUrlField.handleKeyDown}
                            />
                            <FieldError
                                id="openaiBaseUrlError"
                                visible={baseUrlField.invalid}
                                t={t}
                            />
                            <OpenAIHostPermission
                                t={t}
                                baseUrl={baseUrlField.value}
                                valid={baseUrlField.valid}
                            />
                        </div>
                    </div>

                    <div className="setting">
                        <label htmlFor="openaiModel">
                            {t('openaiModelLabel')}
                        </label>
                        <div>
                            <input
                                type="text"
                                id="openaiModel"
                                list="openaiModelOptions"
                                value={openaiModelField.value}
                                aria-invalid={openaiModelField.invalid}
                                aria-describedby={
                                    openaiModelField.invalid
                                        ? 'openaiModelError'
                                        : undefined
                                }
                                onChange={(event) =>
                                    openaiModelField.change(event.target.value)
                                }
                                onBlur={() => void openaiModelField.commit()}
                                onKeyDown={openaiModelField.handleKeyDown}
                            />
                            <FieldError
                                id="openaiModelError"
                                visible={openaiModelField.invalid}
                                t={t}
                            />
                            <datalist id="openaiModelOptions">
                                {OPENAI_MODELS.map((model) => (
                                    <option
                                        key={model.id}
                                        value={model.id}
                                        label={`${model.name}${model.recommended ? ' (Recommended)' : ''}`}
                                    />
                                ))}
                            </datalist>
                        </div>
                    </div>
                </SettingCard>
            )}

            {enabled && provider === 'gemini' && (
                <SettingCard
                    title={t('cardGeminiContextTitle')}
                    description={t('cardGeminiContextDesc')}
                >
                    <div className="setting">
                        <label htmlFor="geminiApiKey">
                            {t('geminiApiKeyLabel')}
                        </label>
                        <input
                            type="password"
                            id="geminiApiKey"
                            autoComplete="off"
                            placeholder="AIza..."
                            value={settings.geminiApiKey}
                            onChange={(event) =>
                                void save({ geminiApiKey: event.target.value })
                            }
                        />
                    </div>

                    <div className="setting">
                        <label htmlFor="geminiModel">
                            {t('geminiModelLabel')}
                        </label>
                        <select
                            id="geminiModel"
                            value={settings.geminiModel}
                            onChange={(event) =>
                                void save({ geminiModel: event.target.value })
                            }
                        >
                            {!geminiListed && (
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

            {enabled && (
                <SettingCard
                    title={t('cardAIContextTypesTitle')}
                    description={t('cardAIContextTypesDesc')}
                >
                    {CONTEXT_TYPES.map((type) => (
                        <div className="setting" key={type}>
                            <label htmlFor={`contextType-${type}`}>
                                {t(CONTEXT_TYPE_LABELS[type])}
                            </label>
                            <ToggleSwitch
                                id={`contextType-${type}`}
                                checked={settings.aiContextTypes.includes(type)}
                                onChange={(checked) =>
                                    setContextType(type, checked)
                                }
                            />
                        </div>
                    ))}
                    {settings.aiContextTypes.length === 0 && (
                        <p className="setting-help" role="alert">
                            {t('aiContextTypesRequired')}
                        </p>
                    )}
                </SettingCard>
            )}

            {enabled && (
                <SettingCard
                    title={t('cardAIContextAdvancedTitle')}
                    description={t('cardAIContextAdvancedDesc')}
                >
                    <NumericSetting
                        id="aiContextTimeout"
                        label={t('aiContextTimeoutLabel')}
                        field={timeoutField}
                        bounds={SETTING_BOUNDS.aiContextTimeout}
                        step={1000}
                        t={t}
                    />
                    <NumericSetting
                        id="aiContextRateLimit"
                        label={t('aiContextRateLimitLabel')}
                        field={rateLimitField}
                        bounds={SETTING_BOUNDS.aiContextRateLimit}
                        step={10}
                        t={t}
                    />
                    <div className="setting">
                        <label htmlFor="aiContextCacheEnabled">
                            {t('aiContextCacheEnabledLabel')}
                        </label>
                        <ToggleSwitch
                            id="aiContextCacheEnabled"
                            checked={settings.aiContextCacheEnabled}
                            onChange={(checked) =>
                                void save({ aiContextCacheEnabled: checked })
                            }
                        />
                    </div>
                    <div className="setting">
                        <label htmlFor="aiContextRetryAttempts">
                            {t('aiContextRetryAttemptsLabel')}
                        </label>
                        <input
                            type="number"
                            id="aiContextRetryAttempts"
                            min={SETTING_BOUNDS.aiContextRetryAttempts.min}
                            max={SETTING_BOUNDS.aiContextRetryAttempts.max}
                            step={1}
                            value={settings.aiContextRetryAttempts}
                            onChange={(event) => {
                                const attempts = Number.parseInt(
                                    event.target.value,
                                    10
                                );
                                if (
                                    validateSetting(
                                        'aiContextRetryAttempts',
                                        attempts
                                    )
                                ) {
                                    void save({
                                        aiContextRetryAttempts: attempts,
                                    });
                                }
                            }}
                        />
                    </div>
                </SettingCard>
            )}
        </section>
    );
}
