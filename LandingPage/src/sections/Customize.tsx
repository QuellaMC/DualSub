import { Artboard } from '../components/Artboard';
import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import { SunsetScene } from '../mocks/scenes';
import { StylePane } from '../mocks/StylePane';
import { DualSubtitles } from '../mocks/Subtitles';
import './Customize.css';

const PREVIEWS = [
    {
        title: 'Stacked',
        detail: 'How the two lines sit · the default',
        variant: 'preview-default',
        sideBySide: false,
        translationFirst: false,
    },
    {
        title: 'Side by side',
        detail: 'How the two lines sit',
        variant: 'preview-side',
        sideBySide: true,
        translationFirst: false,
    },
    {
        title: 'Translation on top',
        detail: 'Which line goes on top',
        variant: 'preview-default',
        sideBySide: false,
        translationFirst: true,
    },
    {
        title: 'Bigger and higher',
        detail: 'Size: Large · Position: Raised',
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
            <span className="offset-label">Voice</span>
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
                        fill={on ? '#cfd5df' : '#384152'}
                    />
                ))}
            </svg>
            <span className="offset-label">Subtitles</span>
            <span className="offset-track">
                <span className="offset-pill offset-late">Shows up late</span>
            </span>
            <span className="offset-label">0.5 s earlier</span>
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
                lead="Settings → Style draws your subtitles on a stage at the video’s true proportions. Change the size, position, look and lines, and the video follows at once."
            />
            <div className="customize">
                <div className="customize-controls">
                    <StylePane />
                    <p className="customize-hint">
                        <Icon name="sliders" />
                        Click a line to style it. Drag the subtitles to move
                        them.
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
                    <span className="feature-icon">
                        <Icon name="clock" />
                    </span>
                    <div>
                        <h3>Out of sync? Nudge the timing.</h3>
                        <p>
                            Press the <strong>Timing</strong> arrows in the
                            popup, or use Settings → Timing. Each press shows
                            the subtitles half a second earlier or later, and
                            the video follows at once.
                        </p>
                    </div>
                </div>
                <div className="offset-figure">
                    <Artboard
                        className="offset-board"
                        label="A voice on a timeline: the subtitle shows up late, and half a second earlier it lands right on time"
                    >
                        <OffsetDiagram />
                    </Artboard>
                </div>
            </div>
        </Section>
    );
}
