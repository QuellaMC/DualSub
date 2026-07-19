import React, { useState, useEffect } from 'react';
import { GoogleProviderCard } from '../providers/GoogleProviderCard.jsx';
import { MicrosoftProviderCard } from '../providers/MicrosoftProviderCard.jsx';
import { DeepLProviderCard } from '../providers/DeepLProviderCard.jsx';
import { OpenAICompatibleProviderCard } from '../providers/OpenAICompatibleProviderCard.jsx';
import { VertexProviderCard } from '../providers/VertexProviderCard.jsx';
import { Providers } from '../../../content_scripts/shared/constants/providers.js';

const SUPPORTED_PROVIDERS = new Set(Object.values(Providers));

export function ProvidersSection({
    t,
    settings,
    onSettingChange,
    onSettingsChange,
}) {
    const selectedProvider = SUPPORTED_PROVIDERS.has(settings.selectedProvider)
        ? settings.selectedProvider
        : Providers.MICROSOFT_EDGE_AUTH;
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

            {selectedProvider === Providers.GOOGLE && (
                <GoogleProviderCard t={t} />
            )}

            {selectedProvider === Providers.MICROSOFT_EDGE_AUTH && (
                <MicrosoftProviderCard t={t} />
            )}

            {selectedProvider === Providers.DEEPL && (
                <DeepLProviderCard
                    t={t}
                    apiKey={settings.deeplApiKey || ''}
                    apiPlan={settings.deeplApiPlan || 'free'}
                    onApiKeyChange={(value) =>
                        onSettingChange('deeplApiKey', value)
                    }
                    onApiPlanChange={(value) =>
                        onSettingChange('deeplApiPlan', value)
                    }
                />
            )}

            {selectedProvider === Providers.OPENAI_COMPATIBLE && (
                <OpenAICompatibleProviderCard
                    t={t}
                    apiKey={settings.openaiCompatibleApiKey || ''}
                    baseUrl={settings.openaiCompatibleBaseUrl || ''}
                    model={settings.openaiCompatibleModel || ''}
                    models={openaiModels}
                    onApiKeyChange={(value) =>
                        onSettingChange('openaiCompatibleApiKey', value)
                    }
                    onBaseUrlChange={(value) =>
                        onSettingChange('openaiCompatibleBaseUrl', value)
                    }
                    onModelChange={(value) =>
                        onSettingChange('openaiCompatibleModel', value)
                    }
                    onModelsLoaded={handleOpenAIModelsLoaded}
                />
            )}

            {selectedProvider === Providers.VERTEX_GEMINI && (
                <VertexProviderCard
                    t={t}
                    accessToken={settings.vertexAccessToken || ''}
                    projectId={settings.vertexProjectId || ''}
                    location={settings.vertexLocation || 'us-central1'}
                    model={settings.vertexModel || 'gemini-2.5-flash'}
                    onAccessTokenChange={(value) =>
                        onSettingChange('vertexAccessToken', value)
                    }
                    onProjectIdChange={(value) =>
                        onSettingChange('vertexProjectId', value)
                    }
                    onLocationChange={(value) =>
                        onSettingChange('vertexLocation', value)
                    }
                    onModelChange={(value) =>
                        onSettingChange('vertexModel', value)
                    }
                    onProviderChange={(value) =>
                        onSettingChange('selectedProvider', value)
                    }
                    onCredentialsChange={onSettingsChange}
                />
            )}
        </section>
    );
}
