/**
 * AI Context Modal - Animations Module
 *
 * Animation and transition logic functionality.
 * Handles modal show/hide animations, state transitions, and visual effects.
 *
 * @author DualSub Extension - UI Systems Engineer
 * @version 2.0.0
 */

import { MODAL_STATES, EVENT_TYPES } from '../core/constants.js';
import { Transitions } from './animations/Transitions.js';

/**
 * Modal animation and transition management
 */
export class AIContextModalAnimations {
    constructor(core, ui) {
        this.core = core;
        this.ui = ui;
        this.animationTimeouts = new Map();
        this.heightMonitorInterval = null;
        this.resizeObserver = null;
        this.mutationObserver = null;
    }

    /**
     * Show modal with animation
     * @param {Object} options - Show options
     * @returns {boolean} Success status
     */
    showModal(options = {}) {
        this.core._log('info', 'Showing modal with animation', options);

        if (!this.core.element) {
            this.core._log(
                'error',
                'Modal element not available for animation'
            );
            return false;
        }

        // Clear any existing animation timeouts
        this._clearAnimationTimeouts();

        // Set visible; do NOT force state to SELECTION here to avoid overriding ongoing transitions
        this.core.isVisible = true;
        try { this.core.store.setVisibility(true); } catch (_) {}
        // Only move to SELECTION if we're fully hidden and not already processing/displaying
        const isBusy = this.core.isAnalyzing || this.core.state === MODAL_STATES.PROCESSING || this.core.state === MODAL_STATES.DISPLAY || this.core.state === MODAL_STATES.ERROR;
        if (this.core.state === MODAL_STATES.HIDDEN && !isBusy) {
            this.core.setState(MODAL_STATES.SELECTION);
        }

        // Start selection persistence monitoring
        if (this.core.selectionPersistenceManager) {
            this.core.selectionPersistenceManager.startMonitoring();
        }

        // Apply dynamic modal height
        this._applyDynamicModalHeight();

        // Setup monitoring for subtitle position changes
        this._setupDynamicHeightMonitoring();

        // Apply height again after a short delay to ensure layout is settled
        setTimeout(() => {
            this._applyDynamicModalHeight();
        }, 50);

        // Show modal element via transitions utility (class-only)
        Transitions.showContainer(this.core.element);
        // Avoid inline style display toggles; CSS state classes should drive visibility

        // Show modal overlay in UI root container
        if (this.core.overlayElement) {
            Transitions.showOverlay(this.core.overlayElement);
            this.core._log('debug', 'Modal overlay shown', {
                overlayParent: this.core.overlayElement.parentElement?.id,
            });
        }

        // Also show modal content if it's in UI root container (class-only)
        if (this.core.contentElement) {
            Transitions.showContent(this.core.contentElement);
            this.core._log('debug', 'Modal content shown', {
                contentParent: this.core.contentElement.parentElement?.id,
            });

            // Ensure selection chips are rendered after modal is visible
            try {
                // Always refresh selection display once visible to reflect current state, including empty selection (for auto-close logic in events)
                this.ui.updateSelectionDisplay();
                if (this.core.selectedWords && this.core.selectedWords.size > 0) {
                    setTimeout(() => { this.ui.updateSelectionDisplay(); }, 0);
                }
            } catch (_) {}
        }

        // Extra safety: if a stale overlay/content remained somehow, unlink it
        try {
            const overlayId = this.core.overlayElement?.id || 'dualsub-modal-overlay';
            const contentId = this.core.contentElement?.id || 'dualsub-modal-content';
            const duplicates = document.querySelectorAll(`#${overlayId}, #${contentId}`);
            if (duplicates.length > 2) {
                duplicates.forEach((node) => {
                    if (
                        node !== this.core.overlayElement &&
                        node !== this.core.contentElement &&
                        node.parentElement
                    ) {
                        node.parentElement.removeChild(node);
                    }
                });
            }
        } catch (_) {}

        // Dispatch show event
        this.core._dispatchEvent(EVENT_TYPES.MODAL_SHOW, {
            mode: 'selection',
            options,
        });

        return true;
    }

