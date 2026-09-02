import type { Translate } from '../../hooks/useI18n';
import { SettingCard } from '../SettingCard';

/** A provider that needs no configuration: status plus feature notes. */
export function StaticProviderCard({
    t,
    titleKey,
    descriptionKey,
    featureKeys,
}: {
    t: Translate;
    titleKey: string;
    descriptionKey: string;
    featureKeys: readonly string[];
}) {
    return (
        <SettingCard title={t(titleKey)} description={t(descriptionKey)}>
            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerStatus')}</strong>
                    <span className="status-badge success">
                        {t('statusReady')}
                    </span>
                </div>
                <div className="info-item">
                    <strong>{t('providerFeatures')}</strong>
                    <ul>
                        {featureKeys.map((key) => (
                            <li key={key}>{t(key)}</li>
                        ))}
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
