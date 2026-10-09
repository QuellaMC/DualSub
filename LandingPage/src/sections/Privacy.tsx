import { Icon, type IconName } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import './Privacy.css';

const PROMISES: readonly { icon: IconName; title: string; body: string }[] = [
    {
        icon: 'key',
        title: 'Keys stay on this device',
        body: 'API keys and tokens are saved locally and never synced to your other browsers.',
    },
    {
        icon: 'shieldCheck',
        title: 'No DualSub servers',
        body: 'Subtitle text goes straight from your browser to the engine you pick. Nothing is sent to us.',
    },
    {
        icon: 'sparkle',
        title: 'AI Context is opt-in',
        body: 'It stays off until you enable it, and only sends the words you select plus a little nearby subtitle text.',
    },
];

export function Privacy() {
    return (
        <Section id="privacy">
            <SectionHeading
                eyebrow="Privacy"
                title="Private by design"
                align="start"
                compact
            />
            <ul className="privacy">
                {PROMISES.map(({ icon, title, body }) => (
                    <li key={title}>
                        <span className="feature-icon feature-icon-green">
                            <Icon name={icon} />
                        </span>
                        <div>
                            <h3>{title}</h3>
                            <p>{body}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </Section>
    );
}