    /**
     * Hide modal with animation
     */
    hideModal() {
        this.core._log('info', 'Hiding modal with animation');

        if (!this.core.isVisible || !this.core.element) {
            return;
        }

        // Clear any existing animation timeouts
        this._clearAnimationTimeouts();

        // Stop height monitoring
        this._stopDynamicHeightMonitoring();

        // Stop selection persistence monitoring
        if (this.core.selectionPersistenceManager) {
            this.core.selectionPersistenceManager.stopMonitoring();
        }

        // Hide modal element
        if (this.core.element) {
            Transitions.hideContainer(this.core.element);
        }

        // Hide modal overlay in UI root container
        if (this.core.overlayElement) {
            Transitions.hideOverlay(this.core.overlayElement);
            this.core._log('debug', 'Modal overlay hidden', {
                overlayParent: this.core.overlayElement.parentElement?.id,
            });
        }

        // Also hide modal content if it's in UI root container
        if (this.core.contentElement) {
            Transitions.hideContent(this.core.contentElement);
            this.core._log('debug', 'Modal content hidden', {
                contentParent: this.core.contentElement.parentElement?.id,
            });
        }

        this.core.isVisible = false;
        try { this.core.store.setVisibility(false); } catch (_) {}
        this.core.setState(MODAL_STATES.HIDDEN);

        // Also clear visual selections on subtitles when modal hides
        try {
            const original = document.getElementById('dualsub-original-subtitle');
            if (original) {
                original.querySelectorAll('.dualsub-interactive-word.dualsub-word-selected')
                    .forEach((el) => el.classList.remove('dualsub-word-selected'));
            }
        } catch (_) {}

        // Reset state
        this._resetModalState();

        // Dispatch hide event
        this.core._dispatchEvent(EVENT_TYPES.MODAL_HIDE, {
            mode: this.core.currentMode,
        });
    }

    /**
     * Transition to processing state with animation
     */
    showProcessingState() {
        this.core._log('debug', 'Transitioning to processing state');

        this.core.currentMode = 'processing';
        // Sticky processing state: prevent any intermediate selection re-render from overriding
        if (this.core.state !== MODAL_STATES.PROCESSING) {
            this.core.setState(MODAL_STATES.PROCESSING);
        }

        // Add processing disabled class to prevent interactions
        if (this.core.element) {
            this.core.element.classList.add('dualsub-processing-disabled');
        }
        // Also mark original subtitles as disabled for consistent UX
        try {
            const original = document.getElementById('dualsub-original-subtitle');
            if (original) original.classList.add('dualsub-subtitles-disabled');
        } catch (_) {}

        // Update UI state (hide initial, show processing) via UI module
        this.ui.showProcessingState();
        // Force analyzing class to avoid flicker back to selection from late renders
        try {
            const content = this.core.contentElement || document.getElementById('dualsub-modal-content');
            content?.classList.add('is-analyzing');
        } catch (_) {}
        // Avoid inline display toggles; state classes drive visibility
        // Apply processing-sticky class to prevent CSS transitions flipping back
        try {
            this.core.contentElement?.classList.add('dualsub-processing-active');
        } catch (_) {}

        // Apply dynamic height
        this._applyDynamicModalHeight();

        // Animate processing button
        this._animateProcessingButton();

        // Ensure loader animations are running by forcing a reflow and toggling animation
        const processing =
            this.core.contentElement?.querySelector(
                '#dualsub-processing-state'
            ) || document.getElementById('dualsub-processing-state');
        if (processing) {
            const squares = processing.querySelectorAll('.loader-square');
            squares.forEach((sq) => {
                const prev = sq.style.animation;
                sq.style.animation = 'none';
                // trigger reflow
                // eslint-disable-next-line no-unused-expressions
                sq.offsetHeight;
                sq.style.animation = prev || '';
            });
            // Ensure processing section wins by temporarily adding a guard class
            this.core.contentElement?.classList.add('dualsub-processing-sticky');
            setTimeout(() => {
                this.core.contentElement?.classList.remove('dualsub-processing-sticky');
            }, 150);
        }
    }

