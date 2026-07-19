/**
 * AI Context Modal - Core Module
 *
 * Core modal class and state management functionality.
 * Handles modal lifecycle, state transitions, and configuration.
 *
 * @author DualSub Extension - UI Systems Engineer
 * @version 2.0.0
 */

import { MODAL_STATES, EVENT_TYPES, UI_CONFIG } from '../core/constants.js';
import { createSelectionPersistenceManager } from '../utils/selectionPersistence.js';
import { SelectionModel } from '../core/state/SelectionModel.js';
import { ModalStore } from '../core/state/ModalStore.js';
import Logger from '../../../utils/logger.js';

const PRIVATE_SELECTION_REASONS = Object.freeze([
    'toggle',
    'add',
    'remove',
    'clear',
    'restore',
    'subtitle-change',
]);

function hasExactEnumerableDataKeys(value, expectedKeys) {
    try {
        if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
        ) {
            return false;
        }
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== expectedKeys.length) return false;
        return ownKeys.every((key) => {
            if (typeof key !== 'string' || !expectedKeys.includes(key)) {
                return false;
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return (
                descriptor?.enumerable === true &&
                Object.hasOwn(descriptor, 'value')
            );
        });
    } catch (_) {
        return false;
    }
}

function createPrivateSelectionSnapshot(snapshot) {
    try {
        if (
            !hasExactEnumerableDataKeys(snapshot, [
                'selectionRevision',
                'renderRevision',
                'reason',
                'entries',
            ])
        ) {
            return null;
        }

        const descriptors = Object.fromEntries(
            ['selectionRevision', 'renderRevision', 'reason', 'entries'].map(
                (key) => [key, Object.getOwnPropertyDescriptor(snapshot, key)]
            )
        );
        const selectionRevision = descriptors.selectionRevision.value;
        const renderRevision = descriptors.renderRevision.value;
        const reason = descriptors.reason.value;
        const entries = descriptors.entries.value;
        if (
            !Number.isSafeInteger(selectionRevision) ||
            selectionRevision <= 0 ||
            !Number.isSafeInteger(renderRevision) ||
            renderRevision <= 0 ||
            !PRIVATE_SELECTION_REASONS.includes(reason) ||
            !Array.isArray(entries) ||
            entries.length > 64 ||
            Reflect.ownKeys(entries).length !== entries.length + 1
        ) {
            return null;
        }

        if (
            (['clear', 'subtitle-change'].includes(reason) &&
                entries.length !== 0) ||
            (['add', 'restore'].includes(reason) && entries.length === 0)
        ) {
            return null;
        }

        const canonicalEntries = [];
        let previousWordIndex = -1;
        let joinedLength = 0;
        for (let index = 0; index < entries.length; index += 1) {
            const entryDescriptor = Object.getOwnPropertyDescriptor(
                entries,
                String(index)
            );
            const entry = entryDescriptor?.value;
            if (
                entryDescriptor?.enumerable !== true ||
                !hasExactEnumerableDataKeys(entry, ['wordIndex', 'word'])
            ) {
                return null;
            }
            const wordIndex = Object.getOwnPropertyDescriptor(
                entry,
                'wordIndex'
            ).value;
            const word = Object.getOwnPropertyDescriptor(entry, 'word').value;
            if (
                !Number.isSafeInteger(wordIndex) ||
                wordIndex < 0 ||
                wordIndex <= previousWordIndex ||
                typeof word !== 'string' ||
                word.length === 0 ||
                word.length > 256
            ) {
                return null;
            }
            joinedLength +=
                (canonicalEntries.length === 0 ? 0 : 1) + word.length;
            if (joinedLength > 500) return null;
            canonicalEntries.push(Object.freeze({ wordIndex, word }));
            previousWordIndex = wordIndex;
        }

        return Object.freeze({
            selectionRevision,
            renderRevision,
            reason,
            entries: Object.freeze(canonicalEntries),
        });
    } catch (_) {
        return null;
    }
}

/**
 * Core modal state management and lifecycle
 */
