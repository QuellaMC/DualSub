import React from 'react';
import { SettingCard } from '../SettingCard.jsx';

export function DeepLFreeProviderCard({ t }) {
    return (
        <SettingCard
            title={t('cardDeepLFreeTitle', 'DeepL Translate (Free)')}
            description={t(
                'cardDeepLFreeDesc',
                "Free DeepL translation service with high quality results. No API key required - uses DeepL's web interface."
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
                                'featureHighestQuality',
                                'Highest quality translation'
                            )}
                        </li>
                        <li>
                            {t(
                                'featureWideLanguageSupport',
                                'Wide language support'
                            )}
                        </li>
                        <li>
                            {t(
                                'featureMultipleBackups',
                                'Multiple backup methods'
                            )}
                        </li>
                    </ul>
                </div>
                <div className="info-item">
                    <strong>{t('providerNotes', 'Notes:')}</strong>
                    <ul>
                        <li>
                            {t(
                                'noteSlowForSecurity',
                                'Slightly slower due to security measures'
                            )}
                        </li>
                        <li>
                            {t(
                                'noteAutoFallback',
                                'Automatic fallback to alternative services'
                            )}
                        </li>
                        <li>
                            {t(
                                'noteRecommendedDefault',
                                'Recommended as default provider'
                            )}
                        </li>
                    </ul>
                </div>
            </div>
        </SettingCard>
    );
}
