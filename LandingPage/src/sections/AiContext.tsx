import { Artboard } from '../components/Artboard';
import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import { BrowserWindow } from '../mocks/Browser';
import { Cursor } from '../mocks/Cursor';
import { Player } from '../mocks/Player';
import { SettingsMock } from '../mocks/Settings';
import { SidePanelMock } from '../mocks/SidePanel';
import { StageScene } from '../mocks/scenes';
import { DualSubtitles } from '../mocks/Subtitles';
import './AiContext.css';

const STEPS = [
    {
        title: 'Click words in the subtitle',
        body: 'They light up blue as you pick them. Click a word again to drop it.',
    },
    {
        title: 'Side panel opens, video pauses',
        body: 'Your picks appear under Words to Analyze. Auto-open, auto-pause and the panel’s light or dark theme are in Settings → Advanced Settings.',
    },
    {
        title: 'Press Analyze',
        body: 'Get a definition plus cultural, historical and linguistic notes, written in your Translate to language.',
    },
];

const SETUP = [
    {
        title: 'Open Settings',
        body: 'Click the gear in the DualSub popup, then choose AI Context.',
    },
    {
        title: 'Switch on Enable AI Context',
        body: 'It’s off by default, so nothing is sent until you turn it on.',
    },
    {
        title: 'Pick a provider and model',
        body: 'OpenAI GPT or Google Gemini. Paste your API key and keep the recommended model: GPT-5.6 Luna or Gemini 3.5 Flash.',
    },
    {
        title: 'Choose context types',
        body: 'Keep Cultural, Historical and Linguistic on, or only the ones you want.',
    },
];

const WORDS = ['Ponte', 'las', 'pilas'];

function Marker({ step, className }: { step: number; className: string }) {
    return <span className={`callout ai-marker ${className}`}>{step}</span>;
}

export function AiContext() {
    return (
        <Section id="ai-context" className="ai">
            <SectionHeading
                eyebrow="AI Context · Optional"
                title={
                    <>
                        Click a word.
                        <br /> Get the{' '}
                        <span className="text-gradient">story behind it</span>.
                    </>
                }
                lead="Turn on AI Context and the words in the subtitle become clickable. DualSub opens Chrome’s side panel with a definition plus cultural, historical and linguistic notes."
            />
            <Artboard
                className="ai-board"
                label="A Spanish line on Netflix with three words selected in blue, and Chrome’s side panel listing them under Words to Analyze with an Analyze button and the results"
            >
                <BrowserWindow
                    tabTitle="Opening Night — E1"
                    host="netflix.com"
                    path="/watch/80243918"
                >
                    <div className="ai-page">
                        <Player
                            className="ai-player"
                            scene={<StageScene />}
                            show="Opening Night"
                            episode="E1 “Five Minutes”"
                            subtitles={
                                <DualSubtitles
                                    original={
                                        <>
                                            <Marker
                                                step={1}
                                                className="ai-marker-words"
                                            />
                                            ¡
                                            <span className="subtitle-selected">
                                                Ponte
                                            </span>{' '}
                                            <span className="subtitle-selected">
                                                las
                                            </span>{' '}
                                            <span className="subtitle-selected">
                                                pilas
                                                <Cursor className="ai-cursor" />
                                            </span>
                                            , que salimos en cinco minutos!
                                        </>
                                    }
                                    originalLang="es"
                                    translation="Get it together — we’re on in five minutes!"
                                />
                            }
                            playing={false}
                            played={8}
                            buffered={20}
                            time="3:12 / 44:30"
                        />
                        <SidePanelMock
                            words={WORDS}
                            wordsMarker={
                                <Marker step={2} className="ai-marker-panel" />
                            }
                            analyzeMarker={
                                <Marker
                                    step={3}
                                    className="ai-marker-analyze"
                                />
                            }
                        />
                    </div>
                </BrowserWindow>
            </Artboard>
            <ol className="ai-steps">
                {STEPS.map(({ title, body }, index) => (
                    <li key={title}>
                        <span className="callout">{index + 1}</span>
                        <div>
                            <h3>{title}</h3>
                            <p>{body}</p>
                        </div>
                    </li>
                ))}
            </ol>
            <div className="byo">
                <div className="byo-figure">
                    <Artboard
                        className="byo-board"
                        label="DualSub’s settings page on AI Context, with AI Context enabled, OpenAI GPT as the provider, an API key and the gpt-5.6-luna model"
                    >
                        <SettingsMock />
                    </Artboard>
                </div>
                <div className="byo-text">
                    <p className="eyebrow">Set it up once</p>
                    <h3>Bring your own AI key</h3>
                    <ol>
                        {SETUP.map(({ title, body }, index) => (
                            <li key={title}>
                                <span className="callout callout-blue">
                                    {index + 1}
                                </span>
                                <div>
                                    <h4>{title}</h4>
                                    <p>{body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                    <p className="byo-note">
                        <Icon name="lock" />
                        Only the words you pick and a little nearby subtitle
                        text go to your AI provider. Your key is stored on this
                        device only.
                    </p>
                </div>
            </div>
        </Section>
    );
}
