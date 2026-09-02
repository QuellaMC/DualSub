import { validateSetting } from '@/config/schema';
import type { Translate } from '../../hooks/useI18n';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { FieldError } from '../FieldError';
import { useOpenAIModels } from '../hooks/useOpenAIModels';
import { SettingCard } from '../SettingCard';
import { SparkleButton } from '../SparkleButton';
import { TestResultDisplay } from '../TestResultDisplay';
import type { SaveSettings } from '../types';

export function OpenAICompatibleProviderCard({
    t,
    apiKey,
    baseUrl,
    model,
    save,
}: {
    t: Translate;
    apiKey: string;
    baseUrl: string;
    model: string;
    save: SaveSettings;
}) {
    const catalog = useOpenAIModels(t, apiKey, baseUrl);
    const baseUrlField = useCommittedTextField({
        value: baseUrl,
        validate: (draft) => validateSetting('openaiCompatibleBaseUrl', draft),
        onCommit: (draft) => save({ openaiCompatibleBaseUrl: draft }),
    });
    // The saved model stays selectable even when the endpoint does not list it.
    const models = catalog.models.includes(model)
        ? catalog.models
        : [model, ...catalog.models];

    return (
        <SettingCard
            title={t('cardOpenAICompatibleTitle')}
            description={t('cardOpenAICompatibleDesc')}
        >
            <div className="setting">
                <label htmlFor="openaiCompatibleApiKey">
                    {t('apiKeyLabel')}
                </label>
                <input
                    type="password"
                    id="openaiCompatibleApiKey"
                    autoComplete="off"
                    placeholder={t('openaiApiKeyPlaceholder')}
                    value={apiKey}
                    onChange={(event) =>
                        void save({
                            openaiCompatibleApiKey: event.target.value,
                        })
                    }
                />
            </div>

            <div className="setting">
                <label htmlFor="openaiCompatibleBaseUrl">
                    {t('baseUrlLabel')}
                </label>
                <div>
                    <input
                        type="text"
                        id="openaiCompatibleBaseUrl"
                        placeholder={t('openaiBaseUrlPlaceholder')}
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
                    <FieldError
                        id="openaiCompatibleBaseUrlError"
                        visible={baseUrlField.invalid}
                        t={t}
                    />
                </div>
            </div>

            <div className="setting">
                <label htmlFor="openaiCompatibleModel">{t('modelLabel')}</label>
                <select
                    id="openaiCompatibleModel"
                    value={model}
                    onChange={(event) =>
                        void save({ openaiCompatibleModel: event.target.value })
                    }
                >
                    {models.map((id) => (
                        <option key={id} value={id}>
                            {id}
                        </option>
                    ))}
                </select>
            </div>

            <div className="setting test-setting">
                <TestResultDisplay result={catalog.result} />
                <SparkleButton
                    onClick={catalog.test}
                    disabled={catalog.busy !== 'idle' || !apiKey}
                >
                    {catalog.busy === 'testing'
                        ? t('testingButton')
                        : t('testConnectionButton')}
                </SparkleButton>
            </div>

            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerFeatures')}</strong>
                    <ul>
                        <li>{t('featureCustomizable')}</li>
                        <li>{t('featureApiKeyRequired')}</li>
                        <li>{t('featureWideLanguageSupport')}</li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
