import { LogoMark } from '../components/Brand';
import { Icon } from '../components/Icon';
import { ExtensionIcon, type ExtensionIconName } from './ExtensionIcon';
import './extension.css';
import './Settings.css';

/** The menu beside every settings section (src/ui/options/sections.ts). */
const MENU: readonly { icon: ExtensionIconName; label: string }[] = [
    { icon: 'home', label: 'Start' },
    { icon: 'languages', label: 'Languages' },
    { icon: 'look', label: 'Style' },
    { icon: 'timing', label: 'Timing' },
    { icon: 'translation', label: 'Translation' },
    { icon: 'explain', label: 'Meanings' },
    { icon: 'sites', label: 'Sites' },
];

const SITES = ['Netflix', 'Disney+', 'YouTube'];

const FIXES = [
    'The words don’t match what I hear',
    'I see subtitles twice',
    'No subtitles appear',
    'The translation reads badly',
];

/** The settings page on its Start section, as it opens from the popup's gear. */
export function SettingsMock() {
    return (
        <div className="extension-ui settings">
            <div className="settings-top">
                <span className="settings-brand">
                    <LogoMark className="settings-logo" />
                    DualSub
                    <span className="settings-brand-page">Settings</span>
                </span>
                <span className="settings-search">
                    <ExtensionIcon name="search" />
                    Search settings, like “size” or “twice”
                </span>
                <span className="settings-actions">
                    <span className="settings-inline">
                        <strong>Advanced options</strong>
                        <span className="ext-switch ext-switch-off" />
                    </span>
                    <span className="settings-inline">
                        <ExtensionIcon name="globe" />
                        <span className="ext-select settings-language">
                            English
                            <Icon name="chevronDown" />
                        </span>
                    </span>
                </span>
            </div>
            <div className="settings-shell">
                <div className="settings-menu">
                    {MENU.map(({ icon, label }) => (
                        <span
                            key={label}
                            className={
                                label === 'Start'
                                    ? 'settings-menu-item is-current'
                                    : 'settings-menu-item'
                            }
                        >
                            <ExtensionIcon name={icon} />
                            {label}
                        </span>
                    ))}
                    <span className="settings-menu-item settings-menu-help">
                        <ExtensionIcon name="help" />
                        Help
                    </span>
                </div>
                <div className="settings-main">
                    <div className="ext-card">
                        <div className="settings-row">
                            <span className="settings-status">
                                <span className="ext-status-icon">
                                    <ExtensionIcon name="check" />
                                </span>
                                Working on every site
                            </span>
                            <span className="settings-inline">
                                Dual subtitles
                                <span className="ext-switch" />
                            </span>
                        </div>
                        <div className="settings-sites">
                            {SITES.map((site) => (
                                <span key={site} className="ext-button">
                                    Open {site}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="settings-stage">
                        <span className="settings-style-button">
                            Change the style
                            <ExtensionIcon name="chevron" />
                        </span>
                        <span className="settings-line">
                            Where there’s a will, there’s a way.
                        </span>
                        <span
                            className="settings-line settings-line-translation"
                            lang="zh-CN"
                        >
                            有志者事竟成。
                        </span>
                    </div>
                    <p className="settings-legend">
                        <span>
                            <span className="settings-dot" />
                            English · the language you chose
                        </span>
                        <span>
                            <span className="settings-dot settings-dot-translation" />
                            Chinese (Simp) · your language
                        </span>
                    </p>
                    <div className="settings-tiles">
                        <div className="ext-card settings-tile">
                            <span className="settings-tile-label">I speak</span>
                            <span className="ext-select">
                                <span>
                                    <span lang="zh-CN">中文（简体）</span> ·
                                    Chinese (Simp)
                                </span>
                                <Icon name="chevronDown" />
                            </span>
                        </div>
                        <div className="ext-card settings-tile">
                            <span className="settings-tile-label">
                                Text size
                            </span>
                            <span className="settings-size">
                                <span className="ext-step">A−</span>
                                <strong>Medium</strong>
                                <span className="ext-step">A+</span>
                            </span>
                        </div>
                        <div className="ext-card settings-tile settings-tile-link">
                            <span className="settings-tile-label">
                                Translation
                            </span>
                            <strong className="settings-tile-value">
                                Microsoft Translator
                            </strong>
                            <span className="ext-tag">Free</span>
                            <ExtensionIcon name="chevron" />
                        </div>
                    </div>
                    <p className="settings-problems">Something not right?</p>
                    <div className="settings-fixes">
                        {FIXES.map((fix) => (
                            <span key={fix} className="settings-fix">
                                {fix}
                                <ExtensionIcon name="chevron" />
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
