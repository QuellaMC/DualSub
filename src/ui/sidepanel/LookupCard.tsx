import type { ReactNode } from 'react';
import type { AnswerRegister } from '@/messaging/contracts/analyzeContext';
import type {
    DictionaryEntry,
    DictionarySource,
    WordType,
} from '@/messaging/contracts/lookupWords';
import { Icon } from '../design/Icon';
import { Interpolate } from '../design/Interpolate';
import type { Translate } from '../hooks/useI18n';
import { languageName } from '../languageLabels';
import type { Lookup } from './usePanelConnection';

const REGISTER_LABELS: Record<AnswerRegister, string> = {
    everyday: 'sidepanelRegisterEveryday',
    casual: 'sidepanelRegisterCasual',
    formal: 'sidepanelRegisterFormal',
    slang: 'sidepanelRegisterSlang',
    offensive: 'sidepanelRegisterOffensive',
};

/** A word type's name; an unnamed type shows none. */
const WORD_TYPE_LABELS: Record<WordType, string | null> = {
    noun: 'sidepanelWordTypeNoun',
    verb: 'sidepanelWordTypeVerb',
    adjective: 'sidepanelWordTypeAdjective',
    adverb: 'sidepanelWordTypeAdverb',
    pronoun: 'sidepanelWordTypePronoun',
    preposition: 'sidepanelWordTypePreposition',
    conjunction: 'sidepanelWordTypeConjunction',
    interjection: 'sidepanelWordTypeInterjection',
    saying: 'sidepanelWordTypeSaying',
    other: null,
};

function SourceLine({
    t,
    source,
    term,
}: {
    t: Translate;
    source: DictionarySource;
    term: string;
}) {
    return (
        <p className="source">
            <Interpolate text={t('sidepanelFrom')}>
                {source === 'google' ? (
                    'Google Translate'
                ) : (
                    <a
                        href={`https://en.wiktionary.org/wiki/${encodeURIComponent(term.replace(/ /g, '_'))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Wiktionary
                    </a>
                )}
            </Interpolate>
        </p>
    );
}

function Entry({
    t,
    entry,
    language,
}: {
    t: Translate;
    entry: DictionaryEntry;
    language: string | undefined;
}) {
    const type = WORD_TYPE_LABELS[entry.type];
    return (
        <div className="entry">
            <div className="entry-head">
                {entry.from !== null && (
                    <>
                        <span className="entry-from" lang={language}>
                            {entry.from}
                        </span>
                        <span
                            className="entry-arrow"
                            title={t('sidepanelFormOf')}
                        >
                            <Icon name="later" />
                            <span className="sr-only">
                                {t('sidepanelFormOf')}
                            </span>
                        </span>
                    </>
                )}
                <span className="entry-term" lang={language}>
                    {entry.term}
                </span>
                {type && <span className="entry-type">{t(type)}</span>}
            </div>
            {entry.senses.length === 1 ? (
                <p className="sense">{entry.senses[0]}</p>
            ) : (
                <ol className="senses">
                    {entry.senses.map((sense, index) => (
                        <li key={index}>{sense}</li>
                    ))}
                </ol>
            )}
        </div>
    );
}

/** Lines that stand in for text still on its way. */
export function Placeholder({ widths }: { widths: readonly number[] }) {
    return (
        <div className="placeholder" aria-hidden="true">
            {widths.map((width, index) => (
                <span key={index} style={{ width: `${width}%` }} />
            ))}
        </div>
    );
}

/**
 * What the picked words are: the words as they read, how the AI says they
 * sound once it has said, their translation, and their dictionary entries.
 * `children` is the AI part under them.
 */
export function LookupCard({
    t,
    lookup,
    register,
    children,
}: {
    t: Translate;
    lookup: Lookup;
    register: AnswerRegister | null;
    children: ReactNode;
}) {
    const language = lookup.line.language ?? undefined;
    const result = lookup.result;
    const inTarget = t(
        'sidepanelInLanguage',
        languageName(t, lookup.targetLanguage)
    );
    return (
        <section className="card lookup" aria-live="polite">
            <div className="lookup-head">
                <div className="headword-row">
                    <h2 className="headword" lang={language}>
                        {lookup.text}
                    </h2>
                    {register && (
                        <span className="tag ok">
                            {t(REGISTER_LABELS[register])}
                        </span>
                    )}
                </div>
                {result === null ? (
                    <Placeholder widths={[46]} />
                ) : (
                    result.translation && (
                        <div className="translation" title={inTarget}>
                            <Icon name="translation" />
                            <p>
                                <span className="sr-only">{inTarget}: </span>
                                {result.translation}
                            </p>
                        </div>
                    )
                )}
            </div>
            {result === null ? (
                <Placeholder widths={[38, 72, 30, 54]} />
            ) : result.source !== null ? (
                <div className="dictionary">
                    {result.entries.map((entry, index) => (
                        <Entry
                            key={index}
                            t={t}
                            entry={entry}
                            language={language}
                        />
                    ))}
                    <SourceLine
                        t={t}
                        source={result.source}
                        term={result.entries[0]?.term ?? lookup.text}
                    />
                </div>
            ) : (
                <p className="help">
                    {t(
                        lookup.entries.length === 1
                            ? 'sidepanelNoEntry'
                            : 'sidepanelNoEntryPhrase'
                    )}
                </p>
            )}
            {children}
        </section>
    );
}
