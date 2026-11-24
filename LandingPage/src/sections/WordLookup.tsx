import { Artboard } from '../components/Artboard';
import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import { BrowserWindow } from '../mocks/Browser';
import { Cursor } from '../mocks/Cursor';
import { Player } from '../mocks/Player';
import { NightCityScene } from '../mocks/scenes';
import { SidePanelMock } from '../mocks/SidePanel';
import { DualSubtitles } from '../mocks/Subtitles';
import './WordLookup.css';

const STEPS = [
    {
        title: 'Click any word in the subtitles',
        body: 'The video pauses and the word turns blue. Click the video when you’re ready to keep watching.',
    },
    {
        title: 'Add words for a phrase',
        body: 'The panel shows the line and its translation. Click the words beside yours, there or in the subtitles. Click a blue word to drop it.',
    },
    {
        title: 'See what it means',
        body: 'Its translation, and dictionary entries from Google, or from Wiktionary when Google has none. No account, no key.',
    },
];

const KEY_STEPS = [
    {
        title: 'Choose an AI service',
        body: 'Google Gemini or OpenAI. The panel walks you through these steps the first time you press Explain with AI.',
    },
    {
        title: 'Get a key',
        body: 'A button opens the service’s key page. Sign in, create a key and copy it.',
    },
    {
        title: 'Paste it here',
        body: 'Press Check and explain. DualSub checks the key, then explains.',
    },
];

function Marker({ step, className }: { step: number; className: string }) {
    return <span className={`callout lookup-marker ${className}`}>{step}</span>;
}

export function WordLookup() {
    return (
        <Section id="word-lookup">
            <SectionHeading
                eyebrow="Word lookup · No setup"
                title={
                    <>
                        Click a word.
                        <br /> See{' '}
                        <span className="text-accent">what it means</span>.
                    </>
                }
                lead="The video pauses, and Chrome’s side panel shows the word’s translation and a dictionary entry. Click the words beside it to look up a whole phrase."
            />
            <Artboard
                className="lookup-board"
                label="A Spanish line on Netflix with “a cántaros” picked in blue, and Chrome’s side panel showing the line, its translation, two dictionary entries and the Explain with AI button"
            >
                <BrowserWindow
                    tabTitle="Noches de Madrid — E2"
                    host="netflix.com"
                    path="/watch/81262746"
                >
                    <div className="lookup-page">
                        <Player
                            className="lookup-player"
                            scene={<NightCityScene />}
                            show="Noches de Madrid"
                            episode="E2 “No salgas”"
                            subtitles={
                                <DualSubtitles
                                    original={
                                        <>
                                            Está lloviendo{' '}
                                            <span className="subtitle-selected">
                                                a
                                            </span>{' '}
                                            <span className="subtitle-selected">
                                                cántaros
                                                <Cursor className="lookup-cursor" />
                                                <Marker
                                                    step={1}
                                                    className="lookup-marker-word"
                                                />
                                            </span>
                                            , no salgas.
                                        </>
                                    }
                                    originalLang="es"
                                    translation="It’s pouring, don’t go out."
                                />
                            }
                            playing={false}
                            played={34}
                            buffered={46}
                            time="16:05 / 47:12"
                        />
                        <SidePanelMock
                            className="lookup-panel"
                            lineMarker={
                                <Marker
                                    step={2}
                                    className="lookup-marker-line"
                                />
                            }
                            entryMarker={
                                <Marker
                                    step={3}
                                    className="lookup-marker-entry"
                                />
                            }
                        />
                    </div>
                </BrowserWindow>
            </Artboard>
            <ol className="lookup-steps">
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
            <div className="lookup-explain">
                <div className="lookup-explain-figure">
                    <Artboard
                        className="lookup-explain-board"
                        label="The side panel scrolled to its AI explanation of “a cántaros”: what it means in this line, examples, similar sayings and a tip"
                    >
                        <SidePanelMock className="lookup-explained" explained />
                    </Artboard>
                </div>
                <div className="lookup-explain-text">
                    <p className="eyebrow">Explain with AI · Optional</p>
                    <h3>Learn how it’s really used.</h3>
                    <p className="lookup-explain-lead">
                        Press Explain with AI and your AI service explains the
                        words in this very line: what they mean here, how casual
                        or formal they sound, with examples and other ways to
                        say it. The culture and history behind them are a click
                        away.
                    </p>
                    <ol>
                        {KEY_STEPS.map(({ title, body }, index) => (
                            <li key={title}>
                                <span className="callout">{index + 1}</span>
                                <div>
                                    <h4>{title}</h4>
                                    <p>{body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                    <p className="lookup-explain-note">
                        <Icon name="lock" />
                        Only the words you clicked and their line go to your AI
                        service, and only when you press Explain with AI. Your
                        key stays on this computer.
                    </p>
                </div>
            </div>
        </Section>
    );
}
