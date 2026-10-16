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
    type Confirmation,
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

/** Where the page opens: the section an address like `#look` names, and
 *  where focus then lands when anchors follow, as in `#look/look-customize`. */
function initialPlace(): { section: SectionId; anchors: readonly string[] } {
    const [section = '', ...anchors] = location.hash
        .replace(/^#/, '')
        .split('/');
    return isSectionId(section)
        ? { section, anchors }
        : { section: 'start', anchors: [] };
}

export function OptionsApp() {
    const [scope, setScope] = useState<Scope>('all');
    const [section, setSection] = useState<SectionId>(
        () => initialPlace().section
    );
    // The page reads what every scope shares, so it stays in place, focus
    // included, while a newly picked scope's settings load.
    const page = useSettings(PAGE_SETTINGS_KEYS);
    // An advanced section closes for Start once advanced options go off,
    // however they went off, so turning them on again stays on Start.
    const hidden =
        page.settings !== null &&
        !page.settings.showAdvancedSettings &&
        SECTIONS[section].advanced === true;
    if (hidden) {
        setSection('start');
    }
    const shown: SectionId = hidden ? 'start' : section;
    // A site's scope applies where a site can keep settings of its own;
    // elsewhere, changes reach every site, so the page shows them that way.
    const editing: Scope = SECTIONS[shown].scoped ? scope : 'all';
    const handle = useSettings(OPTIONS_SETTINGS_KEYS, {
        includeSensitive: true,
        site: editing === 'all' ? null : editing,
        siteTarget: 'own',
    });
    const { settings } = handle;
    const unavailable = page.status === 'unavailable';
    // A section's own settings that cannot be read leave the page around
    // it in place, the scope bar included, so another scope can be picked.
    const sectionUnavailable = handle.status === 'unavailable';
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
    } | null>(() => {
        const { anchors } = initialPlace();
        return anchors.length > 0 ? { anchors } : null;
    });
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** The last change asked for; each waits for the one before. */
    const changes = useRef<Promise<unknown>>(Promise.resolve());
    /** Counts the times an Undo was taken back, so a change asked for
     *  before one confirms itself without an Undo. */
    const undoTakeBacks = useRef(0);
    /** Counts the navigations the viewer asks for, so one that waits on a
     *  save gives way to any asked for after it. */
    const navigations = useRef(0);
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
        if (unavailable || sectionUnavailable) {
            logger.error('Settings initial load unavailable');
        }
    }, [unavailable, sectionUnavailable]);

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
        const land = (): boolean => {
            const target =
                arrival.anchors.length === 0
                    ? document.querySelector<HTMLElement>('.content h1')
                    : arrival.anchors
                          .map((id) => document.getElementById(id))
                          .find((element) => element !== null);
            if (!target) {
                return false;
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
            return true;
        };
        if (land()) {
            return;
        }
        // A section that reads settings of its own shows the target later.
        const observer = new MutationObserver(() => {
            if (land()) {
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [arrival]);

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
            change: () => Promise<Confirmation | undefined>,
            asked: number
        ): Promise<boolean> => {
            let confirmation: Confirmation | undefined;
            try {
                confirmation = await change();
            } catch (error) {
                logger.error('Failed to save settings', error);
                setSaveFailed(true);
                return false;
            }
            setSaveFailed(false);
            if (confirmation) {
                const { message, undo } = confirmation;
                show({
                    message,
                    tone: 'done',
                    undo:
                        undo && undoTakeBacks.current === asked
                            ? () =>
                                  queueChange(async () => {
                                      await undo();
                                      return undefined;
                                  })
                            : null,
                });
            }
            return true;
        };
        const queueChange: Feedback['apply'] = (change) => {
            const asked = undoTakeBacks.current;
            const made = changes.current.then(() => makeChange(change, asked));
            changes.current = made.catch(() => undefined);
            return made;
        };
        const takeBackUndo = (): void => {
            undoTakeBacks.current += 1;
            setToast((current) =>
                current?.undo ? { ...current, undo: null } : current
            );
        };
        return {
            apply: queueChange,
            takeBackUndo,
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

    const save = feedbackSave(handle, feedback);
    const savePage = feedbackSave(page, feedback);
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
                [editing],
                keys,
                t('toastFollowsShared')
            );
        }
    };

    const go = (next: SectionId, anchors: readonly string[] = []): void => {
        navigations.current += 1;
        setSection(next);
        setArrival({ anchors });
    };
    const editSite = (site: PlatformId): void => {
        setScope(site);
        go('look');
    };
    const openSearchResult = async (entry: SearchEntry): Promise<void> => {
        const asked = ++navigations.current;
        if (
            entry.advanced &&
            !advanced &&
            !(await savePage({ showAdvancedSettings: true }))
        ) {
            return;
        }
        if (navigations.current === asked) {
            go(entry.section, entry.anchors);
        }
    };

    const sectionContent = (sectionProps: SectionProps): ReactNode => {
        switch (shown) {
            case 'start':
                return <StartSection {...sectionProps} go={go} />;
            case 'languages':
                return <LanguagesSection {...sectionProps} />;
            case 'look':
                return (
                    <LookSection
                        {...sectionProps}
                        onDraft={setLookDraft}
                        advanced={advanced}
                    />
                );
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
                                savePage({ showAdvancedSettings: next })
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
                                    aria-busy={
                                        settings || sectionUnavailable
                                            ? undefined
                                            : true
                                    }
                                >
                                    {sectionUnavailable ? (
                                        <p
                                            role="alert"
                                            className="notice danger"
                                        >
                                            {t('settingsLoadFailed')}
                                        </p>
                                    ) : (
                                        settings &&
                                        sectionContent({ t, settings, save })
                                    )}
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
