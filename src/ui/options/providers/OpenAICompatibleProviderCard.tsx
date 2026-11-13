import { useState } from 'react';
import { validateSetting } from '@/config/schema';
import { keyEntry } from '@/shared/keyOrigins';
import { Icon } from '../../design/Icon';
import type { Translate } from '../../hooks/useI18n';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { CommittedField } from '../controls/CommittedField';
import { useOpenAIModels } from '../hooks/useOpenAIModels';
import { TestResultDisplay } from '../TestResultDisplay';
import type { SaveSettings } from '../types';

/** Services most people mean by "AI translation", by their compatible
 *  endpoint; anything else is another service at its own address. */
const AI_SERVICES = [
    {
        id: 'gemini',
        labelKey: 'setupServiceGemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-flash',
        keyPage: 'https://aistudio.google.com/apikey',
        keyPageKey: 'setupOpenAIStudio',
        keyHelpKey: 'setupGeminiKeyHelp',
    },
    {
        id: 'openai',
        labelKey: 'setupServiceOpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.6-luna',
        keyPage: 'https://platform.openai.com/api-keys',
        keyPageKey: 'setupOpenOpenAI',
        keyHelpKey: 'setupOpenAIKeyHelp',
    },
] as const;

export function OpenAICompatibleProviderCard({
    t,
    apiKey,
    baseUrl,
    model,
    advanced,
    save,
}: {
    t: Translate;
    apiKey: string;
    baseUrl: string;
    model: string;
    advanced: boolean;
    save: SaveSettings;
}) {
    const catalog = useOpenAIModels(t, apiKey, baseUrl);
    const baseUrlField = useCommittedTextField({
        value: baseUrl,
        validate: (draft) => validateSetting('openaiCompatibleBaseUrl', draft),
        onCommit: (draft) => save({ openaiCompatibleBaseUrl: draft }, 'quiet'),
    });
    const preset = AI_SERVICES.find((entry) => entry.baseUrl === baseUrl);
    const [choseOther, setChoseOther] = useState(false);
    const service = choseOther ? undefined : preset;
    // The saved model stays selectable even when the endpoint does not list it.
    const models = catalog.models.includes(model)
        ? catalog.models
        : [model, ...catalog.models];

    return (
        <div
            className="card"
            id="ai-translation-card"
            aria-labelledby="ai-translation-setup"
        >
            <h2 className="label" id="ai-translation-setup">
                {t('translationAiSetupTitle')}
            </h2>
            <ol className="steps">
                <li>
                    <div>
                        <div className="strong" id="ai-translation-service">
                            {t('setupChooseService')}
                        </div>
                        <div
                            className="segmented"
                            role="group"
                            aria-labelledby="ai-translation-service"
                        >
                            {AI_SERVICES.map((entry) => (
                                <button
                                    key={entry.id}
                                    type="button"
                                    aria-pressed={service?.id === entry.id}
                                    onClick={() => {
                                        setChoseOther(false);
                                        void save(
                                            {
                                                openaiCompatibleBaseUrl:
                                                    entry.baseUrl,
                                                openaiCompatibleModel:
                                                    entry.model,
                                            },
                                            'quiet'
                                        );
                                    }}
                                >
                                    {t(entry.labelKey)}
                                </button>
                            ))}
                            <button
                                type="button"
                                aria-pressed={service === undefined}
                                onClick={() => setChoseOther(true)}
                            >
                                {t('setupServiceOther')}
                            </button>
                        </div>
                    </div>
                </li>
                <li>
                    <div>
                        <div className="strong">{t('setupGetKey')}</div>
                        <p className="help">
                            {t(service?.keyHelpKey ?? 'setupOtherKeyHelp')}
                        </p>
                        {service && (
                            <a
                                className="button"
                                href={service.keyPage}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t(service.keyPageKey)}
                                <Icon name="external" />
                            </a>
                        )}
                    </div>
                </li>
                <li>
                    <div className="grow">
                        <label
                            className="strong"
                            htmlFor="openaiCompatibleApiKey"
                        >
                            {t('setupPasteKey')}
                        </label>
                        <div className="inline wrap">
                            <input
                                type="password"
                                id="openaiCompatibleApiKey"
                                className="field grow"
                                autoComplete="off"
                                value={apiKey}
                                onChange={(event) =>
                                    void save(
                                        keyEntry(
                                            'openaiCompatibleApiKey',
                                            event.target.value,
                                            baseUrl
                                        ),
                                        'quiet'
                                    )
                                }
                            />
                            <button
                                type="button"
                                className="button primary"
                                onClick={catalog.test}
                                disabled={catalog.busy !== 'idle' || !apiKey}
                            >
                                {catalog.busy === 'testing'
                                    ? t('testingButton')
                                    : t('setupCheckKey')}
                            </button>
                        </div>
                        <TestResultDisplay result={catalog.result} />
                    </div>
                </li>
            </ol>
            {(advanced || service === undefined) && (
                <div className="controls-grid">
                    <div className="control">
                        <label htmlFor="openaiCompatibleBaseUrl">
                            {t('setupAddress')}
                        </label>
                        <CommittedField
                            t={t}
                            id="openaiCompatibleBaseUrl"
                            field={baseUrlField}
                            type="url"
                            className="wide mono"
                            placeholder="https://…/v1"
                        />
                    </div>
                    <div className="control">
                        <label htmlFor="openaiCompatibleModel">
                            {t('setupModel')}
                        </label>
                        <select
                            id="openaiCompatibleModel"
                            className="field wide mono"
                            value={model}
                            onChange={(event) =>
                                void save(
                                    {
                                        openaiCompatibleModel:
                                            event.target.value,
                                    },
                                    'quiet'
                                )
                            }
                        >
                            {models.map((id) => (
                                <option key={id} value={id}>
                                    {id}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            )}
        </div>
    );
}
