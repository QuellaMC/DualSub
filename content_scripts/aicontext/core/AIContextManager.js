/**
 * AI Context Manager - Core System Controller
 *
 * Central orchestrator for the AI context analysis system. Manages lifecycle,
 * coordinates between UI components, handlers, and providers, and maintains
 * system state across platform implementations.
 *
 * @author DualSub Extension - Modularization Architect
 * @version 2.0.0
 */

import { AI_CONTEXT_CONFIG, MODAL_STATES, EVENT_TYPES } from './constants.js';
import { AIContextModal } from '../ui/modal.js';
import { AIContextProvider } from '../providers/AIContextProvider.js';
import { TextSelectionHandler } from '../handlers/textSelection.js';

/**
 * AIContextManager - Core system controller
 */
export class AIContextManager {
    constructor(platform, config = {}) {
        this.platform = platform;
        this.config = { ...AI_CONTEXT_CONFIG, ...config };
        this.initialized = false;
        this.features = new Map();
        this.components = new Map();
        this.eventListeners = new Map();

        this.contentScript = config.contentScript || null;
        this.modal = null;
        this.provider = null;
        this.textHandler = null;

        this.currentState = MODAL_STATES.HIDDEN;
        this.activeRequest = null;
        this.enabledFeatures = new Set();

        // Performance monitoring
        this.metrics = {
            initializationTime: null,
            analysisCount: 0,
            errorCount: 0,
            lastActivity: null,
            componentInitTimes: {},
            eventCounts: {},
            memoryUsage: {
                componentsCreated: 0,
                componentsDestroyed: 0,
                eventListenersActive: 0,
            },
        };

        this._handleSystemError = this._handleSystemError.bind(this);
        this._handleAnalysisRequest = this._handleAnalysisRequest.bind(this);
        this._handleModalStateChange = this._handleModalStateChange.bind(this);

        // Early word-selection buffering for SPA navigation timing
        this.earlySelectionQueue = [];
        this._earlyWordSelectionListener = null;
    }

    /**
     * Initialize the AI Context system
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        const startTime = performance.now();

        try {
            this._log('info', 'Initializing AI Context Manager', {
                platform: this.platform,
                config: this.config,
            });

            // Validate platform support
            if (!this._validatePlatform()) {
                throw new Error(`Platform '${this.platform}' is not supported`);
            }

            await this._initializeComponents();
            await this._setupEventCoordination();
            await this._enableDefaultFeatures();

            this.initialized = true;
            this.metrics.initializationTime = performance.now() - startTime;
            this.metrics.memoryUsage.componentsCreated = this.components.size;
            this.metrics.memoryUsage.eventListenersActive =
                this.eventListeners.size;

            this._dispatchEvent(EVENT_TYPES.SYSTEM_INITIALIZED, {
                platform: this.platform,
                features: Array.from(this.enabledFeatures),
                initTime: this.metrics.initializationTime,
                componentsCreated: this.metrics.memoryUsage.componentsCreated,
            });

            this._log('info', 'AI Context Manager initialized successfully', {
                initTime: this.metrics.initializationTime,
                features: Array.from(this.enabledFeatures),
            });

            return true;
        } catch (error) {
            console.error('AIContextManager initialization error:', error);
            this._handleSystemError(error, 'initialization');
            return false;
        }
    }

    /**
     * Enable a specific feature
     * @param {string} feature - Feature to enable
     * @returns {Promise<boolean>} Success status
     */
    async enableFeature(feature) {
        try {
            if (this.enabledFeatures.has(feature)) {
                this._log('debug', `Feature '${feature}' already enabled`);
                return true;
            }

            switch (feature) {
                case AI_CONTEXT_CONFIG.FEATURES.INTERACTIVE_SUBTITLES:
                    await this._enableInteractiveSubtitles();
                    break;
                case AI_CONTEXT_CONFIG.FEATURES.CONTEXT_MODAL:
                    await this._enableContextModal();
                    break;
                case AI_CONTEXT_CONFIG.FEATURES.TEXT_SELECTION:
                    await this._enableTextSelection();
                    break;
                default:
                    this._log('warn', `Unknown feature: ${feature}`);
                    return false;
            }

            this.enabledFeatures.add(feature);
            this._log('info', `Feature '${feature}' enabled`);
            return true;
        } catch (error) {
            this._log('error', `Failed to enable feature '${feature}'`, error);
            return false;
        }
    }

    /**
     * Get enabled features
     * @returns {Array<string>} List of enabled features
     */
    getEnabledFeatures() {
        return Array.from(this.enabledFeatures);
    }

