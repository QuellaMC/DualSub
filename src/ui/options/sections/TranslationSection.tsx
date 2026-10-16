import { SETTING_BOUNDS, validateSetting } from '@/config/schema';
import type { ProviderId } from '@/shared/providers';
import { Icon } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import { useCommittedTextField } from '../../hooks/useCommittedTextField';
import { useTranslationHealth } from '../../hooks/useTranslationHealth';
import { CommittedField } from '../controls/CommittedField';
import { DeepLProviderCard } from '../providers/DeepLProviderCard';
import { OpenAICompatibleProviderCard } from '../providers/OpenAICompatibleProviderCard';
import { VertexProviderCard } from '../providers/VertexProviderCard';
import { SharedTag } from '../shell/scopeContext';
import type { SectionProps } from '../types';

const PROVIDERS: readonly {
    id: ProviderId;
    nameKey: string;
    helpKey: string;
    tags: readonly { textKey: string; tone: string }[];
    advanced?: true;
}[] = [
    {
        id: 'microsoft_edge',
        nameKey: 'providerMicrosoft',
        helpKey: 'providerMicrosoftHelp',
        tags: [
            { textKey: 'tagFree', tone: 'ok' },
            { textKey: 'tagNoSetup', tone: 'ok' },
            { textKey: 'commonRecommended', tone: 'accent' },
        ],
    },
    {
        id: 'google',
        nameKey: 'providerGoogle',
        helpKey: 'providerGoogleHelp',
        tags: [
            { textKey: 'tagFree', tone: 'ok' },
            { textKey: 'tagNoSetup', tone: 'ok' },
        ],
    },
    {
        id: 'deepl',
        nameKey: 'providerDeepL',
        helpKey: 'providerDeepLHelp',
        tags: [{ textKey: 'tagNeedsKey', tone: 'muted' }],
    },
    {
        id: 'openai_compatible',
        nameKey: 'providerAi',
        helpKey: 'providerAiHelp',
        tags: [{ textKey: 'tagNeedsKey', tone: 'muted' }],
    },
    {
        id: 'vertex_gemini',
        nameKey: 'providerVertex',
        helpKey: 'providerVertexHelp',
        tags: [{ textKey: 'tagGoogleCloud', tone: 'advanced' }],
        advanced: true,
    },
];

const PROVIDER_NAME_KEYS = Object.fromEntries(
    PROVIDERS.map((provider) => [provider.id, provider.nameKey])
) as Record<ProviderId, string>;

const PROBLEM_KEYS = {
    credentials: 'healthCredentials',
    quota: 'healthQuota',
    rejected: 'healthRejected',
} as const;

export function TranslationSection({
    t,
    settings,
    save,
    advanced,
}: SectionProps & { advanced: boolean }) {
    const health = useTranslationHealth();
    const delayBounds = SETTING_BOUNDS.translationDelay;
    const delay = useCommittedTextField({
        value: String(settings.translationDelay),
        validate: (draft) =>
            draft.trim() !== '' &&
            validateSetting('translationDelay', Number(draft)),
        onCommit: (draft) => save({ translationDelay: Number(draft) }, 'quiet'),
    });
    const listed = PROVIDERS.filter(
        (provider) =>
            advanced ||
            !provider.advanced ||
            provider.id === settings.selectedProvider
    );

    return (
        <section className="section" aria-labelledby="translation-title">
            <h1 id="translation-title" tabIndex={-1}>
                {t('navTranslation')}
            </h1>
            <p className="lead">{t('translationLead')}</p>
            <SharedTag />

            {health?.provider === settings.selectedProvider && (
                <div className="notice danger" role="status">
                    <Icon name="alert" />
                    <div className="stack">
                        <strong>
                            {t(
                                'healthTitle',
                                t(PROVIDER_NAME_KEYS[health.provider])
                            )}
                        </strong>
                        <span>{t(PROBLEM_KEYS[health.problem])}</span>
                        <span>
                            {health.fallback
                                ? t(
                                      'healthCovered',
                                      t(PROVIDER_NAME_KEYS[health.fallback])
                                  )
                                : t('healthNotCovered')}
                        </span>
                    </div>
                </div>
            )}

            <div className="card" id="translation-service">
                <h2 className="label" id="translation-service-title">
                    {t('translationServiceTitle')}
                </h2>
                <div
                    className="providers"
                    role="radiogroup"
                    aria-labelledby="translation-service-title"
                >
                    {listed.map((provider) => (
                        <button
                            key={provider.id}
                            type="button"
                            role="radio"
                            className="choice"
                            aria-checked={
                                settings.selectedProvider === provider.id
                            }
                            onClick={() =>
                                void save(
                                    { selectedProvider: provider.id },
                                    {
                                        message: t(
                                            'toastProvider',
                                            t(provider.nameKey)
                                        ),
                                    }
                                )
                            }
                        >
                            <span className="choice-title">
                                {t(provider.nameKey)}
                                {provider.tags.map((tag) => (
                                    <span
                                        key={tag.textKey}
                                        className={`tag ${tag.tone}`}
                                    >
                                        {t(tag.textKey)}
                                    </span>
                                ))}
                            </span>
                            <span className="help">{t(provider.helpKey)}</span>
                        </button>
                    ))}
                </div>
            </div>

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
                    advanced={advanced}
                    save={save}
                />
            )}
            {settings.selectedProvider === 'vertex_gemini' && (
                <VertexProviderCard t={t} settings={settings} save={save} />
            )}

            <div className="card" id="translation-fallback">
                <div className="row">
                    <div className="grow">
                        <div className="label" id="translation-fallback-title">
                            {t('translationFallbackTitle')}
                        </div>
                        <div className="help">
                            {t('translationFallbackHelp')}
                        </div>
                    </div>
                    <Switch
                        checked={settings.translationFallback}
                        labelledBy="translation-fallback-title"
                        onChange={(fallback) =>
                            void save(
                                { translationFallback: fallback },
                                {
                                    message: t(
                                        fallback
                                            ? 'toastFallbackOn'
                                            : 'toastFallbackOff'
                                    ),
                                }
                            )
                        }
                    />
                </div>
            </div>

            {advanced && (
                <div className="card" id="translation-delay">
                    <div className="row">
                        <div className="grow">
                            <label
                                className="label"
                                htmlFor="translation-delay-field"
                            >
                                {t('translationDelayTitle')}{' '}
                                <span className="tag advanced">
                                    {t('commonAdvanced')}
                                </span>
                            </label>
                            <div className="help">
                                {t('translationDelayHelp')}
                            </div>
                        </div>
                        <div className="stack">
                            <CommittedField
                                t={t}
                                id="translation-delay-field"
                                field={delay}
                                type="number"
                                min={delayBounds.min}
                                max={delayBounds.max}
                                step={50}
                                className="mono narrow"
                            />
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
