import React from 'react';

/**
 * Words Lists Tab
 * 
 * Displays user's saved word lists with filtering and starring capabilities.
 * Currently shows placeholder UI as feature is disabled by default.
 */
export function WordsListsTab() {
    // Sample data for UI demonstration
    const sampleWords = [
        {
            word: 'Serendipity',
            translation:
                'The occurrence and development of events by chance in a happy or beneficial way.',
            starred: true,
        },
        {
            word: 'Ephemeral',
            translation: 'Lasting for a very short time.',
            starred: false,
        },
        {
            word: 'Mellifluous',
            translation:
                '(Of a voice or words) sweet or musical; pleasant to hear.',
            starred: false,
        },
    ];

    return (
        <>
            <div className="words-lists-tab">
                <h1 className="tab-title">My Words</h1>

                <div className="controls-row">
                    <div className="list-selector">
                        <select className="list-select">
                            <option>My First List</option>
                            <option>Vocabulary for Beginners</option>
                            <option>Advanced Terminology</option>
                        </select>
                        <span className="select-icon material-symbols-outlined">
                            unfold_more
                        </span>
                    </div>
                    <button className="filter-button">
                        <span className="material-symbols-outlined">
                            filter_list
                        </span>
                    </button>
                </div>

                <div className="feature-notice">
                    <span className="material-symbols-outlined notice-icon">
                        info
                    </span>
                    <p>
                        <strong>Words Lists feature coming soon!</strong>
                        <br />
                        This feature is currently in development. Enable it in
                        Settings to try the preview.
                    </p>
                </div>

                <div className="words-list">
                    {sampleWords.map((item, index) => (
                        <a
                            key={index}
                            href="#"
                            className={`word-card ${item.starred ? 'starred' : ''}`}
                            onClick={(e) => e.preventDefault()}
                        >
                            <div className="word-content">
                                <p className="word-text">{item.word}</p>
                                <p className="word-translation">
                                    {item.translation}
                                </p>
                            </div>
                            <div className="word-actions">
                                <button className="star-button">
                                    <span
                                        className={`material-symbols-outlined ${item.starred ? 'filled' : ''}`}
                                    >
                                        star
                                    </span>
                                </button>
                            </div>
                        </a>
                    ))}
                </div>
            </div>
        </>
    );
}
