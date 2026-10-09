import { Artboard } from '../components/Artboard';
import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import { AppearancePanel } from '../mocks/Popup';
import { SunsetScene } from '../mocks/scenes';
import { DualSubtitles } from '../mocks/Subtitles';
import './Customize.css';

const PREVIEWS = [
    {
        title: 'Top / Bottom',
        detail: 'Layout · the default',
        variant: 'preview-default',
        sideBySide: false,
        translationFirst: false,
    },
    {
        title: 'Left / Right',
        detail: 'Layout',
        variant: 'preview-side',
        sideBySide: true,
        translationFirst: false,
    },
    {
        title: 'Translation First',
        detail: 'Display Order',
        variant: 'preview-default',
        sideBySide: false,
        translationFirst: true,
    },
    {
        title: 'Bigger and higher',
        detail: 'Font Size 1.6 · Vertical Position 6.0',
        variant: 'preview-bigger',
        sideBySide: false,
        translationFirst: false,
    },
] as const;

const SPEECH = [6, 10, 14, 6, 6, 6, 6, 6, 6];
const DIALOGUE = [18, 30, 36, 26, 34, 22, 28, 16, 10];
const AFTER = [6, 6, 6, 6, 10, 14, 6, 6, 6];
const BAR_STEP = 13;

function OffsetDiagram() {
    const bars = [
        ...SPEECH.map((height, index) => ({
            x: index * BAR_STEP,
            height,
            on: false,
        })),
        ...DIALOGUE.map((height, index) => ({
            x: 122 + index * BAR_STEP,
            height,
            on: true,
        })),
        ...AFTER.map((height, index) => ({
            x: 239 + index * BAR_STEP,
            height,
            on: false,
        })),
    ];
    return (
        <div className="offset-diagram">
            <span className="offset-label">Dialogue</span>
            <svg
                className="offset-wave"
                viewBox="0 0 350 40"
                aria-hidden="true"
            >
                {bars.map(({ x, height, on }) => (
                    <rect
                        key={x}
                        x={x}
                        y={20 - height / 2}
                        width="9"
                        height={height}
                        rx="2"
                        fill={on ? 'var(--green)' : '#384152'}
                    />
                ))}
            </svg>
            <span className="offset-label">Without offset</span>
            <span className="offset-track">
                <span className="offset-pill offset-late">Shows up late</span>
            </span>
            <span className="offset-label">Time Offset +0.5</span>
            <span className="offset-track">
                <span className="offset-pill offset-on-time">
                    Right on time
                </span>
            </span>
        </div>
    );
}

export function Customize() {
    return (
        <Section id="customize">
            <SectionHeading
                eyebrow="Make it yours"
                title="Subtitles that fit your screen"
                lead="Open Subtitle Appearance & Timing in the popup. Every change previews live on the video while you adjust it."
            />
            <div className="customize">
                <div className="customize-controls">
                    <AppearancePanel />
                    <p className="customize-hint">
                        <Icon name="sliders" />
                        Drag a slider and the subtitles on the video move with
                        it, no reload needed.
                    </p>
                </div>
                <ul className="previews">
                    {PREVIEWS.map(
                        ({
                            title,
                            detail,
                            variant,
                            sideBySide,
                            translationFirst,
                        }) => (
                            <li key={title}>
                                <Artboard
                                    className={`preview-board ${variant}`}
                                    label={`Subtitles drawn ${title.toLowerCase()} over a sunset`}
                                >
                                    <SunsetScene />
                                    <DualSubtitles
                                        original="Look, the sun’s going down."
                                        translation="你看，太阳要落山了。"
                                        translationLang="zh-CN"
                                        sideBySide={sideBySide}
                                        translationFirst={translationFirst}
                                    />
                                </Artboard>
                                <h3>{title}</h3>
                                <p>{detail}</p>
                            </li>
                        )
                    )}
                </ul>
            </div>
            <div className="card offset-card">
                <div className="offset-intro">
                    <span className="feature-icon feature-icon-amber">
                        <Icon name="clock" />
                    </span>
                    <div>
                        <h3>Out of sync? Nudge the timing.</h3>
                        <p>
                            Set <strong>Time Offset(s)</strong> in Subtitle
                            Appearance &amp; Timing. Positive numbers show
                            subtitles earlier, negative numbers show them later,
                            in steps of 0.1 s.
                        </p>
                    </div>
                </div>
                <div className="offset-figure">
                    <Artboard
                        className="offset-board"
                        label="Dialogue on a timeline: without an offset the subtitle shows up late; with Time Offset +0.5 it lands right on time"
                    >
                        <OffsetDiagram />
                    </Artboard>
                </div>
            </div>
        </Section>
    );
}
