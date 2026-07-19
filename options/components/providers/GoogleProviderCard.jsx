import React from 'react';
import { SettingCard } from '../SettingCard.jsx';

export function GoogleProviderCard({ t }) {
    return (
        <SettingCard
            title={t('cardGoogleTitle', 'Google Translate')}
            description={t(
                'cardGoogleDesc',
                'Free translation service provided by Google. No additional configuration required.'
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
                        <li>
                            {t(
                                'featureWideLanguageSupport',
                                'Wide language support'
                            )}
                        </li>
                        <li>
                            {t('featureFastTranslation', 'Fast translation')}
                        </li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
