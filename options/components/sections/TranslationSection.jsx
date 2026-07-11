import React from 'react';
import { SettingCard } from '../SettingCard.jsx';
import { Providers } from '../../../content_scripts/shared/constants/providers.js';

const AVAILABLE_PROVIDERS = {
    [Providers.GOOGLE]: 'providerGoogleName',
    [Providers.MICROSOFT_EDGE_AUTH]: 'providerMicrosoftName',
    [Providers.DEEPL]: 'providerDeepLName',
    [Providers.OPENAI_COMPATIBLE]: 'providerOpenAICompatibleName',
    [Providers.VERTEX_GEMINI]: 'providerVertexGeminiName',
};

export function TranslationSection({ t, settings, onSettingChange }) {
    const selectedProvider = Object.hasOwn(
        AVAILABLE_PROVIDERS,
        settings.selectedProvider
    )
        ? settings.selectedProvider
        : Providers.MICROSOFT_EDGE_AUTH;

    return (
        <section id="translation">
            <h2>{t('sectionTranslation', 'Translation')}</h2>

            <SettingCard
                title={t('cardTranslationEngineTitle', 'Translation Engine')}
                description={t(
                    'cardTranslationEngineDesc',
                    'Select your preferred translation service.'
                )}
            >
                <div className="setting">
                    <label htmlFor="translationProvider">
                        {t('providerLabel', 'Provider:')}
                    </label>
                    <select
                        id="translationProvider"
                        value={selectedProvider}
                        onChange={(event) =>
                            onSettingChange(
                                'selectedProvider',
                                event.target.value
                            )
                        }
                    >
                        {Object.entries(AVAILABLE_PROVIDERS).map(
                            ([id, nameKey]) => (
                                <option key={id} value={id}>
                                    {t(nameKey, id)}
                                </option>
                            )
                        )}
                    </select>
                </div>
            </SettingCard>

            <SettingCard
                title={t('cardPerformanceTitle', 'Performance')}
                description={t(
                    'cardPerformanceDesc',
                    'Adjust the delay between subtitle translation requests to balance speed and provider stability.'
                )}
            >
                <div className="setting">
                    <label htmlFor="translationDelay">
                        {t('requestDelayLabel', 'Request Delay (ms):')}
                    </label>
                    <input
                        type="number"
                        id="translationDelay"
                        min="0"
                        max="5000"
                        step="50"
                        value={settings.translationDelay ?? 150}
                        onChange={(event) =>
                            onSettingChange(
                                'translationDelay',
                                Number.parseInt(event.target.value, 10)
                            )
                        }
                    />
                </div>
            </SettingCard>
        </section>
    );
}