    /**
     * Transition to results state with animation
     * @param {Object} analysisResult - Analysis result data
     */
    showResultsState(analysisResult) {
        this.core._log('debug', 'Transitioning to results state');

        this.core.currentMode = 'display';
        this.core.setState(MODAL_STATES.DISPLAY);

        // Remove processing disabled class
        if (this.core.element) {
            this.core.element.classList.remove('dualsub-processing-disabled');
        }
        // Remove subtitles disabled indicator
        try {
            const original = document.getElementById('dualsub-original-subtitle');
            if (original) original.classList.remove('dualsub-subtitles-disabled');
        } catch (_) {}

        // Update UI state
        this.ui.showAnalysisResults(analysisResult);
        // Avoid forcing inline display toggles; rely on state classes
        this.core.contentElement?.classList.remove('dualsub-processing-sticky', 'dualsub-processing-active');
        if (this.core.element) this.core.element.classList.remove('dualsub-processing-disabled');

        // Apply dynamic height
        this._applyDynamicModalHeight();

        // Animate content transition
        this._animateContentTransition();
    }

    /**
     * Transition to error state with animation
     * @param {string} error - Error message
     * @param {Object} metadata - Error metadata
     */
    showErrorState(error, metadata = {}) {
        this.core._log('debug', 'Transitioning to error state');

        this.core.currentMode = 'error';
        this.core.setState(MODAL_STATES.ERROR);

        // Remove processing disabled class
        if (this.core.element) {
            this.core.element.classList.remove('dualsub-processing-disabled');
        }
        try {
            const original = document.getElementById('dualsub-original-subtitle');
            if (original) original.classList.remove('dualsub-subtitles-disabled');
        } catch (_) {}

        // Update UI state
        this.ui.showErrorState(error, metadata);

        // Apply dynamic height
        this._applyDynamicModalHeight();

        // Animate error appearance
        this._animateErrorState();
    }

    /**
     * Reset to selection state with animation
     */
    resetToSelectionState() {
        this.core._log('debug', 'Resetting to selection state');

        this.core.currentMode = 'selection';
        this.core.setState(MODAL_STATES.SELECTION);

        // Remove processing disabled class
        if (this.core.element) {
            this.core.element.classList.remove('dualsub-processing-disabled');
        }
        try {
            const original = document.getElementById('dualsub-original-subtitle');
            if (original) original.classList.remove('dualsub-subtitles-disabled');
        } catch (_) {}

        // Update UI state
        this.ui.showInitialState();

        // Apply dynamic height
        this._applyDynamicModalHeight();
    }

