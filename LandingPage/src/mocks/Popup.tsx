import type { ReactNode } from 'react';
import { LogoMark } from '../components/Brand';
import { Icon } from '../components/Icon';
import './Popup.css';

export type PopupControl =
    | 'enable'
    | 'official'
    | 'languageSet'
    | 'translateTo'
    | 'appearance'
    | 'settings';

/** The numbers the popup tour uses for each control. */
export const POPUP_CONTROL_NUMBERS: Record<PopupControl, number> = {
    enable: 1,
    official: 2,
    languageSet: 3,
    translateTo: 4,
    appearance: 5,
    settings: 6,
};

function PopupValue({ children }: { children: ReactNode }) {
    return (
        <span className="popup-value">
            {children}
            <Icon name="chevronDown" />
        </span>
    );
}

/**
 * The extension popup as it ships in 3.0.2, drawn at 1:1 when its font size
 * is 16px. `highlighted` outlines controls; `numbered` tags each one with its
 * number from the popup tour.
 */
export function PopupMock({
    className,
    highlighted = [],
    numbered = false,
}: {
    className: string;
    highlighted?: readonly PopupControl[];
    numbered?: boolean;
}) {
    const row = (control: PopupControl, label: string, value: ReactNode) => (
        <div
            className={
                highlighted.includes(control)
                    ? 'popup-row popup-highlight'
                    : 'popup-row'
            }
        >
            {numbered ? (
                <span className="popup-marker">
                    <span className="callout">
                        {POPUP_CONTROL_NUMBERS[control]}
                    </span>
                </span>
            ) : null}
            <span>{label}</span>
            {value}
        </div>
    );
    return (
        <div className={`popup ${className}`}>
            <div className="popup-header">
                <LogoMark className="popup-logo" />
                <span className="popup-title">DualSub</span>
                <Icon name="github" className="popup-action" />
                <span className="popup-settings">
                    <Icon name="gear" className="popup-action" />
                    {numbered ? (
                        <span className="popup-marker-settings">
                            <span className="callout">
                                {POPUP_CONTROL_NUMBERS.settings}
                            </span>
                        </span>
                    ) : null}
                </span>
            </div>
            <div className="popup-card">
                {row(
                    'enable',
                    'Enable Dual Subtitles:',
                    <span className="popup-switch" />
                )}
            </div>
            <div className="popup-card">
                {row(
                    'official',
                    'Use Official Subtitles:',
                    <span className="popup-switch" />
                )}
            </div>
            <div className="popup-card">
                {row(
                    'languageSet',
                    'Language Set:',
                    <PopupValue>English</PopupValue>
                )}
                {row(
                    'translateTo',
                    'Translate to:',
                    <PopupValue>Chinese (Simp)</PopupValue>
                )}
            </div>
            <div className="popup-card">
                {row(
                    'appearance',
                    'Subtitle Appearance & Timing',
                    <Icon name="chevronDown" className="popup-disclosure" />
                )}
            </div>
        </div>
    );
}

const SLIDERS = [
    { label: 'Font Size:', value: 1.1, min: 1, max: 3 },
    { label: 'Vertical Gap:', value: 0.3, min: 0, max: 1 },
    { label: 'Vertical Position:', value: 2.8, min: 0.1, max: 9.9 },
] as const;

/** The popup's Subtitle Appearance & Timing section, opened, at its defaults. */
export function AppearancePanel() {
    return (
        <div className="appearance-panel">
            <div className="popup-row appearance-header">
                <span>Subtitle Appearance &amp; Timing</span>
                <Icon name="chevronUp" className="popup-disclosure" />
            </div>
            <div className="appearance-body">
                <div className="popup-row">
                    <span>Display Order:</span>
                    <PopupValue>Original First</PopupValue>
                </div>
                <div className="popup-row">
                    <span>Layout:</span>
                    <PopupValue>Top / Bottom</PopupValue>
                </div>
                {SLIDERS.map(({ label, value, min, max }) => {
                    const fraction = (value - min) / (max - min);
                    return (
                        <div
                            key={label}
                            className="popup-row appearance-slider"
                        >
                            <span className="appearance-label">{label}</span>
                            <span className="appearance-track">
                                <span
                                    className="appearance-fill"
                                    style={{ width: `${fraction * 100}%` }}
                                />
                                <span
                                    className="appearance-thumb"
                                    style={{
                                        left: `calc(0.875em + (100% - 1.75em) * ${fraction})`,
                                    }}
                                />
                            </span>
                            <span className="appearance-value">
                                {value.toFixed(1)}
                            </span>
                        </div>
                    );
                })}
                <div className="popup-row">
                    <span>Time Offset(s):</span>
                    <span className="popup-value">0</span>
                </div>
            </div>
        </div>
    );
}