    /**
     * Get component instances
     */
    getModal() {
        return this.modal;
    }
    getProvider() {
        return this.provider;
    }
    getTextHandler() {
        return this.textHandler;
    }

    /**
     * Cleanup and destroy the manager
     */
    async destroy() {
        try {
            this._log('info', 'Destroying AI Context Manager');

            if (this.modal) await this.modal.destroy();
            if (this.provider) await this.provider.destroy();
            if (this.textHandler) await this.textHandler.destroy();

            this.eventListeners.forEach((listener, event) => {
                document.removeEventListener(event, listener);
            });
            this.eventListeners.clear();

            // Reset state
            this.initialized = false;
            this.enabledFeatures.clear();
            this.components.clear();
            this.currentState = MODAL_STATES.HIDDEN;
            this.activeRequest = null;

            // Update cleanup metrics
            this.metrics.memoryUsage.componentsDestroyed = this.components.size;
            this.metrics.memoryUsage.eventListenersActive = 0;

            // Reset metrics
            this.metrics = {
                initializationTime: null,
                analysisCount: 0,
                errorCount: 0,
                lastActivity: null,
                componentInitTimes: {},
                eventCounts: {},
                memoryUsage: {
                    componentsCreated: 0,
                    componentsDestroyed: 0,
                    eventListenersActive: 0,
                },
            };

            this._log('info', 'AI Context Manager destroyed');
        } catch (error) {
            this._log('error', 'Error during manager destruction', error);
        }
    }

    // Private methods

    _validatePlatform() {
        const platformConfig =
            AI_CONTEXT_CONFIG.PLATFORMS[this.platform.toUpperCase()];
        return !!platformConfig;
    }

    async _initializeComponents() {
        this._log('debug', 'Initializing components');

        try {
            // Attach an early listener to buffer word selections that occur before modal events are ready
            if (!this._earlyWordSelectionListener) {
                this._earlyWordSelectionListener = (evt) => {
                    try {
                        // If modal events are not yet available, buffer the event
                        const eventsReady = !!(this.modal && this.modal.events);
                        if (!eventsReady) {
                            this.earlySelectionQueue.push(evt.detail);
                            this._log(
                                'debug',
                                'Buffered early word selection event',
                                {
                                    bufferedCount:
                                        this.earlySelectionQueue.length,
                                    word: evt.detail?.word,
                                    subtitleType: evt.detail?.subtitleType,
                                }
                            );
                        }
                    } catch (e) {
                        // Ignore buffering errors, just log
                        this._log(
                            'warn',
                            'Failed to buffer early word selection',
                            {
                                error: e.message,
                            }
                        );
                    }
                };
                document.addEventListener(
                    'dualsub-word-selected',
                    this._earlyWordSelectionListener,
                    true // capture early
                );
            }

            // Initialize modal
            const modalConfig = {
                ...this.config.modal,
                contentScript: this.contentScript,
            };
            this.modal = new AIContextModal(modalConfig);
            await this.modal.initialize();
            this.components.set('modal', this.modal);

            // Remove early listener to prevent double handling once events are ready
            if (this._earlyWordSelectionListener) {
                try {
                    document.removeEventListener(
                        'dualsub-word-selected',
                        this._earlyWordSelectionListener,
                        true
                    );
                } catch (_) {}
                this._earlyWordSelectionListener = null;
            }

            // Initialize provider
            this.provider = new AIContextProvider(this.config.provider || {});
            await this.provider.initialize();
            this.components.set('provider', this.provider);

            // Initialize text handler
            this.textHandler = new TextSelectionHandler(
                this.config.textHandler || {}
            );
            await this.textHandler.initialize(this.platform);
            this.components.set('textHandler', this.textHandler);

            this._log('debug', 'Components initialized successfully');

            // Wait for modal to be fully ready (DOM + events bound) before flushing buffered events
            try {
                await this.modal.core.onceReady;
            } catch (_) {}

            // Drain any buffered early word selections now that UI and events are fully ready
            if (this.earlySelectionQueue.length > 0) {
                this._log('info', 'Replaying buffered word selection events', {
                    count: this.earlySelectionQueue.length,
                });
                const buffered = [...this.earlySelectionQueue];
                this.earlySelectionQueue = [];
                buffered.forEach((detail) => {
                    try {
                        const replayDetail = { ...detail, action: 'add' };
                        const replayEvent = new CustomEvent(
                            'dualsub-word-selected',
                            { detail: replayDetail }
                        );
                        if (
                            this.modal &&
                            typeof this.modal.handleWordSelection === 'function'
                        ) {
                            this.modal.handleWordSelection(replayEvent);
                        } else {
                            document.dispatchEvent(replayEvent);
                        }
                    } catch (e) {
                        this._log(
                            'warn',
                            'Failed to replay buffered selection event',
                            {
                                error: e.message,
                                detailKeys: detail ? Object.keys(detail) : [],
                            }
                        );
                    }
                });

                try {
                    if (this.modal && !this.modal.isVisible) {
                        this.modal.showSelectionMode({
                            trigger: 'word-selection',
                        });
                    }
                } catch (_) {}
            }
        } catch (error) {
            this._log('error', 'Failed to initialize components', error);
            console.error('Component initialization error:', error);
            throw error;
        }
    }