    /**
     * Apply dynamic modal height based on subtitle position
     * Uses comprehensive subtitle detection logic from legacy implementation
     * @private
     */
    _applyDynamicModalHeight() {
        if (!this.core.element) return;

        try {
            // Get modal content from UI root container (new architecture)
            const modalContent = this.core.contentElement;
            if (!modalContent) {
                this.core._log(
                    'warn',
                    'Modal content element not found for height adjustment'
                );
                return;
            }

            const heightData = this._calculateOptimalModalHeight();

            // Apply calculated height (matches legacy behavior exactly)
            modalContent.style.setProperty(
                'height',
                `${heightData.height}px`,
                'important'
            );
            modalContent.style.setProperty(
                'max-height',
                `${heightData.height}px`,
                'important'
            );

            // Set modal body height after a small delay to ensure header is rendered
            setTimeout(() => {
                const modalBody = modalContent.querySelector(
                    '.dualsub-modal-body'
                );
                if (modalBody) {
                    const modalHeader = modalContent.querySelector(
                        '.dualsub-modal-header'
                    );
                    const headerHeight = modalHeader
                        ? modalHeader.offsetHeight
                        : 60; // Fallback to 60px
                    const bodyHeight = heightData.height - headerHeight;

                    modalBody.style.setProperty(
                        'height',
                        `${bodyHeight}px`,
                        'important'
                    );
                    modalBody.style.setProperty(
                        'max-height',
                        `${bodyHeight}px`,
                        'important'
                    );

                    // this.core._log('debug', 'Modal body height explicitly set', {
                    //     totalHeight: heightData.height,
                    //     headerHeight: headerHeight,
                    //     bodyHeight: bodyHeight,
                    //     modalBodyOffsetHeight: modalBody.offsetHeight
                    // });
                }
            }, 10);

            // this.core._log('debug', 'Dynamic height applied', {
            //     height: heightData.height,
            //     heightVh: heightData.heightVh,
            //     subtitleTop: heightData.subtitleTop,
            //     hasSubtitles: heightData.hasSubtitles,
            //     modalContentPosition: modalContent.style.position,
            //     modalContentParent: modalContent.parentElement?.id,
            //     modalContentActualHeight: modalContent.offsetHeight,
            //     modalContentStyleHeight: modalContent.style.height,
            //     modalContentStyleMaxHeight: modalContent.style.maxHeight
            // });
        } catch (error) {
            this.core._log('warn', 'Failed to apply dynamic height', {
                error: error.message,
            });
        }
    }

    /**
     * Calculate optimal modal height based on subtitle position
     * Replicates legacy contextAnalysisModal.js logic exactly
     * @returns {Object} Height calculation results
     * @private
     */
    _calculateOptimalModalHeight() {
        try {
            let highestSubtitleTop = null;
            let subtitleHeight = 0;
            let detectionResults = {
                dualsubFound: false,
                platformFound: false,
                usedSelectors: [],
                foundElements: [],
            };

            // Comprehensive subtitle selectors (from legacy implementation)
            const SUBTITLE_SELECTORS = {
                // DualSub selectors (priority - check these first)
                dualsub: [
                    // Universal DualSub subtitle container IDs (primary)
                    '#dualsub-original-subtitle',
                    '#dualsub-translated-subtitle',
                    '#dualsub-subtitle-container',
                    // Legacy platform-specific IDs (backward compatibility)
                    '#disneyplus-original-subtitle',
                    '#disneyplus-translated-subtitle',
                    '#netflix-original-subtitle',
                    '#netflix-translated-subtitle',
                    // Generic DualSub selectors
                    '#dualsub-original-container',
                    '#dualsub-translated-container',
                    '.dualsub-subtitle-container',
                    '.dualsub-original-subtitle',
                    '.dualsub-translated-subtitle',
                    // Inner text elements (universal first, then legacy)
                    '#dualsub-original-subtitle span',
                    '#dualsub-translated-subtitle span',
                    '#disneyplus-original-subtitle span',
                    '#disneyplus-translated-subtitle span',
                    '#netflix-original-subtitle span',
                    '#netflix-translated-subtitle span',
                    '.dualsub-subtitle-container span',
                    '.dualsub-original-subtitle span',
                    '.dualsub-translated-subtitle span',
                    // Interactive word spans
                    '.dualsub-interactive-word',
                ],
                // Platform selectors (fallback only if no DualSub subtitles found)
                platform: [
                    // Netflix selectors
                    '.player-timedtext-text-container',
                    '.player-timedtext',
                    '[data-uia="player-timedtext-text-container"]',
                    '.ltr-1eknfpy',
                    '.player-timedtext-container',
                    '.timedtext-container',
                    '.player-timedtext-text-container span',
                    '.player-timedtext span',
                    // Disney+ selectors
                    '.dss-subtitle-renderer',
                    '.subtitle-container',
                    '[data-testid="subtitle-container"]',
                    '.subtitle-renderer',
                    '.dss-subtitle-text',
                    '.dss-subtitle-renderer span',
                    '.subtitle-container span',
                    // Generic selectors
                    '.subtitle',
                    '.subtitles',
                    '.caption',
                    '.captions',
                    '.subtitle span',
                    '.subtitles span',
                ],
            };

            // First, try to find DualSub subtitle elements (priority)
            SUBTITLE_SELECTORS.dualsub.forEach((selector) => {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    detectionResults.usedSelectors.push(selector);

                    elements.forEach((element) => {
                        if (
                            element.offsetWidth > 0 &&
                            element.offsetHeight > 0
                        ) {
                            const rect = element.getBoundingClientRect();
                            if (
                                highestSubtitleTop === null ||
                                rect.top < highestSubtitleTop
                            ) {
                                highestSubtitleTop = rect.top;
                                subtitleHeight = Math.max(
                                    subtitleHeight,
                                    rect.height
                                );
                            }

                            detectionResults.dualsubFound = true;
                            detectionResults.foundElements.push({
                                selector: selector,
                                element: element.tagName,
                                classes: element.className,
                                id: element.id,
                                top: rect.top,
                                height: rect.height,
                            });
                        }
                    });
                }
            });

            // If no DualSub subtitles found, try platform subtitles
            if (!detectionResults.dualsubFound) {
                SUBTITLE_SELECTORS.platform.forEach((selector) => {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        detectionResults.usedSelectors.push(selector);

                        elements.forEach((element) => {
                            if (
                                element.offsetWidth > 0 &&
                                element.offsetHeight > 0
                            ) {
                                const rect = element.getBoundingClientRect();
                                if (
                                    highestSubtitleTop === null ||
                                    rect.top < highestSubtitleTop
                                ) {
                                    highestSubtitleTop = rect.top;
                                    subtitleHeight = Math.max(
                                        subtitleHeight,
                                        rect.height
                                    );
                                }

                                detectionResults.platformFound = true;
                                detectionResults.foundElements.push({
                                    selector: selector,
                                    element: element.tagName,
                                    classes: element.className,
                                    id: element.id,
                                    top: rect.top,
                                    height: rect.height,
                                });
                            }
                        });
                    }
                });
            }

