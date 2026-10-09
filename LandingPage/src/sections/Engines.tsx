import { Icon, type IconName } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import './Engines.css';

type Tone = 'green' | 'amber' | 'blue';

const ENGINES: readonly {
    name: string;
    icon: IconName;
    tone: Tone;
    access: string;
    body: string;
}[] = [
    {
        name: 'Microsoft Translate',
        icon: 'zap',
        tone: 'green',
        access: 'Free · no key',
        body: 'The default engine. Fast and dependable, with nothing to set up.',
    },
    {
        name: 'Google Translate',
        icon: 'globe',
        tone: 'green',
        access: 'Free · no key',
        body: 'Free, with very broad language coverage.',
    },
    {
        name: 'DeepL',
        icon: 'star',
        tone: 'amber',
        access: 'API key',
        body: 'Natural-sounding translations with a DeepL API Free or Pro key.',
    },
    {
        name: 'OpenAI Compatible',
        icon: 'server',
        tone: 'amber',
        access: 'API key',
        body: 'Any OpenAI-compatible endpoint and model you choose, with your own key.',
    },
    {
        name: 'Vertex AI Gemini',
        icon: 'cloud',
        tone: 'blue',
        access: 'Google Cloud',
        body: 'Gemini through your Google Cloud project. Import a service-account JSON once; the key isn’t stored.',
    },
];

export function Engines() {
    return (
        <Section id="engines">
            <SectionHeading
                eyebrow="Translation engines"
                title="Pick the engine that suits you"
                lead="Microsoft Translate is on by default — free, with nothing to configure. Switch any time in Settings → Translation; the next line uses the new engine, no reload needed."
                align="start"
            />
            <ul className="engines">
                {ENGINES.map(({ name, icon, tone, access, body }, index) => (
                    <li
                        key={name}
                        className={
                            index === 0 ? 'engine engine-default' : 'engine'
                        }
                    >
                        <span className={`feature-icon feature-icon-${tone}`}>
                            <Icon name={icon} />
                        </span>
                        {index === 0 ? (
                            <span className="engine-default-badge">
                                Default
                            </span>
                        ) : null}
                        <h3>{name}</h3>
                        <span className={`engine-access engine-access-${tone}`}>
                            {access}
                        </span>
                        <p>{body}</p>
                    </li>
                ))}
            </ul>
            <p className="engines-note">
                <Icon name="key" />
                Keys go in Settings → Providers and are stored on this device
                only. The no-key engines are best-effort services and can change
                without notice.
            </p>
        </Section>
    );
}
