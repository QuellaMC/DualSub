import { useEffect, useState } from 'react';
import { detectBrowserLanguage } from '@/config/schema';
import { createLogger } from '@/shared/logger';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { AboutSection } from './sections/AboutSection';
import { AdvancedSection } from './sections/AdvancedSection';
import { AIContextSection } from './sections/AIContextSection';
import { GeneralSection } from './sections/GeneralSection';
import { ProvidersSection } from './sections/ProvidersSection';
import { TranslationSection } from './sections/TranslationSection';
import { isSectionId, Sidebar, type SectionId } from './Sidebar';
import { OPTIONS_SETTINGS_KEYS, type OptionsSettings } from './types';

const logger = createLogger('Options');

function initialSection(): SectionId {
    const hash = location.hash.replace(/^#/, '');
    return isSectionId(hash) ? hash : 'general';
}

export function OptionsApp() {
    const { settings, status, save } = useSettings(OPTIONS_SETTINGS_KEYS, {
        includeSensitive: true,
    });
    const { t, loadedLocale } = useI18n(
        settings?.uiLanguage ??
            (status === 'unavailable' ? detectBrowserLanguage() : null)
    );
    const [section, setSection] = useState<SectionId>(initialSection);
    const [saveFailed, setSaveFailed] = useState(false);

    useEffect(() => {
        if (status === 'unavailable') {
            logger.error('Settings initial load unavailable');
        }
    }, [status]);

    useEffect(() => {
        if (loadedLocale !== null) {
            document.title = t('optionsPageTitle');
        }
    }, [loadedLocale, t]);

    if (status === 'unavailable') {
        return (
            <div className="container">
                <main className="content">
                    <p role="alert" className="settings-error">
                        {t('settingsLoadFailed')}
                    </p>
                </main>
            </div>
        );
    }
    if (!settings || loadedLocale === null) {
        return (
            <div className="container">
                <main className="content">
                    <p role="status">Loading...</p>
                </main>
            </div>
        );
    }

    const persist = async (
        changes: Partial<OptionsSettings>
    ): Promise<boolean> => {
        try {
            await save(changes);
            setSaveFailed(false);
            return true;
        } catch (error) {
            logger.error('Failed to save settings', error, {
                keys: Object.keys(changes),
            });
            setSaveFailed(true);
            return false;
        }
    };

    const sectionProps = { t, settings, save: persist };

    return (
        <div className="container">
            <Sidebar
                t={t}
                activeSection={section}
                onSectionChange={setSection}
            />
            <main className="content">
                {saveFailed && (
                    <p role="alert" className="settings-error">
                        {t('settingsSaveFailed')}
                    </p>
                )}
                {section === 'general' && <GeneralSection {...sectionProps} />}
                {section === 'translation' && (
                    <TranslationSection {...sectionProps} />
                )}
                {section === 'providers' && (
                    <ProvidersSection {...sectionProps} />
                )}
                {section === 'ai-context' && (
                    <AIContextSection {...sectionProps} />
                )}
                {section === 'advanced' && (
                    <AdvancedSection {...sectionProps} />
                )}
                {section === 'about' && <AboutSection t={t} />}
            </main>
        </div>
    );
}
