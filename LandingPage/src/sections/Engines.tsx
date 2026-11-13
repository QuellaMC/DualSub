import { Icon, type IconName } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import './Engines.css';

/** The translation services in Settings → Translation (src/ui/providerNames.ts). */
const ENGINES: readonly {
    name: string;
    icon: IconName;
    access: string;
    body: string;
}[] = [
    {
        name: 'Microsoft Translator',
        icon: 'zap',
        access: 'Free · no key',
        body: 'Good quality in most languages. Works right away.',
    },
    {
        name: 'Google Translate',
        icon: 'globe',
        access: 'Free · no key',
        body: 'Also works right away. Worth a try if Microsoft reads oddly in your language.',
    },
    {
        name: 'DeepL',
        icon: 'star',
        access: 'API key',
        body: 'Very natural translations. Needs a DeepL account, which has a free plan.',
    },
    {
        name: 'AI translation',
        icon: 'server',
        access: 'API key',
        body: 'ChatGPT, Gemini or another AI model translates, aware of the whole scene.',
    },
    {
        name: 'Google Vertex AI',
        icon: 'cloud',
        access: 'Google Cloud',
        body: 'Gemini through your Google Cloud project. Its private key is never stored.',
    },
];

export function Engines() {
    return (
        <Section id="translation">
            <SectionHeading
                eyebrow="Translation services"
                title="Pick the service that suits you"
                lead="Microsoft Translator is on by default: free, with nothing to set up. Switch any time in Settings → Translation, and the next line uses it. No reload needed."
                align="start"
            />
            <ul className="engines">
                {ENGINES.map(({ name, icon, access, body }, index) => (
                    <li
                        key={name}
                        className={
                            index === 0 ? 'engine engine-default' : 'engine'
                        }
                    >
                        <span className="feature-icon">
                            <Icon name={icon} />
                        </span>
                        {index === 0 ? (
                            <span className="engine-default-badge">
                                Default
                            </span>
                        ) : null}
                        <h3>{name}</h3>
                        <span className="engine-access">{access}</span>
                        <p>{body}</p>
                    </li>
                ))}
            </ul>
            <p className="engines-note">
                <Icon name="key" />
                Keys go in Settings → Translation and stay on this computer. If
                your service stops working, Microsoft Translator and then Google
                Translate cover for it, so the subtitles keep coming.
            </p>
        </Section>
    );
}
