import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import { INTERFACE_LANGUAGES, SUBTITLE_LANGUAGES } from '../site';
import './Platforms.css';

const PLATFORM_FACTS = [
    'Looks like the site’s own subtitles, in your two languages',
    'Keeps up when you move to the next episode',
    'Stays on screen in fullscreen',
    'Hides the site’s own subtitles so lines never overlap',
];

export function Platforms() {
    return (
        <Section id="platforms">
            <SectionHeading
                eyebrow="Where it works"
                title="Your shows, your languages"
            />
            <div className="platforms">
                <div className="card platform">
                    <span className="feature-icon">
                        <Icon name="monitor" />
                    </span>
                    <h3>Netflix, Disney+ and YouTube</h3>
                    <p className="platform-sub">
                        Full support on all three, YouTube Shorts included
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
                <div className="card platform">
                    <span className="feature-icon">
                        <Icon name="languages" />
                    </span>
                    <h3>
                        Translate into {SUBTITLE_LANGUAGES.length} languages
                    </h3>
                    <p className="platform-sub">
                        Pick yours under I speak in the popup
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
