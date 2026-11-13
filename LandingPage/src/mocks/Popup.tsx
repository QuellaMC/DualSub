import type { ReactNode } from 'react';
import { LogoMark } from '../components/Brand';
import { Icon } from '../components/Icon';
import { ExtensionIcon } from './ExtensionIcon';
import './extension.css';
import './Popup.css';

export type PopupControl =
    'status' | 'enabled' | 'languages' | 'adjustments' | 'settings';

/** The numbers the popup tour uses for each control. */
export const POPUP_CONTROL_NUMBERS: Record<PopupControl, number> = {
    status: 1,
    enabled: 2,
    languages: 3,
    adjustments: 4,
    settings: 5,
};

/** What the popup says on Netflix before a video plays, and while one does. */
const STATES = {
    ready: {
        title: 'Ready on Netflix',
        help: 'Play a video and the two lines appear by themselves.',
        original: 'Automatic',
    },
    playing: {
        title: 'Working on this video',
        help: 'Netflix · English, with your translation',
        original: 'Automatic: English',
    },
} as const;

function Stepper({
    label,
    less,
    value,
    more,
}: {
    label: string;
    less: ReactNode;
    value: string;
    more: ReactNode;
}) {
    return (
        <div className="popup-row">
            <span className="popup-strong">{label}</span>
            <span className="popup-stepper">
                <span className="ext-step">{less}</span>
                <span className="popup-stepper-value">{value}</span>
                <span className="ext-step">{more}</span>
            </span>
        </div>
    );
}

/**
 * The extension popup on a site DualSub works on (src/ui/popup/SitePopup.tsx),
 * drawn at 1:1. `highlighted` outlines controls; `numbered` tags each one with
 * its number from the popup tour.
 */
export function PopupMock({
    className,
    state,
    highlighted = [],
    numbered = false,
}: {
    className: string;
    state: keyof typeof STATES;
    highlighted?: readonly PopupControl[];
    numbered?: boolean;
}) {
    const { title, help, original } = STATES[state];
    const marker = (control: PopupControl) =>
        numbered ? (
            <span className="callout popup-marker">
                {POPUP_CONTROL_NUMBERS[control]}
            </span>
        ) : null;
    const ring = (control: PopupControl) =>
        highlighted.includes(control) ? <span className="popup-ring" /> : null;
    return (
        <div className={`extension-ui popup ${className}`}>
            <div className="popup-head">
                <span className="popup-brand">
                    <LogoMark className="popup-logo" />
                    DualSub
                </span>
                <span className="ext-icon-button popup-settings">
                    <ExtensionIcon name="settings" />
                    {marker('settings')}
                </span>
            </div>
            <div className="popup-body">
                <div className="popup-card">
                    <div className="popup-status">
                        {marker('status')}
                        <span className="ext-status-icon">
                            <ExtensionIcon name="check" />
                        </span>
                        <div>
                            <p className="popup-label">{title}</p>
                            <p className="popup-help">{help}</p>
                        </div>
                    </div>
                    <div className="popup-row">
                        {marker('enabled')}
                        {ring('enabled')}
                        <span className="popup-strong">Dual subtitles</span>
                        <span className="ext-switch" />
                    </div>
                </div>
                <div className="popup-card">
                    {marker('languages')}
                    <div className="popup-row">
                        {ring('languages')}
                        <span className="popup-strong">I speak</span>
                        <span className="ext-select popup-select" lang="zh-CN">
                            中文（简体）
                            <Icon name="chevronDown" />
                        </span>
                    </div>
                    <div className="popup-row">
                        <span className="popup-strong">Original line</span>
                        <span className="popup-help">{original}</span>
                    </div>
                </div>
                <div className="popup-card">
                    {marker('adjustments')}
                    <Stepper
                        label="Text size"
                        less="A−"
                        value="Medium"
                        more="A+"
                    />
                    <Stepper
                        label="Timing"
                        less={<ExtensionIcon name="earlier" />}
                        value="On time"
                        more={<ExtensionIcon name="later" />}
                    />
                    <Stepper
                        label="Position"
                        less={<ExtensionIcon name="up" />}
                        value="Lowest"
                        more={<ExtensionIcon name="down" />}
                    />
                </div>
            </div>
            <div className="popup-foot">
                <span className="ext-icon-button">
                    <Icon name="github" />
                </span>
                <span className="ext-icon-button">
                    <ExtensionIcon name="help" />
                </span>
            </div>
        </div>
    );
}
