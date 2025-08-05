/**
 * Text Selection Handler - Modular Text Selection Management
 *
 * Isolated text selection handling with event delegation and smart boundary detection.
 * Replaces and enhances the functionality from textSelectionHandler.js.
 *
 * @author DualSub Extension - Platform Integration Specialist
 * @version 2.0.0
 */

import { AI_CONTEXT_CONFIG } from '../core/constants.js';

/**
 * TextSelectionHandler - Modular text selection management
 */
export class TextSelectionHandler {
    constructor(config = {}) {
        this.config = {
            maxSelectionLength: 500,
            minSelectionLength: 2,
            smartBoundaries: true,
            expandSelection: true,
            debounceDelay: 150,
            contextRadius: 50,
            autoAnalysis: true, // Enable automatic text selection analysis
            ...config,
        };

        this.initialized = false;
        this.currentSelection = null;
        this.selectionState = {
            text: '',
            range: null,
            metadata: null,
            isSelecting: false,
            selectionStart: 0,
            selectionEnd: 0,
            lastSelection: null,
        };

        this.eventHandlers = new Map();
        this.debounceTimer = null;

        this.platformSelectors = null;
        this.subtitleSelectors = [
            '.player-timedtext', // Netflix
            '.dss-subtitle-renderer', // Disney+
            '[data-testid="subtitle"]',
            '.subtitle',
            '.caption',
        ];

        // Bind methods
        this._handleMouseUp = this._handleMouseUp.bind(this);
        this._handleKeyUp = this._handleKeyUp.bind(this);
        this._handleSelectionChange = this._handleSelectionChange.bind(this);
        this.handleWordClick = this.handleWordClick.bind(this);

        this._log('info', 'TextSelectionHandler initialized');
    }

    /**
     * Initialize text selection handling
     * @param {string} platform - Target platform
     * @returns {Promise<boolean>} Success status
     */
    async initialize(platform) {
        try {
            this._log('info', 'Initializing Text Selection Handler', {
                platform,
            });

            // Get platform-specific selectors
            this.platformSelectors = this._getPlatformSelectors(platform);

            // Setup event listeners
            await this._setupEventListeners();

            // Setup word interaction listeners for interactive subtitles
            this._setupWordInteractionListeners();

            this.initialized = true;
            this._log(
                'info',
                'Text Selection Handler initialized successfully',
                {
                    platform,
                    autoAnalysis: this.config.autoAnalysis,
                    selectors: this.platformSelectors,
                }
            );
            return true;
        } catch (error) {
            this._log(
                'error',
                'Failed to initialize text selection handler',
                error
            );
            return false;
        }
    }

    /**
     * Handle text selection events
     * @param {Event} event - Selection event
     */
    handleSelection(event) {
        if (!this.initialized) {
            return;
        }

        const selection = window.getSelection();
        if (!selection || !selection.toString().trim()) {
            this._clearSelectionState();
            return;
        }

        // Check if selection is within subtitle elements
        const range = selection.getRangeAt(0);
        if (!this._isSelectionInSubtitles(range)) {
            return;
        }

        this._updateSelectionState(selection);

        // Only auto-analyze if enabled (disabled by default for modal workflow)
        if (this.config.autoAnalysis) {
            this._processTextSelection(selection, event);
        }
    }

    /**
     * Handle word click events for interactive subtitles
     * @param {Event} event - Click event
     */
    handleWordClick(event) {
        if (!this.initialized) {
            return;
        }

        const target = event.target;

        // Check if clicked element is an interactive word
        if (!target.classList.contains('dualsub-interactive-word')) {
            return;
        }

        const word = target.textContent.trim();
        const position = parseInt(target.dataset.position) || 0;

        this._log('debug', 'Word clicked', { word, position });

        // Dispatch word selection event
        document.dispatchEvent(
            new CustomEvent('dualsub-word-selected', {
                detail: {
                    word,
                    position,
                    action: 'toggle',
                    element: target,
                },
            })
        );
    }

