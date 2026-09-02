import { DeepLProviderCard } from '../providers/DeepLProviderCard';
import { OpenAICompatibleProviderCard } from '../providers/OpenAICompatibleProviderCard';
import { StaticProviderCard } from '../providers/StaticProviderCard';
import { VertexProviderCard } from '../providers/VertexProviderCard';
import type { SectionProps } from '../types';

export function ProvidersSection({ t, settings, save }: SectionProps) {
    return (
        <section id="providers">
            <h2>{t('sectionProviders')}</h2>

            {settings.selectedProvider === 'google' && (
                <StaticProviderCard
                    t={t}
                    titleKey="cardGoogleTitle"
                    descriptionKey="cardGoogleDesc"
                    featureKeys={[
                        'featureFree',
                        'featureNoApiKey',
                        'featureWideLanguageSupport',
                        'featureFastTranslation',
                    ]}
                />
            )}

            {settings.selectedProvider === 'microsoft_edge_auth' && (
                <StaticProviderCard
                    t={t}
                    titleKey="cardMicrosoftTitle"
                    descriptionKey="cardMicrosoftDesc"
                    featureKeys={[
                        'featureFree',
                        'featureNoApiKey',
                        'featureHighQuality',
                        'featureGoodPerformance',
                    ]}
                />
            )}

            {settings.selectedProvider === 'deepl' && (
                <DeepLProviderCard
                    t={t}
                    apiKey={settings.deeplApiKey}
                    plan={settings.deeplApiPlan}
                    save={save}
                />
            )}

            {settings.selectedProvider === 'openai_compatible' && (
                <OpenAICompatibleProviderCard
                    t={t}
                    apiKey={settings.openaiCompatibleApiKey}
                    baseUrl={settings.openaiCompatibleBaseUrl}
                    model={settings.openaiCompatibleModel}
                    save={save}
                />
            )}

            {settings.selectedProvider === 'vertex_gemini' && (
                <VertexProviderCard t={t} settings={settings} save={save} />
            )}
        </section>
    );
}
