import { Artboard } from '../components/Artboard';
import { Section, SectionHeading } from '../components/Section';
import {
    POPUP_CONTROL_NUMBERS,
    PopupMock,
    type PopupControl,
} from '../mocks/Popup';
import { SUBTITLE_LANGUAGES } from '../site';
import './PopupTour.css';

const CONTROLS: readonly {
    control: PopupControl;
    title: string;
    body: string;
}[] = [
    {
        control: 'enable',
        title: 'Enable Dual Subtitles',
        body: 'The master switch. Turn the second subtitle line on or off at any time.',
    },
    {
        control: 'official',
        title: 'Use Official Subtitles',
        body: 'If the show already has subtitles in your language, DualSub shows those human-made ones instead of a machine translation.',
    },
    {
        control: 'languageSet',
        title: 'Language Set',
        body: 'The language of the show’s own subtitles — the line you’re learning from.',
    },
    {
        control: 'translateTo',
        title: 'Translate to',
        body: `The language of the second line. Choose from ${SUBTITLE_LANGUAGES.length} languages.`,
    },
    {
        control: 'appearance',
        title: 'Subtitle Appearance & Timing',
        body: 'Layout, order, size, spacing, position and sync. Changes appear on the video while you adjust them.',
    },
    {
        control: 'settings',
        title: 'Settings (gear icon)',
        body: 'Opens the full settings page: translation engines, AI Context, interface language and more.',
    },
];

export function PopupTour() {
    return (
        <Section id="popup" alt>
            <SectionHeading
                eyebrow="The popup"
                title="Everything is one click away"
                lead="Click the DualSub icon in your toolbar at any time. Here’s what each control does."
            />
            <div className="tour">
                <div className="tour-figure">
                    <Artboard
                        className="tour-board"
                        label="The DualSub popup with each control numbered"
                    >
                        <PopupMock className="tour-popup" numbered />
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
        </Section>
    );
}
