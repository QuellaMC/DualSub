import type { ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { Icon } from '../design/Icon';
import type { Translate } from '../hooks/useI18n';

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
 *  and help. */
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
                    <img
                        src="/icons/icon48.png"
                        alt=""
                        width="28"
                        height="28"
                    />
                    <span>DualSub</span>
                </div>
                <button
                    type="button"
                    className="icon-button"
                    aria-label={t('popupAllSettings')}
                    onClick={() => openSettings()}
                >
                    <Icon name="advanced" />
                </button>
            </header>
            <main className="popup-body">{children}</main>
            <footer className="popup-foot">
                <button
                    type="button"
                    className="link-button"
                    onClick={() => openSettings()}
                >
                    {t('popupAllSettings')}
                </button>
                <button
                    type="button"
                    className="link-button"
                    onClick={() => openSettings('help')}
                >
                    {t('navHelp')}
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
