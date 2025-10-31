/**
 * AI Context Modal - Events Module
 *
 * Event handling and user interactions functionality.
 * Handles modal events, user interactions, and external event coordination.
 *
 * @author DualSub Extension - UI Systems Engineer
 * @version 2.0.0
 */

import { EVENT_TYPES, MODAL_STATES } from '../core/constants.js';

/**
 * Modal event handling and user interactions
 */
export class AIContextModalEvents {
    constructor(core, ui, animations = null) {
        this.core = core;
        this.ui = ui;
        this.animations = animations; // Reference to animations module
        this.boundHandlers = new Map();
        this.lastAnalysisClickTime = 0; // Debouncing protection
        this.analysisClickDebounceMs = 500; // 500ms debounce
    }

    /**
     * Set animations module reference (for cases where events is initialized before animations)
     * @param {AIContextModalAnimations} animations - Animations module instance
     */
    setAnimations(animations) {
        this.animations = animations;
    }

    /**
     * Setup all event listeners
     * @returns {Promise<void>}
     */
    async setupEventListeners() {
        this.core._log('debug', 'Setting up event listeners');

        if (!this.core.element) {
            throw new Error('Modal element not created');
        }

        // Modal control events
        this._setupModalControlEvents();

        // Selection events
        this._setupSelectionEvents();

        // Analysis events
        this._setupAnalysisEvents();

        // External events (word selection from subtitles)
        this._setupExternalEvents();

        // Keyboard events
        this._setupKeyboardEvents();

        this.core._log('debug', 'Event listeners setup complete');
    }

    /**
     * Setup modal control events (close, overlay click)
     * @private
     */
    _setupModalControlEvents() {
        // Close button (check both modal element and content element)
        const closeBtn =
            this.core.element.querySelector('#dualsub-modal-close') ||
            this.core.contentElement?.querySelector('#dualsub-modal-close') ||
            document.getElementById('dualsub-modal-close');
        if (closeBtn) {
            const closeHandler = () => {
                if (this.modalController) this.modalController.closeModal();
                else this._handleCloseModal();
            };
            closeBtn.addEventListener('click', closeHandler);
            this.boundHandlers.set('close-click', {
                element: closeBtn,
                handler: closeHandler,
            });
        }

        // Handle modal overlay clicks - block all clicks and close on overlay click (EXACT legacy behavior)
        const overlayHandler = (e) => this._handleOverlayClick(e);
        this.core.element.addEventListener('click', overlayHandler);
        this.boundHandlers.set('overlay-click', {
            element: this.core.element,
            handler: overlayHandler,
        });

        // Additional click blocking for the overlay specifically (EXACT legacy behavior)
        const mousedownHandler = (e) => {
            // Block all mouse events from reaching underlying page
            e.stopPropagation();
        };
        this.core.element.addEventListener('mousedown', mousedownHandler);
        this.boundHandlers.set('overlay-mousedown', {
            element: this.core.element,
            handler: mousedownHandler,
        });

        // Global click blocking when modal is visible (Issue #2)
        const globalClickBlocker = (e) => this._handleGlobalClick(e);
        document.addEventListener('click', globalClickBlocker, true); // Use capture phase
        this.boundHandlers.set('global-click', {
            element: document,
            handler: globalClickBlocker,
        });
    }

    /**
     * Setup selection events (word chips, selection management)
     * @private
     */
    _setupSelectionEvents() {
        // Delegate word chip events to the selected words container (prefer current content element)
        const wordsContainer =
            this.core.contentElement?.querySelector(
                '#dualsub-selected-words'
            ) ||
            this.core.element.querySelector('#dualsub-selected-words') ||
            document.getElementById('dualsub-selected-words');
        if (wordsContainer) {
            const wordsHandler = (e) => this._handleWordChipClick(e);
            wordsContainer.addEventListener('click', wordsHandler);
            this.boundHandlers.set('words-click', {
                element: wordsContainer,
                handler: wordsHandler,
            });
        }
    }

