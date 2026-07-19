import React from 'react';
import { SettingCard } from '../SettingCard.jsx';

export function MicrosoftProviderCard({ t }) {
    return (
        <SettingCard
            title={t('cardMicrosoftTitle', 'Microsoft Translate')}
            description={t(
                'cardMicrosoftDesc',
                'Free translation service provided by Microsoft Edge. No additional configuration required.'
            )}
        >
            <div className="provider-info">
                <div className="info-item">
                    <strong>{t('providerStatus', 'Status:')}</strong>
                    <span className="status-badge success">
                        {t('statusReady', 'Ready to use')}
                    </span>
                </div>
                <div className="info-item">
                    <strong>{t('providerFeatures', 'Features:')}</strong>
                    <ul>
                        <li>{t('featureFree', 'Free to use')}</li>
                        <li>{t('featureNoApiKey', 'No API key required')}</li>
                        <li>{t('featureHighQuality', 'High quality translation')}</li>
                        <li>{t('featureGoodPerformance', 'Good performance')}</li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
