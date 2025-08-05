/**
 * AI Context Modal - Unified Modal Component
 *
 * Modular modal implementation maintaining identical visual styling and functionality
 * to legacy contextAnalysisModal.js with improved maintainability through separation of concerns.
 *
 * @author DualSub Extension - UI Systems Engineer
 * @version 2.0.0
 */

import { MODAL_STATES } from '../core/constants.js';
import { AIContextModalCore } from './modal-core.js';
import { AIContextModalUI } from './modal-ui.js';
import { AIContextModalEvents } from './modal-events.js';
import { AIContextModalAnimations } from './modal-animations.js';

/**
 * AIContextModal - Unified modal component
 *
 * Modular implementation maintaining identical functionality to legacy modal:
 * - Core: State management and lifecycle
 * - UI: DOM creation and visual updates
 * - Events: User interactions and external events
 * - Animations: Show/hide transitions and visual effects
 *
 * Features:
 * - Interactive word selection with two-pane layout
 * - Real-time analysis processing with animations
 * - Structured result display with error handling
 * - Responsive design with dynamic height calculation
 * - Accessibility support and keyboard navigation
 * - Multi-language support via chrome.i18n
 * - Identical visual styling to legacy contextAnalysisModal.js
 */
export class AIContextModal {
    constructor(config = {}) {
        // Initialize core module
        this.core = new AIContextModalCore(config);

        // Initialize other modules (will be created after core)
        this.ui = null;
        this.events = null;
        this.animations = null;
        this.coordinationHandlers = new Map(); // Store coordination event handlers for cleanup
    }

    /**
     * Initialize the modal with all modules
     * @returns {Promise<void>}
     */
    async initialize() {
        this.core._log('info', 'Initializing AI Context Modal');

        // Initialize core
        await this.core.initialize();

        // Initialize UI module (Issue #2: Fixed internationalization race condition)
        this.ui = new AIContextModalUI(this.core);
        await this.ui.initialize(); // Initialize language first
        await this.ui.createModalElement();

        // Initialize animations module first
        this.animations = new AIContextModalAnimations(this.core, this.ui);

        // Initialize events module with animations reference
        this.events = new AIContextModalEvents(
            this.core,
            this.ui,
            this.animations
        );
        await this.events.setupEventListeners();

        // Ensure events module has animations reference (backup)
        this.events.setAnimations(this.animations);

        // Setup event coordination between modules
        this._setupModuleCoordination();

        // Ensure modal starts in completely hidden state
        this._ensureHiddenState();

        this.core._log('debug', 'Modal initialized successfully');
    }

    /**
     * Set logger instance
     * @param {Object} logger - Logger instance
     */
    setLogger(logger) {
        this.core.setLogger(logger);
    }

    /**
     * Setup coordination between modules
     * @private
     */
    _setupModuleCoordination() {
        // Listen for modal show requests from events module
        const showRequestHandler = (event) => {
            const { mode, trigger } = event.detail;
            this.core._log('debug', 'Modal show requested', { mode, trigger });

            if (mode === 'selection') {
                this.showSelectionMode();
            }
        };
        document.addEventListener(
            'aicontext:modal:showRequested',
            showRequestHandler
        );
        this.coordinationHandlers.set('show-request', showRequestHandler);

        // Listen for modal close requests from events module
        const closeRequestHandler = () => {
            this.core._log('debug', 'Modal close requested');
            this.hide();
        };
        document.addEventListener(
            'aicontext:modal:closeRequested',
            closeRequestHandler
        );
        this.coordinationHandlers.set('close-request', closeRequestHandler);

        this.core._log('debug', 'Module coordination setup complete');
    }

    // ========================================
    // PUBLIC API (maintains compatibility)
    // ========================================

    /**
     * Show the modal in selection mode
     * @param {Object} options - Display options
     * @returns {boolean} Success status
     */
    showSelectionMode(options = {}) {
        this.core._log('info', 'Showing modal in selection mode', options);

        if (!this.core.element) {
            this.core._log('error', 'Modal not initialized');
            return false;
        }

        this.core.currentMode = 'selection';
        this.core.setState(MODAL_STATES.SELECTION);

        // Reset selection state
        this.core.clearSelection();
        this.core.analysisResult = null;
        this.core.isAnalyzing = false;

        // Show modal with animation
        const success = this.animations.showModal(options);
        if (success) {
            // Set initial state for two-pane layout
            this.ui.showInitialState();
            this.ui.updateSelectionDisplay();
        }

        return success;
    }

    /**
     * Show the modal with analysis results
     * @param {Object} analysisResult - Analysis result data
     * @param {Object} metadata - Request metadata
     * @returns {boolean} Success status
     */
    showAnalysisResult(analysisResult, metadata = {}) {
        this.core._log('info', 'Showing analysis result', {
            analysisResult,
            metadata,
        });

        if (!this.core.element) {
            this.core._log('error', 'Modal not initialized');
            return false;
        }

        this.core.currentMode = 'display';
        this.core.setState(MODAL_STATES.DISPLAY);
        this.core.setAnalysisResult(analysisResult);

        // Show modal if not visible
        if (!this.core.isVisible) {
            this.animations.showModal({ mode: 'display' });
        }

        // Show results
        this.animations.showResultsState(analysisResult);

        return true;
    }

