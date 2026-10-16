import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import {
    detectBrowserLanguage,
    siteProfileOf,
    type SiteSettingKey,
} from '@/config/schema';
import { createLogger } from '@/shared/logger';
import { PLATFORM_IDS, type PlatformId } from '@/shared/platforms';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { Preview } from './preview/Preview';
import type { SearchEntry } from './search';
import { isSectionId, SECTIONS, type SectionId } from './sections';
import { AdvancedSection } from './sections/AdvancedSection';
import { ExplanationsSection } from './sections/ExplanationsSection';
import { HelpSection } from './sections/HelpSection';
import { LanguagesSection } from './sections/LanguagesSection';
import { LookSection, type LookDraft } from './sections/LookSection';
import { ownSettingKeys, SitesSection } from './sections/SitesSection';
import { StartSection } from './sections/StartSection';
import { TimingSection } from './sections/TimingSection';
import { TranslationSection } from './sections/TranslationSection';
import {
    feedbackSave,
    FeedbackProvider,
    followAllSites,
    type Feedback,
} from './shell/feedback';
import { Nav } from './shell/Nav';
import { ScopeBar } from './shell/ScopeBar';
import { ScopeProvider } from './shell/scopeContext';
import { Toast, type ToastState } from './shell/Toast';
import { TopBar } from './shell/TopBar';
import { OPTIONS_SETTINGS_KEYS, type Scope, type SectionProps } from './types';

const logger = createLogger('Options');
/** What the page around the settings shows; the same in every scope. */
const PAGE_SETTINGS_KEYS = [
    'uiLanguage',
    'showAdvancedSettings',
    'siteProfiles',
] as const;
const TOAST_MS = 6000;

const FOCUSABLE =
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]';

