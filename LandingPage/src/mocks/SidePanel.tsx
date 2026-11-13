import type { ReactNode } from 'react';
import { LogoMark } from '../components/Brand';
import { ExtensionIcon } from './ExtensionIcon';
import './extension.css';
import './SidePanel.css';

/** The subtitle line as the panel quotes it, with the clicked words picked. */
const LINE: readonly { word: string; trail?: string; picked?: true }[] = [
    { word: 'Está' },
    { word: 'lloviendo' },
    { word: 'a', picked: true },
    { word: 'cántaros', trail: ',', picked: true },
    { word: 'no' },
    { word: 'salgas', trail: '.' },
];

const ENTRIES: readonly {
    from?: string;
    term: string;
    type: string;
    sense: string;
}[] = [
    {
        term: 'llover a cántaros',
        type: 'saying',
        sense: 'rain cats and dogs; pour, pelt',
    },
    { from: 'cántaros', term: 'cántaro', type: 'noun', sense: 'pitcher, jug' },
];

const EXAMPLES = [
    {
        before: 'Anoche llovió ',
        after: '.',
        translation: 'It poured last night.',
    },
    {
        before: 'Llueve ',
        after: ' y no tengo paraguas.',
        translation: 'It’s pouring and I don’t have an umbrella.',
    },
];

const SIMILAR = ['llover a mares', 'caer chuzos de punta', 'diluviar'];

/** What Explain with AI adds under the lookup (src/ui/sidepanel/ExplanationView.tsx). */
function Explanation() {
    return (
        <div className="side-panel-ai">
            <div className="side-panel-ai-section">
                <h4>In this line</h4>
                <p>
                    The rain outside is very heavy, which is why the speaker
                    says not to go out. People only say it about rain.
                </p>
            </div>
            <div className="side-panel-ai-section">
                <h4>Examples</h4>
                <ul className="side-panel-examples" lang="es">
                    {EXAMPLES.map(({ before, after, translation }) => (
                        <li key={translation}>
                            <span>
                                {before}
                                <strong>a cántaros</strong>
                                {after}
                            </span>
                            <span
                                className="side-panel-example-translation"
                                lang="en"
                            >
                                {translation}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="side-panel-ai-section">
                <h4>Said the same way</h4>
                <ul className="side-panel-chips" lang="es">
                    {SIMILAR.map((saying) => (
                        <li key={saying}>{saying}</li>
                    ))}
                </ul>
            </div>
            <p className="side-panel-tip">
                <ExtensionIcon name="explain" />
                Keep it with llover: llueve a cántaros, llovió a cántaros.
            </p>
            <div>
                <span className="side-panel-more">
                    The culture behind it
                    <ExtensionIcon name="chevron" />
                </span>
                <span className="side-panel-more">
                    History and origin
                    <ExtensionIcon name="chevron" />
                </span>
            </div>
            <p className="side-panel-byline">
                Written by Google Gemini. It can make mistakes.
            </p>
        </div>
    );
}

/**
 * Chrome's side panel showing DualSub's word panel (src/ui/sidepanel) in its
 * light theme: the line the words came from, what they mean, and either the
 * Explain with AI button or, when `explained`, the panel scrolled down to the
 * explanation. The markers, when given, are pinned to the quoted line and the
 * dictionary entries.
 */
export function SidePanelMock({
    className,
    explained = false,
    lineMarker,
    entryMarker,
}: {
    className: string;
    explained?: boolean;
    lineMarker?: ReactNode;
    entryMarker?: ReactNode;
}) {
    return (
        <div className={`extension-ui side-panel ${className}`}>
            <div className="side-panel-head">
                <span className="side-panel-brand">
                    <LogoMark className="side-panel-logo" />
                    DualSub
                </span>
                <span className="side-panel-pair">Spanish → English</span>
            </div>
            <div
                className={
                    explained
                        ? 'side-panel-body side-panel-scrolled'
                        : 'side-panel-body'
                }
            >
                <div className="side-panel-quote">
                    {lineMarker}
                    <p className="side-panel-line" lang="es">
                        {LINE.map(({ word, trail, picked }) => (
                            <span key={word} className="side-panel-token">
                                <span
                                    className={
                                        picked
                                            ? 'side-panel-word side-panel-picked'
                                            : 'side-panel-word'
                                    }
                                >
                                    {word}
                                </span>
                                {trail ? (
                                    <span className="side-panel-trail">
                                        {trail}
                                    </span>
                                ) : null}
                            </span>
                        ))}
                    </p>
                    <p className="side-panel-line-translation">
                        It’s pouring, don’t go out.
                    </p>
                </div>
                <div className="ext-card side-panel-card">
                    <div className="side-panel-lookup-head">
                        <div className="side-panel-headword-row">
                            <h4 className="side-panel-headword" lang="es">
                                a cántaros
                            </h4>
                            {explained ? (
                                <span className="ext-tag">Everyday</span>
                            ) : null}
                        </div>
                        <p className="side-panel-translation">
                            <ExtensionIcon name="translation" />
                            in buckets
                        </p>
                    </div>
                    <div className="side-panel-dictionary">
                        {entryMarker}
                        {ENTRIES.map(({ from, term, type, sense }) => (
                            <div key={term} className="side-panel-entry">
                                <p className="side-panel-entry-head">
                                    {from ? (
                                        <>
                                            <span
                                                className="side-panel-entry-from"
                                                lang="es"
                                            >
                                                {from}
                                            </span>
                                            <span className="side-panel-entry-arrow">
                                                <ExtensionIcon name="later" />
                                            </span>
                                        </>
                                    ) : null}
                                    <strong lang="es">{term}</strong>
                                    <em>{type}</em>
                                </p>
                                <p>{sense}</p>
                            </div>
                        ))}
                        <p className="side-panel-source">
                            From Google Translate
                        </p>
                    </div>
                    {explained ? (
                        <Explanation />
                    ) : (
                        <span className="side-panel-explain">
                            Explain with AI
                        </span>
                    )}
                </div>
            </div>
            <div className="side-panel-foot">
                <span className="ext-icon-button">
                    <ExtensionIcon name="help" />
                </span>
                <span className="ext-icon-button">
                    <ExtensionIcon name="settings" />
                </span>
            </div>
        </div>
    );
}
