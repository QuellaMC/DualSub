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
                eventListenersActive: 0
            }
        };
        
        this._handleSystemError = this._handleSystemError.bind(this);
        this._handleAnalysisRequest = this._handleAnalysisRequest.bind(this);
        this._handleModalStateChange = this._handleModalStateChange.bind(this);
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
                config: this.config
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
            this.metrics.memoryUsage.eventListenersActive = this.eventListeners.size;

            this._dispatchEvent(EVENT_TYPES.SYSTEM_INITIALIZED, {
                platform: this.platform,
                features: Array.from(this.enabledFeatures),
                initTime: this.metrics.initializationTime,
                componentsCreated: this.metrics.memoryUsage.componentsCreated
            });
            
            this._log('info', 'AI Context Manager initialized successfully', {
                initTime: this.metrics.initializationTime,
                features: Array.from(this.enabledFeatures)
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
    getModal() { return this.modal; }
    getProvider() { return this.provider; }
    getTextHandler() { return this.textHandler; }

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
                    eventListenersActive: 0
                }
            };

            this._log('info', 'AI Context Manager destroyed');

        } catch (error) {
            this._log('error', 'Error during manager destruction', error);
        }
    }

    // Private methods

    _validatePlatform() {
        const platformConfig = AI_CONTEXT_CONFIG.PLATFORMS[this.platform.toUpperCase()];
        return !!platformConfig;
    }

    async _initializeComponents() {
        this._log('debug', 'Initializing components');

        try {
            // Initialize modal
            const modalConfig = {
                ...this.config.modal,
                contentScript: this.contentScript
            };
            this.modal = new AIContextModal(modalConfig);
            await this.modal.initialize();
            this.components.set('modal', this.modal);

            // Initialize provider
            this.provider = new AIContextProvider(this.config.provider || {});
            await this.provider.initialize();
            this.components.set('provider', this.provider);

            // Initialize text handler
            this.textHandler = new TextSelectionHandler(this.config.textHandler || {});
            await this.textHandler.initialize(this.platform);
            this.components.set('textHandler', this.textHandler);

            this._log('debug', 'Components initialized successfully');
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
            document.addEventListener('dualsub-analyze-selection', contextAnalysisListener);
            this.eventListeners.set('dualsub-analyze-selection', contextAnalysisListener);

            // Listen for new AI context events
            document.addEventListener(EVENT_TYPES.ANALYSIS_START, this._handleAnalysisRequest);
            this.eventListeners.set(EVENT_TYPES.ANALYSIS_START, this._handleAnalysisRequest);

            // Listen for modal state changes
            document.addEventListener(EVENT_TYPES.MODAL_STATE_CHANGE, this._handleModalStateChange);
            this.eventListeners.set(EVENT_TYPES.MODAL_STATE_CHANGE, this._handleModalStateChange);

            // Listen for configuration updates
            const configUpdateListener = (event) => {
                this._handleConfigurationUpdate(event.detail);
            };
            document.addEventListener('dualsub-config-update', configUpdateListener);
            this.eventListeners.set('dualsub-config-update', configUpdateListener);

            // Listen for feature toggle requests
            const featureToggleListener = (event) => {
                this._handleFeatureToggle(event.detail);
            };
            document.addEventListener('dualsub-feature-toggle', featureToggleListener);
            this.eventListeners.set('dualsub-feature-toggle', featureToggleListener);

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
            AI_CONTEXT_CONFIG.FEATURES.TEXT_SELECTION
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
            timestamp: Date.now()
        });
    }

    async _handleAnalysisRequest(event) {
        try {
            const detail = event.detail;
            this._log('debug', 'Handling analysis request', detail);

            this.metrics.analysisCount++;
            this.metrics.lastActivity = Date.now();

            // Send request to background script for AI analysis
            const response = await chrome.runtime.sendMessage({
                action: 'analyzeContext',
                text: detail.text,
                contextTypes: detail.contextTypes || ['cultural', 'historical', 'linguistic'],
                language: detail.language,
                targetLanguage: detail.targetLanguage,
                platform: this.platform,
                requestId: detail.requestId
            });

            this._log('debug', 'Received response from background script', {
                success: response.success,
                hasResult: !!response.result,
                hasError: !!response.error,
                requestId: detail.requestId
            });

            // Dispatch result event (both new and legacy formats)
            document.dispatchEvent(new CustomEvent('dualsub-context-result', {
                detail: {
                    requestId: detail.requestId,
                    result: response.result,
                    success: response.success,
                    error: response.error
                }
            }));

            // Dispatch new event format
            if (response.success) {
                this._dispatchEvent(EVENT_TYPES.ANALYSIS_COMPLETE, {
                    requestId: detail.requestId,
                    result: response.result
                });
            } else {
                this._dispatchEvent(EVENT_TYPES.ANALYSIS_ERROR, {
                    requestId: detail.requestId,
                    error: response.error
                });
            }

        } catch (error) {
            this.metrics.errorCount++;
            this._log('error', 'Failed to handle analysis request', {
                error: error.message,
                detail: event.detail
            });

            // Dispatch error events
            document.dispatchEvent(new CustomEvent('dualsub-context-error', {
                detail: {
                    requestId: event.detail.requestId,
                    error: error.message
                }
            }));

            this._dispatchEvent(EVENT_TYPES.ANALYSIS_ERROR, {
                requestId: event.detail.requestId,
                error: error.message
            });
        }
    }

    _handleModalStateChange(event) {
        const { currentState, previousState, data } = event.detail;

        this._log('debug', 'Modal state changed', {
            from: previousState,
            to: currentState,
            data
        });

        // Update current state tracking
        this.currentState = currentState;

        // Handle state-specific logic
        switch (currentState) {
            case MODAL_STATES.ANALYZING:
                this.activeRequest = data.requestId;
                break;
            case MODAL_STATES.HIDDEN:
                this.activeRequest = null;
                break;
        }
    }

    /**
     * Setup cross-platform communication
     * @private
     */
    _setupCrossPlatformCommunication() {
        try {
            // Listen for messages from background script
            chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
                if (request.target === 'aiContext') {
                    this._handleBackgroundMessage(request, sendResponse);
                    return true; // Async response
                }
            });

            this._log('debug', 'Cross-platform communication setup complete');

        } catch (error) {
            this._log('error', 'Failed to setup cross-platform communication', error);
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
                    await this._handleConfigurationUpdate({ config: request.config });
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
                            metrics: this.metrics
                        }
                    });
                    break;

                default:
                    sendResponse({
                        success: false,
                        error: `Unknown action: ${request.action}`
                    });
            }

        } catch (error) {
            this._log('error', 'Failed to handle background message', {
                error: error.message,
                request
            });
            sendResponse({
                success: false,
                error: error.message
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
                detail
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

            this._log('info', 'Feature toggled successfully', { feature, enabled });

        } catch (error) {
            this._log('error', 'Failed to handle feature toggle', {
                error: error.message,
                detail
            });
        }
    }

    _dispatchEvent(type, detail) {
        // Track event metrics
        this.metrics.eventCounts[type] = (this.metrics.eventCounts[type] || 0) + 1;

        document.dispatchEvent(new CustomEvent(type, { detail }));
    }

    _log(level, message, data = {}) {
        const logData = {
            component: 'AIContextManager',
            platform: this.platform,
            timestamp: new Date().toISOString(),
            ...data
        };

        console[level](`[AIContext] ${message}`, logData);
    }
}
