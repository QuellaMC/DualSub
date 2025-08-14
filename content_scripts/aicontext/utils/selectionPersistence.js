/**
 * Selection Persistence Manager for AI Context Modal
 *
 * Handles preservation of word selections across subtitle refreshes and updates.
 * Monitors subtitle content changes and restores selection state when content is identical.
 *
 * @author DualSub Extension - AI Context Team
 * @version 2.0.0
 */

import { logWithFallback } from '../../core/utils.js';
import { UI_CONFIG } from '../core/constants.js';

/**
 * Selection Persistence Manager
 * Monitors subtitle updates and preserves word selections when content is identical
 */
export class SelectionPersistenceManager {
    constructor(modalCore) {
        this.modalCore = modalCore;
        this.isMonitoring = false;
        this.observers = new Map();
        this.lastObservedContent = new Map();

        // Debounce settings for content monitoring
        this.debounceDelay = 100;
        this.debounceTimers = new Map();

        this._log('debug', 'SelectionPersistenceManager initialized');
    }

    /**
     * Start monitoring subtitle containers for content changes
     */
    startMonitoring() {
        if (this.isMonitoring) {
            return;
        }

        // Only monitor while modal is visible to reduce overhead
        if (!this.modalCore?.isVisible) {
            this._log('debug', 'Skipping monitoring start; modal not visible');
            return;
        }

        this.isMonitoring = true;
        this._setupSubtitleObservers();
        this._setupSubtitleChangeListener();

        this._log('info', 'Selection persistence monitoring started');
    }

    /**
     * Stop monitoring subtitle containers
     */
    stopMonitoring() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        this._cleanupObservers();
        this._cleanupSubtitleChangeListener();

