import type { Translate } from '../../hooks/useI18n';
import { useDeepLCheck } from '../hooks/useDeepLCheck';
import { SettingCard } from '../SettingCard';
import { SparkleButton } from '../SparkleButton';
import { TestResultDisplay } from '../TestResultDisplay';
import type { SaveSettings } from '../types';

export function DeepLProviderCard({
    t,
    apiKey,
    plan,
    save,
}: {
    t: Translate;
    apiKey: string;
    plan: 'free' | 'pro';
    save: SaveSettings;
}) {
    const check = useDeepLCheck(t, apiKey, plan);

    return (
        <SettingCard
            title={t('cardDeepLTitle')}
            description={t('cardDeepLDesc')}
        >
            <div className="setting">
                <label htmlFor="deeplApiKey">{t('apiKeyLabel')}</label>
                <input
                    type="password"
                    id="deeplApiKey"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(event) =>
                        void save({ deeplApiKey: event.target.value })
                    }
                />
            </div>

            <div className="setting">
                <label htmlFor="deeplApiPlan">{t('apiPlanLabel')}</label>
                <select
                    id="deeplApiPlan"
                    value={plan}
                    onChange={(event) =>
                        void save({
                            deeplApiPlan:
                                event.target.value === 'pro' ? 'pro' : 'free',
                        })
                    }
                >
                    <option value="free">{t('apiPlanFree')}</option>
                    <option value="pro">{t('apiPlanPro')}</option>
                </select>
            </div>

            <div className="setting test-setting">
                <TestResultDisplay result={check.result} />
                <SparkleButton
                    onClick={check.run}
                    disabled={check.testing || !apiKey}
                >
                    {check.testing ? t('testingButton') : t('testDeepLButton')}
                </SparkleButton>
            </div>

            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerFeatures')}</strong>
                    <ul>
                        <li>{t('featureHighestQuality')}</li>
                        <li>{t('featureApiKeyRequired')}</li>
                        <li>{t('featureLimitedLanguages')}</li>
                        <li>{t('featureUsageLimits')}</li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