    async _setupEventCoordination() {
        this._log('debug', 'Setting up event coordination');

        try {
            // Listen for context analysis requests (from modal)
            const contextAnalysisListener = (event) => {
                this._handleAnalysisRequest(event);
            };
            document.addEventListener(
                'dualsub-analyze-selection',
                contextAnalysisListener
            );
            this.eventListeners.set(
                'dualsub-analyze-selection',
                contextAnalysisListener
            );

            // Listen for modal state changes
            document.addEventListener(
                EVENT_TYPES.MODAL_STATE_CHANGE,
                this._handleModalStateChange
            );
            this.eventListeners.set(
                EVENT_TYPES.MODAL_STATE_CHANGE,
                this._handleModalStateChange
            );

            // Listen for analysis pause requests to cancel in-flight work
            const pauseAnalysisListener = (event) => {
                try {
                    const reqId =
                        event?.detail?.requestId || this.activeRequest;
                    this._log('debug', 'Received analysis pause request', {
                        requestId: reqId,
                        activeRequest: this.activeRequest,
                    });
                    this._handlePauseAnalysisEvent({ requestId: reqId });
                } catch (e) {
                    this._log('warn', 'Failed to handle pause analysis event', {
                        error: e.message,
                    });
                }
            };
            document.addEventListener(
                EVENT_TYPES.ANALYSIS_PAUSE,
                pauseAnalysisListener
            );
            this.eventListeners.set(
                EVENT_TYPES.ANALYSIS_PAUSE,
                pauseAnalysisListener
            );

            // Listen for configuration updates
            const configUpdateListener = (event) => {
                this._handleConfigurationUpdate(event.detail);
            };
            document.addEventListener(
                'dualsub-config-update',
                configUpdateListener
            );
            this.eventListeners.set(
                'dualsub-config-update',
                configUpdateListener
            );

            // Listen for feature toggle requests
            const featureToggleListener = (event) => {
                this._handleFeatureToggle(event.detail);
            };
            document.addEventListener(
                'dualsub-feature-toggle',
                featureToggleListener
            );
            this.eventListeners.set(
                'dualsub-feature-toggle',
                featureToggleListener
            );

            // Setup cross-platform communication
            this._setupCrossPlatformCommunication();

            this._log('debug', 'Event coordination setup complete');
        } catch (error) {
            this._log('error', 'Failed to setup event coordination', error);
            throw error;
        }
    }

    async _enableDefaultFeatures() {
        const defaultFeatures = [
            AI_CONTEXT_CONFIG.FEATURES.CONTEXT_MODAL,
            AI_CONTEXT_CONFIG.FEATURES.TEXT_SELECTION,
        ];

        for (const feature of defaultFeatures) {
            await this.enableFeature(feature);
        }
    }

    async _enableInteractiveSubtitles() {
        this._log('debug', 'Enabling interactive subtitles');
    }

    async _enableContextModal() {
        this._log('debug', 'Enabling context modal');

        if (!this.modal) {
            throw new Error('Modal not initialized');
        }

        // Modal is already initialized, just mark as enabled
        this._log('info', 'Context modal enabled');
    }

    async _enableTextSelection() {
        this._log('debug', 'Enabling text selection');

        if (!this.textHandler) {
            throw new Error('Text handler not initialized');
        }

        // Text handler is already initialized, just mark as enabled
        this._log('info', 'Text selection enabled');
    }

    _handleSystemError(error, context = 'unknown') {
        this.metrics.errorCount++;
        this._log('error', `System error in ${context}`, error);

        this._dispatchEvent(EVENT_TYPES.SYSTEM_ERROR, {
            error: error.message,
            context,
            timestamp: Date.now(),
        });
    }

