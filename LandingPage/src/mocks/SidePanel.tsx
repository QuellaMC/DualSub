import type { ReactNode } from 'react';
import { LogoMark } from '../components/Brand';
import { Icon } from '../components/Icon';
import './SidePanel.css';

/**
 * Chrome's side panel with DualSub's AI Analysis tab in its dark theme. The
 * markers, when given, are pinned to the word list and the Analyze button.
 */
export function SidePanelMock({
    words,
    wordsMarker,
    analyzeMarker,
}: {
    words: readonly string[];
    wordsMarker?: ReactNode;
    analyzeMarker?: ReactNode;
}) {
    return (
        <div className="side-panel">
            <div className="side-panel-bar">
                <LogoMark className="side-panel-logo" />
                <strong>DualSub</strong>
                <Icon name="chevronDown" className="side-panel-menu" />
                <Icon name="pin" className="side-panel-tool" />
                <Icon name="close" className="side-panel-tool" />
            </div>
            <div className="side-panel-body">
                <div className="side-panel-heading">
                    <span className="side-panel-title">AI Analysis</span>
                    <span className="side-panel-analyze">
                        {analyzeMarker}
                        <Icon name="sparkle" />
                        Analyze
                    </span>
                </div>
                <div className="side-panel-box">
                    <span className="side-panel-label">Words to Analyze</span>
                    <span className="side-panel-words">
                        {wordsMarker}
                        {words.map((word) => (
                            <span
                                key={word}
                                className="side-panel-word"
                                lang="es"
                            >
                                {word}
                                <span className="side-panel-remove">
                                    <Icon name="close" />
                                </span>
                            </span>
                        ))}
                    </span>
                </div>
                <div className="side-panel-box side-panel-results">
                    <span className="side-panel-results-title">
                        Results for &quot;{words.join(', ')}&quot;
                    </span>
                    <span className="side-panel-section">Definition</span>
                    <p>
                        Informal: “get it together” — hurry up, focus and put in
                        more effort.
                    </p>
                    <span className="side-panel-section">Cultural Context</span>
                    <strong>Social Usage</strong>
                    <p>
                        Heard all over Spain and Latin America, from friends,
                        coaches and parents.
                    </p>
                    <strong>Formality</strong>
                    <p>Casual and friendly; too blunt for a formal setting.</p>
                </div>
            </div>
        </div>
    );
}