        this._log('info', 'Selection persistence monitoring stopped');
    }

    /**
     * Setup MutationObservers for subtitle containers
     * @private
     */
    _setupSubtitleObservers() {
        // Monitor original subtitle container
        this._observeSubtitleContainer('dualsub-original-subtitle', 'original');

        // Monitor translated subtitle container
        this._observeSubtitleContainer(
            'dualsub-translated-subtitle',
            'translated'
        );
    }

    /**
     * Setup listener for subtitle content change events
     * @private
     */
    _setupSubtitleChangeListener() {
        this.subtitleChangeHandler = (event) =>
            this._handleSubtitleContentChange(event);
        document.addEventListener(
            'dualsub-subtitle-content-changing',
            this.subtitleChangeHandler
        );
        this._log('debug', 'Subtitle content change listener setup');
    }

    /**
     * Cleanup subtitle content change listener
     * @private
     */
    _cleanupSubtitleChangeListener() {
        if (this.subtitleChangeHandler) {
            document.removeEventListener(
                'dualsub-subtitle-content-changing',
                this.subtitleChangeHandler
            );
            this.subtitleChangeHandler = null;
            this._log('debug', 'Subtitle content change listener removed');
        }
    }

    /**
     * Handle subtitle content change event
     * @param {CustomEvent} event - Subtitle content change event
     * @private
     */
    _handleSubtitleContentChange(event) {
        const { type, oldContent, newContent, element } = event.detail;

        // Only handle original subtitle changes for AI Context
        if (type !== 'original') {
            return;
        }

        // Skip if a visual restoration is pending to avoid re-queues
        if (this.modalCore?.selectionPersistence?.pendingRestore) {
            this._log('debug', 'Pending visual restoration; skipping content-change event');
            return;
        }

        // Skip entirely while analyzing to prevent flicker/log spam
        if (this.modalCore.isAnalyzing) {
            this._log('debug', 'Analyzing active; skipping subtitle change handling', { type });
            return;
        }

        try {
            const oldText = this._extractTextFromHTML(oldContent);
            const newText = this._extractTextFromHTML(newContent);

            this._log('debug', 'Subtitle content change detected', {
                type,
                oldLength: oldText.length,
                newLength: newText.length,
                hasSelection: this.modalCore.selectedWords.size > 0,
            });

            // If we have a selection and content is changing
            if (this.modalCore.selectedWords.size > 0) {
                // Gate by selection state age to avoid perpetual attempts
                const lastState = this.modalCore.selectionPersistence.lastSelectionState;
                const ageThreshold = UI_CONFIG?.MODAL?.SELECTION_STATE_AGE_THRESHOLD || 30000;
                const stateAge = lastState ? Date.now() - lastState.timestamp : Number.POSITIVE_INFINITY;
                const isRecent = stateAge < ageThreshold;

                // Check if this is the same content being refreshed
                if (isRecent && this.modalCore.isContentIdentical(newText)) {
                    this._log(
                        'info',
                        'Identical content detected via event, preparing restoration',
                        {
                            contentPreview: newText.substring(0, 50),
                        }
                    );

                    // Use debounced restoration to prevent race conditions
                    this._scheduleRestorationDebounced('event');
                } else {
                    // Content has actually changed, capture current state
                    this.modalCore.captureSelectionState(oldText);
                    this._log(
                        'debug',
                        'Content changed, captured old state for potential restoration'
                    );
                    // For old state, avoid restoration attempts
                    if (!isRecent) {
                        this._log('debug', 'Skipping restoration due to stale selection state', {
                            stateAge,
                            threshold: ageThreshold,
                        });
                    }
                }
            }
        } catch (error) {
            this._log('error', 'Error handling subtitle content change', {
                error: error.message,
                type,
            });
        }
    }

    /**
     * Extract text content from HTML string
     * @param {string} html - HTML content
     * @returns {string} Clean text content
     * @private
     */
    _extractTextFromHTML(html) {
        if (!html) return '';

        // Create temporary element to parse HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // Get text from interactive words if available
        const interactiveWords = tempDiv.querySelectorAll(
            '.dualsub-interactive-word'
        );
        if (interactiveWords.length > 0) {
            return Array.from(interactiveWords)
                .map(
                    (word) => word.getAttribute('data-word') || word.textContent
                )
                .join(' ')
                .trim();
        }

        // Fallback to text content
        return tempDiv.textContent?.trim() || '';
    }

    /**
     * Setup observer for a specific subtitle container
     * @param {string} containerId - Container element ID
     * @param {string} subtitleType - Type of subtitle (original/translated)
     * @private
     */
    _observeSubtitleContainer(containerId, subtitleType) {
        const container = document.getElementById(containerId);
        if (!container) {
            this._log('debug', `Subtitle container not found: ${containerId}`);
            return;
        }

        // Create mutation observer
        const observer = new MutationObserver((mutations) => {
            this._handleSubtitleMutation(mutations, subtitleType, container);
        });

        // Observe changes but restrict attribute observation to text signature only.
        // This avoids reacting to highlight class toggles on word spans.
        observer.observe(container, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['data-text-sig'],
        });

        this.observers.set(subtitleType, observer);
        this._log(
            'debug',
            `Observer setup for ${subtitleType} subtitle container`
        );
    }

    /**
     * Handle subtitle container mutations
     * @param {MutationRecord[]} mutations - Mutation records
     * @param {string} subtitleType - Type of subtitle
     * @param {HTMLElement} container - Container element
     * @private
     */
    _handleSubtitleMutation(mutations, subtitleType, container) {
        // Only monitor original subtitles for AI Context (as per requirements)
        if (subtitleType !== 'original') {
            return;
        }

        // Ignore while a visual restoration is pending to prevent loops
        if (this.modalCore?.selectionPersistence?.pendingRestore) {
            this._log('debug', 'Pending visual restoration; skipping mutation batch', { subtitleType });
            return;
        }

        // Debounce rapid mutations
        const timerId = this.debounceTimers.get(subtitleType);
        if (timerId) {
            clearTimeout(timerId);
        }

        this.debounceTimers.set(
            subtitleType,
            setTimeout(() => {
                this._processSubtitleChange(subtitleType, container);
            }, this.debounceDelay)
        );
    }

    /**
     * Process subtitle content change
     * @param {string} subtitleType - Type of subtitle
     * @param {HTMLElement} container - Container element
     * @private
     */
    _processSubtitleChange(subtitleType, container) {
        try {
            // Skip entirely if a visual restoration is pending (avoid triggering loops)
            if (this.modalCore?.selectionPersistence?.pendingRestore) {
                this._log('debug', 'Pending visual restoration; skipping mutation processing', { subtitleType });
                return;
            }

            // Skip entirely while analyzing to prevent flicker/log spam
            if (this.modalCore.isAnalyzing) {
                this._log('debug', 'Analyzing active; skipping mutation processing', { subtitleType });
                return;
            }

            const currentContent = this._extractTextContent(container);
            const lastContent = this.lastObservedContent.get(subtitleType);

            this._log('debug', 'Processing subtitle change', {
                subtitleType,
                currentLength: currentContent.length,
                lastLength: lastContent?.length || 0,
                hasSelection: this.modalCore.selectedWords.size > 0,
            });

            // If we have a selection and content is changing
            if (this.modalCore.selectedWords.size > 0) {
                // Gate by selection state age to avoid perpetual attempts
                const lastState = this.modalCore.selectionPersistence.lastSelectionState;
                const ageThreshold = UI_CONFIG?.MODAL?.SELECTION_STATE_AGE_THRESHOLD || 30000;
                const stateAge = lastState ? Date.now() - lastState.timestamp : Number.POSITIVE_INFINITY;
                const isRecent = stateAge < ageThreshold;

                // Check if this is the same content being refreshed
                if (
                    isRecent &&
                    lastContent &&
                    this.modalCore.isContentIdentical(currentContent)
                ) {
                    this._log(
                        'info',
                        'Identical content detected, attempting selection restoration',
                        {
                            subtitleType,
                            contentPreview: currentContent.substring(0, 50),
                        }
                    );

                    // Use debounced restoration to prevent race conditions
                    this._scheduleRestorationDebounced('mutation');
                } else {
                    // Content has actually changed, capture new state
                    this.modalCore.captureSelectionState(currentContent);
                    if (!isRecent) {
                        this._log('debug', 'Skipping restoration due to stale selection state', {
                            stateAge,
                            threshold: ageThreshold,
                        });
                    }
                }
            }

            // Update last observed content
            this.lastObservedContent.set(subtitleType, currentContent);
        } catch (error) {
            this._log('error', 'Error processing subtitle change', {
                error: error.message,
                subtitleType,
            });
        }
    }

    /**
     * Extract clean text content from subtitle container
     * @param {HTMLElement} container - Subtitle container
     * @returns {string} Clean text content
     * @private
     */
    _extractTextContent(container) {
        if (!container) {
            return '';
        }

        // Get text content from interactive words if available
        const interactiveWords = container.querySelectorAll(
            '.dualsub-interactive-word'
        );
        if (interactiveWords.length > 0) {
            return Array.from(interactiveWords)
                .map(
                    (word) => word.getAttribute('data-word') || word.textContent
                )
                .join(' ')
                .trim();
        }

        // Fallback to container text content
        return container.textContent?.trim() || '';
    }

    /**
     * Cleanup all observers
     * @private
     */
    _cleanupObservers() {
        for (const [type, observer] of this.observers) {
            observer.disconnect();
            this._log('debug', `Observer disconnected for ${type} subtitle`);
        }

        this.observers.clear();
        this.lastObservedContent.clear();

        // Clear debounce timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    /**
     * Force capture current subtitle state
     * Useful for manual state preservation
     */
    captureCurrentState() {
        const originalContainer = document.getElementById(
            'dualsub-original-subtitle'
        );
        if (originalContainer && this.modalCore.selectedWords.size > 0) {
            const content = this._extractTextContent(originalContainer);
            this.modalCore.captureSelectionState(content);
            this.lastObservedContent.set('original', content);

            this._log('info', 'Manual state capture completed', {
                contentLength: content.length,
                selectedWords: this.modalCore.selectedWords.size,
            });
        }
    }

    /**
     * Check if persistence is currently active
     * @returns {boolean} True if monitoring and has captured state
     */
    isActive() {
        return (
            this.isMonitoring &&
            this.modalCore.selectionPersistence.lastSelectionState !== null
        );
    }

    /**
     * Get current persistence status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            observersCount: this.observers.size,
            hasLastState:
                !!this.modalCore.selectionPersistence.lastSelectionState,
            lastContentLength:
                this.modalCore.selectionPersistence.lastSubtitleContent.length,
            selectedWordsCount: this.modalCore.selectedWords.size,
        };
    }

    /**
     * Schedule restoration with debouncing to prevent race conditions
     * @param {string} source - Source of the restoration request ('event' or 'mutation')
     * @private
     */
    _scheduleRestorationDebounced(source) {
        // Skip if restoration is already in progress
        if (this.modalCore.selectionPersistence.isRestoring) {
            this._log('debug', 'Restoration already in progress, skipping', {
                source,
            });
            return;
        }

        // Skip any restoration attempts while analyzing
        if (this.modalCore.isAnalyzing) {
            this._log('debug', 'Analyzing active; skipping restoration scheduling', { source });
            return;
        }

        // If a restoration is already scheduled, keep it (avoid perpetual rescheduling during rapid mutations)
        if (this.modalCore.selectionPersistence.restorationTimeout) {
            this._log('debug', 'Restoration already scheduled, skipping re-schedule', {
                source,
            });
            return;
        }

        // Suppress restoration if a manual selection happened very recently to avoid overriding user intent
        try {
            const lastManual = this.modalCore.selectionPersistence.lastManualSelectionTs || 0;
            if (Date.now() - lastManual < 500) {
                this._log('debug', 'Skipping restoration due to recent manual selection', {
                    deltaMs: Date.now() - lastManual,
                    source,
                });
                return;
            }
        } catch (_) {}

        // Cooldown between restorations to avoid log spam/loops
        try {
            const lastRestoreAt = this.modalCore.selectionPersistence.lastRestoreAt || 0;
            if (Date.now() - lastRestoreAt < 400) {
                this._log('debug', 'Skipping restoration due to cooldown', {
                    deltaMs: Date.now() - lastRestoreAt,
                    source,
                });
                return;
            }
        } catch (_) {}

        // Schedule new restoration with appropriate delay
        const delay = source === 'event' ? 150 : 200; // Slightly longer for mutation observer
        this.modalCore.selectionPersistence.restorationTimeout = setTimeout(
            () => {
                this._log('debug', 'Executing debounced restoration', {
                    source,
                    delay,
                });

                // Clear the timeout reference before calling restoration
                this.modalCore.selectionPersistence.restorationTimeout = null;

                // Re-check recent manual selection before actually restoring
                try {
                    const lastManual = this.modalCore.selectionPersistence.lastManualSelectionTs || 0;
                    if (Date.now() - lastManual < 750) {
                        this._log('debug', 'Aborting restoration due to recent manual selection', {
                            deltaMs: Date.now() - lastManual,
                            source,
                        });
                        return;
                    }
                } catch (_) {}

                // If current selected words differ from saved state, prefer current and skip restoration
                try {
                    const saved = this.modalCore.selectionPersistence.lastSelectionState;
                    const savedWords = Array.isArray(saved?.selectedWords) ? saved.selectedWords.slice().sort().join('|') : '';
                    const currentWords = Array.from(this.modalCore.selectedWords).sort().join('|');
                    if (savedWords && savedWords !== currentWords) {
                        // Update saved state to current to avoid reverting user changes
                        const container = document.getElementById('dualsub-original-subtitle');
                        const currentContent = this._extractTextContent(container);
                        this.modalCore.captureSelectionState(currentContent);
                        this._log('debug', 'Saved selection updated to current; skipping restoration', {
                            savedWords,
                            currentWords,
                        });
                        return;
                    }
                } catch (_) {}

                // Avoid unbounded attempts per subtitle signature
                try {
                    const container = document.getElementById('dualsub-original-subtitle');
                    const sig = container?.dataset?.textSig || 'unknown';
                    this._restoreCounts = this._restoreCounts || new Map();
                    const count = this._restoreCounts.get(sig) || 0;
                    if (count > 4) {
                        this._log('warn', 'Max restoration attempts reached for signature', { sig, count });
                        return;
                    }
                    this._restoreCounts.set(sig, count + 1);
                } catch (_) {}

                const success = this.modalCore.restoreSelectionState();
                // Mark restore time for cooldown
                try { this.modalCore.selectionPersistence.lastRestoreAt = Date.now(); } catch (_) {}
                this._log(
                    success ? 'info' : 'warn',
                    'Debounced restoration completed',
                    {
                        source,
                        success,
                        selectedWordsCount: this.modalCore.selectedWords.size,
                    }
                );
            },
            delay
        );

        this._log('debug', 'Scheduled debounced restoration', {
            source,
            delay,
        });
    }

    /**
     * Log with fallback
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} data - Additional data
     * @private
     */
    _log(level, message, data = {}) {
        logWithFallback(level, `[SelectionPersistence] ${message}`, {
            ...data,
            component: 'SelectionPersistenceManager',
        });
    }
}

/**
 * Create and initialize selection persistence manager
 * @param {Object} modalCore - Modal core instance
 * @returns {SelectionPersistenceManager} Initialized manager
 */
export function createSelectionPersistenceManager(modalCore) {
    return new SelectionPersistenceManager(modalCore);
}
