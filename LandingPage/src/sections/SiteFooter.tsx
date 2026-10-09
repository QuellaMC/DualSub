import { Wordmark } from '../components/Brand';
import {
    DOCS_URL,
    GITHUB_URL,
    LICENSE_URL,
    NEW_ISSUE_URL,
    PRIVACY_POLICY_URL,
    RELEASES_URL,
    sectionHref,
} from '../site';
import './SiteFooter.css';

const COLUMNS = [
    {
        heading: 'Product',
        links: [
            { href: sectionHref('how-it-works'), label: 'How it works' },
            { href: sectionHref('customize'), label: 'Customize' },
            { href: sectionHref('ai-context'), label: 'AI Context' },
            { href: sectionHref('engines'), label: 'Translation engines' },
        ],
    },
    {
        heading: 'Resources',
        links: [
            { href: DOCS_URL, label: 'Documentation' },
            { href: GITHUB_URL, label: 'GitHub' },
            { href: RELEASES_URL, label: 'Release notes' },
            { href: NEW_ISSUE_URL, label: 'Report an issue' },
        ],
    },
    {
        heading: 'Legal',
        links: [
            { href: PRIVACY_POLICY_URL, label: 'Privacy Policy' },
            { href: LICENSE_URL, label: 'License (CC BY-NC-SA 4.0)' },
        ],
    },
];

export function SiteFooter() {
    return (
        <footer className="site-footer">
            <div className="container">
                <div className="site-footer-top">
                    <div className="site-footer-brand">
                        <Wordmark />
                        <p>Dual-language subtitles for Netflix and Disney+.</p>
                    </div>
                    {COLUMNS.map(({ heading, links }) => (
                        <nav key={heading} aria-label={heading}>
                            <h2>{heading}</h2>
                            <ul>
                                {links.map(({ href, label }) => (
                                    <li key={label}>
                                        <a href={href}>{label}</a>
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    ))}
                </div>
                <div className="site-footer-bottom">
                    <p>
                        © {new Date().getFullYear()} DualSub · Developed by
                        QuellaMC &amp; 1jifang
                    </p>
                    <p>
                        DualSub is not affiliated with Netflix, Disney+ or any
                        streaming platform.
                    </p>
                </div>
            </div>
        </footer>
    );
}
