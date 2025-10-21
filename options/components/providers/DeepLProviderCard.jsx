import React, { useEffect } from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { SparkleButton } from '../SparkleButton.jsx';
import { TestResultDisplay } from '../TestResultDisplay.jsx';
import { useDeepLTest } from '../../hooks/index.js';

export function DeepLProviderCard({ t, apiKey, apiPlan, onApiKeyChange, onApiPlanChange }) {
    const { testResult, testing, testConnection, initializeStatus } = useDeepLTest(t);

    // Initialize status when component mounts or API key changes
    useEffect(() => {
        initializeStatus(apiKey);
    }, [apiKey, initializeStatus]);

    const handleTest = () => {
        testConnection(apiKey, apiPlan);
    };

    return (
        <SettingCard
            title={t('cardDeepLTitle', 'DeepL (API Key Required)')}
            description={t(
                'cardDeepLDesc',
                'Enter your API key for DeepL Translate. Choose between Free and Pro plans.'
            )}
        >
            <div className="setting">
                <label htmlFor="deeplApiKey">
                    {t('apiKeyLabel', 'API Key:')}
                </label>
                <input
                    type="password"
                    id="deeplApiKey"
                    placeholder="Enter your DeepL API key"
                    value={apiKey}
                    onChange={(e) => onApiKeyChange(e.target.value)}
                />
            </div>

            <div className="setting">
                <label htmlFor="deeplApiPlan">
                    {t('apiPlanLabel', 'API Plan:')}
                </label>
                <select
                    id="deeplApiPlan"
                    value={apiPlan}
                    onChange={(e) => onApiPlanChange(e.target.value)}
                >
                    <option value="free">
                        {t('apiPlanFree', 'DeepL API Free')}
                    </option>
                    <option value="pro">
                        {t('apiPlanPro', 'DeepL API Pro')}
                    </option>
                </select>
            </div>

            <div className="setting deepl-test-setting">
                <TestResultDisplay result={testResult} />
                <SparkleButton
                    onClick={handleTest}
                    disabled={testing || !apiKey}
                >
                    {testing 
                        ? t('testingButton', 'Testing...')
                        : t('testDeepLButton', 'Test DeepL Connection')
                    }
                </SparkleButton>
            </div>

            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerFeatures', 'Features:')}</strong>
                    <ul>
                        <li>{t('featureHighestQuality', 'Highest quality translation')}</li>
                        <li>{t('featureApiKeyRequired', 'API key required')}</li>
                        <li>{t('featureLimitedLanguages', 'Limited language support')}</li>
                        <li>{t('featureUsageLimits', 'Usage limits apply')}</li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
