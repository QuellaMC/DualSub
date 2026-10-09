import { useState } from 'react';
import { AddToChrome } from '../components/AddToChrome';
import { Wordmark } from '../components/Brand';
import { Icon } from '../components/Icon';
import { GITHUB_URL, sectionHref, type SectionLink } from '../site';
import './SiteHeader.css';

const NAV: readonly SectionLink[] = [
    { id: 'how-it-works', label: 'How it works' },
    { id: 'customize', label: 'Customize' },
    { id: 'ai-context', label: 'AI Context' },
    { id: 'engines', label: 'Engines' },
    { id: 'faq', label: 'FAQ' },
];

export function SiteHeader() {
    const [menuOpen, setMenuOpen] = useState(false);
    return (
        <header className={menuOpen ? 'site-header is-open' : 'site-header'}>
            <div className="container site-header-bar">
                <a
                    className="site-header-home"
                    href="#top"
                    aria-label="DualSub"
                >
                    <Wordmark />
                </a>
                <nav id="site-nav" className="site-nav" aria-label="Main">
                    <ul>
                        {NAV.map(({ id, label }) => (
                            <li key={id}>
                                <a
                                    href={sectionHref(id)}
                                    onClick={() => setMenuOpen(false)}
                                >
                                    {label}
                                </a>
                            </li>
                        ))}
                    </ul>
                </nav>
                <div className="site-header-actions">
                    <a
                        className="site-header-github"
                        href={GITHUB_URL}
                        aria-label="GitHub"
                    >
                        <Icon name="github" />
                        <span>GitHub</span>
                    </a>
                    <span className="site-header-cta">
                        <AddToChrome compact />
                    </span>
                    <button
                        type="button"
                        className="site-header-menu"
                        aria-controls="site-nav"
                        aria-expanded={menuOpen}
                        aria-label="Menu"
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        <Icon name={menuOpen ? 'close' : 'menu'} />
                    </button>
                </div>
            </div>
        </header>
    );
}