export class AIContextModalCore {
    constructor(config = {}) {
        this.config = {
            ...UI_CONFIG.MODAL,
            animationDuration: 300,
            maxHeight: '75vh',
            maxWidth: 'min(95vw, 1000px)',
            Z_INDEX: 9998,
            ...config,
        };
        Object.defineProperty(this.config, 'privateAnalysis', {
            value: config.privateAnalysis === true,
            enumerable: true,
            configurable: false,
            writable: false,
        });

        // Core state
        this.element = null; // Main modal element (container only)
        this.overlayElement = null; // Modal overlay element (in UI root container)
        this.contentElement = null; // Modal content element (in UI root container)
        this.isVisible = false;
        this.state = MODAL_STATES.HIDDEN;
        this.currentMode = null;

        // Content script reference for config access
        this.contentScript = config.contentScript || null;

        // Selection state (legacy compatibility) - now driven by SelectionModel
        this.selectionModel = new SelectionModel();
        this.selectedWords = new Set();
        this.selectedWordPositions = new Map(); // Map word+position to unique identifier (Issue #4)
        this.selectedWordsOrder = []; // Preserve order of word selection for phrase analysis
        this.originalSentenceWords = []; // Track original sentence word order for position-based sorting
        this.wordPositions = new Map(); // Map word to its original position in sentence
        this.selectedText = '';

        // Analysis state
        this.analysisResult = null;
        this.isAnalyzing = false;
        this.currentRequest = null; // EXACT legacy property for request tracking

        // Retry state for invalid analysis responses
        this.retryState = {
            isRetrying: false,
            currentAttempt: 0,
            maxRetries: 3,
            lastError: null,
            originalRequestData: null,
        };

        // Selection persistence for subtitle refreshes
        this.selectionPersistence = {
            lastSubtitleContent: '',
            lastSelectionState: null,
            isRestoring: false,
            pendingRestore: false,
            restorationTimeout: null,
        };

        // Event handling
        this.eventHandlers = new Map();
        this.eventListeners = new Map();

        // Logger reference (replaced by the parent when available)
        this.logger = Logger.create('AIContextModalCore');

        // Selection persistence manager
        this.selectionPersistenceManager = null;
        this._destroyed = false;
        this._ownedRestoreTimers = new Set();
        this._ownedRestoreAnimationFrames = new Set();

        // Readiness gating for SPA navigation
        this.uiReady = false;
        this.eventsReady = false;
        this._readyResolve = null;
        this.onceReady = new Promise(
            (resolve) => (this._readyResolve = resolve)
        );

        // ModalStore for observable UI state
        this.store = new ModalStore({
            isVisible: this.isVisible,
            modalState: this.state,
            mode: this.currentMode,
            analyzing: this.isAnalyzing,
            requestId: this.currentRequest,
            analysisResult: this.analysisResult,
        });
    }

    /**
     * Initialize the modal core
     * @returns {Promise<void>}
     */
    async initialize() {
        this._log('info', 'Initializing modal core');

        // Initialize selection persistence manager
        this.selectionPersistenceManager =
            createSelectionPersistenceManager(this);

        // Setup page visibility handling for selection state
        this._setupPageVisibilityHandling();

        // Core is ready - UI and events will be initialized by other modules
        this._log('debug', 'Modal core initialized successfully');

        // Do not resolve readiness here; UI module will resolve when DOM + listeners are attached
    }

    /**
     * Set the logger instance
     * @param {Object} logger - Logger instance
     */
    setLogger(logger) {
        this.logger = logger;
    }

    /**
     * Mark UI ready and resolve onceReady gating promise
     */
    markUiReady() {
        if (this._destroyed) return false;
        if (!this.uiReady) {
            this.uiReady = true;
            if (this.eventsReady) this._settleReady();
        }
        return true;
    }

    /**
     * Mark events ready and resolve onceReady gating promise
     */
    markEventsReady() {
        if (this._destroyed) return false;
        if (!this.eventsReady) {
            this.eventsReady = true;
            if (this.uiReady) this._settleReady();
        }
        return true;
    }

    _settleReady() {
        const resolveReady = this._readyResolve;
        this._readyResolve = null;
        if (typeof resolveReady !== 'function') return false;
        resolveReady();
        return true;
    }

    /**
     * Get current modal state
     * @returns {Object} Current state information
     */
    getState() {
        return {
            isVisible: this.isVisible,
            state: this.state,
            currentMode: this.currentMode,
            selectedWords: Array.from(this.selectedWords),
            selectedWordsOrder: [...this.selectedWordsOrder],
            selectedText: this.selectedText,
            isAnalyzing: this.isAnalyzing,
            hasAnalysisResult: !!this.analysisResult,
        };
    }

    /**
     * Set modal state
     * @param {string} newState - New state from MODAL_STATES
     */
    setState(newState) {
        const oldState = this.state;
        this.state = newState;

        this._log('debug', 'Modal state changed', {
            from: oldState,
            to: newState,
            mode: this.currentMode,
        });

        this._dispatchEvent(EVENT_TYPES.MODAL_STATE_CHANGE, {
            oldState,
            newState,
            mode: this.currentMode,
            data: { requestId: this.currentRequest },
        });

        // Centralized render path (applies state classes only)
        this._renderState();

        // Reflect into store
        this.store.setState(this.state);

        // Phase 3: Keep selection highlights in sync on key state transitions
        if (
            newState === MODAL_STATES.SELECTION ||
            newState === MODAL_STATES.PROCESSING
        ) {
            try {
                this.syncSelectionHighlights();
            } catch (_) {}
            // When entering processing, enforce current highlights to be visible immediately
            if (newState === MODAL_STATES.PROCESSING) {
                try {
                    this.syncSelectionHighlights();
                } catch (_) {}
            }
        }
    }

    /**
     * Apply state-driven CSS classes to the live modal content. Single render path.
     * @private
     */
    _renderState() {
        try {
            const content =
                this.contentElement ||
                document.getElementById('dualsub-modal-content');
            if (!content) return;

            content.classList.remove(
                'is-hidden',
                'is-selection',
                'is-analyzing',
                'is-display',
                'is-error'
            );

            switch (this.state) {
                case MODAL_STATES.HIDDEN:
                    content.classList.add('is-hidden');
                    break;
                case MODAL_STATES.SELECTION:
                    content.classList.add('is-selection');
                    break;
                case MODAL_STATES.PROCESSING:
                    content.classList.add('is-analyzing');
                    break;
                case MODAL_STATES.DISPLAY:
                    content.classList.add('is-display');
                    break;
                case MODAL_STATES.ERROR:
                    content.classList.add('is-error');
                    break;
            }
        } catch (error) {
            this._log('warn', 'Failed to render modal state', {
                errorName: error?.name,
                errorLength: error?.message?.length || 0,
                state: this.state,
            });
        }
    }

