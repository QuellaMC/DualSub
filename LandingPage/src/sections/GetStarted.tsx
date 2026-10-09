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
        body: 'Install it from the Chrome Web Store. Then open the puzzle-piece menu in the toolbar and pin DualSub so it’s always one click away.',
        art: <PinExtensionArt />,
        artLabel:
            'Chrome’s extensions menu with the pin button next to DualSub',
    },
    {
        title: 'Turn on subtitles in your show',
        body: 'Open Netflix or Disney+, start any show or movie and turn subtitles on in the player’s audio & subtitles menu.',
        art: <SubtitleMenuArt />,
        artLabel: 'A player’s subtitle menu with English selected',
    },
    {
        title: 'Choose your languages',
        body: 'Click the DualSub icon and switch on Enable Dual Subtitles. Then pick the show’s language under Language Set and yours under Translate to.',
        art: <ChooseLanguagesArt />,
        artLabel:
            'The DualSub popup with Enable Dual Subtitles and Translate to outlined',
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
                <span className="feature-icon feature-icon-amber">
                    <Icon name="eyeOff" />
                </span>
                <p>
                    <strong>No overlapping lines.</strong> DualSub hides the
                    platform’s own subtitles while it’s active. Want them back
                    as well? Turn off <em>Hide Official Subtitles</em> in
                    Settings → General.
                </p>
            </aside>
        </Section>
    );
}
