import type { ReactNode } from 'react';
import { Artboard } from '../components/Artboard';
import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import {
    ChooseLanguagesArt,
    PinExtensionArt,
    SubtitleMenuArt,
} from './StepArt';
import './GetStarted.css';

const STEPS: readonly {
    title: string;
    body: string;
    art: ReactNode;
    artLabel: string;
}[] = [
    {
        title: 'Add DualSub to Chrome',
        body: 'Install it from the Chrome Web Store. A welcome page opens and shows you how to pin DualSub, so it’s always one click away.',
        art: <PinExtensionArt />,
        artLabel:
            'Chrome’s extensions menu with the pin button next to DualSub',
    },
    {
        title: 'Turn on subtitles in your show',
        body: 'Open Netflix, Disney+ or YouTube, start a video and turn on subtitles in the player.',
        art: <SubtitleMenuArt />,
        artLabel: 'A player’s subtitle menu with English selected',
    },
    {
        title: 'Choose your language',
        body: 'Click the DualSub icon and check Dual subtitles is on. Pick your language under I speak; the original line follows the video by itself.',
        art: <ChooseLanguagesArt />,
        artLabel:
            'The DualSub popup with the Dual subtitles switch and I speak outlined',
    },
];

export function GetStarted() {
    return (
        <Section id="how-it-works">
            <SectionHeading
                eyebrow="Get started"
                title="Set up in under a minute"
                lead="Three quick steps and you’re watching with two subtitle lines."
            />
            <ol className="steps">
                {STEPS.map(({ title, body, art, artLabel }, index) => (
                    <li key={title} className="card step">
                        <Artboard className="step-board" label={artLabel}>
                            {art}
                        </Artboard>
                        <div className="step-text">
                            <p className="eyebrow">Step {index + 1}</p>
                            <h3>{title}</h3>
                            <p>{body}</p>
                        </div>
                    </li>
                ))}
            </ol>
            <aside className="overlap-note">
                <span className="feature-icon">
                    <Icon name="eyeOff" />
                </span>
                <p>
                    <strong>No overlapping lines.</strong> DualSub hides the
                    site’s own subtitles while it’s on. Want them back as well?
                    Turn off <em>Hide the site’s own subtitles</em> in Settings
                    → Sites.
                </p>
            </aside>
        </Section>
    );
}
