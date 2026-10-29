import type { AiAnswer } from '@/messaging/contracts/analyzeContext';
import { Icon } from '../design/Icon';
import type { Translate } from '../hooks/useI18n';

/** `text` split around the first place it says `words`, any case. */
function marked(text: string, words: string): [string, string, string] {
    const at = text.toLocaleLowerCase().indexOf(words.toLocaleLowerCase());
    return at === -1 || words === ''
        ? [text, '', '']
        : [
              text.slice(0, at),
              text.slice(at, at + words.length),
              text.slice(at + words.length),
          ];
}

/** The AI's explanation of the picked words, in the order a learner reads
 *  it; culture and history stay folded until asked for. */
export function ExplanationView({
    t,
    answer,
    words,
    language,
    service,
}: {
    t: Translate;
    answer: AiAnswer;
    /** The picked words as they read, marked in each example. */
    words: string;
    language: string | undefined;
    /** The AI service's name. */
    service: string;
}) {
    const tip = t('sidepanelTip');
    return (
        <div className="ai">
            <div className="ai-section">
                <h3>{t('sidepanelInThisLine')}</h3>
                <p>{answer.meaning}</p>
            </div>
            {answer.examples && answer.examples.length > 0 && (
                <div className="ai-section">
                    <h3>{t('sidepanelExamples')}</h3>
                    <ul className="examples">
                        {answer.examples.map((example, index) => {
                            const [before, mark, after] = marked(
                                example.text,
                                words
                            );
                            return (
                                <li key={index}>
                                    <span lang={language}>
                                        {before}
                                        {mark && <strong>{mark}</strong>}
                                        {after}
                                    </span>
                                    <span className="example-translation">
                                        {example.translation}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
            {answer.similar && answer.similar.length > 0 && (
                <div className="ai-section">
                    <h3>{t('sidepanelSimilar')}</h3>
                    <ul className="chips" lang={language}>
                        {answer.similar.map((similar, index) => (
                            <li key={index}>{similar}</li>
                        ))}
                    </ul>
                </div>
            )}
            {answer.tip && (
                <div className="tip" title={tip}>
                    <Icon name="explain" />
                    <p>
                        <span className="sr-only">{tip}: </span>
                        {answer.tip}
                    </p>
                </div>
            )}
            {(answer.culture || answer.history) && (
                <div>
                    {answer.culture && (
                        <details className="more">
                            <summary>
                                {t('explainTypeCulture')}
                                <Icon name="chevron" />
                            </summary>
                            <p>{answer.culture}</p>
                        </details>
                    )}
                    {answer.history && (
                        <details className="more">
                            <summary>
                                {t('explainTypeHistory')}
                                <Icon name="chevron" />
                            </summary>
                            <p>{answer.history}</p>
                        </details>
                    )}
                </div>
            )}
            <p className="byline">{t('sidepanelWrittenBy', service)}</p>
        </div>
    );
}
