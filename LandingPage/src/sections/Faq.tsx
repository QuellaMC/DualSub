import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import './Faq.css';

const QUESTIONS = [
    {
        question: 'I only see one subtitle line.',
        answer: 'Turn on subtitles in the player, and check Dual subtitles is on in the DualSub popup. If the video is already in your language, DualSub shows one line on purpose.',
    },
    {
        question: 'The words don’t match what I hear.',
        answer: 'Press the Timing arrows in the popup. Each press moves the subtitles half a second earlier or later.',
    },
    {
        question: 'I see subtitles twice.',
        answer: 'Turn on Hide the site’s own subtitles in Settings → Sites, or press Fix it for me in Settings → Help.',
    },
    {
        question: 'The translation reads badly.',
        answer: 'Try another service in Settings → Translation. If the show has its own translation in your language, turn on Use the show’s own translation in Settings → Languages.',
    },
    {
        question: 'No subtitles appear.',
        answer: 'Play the video, since a paused title screen shows none, and check the player’s subtitle menu has subtitles. If DualSub was just installed or updated, reload the page.',
    },
    {
        question: 'Is DualSub free?',
        answer: 'Yes. Word lookup and the default translation services need no account or key. DeepL, AI translation, Vertex AI and Explain with AI use your own account.',
    },
];

export function Faq() {
    return (
        <Section id="faq">
            <SectionHeading
                eyebrow="Help"
                title="Troubleshooting & FAQ"
                lead="Quick fixes for the most common questions. Settings → Help fixes most of them in one click."
            />
            <dl className="faq">
                {QUESTIONS.map(({ question, answer }) => (
                    <div key={question} className="card faq-item">
                        <dt>
                            <Icon name="help" />
                            {question}
                        </dt>
                        <dd>{answer}</dd>
                    </div>
                ))}
            </dl>
        </Section>
    );
}