            // Calculate available space (matches legacy logic exactly)
            const viewportHeight = window.innerHeight;
            const modalTop = viewportHeight * 0.02; // 2vh
            const desiredGap = 15; // 15px gap
            const minModalHeight = 300; // Minimum usable height
            const maxModalHeight = viewportHeight * 0.85; // Maximum 85% of viewport

            let availableHeight;

            if (highestSubtitleTop !== null) {
                // Calculate space from modal top to subtitle top minus gap
                availableHeight = highestSubtitleTop - modalTop - desiredGap;
            } else {
                // No subtitles found, use default height
                availableHeight = viewportHeight * 0.7; // 70vh fallback
            }

            // Ensure height is within reasonable bounds
            const optimalHeight = Math.max(
                minModalHeight,
                Math.min(availableHeight, maxModalHeight)
            );

            return {
                height: optimalHeight,
                heightVh: (optimalHeight / viewportHeight) * 100,
                subtitleTop: highestSubtitleTop,
                hasSubtitles: highestSubtitleTop !== null,
                detectionResults: detectionResults,
            };
        } catch (error) {
            this.core._log(
                'error',
                'Failed to calculate optimal modal height',
                {
                    error: error.message,
                }
            );

            // Return fallback values
            return {
                height: window.innerHeight * 0.7,
                heightVh: 70,
                subtitleTop: null,
                hasSubtitles: false,
            };
        }
    }

    /**
     * Setup dynamic height monitoring using ResizeObserver and MutationObserver
     * Replicates legacy implementation for real-time subtitle position tracking
     * @private
     */
    _setupDynamicHeightMonitoring() {
        this._stopDynamicHeightMonitoring();

        try {
            // Setup ResizeObserver for window resize events
            if (window.ResizeObserver) {
                this.resizeObserver = new ResizeObserver(() => {
                    this._applyDynamicModalHeight();
                });
                this.resizeObserver.observe(document.body);
            }

            // Setup MutationObserver for DOM changes that might affect subtitle position
            if (window.MutationObserver) {
                this.mutationObserver = new MutationObserver((mutations) => {
                    let shouldUpdate = false;

                    mutations.forEach((mutation) => {
                        // Check if any subtitle-related elements were added/removed/modified
                        if (mutation.type === 'childList') {
                            const addedNodes = Array.from(mutation.addedNodes);
                            const removedNodes = Array.from(
                                mutation.removedNodes
                            );

                            [...addedNodes, ...removedNodes].forEach((node) => {
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    const element = node;
                                    if (
                                        this._isSubtitleRelatedElement(element)
                                    ) {
                                        shouldUpdate = true;
                                    }
                                }
                            });
                        } else if (mutation.type === 'attributes') {
                            // Ignore class/style changes on interactive words to avoid resync loops
                            try {
                                const attr = mutation.attributeName || '';
                                const targetEl = mutation.target;
                                const isInteractive = targetEl && targetEl.classList && targetEl.classList.contains('dualsub-interactive-word');
                                if (!isInteractive && this._isSubtitleRelatedElement(mutation.target)) {
                                    shouldUpdate = true;
                                }
                            } catch (_) {}
                        }
                    });

                    if (shouldUpdate) {
                        // Debounce updates to avoid excessive recalculations
                        clearTimeout(this._mutationUpdateTimeout);
                        this._mutationUpdateTimeout = setTimeout(() => {
                            this._applyDynamicModalHeight();

                            // Re-sync word selection visuals when subtitles change
                            if (this.core.selectedWords.size > 0) {
                                try { this.core.syncSelectionHighlights(); } catch (_) {}
                                // this.core._log('debug', 'Re-synced word selection visuals after subtitle change');
                            }
                        }, 100);
                    }
                });

                // Observe the entire document for subtitle-related changes
                this.mutationObserver.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['style', 'class', 'id'],
                });
            }

            // Fallback interval monitoring (legacy compatibility): only if observers are not available
            if (!this.resizeObserver && !this.mutationObserver) {
                this.heightMonitorInterval = setInterval(() => {
                    this._applyDynamicModalHeight();
                }, 2000);
            }

            this.core._log('debug', 'Dynamic height monitoring started', {
                hasResizeObserver: !!this.resizeObserver,
                hasMutationObserver: !!this.mutationObserver,
            });
        } catch (error) {
            this.core._log(
                'error',
                'Failed to setup dynamic height monitoring',
                {
                    error: error.message,
                }
            );

            // Fallback to simple interval monitoring
            this.heightMonitorInterval = setInterval(() => {
                this._applyDynamicModalHeight();
            }, 1000);
        }
    }

    /**
     * Check if an element is subtitle-related
     * @param {Element} element - Element to check
     * @returns {boolean} True if element is subtitle-related
     * @private
     */
    _isSubtitleRelatedElement(element) {
        if (!element || !element.tagName) return false;

        // Safely get className as string (handle SVGAnimatedString and other types)
        let className = '';
        if (element.className) {
            if (typeof element.className === 'string') {
                className = element.className;
            } else if (element.className.baseVal !== undefined) {
                // SVGAnimatedString case
                className = element.className.baseVal;
            } else if (element.className.toString) {
                // Other objects with toString method
                className = element.className.toString();
            }
        }

        const id = element.id || '';

        // Check for subtitle-related classes and IDs
        const subtitleKeywords = [
            'subtitle',
            'caption',
            'timedtext',
            'dualsub',
            'player-timedtext',
            'dss-subtitle',
            'subtitle-container',
        ];

        return subtitleKeywords.some(
            (keyword) => className.includes(keyword) || id.includes(keyword)
        );
    }

    /**
     * Stop dynamic height monitoring
     * @private
     */
    _stopDynamicHeightMonitoring() {
        // Clear interval monitoring
        if (this.heightMonitorInterval) {
            clearInterval(this.heightMonitorInterval);
            this.heightMonitorInterval = null;
        }

        // Clear mutation update timeout
        if (this._mutationUpdateTimeout) {
            clearTimeout(this._mutationUpdateTimeout);
            this._mutationUpdateTimeout = null;
        }

        // Disconnect ResizeObserver
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        // Disconnect MutationObserver
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }

        this.core._log('debug', 'Dynamic height monitoring stopped');
    }

    /**
     * Animate processing button
     * @private
     */
    _animateProcessingButton() {
        const button =
            this.core.contentElement?.querySelector(
                '#dualsub-start-analysis'
            ) ||
            this.core.element?.querySelector('#dualsub-start-analysis') ||
            document.getElementById('dualsub-start-analysis');
        if (button) {
            button.classList.add('processing');
            const isPauseEnabled = button.getAttribute('data-paused-toggle') === 'true';
            if (!isPauseEnabled) {
                button.disabled = true;
                button.textContent = 'Analyzing...';
            }
        }
    }

    /**
     * Animate content transition
     * @private
     */
    _animateContentTransition() {
        const rightPane =
            this.core.contentElement?.querySelector('#dualsub-right-pane') ||
            this.core.element?.querySelector('#dualsub-right-pane');
        if (rightPane) {
            rightPane.style.opacity = '0';

            const transitionTimeout = setTimeout(() => {
                rightPane.style.opacity = '1';
            }, 150);

            this.animationTimeouts.set('content-transition', transitionTimeout);
        }
    }

    /**
     * Animate error state
     * @private
     */
    _animateErrorState() {
        const errorElement =
            this.core.contentElement?.querySelector('.dualsub-error') ||
            this.core.element?.querySelector('.dualsub-error');
        if (errorElement) {
            errorElement.style.opacity = '0';
            errorElement.style.transform = 'translateY(20px)';

            const errorTimeout = setTimeout(() => {
                errorElement.style.opacity = '1';
                errorElement.style.transform = 'translateY(0)';
                errorElement.style.transition =
                    'opacity 0.3s ease, transform 0.3s ease';
            }, 100);

            this.animationTimeouts.set('error-animation', errorTimeout);
        }
    }

    /**
     * Reset modal state
     * @private
     */
    _resetModalState() {
        // Reset button states (check multiple locations)
        const button =
            this.core.contentElement?.querySelector(
                '#dualsub-start-analysis'
            ) ||
            this.core.element?.querySelector('#dualsub-start-analysis') ||
            document.getElementById('dualsub-start-analysis');
        if (button) {
            button.classList.remove('processing');
            button.disabled = this.core.selectedWords.size === 0;
            button.textContent = 'Start Analysis';
        }

        // Remove processing class
        if (this.core.element) {
            this.core.element.classList.remove('dualsub-processing-disabled');
        }

        // Reset core state
        this.core.resetState();
    }

    /**
     * Sync visual selection state is centralized in core.syncSelectionHighlights
     * @private
     */
    _syncWordSelectionVisuals() { try { this.core.syncSelectionHighlights(); } catch (_) {} }

    /**
     * Get subtitle type from word element (Issue #1: Position-based selection)
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
     * Get word index within its subtitle container (Issue #1: Position-based selection)
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
     * Clear all animation timeouts
     * @private
     */
    _clearAnimationTimeouts() {
        for (const [key, timeout] of this.animationTimeouts) {
            clearTimeout(timeout);
            this.core._log('debug', 'Cleared animation timeout', { key });
        }
        this.animationTimeouts.clear();
    }

    /**
     * Cleanup animations
     */
    cleanup() {
        this.core._log('debug', 'Cleaning up animations');

        this._clearAnimationTimeouts();
        this._stopDynamicHeightMonitoring();

        this.core._log('debug', 'Animations cleanup complete');
    }
}