    /**
     * Reset modal state to initial values
     */
    resetState() {
        this._log('debug', 'Resetting modal state');

        this.selectionModel.clear();
        this._syncSelectionSnapshotFromModel();
        this.analysisResult = null;
        this.isAnalyzing = false;
        this.currentMode = null;
        this.setState(MODAL_STATES.HIDDEN);
    }

    /**
     * Add word to selection (Issue #1: Fixed position-based selection)
     * @param {string} word - Word to add
     * @param {Object} position - Word position information
     */
    addWordToSelection(word, position = {}) {
        const positionKey = this._createPositionKey(word, position);
        const added = this.selectionModel.add(word, position, positionKey);
        if (!added) return;

        this._syncSelectionSnapshotFromModel();
        this._captureSelectionStateIfNeeded();

        this._dispatchEvent(EVENT_TYPES.WORD_ADDED, {
            word,
            position,
            positionKey,
            selectedWords: Array.from(this.selectedWords),
            selectedText: this.selectedText,
        });

        // Phase 3: Centralized highlight sync
        try {
            this.syncSelectionHighlights();
        } catch (_) {}
    }

    /**
     * Remove word from selection (Issue #1: Fixed position-based selection)
     * @param {string} word - Word to remove
     * @param {Object} position - Word position information (optional)
     */
    removeWordFromSelection(word, position = null) {
        let removed = false;
        if (position) {
            const positionKey = this._createPositionKey(word, position);
            removed = this.selectionModel.remove(word, position, positionKey);
            if (!removed) {
                this._log('debug', 'Word position not found for removal', {
                    wordLength: word.length,
                    hasPositionKey: Boolean(positionKey),
                    availablePositionCount:
                        this.selectionModel.getPositionsMap().size,
                });
            }
        } else {
            removed = this.selectionModel.remove(word);
        }

        if (removed) {
            this._syncSelectionSnapshotFromModel();
            this._captureSelectionStateIfNeeded();

            this._dispatchEvent(EVENT_TYPES.WORD_REMOVED, {
                word,
                position,
                selectedWords: Array.from(this.selectedWords),
                selectedText: this.selectedText,
            });

            // Phase 3: Centralized highlight sync
            try {
                this.syncSelectionHighlights();
            } catch (_) {}
        }
    }

    /**
     * Toggle word selection (Issue #4: Position-based selection)
     * @param {string} word - Word to toggle
     * @param {Object} position - Word position information
     */
    toggleWordSelection(word, position = {}) {
        const positionKey = this._createPositionKey(word, position);
        const result = this.selectionModel.toggle(word, position, positionKey);
        if (result === 'noop') return;
        this._syncSelectionSnapshotFromModel();
        // Capture state only when added
        if (result === 'added') this._captureSelectionStateIfNeeded();

        // Phase 3: Centralized highlight sync
        try {
            this.syncSelectionHighlights();
        } catch (_) {}
    }

    /**
     * Clear all selected words (Issue #4: Position-based selection)
     */
    clearSelection() {
        const hadSelection = this.selectedWords.size > 0;

        this.selectionModel.clear();
        this._syncSelectionSnapshotFromModel();

        // Clear selection persistence state
        this._clearSelectionPersistence();

        if (hadSelection) {
            this._log('debug', 'Selection cleared');
            this._dispatchEvent(EVENT_TYPES.SELECTION_CLEARED, {});
        }
    }

    /**
     * Replace private-mode visual selection with canonical occurrence entries.
     * No public selection event is emitted from this path.
     *
     * @param {Object} snapshot - Canonical selection snapshot payload
     * @returns {boolean} Whether the snapshot was accepted
     */
    applyPrivateSelectionSnapshot(snapshot) {
        if (this.config.privateAnalysis !== true) return false;
        const canonical = createPrivateSelectionSnapshot(snapshot);
        if (!canonical) return false;

        this.selectionModel.clear();
        for (const entry of canonical.entries) {
            const position = Object.freeze({
                wordIndex: entry.wordIndex,
                index: entry.wordIndex,
                subtitleType: 'original',
            });
            this.selectionModel.add(
                entry.word,
                position,
                `private-selection:${entry.wordIndex}`
            );
        }
        this._syncSelectionSnapshotFromModel();
        this._clearSelectionPersistence();
        this.privateSelectionRevision = canonical.selectionRevision;
        this.privateRenderRevision = canonical.renderRevision;
        return true;
    }

    /**
     * Clear selection persistence state
     * @private
     */
    _clearSelectionPersistence() {
        this.selectionPersistence.lastSubtitleContent = '';
        this.selectionPersistence.lastSelectionState = null;
        this.selectionPersistence.isRestoring = false;
        this.selectionPersistence.pendingRestore = false;

        // Clear any pending restoration timeout
        if (this.selectionPersistence.restorationTimeout) {
            const timeout = this.selectionPersistence.restorationTimeout;
            clearTimeout(timeout);
            this._ownedRestoreTimers.delete(timeout);
            this.selectionPersistence.restorationTimeout = null;
        }
    }

