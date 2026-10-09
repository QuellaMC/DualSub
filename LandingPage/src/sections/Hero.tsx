import { AddToChrome } from '../components/AddToChrome';
import { Artboard } from '../components/Artboard';
import { Icon } from '../components/Icon';
import { BrowserWindow } from '../mocks/Browser';
import { Player } from '../mocks/Player';
import { PopupMock } from '../mocks/Popup';
import { NightCityScene } from '../mocks/scenes';
import { DualSubtitles } from '../mocks/Subtitles';
import { sectionHref } from '../site';
import './Hero.css';

const FACTS = ['Chrome 116+', 'No account needed', 'Free translation built in'];

export function Hero() {
    return (
        <section className="hero">
            <div className="container hero-intro">
                <p className="hero-badge">
                    <span className="hero-badge-dot" />
                    Free Chrome extension for Netflix &amp; Disney+
                </p>
                <h1 className="hero-title">
                    Watch in{' '}
                    <span className="text-gradient">two languages</span>
                    <br /> at the same time.
                </h1>
                <p className="hero-lead">
                    DualSub puts the original dialogue and a translation on
                    screen together, so you can follow every scene and pick up a
                    new language as you watch.
                </p>
                <div className="hero-actions">
                    <AddToChrome />
                    <a
                        className="button button-secondary"
                        href={sectionHref('how-it-works')}
                    >
                        <Icon name="arrowRight" />
                        See how it works
                    </a>
                </div>
                <ul className="hero-facts">
                    {FACTS.map((fact) => (
                        <li key={fact}>
                            <Icon name="check" />
                            {fact}
                        </li>
                    ))}
                </ul>
            </div>
            <div className="hero-visual">
                <Artboard
                    className="hero-board"
                    label="Netflix playing in Chrome with an English subtitle line and its Chinese translation below it, next to the open DualSub popup"
                >
                    <BrowserWindow
                        tabTitle="Night Shift — S1:E3"
                        host="netflix.com"
                        path="/watch/81435684"
                    >
                        <Player
                            className="hero-player"
                            scene={<NightCityScene />}
                            show="Night Shift"
                            episode="S1:E3 “The Long Way Home”"
                            subtitles={
                                <DualSubtitles
                                    original="I’ve been meaning to tell you something."
                                    translation="我一直想告诉你一件事。"
                                    translationLang="zh-CN"
                                />
                            }
                            playing
                            played={27}
                            buffered={39}
                            time="12:48 / 48:02"
                        />
                    </BrowserWindow>
                    <PopupMock className="hero-popup" />
                </Artboard>
            </div>
        </section>
    );
}
