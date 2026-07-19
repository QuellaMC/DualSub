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
import { ModalController } from './events/ModalController.js';

const TrustedPromise = Promise;
const trustedPromiseAllSettled = TrustedPromise.allSettled.bind(TrustedPromise);
const trustedPromiseResolve = TrustedPromise.resolve.bind(TrustedPromise);
const trustedPromiseThen = Function.call.bind(TrustedPromise.prototype.then);

const ANALYSIS_CAPABILITY_KEYS = Object.freeze([
    'requestAnalysis',
    'cancelAnalysis',
    'clearSelection',
    'subscribeSettled',
    'takeResult',
]);

function extractAnalysisConfiguration(config) {
    const source =
        config !== null && typeof config === 'object'
            ? config
            : Object.create(null);
    let capabilityDescriptor;
    try {
        capabilityDescriptor = Object.getOwnPropertyDescriptor(
            source,
            'analysisCapabilities'
        );
    } catch (_) {
        throw new TypeError('Invalid analysisCapabilities configuration');
    }

    let capabilities = null;
    if (capabilityDescriptor) {
        if (!Object.hasOwn(capabilityDescriptor, 'value')) {
            throw new TypeError('Invalid analysisCapabilities configuration');
        }

        const candidate = capabilityDescriptor.value;
        let capabilityDescriptors;
        try {
            capabilityDescriptors = Object.fromEntries(
                ANALYSIS_CAPABILITY_KEYS.map((key) => [
                    key,
                    Object.getOwnPropertyDescriptor(candidate, key),
                ])
            );
            if (
                candidate === null ||
                typeof candidate !== 'object' ||
                Reflect.ownKeys(candidate).length !==
                    ANALYSIS_CAPABILITY_KEYS.length ||
                ANALYSIS_CAPABILITY_KEYS.some((key) => {
                    const descriptor = capabilityDescriptors[key];
                    return (
                        descriptor?.enumerable !== true ||
                        !Object.hasOwn(descriptor, 'value') ||
                        typeof descriptor.value !== 'function'
                    );
                })
            ) {
                throw new TypeError(
                    'Invalid analysisCapabilities configuration'
                );
            }
            capabilities = Object.freeze(
                Object.fromEntries(
                    ANALYSIS_CAPABILITY_KEYS.map((key) => [
                        key,
                        capabilityDescriptors[key].value,
                    ])
                )
            );
        } catch (_) {
            throw new TypeError('Invalid analysisCapabilities configuration');
        }
    }

    const coreConfig = {};
    try {
        for (const key of Object.keys(source)) {
            if (key !== 'analysisCapabilities') coreConfig[key] = source[key];
        }
    } catch (_) {}
    Object.defineProperty(coreConfig, 'privateAnalysis', {
        value: capabilities !== null,
        enumerable: true,
        configurable: false,
        writable: false,
    });

    return { capabilities, coreConfig };
}

