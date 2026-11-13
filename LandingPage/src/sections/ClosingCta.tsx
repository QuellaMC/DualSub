import { AddToChrome } from '../components/AddToChrome';
import { LogoMark } from '../components/Brand';
import { Icon } from '../components/Icon';
import { Section } from '../components/Section';
import { GITHUB_URL } from '../site';
import './ClosingCta.css';

export function ClosingCta() {
    return (
        <Section className="closing">
            <div className="closing-card">
                <LogoMark className="closing-logo" />
                <h2>Ready for your next episode?</h2>
                <p>
                    Add DualSub to Chrome, turn on subtitles, and watch in two
                    languages tonight.
                </p>
                <div className="closing-actions">
                    <AddToChrome />
                    <a className="button button-secondary" href={GITHUB_URL}>
                        <Icon name="github" />
                        View on GitHub
                    </a>
                </div>
            </div>
        </Section>
    );
}
