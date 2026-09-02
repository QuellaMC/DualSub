import type { Translate } from '../hooks/useI18n';

export const SECTION_IDS = [
    'general',
    'translation',
    'providers',
    'ai-context',
    'advanced',
    'about',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

const SECTION_LABELS: Record<SectionId, string> = {
    general: 'navGeneral',
    translation: 'navTranslation',
    providers: 'navProviders',
    'ai-context': 'navAIContext',
    advanced: 'navAdvanced',
    about: 'navAbout',
};

export function isSectionId(value: string): value is SectionId {
    return (SECTION_IDS as readonly string[]).includes(value);
}

export function Sidebar({
    t,
    activeSection,
    onSectionChange,
}: {
    t: Translate;
    activeSection: SectionId;
    onSectionChange: (section: SectionId) => void;
}) {
    return (
        <aside className="sidebar">
            <header>
                <h1>{t('optionsH1Title')}</h1>
            </header>
            <nav>
                <ul>
                    {SECTION_IDS.map((id) => (
                        <li key={id}>
                            <a
                                href={`#${id}`}
                                className={activeSection === id ? 'active' : ''}
                                aria-current={
                                    activeSection === id ? 'page' : undefined
                                }
                                onClick={(event) => {
                                    event.preventDefault();
                                    onSectionChange(id);
                                }}
                            >
                                {t(SECTION_LABELS[id])}
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>
        </aside>
    );
}
