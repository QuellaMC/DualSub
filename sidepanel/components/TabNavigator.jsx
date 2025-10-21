import React from 'react';

/**
 * Tab Navigator Component
 * 
 * Provides horizontal tab navigation matching UI_DESIGN specifications.
 * Supports sticky positioning with backdrop blur effect.
 */
export function TabNavigator({ activeTab, onTabChange, settings }) {
    const tabs = [
        {
            id: 'ai-analysis',
            label: 'AI Analysis',
            enabled: true,
        },
        {
            id: 'words-lists',
            label: 'Words Lists',
            enabled: settings.sidePanelWordsListsEnabled || false,
        },
    ];

    return (
        <>
            <div className="tab-navigator-container">
                <div className="tab-navigator-border">
                    <nav className="tab-navigator" aria-label="Tabs">
                        {tabs.map((tab) => (
                            <a
                                key={tab.id}
                                href={`#${tab.id}`}
                                className={`tab-link ${activeTab === tab.id ? 'active' : ''} ${!tab.enabled ? 'disabled' : ''}`}
                                aria-current={activeTab === tab.id ? 'page' : undefined}
                                onClick={(e) => {
                                    e.preventDefault();
                                    if (tab.enabled) {
                                        onTabChange(tab.id);
                                    }
                                }}
                                aria-disabled={!tab.enabled}
                            >
                                {tab.label}
                            </a>
                        ))}
                    </nav>
                </div>
            </div>

            <style>{`
                .tab-navigator-container {
                    position: sticky;
                    top: 0;
                    background: rgba(246, 247, 248, 0.8);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    z-index: var(--z-sticky);
                    min-width: 360px;
                    max-width: 920px;
                    margin: 0 auto;
                }

                body.dark .tab-navigator-container {
                    background: rgba(16, 25, 34, 0.8);
                }

                .tab-navigator-border {
                    border-bottom: 1px solid var(--color-border-light);
                }

                body.dark .tab-navigator-border {
                    border-bottom-color: var(--color-border-dark);
                }

                .tab-navigator {
                    display: flex;
                    padding: 0 var(--spacing-2);
                }

                .tab-link {
                    flex: 1;
                    text-align: center;
                    padding: var(--spacing-4) var(--spacing-1);
                    font-size: var(--font-size-sm);
                    font-weight: 600;
                    border-bottom: 2px solid transparent;
                    color: var(--color-subtle-light);
                    transition: all var(--transition-base);
                    cursor: pointer;
                    text-decoration: none;
                    white-space: nowrap;
                }

                body.dark .tab-link {
                    color: var(--color-subtle-dark);
                }

                .tab-link:hover:not(.disabled) {
                    border-bottom-color: var(--color-primary);
                    color: var(--color-primary);
                }

                .tab-link.active {
                    border-bottom-color: var(--color-primary);
                    color: var(--color-primary);
                }

                .tab-link.disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .tab-link:focus-visible {
                    outline: 2px solid var(--color-primary);
                    outline-offset: -2px;
                }
            `}</style>
        </>
    );
}
