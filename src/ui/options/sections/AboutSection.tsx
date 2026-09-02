import { browser } from 'wxt/browser';
import type { Translate } from '../../hooks/useI18n';
import { SettingCard } from '../SettingCard';

export function AboutSection({ t }: { t: Translate }) {
    return (
        <section id="about">
            <h2>{t('sectionAbout')}</h2>
            <SettingCard title={t('cardAboutTitle')}>
                <p>
                    <span>{t('aboutVersion')} </span>
                    <span>{browser.runtime.getManifest().version}</span>
                </p>
                <p>{t('aboutDescription')}</p>
                <p>{t('aboutDevelopment')}</p>
            </SettingCard>
        </section>
    );
}