async function settleCleanupAttempts(attempts, ignoredPromise = null) {
    const work = attempts.map((attempt) => {
        try {
            const result = attempt();
            return result === ignoredPromise ? undefined : result;
        } catch (_) {
            return undefined;
        }
    });
    try {
        await trustedPromiseAllSettled(work);
    } catch (_) {}
}

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
        const { capabilities, coreConfig } =
            extractAnalysisConfiguration(config);
        this._analysisCapabilities = capabilities;
        this._privateAnalysis = capabilities !== null;

        // Initialize core module
        this.core = new AIContextModalCore(coreConfig);

        // Initialize other modules (will be created after core)
        this.ui = null;
        this.events = null;
        this.animations = null;
        this.controller = null;
        this.coordinationHandlers = new Map(); // Store coordination event handlers for cleanup
        this._initializePromise = null;
        this._initialized = false;
        this._destroyPromise = null;
        this._destroyed = false;
    }

    /**
     * Initialize the modal with all modules
     * @returns {Promise<void>}
     */
    initialize() {
        if (this._initializePromise) return this._initializePromise;
        if (this._destroyed || !this.core) {
            return trustedPromiseResolve(undefined);
        }

        let resolveInitialization;
        let rejectInitialization;
        this._initializePromise = new TrustedPromise((resolve, reject) => {
            resolveInitialization = resolve;
            rejectInitialization = reject;
        });
        let initialization;
        try {
            initialization = trustedPromiseResolve(this._performInitialize());
        } catch (error) {
            rejectInitialization(error);
            return this._initializePromise;
        }
        trustedPromiseThen(
            initialization,
            () => {
                if (!this._destroyed) this._initialized = true;
                resolveInitialization();
            },
            rejectInitialization
        );
        return this._initializePromise;
    }

    async _performInitialize() {
        if (this._destroyed || !this.core) return;

        const core = this.core;
        core._log('info', 'Initializing AI Context Modal');

        // Initialize core
        await core.initialize();
        if (this._destroyed || this.core !== core) return;

        // Initialize UI module (Issue #2: Fixed internationalization race condition)
        const ui = new AIContextModalUI(core);
        if (this._destroyed || this.core !== core) {
            await ui.destroy();
            return;
        }
        this.ui = ui;
        await ui.initialize(); // Initialize language first
        if (this._destroyed || this.ui !== ui || this.core !== core) return;
        await ui.createModalElement();
        if (this._destroyed || this.ui !== ui || this.core !== core) return;

        // Initialize animations module first
        const animations = new AIContextModalAnimations(core, ui);
        if (this._destroyed || this.ui !== ui || this.core !== core) {
            await settleCleanupAttempts([() => animations.cleanup()]);
            return;
        }
        this.animations = animations;

        // Initialize events module with animations reference
        const events = new AIContextModalEvents(core, ui, animations);
        if (
            this._destroyed ||
            this.animations !== animations ||
            this.ui !== ui ||
            this.core !== core
        ) {
            await settleCleanupAttempts([() => events.removeEventListeners()]);
            return;
        }
        this.events = events;
        await events.setupEventListeners();
        if (
            this._destroyed ||
            this.events !== events ||
            this.animations !== animations ||
            this.ui !== ui ||
            this.core !== core
        ) {
            return;
        }

        // Ensure events module has animations reference (backup)
        events.setAnimations(animations);
        if (this._destroyed) return;

        // Mark events ready for SPA gating
        core.markEventsReady();
        if (this._destroyed) return;

        // Legacy document coordination is not an authority path in private mode.
        if (!this._privateAnalysis) this._setupModuleCoordination();
        if (this._destroyed) return;

        // Provide a simple controller API for external triggers/tests
        this.controller = new ModalController(
            core,
            ui,
            animations,
            this._analysisCapabilities
        );
        if (this._destroyed) {
            this.controller = null;
            return;
        }
        // Expose controller to events for gradual migration
        this.events.modalController = this.controller;
        // Expose events back to controller for interaction helpers
        this.controller.events = this.events;

        if (!this._privateAnalysis) {
            // Wire close requests to controller close (registered once via coordination map for cleanup)
            const _closeRelay = () => {
                if (this._destroyed) return;
                try {
                    this.controller.closeModal();
                } catch (_) {}
            };
            this.coordinationHandlers.set('close-relay', _closeRelay);
            document.addEventListener(
                'aicontext:modal:closeRequested',
                _closeRelay
            );
            if (this._destroyed) {
                try {
                    document.removeEventListener(
                        'aicontext:modal:closeRequested',
                        _closeRelay
                    );
                } catch (_) {}
                return;
            }
        }

        // Ensure modal starts in completely hidden state
        this._ensureHiddenState();
        if (this._destroyed) return;

        core._log('debug', 'Modal initialized successfully');
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
        if (this._destroyed) return;

        // Listen for modal show requests from events module
        const showRequestHandler = (event) => {
            if (this._destroyed) return;
            const { mode, trigger } = event.detail;
            this.core._log('debug', 'Modal show requested', { mode, trigger });

            // Only show when user has created a selection (words present)
            if (mode === 'selection' && this.core.selectedWords?.size > 0) {
                this.showSelectionMode({ trigger, preserveSelection: true });
            }
        };
        this.coordinationHandlers.set('show-request', showRequestHandler);
        document.addEventListener(
            'aicontext:modal:showRequested',
            showRequestHandler
        );
        if (this._destroyed) {
            try {
                document.removeEventListener(
                    'aicontext:modal:showRequested',
                    showRequestHandler
                );
            } catch (_) {}
            return;
        }

        // Listen for modal close requests from events module
        const closeRequestHandler = () => {
            if (this._destroyed) return;
            this.core._log('debug', 'Modal close requested');
            this.hide();
        };
        this.coordinationHandlers.set('close-request', closeRequestHandler);
        document.addEventListener(
            'aicontext:modal:closeRequested',
            closeRequestHandler
        );
        if (this._destroyed) {
            try {
                document.removeEventListener(
                    'aicontext:modal:closeRequested',
                    closeRequestHandler
                );
            } catch (_) {}
            return;
        }

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

        // If already analyzing or showing processing/results, do not override state back to selection (race guard for SPA/soft nav)
        const isBusy =
            this.core.isAnalyzing ||
            this.core.state === MODAL_STATES.PROCESSING ||
            this.core.state === MODAL_STATES.DISPLAY ||
            this.core.state === MODAL_STATES.ERROR;
        if (!isBusy) {
            this.core.currentMode = 'selection';
            this.core.setState(MODAL_STATES.SELECTION);
        }

        // Preserve existing selection when triggered by word clicks or analysis request
        // Users expect selected words to persist when starting analysis.
        const preserveSelection =
            options.preserveSelection !== undefined
                ? !!options.preserveSelection
                : options.trigger === 'word-selection' ||
                  options.trigger === 'analysis-request';
        if (!preserveSelection && !this._privateAnalysis) {
            this.core.clearSelection();
        }
        this.core.analysisResult = null;
        this.core.isAnalyzing = false;

        // Show modal with animation
        const success = this.animations.showModal(options);
        if (success) {
            // Set initial state for two-pane layout only when not analyzing
            if (!isBusy) this.ui.showInitialState();
            this.ui.updateSelectionDisplay();
            // Ensure localized label and correct handler on the Start button
            try {
                if (
                    this.controller &&
                    typeof this.controller.resetAnalysisButton === 'function'
                ) {
                    this.controller.resetAnalysisButton();
                }
            } catch (_) {}
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
        if (this._privateAnalysis) return false;
        this.core._log('info', 'Showing analysis result', {
            hasAnalysisResult: Boolean(analysisResult),
            analysisResultKeys:
                analysisResult && typeof analysisResult === 'object'
                    ? Object.keys(analysisResult)
                    : [],
            metadataKeys: Object.keys(metadata || {}),
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
        if (this._privateAnalysis) return false;
        this.core._log('info', 'Showing error state', {
            errorName: error?.name,
            errorLength:
                typeof error === 'string'
                    ? error.length
                    : error?.message?.length || 0,
            metadataKeys: Object.keys(metadata || {}),
        });

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
        if (this._privateAnalysis) return false;
        if (this.events) {
            this.events._handleWordSelectionEvent(event);
        }
        return true;
    }

    /**
     * Replace the modal's visual selection from a canonical private snapshot.
     * The modal never publishes this state back to the document or adopts DOM
     * restoration as selection authority.
     *
     * @param {Object} snapshot - Canonical selection snapshot payload
     * @returns {boolean} Whether the snapshot was applied
     */
    applySelectionSnapshot(snapshot) {
        if (!this._privateAnalysis || this._destroyed || !this.core) {
            return false;
        }
        const applied = this.core.applyPrivateSelectionSnapshot(snapshot);
        if (!applied || this._destroyed) return false;

        try {
            this.ui?.updateSelectionDisplay();
        } catch (_) {}
        try {
            this.core?.syncSelectionHighlights();
        } catch (_) {}
        return !this._destroyed;
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

        // Ensure modal container and elements are hidden via class-only transitions
        if (this.core.element) {
            this.core.element.classList.remove(
                'dualsub-context-modal--visible'
            );
            try {
                this.core.element.style.pointerEvents = 'none';
            } catch (_) {}
        }

        if (this.core.overlayElement) {
            this.core.overlayElement.classList.remove('dualsub-visible');
            try {
                this.core.overlayElement.style.pointerEvents = 'none';
            } catch (_) {}
        }

        if (this.core.contentElement) {
            this.core.contentElement.classList.remove('dualsub-visible');
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
    destroy() {
        if (this._destroyPromise) return this._destroyPromise;

        let resolveDestroy;
        this._destroyPromise = new TrustedPromise((resolve) => {
            resolveDestroy = resolve;
        });
        this._destroyed = true;

        const ownership = this._detachDestroyOwnership();
        const teardown = trustedPromiseResolve(this._performDestroy(ownership));
        trustedPromiseThen(teardown, resolveDestroy, resolveDestroy);
        return this._destroyPromise;
    }

    _detachDestroyOwnership() {
        const ownership = {
            coordinationHandlers: [...this.coordinationHandlers.entries()],
            animations: this.animations,
            events: this.events,
            controller: this.controller,
            ui: this.ui,
            core: this.core,
        };

        this.coordinationHandlers.clear();
        this.animations = null;
        this.events = null;
        this.ui = null;
        this.core = null;
        this.controller = null;
        this._analysisCapabilities = null;
        return ownership;
    }

    async _performDestroy(ownership) {
        try {
            ownership.ui?.revokeAuthority?.();
        } catch (_) {}

        const cleanedOwners = new Set();
        const authorityAttempts = [];
        if (ownership.events && !cleanedOwners.has(ownership.events)) {
            cleanedOwners.add(ownership.events);
            authorityAttempts.push(() => {
                const cleanup = ownership.events?.removeEventListeners;
                if (typeof cleanup === 'function') {
                    return cleanup.call(ownership.events);
                }
                return undefined;
            });
        }
        if (ownership.controller && !cleanedOwners.has(ownership.controller)) {
            cleanedOwners.add(ownership.controller);
            authorityAttempts.push(() => {
                const destroy = ownership.controller?.destroy;
                if (typeof destroy === 'function') {
                    return destroy.call(ownership.controller);
                }
                return undefined;
            });
        }
        const authorityCleanup = settleCleanupAttempts(
            authorityAttempts,
            this._destroyPromise
        );

        await authorityCleanup;

        const coordinationAttempts = [];
        for (const [key, handler] of ownership.coordinationHandlers) {
            if (key === 'show-request') {
                coordinationAttempts.push(() =>
                    document.removeEventListener(
                        'aicontext:modal:showRequested',
                        handler
                    )
                );
            } else if (key === 'close-request' || key === 'close-relay') {
                coordinationAttempts.push(() =>
                    document.removeEventListener(
                        'aicontext:modal:closeRequested',
                        handler
                    )
                );
            }
        }
        await settleCleanupAttempts(coordinationAttempts, this._destroyPromise);

        if (ownership.animations && !cleanedOwners.has(ownership.animations)) {
            cleanedOwners.add(ownership.animations);
            await settleCleanupAttempts(
                [
                    () => {
                        const cleanup = ownership.animations?.cleanup;
                        if (typeof cleanup === 'function') {
                            return cleanup.call(ownership.animations);
                        }
                        return undefined;
                    },
                ],
                this._destroyPromise
            );
        }

        if (ownership.ui && !cleanedOwners.has(ownership.ui)) {
            cleanedOwners.add(ownership.ui);
            await settleCleanupAttempts(
                [
                    () => {
                        const destroy = ownership.ui?.destroy;
                        if (typeof destroy === 'function') {
                            return destroy.call(ownership.ui);
                        }
                        const fullscreenListener =
                            ownership.ui?._onFullscreenChange;
                        if (fullscreenListener) {
                            return document.removeEventListener(
                                'fullscreenchange',
                                fullscreenListener
                            );
                        }
                        return undefined;
                    },
                ],
                this._destroyPromise
            );
        }

        if (ownership.core && !cleanedOwners.has(ownership.core)) {
            cleanedOwners.add(ownership.core);
            await settleCleanupAttempts(
                [
                    () => {
                        const destroy = ownership.core?.destroy;
                        if (typeof destroy === 'function') {
                            return destroy.call(ownership.core);
                        }
                        return undefined;
                    },
                ],
                this._destroyPromise
            );
        }
    }
}