    /**
     * Get current selection
     * @returns {Object|null} Current selection data
     */
    getCurrentSelection() {
        return this.currentSelection;
    }

    /**
     * Clear current selection
     */
    clearSelection() {
        this._log('debug', 'Clearing selection');

        // Clear browser selection
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
        }

        // Clear internal state
        this._clearSelectionState();
    }

    /**
     * Process text selection for context analysis
     * @param {string} text - Selected text
     * @param {Object} metadata - Selection metadata
     * @returns {Object|null} Enhanced selection object
     */
    processSelection(text, metadata = {}) {
        if (!text || text.length < this.config.minSelectionLength) {
            this._log('debug', 'Selection too short', { length: text.length });
            return null;
        }

        if (text.length > this.config.maxSelectionLength) {
            this._log('debug', 'Selection too long', { length: text.length });
            return null;
        }

        // Create enhanced selection object
        const enhancedSelection = {
            text: text.trim(),
            metadata: {
                timestamp: Date.now(),
                platform: metadata.platform,
                language: metadata.language,
                ...metadata,
            },
        };

        this.currentSelection = enhancedSelection;
        this.selectionState.lastSelection = enhancedSelection;

        this._log('info', 'Selection processed', {
            text: enhancedSelection.text,
            hasMetadata: !!enhancedSelection.metadata,
        });

        return enhancedSelection;
    }

    /**
     * Destroy the handler and cleanup
     */
    async destroy() {
        try {
            this._log('info', 'Destroying Text Selection Handler');

            // Remove event listeners
            this.eventHandlers.forEach((handler, event) => {
                document.removeEventListener(event, handler);
            });
            this.eventHandlers.clear();

            // Clear timers
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            // Reset state
            this.initialized = false;
            this.currentSelection = null;

            this._log('info', 'Text Selection Handler destroyed');
        } catch (error) {
            this._log(
                'error',
                'Error destroying text selection handler',
                error
            );
        }
    }

    // Private methods

    _getPlatformSelectors(platform) {
        const platformConfig =
            AI_CONTEXT_CONFIG.PLATFORMS[platform.toUpperCase()];
        return platformConfig ? platformConfig.selectors : null;
    }

    async _setupEventListeners() {
        this._log('debug', 'Setting up event listeners');

        // Only setup automatic selection listeners if auto-analysis is enabled
        if (this.config.autoAnalysis) {
            document.addEventListener('mouseup', this._handleMouseUp);
            document.addEventListener('keyup', this._handleKeyUp);
            document.addEventListener(
                'selectionchange',
                this._handleSelectionChange
            );

            this.eventHandlers.set('mouseup', this._handleMouseUp);
            this.eventHandlers.set('keyup', this._handleKeyUp);
            this.eventHandlers.set(
                'selectionchange',
                this._handleSelectionChange
            );

            this._log('debug', 'Automatic selection listeners enabled');
        } else {
            this._log(
                'debug',
                'Automatic selection listeners disabled (modal-only workflow)'
            );
        }
    }

    _setupWordInteractionListeners() {
        // Listen for word interactions from interactive subtitles
        document.addEventListener('click', this.handleWordClick);
        this.eventHandlers.set('click', this.handleWordClick);

        // Listen for word interaction enable/disable events
        const wordInteractionListener = (event) => {
            this._setWordInteractionsEnabled(event.detail.enabled);
        };
        document.addEventListener(
            'dualsub-word-interactions-enabled',
            wordInteractionListener
        );
        this.eventHandlers.set(
            'dualsub-word-interactions-enabled',
            wordInteractionListener
        );
    }

    // Event handlers

    _handleMouseUp(event) {
        // Only handle selections within subtitle elements
        if (!this._isSubtitleElement(event.target)) {
            return;
        }

        setTimeout(() => {
            const selection = window.getSelection();
            if (selection && selection.toString().trim()) {
                this._processTextSelection(selection, event);
            }
        }, 10); // Small delay to ensure selection is complete
    }

    _handleKeyUp(event) {
        // Handle keyboard-based text selection
        if (
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'Shift' ||
            event.ctrlKey ||
            event.metaKey
        ) {
            setTimeout(() => {
                const selection = window.getSelection();
                if (selection && selection.toString().trim()) {
                    this._processTextSelection(selection, event);
                }
            }, 10);
        }
    }

    _handleSelectionChange(_event) {
        const selection = window.getSelection();

        if (!selection || !selection.toString().trim()) {
            this._clearSelectionState();
            return;
        }

        // Check if selection is within subtitle elements
        const range = selection.getRangeAt(0);
        if (!this._isSelectionInSubtitles(range)) {
            return;
        }

        this._updateSelectionState(selection);
    }

    // Private helper methods

    _processTextSelection(selection, event) {
        if (!selection || !selection.toString().trim()) {
            return;
        }

        const selectedText = selection.toString().trim();

        // Validate selection length
        if (
            selectedText.length < this.config.minSelectionLength ||
            selectedText.length > this.config.maxSelectionLength
        ) {
            this._log('debug', 'Selection length out of bounds', {
                length: selectedText.length,
                min: this.config.minSelectionLength,
                max: this.config.maxSelectionLength,
            });
            return;
        }

        // Get enhanced selection with context
        const enhancedSelection = this._enhanceSelection(selection);

        if (enhancedSelection) {
            this.selectionState.currentSelection = enhancedSelection;
            this.selectionState.lastSelection = enhancedSelection;

            this._log('info', 'Text selection processed', {
                selectedText: enhancedSelection.text,
                hasContext: !!enhancedSelection.context,
                source: event.type,
            });

            // Trigger context analysis
            this._requestContextForSelection(enhancedSelection, event);
        }
    }

    _enhanceSelection(selection) {
        try {
            const range = selection.getRangeAt(0);
            const selectedText = selection.toString().trim();

            // Get surrounding context
            const context = this._extractSurroundingContext(range);

            // Detect language and subtitle type
            const metadata = this._extractSelectionMetadata(range);

            // Optimize selection boundaries if enabled
            const optimizedText = this.config.smartBoundaries
                ? this._optimizeSelectionBoundaries(selectedText, context.full)
                : selectedText;

            return {
                text: optimizedText,
                originalText: selectedText,
                context,
                metadata,
                range,
                timestamp: Date.now(),
            };
        } catch (error) {
            this._log('error', 'Failed to enhance selection', error);
            return null;
        }
    }

    _extractSurroundingContext(range) {
        const container = range.commonAncestorContainer;
        const textContent = container.textContent || '';
        const selectedText = range.toString();

        const startOffset = textContent.indexOf(selectedText);
        const endOffset = startOffset + selectedText.length;

        const contextStart = Math.max(
            0,
            startOffset - this.config.contextRadius
        );
        const contextEnd = Math.min(
            textContent.length,
            endOffset + this.config.contextRadius
        );

        return {
            before: textContent.substring(contextStart, startOffset),
            selected: selectedText,
            after: textContent.substring(endOffset, contextEnd),
            full: textContent.substring(contextStart, contextEnd),
        };
    }

    _extractSelectionMetadata(range) {
        const container = range.commonAncestorContainer;
        const element =
            container.nodeType === Node.TEXT_NODE
                ? container.parentElement
                : container;

        return {
            platform: this._detectPlatform(element),
            language: this._detectLanguage(element),
            subtitleType: this._detectSubtitleType(element),
            elementClasses: element.className,
            elementId: element.id,
        };
    }

    _optimizeSelectionBoundaries(selectedText, fullContext) {
        if (!this.config.expandSelection) {
            return selectedText;
        }

        // Find the selection in context
        const selectionIndex = fullContext.indexOf(selectedText);
        if (selectionIndex === -1) {
            return selectedText;
        }

        let start = selectionIndex;
        let end = selectionIndex + selectedText.length;

        // Expand to word boundaries
        while (start > 0 && !this._isWordBoundary(fullContext[start - 1])) {
            start--;
        }

        while (
            end < fullContext.length &&
            !this._isWordBoundary(fullContext[end])
        ) {
            end++;
        }

        // Don't expand beyond phrase boundaries (like legacy system)
        const phraseStart = this._findPhraseStart(fullContext, start);
        const phraseEnd = this._findPhraseEnd(fullContext, end);

        start = Math.max(start, phraseStart);
        end = Math.min(end, phraseEnd);

        const optimizedText = fullContext.substring(start, end).trim();

        // Ensure optimized text isn't too long
        if (optimizedText.length > this.config.maxSelectionLength) {
            return selectedText;
        }

        this._log('debug', 'Selection boundaries optimized', {
            original: selectedText,
            optimized: optimizedText,
            expanded: optimizedText !== selectedText,
        });

        return optimizedText;
    }

    _isWordBoundary(char) {
        return /\s|[.,!?;:]/.test(char);
    }

    _findPhraseStart(text, position) {
        const phraseDelimiters = ['.', '!', '?', ';', ':'];
        for (let i = position - 1; i >= 0; i--) {
            if (phraseDelimiters.includes(text[i])) {
                return i + 1;
            }
        }
        return 0;
    }

    _findPhraseEnd(text, position) {
        const phraseDelimiters = ['.', '!', '?', ';', ':'];
        for (let i = position; i < text.length; i++) {
            if (phraseDelimiters.includes(text[i])) {
                return i;
            }
        }
        return text.length;
    }

    _detectPlatform(element) {
        if (element.closest('.player-timedtext')) return 'netflix';
        if (element.closest('.dss-subtitle-renderer')) return 'disneyplus';
        return 'unknown';
    }

    _detectLanguage(element) {
        return element.lang || document.documentElement.lang || 'en';
    }

    _detectSubtitleType(element) {
        if (element.classList.contains('dualsub-original')) return 'original';
        if (element.classList.contains('dualsub-translated'))
            return 'translated';
        return 'unknown';
    }

    _requestContextForSelection(selection, event) {
        // Dispatch custom event for context analysis
        document.dispatchEvent(
            new CustomEvent('dualsub-analyze-selection', {
                detail: {
                    selection,
                    event: {
                        type: event.type,
                        clientX: event.clientX,
                        clientY: event.clientY,
                    },
                },
            })
        );
    }

    _updateSelectionState(selection) {
        this.selectionState.isSelecting = true;
        this.selectionState.selectionStart = selection.anchorOffset;
        this.selectionState.selectionEnd = selection.focusOffset;
    }

    _clearSelectionState() {
        this.selectionState.isSelecting = false;
        this.selectionState.text = '';
        this.selectionState.range = null;
        this.selectionState.metadata = null;
        this.currentSelection = null;
    }

    _isSelectionInSubtitles(range) {
        const container = range.commonAncestorContainer;
        const element =
            container.nodeType === Node.TEXT_NODE
                ? container.parentElement
                : container;

        return this.subtitleSelectors.some((selector) => {
            return element.closest(selector) !== null;
        });
    }

    _isSubtitleElement(element) {
        return this.subtitleSelectors.some((selector) => {
            return element.closest(selector) !== null;
        });
    }

    _setWordInteractionsEnabled(enabled) {
        this._log('debug', 'Word interactions enabled state changed', {
            enabled,
        });
        // This could be used to enable/disable word click handling
    }

    _log(level, message, data = {}) {
        const logData = {
            component: 'TextSelectionHandler',
            initialized: this.initialized,
            hasSelection: !!this.currentSelection,
            timestamp: new Date().toISOString(),
            ...data,
        };

        console[level](`[AIContext:TextSelection] ${message}`, logData);
    }
}
