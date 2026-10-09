import { Icon } from '../components/Icon';
import { Section, SectionHeading } from '../components/Section';
import './Faq.css';

const QUESTIONS = [
    {
        question: 'I only see one subtitle line.',
        answer: 'Check that subtitles are turned on in the Netflix or Disney+ player and that Enable Dual Subtitles is on in the DualSub popup. Also make sure the show offers subtitles at all.',
    },
    {
        question: 'The second line says “[Translation API Error…]”.',
        answer: 'Switch engines in Settings → Translation, or raise Request Delay (ms) under Performance. For keyed engines, re-check your key in Settings → Providers.',
    },
    {
        question: 'The subtitles are out of sync.',
        answer: 'Open Subtitle Appearance & Timing and change Time Offset(s). Positive numbers show subtitles earlier, negative numbers later.',
    },
    {
        question: 'AI Context doesn’t answer.',
        answer: 'Make sure it’s enabled in Settings → AI Context, your API key and model are set, and at least one context type is on. The side panel shows the provider’s own error message if a request fails.',
    },
    {
        question: 'Can I keep the platform’s own subtitles?',
        answer: 'Yes. Turn off Hide Official Subtitles in Settings → General.',
    },
    {
        question: 'Is DualSub free?',
        answer: 'Yes. The default engines need no account or key. Keyed engines and AI Context are billed by your own provider account.',
    },
];

export function Faq() {
    return (
        <Section id="faq" alt>
            <SectionHeading
                eyebrow="Help"
                title="Troubleshooting & FAQ"
                lead="Quick fixes for the most common questions."
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
