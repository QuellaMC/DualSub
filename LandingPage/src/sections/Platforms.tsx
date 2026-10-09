import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import { INTERFACE_LANGUAGES, SUBTITLE_LANGUAGES } from '../site';
import './Platforms.css';

const PLATFORM_FACTS = [
    'Reads subtitles straight from the player: nothing to download',
    'Keeps up when you move to the next episode',
    'Stays on screen in fullscreen',
    'Hides the platform’s own subtitles so lines never overlap',
];

export function Platforms() {
    return (
        <Section id="platforms" alt>
            <SectionHeading
                eyebrow="Where it works"
                title="Your shows, your languages"
            />
            <div className="platforms">
                <div className="card platform platform-streaming">
                    <span className="feature-icon feature-icon-blue">
                        <Icon name="monitor" />
                    </span>
                    <h3>Netflix and Disney+</h3>
                    <p className="platform-sub">
                        Full support on both platforms
                    </p>
                    <ul className="platform-facts">
                        {PLATFORM_FACTS.map((fact) => (
                            <li key={fact}>
                                <Icon name="check" />
                                {fact}
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="card platform platform-languages">
                    <span className="feature-icon feature-icon-amber">
                        <Icon name="languages" />
                    </span>
                    <h3>
                        Translate into {SUBTITLE_LANGUAGES.length} languages
                    </h3>
                    <p className="platform-sub">
                        Pick one under Translate to in the popup
                    </p>
                    <ul className="platform-chips">
                        {SUBTITLE_LANGUAGES.map((language) => (
                            <li key={language}>{language}</li>
                        ))}
                    </ul>
                    <div className="platform-interface">
                        <p>
                            Interface in {INTERFACE_LANGUAGES.length} languages
                        </p>
                        <ul>
                            {INTERFACE_LANGUAGES.map(({ name, lang }) => (
                                <li key={lang} lang={lang}>
                                    {name}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </Section>
    );
}
