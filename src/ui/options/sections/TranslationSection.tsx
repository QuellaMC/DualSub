import { SETTING_BOUNDS } from '@/config/schema';
import { PROVIDER_IDS, type ProviderId } from '@/shared/providers';
import { SettingCard } from '../SettingCard';
import type { SectionProps } from '../types';

const PROVIDER_LABELS: Record<ProviderId, string> = {
    google: 'providerGoogleName',
    deepl: 'providerDeepLName',
    openai_compatible: 'providerOpenAICompatibleName',
    vertex_gemini: 'providerVertexGeminiName',
};

function isProviderId(value: string): value is ProviderId {
    return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function TranslationSection({ t, settings, save }: SectionProps) {
    const delayBounds = SETTING_BOUNDS.translationDelay;
    return (
        <section id="translation">
            <h2>{t('sectionTranslation')}</h2>

            <SettingCard
                title={t('cardTranslationEngineTitle')}
                description={t('cardTranslationEngineDesc')}
            >
                <div className="setting">
                    <label htmlFor="translationProvider">
                        {t('providerLabel')}
                    </label>
                    <select
                        id="translationProvider"
                        value={settings.selectedProvider}
                        onChange={(event) => {
                            if (isProviderId(event.target.value)) {
                                void save({
                                    selectedProvider: event.target.value,
                                });
                            }
                        }}
                    >
                        {PROVIDER_IDS.map((id) => (
                            <option key={id} value={id}>
                                {t(PROVIDER_LABELS[id])}
                            </option>
                        ))}
                    </select>
                </div>
            </SettingCard>

            <SettingCard
                title={t('cardPerformanceTitle')}
                description={t('cardPerformanceDesc')}
            >
                <div className="setting">
                    <label htmlFor="translationDelay">
                        {t('requestDelayLabel')}
                    </label>
                    <input
                        type="number"
                        id="translationDelay"
                        min={delayBounds.min}
                        max={delayBounds.max}
                        step="50"
                        value={settings.translationDelay}
                        onChange={(event) => {
                            const delay = Number.parseInt(
                                event.target.value,
                                10
                            );
                            if (
                                Number.isInteger(delay) &&
                                delay >= delayBounds.min &&
                                delay <= delayBounds.max
                            ) {
                                void save({ translationDelay: delay });
                            }
                        }}
                    />
                </div>
            </SettingCard>
        </section>
    );
}
