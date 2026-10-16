import type { ReactNode } from 'react';
import type { ProviderId } from '@/shared/providers';
import { Icon } from './design/Icon';
import type { Translate } from './hooks/useI18n';
import { useTranslationHealth } from './hooks/useTranslationHealth';
import { PROVIDER_NAME_KEYS } from './providerNames';

const PROBLEM_KEYS = {
    credentials: 'healthCredentials',
    quota: 'healthQuota',
    rejected: 'healthRejected',
} as const;

/** The chosen translation service's standing failure, and who translates
 *  meanwhile; nothing while it works. */
export function HealthNotice({
    t,
    provider,
    children,
}: {
    t: Translate;
    provider: ProviderId;
    children?: ReactNode;
}) {
    const health = useTranslationHealth();
    if (health?.provider !== provider) {
        return null;
    }
    return (
        <div className="notice danger" role="status">
            <Icon name="alert" />
            <div className="stack">
                <strong>
                    {t('healthTitle', t(PROVIDER_NAME_KEYS[health.provider]))}
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
                {children}
            </div>
        </div>
    );
}
