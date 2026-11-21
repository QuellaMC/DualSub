import { Artboard } from '../components/Artboard';
import { LogoMark } from '../components/Brand';
import { Section, SectionHeading } from '../components/Section';
import { BrowserWindow } from '../mocks/Browser';
import {
    POPUP_CONTROL_NUMBERS,
    PopupMock,
    type PopupControl,
} from '../mocks/Popup';
import { SettingsMock } from '../mocks/Settings';
import './PopupTour.css';

const CONTROLS: readonly {
    control: PopupControl;
    title: string;
    body: string;
}[] = [
    {
        control: 'status',
        title: 'Status',
        body: 'Ready on Netflix, or Working on this video once it plays: whether DualSub is on in this tab, and in which languages.',
    },
    {
        control: 'enabled',
        title: 'Dual subtitles',
        body: 'Turns DualSub on or off for this site only. Your other sites stay as they are.',
    },
    {
        control: 'languages',
        title: 'I speak and Original line',
        body: 'Pick your language once; the translation line is always in it. The original line follows the language spoken in the video by itself.',
    },
    {
        control: 'adjustments',
        title: 'Text size, Timing and Position',
        body: 'Nudge the subtitles while you watch: bigger or smaller, half a second earlier or later, higher or lower. The video follows at once.',
    },
    {
        control: 'settings',
        title: 'All settings (gear icon)',
        body: 'Opens the settings page: languages, style, translation service, word meanings and sites.',
    },
];

export function PopupTour() {
    return (
        <Section id="popup">
            <SectionHeading
                eyebrow="The popup"
                title="Everything is one click away"
                lead="Click the DualSub icon in your toolbar while you watch. It works like a remote control for the video in the tab."
            />
            <div className="tour">
                <div className="tour-figure">
                    <Artboard
                        className="tour-board"
                        label="The DualSub popup with each control numbered"
                    >
                        <PopupMock
                            className="tour-popup"
                            state="ready"
                            numbered
                        />
                    </Artboard>
                </div>
                <ol className="tour-list">
                    {CONTROLS.map(({ control, title, body }) => (
                        <li key={control}>
                            <span className="callout">
                                {POPUP_CONTROL_NUMBERS[control]}
                            </span>
                            <div>
                                <h3>{title}</h3>
                                <p>{body}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
            <div className="tour-settings">
                <SectionHeading
                    eyebrow="The settings page"
                    title="Every setting, in plain words"
                    lead="The gear opens it. The menu on the left names each section, and the search box finds a setting by everyday words, like “size” or “twice”."
                    compact
                />
                <Artboard
                    className="tour-settings-board"
                    label="DualSub’s settings page on Start, with its menu of sections, search, and the subtitles in your languages"
                >
                    <BrowserWindow
                        tabTitle="DualSub Settings"
                        host="DualSub"
                        path=" · chrome-extension://…/options.html"
                        favicon={<LogoMark className="tour-settings-favicon" />}
                    >
                        <SettingsMock />
                    </BrowserWindow>
                </Artboard>
            </div>
        </Section>
    );
}