function initialSection(): SectionId {
    const hash = location.hash.replace(/^#/, '');
    return isSectionId(hash) ? hash : 'start';
}

export function OptionsApp() {
    const [scope, setScope] = useState<Scope>('all');
    // The page reads what every scope shares, so it stays in place, focus
    // included, while a newly picked scope's settings load.
    const page = useSettings(PAGE_SETTINGS_KEYS);
    const handle = useSettings(OPTIONS_SETTINGS_KEYS, {
        includeSensitive: true,
        site: scope === 'all' ? null : scope,
        siteTarget: 'own',
    });
    const { settings } = handle;
    const unavailable =
        page.status === 'unavailable' || handle.status === 'unavailable';
    const { t, loadedLocale } = useI18n(
        page.settings?.uiLanguage ??
            (unavailable ? detectBrowserLanguage() : null)
    );
    const [section, setSection] = useState<SectionId>(initialSection);
    const [saveFailed, setSaveFailed] = useState(false);
    const [toast, setToast] = useState<ToastState | null>(null);
    const [lookDraft, setLookDraft] = useState<LookDraft>({});
    /** Where focus goes once the page shows it: the heading of the section
     *  just opened, or the setting a search result named. */
    const [arrival, setArrival] = useState<{ anchor: string | null } | null>(
        null
    );
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (unavailable) {
            logger.error('Settings initial load unavailable');
        }
    }, [unavailable]);

    useEffect(() => {
        if (loadedLocale !== null) {
            document.title = t('optionsPageTitle');
        }
    }, [loadedLocale, t]);

    useEffect(() => {
        history.replaceState(null, '', `#${section}`);
    }, [section]);

    useEffect(
        () => () => {
            if (toastTimer.current) {
                clearTimeout(toastTimer.current);
            }
        },
        []
    );

    useEffect(() => {
        if (!arrival) {
            return;
        }
        const target = arrival.anchor
            ? document.getElementById(arrival.anchor)
            : document.querySelector<HTMLElement>('.content h1');
        if (!target) {
            return;
        }
        target.scrollIntoView({ block: 'start' });
        (arrival.anchor
            ? (target.querySelector<HTMLElement>(FOCUSABLE) ?? target)
            : target
        ).focus({ preventScroll: true });
        setArrival(null);
    }, [arrival, settings]);

    const holdToast = useCallback((held: boolean) => {
        if (toastTimer.current) {
            clearTimeout(toastTimer.current);
        }
        if (!held) {
            toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
        }
    }, []);

    const dismissToast = useCallback(() => setToast(null), []);

    const feedback = useMemo<Feedback>(() => {
        const show = (toast: Omit<ToastState, 'id'>): void => {
            setToast({ id: Date.now(), ...toast });
            holdToast(false);
        };
        const apply: Feedback['apply'] = async (change, message, undo) => {
            try {
                await change();
            } catch (error) {
                logger.error('Failed to save settings', error);
                setSaveFailed(true);
                return false;
            }
            setSaveFailed(false);
            if (message) {
                show({
                    message,
                    tone: 'done',
                    undo: undo ? () => void apply(undo) : null,
                });
            }
            return true;
        };
        return {
            apply,
            notify: (message, tone) => show({ message, tone, undo: null }),
        };
    }, [holdToast]);

    if (loadedLocale !== null && unavailable) {
        return (
            <main className="options-blocked">
                <p role="alert" className="notice danger">
                    {t('settingsLoadFailed')}
                </p>
            </main>
        );
    }
    if (!page.settings || loadedLocale === null) {
        return (
            <main className="options-blocked" aria-busy="true">
                {loadedLocale !== null && (
                    <p role="status">{t('commonLoading')}</p>
                )}
            </main>
        );
    }

    const save = feedbackSave(handle, scope, feedback);
    const savePage = feedbackSave(page, 'all', feedback);
    const {
        uiLanguage,
        showAdvancedSettings: advanced,
        siteProfiles,
    } = page.settings;
    const ownCounts: Record<string, number> = Object.fromEntries(
        PLATFORM_IDS.map((site) => [
            site,
            ownSettingKeys(siteProfileOf(siteProfiles, site)).length,
        ])
    );
    const showScope =
        advanced ||
        scope !== 'all' ||
        Object.values(ownCounts).some((count) => count > 0);
    const ownKeys = new Set(
        scope === 'all' ? [] : Object.keys(siteProfileOf(siteProfiles, scope))
    );
    const followShared = (keys: readonly SiteSettingKey[]): void => {
        if (scope !== 'all') {
            void followAllSites(feedback, scope, keys, t('toastFollowsShared'));
        }
    };

    const go = (next: SectionId, anchor: string | null = null): void => {
        setSection(next);
        setArrival({ anchor });
    };
    const editSite = (site: PlatformId): void => {
        setScope(site);
        go('look');
    };
    const setAdvanced = (next: boolean): void => {
        void savePage({ showAdvancedSettings: next });
        if (!next && SECTIONS[section].advanced) {
            go('start');
        }
    };
    const openSearchResult = (entry: SearchEntry): void => {
        if (entry.advanced && !advanced) {
            void savePage({ showAdvancedSettings: true });
        }
        go(entry.section, entry.anchor ?? null);
    };

    const sectionContent = (sectionProps: SectionProps): ReactNode => {
        switch (section) {
            case 'start':
                return <StartSection {...sectionProps} go={go} />;
            case 'languages':
                return <LanguagesSection {...sectionProps} />;
            case 'look':
                return <LookSection {...sectionProps} onDraft={setLookDraft} />;
            case 'timing':
                return <TimingSection {...sectionProps} advanced={advanced} />;
            case 'translation':
                return (
                    <TranslationSection {...sectionProps} advanced={advanced} />
                );
            case 'explanations':
                return (
                    <ExplanationsSection
                        {...sectionProps}
                        advanced={advanced}
                    />
                );
            case 'sites':
                return (
                    <SitesSection t={t} advanced={advanced} onEdit={editSite} />
                );
            case 'advanced':
                return <AdvancedSection {...sectionProps} />;
            case 'help':
                return <HelpSection t={t} go={go} />;
        }
    };

    return (
        <FeedbackProvider value={feedback}>
            <ScopeProvider value={{ t, scope, ownKeys, followShared }}>
                <div className="options">
                    <a className="skip-link" href="#main">
                        {t('topSkipToContent')}
                    </a>
                    <TopBar
                        t={t}
                        uiLanguage={uiLanguage}
                        onUiLanguage={(next) =>
                            void savePage({ uiLanguage: next })
                        }
                        onOpen={openSearchResult}
                        onHelp={() => go('help')}
                    />
                    <div className="shell">
                        <Nav
                            t={t}
                            section={section}
                            advanced={advanced}
                            onSection={go}
                            onAdvanced={setAdvanced}
                        />
                        <main className="main" id="main">
                            {saveFailed && (
                                <p role="alert" className="notice danger">
                                    {t('settingsSaveFailed')}
                                </p>
                            )}
                            {showScope && (
                                <ScopeBar
                                    t={t}
                                    scope={scope}
                                    ownCounts={ownCounts}
                                    onScope={setScope}
                                />
                            )}
                            <div className="columns">
                                <div
                                    className="content"
                                    key={scope}
                                    aria-busy={settings ? undefined : true}
                                >
                                    {settings &&
                                        sectionContent({ t, settings, save })}
                                </div>
                                {settings && SECTIONS[section].preview && (
                                    <Preview
                                        t={t}
                                        settings={{ ...settings, ...lookDraft }}
                                        scope={scope}
                                    />
                                )}
                            </div>
                        </main>
                    </div>
                    <Toast
                        t={t}
                        toast={toast}
                        onDismiss={dismissToast}
                        onHold={holdToast}
                    />
                </div>
            </ScopeProvider>
        </FeedbackProvider>
    );
}
