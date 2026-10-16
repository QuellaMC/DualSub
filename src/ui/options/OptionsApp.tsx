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
    const [section, setSection] = useState<SectionId>(initialSection);
    // The page reads what every scope shares, so it stays in place, focus
    // included, while a newly picked scope's settings load.
    const page = useSettings(PAGE_SETTINGS_KEYS);
    // An advanced section shows only while advanced options are on, however
    // they went off.
    const shown: SectionId =
        page.settings &&
        !page.settings.showAdvancedSettings &&
        SECTIONS[section].advanced
            ? 'start'
            : section;
    // A site's scope applies where a site can keep settings of its own;
    // elsewhere, changes reach every site, so the page shows them that way.
    const editing: Scope = SECTIONS[shown].scoped ? scope : 'all';
    const handle = useSettings(OPTIONS_SETTINGS_KEYS, {
        includeSensitive: true,
        site: editing === 'all' ? null : editing,
        siteTarget: 'own',
    });
    const { settings } = handle;
    const unavailable =
        page.status === 'unavailable' || handle.status === 'unavailable';
    const { t, loadedLocale } = useI18n(
        page.settings?.uiLanguage ??
            (unavailable ? detectBrowserLanguage() : null)
    );
    const [saveFailed, setSaveFailed] = useState(false);
    const [toast, setToast] = useState<ToastState | null>(null);
    const [lookDraft, setLookDraft] = useState<LookDraft>({});
    /** Where focus goes once the page shows it: the heading of the section
     *  just opened, or the first of a search result's elements on the page. */
    const [arrival, setArrival] = useState<{
        anchors: readonly string[];
    } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** The last change asked for; each waits for the one before. */
    const changes = useRef<Promise<unknown>>(Promise.resolve());
    /** The drafts of the settings shown, by key; following the value for
     *  all sites cancels them first. */
    const drafts = useRef(new Map<SiteSettingKey, Set<() => void>>());
    const registerDraft = useCallback(
        (key: SiteSettingKey, cancel: () => void) => {
            const cancels = drafts.current.get(key) ?? new Set();
            cancels.add(cancel);
            drafts.current.set(key, cancels);
            return () => {
                cancels.delete(cancel);
            };
        },
        []
    );

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
        history.replaceState(null, '', `#${shown}`);
    }, [shown]);

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
        const target =
            arrival.anchors.length === 0
                ? document.querySelector<HTMLElement>('.content h1')
                : arrival.anchors
                      .map((id) => document.getElementById(id))
                      .find((element) => element !== null);
        if (!target) {
            return;
        }
        target.scrollIntoView({ block: 'start' });
        const focused =
            arrival.anchors.length === 0
                ? target
                : (target.querySelector<HTMLElement>(FOCUSABLE) ?? target);
        focused.focus({ preventScroll: true });
        // A folded disclosure opens to show what was searched for.
        if (focused.getAttribute('aria-expanded') === 'false') {
            focused.click();
        }
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

    const dismissToast = useCallback(
        (id: number) =>
            setToast((current) => (current?.id === id ? null : current)),
        []
    );

    const feedback = useMemo<Feedback>(() => {
        const show = (toast: Omit<ToastState, 'id'>): void => {
            setToast({ id: Date.now(), ...toast });
            holdToast(false);
        };
        const makeChange = async (
            change: () => Promise<unknown>,
            message?: string,
            undo?: () => Promise<unknown>
        ): Promise<boolean> => {
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
                    undo: undo ? () => apply(undo) : null,
                });
            } else {
                setToast((current) =>
                    current?.undo ? { ...current, undo: null } : current
                );
            }
            return true;
        };
        const apply: Feedback['apply'] = (change, message, undo) => {
            const made = changes.current.then(() =>
                makeChange(change, message, undo)
            );
            changes.current = made.catch(() => undefined);
            return made;
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

    const save = feedbackSave(handle, editing, feedback);
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
        SECTIONS[shown].scoped === true &&
        (advanced ||
            scope !== 'all' ||
            Object.values(ownCounts).some((count) => count > 0));
    const ownKeys = new Set(
        editing === 'all'
            ? []
            : Object.keys(siteProfileOf(siteProfiles, editing))
    );
    const followShared = (keys: readonly SiteSettingKey[]): void => {
        if (editing !== 'all') {
            for (const key of keys) {
                for (const cancel of drafts.current.get(key) ?? []) {
                    cancel();
                }
            }
            void followAllSites(
                feedback,
                editing,
                keys,
                t('toastFollowsShared')
            );
        }
    };

    const go = (next: SectionId, anchors: readonly string[] = []): void => {
        setSection(next);
        setArrival({ anchors });
    };
    const editSite = (site: PlatformId): void => {
        setScope(site);
        go('look');
    };
    const openSearchResult = async (entry: SearchEntry): Promise<void> => {
        if (
            entry.advanced &&
            !advanced &&
            !(await savePage({ showAdvancedSettings: true }))
        ) {
            return;
        }
        go(entry.section, entry.anchors);
    };

    const sectionContent = (sectionProps: SectionProps): ReactNode => {
        switch (shown) {
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
            <ScopeProvider
                value={{
                    t,
                    scope: editing,
                    ownKeys,
                    followShared,
                    registerDraft,
                }}
            >
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
                        onOpen={(entry) => void openSearchResult(entry)}
                        onHelp={() => go('help')}
                    />
                    <div className="shell">
                        <Nav
                            t={t}
                            section={shown}
                            advanced={advanced}
                            onSection={go}
                            onAdvanced={(next) =>
                                void savePage({ showAdvancedSettings: next })
                            }
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
                                    key={editing}
                                    aria-busy={settings ? undefined : true}
                                >
                                    {settings &&
                                        sectionContent({ t, settings, save })}
                                </div>
                                {settings && SECTIONS[shown].preview && (
                                    <Preview
                                        t={t}
                                        settings={{ ...settings, ...lookDraft }}
                                        scope={editing}
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
