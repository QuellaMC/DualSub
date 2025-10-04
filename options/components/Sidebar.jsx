import React from 'react';

export function Sidebar({ t, activeSection, onSectionChange }) {
    const sections = [
        { id: 'general', label: t('navGeneral', 'General') },
        { id: 'translation', label: t('navTranslation', 'Translation') },
        { id: 'providers', label: t('navProviders', 'Providers') },
        { id: 'ai-context', label: t('navAIContext', 'AI Context') },
        { id: 'about', label: t('navAbout', 'About') },
    ];

    return (
        <aside className="sidebar">
            <header>
                <h1>{t('optionsH1Title', 'DualSub')}</h1>
            </header>
            <nav>
                <ul>
                    {sections.map((section) => (
                        <li key={section.id}>
                            <a
                                href={`#${section.id}`}
                                className={
                                    activeSection === section.id ? 'active' : ''
                                }
                                onClick={(e) => {
                                    e.preventDefault();
                                    onSectionChange(section.id);
                                }}
                            >
                                {section.label}
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>
        </aside>
    );
}