    /**
     * Show the modal with error state
     * @param {string} error - Error message
     * @param {Object} metadata - Error metadata
     * @returns {boolean} Success status
     */
    showError(error, metadata = {}) {
        this.core._log('info', 'Showing error state', { error, metadata });

        if (!this.core.element) {
            this.core._log('error', 'Modal not initialized');
            return false;
        }

        this.core.currentMode = 'error';
        this.core.setState(MODAL_STATES.ERROR);

        // Show modal if not visible
        if (!this.core.isVisible) {
            this.animations.showModal({ mode: 'error' });
        }

        // Show error
        this.animations.showErrorState(error, metadata);

        return true;
    }

    /**
     * Hide the modal
     */
    hide() {
        this.core._log('info', 'Hiding modal');
        this.animations.hideModal();
    }

    /**
     * Handle word selection from external sources
     * @param {Object} event - Word selection event
     */
    handleWordSelection(event) {
        if (this.events) {
            this.events._handleWordSelectionEvent(event);
        }
    }

    // ========================================
    // GETTERS (for compatibility)
    // ========================================

    /**
     * Get modal element
     * @returns {HTMLElement|null} Modal element
     */
    get element() {
        return this.core.element;
    }

    /**
     * Get visibility state
     * @returns {boolean} Whether modal is visible
     */
    get isVisible() {
        return this.core.isVisible;
    }

    /**
     * Get current state
     * @returns {string} Current modal state
     */
    get state() {
        return this.core.state;
    }

    /**
     * Get current mode
     * @returns {string} Current modal mode
     */
    get currentMode() {
        return this.core.currentMode;
    }

    /**
     * Get selected words
     * @returns {Set} Selected words set
     */
    get selectedWords() {
        return this.core.selectedWords;
    }

    /**
     * Get selected text
     * @returns {string} Selected text
     */
    get selectedText() {
        return this.core.selectedText;
    }

    /**
     * Get selected words order (legacy compatibility)
     * @returns {Array} Selected words in subtitle order
     */
    get selectedWordsOrder() {
        return this.core.selectedWordsOrder;
    }

    /**
     * Get original sentence words (legacy compatibility)
     * @returns {Array} Original sentence word order
     */
    get originalSentenceWords() {
        return this.core.originalSentenceWords;
    }

    /**
     * Get word positions (legacy compatibility)
     * @returns {Map} Word position mapping
     */
    get wordPositions() {
        return this.core.wordPositions;
    }

    /**
     * Get analysis result
     * @returns {Object|null} Analysis result
     */
    get analysisResult() {
        return this.core.analysisResult;
    }

    /**
     * Get analyzing state
     * @returns {boolean} Whether analysis is in progress
     */
    get isAnalyzing() {
        return this.core.isAnalyzing;
    }

    /**
     * Get current request ID (legacy compatibility)
     * @returns {string|null} Current analysis request ID
     */
    get currentRequest() {
        return this.core.currentRequest;
    }

    /**
     * Get modal configuration
     * @returns {Object} Modal configuration
     */
    get config() {
        return this.core.config;
    }

    // ========================================
    // CLEANUP
    // ========================================

    /**
     * Ensure modal is in completely hidden state
     * @private
     */
    _ensureHiddenState() {
        this.core._log('debug', 'Ensuring modal is in hidden state');

        // Ensure modal container is hidden
        if (this.core.element) {
            this.core.element.style.display = 'none';
            this.core.element.style.pointerEvents = 'none';
            this.core.element.classList.remove(
                'dualsub-context-modal--visible'
            );
        }

        // Ensure overlay is hidden
        if (this.core.overlayElement) {
            this.core.overlayElement.style.display = 'none';
            this.core.overlayElement.style.pointerEvents = 'none';
        }

        // Ensure content is hidden
        if (this.core.contentElement) {
            this.core.contentElement.style.display = 'none';
        }

        // Ensure core state is correct
        this.core.isVisible = false;
        this.core.setState(MODAL_STATES.HIDDEN);

        this.core._log('debug', 'Modal hidden state ensured', {
            elementHidden: this.core.element?.style.display === 'none',
            overlayHidden: this.core.overlayElement?.style.display === 'none',
            contentHidden: this.core.contentElement?.style.display === 'none',
            coreVisible: this.core.isVisible,
            coreState: this.core.state,
        });
    }

    /**
     * Destroy the modal and cleanup all modules
     * @returns {Promise<void>}
     */
    async destroy() {
        if (this.core) {
            this.core._log('info', 'Destroying modal');
        }

        // Cleanup coordination event listeners
        if (this.coordinationHandlers.has('show-request')) {
            document.removeEventListener(
                'aicontext:modal:showRequested',
                this.coordinationHandlers.get('show-request')
            );
        }
        if (this.coordinationHandlers.has('close-request')) {
            document.removeEventListener(
                'aicontext:modal:closeRequested',
                this.coordinationHandlers.get('close-request')
            );
        }
        this.coordinationHandlers.clear();

        // Cleanup modules in reverse order
        if (this.animations) {
            this.animations.cleanup();
            this.animations = null;
        }

        if (this.events) {
            this.events.removeEventListeners();
            this.events = null;
        }

        if (this.ui) {
            this.ui = null;
        }

        if (this.core) {
            await this.core.destroy();
            this.core = null;
        }

        console.log('[AIContextModal] Modal destroyed');
    }
}
