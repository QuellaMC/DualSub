import React, { useState, useEffect } from 'react';
import { GoogleProviderCard } from '../providers/GoogleProviderCard.jsx';
import { MicrosoftProviderCard } from '../providers/MicrosoftProviderCard.jsx';
import { DeepLFreeProviderCard } from '../providers/DeepLFreeProviderCard.jsx';
import { DeepLProviderCard } from '../providers/DeepLProviderCard.jsx';
import { OpenAICompatibleProviderCard } from '../providers/OpenAICompatibleProviderCard.jsx';

export function ProvidersSection({ t, settings, onSettingChange }) {
    const selectedProvider = settings.selectedProvider || 'deepl_free';
    const [openaiModels, setOpenaiModels] = useState([]);

    // Load saved OpenAI models
    useEffect(() => {
        if (settings.openaiCompatibleModel) {
            setOpenaiModels([settings.openaiCompatibleModel]);
        }
    }, [settings.openaiCompatibleModel]);

    const handleOpenAIModelsLoaded = async (models) => {
        setOpenaiModels(models);
        
        // Save the first model as default if no model is currently selected
        if (models && models.length > 0) {
            const savedModel = settings.openaiCompatibleModel;
            const isValidModel = savedModel && models.includes(savedModel);
            
            if (!isValidModel) {
                // Use first model as default
                await onSettingChange('openaiCompatibleModel', models[0]);
            }
        }
    };

    return (
        <section id="providers">
            <h2>{t('sectionProviders', 'Provider Settings')}</h2>

            {selectedProvider === 'google' && (
                <GoogleProviderCard t={t} />
            )}

            {selectedProvider === 'microsoft_edge_auth' && (
                <MicrosoftProviderCard t={t} />
            )}

            {selectedProvider === 'deepl_free' && (
                <DeepLFreeProviderCard t={t} />
            )}

            {selectedProvider === 'deepl' && (
                <DeepLProviderCard
                    t={t}
                    apiKey={settings.deeplApiKey || ''}
                    apiPlan={settings.deeplApiPlan || 'free'}
                    onApiKeyChange={(value) => onSettingChange('deeplApiKey', value)}
                    onApiPlanChange={(value) => onSettingChange('deeplApiPlan', value)}
                />
            )}

            {selectedProvider === 'openai_compatible' && (
                <OpenAICompatibleProviderCard
                    t={t}
                    apiKey={settings.openaiCompatibleApiKey || ''}
                    baseUrl={settings.openaiCompatibleBaseUrl || ''}
                    model={settings.openaiCompatibleModel || ''}
                    models={openaiModels}
                    onApiKeyChange={(value) => onSettingChange('openaiCompatibleApiKey', value)}
                    onBaseUrlChange={(value) => onSettingChange('openaiCompatibleBaseUrl', value)}
                    onModelChange={(value) => onSettingChange('openaiCompatibleModel', value)}
                    onModelsLoaded={handleOpenAIModelsLoaded}
                />
            )}
        </section>
    );
}