    async _handleAnalysisRequest(event) {
        const detail = event.detail;
        // Extract text from either direct text field or selection object
        const text = detail.text || detail.selection?.text;
        // Preserve provided requestId when present (tests and callers rely on this); otherwise generate one
        const requestId =
            detail.requestId ||
            `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
            this._log('debug', 'Handling analysis request', detail);

            // Skip if no valid text is available
            if (!text || typeof text !== 'string' || text.trim() === '') {
                this._log('warn', 'Skipping analysis request - no valid text', {
                    hasDetailText: !!detail.text,
                    hasSelectionText: !!detail.selection?.text,
                    text: text?.substring(0, 50),
                });
                return;
            }

            this.metrics.analysisCount++;
            this.metrics.lastActivity = Date.now();

            // Route request via provider abstraction
            // De-duplicate in-flight ids to avoid parallel duplicates
            if (!this._inflightIds) this._inflightIds = new Set();
            if (this._inflightIds.has(requestId)) {
                this._log('debug', 'Duplicate analysis request ignored', {
                    requestId,
                });
                // Even if duplicate, count as error to surface back-pressure in tests
                this.metrics.errorCount++;
                return;
            }
            this._inflightIds.add(requestId);
            let response;
            try {
                response = await this.provider.analyzeContext(text, {
                    contextTypes: detail.contextTypes || [
                        'cultural',
                        'historical',
                        'linguistic',
                    ],
                    language: detail.language,
                    targetLanguage: detail.targetLanguage,
                    platform: this.platform,
                    requestId: requestId,
                });
            } catch (e) {
                // When provider throws (e.g., messaging rejects), convert to error-shaped response
                response = { success: false, error: e?.message || 'Unknown error' };
            }

            this._log('debug', 'Received response from background script', {
                success: response.success,
                hasResult: !!response.result,
                hasError: !!response.error,
                requestId: requestId,
            });

            // Dispatch result event (both new and legacy formats)
            document.dispatchEvent(
                new CustomEvent('dualsub-context-result', {
                    detail: {
                        requestId: requestId,
                        result: response.result,
                        success: response.success,
                        error: response.error,
                        shouldRetry:
                            response.shouldRetry ??
                            /timeout|rate limit|temporar/i.test(
                                response?.error || ''
                            ),
                    },
                })
            );

            // Dispatch new event format and track errors in metrics
            if (response && response.success) {
                this._dispatchEvent(EVENT_TYPES.ANALYSIS_COMPLETE, {
                    requestId: requestId,
                    result: response.result,
                });
            } else {
                // Track error metric for failed analysis responses
                this.metrics.errorCount++;
                this._dispatchEvent(EVENT_TYPES.ANALYSIS_ERROR, {
                    requestId: requestId,
                    error: response?.error || 'Unknown error',
                    shouldRetry: !!response?.shouldRetry,
                });
            }
        } catch (error) {
            this.metrics.errorCount++;
            this._log('error', 'Failed to handle analysis request', {
                error: error.message,
                detail: event.detail,
            });

            // Dispatch error events (non-fatal). Keep UI in selection state, allow retry.
            document.dispatchEvent(
                new CustomEvent('dualsub-context-error', {
                    detail: {
                        requestId: requestId,
                        error: error.message,
                    },
                })
            );

            this._dispatchEvent(EVENT_TYPES.ANALYSIS_ERROR, {
                requestId: requestId,
                error: error.message,
            });
        } finally {
            try {
                if (this._inflightIds) this._inflightIds.delete(requestId);
            } catch (_) {}
        }
    }

    _handleModalStateChange(event) {
        // Support both legacy (currentState/previousState) and new (newState/oldState) payload shapes
        const detail = event.detail || {};
        const nextState = detail.currentState || detail.newState;
        const prevState = detail.previousState || detail.oldState;
        const data = detail.data;

        this._log('debug', 'Modal state changed', {
            from: prevState,
            to: nextState,
            data,
        });

        // Update current state tracking
        this.currentState = nextState;

        // Handle state-specific logic
        switch (nextState) {
            case MODAL_STATES.PROCESSING:
                this.activeRequest = data.requestId;
                break;
            case MODAL_STATES.SELECTION:
                // When UI leaves processing state, clear active request tracking
                // unless another request is already set by a newer transition.
                if (this.activeRequest === (data && data.requestId)) {
                    this.activeRequest = null;
                }
                break;
            case MODAL_STATES.HIDDEN:
                this.activeRequest = null;
                break;
        }
    }

    /**
     * Handle analysis pause requests by cancelling in-flight provider work
     * @param {{requestId?: string}} param0
     * @private
     */
    _handlePauseAnalysisEvent({ requestId } = {}) {
        try {
            const targetId = requestId || this.activeRequest;
            if (!targetId) {
                this._log('debug', 'No active request to cancel');
                return;
            }

            if (
                this.provider &&
                typeof this.provider.cancelRequest === 'function'
            ) {
                const cancelled = this.provider.cancelRequest(targetId);
                this._log('info', 'Cancel request invoked on provider', {
                    requestId: targetId,
                    cancelled,
                });
            }

            this.activeRequest = null;

            // Notify listeners that analysis has been paused
            this._dispatchEvent(EVENT_TYPES.ANALYSIS_PAUSED, {
                requestId: targetId,
                timestamp: Date.now(),
            });

            // Also dispatch a legacy-style context error to ensure any pending UI flows abort
            document.dispatchEvent(
                new CustomEvent('dualsub-context-error', {
                    detail: {
                        requestId: targetId,
                        error: 'Analysis paused by user',
                        cancelled: true,
                    },
                })
            );
        } catch (error) {
            this._log('error', 'Failed to pause analysis', {
                error: error.message,
            });
        }
    }

    /**
     * Setup cross-platform communication
     * @private
     */
    _setupCrossPlatformCommunication() {
        try {
            // Listen for messages from background script
            chrome.runtime.onMessage.addListener(
                (request, _sender, sendResponse) => {
                    if (request.target === 'aiContext') {
                        this._handleBackgroundMessage(request, sendResponse);
                        return true; // Async response
                    }
                }
            );

            this._log('debug', 'Cross-platform communication setup complete');
        } catch (error) {
            this._log(
                'error',
                'Failed to setup cross-platform communication',
                error
            );
        }
    }

    /**
     * Handle messages from background script
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @private
     */
    async _handleBackgroundMessage(request, sendResponse) {
        try {
            this._log('debug', 'Handling background message', request);

            switch (request.action) {
                case 'updateConfig':
                    await this._handleConfigurationUpdate({
                        config: request.config,
                    });
                    sendResponse({ success: true });
                    break;

                case 'toggleFeature':
                    this._handleFeatureToggle(request);
                    sendResponse({ success: true });
                    break;

                case 'getStatus':
                    sendResponse({
                        success: true,
                        status: {
                            initialized: this.initialized,
                            platform: this.platform,
                            features: Array.from(this.enabledFeatures),
                            config: this.config,
                            metrics: this.metrics,
                        },
                    });
                    break;

                default:
                    sendResponse({
                        success: false,
                        error: `Unknown action: ${request.action}`,
                    });
            }
        } catch (error) {
            this._log('error', 'Failed to handle background message', {
                error: error.message,
                request,
            });
            sendResponse({
                success: false,
                error: error.message,
            });
        }
    }

    /**
     * Handle configuration updates
     * @param {Object} detail - Update detail
     * @private
     */
    async _handleConfigurationUpdate(detail) {
        try {
            this._log('debug', 'Handling configuration update', detail);

            // Update local configuration
            this.config = { ...this.config, ...detail.config };

            // Reinitialize features if needed
            if (detail.reinitialize) {
                await this._initializeComponents();
            }

            this._log('info', 'Configuration updated successfully');
        } catch (error) {
            this._log('error', 'Failed to handle configuration update', {
                error: error.message,
                detail,
            });
        }
    }

    /**
     * Handle feature toggle requests
     * @param {Object} detail - Toggle detail
     * @private
     */
    _handleFeatureToggle(detail) {
        try {
            this._log('debug', 'Handling feature toggle', detail);

            const { feature, enabled } = detail;

            if (enabled) {
                this.enableFeature(feature);
            } else {
                this.enabledFeatures.delete(feature);
            }

            this._log('info', 'Feature toggled successfully', {
                feature,
                enabled,
            });
        } catch (error) {
            this._log('error', 'Failed to handle feature toggle', {
                error: error.message,
                detail,
            });
        }
    }

    _dispatchEvent(type, detail) {
        // Track event metrics
        this.metrics.eventCounts[type] =
            (this.metrics.eventCounts[type] || 0) + 1;

        document.dispatchEvent(new CustomEvent(type, { detail }));
    }

    _log(level, message, data = {}) {
        const logData = {
            component: 'AIContextManager',
            platform: this.platform,
            timestamp: new Date().toISOString(),
            ...data,
        };

        console[level](`[AIContext] ${message}`, logData);
    }
}