    _scheduleOwnedRestoreTimeout(callback, delay) {
        if (this._destroyed) return null;
        let timeout = null;
        timeout = setTimeout(() => {
            this._ownedRestoreTimers.delete(timeout);
            if (this._destroyed) return;
            callback();
        }, delay);
        this._ownedRestoreTimers.add(timeout);
        return timeout;
    }

    /**
     * Capture selection state if needed for persistence
     * @private
     */
    _captureSelectionStateIfNeeded() {
        if (this.config.privateAnalysis === true) return;
        if (this.selectedWords.size > 0 && this.selectionPersistenceManager) {
            // Get current subtitle content
            const originalContainer = document.getElementById(
                'dualsub-original-subtitle'
            );
            if (originalContainer) {
                const content = this._extractSubtitleContent(originalContainer);
                this.captureSelectionState(content);
            }
        }
    }

    /**
     * Extract clean text content from subtitle container
     * @param {HTMLElement} container - Subtitle container
     * @returns {string} Clean text content
     * @private
     */
    _extractSubtitleContent(container) {
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
     * Set analysis result
     * @param {Object} result - Analysis result data
     */
    setAnalysisResult(result) {
        this.analysisResult = result;
        this.isAnalyzing = false;

        this._log('debug', 'Analysis result set', {
            hasResult: !!result,
            resultType: result?.type || 'unknown',
        });

        this._dispatchEvent(EVENT_TYPES.ANALYSIS_COMPLETE, {
            result,
            selectedWords: Array.from(this.selectedWords),
        });

        this.store.set({ analysisResult: result, analyzing: false });
    }

    /**
     * Commit a result leased through the private analysis capability. Unlike
     * the legacy setter, this never publishes the raw result on document.
     *
     * @param {Object} result - Validated analysis result
     * @returns {boolean} Whether private mode accepted the result
     */
    setPrivateAnalysisResult(result) {
        if (this.config.privateAnalysis !== true) return false;
        this.analysisResult = result;
        this.isAnalyzing = false;
        this.store.set({ analysisResult: result, analyzing: false });
        return true;
    }

    /**
     * Set analysis state
     * @param {boolean} analyzing - Whether analysis is in progress
     */
    setAnalyzing(analyzing) {
        this.isAnalyzing = analyzing;

        // Remove any duplicate selections before starting analysis
        if (analyzing) {
            this._removeDuplicateSelections();
            // Reset retry state when starting new analysis
            this._resetRetryState();
            // Ensure visual highlights stay locked-in during processing
            try {
                this.syncSelectionHighlights();
            } catch (_) {}
        }
        this.store.setAnalyzing(analyzing);
    }

    /**
     * Create unique position key for word+position combination
     * @param {string} word - Word text
     * @param {Object} position - Position information
     * @returns {string} Unique position key
     * @private
     */
    _createPositionKey(word, position = {}) {
        // Fast path: prefer stable index + type when available to avoid costly DOM path generation
        const idx =
            (position.wordIndex !== undefined
                ? position.wordIndex
                : position.index) || 0;
        const subtitleType = position.subtitleType || '';
        if (subtitleType) {
            return `${word}:${subtitleType}:${idx}`;
        }

        // Secondary path: derive from element dataset when present
        const el = position.element;
        try {
            if (el) {
                const dataIdx = el.getAttribute('data-word-index');
                const dataType =
                    el.getAttribute('data-subtitle-type') ||
                    subtitleType ||
                    'original';
                if (dataIdx !== null) {
                    return `${word}:${dataType}:${Number(dataIdx) || 0}`;
                }
            }
        } catch (_) {}

        // Fallback: build a DOM path-based key (legacy compatibility)
        const elementId = position.elementId || el?.id || '';
        const parentId = el?.parentElement?.id || '';
        if (el) {
            const elementPath = this._getElementPath(el);
            return `${word}:${elementPath}:${subtitleType}:${idx}`;
        }
        return `${word}:${elementId}:${parentId}:${idx}:${subtitleType}`;
    }

    /**
     * Get unique DOM path for an element (Issue #1: Position-based selection)
     * @param {HTMLElement} element - Element to get path for
     * @returns {string} Unique DOM path
     * @private
     */
    _getElementPath(element) {
        if (!element) return '';

        const path = [];
        let current = element;

        while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
                selector += `#${current.id}`;
                path.unshift(selector);
                break; // ID is unique, no need to go further
            }

            if (current.className) {
                selector += `.${current.className.split(' ').join('.')}`;
            }

            // Add nth-child for uniqueness
            const siblings = Array.from(current.parentElement?.children || []);
            const index = siblings.indexOf(current);
            if (index >= 0) {
                selector += `:nth-child(${index + 1})`;
            }

            path.unshift(selector);
            current = current.parentElement;
        }

