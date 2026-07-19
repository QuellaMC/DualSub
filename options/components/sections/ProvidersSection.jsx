import React, { useState } from 'react';
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
    const currentOpenAIIdentity = {
        apiKey: settings.openaiCompatibleApiKey || '',
        baseUrl: settings.openaiCompatibleBaseUrl || '',
    };
    const [openAIModelCatalog, setOpenAIModelCatalog] = useState({
        apiKey: null,
        baseUrl: null,
        models: [],
    });
    const fetchedOpenAIModels =
        openAIModelCatalog.apiKey === currentOpenAIIdentity.apiKey &&
        openAIModelCatalog.baseUrl === currentOpenAIIdentity.baseUrl
            ? openAIModelCatalog.models
            : [];
    const savedOpenAIModel = settings.openaiCompatibleModel;
    const openaiModels =
        savedOpenAIModel && !fetchedOpenAIModels.includes(savedOpenAIModel)
            ? [savedOpenAIModel, ...fetchedOpenAIModels]
            : fetchedOpenAIModels;

    const handleOpenAIModelsLoaded = async (models, requestIdentity) => {
        const publishedIdentity = requestIdentity ?? currentOpenAIIdentity;
        if (
            publishedIdentity?.apiKey !== currentOpenAIIdentity.apiKey ||
            publishedIdentity?.baseUrl !== currentOpenAIIdentity.baseUrl
        ) {
            return false;
        }
        const publishedModels = Array.isArray(models) ? models : [];
        setOpenAIModelCatalog({
            ...currentOpenAIIdentity,
            models: publishedModels,
        });

        // Save the first model as default if no model is currently selected
        if (publishedModels.length > 0) {
            const savedModel = settings.openaiCompatibleModel;
            const hasSavedModel =
                typeof savedModel === 'string' && savedModel.trim().length > 0;

            if (!hasSavedModel) {
                // Use first model as default
                await onSettingChange(
                    'openaiCompatibleModel',
                    publishedModels[0]
                );
            }
        }
        return true;
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
