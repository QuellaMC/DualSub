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

            <style>{`
                .words-lists-tab {
                    padding: var(--spacing-4);
                    min-width: 360px;
                    max-width: 920px;
                    margin: 0 auto;
                }

                .tab-title {
                    font-size: var(--font-size-2xl);
                    font-weight: 700;
                    color: var(--color-foreground-light);
                    margin: 0 0 var(--spacing-4) 0;
                }

                body.dark .tab-title {
                    color: var(--color-foreground-dark);
                }

                .controls-row {
                    display: flex;
                    gap: var(--spacing-2);
                    margin-bottom: var(--spacing-6);
                }

                .list-selector {
                    position: relative;
                    flex: 1;
                }

                .list-select {
                    width: 100%;
                    appearance: none;
                    background: var(--color-surface-light);
                    border: 1px solid var(--color-border-light);
                    border-radius: var(--radius-lg);
                    padding: var(--spacing-3) var(--spacing-4);
                    padding-right: 40px;
                    font-size: var(--font-size-base);
                    color: var(--color-foreground-light);
                    cursor: pointer;
                }

                body.dark .list-select {
                    background: var(--color-surface-dark);
                    border-color: var(--color-border-dark);
                    color: var(--color-foreground-dark);
                }

                .select-icon {
                    position: absolute;
                    right: var(--spacing-2);
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--color-subtle-light);
                    pointer-events: none;
                }

                body.dark .select-icon {
                    color: var(--color-subtle-dark);
                }

                .filter-button {
                    flex-shrink: 0;
                    background: var(--color-surface-light);
                    border: 1px solid var(--color-border-light);
                    border-radius: var(--radius-lg);
                    padding: var(--spacing-3);
                    color: var(--color-subtle-light);
                    transition: all var(--transition-base);
                }

                body.dark .filter-button {
                    background: var(--color-surface-dark);
                    border-color: var(--color-border-dark);
                    color: var(--color-subtle-dark);
                }

                .filter-button:hover {
                    background: rgba(19, 127, 236, 0.1);
                    color: var(--color-primary);
                }

                body.dark .filter-button:hover {
                    background: rgba(19, 127, 236, 0.2);
                }

                .filter-button .material-symbols-outlined {
                    font-size: 20px;
                }

                .feature-notice {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--spacing-3);
                    background: rgba(19, 127, 236, 0.1);
                    border: 1px solid var(--color-primary);
                    border-radius: var(--radius-lg);
                    padding: var(--spacing-4);
                    margin-bottom: var(--spacing-4);
                    color: var(--color-foreground-light);
                }

                body.dark .feature-notice {
                    color: var(--color-foreground-dark);
                }

                .notice-icon {
                    color: var(--color-primary);
                    flex-shrink: 0;
                    margin-top: 2px;
                }

                .feature-notice p {
                    margin: 0;
                    font-size: var(--font-size-sm);
                    line-height: 1.6;
                }

                .words-list {
                    display: flex;
                    flex-direction: column;
                    gap: var(--spacing-2);
                }

                .word-card {
                    display: flex;
                    align-items: center;
                    gap: var(--spacing-4);
                    background: var(--color-surface-light);
                    border-radius: var(--radius-lg);
                    padding: var(--spacing-3);
                    transition: all var(--transition-base);
                    cursor: pointer;
                }

                body.dark .word-card {
                    background: var(--color-surface-dark);
                }

                .word-card.starred {
                    background: rgba(19, 127, 236, 0.1);
                }

                body.dark .word-card.starred {
                    background: rgba(19, 127, 236, 0.2);
                }

                .word-card:hover {
                    background: var(--color-background-light);
                }

                body.dark .word-card:hover {
                    background: rgba(25, 38, 51, 0.8);
                }

                .word-content {
                    flex: 1;
                }

                .word-text {
                    font-weight: 600;
                    color: var(--color-foreground-light);
                    margin: 0 0 var(--spacing-1) 0;
                }

                body.dark .word-text {
                    color: var(--color-foreground-dark);
                }

                .word-translation {
                    font-size: var(--font-size-sm);
                    color: var(--color-subtle-light);
                    margin: 0;
                }

                body.dark .word-translation {
                    color: var(--color-subtle-dark);
                }

                .word-actions {
                    display: flex;
                    align-items: center;
                }

                .star-button {
                    padding: var(--spacing-2);
                    border-radius: var(--radius-full);
                    color: var(--color-subtle-light);
                    transition: all var(--transition-base);
                }

                body.dark .star-button {
                    color: var(--color-subtle-dark);
                }

                .star-button:hover {
                    background: rgba(19, 127, 236, 0.2);
                    color: var(--color-star);
                }

                body.dark .star-button:hover {
                    background: rgba(19, 127, 236, 0.3);
                }

                .star-button .material-symbols-outlined.filled {
                    color: var(--color-star);
                }
            `}</style>
        </>
    );
}
