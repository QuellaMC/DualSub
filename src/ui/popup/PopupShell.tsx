import type { ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { GitHubMark } from '../design/GitHubMark';
import { Icon } from '../design/Icon';
import { Logo } from '../design/Logo';
import type { Translate } from '../hooks/useI18n';
import { SOURCE_URL } from '../sourceCode';

/** The settings page, opened at `section` when one is named. */
export function openSettings(section?: string): void {
    if (section) {
        void browser.tabs.create({
            url: `${browser.runtime.getURL('/options.html')}#${section}`,
        });
    } else {
        void browser.runtime.openOptionsPage();
    }
}

/** The frame every popup state shares: the name, the way to the settings,
 *  the source, and help. */
export function PopupShell({
    t,
    children,
}: {
    t: Translate;
    children: ReactNode;
}) {
    return (
        <div className="popup">
            <header className="popup-head">
                <div className="brand">
                    <Logo size={28} />
                    <span>DualSub</span>
                </div>
                <button
                    type="button"
                    className="icon-button"
                    aria-label={t('popupAllSettings')}
                    title={t('popupAllSettings')}
                    onClick={() => openSettings()}
                >
                    <Icon name="settings" />
                </button>
            </header>
            <main className="popup-body">{children}</main>
            <footer className="popup-foot">
                <a
                    className="icon-button"
                    href={SOURCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('popupOnGitHub')}
                    title={t('popupOnGitHub')}
                >
                    <GitHubMark />
                </a>
                <button
                    type="button"
                    className="icon-button"
                    aria-label={t('navHelp')}
                    title={t('navHelp')}
                    onClick={() => openSettings('help')}
                >
                    <Icon name="help" />
                </button>
            </footer>
        </div>
    );
}

/** What the popup shows when it cannot tell what to edit: settings it
 *  cannot read, or a tab it cannot place, where a change meant for one
 *  site could land on every site. */
export function PopupUnavailable({ t }: { t: Translate }) {
    return (
        <PopupShell t={t}>
            <p role="alert" className="notice danger">
                {t('settingsLoadFailed')}
            </p>
        </PopupShell>
    );
}
