import React, { useEffect, useState } from 'react';
import { SettingCard } from '../SettingCard.jsx';

export function AboutSection({ t }) {
    const [version, setVersion] = useState('');

    useEffect(() => {
        const manifest = chrome.runtime.getManifest();
        setVersion(manifest.version);
    }, []);

    return (
        <section id="about">
            <h2>{t('sectionAbout', 'About')}</h2>
            <SettingCard title={t('cardAboutTitle', 'DualSub')}>
                <p>
                    <span>{t('aboutVersion', 'Version')} </span>
                    <span>{version}</span>
                </p>
                <p>
                    {t(
                        'aboutDescription',
                        'This extension helps you watch videos with dual language subtitles on various platforms.'
                    )}
                </p>
                <p>{t('aboutDevelopment', 'Developed by ')} </p>
            </SettingCard>
        </section>
    );
}
