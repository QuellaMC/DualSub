import { ExtensionIcon } from './ExtensionIcon';
import './extension.css';
import './StylePane.css';

const LOOKS = ['Boxed', 'Classic', 'High contrast', 'Cinema'];

/** The translation line's color choices, cyan (the default) picked. */
const TRANSLATION_COLORS = [
    '#ffffff',
    '#ffe14d',
    '#00ffff',
    '#6ee36e',
    '#ff8fc8',
];

/**
 * The settings page's Style controls (src/ui/options/sections/LookSection.tsx)
 * on their own: size, position, look and lines, with a custom look picked.
 */
export function StylePane() {
    return (
        <div className="extension-ui style-pane">
            <p className="style-pane-head">
                <strong>Subtitle style</strong>
                <span>Settings → Style</span>
            </p>
            <div className="style-pane-row">
                <strong>Size</strong>
                <span className="style-pane-stepper">
                    <span className="ext-step">A−</span>
                    <span>Medium</span>
                    <span className="ext-step">A+</span>
                </span>
            </div>
            <div className="style-pane-row">
                <strong>Position</strong>
                <span className="style-pane-stepper">
                    <span className="ext-step">
                        <ExtensionIcon name="up" />
                    </span>
                    <span>Usual height</span>
                    <span className="ext-step">
                        <ExtensionIcon name="down" />
                    </span>
                </span>
            </div>
            <div className="style-pane-group">
                <strong>Look</strong>
                <span className="ext-segmented">
                    <span>Site</span>
                    <span className="is-on">Custom</span>
                </span>
                <span className="style-pane-chips">
                    {LOOKS.map((look) => (
                        <span
                            key={look}
                            className={look === 'Boxed' ? 'is-on' : undefined}
                        >
                            {look}
                        </span>
                    ))}
                </span>
            </div>
            <div className="style-pane-row">
                <strong>Translation color</strong>
                <span className="style-pane-swatches">
                    {TRANSLATION_COLORS.map((color) => (
                        <span
                            key={color}
                            className={
                                color === '#00ffff' ? 'is-on' : undefined
                            }
                            style={{ background: color }}
                        />
                    ))}
                </span>
            </div>
            <div className="style-pane-group">
                <strong>Lines</strong>
                <span className="style-pane-choice">
                    On top
                    <span className="ext-segmented">
                        <span className="is-on">Original</span>
                        <span>Translation</span>
                    </span>
                </span>
                <span className="style-pane-choice">
                    How they sit
                    <span className="ext-segmented">
                        <span className="is-on">Stacked</span>
                        <span>Side by side</span>
                    </span>
                </span>
            </div>
        </div>
    );
}