        return path.join(' > ');
    }

    /**
     * Remove duplicate word selections
     * @private
     */
    _removeDuplicateSelections() {
        const removed = this.selectionModel.removeDuplicatesPreferOriginal();
        if (removed > 0) this._syncSelectionSnapshotFromModel();
        return removed;
    }

    /**
     * Reset retry state
     * @private
     */
    _resetRetryState() {
        this.retryState = {
            isRetrying: false,
            currentAttempt: 0,
            maxRetries: 3,
            lastError: null,
            originalRequestData: null,
        };
    }

    /**
     * Check if retry is possible for invalid analysis responses
     * @returns {boolean} True if retry is possible
     */
    canRetryAnalysis() {
        return this.retryState.currentAttempt < this.retryState.maxRetries;
    }

    /**
     * Prepare for analysis retry
     * @param {Object} originalRequestData - Original analysis request data
     * @param {string} error - Error that triggered the retry
     */
    prepareRetry(originalRequestData, error) {
        this.retryState.isRetrying = true;
        this.retryState.currentAttempt++;
        this.retryState.lastError = error;
        this.retryState.originalRequestData = originalRequestData;

        this._log('info', 'Preparing analysis retry', {
            attempt: this.retryState.currentAttempt,
            maxRetries: this.retryState.maxRetries,
            error: error,
        });
    }

    /**
     * Capture current selection state for persistence across subtitle refreshes
     * @param {string} subtitleContent - Current subtitle content
     */
    captureSelectionState(subtitleContent) {
        if (this.config.privateAnalysis === true) return false;
        if (!subtitleContent || this.selectedWords.size === 0) {
            return false;
        }

        const selectionState = {
            selectedWords: Array.from(this.selectedWords),
            selectedWordPositions: new Map(this.selectedWordPositions),
            selectedWordsOrder: [...this.selectedWordsOrder],
            selectedText: this.selectedText,
            timestamp: Date.now(),
            // Phase 4: capture current content signature for gating
            signature: (() => {
                try {
                    const container = document.getElementById(
                        'dualsub-original-subtitle'
                    );
                    return container?.dataset?.textSig || '';
                } catch (_) {
                    return '';
                }
            })(),
        };

        this.selectionPersistence.lastSubtitleContent = subtitleContent;
        this.selectionPersistence.lastSelectionState = selectionState;

        this._log('debug', 'Selection state captured for persistence', {
            subtitleContentLength: subtitleContent.length,
            selectedWordsCount: this.selectedWords.size,
            selectedTextLength: this.selectedText.length,
        });
        return true;
    }

    /**
     * Check if subtitle content is identical to previous content
     * @param {string} newContent - New subtitle content
     * @returns {boolean} True if content is identical
     */
    isContentIdentical(newContent) {
        if (!newContent || !this.selectionPersistence.lastSubtitleContent) {
            return false;
        }

        // Normalize content for comparison (remove extra whitespace, HTML entities)
        const normalizeContent = (content) => {
            return content
                .replace(/\s+/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();
        };

        const normalizedNew = normalizeContent(newContent);
        const normalizedLast = normalizeContent(
            this.selectionPersistence.lastSubtitleContent
        );

        return normalizedNew === normalizedLast;
    }

    /**
     * Restore selection state when subtitle content is identical
     * @returns {boolean} True if restoration was attempted
     */
    restoreSelectionState() {
        if (this.config.privateAnalysis === true) return false;
        if (
            !this.selectionPersistence.lastSelectionState ||
            this.selectionPersistence.isRestoring
        ) {
            return false;
        }

        const state = this.selectionPersistence.lastSelectionState;

        // Check if state is recent (configurable threshold for page visibility changes)
        const ageThreshold = UI_CONFIG.MODAL.SELECTION_STATE_AGE_THRESHOLD;
        const stateAge = Date.now() - state.timestamp;
        const isRecent = stateAge < ageThreshold;

        if (!isRecent) {
            this._log(
                'debug',
                'Selection state too old, skipping restoration',
                {
                    stateAge,
                    threshold: ageThreshold,
                    stateAgeSeconds: Math.round(stateAge / 1000),
                    thresholdSeconds: Math.round(ageThreshold / 1000),
                    selectedWordsCount: this.selectedWords.size,
                    hasSelectionState: !!state,
                }
            );
            return false; // Do not schedule further attempts here; upstream gating prevents spam
        }

        // Phase 4: Verify content signature matches before restoring
        try {
            const container = document.getElementById(
                'dualsub-original-subtitle'
            );
            const currentSig = container?.dataset?.textSig || '';
            const capturedSig = state.signature || '';
            if (capturedSig && currentSig && capturedSig !== currentSig) {
                // Re-schedule a single attempt slightly later to coalesce bursts
                if (!this.selectionPersistence.restorationTimeout) {
                    this.selectionPersistence.restorationTimeout =
                        this._scheduleOwnedRestoreTimeout(() => {
                            this.selectionPersistence.restorationTimeout = null;
                            try {
                                this.restoreSelectionState();
                            } catch (_) {}
                        }, 100);
                }
                return false;
            }
        } catch (_) {}

        this.selectionPersistence.isRestoring = true;

        try {
            // Restore selection state into SelectionModel
            this.selectionModel.clear();
            // state.selectedWordPositions was saved as a Map
            const positionsMap = new Map(state.selectedWordPositions);
            for (const [key, entry] of positionsMap.entries()) {
                this.selectionModel.add(entry.word, entry.position, key);
            }
            // Maintain order when available
            this.selectionModel.positionKeyOrder = [
                ...state.selectedWordsOrder,
            ];
            this.selectionModel.updateSelectedText();
            // Sync legacy snapshot
            this._syncSelectionSnapshotFromModel();

            this._log(
                'info',
                'Selection state restored after subtitle refresh',
                {
                    restoredWordsCount: this.selectedWords.size,
                    restoredTextLength: this.selectedText.length,
                }
            );

            // Schedule visual restoration after DOM is ready
            this.selectionPersistence.pendingRestore = true;
            // Use requestAnimationFrame to ensure DOM is fully updated after style changes
            const scheduleVisualRestore = () => {
                if (this._destroyed) return;
                try {
                    this._restoreVisualHighlighting();
                } catch (_) {}
            };
            if (typeof requestAnimationFrame === 'function') {
                let animationFrame = null;
                animationFrame = requestAnimationFrame(() => {
                    this._ownedRestoreAnimationFrames.delete(animationFrame);
                    if (this._destroyed) return;
                    this._scheduleOwnedRestoreTimeout(scheduleVisualRestore, 0);
                });
                this._ownedRestoreAnimationFrames.add(animationFrame);
            } else {
                this._scheduleOwnedRestoreTimeout(scheduleVisualRestore, 50);
            }

            const onSelectionRestored = this.config.onSelectionRestored;
            if (typeof onSelectionRestored === 'function') {
                try {
                    onSelectionRestored();
                } catch (error) {
                    this._log(
                        'error',
                        'Selection restoration notification failed',
                        {
                            errorName: error?.name,
                            errorLength: error?.message?.length || 0,
                        }
                    );
                }
            }

            return true;
        } catch (error) {
            this._log('error', 'Failed to restore selection state', {
                error: error.message,
                state,
            });
            return false;
        } finally {
            this.selectionPersistence.isRestoring = false;
            // Note: restorationTimeout is cleared by the debounced function before calling this method
        }
    }

    /**
     * Restore visual highlighting for selected words
     * @private
     */
    _restoreVisualHighlighting() {
        if (!this.selectionPersistence.pendingRestore) {
            return;
        }

        try {
            // Find all interactive words in the current subtitle
            const interactiveWords = document.querySelectorAll(
                '.dualsub-interactive-word'
            );
            let restoredCount = 0;

            // Create a map of current words by position for efficient lookup
            const currentWordsByPosition = new Map();
            interactiveWords.forEach((wordElement, index) => {
                const word = wordElement.getAttribute('data-word');
                const subtitleType =
                    this._getSubtitleTypeFromElement(wordElement);
                const positionKey = `${word}:${subtitleType}:${index}`;
                currentWordsByPosition.set(positionKey, wordElement);
            });

            // Try to restore selections using flexible matching
            for (const word of this.selectedWords) {
                // First, try to find exact position matches from stored positions
                let restored = false;

                for (const [storedPositionKey] of this.selectedWordPositions) {
                    if (storedPositionKey.startsWith(`${word}:`)) {
                        // Extract stored position info
                        const parts = storedPositionKey.split(':');
                        if (parts.length >= 3) {
                            const storedSubtitleType =
                                parts[parts.length - 2] || 'original';

                            // Try to find matching word in current DOM
                            interactiveWords.forEach(
                                (wordElement, currentIndex) => {
                                    const currentWord =
                                        wordElement.getAttribute('data-word');
                                    const currentSubtitleType =
                                        this._getSubtitleTypeFromElement(
                                            wordElement
                                        );

                                    if (
                                        currentWord === word &&
                                        currentSubtitleType ===
                                            storedSubtitleType &&
                                        !wordElement.classList.contains(
                                            'dualsub-word-selected'
                                        )
                                    ) {
                                        wordElement.classList.add(
                                            'dualsub-word-selected'
                                        );
                                        restoredCount++;
                                        restored = true;

                                        // Update position key for current DOM structure
                                        const newPosition = {
                                            elementId: wordElement.id,
                                            element: wordElement,
                                            subtitleType: currentSubtitleType,
                                            wordIndex: currentIndex,
                                        };
                                        const newPositionKey =
                                            this._createPositionKey(
                                                word,
                                                newPosition
                                            );

                                        // Update model with the new position key
                                        this.selectionModel.replacePositionKey(
                                            storedPositionKey,
                                            newPositionKey,
                                            word,
                                            newPosition
                                        );

                                        const orderIndex =
                                            this.selectedWordsOrder.indexOf(
                                                storedPositionKey
                                            );
                                        this._log(
                                            'debug',
                                            'Word position updated during restoration',
                                            {
                                                wordLength: word.length,
                                                hadOldKey:
                                                    Boolean(storedPositionKey),
                                                hasNewKey:
                                                    Boolean(newPositionKey),
                                                orderUpdated: orderIndex !== -1,
                                            }
                                        );
                                    }
                                }
                            );
                        }

                        if (restored) break;
                    }
                }

                // If exact position matching failed, try simple word matching
                if (!restored) {
                    interactiveWords.forEach((wordElement) => {
                        const currentWord =
                            wordElement.getAttribute('data-word');
                        if (
                            currentWord === word &&
                            !wordElement.classList.contains(
                                'dualsub-word-selected'
                            )
                        ) {
                            wordElement.classList.add('dualsub-word-selected');
                            restoredCount++;

                            // Add new position to tracking
                            const subtitleType =
                                this._getSubtitleTypeFromElement(wordElement);
                            const wordIndex =
                                this._getWordIndexFromElement(wordElement);
                            const position = {
                                elementId: wordElement.id,
                                element: wordElement,
                                subtitleType: subtitleType,
                                wordIndex: wordIndex,
                            };
                            const positionKey = this._createPositionKey(
                                word,
                                position
                            );
                            // Add to model
                            this.selectionModel.add(
                                word,
                                position,
                                positionKey
                            );

                            this._log(
                                'debug',
                                'Word restored with new position',
                                {
                                    wordLength: word.length,
                                    hasPositionKey: Boolean(positionKey),
                                    subtitleType,
                                    addedToOrder:
                                        !this.selectedWordsOrder.includes(
                                            positionKey
                                        ),
                                }
                            );

                            return; // Only restore first occurrence
                        }
                    });
                }
            }

            // Sync from model to ensure consistency
            this.selectionModel.updateSelectedText();
            this._syncSelectionSnapshotFromModel();

            this._log('info', 'Visual highlighting restored', {
                totalInteractiveWords: interactiveWords.length,
                restoredHighlights: restoredCount,
                selectedWordsCount: this.selectedWords.size,
                restorationMethod: 'flexible_matching',
                selectedTextLength: this.selectedText.length,
            });

            // Update modal display if visible
            if (this.isVisible) {
                this._dispatchEvent(EVENT_TYPES.SELECTION_UPDATED, {
                    selectedWords: Array.from(this.selectedWords),
                    selectedText: this.selectedText,
                    restored: true,
                });
            }

            // Phase 3: Centralized highlight sync after restoration
            try {
                this.syncSelectionHighlights();
            } catch (_) {}
        } catch (error) {
            this._log('error', 'Failed to restore visual highlighting', {
                error: error.message,
            });
        } finally {
            this.selectionPersistence.pendingRestore = false;
        }
    }

    /**
     * Helper method to get subtitle type from element
     * @param {HTMLElement} element - Word element
     * @returns {string} Subtitle type
     * @private
     */
    _getSubtitleTypeFromElement(element) {
        // Check if element is in original or translated subtitle container
        const originalContainer = document.querySelector(
            '#dualsub-original-subtitle'
        );
        const translatedContainer = document.querySelector(
            '#dualsub-translated-subtitle'
        );

        if (originalContainer && originalContainer.contains(element)) {
            return 'original';
        } else if (
            translatedContainer &&
            translatedContainer.contains(element)
        ) {
            return 'translated';
        }

        return 'original'; // Default fallback
    }

    /**
     * Helper method to get word index from element
     * @param {HTMLElement} element - Word element
     * @returns {number} Word index
     * @private
     */
    _getWordIndexFromElement(element) {
        const container = element.closest(
            '#dualsub-original-subtitle, #dualsub-translated-subtitle'
        );
        if (!container) return 0;

        const allWords = container.querySelectorAll(
            '.dualsub-interactive-word'
        );
        return Array.from(allWords).indexOf(element);
    }

    /**
     * Update selected text from position keys array (Issue #1: Fixed word sequence preservation)
     * @private
     */
    _updateSelectedText() {
        this.selectionModel.updateSelectedText();
        this._syncSelectionSnapshotFromModel();
        this._log('debug', 'Selected text updated with subtitle order', {
            orderedWordCount: this.selectedWordsOrder.length,
            uniqueWordCount: this.selectedWords.size,
            selectedTextLength: this.selectedText.length,
        });
        // Keep visuals in sync with model
        try {
            this.syncSelectionHighlights();
        } catch (_) {}
    }

    /**
     * Mirror selection model state into legacy-accessed properties
     * @private
     */
    _syncSelectionSnapshotFromModel() {
        this.selectedWordPositions = this.selectionModel.getPositionsMap();
        this.selectedWordsOrder = this.selectionModel.getPositionKeyOrder();
        this.selectedWords = this.selectionModel.getSelectedWords();
        this.selectedText = this.selectionModel.selectedText;
    }

    /**
     * Dispatch custom event
     * @param {string} eventType - Event type
     * @param {Object} detail - Event detail data
     * @private
     */
    _dispatchEvent(eventType, detail = {}) {
        const event = new CustomEvent(eventType, {
            detail: {
                ...detail,
                timestamp: Date.now(),
                modalState: this.getState(),
            },
        });

        document.dispatchEvent(event);

        this._log('debug', 'Event dispatched', {
            eventType,
            detailKeys: Object.keys(detail),
        });
    }

    /**
     * Log message with modal context
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} data - Additional data
     * @private
     */
    _log(level, message, data = {}) {
        const method = this.logger?.[level];
        if (typeof method !== 'function') {
            return;
        }
        method.call(this.logger, message, {
            component: 'AIContextModal:Core',
            state: this.state,
            visible: this.isVisible,
            mode: this.currentMode,
            ...data,
        });
    }

    /**
     * Phase 3: Centralized selection highlights syncing.
     * Applies/removes the 'dualsub-word-selected' class on original subtitle words
     * based on the SelectionModel positions map.
     */
    syncSelectionHighlights() {
        try {
            const container = document.getElementById(
                'dualsub-original-subtitle'
            );
            if (!container) return;
            const wordElements = container.querySelectorAll(
                '.dualsub-interactive-word'
            );
            wordElements.forEach((wordElement) => {
                const word = wordElement.getAttribute('data-word') || '';
                const subtitleType =
                    wordElement.getAttribute('data-subtitle-type') ||
                    'original';
                const wordIndexAttr =
                    wordElement.getAttribute('data-word-index');
                const wordIndex = Number.isFinite(Number(wordIndexAttr))
                    ? Number(wordIndexAttr)
                    : this._getWordIndexFromElement(wordElement);
                const position = {
                    elementId: wordElement.id,
                    element: wordElement,
                    subtitleType,
                    wordIndex,
                };
                const positionKey = this._createPositionKey(word, position);
                let isSelected = this.selectedWordPositions.has(positionKey);

                // Fallback: if not matched by positionKey (e.g., DOM path changed), try matching by
                // word + subtitleType + wordIndex. If matched, also update the model to new key for stability.
                if (!isSelected) {
                    let matchedOldKey = null;
                    for (const [
                        oldKey,
                        entry,
                    ] of this.selectedWordPositions.entries()) {
                        const entryIndex =
                            (entry.position?.wordIndex !== undefined
                                ? entry.position.wordIndex
                                : entry.position?.index) || 0;
                        const entryType =
                            entry.position?.subtitleType || 'original';
                        if (
                            entry.word === word &&
                            entryType === subtitleType &&
                            entryIndex === wordIndex
                        ) {
                            matchedOldKey = oldKey;
                            isSelected = true;
                            break;
                        }
                    }
                    // If matched by index, normalize stored key to the new DOM path to keep future checks aligned
                    if (matchedOldKey) {
                        try {
                            this.selectionModel.replacePositionKey(
                                matchedOldKey,
                                positionKey,
                                word,
                                position
                            );
                            this._syncSelectionSnapshotFromModel();
                        } catch (_) {}
                    }
                }

                if (isSelected) {
                    wordElement.classList.add('dualsub-word-selected');
                } else {
                    // Do not remove highlight while analyzing to preserve selection visuals
                    if (!this.isAnalyzing) {
                        wordElement.classList.remove('dualsub-word-selected');
                    }
                }
            });
        } catch (error) {
            this._log('warn', 'Failed to sync selection highlights', {
                error: error.message,
            });
        }
    }

    /**
     * Cleanup modal core
     */
    async destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._settleReady();
        this._log('info', 'Destroying modal core');

        for (const timeout of this._ownedRestoreTimers) clearTimeout(timeout);
        this._ownedRestoreTimers.clear();
        if (typeof cancelAnimationFrame === 'function') {
            for (const frame of this._ownedRestoreAnimationFrames) {
                cancelAnimationFrame(frame);
            }
        }
        this._ownedRestoreAnimationFrames.clear();
        this._clearSelectionPersistence();

        const persistenceManager = this.selectionPersistenceManager;
        this.selectionPersistenceManager = null;
        try {
            persistenceManager?.stopMonitoring?.();
        } catch (_) {}

        const storeUnsubscribe = this._storeUnsubscribe;
        this._storeUnsubscribe = null;
        try {
            if (typeof storeUnsubscribe === 'function') storeUnsubscribe();
        } catch (_) {}

        this.resetState();

        // Clean up page visibility listener
        const visibilityHandler = this.eventListeners.get('visibilitychange');
        if (visibilityHandler) {
            document.removeEventListener('visibilitychange', visibilityHandler);
        }

        this.eventHandlers.clear();
        this.eventListeners.clear();
        this.element = null;
        this.overlayElement = null;
        this.contentElement = null;
        this.logger = null;

        this._log('debug', 'Modal core destroyed');
    }

    /**
     * Setup page visibility handling to refresh selection state on page visibility changes
     * @private
     */
    _setupPageVisibilityHandling() {
        // Handle page visibility changes to refresh selection state age
        const visibilityChangeHandler = () => {
            if (this.config.privateAnalysis === true && !document.hidden) {
                this.selectionPersistenceManager?._scheduleRestorationDebounced?.(
                    'visibility'
                );
                return;
            }
            if (
                !document.hidden &&
                this.selectionPersistence.lastSelectionState
            ) {
                // Page became visible and we have a selection state
                const stateAge =
                    Date.now() -
                    this.selectionPersistence.lastSelectionState.timestamp;

                this._log(
                    'debug',
                    'Page became visible, checking selection state',
                    {
                        hasSelectionState:
                            !!this.selectionPersistence.lastSelectionState,
                        stateAge,
                        stateAgeSeconds: Math.round(stateAge / 1000),
                        selectedWordsCount: this.selectedWords.size,
                    }
                );

                // If we have a recent selection (within refresh threshold) and words are selected,
                // refresh the state timestamp to prevent age-based rejection
                if (
                    stateAge <
                        UI_CONFIG.MODAL.SELECTION_STATE_REFRESH_THRESHOLD &&
                    this.selectedWords.size > 0
                ) {
                    this.selectionPersistence.lastSelectionState.timestamp =
                        Date.now();

                    this._log(
                        'info',
                        'Refreshed selection state timestamp on page visibility',
                        {
                            previousAge: stateAge,
                            selectedWordsCount: this.selectedWords.size,
                        }
                    );
                }

                // Opportunistically re-sync highlights when tab becomes visible
                try {
                    this.syncSelectionHighlights();
                } catch (_) {}
            }
        };

        document.addEventListener('visibilitychange', visibilityChangeHandler);

        // Store reference for cleanup
        this.eventListeners.set('visibilitychange', visibilityChangeHandler);

        this._log(
            'debug',
            'Page visibility handling setup for selection state refresh'
        );
    }
}