    /**
     * Setup analysis events (start analysis, pause, new analysis)
     * @private
     */
    _setupAnalysisEvents() {
        // Start analysis button (prefer current content element)
        const startBtn =
            this.core.contentElement?.querySelector(
                '#dualsub-start-analysis'
            ) ||
            this.core.element.querySelector('#dualsub-start-analysis') ||
            document.getElementById('dualsub-start-analysis');
        if (startBtn) {
            // Check if we already have a handler for this element to prevent duplicates
            const existingHandler = this.boundHandlers.get('start-analysis');
            if (existingHandler && existingHandler.element === startBtn) {
                this.core._log(
                    'debug',
                    'Start analysis button already has event listener, skipping'
                );
                // Refresh localization in case UI language changed (e.g., fullscreen)
                try {
                    startBtn.title = this._getLocalizedMessage(
                        'aiContextStartAnalysis'
                    );
                    if (!startBtn.getAttribute('data-paused-toggle')) {
                        startBtn.textContent = this._getLocalizedMessage(
                            'aiContextStartAnalysis'
                        );
                    }
                } catch (_) {}
                return;
            }

            const startHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this.modalController)
                    return this.modalController.startAnalysis();
                return this._handleStartAnalysis();
            };
            startBtn.addEventListener('click', startHandler);
            this.boundHandlers.set('start-analysis', {
                element: startBtn,
                handler: startHandler,
            });
            // Ensure localized label is applied when binding
            try {
                const title = this._getLocalizedMessage(
                    'aiContextStartAnalysis'
                );
                startBtn.title = title;
                startBtn.textContent = title;
            } catch (_) {}
        }

        // Pause analysis button (check multiple locations)
        const pauseBtn =
            this.core.element.querySelector('#dualsub-pause-analysis') ||
            this.core.contentElement?.querySelector(
                '#dualsub-pause-analysis'
            ) ||
            document.getElementById('dualsub-pause-analysis');
        if (pauseBtn) {
            const pauseHandler = () => {
                if (this.modalController)
                    return this.modalController.pauseAnalysis();
                return this._handlePauseAnalysis();
            };
            pauseBtn.addEventListener('click', pauseHandler);
            this.boundHandlers.set('pause-analysis', {
                element: pauseBtn,
                handler: pauseHandler,
            });
        }

        // New analysis button (check multiple locations)
        const newBtn =
            this.core.element.querySelector('#dualsub-new-analysis') ||
            this.core.contentElement?.querySelector('#dualsub-new-analysis') ||
            document.getElementById('dualsub-new-analysis');
        if (newBtn) {
            const newHandler = () => {
                if (this.modalController)
                    return this.modalController.newAnalysis();
                return this._handleNewAnalysis();
            };
            newBtn.addEventListener('click', newHandler);
            this.boundHandlers.set('new-analysis', {
                element: newBtn,
                handler: newHandler,
            });
        }
    }

    /**
     * Setup external events (word selection from subtitles)
     * @private
     */
    _setupExternalEvents() {
        // Listen for word selection events from subtitle interactions
        const wordSelectionHandler = (event) =>
            this._handleWordSelectionEvent(event);
        document.addEventListener(
            'dualsub-word-selected',
            wordSelectionHandler
        );
        this.boundHandlers.set('word-selection', {
            element: document,
            handler: wordSelectionHandler,
        });

        // Listen for analysis requests
        const analysisRequestHandler = (event) =>
            this._handleAnalysisRequest(event);
        document.addEventListener(
            'dualsub-analyze-selection',
            analysisRequestHandler
        );
        this.boundHandlers.set('analysis-request', {
            element: document,
            handler: analysisRequestHandler,
        });

        // Listen for analysis results and delegate to controller
        const analysisResultHandler = (event) => {
            if (this.modalController && event?.detail) {
                this.modalController.onAnalysisResult(event.detail);
            } else {
                this._handleAnalysisResult(event);
            }
        };
        document.addEventListener(
            'dualsub-context-result',
            analysisResultHandler
        );
        this.boundHandlers.set('analysis-result', {
            element: document,
            handler: analysisResultHandler,
        });
    }

    /**
     * Setup keyboard events
     * @private
     */
    _setupKeyboardEvents() {
        const keyHandler = (e) => this._handleKeyPress(e);
        document.addEventListener('keydown', keyHandler);
        this.boundHandlers.set('keydown', {
            element: document,
            handler: keyHandler,
        });
    }

    /**
     * Handle close modal
     * @private
     */
    _handleCloseModal() {
        this.core._log('info', 'Close modal requested');

        // Check if analysis is in progress and stop it before closing (Issue #5)
        if (this.core.isAnalyzing) {
            this.core._log('info', 'Stopping analysis before closing modal');
            this._handlePauseAnalysis();
        }

        // Clear all selections when hiding modal (EXACT legacy behavior)
        this.core.clearSelection();
        this.core.originalSentenceWords = [];
        this.core.wordPositions.clear();
        this.core.selectedWordsOrder = [];
        this.core.selectedText = '';
        this.ui.updateSelectionDisplay();

        // Ensure visual state is properly cleared (Issue #3)
        try {
            this.core.syncSelectionHighlights();
        } catch (_) {}

        this.core._dispatchEvent(EVENT_TYPES.MODAL_CLOSE_REQUESTED, {});
    }

    /**
     * Handle overlay click
     * @param {Event} event - Click event
     * @private
     */
    _handleOverlayClick(event) {
        // Always prevent clicks from reaching the underlying page (EXACT legacy behavior)
        event.stopPropagation();
        event.preventDefault();

        // Close modal only if clicking directly on the overlay (EXACT legacy behavior)
        if (
            event.target.classList.contains('dualsub-modal-overlay') ||
            event.target.classList.contains('dualsub-context-modal')
        ) {
            if (this.modalController) this.modalController.closeModal();
            else this._handleCloseModal();
        }
    }

    /**
     * Handle global clicks when modal is visible (Issue #2)
     * @param {Event} event - Click event
     * @private
     */
    _handleGlobalClick(event) {
        // Only block clicks when modal is visible
        if (!this.core.isVisible) {
            return;
        }

        // Allow clicks within the modal content (check both old and new locations)
        const modalContent =
            this.core.element?.querySelector('.dualsub-modal-content') ||
            this.core.contentElement;
        if (modalContent && modalContent.contains(event.target)) {
            return;
        }

        // Allow clicks on interactive words for word selection (Issue #1)
        if (event.target.classList.contains('dualsub-interactive-word')) {
            this.core._log('debug', 'Allowing interactive word click', {
                word: event.target.getAttribute('data-word'),
                target: event.target.tagName,
                targetClass: event.target.className,
            });
            return;
        }

        // Block all other clicks when modal is visible
        event.stopPropagation();
        event.preventDefault();

        this.core._log('debug', 'Global click blocked while modal is visible', {
            target: event.target.tagName,
            targetClass: event.target.className,
        });
    }

    /**
     * Handle word chip click (removal)
     * @param {Event} event - Click event
     * @private
     */
    _handleWordChipClick(event) {
        const removeBtn = event.target.closest('.dualsub-word-remove');
        if (removeBtn) {
            const word = removeBtn.dataset.word;
            const positionKey = removeBtn.dataset.positionKey;

            if (word) {
                // Block word removal during processing (EXACT legacy behavior)
                if (this.core.isAnalyzing) {
                    this.core._log(
                        'debug',
                        'Word removal blocked - analysis in progress',
                        { word }
                    );
                    return;
                }

                this.core._log(
                    'debug',
                    'Word removal requested (position-based)',
                    {
                        word,
                        positionKey,
                        totalPositions: this.core.selectedWordPositions.size,
                    }
                );

                // Use position-based removal if position key is available (Issue #2)
                if (positionKey) {
                    const positionData =
                        this.core.selectedWordPositions.get(positionKey);
                    if (positionData) {
                        this.core.removeWordFromSelection(
                            word,
                            positionData.position
                        );
                    } else {
                        this.core._log(
                            'warn',
                            'Position data not found for removal',
                            {
                                word,
                                positionKey,
                                availableKeys: Array.from(
                                    this.core.selectedWordPositions.keys()
                                ),
                            }
                        );
                        // Fallback to removing all instances of the word
                        this.core.removeWordFromSelection(word);
                    }
                } else {
                    // Fallback for legacy compatibility
                    this.core.removeWordFromSelection(word);
                }

                // Update selected text with position-based ordering (delegated to core model)
                this.core._updateSelectedText();

                this.ui.updateSelectionDisplay();

                // Sync visual state with original subtitles (centralized in core)
                try {
                    this.core.syncSelectionHighlights();
                } catch (_) {}

                // Hide modal if no words are selected (legacy compatibility)
                if (this.core.selectedWordPositions.size === 0) {
                    // Ensure visual state is properly cleared before closing
                    this._syncWordSelectionVisuals();
                    // Close via controller for centralized cleanup
                    if (this.modalController) this.modalController.closeModal();
                    else this._handleCloseModal();
                }
            }
        }
    }

    /**
     * Handle start analysis
     * @private
     */
    async _handleStartAnalysis() {
        // DELEGATE: prefer controller when available
        if (this.modalController) return this.modalController.startAnalysis();

        // Debouncing protection against duplicate clicks
        const currentTime = Date.now();
        if (
            currentTime - this.lastAnalysisClickTime <
            this.analysisClickDebounceMs
        ) {
            this.core._log(
                'debug',
                'Analysis click ignored due to debouncing',
                {
                    timeSinceLastClick:
                        currentTime - this.lastAnalysisClickTime,
                    debounceMs: this.analysisClickDebounceMs,
                }
            );
            return;
        }
        this.lastAnalysisClickTime = currentTime;

        if (this.core.selectedWords.size === 0) {
            // Close the modal when no words selected
            if (this.modalController) this.modalController.closeModal();
            else this._handleCloseModal();
            return;
        }

        // Clear/abort any prior analysis before starting a new one (EXACT legacy behavior)
        if (this.core.isAnalyzing) {
            if (this.modalController) this.modalController.pauseAnalysis();
            else this._handlePauseAnalysis();
        }

        this.core.currentMode = 'analysis';

        // Use setAnalyzing to trigger duplicate removal (Issue #1: Fixed duplicate word selection during analysis)
        // Set analyzing before any UI flips
        this.core.setAnalyzing(true);
        // Centralized state path: set processing state to drive rendering; add sticky to prevent flash back
        this.core.setState(MODAL_STATES.PROCESSING);
        this.core.contentElement?.classList.add('dualsub-processing-sticky');
        // Emit a modal state change to 'analyzing' to keep the manager state in sync during SPA timing
        try {
            this.core._dispatchEvent(EVENT_TYPES.MODAL_STATE_CHANGE, {
                previousState: this.core.state,
                currentState: MODAL_STATES.PROCESSING,
                data: { requestId: this.core.currentRequest },
            });
        } catch (_) {}

        // Disable word interactions during processing (EXACT legacy behavior)
        this._disableWordInteractions();
        // Also freeze selection persistence while analyzing to avoid blinking
        try {
            this.core.selectionPersistence.lastManualSelectionTs = Date.now();
        } catch (_) {}

        // Update analysis button via controller API
        try {
            if (
                this.modalController &&
                typeof this.modalController.resetAnalysisButton === 'function'
            ) {
                // After switching to processing state, we want pause-enabled button; reuse controller reset then toggle
                this.modalController.resetAnalysisButton();
                const btn =
                    this.core.contentElement?.querySelector(
                        '#dualsub-start-analysis'
                    ) || document.getElementById('dualsub-start-analysis');
                if (btn) {
                    btn.textContent = this._getLocalizedMessage(
                        'aiContextPauseAnalysis'
                    );
                    btn.className = 'dualsub-analysis-button processing';
                    btn.title = this._getLocalizedMessage(
                        'aiContextPauseAnalysisTitle'
                    );
                    btn.disabled = false;
                    btn.setAttribute('data-paused-toggle', 'true');
                    const pauseHandler = (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (this.modalController)
                            this.modalController.pauseAnalysis();
                        else this._handlePauseAnalysis();
                    };
                    const newButton = btn.cloneNode(true);
                    btn.parentNode.replaceChild(newButton, btn);
                    newButton.addEventListener('click', pauseHandler);
                    this.boundHandlers.set('pause-analysis-active', {
                        element: newButton,
                        handler: pauseHandler,
                    });
                }
            }
        } catch (_) {}

        // Use animations pipeline to ensure state class and layout updates
        if (
            this.animations &&
            typeof this.animations.showProcessingState === 'function'
        ) {
            this.animations.showProcessingState();
        } else {
            // Rely solely on state-driven CSS; avoid inline display mutations
            this.ui.showProcessingState();
        }
        // Immediately enforce chip disabled visuals after switching states
        try {
            this.ui.updateSelectionDisplay();
        } catch (_) {}

        // Keep visual selection highlight visible during processing (multi-sync to withstand reflows)
        try {
            this._syncWordSelectionVisuals();
        } catch (_) {}
        try {
            requestAnimationFrame(() => {
                try {
                    this._syncWordSelectionVisuals();
                } catch (_) {}
            });
        } catch (_) {}
        try {
            setTimeout(() => {
                try {
                    this._syncWordSelectionVisuals();
                } catch (_) {}
            }, 75);
        } catch (_) {}

        // Get user's language preferences for analysis
        let targetLanguage = 'en'; // Default fallback
        let sourceLanguage = 'auto'; // Default to auto-detect

        try {
            // Prefer config manager for consistency; fall back to chrome.storage if unavailable
            const cfg =
                this.core.contentScript?.configService || window.configService;
            if (cfg && typeof cfg.getMultiple === 'function') {
                const prefs = await cfg.getMultiple([
                    'targetLanguage',
                    'originalLanguage',
                ]);
                if (prefs?.targetLanguage) {
                    targetLanguage = prefs.targetLanguage;
                }
                if (prefs?.originalLanguage) {
                    sourceLanguage = prefs.originalLanguage;
                }
            } else if (chrome?.storage?.sync) {
                const result = await chrome.storage.sync.get([
                    'targetLanguage',
                    'originalLanguage',
                ]);
                if (result.targetLanguage) {
                    targetLanguage = result.targetLanguage;
                }
                if (result.originalLanguage) {
                    sourceLanguage = result.originalLanguage;
                }
            }

            this.core._log('debug', 'Language preferences resolved', {
                sourceLanguage,
                targetLanguage,
                selectedText: this.core.selectedText,
            });
        } catch (error) {
            this.core._log(
                'warn',
                'Failed to get language preferences, using defaults',
                {
                    error: error.message,
                    sourceLanguage,
                    targetLanguage,
                    selectedText: this.core.selectedText,
                }
            );
        }

        // Send analysis request (EXACT legacy behavior)
        const requestId = `analysis-${Date.now()}`;
        this.core.currentRequest = requestId;

        document.dispatchEvent(
            new CustomEvent('dualsub-analyze-selection', {
                detail: {
                    requestId,
                    text: this.core.selectedText,
                    contextTypes: ['cultural', 'historical', 'linguistic'],
                    language: sourceLanguage, // Pass actual source language instead of 'auto'
                    targetLanguage: targetLanguage, // Pass user's preferred target language
                    selection: {
                        text: this.core.selectedText,
                        words: Array.from(this.core.selectedWords),
                    },
                },
            })
        );

        this.core._log('info', 'Context analysis started', {
            text: this.core.selectedText,
            selectedWordsCount: this.core.selectedWords.size,
            requestId,
        });
    }

    /**
     * Handle pause analysis
     * @private
     */
    _handlePauseAnalysis() {
        // DELEGATE: prefer controller when available
        if (this.modalController) return this.modalController.pauseAnalysis();

        // Request provider cancellation through manager by emitting standardized pause event
        try {
            document.dispatchEvent(
                new CustomEvent('aicontext:analysis:pause', {
                    detail: { requestId: this.core.currentRequest },
                })
            );
        } catch (_) {}

        // The remainder of pause cleanup is handled by controller path.
    }

    /**
     * Handle new analysis
     * @private
     */
    _handleNewAnalysis() {
        this.core._log('info', 'New analysis requested');

        this.core.clearSelection();
        this.core.analysisResult = null;
        this.core.setState(MODAL_STATES.SELECTION);
        this.ui.showInitialState();
        this.ui.updateSelectionDisplay();

        this.core._dispatchEvent(EVENT_TYPES.NEW_ANALYSIS_REQUESTED, {});
    }

    /**
     * Handle word selection event from subtitles
     * @param {CustomEvent} event - Word selection event
     * @private
     */
    _handleWordSelectionEvent(event) {
        this._pauseVideo();
        const { word, action, position, element, subtitleType } = event.detail;

        // Handle legacy event format (from interactiveSubtitleFormatter.js)
        // Legacy format: {word, element, subtitleType}
        // New format: {word, action, position}
        const effectiveAction = action || 'toggle'; // Default to toggle for legacy compatibility
        const effectivePosition = position || 0; // Default position for legacy compatibility

        this.core._log('info', 'Word selection event received', {
            word,
            action: effectiveAction,
            position: effectivePosition,
            subtitleType,
            currentMode: this.core.currentMode,
            isLegacyFormat: !action && !position,
        });

        // Block word selection during processing (legacy compatibility)
        if (this.core.isAnalyzing) {
            this.core._log(
                'debug',
                'Word selection blocked - analysis in progress',
                {
                    word,
                    subtitleType,
                }
            );
            return;
        }

        // Only allow selection from original subtitles (legacy compatibility)
        if (subtitleType && subtitleType !== 'original') {
            this.core._log(
                'debug',
                'Word selection ignored - not from original subtitle',
                { subtitleType }
            );
            return;
        }

        // Capture original sentence structure on first selection intent (before modal state changes)
        if (this.core.selectedWords.size === 0 && element) {
            this._captureOriginalSentenceStructure(element);
        }

        // Build enhanced position for deterministic selection
        const enhancedPosition = {
            ...effectivePosition,
            elementId: element?.id,
            element: element,
            subtitleType: subtitleType,
            wordIndex: this._getWordIndex(element),
        };

        // Record last manual selection time to suppress immediate restorations
        try {
            this.core.selectionPersistence.lastManualSelectionTs = Date.now();
        } catch (_) {}

        // Apply the selection change BEFORE possibly showing the modal to avoid race with modal clearing state
        if (effectiveAction === 'toggle') {
            this.core.toggleWordSelection(word, enhancedPosition);
        } else if (effectiveAction === 'add') {
            this.core.addWordToSelection(word, enhancedPosition);
        } else if (effectiveAction === 'remove') {
            this.core.removeWordFromSelection(word, enhancedPosition);
        }

        // Immediate visual feedback on the clicked element (in addition to global sync)
        try {
            if (element) {
                const clickedKey = this.core._createPositionKey(
                    word,
                    enhancedPosition
                );
                if (this.core.selectedWordPositions.has(clickedKey)) {
                    element.classList.add('dualsub-word-selected');
                } else {
                    element.classList.remove('dualsub-word-selected');
                }
            }
        } catch (_) {}

        // Fallback: if events arrive before positions were fully computed, ensure selectedWordsOrder has at least one entry
        if (
            this.core.selectedWords.size > 0 &&
            this.core.selectedWordsOrder.length === 0
        ) {
            const firstWord = Array.from(this.core.selectedWords)[0];
            this.core.selectedWordsOrder.push(`${firstWord}:fallback:0`);
        }

        // Update state and visuals
        this.core._updateSelectedText();
        this.ui.updateSelectionDisplay();
        try {
            this.core.syncSelectionHighlights();
        } catch (_) {}

        // Send a message to the background to update the side panel state
        try {
            chrome.runtime.sendMessage({
                action: 'forwardWordSelection',
                data: {
                    word,
                    action: effectiveAction,
                    subtitleType,
                    reason: 'word-click',
                },
            });
        } catch (error) {
            this.core._log('warn', 'Failed to send word selection to background', {
                error: error.message,
            });
        }

        // If modal isn't visible yet, show it now only when there is an active selection
        if (!this.core.isVisible) {
            if (this.core.selectedWords.size > 0) {
                this.core._log('debug', 'Showing modal for word selection', {
                    word,
                    subtitleType,
                });
                this.core._dispatchEvent(EVENT_TYPES.MODAL_SHOW_REQUESTED, {
                    mode: 'selection',
                    trigger: 'word-selection',
                });
            } else {
                // No selection after toggle (e.g., user de-selected the last word)
                // Ensure modal remains hidden and state is not forced to SELECTION by late async shows
                this.core.setState(MODAL_STATES.HIDDEN);
                this.core.isVisible = false;
                try {
                    this.core.store.setVisibility(false);
                } catch (_) {}
                this.core._log(
                    'debug',
                    'No active selection; keeping modal hidden'
                );
            }
        } else if (this.core.selectedWords.size === 0) {
            // Only request close when modal is currently visible and selection becomes empty
            this.core._dispatchEvent(EVENT_TYPES.MODAL_CLOSE_REQUESTED, {
                reason: 'no-words-selected',
            });
        }

        // Ensure UI reflects current selection even if modal opens asynchronously
        clearTimeout(this._postOpenSync);
        this._postOpenSync = setTimeout(() => {
            try {
                this.ui.updateSelectionDisplay();
                try {
                    this.core.syncSelectionHighlights();
                } catch (_) {}
            } catch (_) {}
        }, 16);
    }

    /**
     * Pause video playback via content script integration
     * @private
     */
    async _pauseVideo() {
        try {
            if (
                this.core &&
                this.core.contentScript &&
                this.core.contentScript.activePlatform &&
                typeof this.core.contentScript.activePlatform.pausePlayback ===
                    'function'
            ) {
                this.core._log('debug', 'Pausing video for modal display');
                await this.core.contentScript.activePlatform.pausePlayback();
            }
        } catch (error) {
            this.core._log('warn', 'Failed to pause video for modal', {
                error: error.message,
            });
        }
    }

    /**
     * Handle analysis request event
     * @param {CustomEvent} event - Analysis request event
     * @private
     */
    _handleAnalysisRequest(event) {
        const { selection } = event.detail;

        // Only add words from selection if we don't already have a selection
        // This prevents duplicates when analysis is started from the modal itself
        if (selection && selection.text && this.core.selectedWords.size === 0) {
            const words = selection.text
                .split(/\s+/)
                .filter((word) => word.length > 0);
            words.forEach((word) =>
                this.core.addWordToSelection(word, selection.metadata)
            );
        }

        // Show modal only when selection exists; preserve selection
        if (!this.core.isVisible && this.core.selectedWords.size > 0) {
            this.core._dispatchEvent(EVENT_TYPES.MODAL_SHOW_REQUESTED, {
                mode: 'selection',
                trigger: 'analysis-request',
            });
        }

        this.ui.updateSelectionDisplay();
    }

    /**
     * Handle keyboard events
     * @param {KeyboardEvent} event - Keyboard event
     * @private
     */
    _handleKeyPress(event) {
        if (!this.core.isVisible) return;

        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                this._handleCloseModal();
                break;
            case 'Enter':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    if (
                        this.core.selectedWords.size > 0 &&
                        !this.core.isAnalyzing
                    ) {
                        // Use the same debouncing mechanism as button clicks
                        if (this.modalController)
                            this.modalController.startAnalysis();
                        else this._handleStartAnalysis();
                    }
                }
                break;
        }
    }

    /**
     * Capture the original sentence structure for position-based word ordering
     * Replicates legacy contextAnalysisModal.js behavior exactly
     * @param {HTMLElement} wordElement - The clicked word element
     * @private
     */
    _captureOriginalSentenceStructure(wordElement) {
        try {
            // Find the subtitle container
            const subtitleContainer = wordElement.closest(
                '[id*="subtitle"], .dualsub-subtitle-container, .subtitle-container'
            );
            if (!subtitleContainer) {
                this.core._log(
                    'warn',
                    'Could not find subtitle container for word ordering'
                );
                return;
            }

            // Get all interactive words in the subtitle
            const interactiveWords = subtitleContainer.querySelectorAll(
                '.dualsub-interactive-word'
            );
            this.core.originalSentenceWords = [];
            this.core.wordPositions.clear();

            interactiveWords.forEach((wordEl, index) => {
                const word = wordEl.getAttribute('data-word');
                if (word) {
                    this.core.originalSentenceWords.push(word);
                    this.core.wordPositions.set(word, index);
                }
            });

            this.core._log('debug', 'Captured original sentence structure', {
                totalWords: this.core.originalSentenceWords.length,
                words: this.core.originalSentenceWords,
            });
        } catch (error) {
            this.core._log(
                'error',
                'Failed to capture original sentence structure',
                {
                    error: error.message,
                }
            );
        }
    }

    /**
     * Update selected text maintaining original sentence word order (Issue #1: Fixed word sequence preservation)
     * This method is now handled by the core's _updateSelectedText method
     * @private
     */
    _updateSelectedTextWithPositionOrder() {
        // The core's _updateSelectedText method now handles position-based ordering
        // This method is kept for legacy compatibility but delegates to the core
        this.core._updateSelectedText();

        this.core._log(
            'debug',
            'Updated selected text with position order (delegated to core)',
            {
                selectedPositions: this.core.selectedWordPositions.size,
                orderKeys: this.core.selectedWordsOrder,
                selectedText: this.core.selectedText,
            }
        );
    }

    /**
     * Sync visual selection state is centralized in core.syncSelectionHighlights
     * @private
     */
    _syncWordSelectionVisuals() {
        try {
            this.core.syncSelectionHighlights();
        } catch (_) {}
    }

    /**
     * Get subtitle type from word element (Issue #4: Position-based selection)
     * @param {HTMLElement} wordElement - Word element
     * @returns {string} Subtitle type
     * @private
     */
    _getSubtitleType(wordElement) {
        const container = wordElement.closest(
            '[id*="subtitle"], .dualsub-subtitle-container'
        );
        if (container) {
            if (container.id.includes('original')) return 'original';
            if (container.id.includes('translated')) return 'translated';
            if (container.classList.contains('dualsub-original-subtitle'))
                return 'original';
            if (container.classList.contains('dualsub-translated-subtitle'))
                return 'translated';
        }
        return 'original'; // Default to original
    }

    /**
     * Get word index within its subtitle container (Issue #4: Position-based selection)
     * @param {HTMLElement} wordElement - Word element
     * @returns {number} Word index
     * @private
     */
    _getWordIndex(wordElement) {
        if (!wordElement) return 0;

        const container = wordElement.closest(
            '[id*="subtitle"], .dualsub-subtitle-container'
        );
        if (container) {
            const allWords = container.querySelectorAll(
                '.dualsub-interactive-word'
            );
            return Array.from(allWords).indexOf(wordElement);
        }

        return 0;
    }

    /**
     * Handle analysis result (EXACT legacy behavior)
     * @param {CustomEvent} event - Analysis result event
     * @private
     */
    _handleAnalysisResult(event) {
        const { requestId, result, success, error, shouldRetry } = event.detail;

        this.core._log('debug', 'Received analysis result event', {
            requestId,
            currentRequest: this.core.currentRequest,
            success,
            hasResult: !!result,
            hasError: !!error,
            error,
            eventDetailKeys: Object.keys(event.detail),
            resultKeys: result ? Object.keys(result) : null,
        });

        // Ignore results not matching the current request OR if user paused (no currentRequest)
        if (
            !this.core.currentRequest ||
            requestId !== this.core.currentRequest
        ) {
            this.core._log('debug', 'Ignoring result - request ID mismatch', {
                receivedId: requestId,
                expectedId: this.core.currentRequest,
            });
            return; // Not our request
        }

        this.core.isAnalyzing = false;

        // Re-enable word interactions (EXACT legacy behavior)
        this._enableWordInteractions();

        // Reset analysis button via controller
        if (
            this.modalController &&
            typeof this.modalController.resetAnalysisButton === 'function'
        ) {
            this.modalController.resetAnalysisButton();
        } else {
            this._resetAnalysisButton();
        }

        const analysisContent =
            this.core.contentElement?.querySelector(
                '#dualsub-analysis-content'
            ) || document.getElementById('dualsub-analysis-content');
        if (!analysisContent) {
            this.core._log('error', 'Analysis content element not found');
            return;
        }

        this.core._log('debug', 'Processing analysis result', {
            success,
            hasResult: !!result,
            hasError: !!error,
            error,
        });

        if (success && result) {
            // Display analysis results (EXACT legacy logic)
            let html = '';

            this.core._log('debug', 'Processing analysis result', {
                result,
                hasAnalysis: !!result.analysis,
                hasCultural: !!result.cultural,
                contextType: result.contextType,
            });

            // Handle the actual data structure returned by context providers
            if (result.analysis) {
                this.core._log('debug', 'Processing result.analysis', {
                    isStructured: result.isStructured,
                    analysisType: typeof result.analysis,
                    contextType: result.contextType,
                    analysisKeys:
                        typeof result.analysis === 'object'
                            ? Object.keys(result.analysis)
                            : null,
                });

                // Check if we have structured JSON data
                if (
                    result.isStructured &&
                    typeof result.analysis === 'object'
                ) {
                    html += this._formatStructuredAnalysis(
                        result.analysis,
                        result.contextType
                    );
                } else {
                    // Single analysis text (fallback for plain text responses)
                    html += `<div class="dualsub-analysis-section">
                        <h4>${this._getContextTypeTitle(result.contextType)} Analysis</h4>
                        <div class="dualsub-analysis-text">${this._formatAnalysisText(result.analysis)}</div>
                    </div>`;
                }
            } else {
                // Separate context types (legacy structure)
                if (result.cultural) {
                    html += `<div class="dualsub-analysis-section">
                        <h4>${this._getLocalizedSectionHeader('aiContextCultural')}</h4>
                        <div class="dualsub-analysis-text">${this._formatAnalysisText(result.cultural)}</div>
                    </div>`;
                }

                if (result.historical) {
                    html += `<div class="dualsub-analysis-section">
                        <h4>${this._getLocalizedSectionHeader('aiContextHistorical')}</h4>
                        <div class="dualsub-analysis-text">${this._formatAnalysisText(result.historical)}</div>
                    </div>`;
                }

                if (result.linguistic) {
                    html += `<div class="dualsub-analysis-section">
                        <h4>${this._getLocalizedSectionHeader('aiContextLinguistic')}</h4>
                        <div class="dualsub-analysis-text">${this._formatAnalysisText(result.linguistic)}</div>
                    </div>`;
                }
            }

            if (html) {
                // Only use the dedicated results pipeline (EXACT legacy behavior)
                this._handleAnalysisComplete(html);
                // Ensure state reflects display to avoid flashes
                this.core.setState(MODAL_STATES.DISPLAY);
                // Hide processing visuals and sticky flags
                try {
                    const processingEl =
                        this.core.contentElement?.querySelector(
                            '#dualsub-processing-state'
                        ) ||
                        document.getElementById('dualsub-processing-state');
                    if (processingEl) processingEl.style.display = 'none';
                    this.core.contentElement?.classList.remove(
                        'dualsub-processing-sticky',
                        'dualsub-processing-active'
                    );
                    if (this.core.element) {
                        this.core.element.classList.remove(
                            'dualsub-processing-disabled'
                        );
                    }
                } catch (_) {}
                this.core._log(
                    'info',
                    'Analysis results displayed successfully',
                    {
                        resultLength: result.analysis?.length || 0,
                        contextType: result.contextType,
                    }
                );
                // Give layout a moment to settle and then recalc height in case content changed size
                setTimeout(() => {
                    if (
                        this.animations &&
                        typeof this.animations._applyDynamicModalHeight ===
                            'function'
                    ) {
                        this.animations._applyDynamicModalHeight();
                    } else {
                        this.core._log(
                            'warn',
                            'Animations module not available for height recalculation'
                        );
                    }
                }, 50);
            } else {
                this.core._log('warn', 'No analysis content to display', {
                    result,
                });
                const noContentTitle =
                    this._getLocalizedMessage('aiContextNoContent');
                const noContentMessage = this._getLocalizedMessage(
                    'aiContextNoContentMessage'
                );
                const noContentHtml = `
                    <div class="dualsub-error">
                        <h4>${noContentTitle}</h4>
                        <p>${noContentMessage}</p>
                    </div>
                `;
                this._handleAnalysisComplete(noContentHtml);
            }
        } else if (shouldRetry) {
            this._handleInvalidAnalysisResponse(
                requestId,
                result,
                error || 'Invalid analysis result'
            );
        } else {
            // Display error (EXACT legacy behavior)
            this.core._log('error', 'Analysis failed', {
                success,
                error,
                hasResult: !!result,
                result,
                errorType: typeof error,
                errorMessage: error?.message || error,
            });

            const errorMessage =
                error?.message || error || 'An error occurred during analysis';
            const errorTitle = this._getLocalizedMessage(
                'aiContextAnalysisFailed'
            );
            const errorHtml = `
                <div class="dualsub-error">
                    <h4>${errorTitle}</h4>
                    <p>${errorMessage}</p>
                    <details open>
                        <summary>Debug Information</summary>
                        <pre>Success: ${success}
Has Result: ${!!result}
Error Type: ${typeof error}
Error: ${JSON.stringify(error, null, 2)}
Result: ${result ? JSON.stringify(result, null, 2) : 'null'}</pre>
                    </details>
                </div>
            `;

            // Only use the dedicated results pipeline (EXACT legacy behavior)
            this._handleAnalysisComplete(errorHtml);
        }
    }

    /**
     * Handle analysis complete (EXACT legacy behavior)
     * @param {string} html - Analysis HTML content
     * @private
     */
    _handleAnalysisComplete(html) {
        this.ui.showAnalysisResults(html);
    }

    /**
     * Format structured JSON analysis for display (EXACT legacy behavior)
     * @param {Object} analysis - Structured analysis object
     * @param {string} contextType - Type of context analysis
     * @returns {string} Formatted HTML
     * @private
     */
    _formatStructuredAnalysis(analysis, contextType) {
        if (!analysis || typeof analysis !== 'object') return '';

        let html = '';

        // Definition section (always first if present) - EXACT legacy behavior
        if (analysis.definition) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextDefinition')}</h4>
                <div class="dualsub-analysis-text">
                    <p><strong>${analysis.definition}</strong></p>
                </div>
            </div>`;
        }

        // Context-specific sections based on contextType (EXACT legacy behavior)
        if (contextType === 'cultural' || contextType === 'all') {
            html += this._formatCulturalSection(analysis);
        }

        if (contextType === 'historical' || contextType === 'all') {
            html += this._formatHistoricalSection(analysis);
        }

        if (contextType === 'linguistic' || contextType === 'all') {
            html += this._formatLinguisticSection(analysis);
        }

        // Common sections (EXACT legacy behavior)
        html += this._formatUsageSection(analysis);
        html += this._formatLearningSection(analysis);

        // Fallback for unstructured content
        if (!html) {
            html = `<div class="dualsub-analysis-section">
                <h4>${this._getContextTypeTitle(contextType)} Analysis</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(analysis)}</div>
            </div>`;
        }

        return html;
    }

    /**
     * Format analysis text for display with Markdown support (Issue #4: LLM Response Parsing Enhancement)
     * @param {string} text - Analysis text (potentially with Markdown)
     * @returns {string} Formatted HTML
     * @private
     */
    _formatAnalysisText(text) {
        if (!text) return '';

        // Use Markdown parser for enhanced formatting
        const markdownHtml = this._parseMarkdownToHtml(text);

        // If Markdown parsing produced meaningful HTML, use it
        if (
            markdownHtml &&
            markdownHtml !== text &&
            markdownHtml.includes('<')
        ) {
            this.core._log('debug', 'Using Markdown-formatted analysis text', {
                originalLength: text.length,
                formattedLength: markdownHtml.length,
                hasMarkdownElements: true,
            });
            return markdownHtml;
        }

        // Fallback to legacy formatting for plain text
        this.core._log(
            'debug',
            'Using legacy text formatting (no Markdown detected)',
            {
                originalLength: text.length,
            }
        );
        return text
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>');
    }

    /**
     * Get context type title for display (EXACT legacy behavior)
     * @param {string} contextType - Context type
     * @returns {string} Display title
     * @private
     */
    _getContextTypeTitle(contextType) {
        switch (contextType) {
            case 'cultural':
                return this._getLocalizedContextType('cultural');
            case 'historical':
                return this._getLocalizedContextType('historical');
            case 'linguistic':
                return this._getLocalizedContextType('linguistic');
            case 'all':
                return this._getLocalizedContextType('comprehensive');
            default:
                return 'Context';
        }
    }

    /**
     * Format object content for display (EXACT legacy behavior)
     * @param {Object|string} content - Content to format
     * @returns {string} Formatted HTML
     * @private
     */
    _formatObjectContent(content) {
        if (typeof content === 'string') {
            return this._formatAnalysisText(content);
        }

        if (typeof content === 'object' && content !== null) {
            let html = '';
            for (const [key, value] of Object.entries(content)) {
                if (typeof value === 'string' && value.trim()) {
                    // Use localized field name
                    const formattedKey = this._getLocalizedFieldName(key);
                    html += `<div class="dualsub-analysis-subsection">
                        <strong>${formattedKey}</strong> ${this._formatAnalysisText(value)}
                    </div>`;
                }
            }
            return (
                html ||
                this._formatAnalysisText(JSON.stringify(content, null, 2))
            );
        }

        return '';
    }

    /**
     * Format cultural analysis section (EXACT legacy behavior)
     * @param {Object} analysis - Analysis object
     * @returns {string} Formatted HTML
     * @private
     */
    _formatCulturalSection(analysis) {
        let html = '';

        if (analysis.cultural_context || analysis.cultural_analysis) {
            const cultural =
                analysis.cultural_context || analysis.cultural_analysis;
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextCultural')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(cultural)}</div>
            </div>`;
        }

        if (analysis.cultural_significance) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextCulturalSignificance')}</h4>
                <div class="dualsub-analysis-text">
                    <p>${analysis.cultural_significance}</p>
                </div>
            </div>`;
        }

        return html;
    }

    /**
     * Format historical analysis section (EXACT legacy behavior)
     * @param {Object} analysis - Analysis object
     * @returns {string} Formatted HTML
     * @private
     */
    _formatHistoricalSection(analysis) {
        let html = '';

        if (analysis.historical_context || analysis.historical_analysis) {
            const historical =
                analysis.historical_context || analysis.historical_analysis;
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextHistorical')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(historical)}</div>
            </div>`;
        }

        if (analysis.historical_significance) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextHistoricalSignificance')}</h4>
                <div class="dualsub-analysis-text">
                    <p>${analysis.historical_significance}</p>
                </div>
            </div>`;
        }

        return html;
    }

    /**
     * Format linguistic analysis section (EXACT legacy behavior)
     * @param {Object} analysis - Analysis object
     * @returns {string} Formatted HTML
     * @private
     */
    _formatLinguisticSection(analysis) {
        let html = '';

        if (analysis.etymology || analysis.linguistic_analysis) {
            const linguistic =
                analysis.etymology || analysis.linguistic_analysis;
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextLinguistic')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(linguistic)}</div>
            </div>`;
        }

        if (analysis.grammar || analysis.semantics) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextGrammar')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(analysis.grammar || analysis.semantics)}</div>
            </div>`;
        }

        return html;
    }

    /**
     * Format usage section (EXACT legacy behavior)
     * @param {Object} analysis - Analysis object
     * @returns {string} Formatted HTML
     * @private
     */
    _formatUsageSection(analysis) {
        let html = '';

        if (analysis.usage || analysis.examples) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextUsage')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(analysis.usage || analysis.examples)}</div>
            </div>`;
        }

        return html;
    }

    /**
     * Format learning section (EXACT legacy behavior)
     * @param {Object} analysis - Analysis object
     * @returns {string} Formatted HTML
     * @private
     */
    _formatLearningSection(analysis) {
        let html = '';

        if (analysis.learning_tips || analysis.tips) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextLearningTips')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(analysis.learning_tips || analysis.tips)}</div>
            </div>`;
        }

        return html;
    }

    /**
     * Get localized section header using DualSub's config-based localization system (Fixed internationalization)
     * @param {string} key - Localization key
     * @returns {string} Localized header
     * @private
     */
    _getLocalizedSectionHeader(key) {
        // Use the UI module's translation system for consistency
        return this.ui._getLocalizedMessage(key);
    }

    /**
     * Get localized message using DualSub's config-based localization system (Fixed internationalization)
     * @param {string} key - Message key
     * @returns {string} Localized message
     * @private
     */
    _getLocalizedMessage(key) {
        // Use the UI module's translation system for consistency
        return this.ui._getLocalizedMessage(key);
    }

    /**
     * Parse and render Markdown text to HTML (Issue #3 & #4: Cross-language compatible formatting)
     * @param {string} text - Markdown text to parse
     * @returns {string} HTML formatted text
     * @private
     */
    _parseMarkdownToHtml(text) {
        if (!text || typeof text !== 'string') return '';
        let html = text;
        html = html.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
        html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
        html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '$1');
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');
        html = html.replace(/^\* (.*$)/gm, '<li>$1</li>');
        html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
        html = html.replace(/^(\d+)\. (.*$)/gm, '<li>$1. $2</li>');
        html = html.replace(/(<li>.*<\/li>)/gs, (match) => {
            if (match.includes('<li>1.') || /\d+\./.test(match))
                return `<ol>${match}</ol>`;
            return `<ul>${match}</ul>`;
        });
        html = html.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');
        if (!html.startsWith('<') && html.trim()) html = `<p>${html}</p>`;
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p>(<h[1-6]>.*<\/h[1-6]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>.*<\/ul>)<\/p>/gs, '$1');
        html = html.replace(/<p>(<ol>.*<\/ol>)<\/p>/gs, '$1');
        html = html.replace(/<p>(<blockquote>.*<\/blockquote>)<\/p>/g, '$1');

        // Sanitize: strip scripts and inline event handlers
        html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
        html = html.replace(/\son\w+="[^"]*"/gi, '');
        html = html.replace(/\sjavascript:/gi, '');
        return html;
    }

    /**
     * Get localized context type (EXACT legacy behavior)
     * @param {string} type - Context type
     * @returns {string} Localized type
     * @private
     */
    _getLocalizedContextType(type) {
        try {
            const keyMap = {
                cultural: 'aiContextTypeCultural',
                historical: 'aiContextTypeHistorical',
                linguistic: 'aiContextTypeLinguistic',
                comprehensive: 'aiContextTypeComprehensive',
                generic: 'aiContextTypeGeneric',
            };
            const key = keyMap[type] || keyMap.generic;
            return this._getLocalizedMessage(key) || type;
        } catch (_) {
            return type;
        }
    }

    /**
     * Get localized field name for analysis sections
     * @param {string} fieldName - Field name to localize
     * @returns {string} Localized field name
     * @private
     */
    _getLocalizedFieldName(fieldName) {
        // Normalize field name for mapping
        const normalizedField = fieldName
            .toLowerCase()
            .replace(/[_\s]+/g, '')
            .replace(/&/g, '');

        // Map common field names to localization keys
        const fieldMappings = {
            culturalcontext: 'aiContextCulturalContext',
            cultural: 'aiContextCulturalContext',
            socialusage: 'aiContextSocialUsage',
            social: 'aiContextSocialUsage',
            regionalnotes: 'aiContextRegionalNotes',
            regional: 'aiContextRegionalNotes',
            origins: 'aiContextOrigins',
            origin: 'aiContextOrigins',
            historicalcontext: 'aiContextHistoricalContext',
            historical: 'aiContextHistoricalContext',
            historicalsignificance: 'aiContextHistoricalSignificance',
            evolution: 'aiContextEvolution',
            linguisticanalysis: 'aiContextLinguisticAnalysis',
            linguistic: 'aiContextLinguisticAnalysis',
            etymology: 'aiContextEtymology',
            grammarsemantics: 'aiContextGrammarSemantics',
            grammar: 'aiContextGrammarSemantics',
            grammarnotes: 'aiContextGrammarNotes',
            semantics: 'aiContextGrammarSemantics',
            translationnotes: 'aiContextTranslationNotes',
            usageexamples: 'aiContextUsageExamples',
            usage: 'aiContextUsageExamples',
            examples: 'aiContextUsageExamples',
            learningtips: 'aiContextLearningTips',
            learning: 'aiContextLearningTips',
            tips: 'aiContextLearningTips',
            relatedexpressions: 'aiContextRelatedExpressions',
            related: 'aiContextRelatedExpressions',
            expressions: 'aiContextRelatedExpressions',
            keyinsights: 'aiContextKeyInsights',
            insights: 'aiContextKeyInsights',
            key: 'aiContextKeyInsights',
        };

        const messageKey = fieldMappings[normalizedField];
        if (messageKey) {
            const localizedMessage = this._getLocalizedMessage(messageKey);
            if (localizedMessage) {
                return localizedMessage;
            }
        }

        // Fallback: capitalize first letter and add colon
        return (
            fieldName.charAt(0).toUpperCase() +
            fieldName.slice(1).replace(/_/g, ' ') +
            ':'
        );
    }

    /**
     * Disable word interactions during processing (EXACT legacy behavior)
     * @private
     */
    _disableWordInteractions() {
        // Add processing class to content element to disable interactions within modal scope
        try {
            this.core.contentElement?.classList.add(
                'dualsub-processing-active'
            );
        } catch (_) {}

        // Disable word removal during processing (Issue #4)
        this._disableWordRemoval();

        // Extra safety: forcibly hide remove buttons on chips even if CSS hasn't loaded yet
        try {
            const selectedWordsElement = document.getElementById(
                'dualsub-selected-words'
            );
            if (selectedWordsElement) {
                selectedWordsElement
                    .querySelectorAll('.dualsub-word-remove')
                    .forEach((el) => {
                        el.style.display = 'none';
                    });
            }
        } catch (_) {}

        // Hard-disable pointer events on original subtitle container (outside modal DOM)
        try {
            const original = document.getElementById(
                'dualsub-original-subtitle'
            );
            if (original) {
                original.style.pointerEvents = 'none';
                // Also add a disabled class for consistent visual styling during processing
                original.classList.add('dualsub-subtitles-disabled');
            }
        } catch (_) {}

        // Ensure visual highlights remain applied while processing
        try {
            this._syncWordSelectionVisuals();
        } catch (_) {}

        // Update selection display to show disabled state
        this.ui.updateSelectionDisplay();
    }

    /**
     * Re-enable word interactions (EXACT legacy behavior)
     * @private
     */
    _enableWordInteractions() {
        // Remove processing class from content element
        try {
            this.core.contentElement?.classList.remove(
                'dualsub-processing-active'
            );
        } catch (_) {}

        // Re-enable word removal after processing (Issue #4)
        this._enableWordRemoval();

        // Extra safety: forcibly re-show remove buttons on chips after processing
        try {
            const selectedWordsElement = document.getElementById(
                'dualsub-selected-words'
            );
            if (selectedWordsElement) {
                selectedWordsElement
                    .querySelectorAll('.dualsub-word-remove')
                    .forEach((el) => {
                        el.style.removeProperty('display');
                    });
            }
        } catch (_) {}

        // Re-enable pointer events on original subtitle container
        try {
            const original = document.getElementById(
                'dualsub-original-subtitle'
            );
            if (original) {
                original.style.removeProperty('pointer-events');
                original.classList.remove('dualsub-subtitles-disabled');
            }
        } catch (_) {}

        // Update selection display to show enabled state
        this.ui.updateSelectionDisplay();
    }

    /**
     * Reset analysis button to start state (EXACT legacy behavior)
     * @private
     */
    _resetAnalysisButton() {
        const analysisButton = document.getElementById(
            'dualsub-start-analysis'
        );
        if (analysisButton) {
            analysisButton.textContent = this._getLocalizedMessage(
                'aiContextStartAnalysis'
            );
            analysisButton.className = 'dualsub-analysis-button';
            analysisButton.title = this._getLocalizedMessage(
                'aiContextStartAnalysis'
            );
            analysisButton.disabled = this.core.selectedWords.size === 0;
            analysisButton.removeAttribute('data-paused-toggle');

            // Remove pause handler and restore start analysis handler
            const newButton = analysisButton.cloneNode(true);
            analysisButton.parentNode.replaceChild(newButton, analysisButton);

            // Clean up pause handler from boundHandlers
            if (this.boundHandlers.has('pause-analysis-active')) {
                this.boundHandlers.delete('pause-analysis-active');
            }

            const startHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this.modalController) this.modalController.startAnalysis();
                else this._handleStartAnalysis();
            };
            newButton.addEventListener('click', startHandler);

            // Update boundHandlers to point to the new button element
            this.boundHandlers.set('start-analysis', {
                element: newButton,
                handler: startHandler,
            });
        }
    }

    /**
     * Disable word removal during processing (EXACT legacy behavior)
     * @private
     */
    _disableWordRemoval() {
        const selectedWordsElement = document.getElementById(
            'dualsub-selected-words'
        );
        if (selectedWordsElement) {
            // Add disabled styling to the selected words container (Issue #4)
            selectedWordsElement.classList.add('dualsub-processing-disabled');

            // Create global click blocker to prevent any clicks during processing
            const globalClickBlocker = (e) => {
                // Allow interactions when not analyzing anymore
                if (!this.core.isAnalyzing) {
                    return; // do not block
                }
                e.stopPropagation();
                e.preventDefault();
                this.core._log(
                    'debug',
                    'Word removal blocked during processing via global click blocker'
                );
            };

            // Store the blocker for later removal
            selectedWordsElement._globalClickBlocker = globalClickBlocker;

            // Add the blocker in capture phase to intercept before other handlers
            selectedWordsElement.addEventListener(
                'click',
                globalClickBlocker,
                true
            );
        }

        this.core._log(
            'debug',
            'Word removal disabled during processing with global click blocker'
        );
    }

    /**
     * Re-enable word removal after processing (EXACT legacy behavior)
     * @private
     */
    _enableWordRemoval() {
        const selectedWordsElement = document.getElementById(
            'dualsub-selected-words'
        );
        if (selectedWordsElement) {
            // Remove disabled styling from the selected words container (Issue #4)
            selectedWordsElement.classList.remove(
                'dualsub-processing-disabled'
            );

            // Remove the global click blocker
            if (selectedWordsElement._globalClickBlocker) {
                selectedWordsElement.removeEventListener(
                    'click',
                    selectedWordsElement._globalClickBlocker,
                    true
                );
                delete selectedWordsElement._globalClickBlocker;
            }

            // Re-create the word elements with proper handlers by calling updateSelectionDisplay
            // This ensures clean state without any lingering disabled handlers
            this.ui.updateSelectionDisplay();
        }

        this.core._log('debug', 'Word removal re-enabled after processing');
    }

    /**
     * Remove all event listeners
     */
    removeEventListeners() {
        this.core._log('debug', 'Removing event listeners');

        for (const [key, { element, handler }] of this.boundHandlers) {
            try {
                if (element && handler) {
                    // Handle different event types and capture phases
                    if (key === 'global-click') {
                        element.removeEventListener('click', handler, true); // Capture phase
                    } else if (key.includes('click')) {
                        element.removeEventListener('click', handler);
                    } else if (key.includes('keydown')) {
                        element.removeEventListener('keydown', handler);
                    } else if (key.includes('mousedown')) {
                        element.removeEventListener('mousedown', handler);
                    } else {
                        // Fallback for other event types
                        const eventType = key.replace('-', '');
                        element.removeEventListener(eventType, handler);
                    }
                }
            } catch (error) {
                this.core._log('warn', 'Failed to remove event listener', {
                    key,
                    error: error.message,
                });
            }
        }

        this.boundHandlers.clear();
        this.core._log('debug', 'Event listeners removed');
    }

    /**
     * Handle invalid analysis response with retry logic
     * @param {string} requestId - Request ID
     * @param {Object} result - Malformed result
     * @param {string} error - Error description
     * @private
     */
    _handleInvalidAnalysisResponse(requestId, result, error) {
        this.core._log('warn', 'Invalid analysis response detected', {
            requestId,
            error,
            resultPreview: JSON.stringify(result, null, 2).substring(0, 300),
            retryAttempt: this.core.retryState.currentAttempt,
            canRetry: this.core.canRetryAnalysis(),
        });

        // Check if we can retry
        if (this.core.canRetryAnalysis()) {
            this._initiateRetry(requestId, result, error);
        } else {
            this._handleFinalRetryFailure(requestId, result, error);
        }
    }

    /**
     * Initiate retry for invalid analysis response
     * @param {string} requestId - Request ID
     * @param {Object} result - invalid result (unused but kept for consistency)
     * @param {string} error - Error description
     * @private
     */
    _initiateRetry(requestId, result, error) {
        // Prepare retry state
        this.core.prepareRetry(
            {
                requestId,
                selectedText: this.core.selectedText,
                selectedWords: Array.from(this.core.selectedWords),
            },
            error
        );

        // Update UI to show retry state
        this._updateProcessingStateForRetry();

        // Show brief error notification
        this._showRetryNotification();

        // Retry after a brief delay (exponential backoff)
        const retryDelay = Math.min(
            1000 * Math.pow(2, this.core.retryState.currentAttempt - 1),
            5000
        );

        setTimeout(() => {
            this._executeRetry();
        }, retryDelay);
    }

    /**
     * Update processing state to show retry attempt
     * @private
     */
    _updateProcessingStateForRetry() {
        const processingText = document.querySelector(
            '.dualsub-processing-text'
        );
        if (processingText) {
            const retryMessage =
                this._getLocalizedMessage('aiContextRetrying') ||
                `Analysis failed, regenerating... (${this.core.retryState.currentAttempt}/${this.core.retryState.maxRetries})`;
            processingText.textContent = retryMessage;
        }

        this.core._log('info', 'Updated UI for retry attempt', {
            attempt: this.core.retryState.currentAttempt,
            maxRetries: this.core.retryState.maxRetries,
        });
    }

    /**
     * Show brief error notification for retry
     * @private
     */
    _showRetryNotification() {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'dualsub-retry-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff6b6b;
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            font-size: 14px;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideInRight 0.3s ease-out;
        `;

        const retryNotificationText =
            this._getLocalizedMessage('aiContextRetryNotification') ||
            'Analysis failed, retrying...';
        notification.textContent = retryNotificationText;

        // Add animation styles (reuse single style element)
        let style = document.getElementById('dualsub-retry-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'dualsub-retry-style';
            style.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // Remove notification after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation =
                    'slideInRight 0.3s ease-out reverse';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 3000);
    }

    /**
     * Execute the retry analysis
     * @private
     */
    _executeRetry() {
        const originalData = this.core.retryState.originalRequestData;
        if (!originalData) {
            this.core._log('error', 'No original request data for retry');
            return;
        }

        // Reset processing text to analyzing
        const processingText = document.querySelector(
            '.dualsub-processing-text'
        );
        if (processingText) {
            const analyzingMessage =
                this._getLocalizedMessage('aiContextAnalyzing') ||
                'Analyzing...';
            processingText.textContent = analyzingMessage;
        }

        // Dispatch new analysis request
        this._dispatchAnalysisRequest(originalData.selectedText);
    }

    /**
     * Dispatch analysis request for retry
     * @param {string} selectedText - Text to analyze
     * @private
     */
    _dispatchAnalysisRequest(selectedText) {
        const requestId = `ai-context-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        this.core.currentRequest = requestId;

        // Dispatch analysis event
        document.dispatchEvent(
            new CustomEvent('dualsub-analyze-selection', {
                detail: {
                    text: selectedText,
                    requestId: requestId,
                    contextTypes: ['cultural', 'historical', 'linguistic'],
                    language: 'auto',
                    targetLanguage: 'auto',
                },
            })
        );

        this.core._log('info', 'Dispatched retry analysis request', {
            requestId,
            selectedText,
            retryAttempt: this.core.retryState.currentAttempt,
        });
    }

    /**
     * Handle final retry failure when all retries are exhausted
     * @param {string} requestId - Request ID (unused but kept for consistency)
     * @param {Object} result - invalid result
     * @param {string} error - Error description
     * @private
     */
    _handleFinalRetryFailure(requestId, result, error) {
        this.core.isAnalyzing = false;
        this.core._resetRetryState();

        // Re-enable word interactions
        this._enableWordInteractions();

        // Reset analysis button
        this._resetAnalysisButton();

        const errorTitle =
            this._getLocalizedMessage('aiContextAnalysisFailed') ||
            'Analysis Failed';
        const retryButtonText =
            this._getLocalizedMessage('aiContextRetryButton') || 'Try Again';
        const closeButtonText =
            this._getLocalizedMessage('aiContextClose') || 'Close';

        // Get appropriate error message based on error type
        const errorMessage =
            this._getLocalizedMessage('aiContextMalformedResponse') ||
            'The AI service returned an invalid response format. This may be due to temporary service issues.';

        const errorHtml = `
            <div class="dualsub-error">
                <h4>${errorTitle}</h4>
                <p>${errorMessage}</p>
                <div class="dualsub-error-details" style="margin: 15px 0;">
                    <strong>Error:</strong> ${error}<br>
                    <strong>Attempts:</strong> ${this.core.retryState.currentAttempt}/${this.core.retryState.maxRetries}
                </div>
                <div class="dualsub-error-actions" style="margin-top: 15px;">
                    <button class="dualsub-btn dualsub-btn-primary" onclick="document.dispatchEvent(new CustomEvent('dualsub-retry-analysis'))">
                        ${retryButtonText}
                    </button>
                    <button class="dualsub-btn dualsub-btn-secondary" onclick="this.closest('.dualsub-context-modal').style.display='none'" style="margin-left: 10px;">
                        ${closeButtonText}
                    </button>
                </div>
                <details open>
                    <summary>Debug Information</summary>
                    <pre>Error Type: Invalid Analysis Response
Retry Attempts: ${this.core.retryState.currentAttempt}
Last Error: ${error}
Result Preview: ${JSON.stringify(result, null, 2).substring(0, 500)}</pre>
                </details>
            </div>
        `;

        this._handleAnalysisComplete(errorHtml);

        // Add event listener for manual retry
        document.addEventListener(
            'dualsub-retry-analysis',
            () => {
                this.core._resetRetryState();
                if (this.modalController) this.modalController.startAnalysis();
                else this._handleStartAnalysis();
            },
            { once: true }
        );
    }
}
