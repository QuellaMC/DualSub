import React, { useState, useEffect } from 'react';
import { useSettings, useTranslation } from '../popup/hooks/index.js';
import { OPTIONS_SETTINGS_KEYS } from '../shared/settingsProjections.js';
import { Sidebar } from './components/Sidebar.jsx';
import { GeneralSection } from './components/sections/GeneralSection.jsx';
import { TranslationSection } from './components/sections/TranslationSection.jsx';
import { ProvidersSection } from './components/sections/ProvidersSection.jsx';
import { AIContextSection } from './components/sections/AIContextSection.jsx';
import { AdvancedSection } from './components/sections/AdvancedSection.jsx';
import { AboutSection } from './components/sections/AboutSection.jsx';

export function OptionsApp() {
    const [activeSection, setActiveSection] = useState('general');
    const {
        settings,
        updateSetting,
        updateSettings,
        loading,
        initialLoadStatus,
        error,
    } = useSettings(OPTIONS_SETTINGS_KEYS, { includeSensitive: true });
    const [saveFailed, setSaveFailed] = useState(false);
    const [currentLanguage, setCurrentLanguage] = useState(
        settings.uiLanguage || 'en'
    );
    const { t } = useTranslation(currentLanguage);

    useEffect(() => {
        if (settings.uiLanguage && settings.uiLanguage !== currentLanguage) {
            setCurrentLanguage(settings.uiLanguage);
        }
    }, [settings.uiLanguage, currentLanguage]);

    const persist = async (write) => {
        try {
            await write();
            setSaveFailed(false);
            return true;
        } catch {
            setSaveFailed(true);
            return false;
        }
    };

    const handleSettingChange = async (key, value) => {
        const saved = await persist(() => updateSetting(key, value));
        if (saved && key === 'uiLanguage') {
            setCurrentLanguage(value);
        }
        return saved;
    };

    const handleSettingsChange = (updates) =>
        persist(() => updateSettings(updates));

    if (loading) {
        return (
            <div className="container">
                <div className="content">
                    <p role="status">Loading...</p>
                </div>
            </div>
        );
    }

    if (initialLoadStatus === 'unavailable') {
        return (
            <div className="container">
                <main className="content">
                    <p role="alert" className="settings-error">
                        Unable to load settings. Please reload the page and try
                        again.
                    </p>
                </main>
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
                {(error || saveFailed) && (
                    <p role="alert" className="settings-error">
                        Unable to save settings. Please try again.
                    </p>
                )}
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
                        onSettingsChange={handleSettingsChange}
                    />
                )}
                {activeSection === 'ai-context' && (
                    <AIContextSection
                        t={t}
                        settings={settings}
                        onSettingChange={handleSettingChange}
                    />
                )}
                {activeSection === 'advanced' && (
                    <AdvancedSection
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
