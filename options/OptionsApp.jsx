import React, { useState, useEffect } from 'react';
import { useSettings, useTranslation } from '../popup/hooks/index.js';
import { Sidebar } from './components/Sidebar.jsx';
import { GeneralSection } from './components/sections/GeneralSection.jsx';
import { TranslationSection } from './components/sections/TranslationSection.jsx';
import { ProvidersSection } from './components/sections/ProvidersSection.jsx';
import { AIContextSection } from './components/sections/AIContextSection.jsx';
import { AboutSection } from './components/sections/AboutSection.jsx';

export function OptionsApp() {
    const [activeSection, setActiveSection] = useState('general');
    const { settings, updateSetting, loading } = useSettings();
    const [currentLanguage, setCurrentLanguage] = useState(
        settings.uiLanguage || 'en'
    );
    const { t } = useTranslation(currentLanguage);

    // Update language when settings change
    useEffect(() => {
        if (settings.uiLanguage && settings.uiLanguage !== currentLanguage) {
            setCurrentLanguage(settings.uiLanguage);
        }
    }, [settings.uiLanguage, currentLanguage]);

    const handleSettingChange = async (key, value) => {
        await updateSetting(key, value);

        // If language changes, reload translations
        if (key === 'uiLanguage') {
            setCurrentLanguage(value);
        }
    };

    if (loading) {
        return (
            <div className="container">
                <div className="content">
                    <p>Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <Sidebar
                t={t}
                activeSection={activeSection}
                onSectionChange={setActiveSection}
            />
            <main className="content">
                {activeSection === 'general' && (
                    <GeneralSection
                        t={t}
                        settings={settings}
                        onSettingChange={handleSettingChange}
                    />
                )}
                {activeSection === 'translation' && (
                    <TranslationSection
                        t={t}
                        settings={settings}
                        onSettingChange={handleSettingChange}
                    />
                )}
                {activeSection === 'providers' && (
                    <ProvidersSection
                        t={t}
                        settings={settings}
                        onSettingChange={handleSettingChange}
                    />
                )}
                {activeSection === 'ai-context' && (
                    <AIContextSection
                        t={t}
                        settings={settings}
                        onSettingChange={handleSettingChange}
                    />
                )}
                {activeSection === 'about' && <AboutSection t={t} />}
            </main>
        </div>
    );
}
