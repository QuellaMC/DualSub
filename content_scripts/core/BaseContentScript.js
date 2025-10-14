/**
 * BaseContentScript - Abstract base class for platform-specific content scripts
 *
 * This class provides common functionality shared across all streaming platform
 * content scripts, including module loading, platform initialization, video element
 * detection, configuration management, Chrome message handling, and navigation detection.
 *
 * Platform-specific content scripts should extend this class and implement the
 * abstract methods to provide platform-specific behavior.
 *
 * ## Architecture Overview
 *
 * The BaseContentScript follows the Template Method Pattern, where the base class
 * defines the algorithm structure and subclasses implement specific steps. This
 * ensures consistent behavior across all platforms while allowing customization.
 *
 * ## Key Features
 *
 * - **Module Loading**: Dynamic loading of required modules with error handling
 * - **Platform Lifecycle**: Standardized initialization and cleanup patterns
 * - **Message Handling**: Extensible Chrome message handling with action-based routing
 * - **Navigation Detection**: Platform-specific navigation detection strategies
 * - **Configuration Management**: Real-time configuration updates and validation
 * - **Error Recovery**: Comprehensive error handling with retry mechanisms
 * - **Resource Management**: Automatic cleanup and memory management
 *
 * ## Usage Example
 *
 * ```javascript
 * import { BaseContentScript } from '../core/BaseContentScript.js';
 *
 * export class MyPlatformContentScript extends BaseContentScript {
 *     constructor() {
 *         super('MyPlatformContent');
 *     }
 *
 *     // Implement required abstract methods
 *     getPlatformName() { return 'myplatform'; }
 *     getPlatformClass() { return 'MyPlatformPlatform'; }
 *     getInjectScriptConfig() { return { ... }; }
 *     setupNavigationDetection() { ... }
 *     checkForUrlChange() { ... }
 *     handlePlatformSpecificMessage(request, sendResponse) { ... }
 * }
 *
 * // Initialize the content script
 * const contentScript = new MyPlatformContentScript();
 * await contentScript.initialize();
 * ```
 *
 * ## Abstract Methods
 *
 * Subclasses must implement these abstract methods:
 * - `getPlatformName()`: Return platform identifier (e.g., 'netflix')
 * - `getPlatformClass()`: Return platform class name (e.g., 'NetflixPlatform')
 * - `getInjectScriptConfig()`: Return injection script configuration
 * - `setupNavigationDetection()`: Setup platform-specific navigation detection
 * - `checkForUrlChange()`: Handle URL changes with platform-specific logic
 * - `handlePlatformSpecificMessage()`: Handle platform-specific Chrome messages
 *
 * ## Template Methods
 *
 * These methods orchestrate the initialization flow and should not be overridden:
 * - `initialize()`: Main initialization method
 * - `initializeCore()`: Core module initialization
 * - `initializeConfiguration()`: Configuration setup
 * - `initializeEventHandling()`: Event handling setup
 * - `initializeObservers()`: Observer setup
 *
 * @abstract
 * @author DualSub Extension
 * @version 1.0.0
 * @since 1.0.0
 *
 * @example
 * // Basic platform implementation
 * class ExampleContentScript extends BaseContentScript {
 *     constructor() {
 *         super('ExampleContent');
 *     }
 *
 *     getPlatformName() {
 *         return 'example';
 *     }
 *
 *     getPlatformClass() {
 *         return 'ExamplePlatform';
 *     }
 *
 *     getInjectScriptConfig() {
 *         return {
 *             filename: 'injected_scripts/exampleInject.js',
 *             tagId: 'example-dualsub-injector-script-tag',
 *             eventId: 'example-dualsub-injector-event'
 *         };
 *     }
 *
 *     setupNavigationDetection() {
 *         this.intervalManager.set('urlChangeCheck', () => this.checkForUrlChange(), 1000);
 *     }
 *
 *     checkForUrlChange() {
 *         const newUrl = window.location.href;
 *         if (newUrl !== this.currentUrl) {
 *             this.currentUrl = newUrl;
 *             // Handle URL change logic
 *         }
 *     }
 *
 *     handlePlatformSpecificMessage(request, sendResponse) {
 *         sendResponse({ success: true, handled: false });
 *         return false;
 *     }
 * }
 */

// @ts-check

import {
    EventBuffer,
    IntervalManager,
    injectScript,
    isExtensionContextValid,
    ModuleLoader,
    MessageHandlerRegistry,
} from './utils.js';
import { COMMON_CONSTANTS } from './constants.js';
import { getOrCreateUiRoot } from '../shared/subtitleUtilities.js';
import { MessageActions } from '../shared/constants/messageActions.js';
import { NavigationDetectionManager } from '../shared/navigationUtils.js';

export class BaseContentScript {
    /**
     * Creates a new BaseContentScript instance.
     * @param {string} logPrefix - The log prefix for this content script (e.g., 'NetflixContent').
     */
    constructor(logPrefix) {
        if (new.target === BaseContentScript) {
            throw new Error(
                'BaseContentScript is abstract and cannot be instantiated directly'
            );
        }

        this.logPrefix = logPrefix;
        this._initializeCoreProperties();
        this._initializeModuleReferences();
        this._initializeVideoDetectionState();
        this._initializeEventHandling();
        this._initializeNavigationState();
        this._initializeManagers();
        this._initializeCleanupTracking();
        this._initializeMessageHandling();
    }

    /**
     * Initializes core properties for the content script instance.
     * @private
     */
    _initializeCoreProperties() {
        this.contentLogger = null;
        this.activePlatform = null;
        this.currentConfig = {};
    }

    /**
     * Initializes references to dynamically loaded modules.
     * @private
     */
    _initializeModuleReferences() {
        this.subtitleUtils = null;
        this.PlatformClass = null;
        this.configService = null;
    }

    /**
     * Initializes state related to video element detection.
     * @private
     */
    _initializeVideoDetectionState() {
        this.videoDetectionRetries = 0;
        this.videoDetectionIntervalId = null;
        this.maxVideoDetectionRetries =
            COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES;
        this.videoDetectionInterval = COMMON_CONSTANTS.VIDEO_DETECTION_INTERVAL;
    }

    /**
     * Initializes properties for event handling and buffering.
     * @private
     */
    _initializeEventHandling() {
        this.eventBuffer = new EventBuffer((msg, data) =>
            this.logWithFallback('debug', msg, data)
        );
        this.eventListenerAttached = false;
        this.platformReady = false;
        this.eventListenerCleanupFunctions = [];
        this.domObserverCleanupFunctions = [];
    }

    /**
     * Initializes state related to navigation and URL tracking.
     * @private
     */
    _initializeNavigationState() {
        this.currentUrl = window.location.href;
        this.lastKnownPathname = window.location.pathname;
    }

    /**
     * Initializes manager instances for intervals and observers.
     * @private
     */
    _initializeManagers() {
        this.intervalManager = new IntervalManager();
        this.pageObserver = null;

        // Initialize AI Context Manager (will be configured during initializeAIContextFeatures)
        this.aiContextManager = null;

        // Navigation detection manager (optional unified path)
        this.navigationDetectionManager = null;
    }

    /**
     * Initializes properties for tracking cleanup state.
     * @private
     */
    _initializeCleanupTracking() {
        this.isCleanedUp = false;
        this.passiveVideoObserver = null;

        try {
            this.abortController = new AbortController();
        } catch (error) {
            this.logWithFallback(
                'warn',
                'AbortController not available, using fallback cleanup',
                { error }
            );
            this.abortController = null;
        }
    }

    /**
     * Initializes the Chrome message handling system.
     * @private
     */
    _initializeMessageHandling() {
        this.messageHandlers = new Map();
        this._setupCommonMessageHandlers();
        this.registerPlatformMessageHandlers();
        this._attachChromeMessageListener();
    }

    /**
     * Unified navigation detection manager setup. Platforms can call this with optional overrides.
     * @protected
     * @param {Object} [options]
     */
    _setupNavigationManager(options = {}) {
        try {
            const isPlayerPathFn =
                typeof this._isPlayerPath === 'function'
                    ? (pathname) => this._isPlayerPath(pathname)
                    : () => false;

            this.navigationDetectionManager = new NavigationDetectionManager(
                this.getPlatformName ? this.getPlatformName() : 'unknown',
                {
                    isPlayerPage: isPlayerPathFn,
                    onUrlChange: (oldUrl, newUrl) => {
                        // Keep compatibility with existing URL-change flow
                        try {
                            this.checkForUrlChange();
                        } catch (_) {}
                    },
                    onPageTransition: (wasPlayer, isPlayer) => {
                        try {
                            this._handlePageTransition(wasPlayer, isPlayer);
                        } catch (_) {}
                    },
                    logger: (level, message, data) =>
                        this.logWithFallback(level, message, data),
                    ...options,
                }
            );
            this.navigationDetectionManager.setupComprehensiveNavigation();
        } catch (e) {
            this.logWithFallback(
                'warn',
                'Failed to setup NavigationDetectionManager, falling back to legacy detection',
                { error: e?.message }
            );
        }
    }

    /**
     * Sets up common message handlers for all platforms.
     * @private
     */
    _setupCommonMessageHandlers() {
        const commonHandlers = [
            {
                action: MessageActions.SIDEPANEL_GET_STATE,
                handler: this.handleSidePanelGetState.bind(this),
                requiresUtilities: false,
                description: 'Return current word selection state from page highlights.',
            },
            {
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                handler: this.handleSidePanelUpdateState.bind(this),
                requiresUtilities: false,
                description: 'Apply selection updates (clear/apply highlights) from side panel.',
            },
            {
                action: MessageActions.SIDEPANEL_SET_ANALYZING,
                handler: this.handleSidePanelSetAnalyzing.bind(this),
                requiresUtilities: false,
                description: 'Update analyzing state to block/unblock word clicks.',
            },
            {
                action: MessageActions.TOGGLE_SUBTITLES,
                handler: this.handleToggleSubtitles.bind(this),
                requiresUtilities: true,
                description:
                    'Toggle subtitle display and manage platform initialization.',
            },
            {
                action: MessageActions.CONFIG_CHANGED,
                handler: this.handleConfigChanged.bind(this),
                requiresUtilities: true,
                description:
                    'Handle and apply configuration changes immediately.',
            },
            {
                action: MessageActions.LOGGING_LEVEL_CHANGED,
                handler: this.handleLoggingLevelChanged.bind(this),
                requiresUtilities: false,
                description:
                    'Update logging level for the content script logger.',
            },
            {
                action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
                handler: this.handleSidePanelPauseVideo.bind(this),
                requiresUtilities: false,
                description: 'Pause the video on the page using multiple strategies.',
            },
            {
                action: MessageActions.SIDEPANEL_RESUME_VIDEO,
                handler: this.handleSidePanelResumeVideo.bind(this),
                requiresUtilities: false,
                description: 'Resume the video on the page.',
            },
        ];

        commonHandlers.forEach(
            ({ action, handler, requiresUtilities, description }) => {
                this.registerMessageHandler(action, handler, {
                    requiresUtilities,
                    description,
                });
            }
        );
    }

    /**
     * Attaches the listener for incoming Chrome messages.
     * @private
     */
    _attachChromeMessageListener() {
        if (
            typeof chrome !== 'undefined' &&
            chrome.runtime &&
            chrome.runtime.onMessage
        ) {
            chrome.runtime.onMessage.addListener(
                this.handleChromeMessage.bind(this)
            );
            this.logWithFallback('debug', 'Chrome message listener attached.');
        } else {
            this.logWithFallback(
                'debug',
                'Chrome API not available, skipping message listener attachment.'
            );
        }
    }

    /**
     * Registers a message handler for a specific action.
     * @param {string} action - The action to handle.
     * @param {Function} handler - The handler function `(request, sendResponse) => boolean`.
     * @param {Object} [options] - Optional configuration.
     * @param {boolean} [options.requiresUtilities=true] - Whether the handler requires utilities to be loaded.
     * @param {string} [options.description] - A description of the handler.
     */
    registerMessageHandler(action, handler, options = {}) {
        if (typeof action !== 'string' || !action.trim()) {
            throw new Error('Action must be a non-empty string.');
        }

        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function.');
        }

        const handlerConfig = {
            handler,
            requiresUtilities: options.requiresUtilities !== false,
            description: options.description || `Handler for ${action}`,
            registeredAt: new Date().toISOString(),
        };

        this.messageHandlers.set(action, handlerConfig);
        this.logWithFallback('debug', 'Registered message handler.', {
            action,
            requiresUtilities: handlerConfig.requiresUtilities,
            description: handlerConfig.description,
        });
    }

    /**
     * Unregisters a message handler for a specific action.
     * @param {string} action - The action to unregister.
     * @returns {boolean} `true` if a handler was removed, otherwise `false`.
     */
    unregisterMessageHandler(action) {
        const removed = this.messageHandlers.delete(action);
        if (removed) {
            this.logWithFallback('debug', 'Unregistered message handler.', {
                action,
            });
        } else {
            this.logWithFallback(
                'warn',
                'Attempted to unregister non-existent message handler.',
                { action }
            );
        }
        return removed;
    }

    /**
     * Gets information about all registered message handlers.
     * @returns {Array<Object>} An array of handler information objects.
     */
    getRegisteredHandlers() {
        return Array.from(this.messageHandlers.entries()).map(
            ([action, config]) => ({
                action,
                requiresUtilities: config.requiresUtilities,
                description: config.description,
                registeredAt: config.registeredAt,
            })
        );
    }

    /**
     * Checks if a message handler is registered for a specific action.
     * @param {string} action - The action to check.
     * @returns {boolean} `true` if a handler is registered, otherwise `false`.
     */
    hasMessageHandler(action) {
        return this.messageHandlers.has(action);
    }

    /**
     * Registers platform-specific message handlers.
     * Subclasses can override this method to register their own handlers.
     * @protected
     */
    registerPlatformMessageHandlers() {
        this.logWithFallback(
            'debug',
            'No platform-specific message handlers to register.'
        );
    }

    /**
     * Logs a message, falling back to `console.log` if the logger is not yet initialized.
     * @param {string} level - The log level ('error', 'warn', 'info', 'debug').
     * @param {string} message - The log message.
     * @param {Object} [data={}] - Additional data to log.
     */
    logWithFallback(level, message, data = {}) {
        if (this.contentLogger) {
            this.contentLogger[level](message, data);
        } else {
            console.log(
                `[${this.logPrefix}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }

    /**
     * Create a module loader instance for dependency injection
     * This allows for better testability and separation of concerns
     * @protected
     * @returns {ModuleLoader} Module loader instance
     */
    createModuleLoader() {
        return new ModuleLoader(this.logWithFallback.bind(this));
    }

    /**
     * Create a message handler registry for extensible message handling
     * @protected
     * @returns {MessageHandlerRegistry} Message handler registry
     */
    createMessageHandlerRegistry() {
        return new MessageHandlerRegistry(this.logWithFallback.bind(this));
    }

    // ========================================
    // ABSTRACT METHODS - Must be implemented by subclasses
    // ========================================

    /**
     * Get the platform name (e.g., 'netflix', 'disneyplus').
     * @abstract
     * @returns {string} The platform name.
     */
    getPlatformName() {
        throw new Error('getPlatformName() must be implemented by subclass');
    }

    /**
     * Get the platform class constructor name.
     * @abstract
     * @returns {string} The platform class constructor name.
     */
    getPlatformClass() {
        throw new Error('getPlatformClass() must be implemented by subclass');
    }

    /**
     * Get the inject script configuration.
     * @abstract
     * @returns {{filename: string, tagId: string, eventId: string}} The inject script configuration.
     */
    getInjectScriptConfig() {
        throw new Error(
            'getInjectScriptConfig() must be implemented by subclass'
        );
    }

    /**
     * Set up platform-specific navigation detection.
     * @abstract
     */
    setupNavigationDetection() {
        throw new Error(
            'setupNavigationDetection() must be implemented by subclass'
        );
    }

    /**
     * Check for URL changes with platform-specific logic.
     * @abstract
     */
    checkForUrlChange() {
        throw new Error('checkForUrlChange() must be implemented by subclass');
    }

    /**
     * Handle platform-specific Chrome messages.
     * @abstract
     * @param {Object} request - The Chrome message request.
     * @param {Function} sendResponse - The callback to send a response.
     * @returns {boolean} `true` if the response is sent asynchronously, otherwise `false`.
     */
    handlePlatformSpecificMessage(request, sendResponse) {
        throw new Error(
            'handlePlatformSpecificMessage() must be implemented by subclass'
        );
    }

    // ========================================
    // TEMPLATE METHODS - Common initialization flow
    // ========================================

    /**
     * Main initialization method that orchestrates the entire setup process.
     * This is a template method and should not be overridden by subclasses.
     * @returns {Promise<boolean>} A promise that resolves to `true` if initialization is successful, otherwise `false`.
     */
    async initialize() {
        try {
            this.logWithFallback(
                'info',
                'Starting content script initialization'
            );

            if (!(await this.initializeCore())) {
                this.logWithFallback(
                    'error',
                    'Initialization failed at core module setup.'
                );
                return false;
            }

            if (!(await this.initializeConfiguration())) {
                this.logWithFallback(
                    'error',
                    'Initialization failed at configuration setup.'
                );
                return false;
            }

            if (!(await this.initializeEventHandling())) {
                this.logWithFallback(
                    'error',
                    'Initialization failed at event handling setup.'
                );
                return false;
            }

            if (!(await this.initializeObservers())) {
                this.logWithFallback(
                    'error',
                    'Initialization failed at observer setup.'
                );
                return false;
            }

            // Initialize AI context features if enabled
            if (!(await this.initializeAIContextFeatures())) {
                this.logWithFallback(
                    'warn',
                    'AI context features initialization failed, continuing without AI context.'
                );
                // Don't fail the entire initialization for AI context issues
            }

            this.logWithFallback(
                'info',
                'Content script initialization completed successfully'
            );
            return true;
        } catch (error) {
            this.logWithFallback(
                'error',
                'An unexpected error occurred during initialization.',
                {
                    error: error.message,
                    stack: error.stack,
                }
            );
            return false;
        }
    }

    /**
     * Initializes core modules and services.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeCore() {
        try {
            this.logWithFallback('debug', 'Loading required modules...');
            if (!(await this.loadModules())) {
                this.logWithFallback(
                    'error',
                    'Failed to load required modules.'
                );
                return false;
            }
            this.logWithFallback(
                'debug',
                'All required modules loaded successfully.'
            );
            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error initializing core modules.', {
                error: error.message,
                stack: error.stack,
            });
            return false;
        }
    }

    /**
     * Initializes configuration and sets up listeners for changes.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeConfiguration() {
        try {
            // Check if chrome storage is available before proceeding
            if (!chrome || !chrome.storage) {
                this.logWithFallback(
                    'warn',
                    'Chrome storage API not available, using default configuration'
                );
                this.currentConfig = this._getDefaultConfiguration();
                this._normalizeConfiguration();
                return true; // Continue with defaults
            }

            this.logWithFallback(
                'debug',
                'Loading configuration from configService...'
            );

            try {
                this.currentConfig = await this.configService.getAll();
            } catch (configError) {
                this.logWithFallback(
                    'warn',
                    'Failed to load configuration from storage, using defaults',
                    {
                        error: configError.message,
                    }
                );
                this.currentConfig = this._getDefaultConfiguration();
            }

            this._normalizeConfiguration();
            this.logWithFallback('info', 'Loaded initial configuration.', {
                config: this.currentConfig,
            });

            this.logWithFallback(
                'debug',
                'Setting up configuration listeners...'
            );

            try {
                this.setupConfigurationListeners();
                this.logWithFallback(
                    'debug',
                    'Configuration listeners set up successfully.'
                );
            } catch (listenerError) {
                this.logWithFallback(
                    'warn',
                    'Failed to setup configuration listeners, continuing without live updates',
                    {
                        error: listenerError.message,
                    }
                );
            }

            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error initializing configuration.', {
                error: error.message,
                stack: error.stack,
            });

            // Try to continue with default configuration
            try {
                this.currentConfig = this._getDefaultConfiguration();
                this._normalizeConfiguration();
                this.logWithFallback(
                    'warn',
                    'Continuing with default configuration after initialization error'
                );
                return true;
            } catch (fallbackError) {
                this.logWithFallback(
                    'error',
                    'Failed to initialize even with default configuration',
                    {
                        error: fallbackError.message,
                    }
                );
                return false;
            }
        }
    }

    /**
     * Initializes event handling and the platform-specific logic.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeEventHandling() {
        try {
            this.logWithFallback('debug', 'Setting up early event handling...');
            this.setupEarlyEventHandling();
            this.logWithFallback(
                'debug',
                'Early event handling set up successfully.'
            );

            if (this.currentConfig.subtitlesEnabled) {
                this.logWithFallback(
                    'debug',
                    'Subtitles enabled, initializing platform...'
                );
                await this.initializePlatform();
            } else {
                this.logWithFallback(
                    'debug',
                    'Subtitles disabled, skipping platform initialization.'
                );
            }
            return true;
        } catch (error) {
            this.logWithFallback(
                'error',
                'Error initializing event handling.',
                {
                    error: error.message,
                    stack: error.stack,
                }
            );
            return false;
        }
    }

    /**
     * Initializes observers and cleanup handlers.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeObservers() {
        try {
            this.logWithFallback('debug', 'Setting up navigation detection...');
            this.setupNavigationDetection();
            this.logWithFallback(
                'debug',
                'Navigation detection set up successfully.'
            );

            this.logWithFallback('debug', 'Setting up DOM observation...');
            this.setupDOMObservation();
            this.logWithFallback(
                'debug',
                'DOM observation set up successfully.'
            );

            this.logWithFallback('debug', 'Setting up cleanup handlers...');
            this.setupCleanupHandlers();
            this.logWithFallback(
                'debug',
                'Cleanup handlers set up successfully.'
            );

            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error initializing observers.', {
                error: error.message,
                stack: error.stack,
            });
            return false;
        }
    }

    /**
     * Initialize AI context features if enabled in configuration
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeAIContextFeatures() {
        try {
            this.logWithFallback(
                'debug',
                'Checking AI context configuration...'
            );

            // Check if configuration is available
            if (!this.configService) {
                this.logWithFallback(
                    'debug',
                    'Config service not available, skipping AI context initialization'
                );
                return false;
            }

            // Get AI context configuration
            const aiContextConfig = await this._getAIContextConfiguration();

            if (!aiContextConfig.aiContextEnabled) {
                this.logWithFallback(
                    'debug',
                    'AI context disabled in configuration, but initializing interactive subtitles'
                );

                // Even if AI Context is disabled, we should still initialize interactive subtitles
                // so that words are clickable (they just won't trigger AI analysis)
                await this._initializeInteractiveSubtitlesOnly(aiContextConfig);
                return true; // Not an error, just disabled
            }

            this.logWithFallback(
                'info',
                'Initializing AI context features with new modular system...',
                {
                    platform: this.getPlatformName(),
                    config: aiContextConfig,
                }
            );

            // Initialize side panel integration early so it captures events before modal listeners
            await this._initializeSidePanelIntegration();

            // Initialize new modular AI Context Manager
            if (!this.aiContextManager) {
                try {
                    // Import the new AIContextManager
                    const { AIContextManager } = await import(
                        chrome.runtime.getURL(
                            'content_scripts/aicontext/core/AIContextManager.js'
                        )
                    );

                    // Create and initialize the manager
                    this.aiContextManager = new AIContextManager(
                        this.getPlatformName(),
                        {
                            modal: {
                                maxWidth: '900px',
                                maxHeight: '80vh',
                                contentScript: this, // Pass content script reference for config access
                            },
                            provider: {
                                timeout:
                                    aiContextConfig.aiContextTimeout || 30000,
                                maxRetries: 3,
                            },
                            textHandler: {
                                maxSelectionLength:
                                    aiContextConfig.maxSelectionLength || 500,
                                minSelectionLength: 2,
                                smartBoundaries: true,
                                autoAnalysis: true, // Enable automatic text selection analysis
                            },
                            contentScript: this, // Also pass at top level for manager access
                        }
                    );

                    const initResult = await this.aiContextManager.initialize();

                    if (initResult) {
                        // Enable features based on configuration
                        // Always enable interactive subtitles
                        await this.aiContextManager.enableFeature(
                            'interactiveSubtitles'
                        );

                        await this.aiContextManager.enableFeature(
                            'contextModal'
                        );
                        await this.aiContextManager.enableFeature(
                            'textSelection'
                        );

                        this.logWithFallback(
                            'info',
                            'New AI Context Manager initialized successfully',
                            {
                                platform: this.getPlatformName(),
                                features:
                                    this.aiContextManager.getEnabledFeatures(),
                            }
                        );

                        // Setup AI Context event listeners
                        this._setupAIContextEventListeners();

                        // Setup fullscreen handling for UI root container
                        this._setupFullscreenHandling();

                        // CRITICAL: Initialize interactive features in legacy SubtitleUtils
                        // This ensures subtitle formatting works with the new AI Context system
                        await this._initializeSubtitleUtilsInteractiveFeatures(
                            aiContextConfig
                        );
                    } else {
                        throw new Error(
                            'AIContextManager initialization failed'
                        );
                    }
                } catch (error) {
                    this.logWithFallback(
                        'error',
                        'Failed to initialize new AI Context Manager, falling back to legacy system',
                        error
                    );

                    // Fallback to legacy system
                    return await this._initializeLegacyAIContextFeatures(
                        aiContextConfig
                    );
                }
            }

            return true;
        } catch (error) {
            this.logWithFallback(
                'error',
                'Error initializing AI context features.',
                {
                    error: error.message,
                    stack: error.stack,
                    platform: this.getPlatformName(),
                }
            );
            return false;
        }
    }

    /**
     * Initialize legacy AI context features as fallback
     * @param {Object} aiContextConfig - AI context configuration
     * @returns {Promise<boolean>} Success status
     * @private
     */
    async _initializeLegacyAIContextFeatures(aiContextConfig) {
        try {
            this.logWithFallback(
                'info',
                'Initializing legacy AI context features...',
                {
                    platform: this.getPlatformName(),
                }
            );

            // Initialize interactive subtitle features if subtitle utilities are available
            if (
                this.subtitleUtils &&
                this.subtitleUtils.initializeInteractiveSubtitleFeatures
            ) {
                await this.subtitleUtils.initializeInteractiveSubtitleFeatures({
                    enabled: true, // Always enable interactive subtitles
                    contextTypes: aiContextConfig.aiContextTypes || [
                        'cultural',
                        'historical',
                        'linguistic',
                    ],
                    interactionMethods: {
                        click: true, // Always enable click interactions
                        selection: true, // Always enable selection interactions
                    },
                    textSelection: {
                        maxLength: 100,
                        smartBoundaries: true,
                    },
                    loadingStates: {
                        timeout: aiContextConfig.aiContextTimeout || 30000,
                        retryAttempts:
                            aiContextConfig.aiContextRetryAttempts || 3,
                    },
                    platform: this.getPlatformName(),
                });

                this.logWithFallback(
                    'info',
                    'Legacy AI context features initialized successfully',
                    {
                        platform: this.getPlatformName(),
                    }
                );
                return true;
            } else {
                this.logWithFallback(
                    'warn',
                    'Subtitle utilities not available for legacy AI context initialization'
                );
                return false;
            }
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to initialize legacy AI context features',
                {
                    error: error.message,
                    stack: error.stack,
                    platform: this.getPlatformName(),
                }
            );
            return false;
        }
    }

    /**
     * Setup AI Context event listeners for cross-component communication
     * @private
     */
    _setupAIContextEventListeners() {
        if (!this.aiContextManager) {
            this.logWithFallback(
                'debug',
                'AI Context Manager not available, skipping event listener setup'
            );
            return;
        }

        try {
            // Listen for system events from AI Context Manager
            const systemInitializedListener = (event) => {
                this.logWithFallback('info', 'AI Context system initialized', {
                    platform: event.detail.platform,
                    features: event.detail.features,
                    initTime: event.detail.initTime,
                });
            };
            document.addEventListener(
                'dualsub-system-initialized',
                systemInitializedListener
            );
            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(
                    'dualsub-system-initialized',
                    systemInitializedListener
                );
            });

            // Listen for analysis completion events
            const analysisCompleteListener = (event) => {
                this.logWithFallback('debug', 'AI Context analysis completed', {
                    requestId: event.detail.requestId,
                    success: event.detail.success,
                });
            };
            document.addEventListener(
                'dualsub-analysis-complete',
                analysisCompleteListener
            );
            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(
                    'dualsub-analysis-complete',
                    analysisCompleteListener
                );
            });

            // Listen for analysis error events
            const analysisErrorListener = (event) => {
                this.logWithFallback('warn', 'AI Context analysis error', {
                    requestId: event.detail.requestId,
                    error: event.detail.error,
                });
            };
            document.addEventListener(
                'dualsub-analysis-error',
                analysisErrorListener
            );
            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(
                    'dualsub-analysis-error',
                    analysisErrorListener
                );
            });

            // Listen for modal state changes
            const modalStateListener = (event) => {
                this.logWithFallback(
                    'debug',
                    'AI Context modal state changed',
                    {
                        state: event.detail.state,
                        visible: event.detail.visible,
                    }
                );
            };
            document.addEventListener(
                'dualsub-modal-state-change',
                modalStateListener
            );
            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(
                    'dualsub-modal-state-change',
                    modalStateListener
                );
            });

            this.logWithFallback(
                'debug',
                'AI Context event listeners setup complete',
                {
                    platform: this.getPlatformName(),
                }
            );
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to setup AI Context event listeners',
                {
                    error: error.message,
                    stack: error.stack,
                }
            );
        }
    }

    /**
     * Setup fullscreen transition handling for UI root container
     * @private
     */
    _setupFullscreenHandling() {
        const handleFullscreenChange = () => {
            const uiRoot = getOrCreateUiRoot();
            const fullscreenElement = document.fullscreenElement;

            if (fullscreenElement) {
                // Entering fullscreen: move UI root into fullscreen element
                this.logWithFallback(
                    'info',
                    'Entering fullscreen, moving UI root.',
                    {
                        fullscreenElement: fullscreenElement.tagName,
                    }
                );
                fullscreenElement.appendChild(uiRoot);
            } else {
                // Exiting fullscreen: move UI root back to body
                this.logWithFallback(
                    'info',
                    'Exiting fullscreen, moving UI root back to body.'
                );
                document.body.appendChild(uiRoot);
            }

            // Recalculate positions after container move
            if (this.subtitleUtils?.updateSubtitlePosition) {
                this.subtitleUtils.updateSubtitlePosition(this.activePlatform);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);

        // Add cleanup for fullscreen listener
        this.eventListenerCleanupFunctions.push(() => {
            document.removeEventListener(
                'fullscreenchange',
                handleFullscreenChange
            );
        });

        this.logWithFallback('debug', 'Fullscreen handling setup complete');
    }

    /**
     * Initialize side panel integration for routing word selections
     * @returns {Promise<void>}
     * @private
     */
    async _initializeSidePanelIntegration() {
        try {
            this.logWithFallback(
                'info',
                'Initializing side panel integration...',
                {
                    platform: this.getPlatformName(),
                }
            );

            // Create inline side panel integration
            this.sidePanelIntegration = {
                initialized: false,
                sidePanelEnabled: false,
                useSidePanel: false,
                isAnalyzing: false,
                boundHandler: null,

                async initialize() {
                    if (this.initialized) return;

                    // Prepare logger bridge and messaging wrapper
                    this._log = (level, message, data) => {
                        try {
                            window.__dualsub_log?.(level, message, data);
                        } catch (_) {}
                        try {
                            // Use outer class logger if available
                            (typeof level === 'string'
                                ? level
                                : 'debug') &&
                                (typeof message === 'string');
                        } catch (_) {}
                    };

                    // Load robust messaging wrapper (reuses existing implementation)
                    try {
                        const { sendRuntimeMessageWithRetry } = await import(
                            chrome.runtime.getURL(
                                'content_scripts/shared/messaging.js'
                            )
                        );
                        this._send = (msg) =>
                            sendRuntimeMessageWithRetry(msg, {
                                retries: 3,
                                baseDelayMs: 120,
                            });
                    } catch (_) {
                        this._send = (msg) => chrome.runtime.sendMessage(msg);
                    }

                    // Check settings
                    await this.checkSettings();

                    // Create bound handler
                    this.boundHandler = this.handleWordSelection.bind(this);

                    // Listen for word selection events in capture phase (register early)
                    document.addEventListener(
                        'dualsub-word-selected',
                        this.boundHandler,
                        { capture: true }
                    );

                    // Listen for storage changes
                    chrome.storage.onChanged.addListener((changes, area) => {
                        if (area === 'sync') {
                            if (changes.sidePanelEnabled || changes.sidePanelUseSidePanel) {
                                this.checkSettings();
                            }
                        }
                    });

                    this.initialized = true;
                },

                async checkSettings() {
                    try {
                        const settings = await chrome.storage.sync.get([
                            'sidePanelEnabled',
                            'sidePanelUseSidePanel',
                        ]);
                        this.sidePanelEnabled = settings.sidePanelEnabled !== false;
                        this.useSidePanel = settings.sidePanelUseSidePanel !== false;
                    } catch (error) {
                        this.sidePanelEnabled = false;
                        this.useSidePanel = false;
                    }
                },

                async handleWordSelection(event) {
                    if (!this.sidePanelEnabled || !this.useSidePanel) {
                        return;
                    }

                    // Block word clicks during analysis
                    if (this.isAnalyzing) {
                        event.stopPropagation();
                        event.stopImmediatePropagation();
                        return;
                    }

                    const { word, element, sourceLanguage, targetLanguage, context, subtitleType } = event.detail || {};
                    if (!word) return;

                    try {
                        // Prevent modal from handling
                        event.stopPropagation();
                        event.stopImmediatePropagation();

                        // 1) Best-effort immediate open (do NOT await to preserve user gesture)
                        try {
                            // Fire-and-forget
                            void this._send({
                                action: MessageActions.SIDEPANEL_OPEN,
                                options: { pauseVideo: true, openReason: 'word-click', activeTab: 'ai-analysis' },
                            });
                        } catch (_) {}

                        // 2) Forward word selection (ok to await)
                        const resp = await this._send({
                            action: MessageActions.SIDEPANEL_WORD_SELECTED,
                            word,
                            sourceLanguage,
                            targetLanguage,
                            context,
                            subtitleType,
                            action: 'toggle',
                            timestamp: Date.now(),
                        });

                        // Visual feedback: toggle selection like legacy modal (do not clear all)
                        if (element) {
                            if (element.classList.contains('dualsub-word-selected')) {
                                element.classList.remove('dualsub-word-selected');
                            } else {
                                element.classList.add('dualsub-word-selected');
                            }
                        }
                    } catch (error) {
                        console.error('[SidePanelIntegration] Error forwarding word selection:', error);
                    }
                },

                destroy() {
                    if (!this.initialized) return;
                    if (this.boundHandler) {
                        document.removeEventListener(
                            'dualsub-word-selected',
                            this.boundHandler,
                            { capture: true }
                        );
                    }
                    this.initialized = false;
                },

                isSidePanelEnabled() {
                    return this.sidePanelEnabled && this.useSidePanel;
                }
            };

            await this.sidePanelIntegration.initialize();

            // Add cleanup function
            this.eventListenerCleanupFunctions.push(() => {
                if (this.sidePanelIntegration) {
                    this.sidePanelIntegration.destroy();
                }
            });

            this.logWithFallback(
                'info',
                'Side panel integration initialized successfully',
                {
                    platform: this.getPlatformName(),
                    enabled: this.sidePanelIntegration.isSidePanelEnabled(),
                }
            );
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to initialize side panel integration',
                {
                    error: error.message,
                    stack: error.stack,
                    platform: this.getPlatformName(),
                }
            );
            // Non-critical error, continue without side panel integration
        }
    }

    /**
     * Initialize interactive subtitles only (without AI Context)
     * This makes words clickable even when AI Context is disabled
     * @param {Object} aiContextConfig - AI context configuration
     * @returns {Promise<void>}
     * @private
     */
    async _initializeInteractiveSubtitlesOnly(aiContextConfig) {
        try {
            this.logWithFallback(
                'info',
                'Initializing interactive subtitles only (AI Context disabled)',
                {
                    platform: this.getPlatformName(),
                    hasSubtitleUtils: !!this.subtitleUtils,
                }
            );

            // Initialize interactive subtitle features in SubtitleUtils
            if (
                this.subtitleUtils &&
                this.subtitleUtils.initializeInteractiveSubtitleFeatures
            ) {
                await this.subtitleUtils.initializeInteractiveSubtitleFeatures({
                    enabled: true, // Always enable interactive subtitles
                    contextTypes: [], // No AI context types since AI is disabled
                    interactionMethods: {
                        click: true, // Enable word clicks
                        selection: false, // Disable text selection since no AI analysis
                    },
                    textSelection: {
                        maxLength: 100,
                        smartBoundaries: true,
                    },
                    loadingStates: {
                        timeout: 5000, // Shorter timeout since no AI analysis
                        retryAttempts: 1,
                    },
                    platform: this.getPlatformName(),
                });

                this.logWithFallback(
                    'info',
                    'Interactive subtitles initialized successfully (without AI Context)',
                    {
                        platform: this.getPlatformName(),
                    }
                );

                // Setup fullscreen handling for interactive subtitles
                this._setupFullscreenHandling();
            } else {
                this.logWithFallback(
                    'warn',
                    'SubtitleUtils not available for interactive subtitle initialization',
                    {
                        hasSubtitleUtils: !!this.subtitleUtils,
                        hasInitMethod:
                            !!this.subtitleUtils
                                ?.initializeInteractiveSubtitleFeatures,
                    }
                );
            }
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to initialize interactive subtitles',
                {
                    error: error.message,
                    stack: error.stack,
                    platform: this.getPlatformName(),
                }
            );
        }
    }

    /**
     * Initialize interactive features in legacy SubtitleUtils system
     * This ensures subtitle formatting works with the new AI Context system
     * @param {Object} aiContextConfig - AI context configuration
     * @returns {Promise<void>}
     * @private
     */
    async _initializeSubtitleUtilsInteractiveFeatures(aiContextConfig) {
        try {
            this.logWithFallback(
                'info',
                'Initializing SubtitleUtils interactive features for new AI Context system',
                {
                    platform: this.getPlatformName(),
                    hasSubtitleUtils: !!this.subtitleUtils,
                }
            );

            // Initialize interactive subtitle features in legacy SubtitleUtils
            if (
                this.subtitleUtils &&
                this.subtitleUtils.initializeInteractiveSubtitleFeatures
            ) {
                await this.subtitleUtils.initializeInteractiveSubtitleFeatures({
                    enabled: true, // Always enable interactive subtitles
                    contextTypes: aiContextConfig.aiContextTypes || [
                        'cultural',
                        'historical',
                        'linguistic',
                    ],
                    interactionMethods: {
                        click: true, // Always enable click interactions
                        selection: true, // Always enable selection interactions
                    },
                    textSelection: {
                        maxLength: 100,
                        smartBoundaries: true,
                    },
                    loadingStates: {
                        timeout: aiContextConfig.aiContextTimeout || 30000,
                        retryAttempts:
                            aiContextConfig.aiContextRetryAttempts || 3,
                    },
                    platform: this.getPlatformName(),
                });

                this.logWithFallback(
                    'info',
                    'SubtitleUtils interactive features initialized successfully',
                    {
                        platform: this.getPlatformName(),
                    }
                );
            } else {
                this.logWithFallback(
                    'warn',
                    'SubtitleUtils not available for interactive feature initialization',
                    {
                        hasSubtitleUtils: !!this.subtitleUtils,
                        hasInitMethod:
                            !!this.subtitleUtils
                                ?.initializeInteractiveSubtitleFeatures,
                    }
                );
            }
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to initialize SubtitleUtils interactive features',
                {
                    error: error.message,
                    stack: error.stack,
                    platform: this.getPlatformName(),
                }
            );
        }
    }

    /**
     * Get AI context configuration from config service
     * @returns {Promise<Object>} AI context configuration
     * @private
     */
    async _getAIContextConfiguration() {
        try {
            const configKeys = [
                'aiContextEnabled',
                'aiContextProvider',
                'aiContextTypes',
                'aiContextTimeout',
                'aiContextRetryAttempts',
            ];

            const config = {};
            for (const key of configKeys) {
                try {
                    config[key] = await this.configService.get(key);
                } catch (error) {
                    this.logWithFallback(
                        'debug',
                        `Failed to get config key: ${key}`,
                        {
                            error: error.message,
                        }
                    );
                    // Use default values for missing keys
                    config[key] = this._getDefaultAIContextValue(key);
                }
            }

            return config;
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to get AI context configuration',
                {
                    error: error.message,
                }
            );
            return this._getDefaultAIContextConfiguration();
        }
    }

    /**
     * Get default AI context configuration
     * @returns {Object} Default configuration
     * @private
     */
    _getDefaultAIContextConfiguration() {
        return {
            aiContextEnabled: true, // Enable by default for development/testing
            aiContextProvider: 'openai',
            aiContextTypes: ['cultural', 'historical', 'linguistic'],
            aiContextTimeout: 30000,
            aiContextRetryAttempts: 3,
            aiContextUserConsent: true,
        };
    }

    /**
     * Get default value for AI context configuration key
     * @param {string} key - Configuration key
     * @returns {*} Default value
     * @private
     */
    _getDefaultAIContextValue(key) {
        const defaults = this._getDefaultAIContextConfiguration();
        return defaults[key];
    }

    /**
     * Loads required modules dynamically.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async loadModules() {
        try {
            await this._loadSubtitleUtilities();
            await this._loadPlatformClass();
            await this._loadConfigService();
            await this._loadAndInitializeLogger();
            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error loading modules.', {
                error: error.message,
                stack: error.stack,
            });
            return false;
        }
    }

    /**
     * Loads the subtitle utilities module.
     * @private
     */
    async _loadSubtitleUtilities() {
        try {
            const utilsUrl = chrome.runtime.getURL(
                'content_scripts/shared/subtitleUtilities.js'
            );
            this.logWithFallback('debug', 'Loading subtitle utilities.', {
                url: utilsUrl,
            });
            const utilsModule = await import(utilsUrl);
            this.subtitleUtils = utilsModule;
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to load subtitle utilities.',
                {
                    error: error.message,
                }
            );
            throw error;
        }
    }

    /**
     * Loads the platform-specific class.
     * @private
     */
    async _loadPlatformClass() {
        try {
            const platformName = this.getPlatformName();
            const fileName = this._getPlatformFileName(platformName);
            const className = this.getPlatformClass();
            const platformUrl = chrome.runtime.getURL(
                `video_platforms/${fileName}`
            );

            this.logWithFallback('debug', 'Loading platform class.', {
                platformName,
                fileName,
                className,
                url: platformUrl,
            });

            const platformModule = await import(platformUrl);
            this.PlatformClass = platformModule[className];

            if (!this.PlatformClass) {
                throw new Error(
                    `Platform class '${className}' not found in module.`
                );
            }
        } catch (error) {
            this.logWithFallback('error', 'Failed to load platform class.', {
                error: error.message,
                platformName: this.getPlatformName(),
            });
            throw error;
        }
    }

    /**
     * Gets the platform file name from the platform name.
     * @private
     * @param {string} platformName - The name of the platform.
     * @returns {string} The corresponding file name.
     */
    _getPlatformFileName(platformName) {
        if (platformName === 'disneyplus') return 'disneyPlusPlatform.js';
        if (platformName === 'netflix') return 'netflixPlatform.js';
        return `${platformName.charAt(0).toUpperCase()}${platformName.slice(1)}Platform.js`;
    }

    /**
     * Gets the platform class name from the platform name.
     * @private
     * @param {string} platformName - The name of the platform.
     * @returns {string} The corresponding class name.
     */
    _getPlatformClassName(platformName) {
        return this.getPlatformClass();
    }

    /**
     * Loads the configuration service.
     * @private
     */
    async _loadConfigService() {
        try {
            const configUrl = chrome.runtime.getURL(
                'services/configService.js'
            );
            this.logWithFallback('debug', 'Loading config service.', {
                url: configUrl,
            });
            const configModule = await import(configUrl);
            this.configService = configModule.configService;

            if (!this.configService) {
                throw new Error('configService not found in module.');
            }
        } catch (error) {
            this.logWithFallback('error', 'Failed to load config service.', {
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Loads and initializes the logger.
     * @private
     */
    async _loadAndInitializeLogger() {
        try {
            const loggerUrl = chrome.runtime.getURL('utils/logger.js');
            this.logWithFallback('debug', 'Loading logger.', {
                url: loggerUrl,
            });
            const loggerModule = await import(loggerUrl);
            const Logger = loggerModule.default;

            if (!Logger) {
                throw new Error('Logger not found in module.');
            }

            this.contentLogger = Logger.create(this.logPrefix);
            await this._initializeLoggerLevel(Logger);
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to load and initialize logger.',
                {
                    error: error.message,
                }
            );
            throw error;
        }
    }

    /**
     * Initializes the logger level from configuration.
     * @private
     * @param {Object} Logger - The Logger class.
     */
    async _initializeLoggerLevel(Logger) {
        try {
            const loggingLevel = await this.configService.get('loggingLevel');
            this.contentLogger.updateLevel(loggingLevel);
            this.contentLogger.info('Content script logger initialized', {
                level: loggingLevel,
            });
        } catch (error) {
            // Fallback to INFO level if config can't be read
            this.contentLogger.updateLevel(Logger.LEVELS.INFO);
            this.contentLogger.warn(
                'Failed to load logging level from config, using INFO level',
                error
            );
        }
    }

    /**
     * Initialize the platform instance with error handling and retry logic
     * Template method that orchestrates platform initialization with robust error handling
     * @param {number} retryCount - Current retry attempt (internal use)
     * @returns {Promise<boolean>} Success status
     */
    async initializePlatform(retryCount = 0) {
        const initializationContext =
            this._createInitializationContext(retryCount);

        if (!this._validateInitializationPrerequisites()) {
            return false;
        }

        try {
            return await this._executeInitializationFlow(initializationContext);
        } catch (error) {
            return await this._handleInitializationError(
                error,
                initializationContext
            );
        }
    }

    /**
     * Create initialization context with configuration and state
     * @private
     * @param {number} retryCount - Current retry attempt
     * @returns {Object} Initialization context
     */
    _createInitializationContext(retryCount) {
        const retryConfig = this._getRetryConfiguration();

        return {
            retryCount,
            maxRetries: retryConfig.maxRetries,
            retryDelay: retryConfig.retryDelay,
            attempt: retryCount + 1,
            totalAttempts: retryConfig.maxRetries + 1,
        };
    }

    /**
     * Validate essential prerequisites for initialization (only platform class).
     * @private
     * @returns {boolean} Whether prerequisites are met
     */
    _validateInitializationPrerequisites() {
        return this._validateModulesLoaded();
    }

    /**
     * Execute the main initialization flow
     * @private
     * @param {Object} context - Initialization context
     * @returns {Promise<boolean>} Success status
     */
    async _executeInitializationFlow(context) {
        this._logInitializationStart(context);

        await this._prepareForInitialization();
        this.activePlatform = await this._createPlatformInstance();

        return await this._initializeBasedOnPageType();
    }

    // ========================================
    // PLATFORM INITIALIZATION HELPERS - Private methods for initialization flow
    // ========================================

    /**
     * Get retry configuration from current config or defaults
     * @private
     * @returns {Object} Retry configuration
     */
    _getRetryConfiguration() {
        return {
            maxRetries:
                this.currentConfig?.platformInitMaxRetries ||
                COMMON_CONSTANTS.PLATFORM_INIT_MAX_RETRIES,
            retryDelay:
                this.currentConfig?.platformInitRetryDelay ||
                COMMON_CONSTANTS.PLATFORM_INIT_RETRY_DELAY,
        };
    }

    /**
     * Validate that required modules are loaded
     * @private
     * @returns {boolean} Validation result
     */
    _validateModulesLoaded() {
        if (!this.PlatformClass || !this.subtitleUtils || !this.configService) {
            this.logWithFallback(
                'error',
                'Required modules not loaded for platform initialization'
            );
            return false;
        }
        return true;
    }

    /**
     * Log initialization start with attempt information
     * @private
     * @param {number} retryCount - Current retry count
     * @param {number} maxRetries - Maximum retries allowed
     */
    _logInitializationStart(retryCount, maxRetries) {
        this.logWithFallback('info', 'Starting platform initialization', {
            attempt: retryCount + 1,
            maxRetries: maxRetries + 1,
        });
    }

    /**
     * Prepare for platform initialization
     * @private
     * @returns {Promise<void>}
     */
    async _prepareForInitialization() {
        // Sync subtitleUtils state with saved configuration
        if (
            this.subtitleUtils &&
            typeof this.subtitleUtils.setSubtitlesActive === 'function'
        ) {
            this.subtitleUtils.setSubtitlesActive(
                this.currentConfig.subtitlesEnabled
            );
        }

        // Clean up any existing platform instance
        if (this.activePlatform) {
            await this._cleanupPlatformInstance();
        }
    }

    /**
     * Initialize platform based on page type (player vs non-player)
     * @private
     * @returns {Promise<boolean>} Success status
     */
    async _initializeBasedOnPageType() {
        // Check if platform was cleaned up during initialization
        if (!this.activePlatform) {
            this.logWithFallback(
                'warn',
                'Platform cleaned up during initialization, aborting'
            );
            return false;
        }

        if (this.activePlatform.isPlayerPageActive()) {
            return await this._initializeForPlayerPage();
        } else {
            return this._initializeForNonPlayerPage();
        }
    }

    /**
     * Initialize platform for player page
     * @private
     * @returns {Promise<boolean>} Success status
     */
    async _initializeForPlayerPage() {
        this.logWithFallback('info', 'Initializing platform on player page');

        await this._initializePlatformWithTimeout();

        // Check if platform was cleaned up during async initialization
        if (!this.activePlatform) {
            this.logWithFallback(
                'warn',
                'Platform cleaned up during player page initialization, aborting'
            );
            return false;
        }

        this.activePlatform.handleNativeSubtitles();

        this.platformReady = true;
        this.processBufferedEvents();
        this.startVideoElementDetection();

        this.logWithFallback(
            'info',
            'Platform initialization completed successfully'
        );
        return true;
    }

    /**
     * Initialize platform for non-player page
     * @private
     * @returns {boolean} Success status
     */
    _initializeForNonPlayerPage() {
        this.logWithFallback('info', 'Not on a player page. UI setup deferred');
        if (this.subtitleUtils && this.subtitleUtils.hideSubtitleContainer) {
            this.subtitleUtils.hideSubtitleContainer();
        }
        return true;
    }

    /**
     * Handle initialization error with retry logic
     * @private
     * @param {Error} error - The error that occurred
     * @param {Object} context - Initialization context
     * @returns {Promise<boolean>} Success status
     */
    async _handleInitializationError(error, context) {
        if (error.message?.includes('Extension context invalidated')) {
            this.logWithFallback(
                'warn',
                'Extension context invalidated during platform initialization. Aborting and cleaning up.'
            );
            await this.cleanup();
            return false;
        }

        this.logWithFallback('error', 'Error initializing platform', {
            error: error.message,
            stack: error.stack,
            name: error.name,
            attempt: context.attempt,
            maxRetries: context.totalAttempts,
        });

        await this._cleanupPartialInitialization();

        if (context.retryCount < context.maxRetries) {
            return await this._scheduleRetry(
                context.retryCount,
                context.retryDelay
            );
        } else {
            return this._handleMaxRetriesExceeded();
        }
    }

    /**
     * Schedule a retry with exponential backoff
     * @private
     * @param {number} retryCount - Current retry count
     * @param {number} baseDelay - Base delay for retry
     * @returns {Promise<boolean>} Success status
     */
    async _scheduleRetry(retryCount, baseDelay) {
        const delay = baseDelay * Math.pow(2, retryCount);
        this.logWithFallback(
            'info',
            `Retrying platform initialization in ${delay}ms`,
            {
                nextAttempt: retryCount + 2,
                delay,
            }
        );

        return new Promise((resolve) => {
            setTimeout(async () => {
                const result = await this.initializePlatform(retryCount + 1);
                resolve(result);
            }, delay);
        });
    }

    /**
     * Handle case when maximum retries are exceeded
     * @private
     * @returns {boolean} Success status (always false)
     */
    _handleMaxRetriesExceeded() {
        this.logWithFallback(
            'error',
            'Platform initialization failed after all retry attempts'
        );
        this.activePlatform = null;
        this.platformReady = false;
        return false;
    }

    /**
     * Validate platform prerequisites before initialization
     * @private
     * @returns {boolean} Validation result
     */
    _validatePlatformPrerequisites() {
        if (!this.PlatformClass) {
            this.logWithFallback('error', 'Platform class not loaded');
            return false;
        }

        if (!this.subtitleUtils) {
            this.logWithFallback('error', 'Subtitle utilities not loaded');
            return false;
        }

        if (!this.configService) {
            this.logWithFallback('error', 'Config service not loaded');
            return false;
        }

        if (!this.currentConfig) {
            this.logWithFallback('error', 'Configuration not loaded');
            return false;
        }

        return true;
    }

    /**
     * Create platform instance with error handling
     * @private
     * @returns {Promise<Object>} Platform instance
     */
    async _createPlatformInstance() {
        try {
            const platform = new this.PlatformClass();
            this.logWithFallback(
                'debug',
                'Platform instance created successfully',
                {
                    platformName: this.getPlatformName(),
                    className: this.PlatformClass.name,
                }
            );
            return platform;
        } catch (error) {
            const errorContext = {
                error: error.message,
                stack: error.stack,
                platformName: this.getPlatformName(),
                className: this.PlatformClass?.name || 'unknown',
                currentUrl: window.location.href,
            };
            this.logWithFallback(
                'error',
                'Failed to create platform instance',
                errorContext
            );
            throw new Error(`Platform instantiation failed: ${error.message}`);
        }
    }

    /**
     * Initialize platform with timeout protection
     * @private
     * @returns {Promise<void>}
     */
    async _initializePlatformWithTimeout() {
        const timeout =
            this.currentConfig?.platformInitTimeout ||
            COMMON_CONSTANTS.PLATFORM_INIT_TIMEOUT;

        const initPromise = this.activePlatform.initialize(
            (subtitleData) => this.handleSubtitleDataFound(subtitleData),
            (newVideoId) => this.handleVideoIdChange(newVideoId)
        );

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(
                    new Error(
                        `Platform initialization timed out after ${timeout}ms`
                    )
                );
            }, timeout);
        });

        await Promise.race([initPromise, timeoutPromise]);
        this.logWithFallback('debug', 'Platform initialized within timeout');
    }

    /**
     * Clean up existing platform instance
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupPlatformInstance() {
        try {
            if (
                this.activePlatform &&
                typeof this.activePlatform.cleanup === 'function'
            ) {
                await this.activePlatform.cleanup();
                this.logWithFallback(
                    'debug',
                    'Previous platform instance cleaned up'
                );
            }
        } catch (error) {
            this.logWithFallback(
                'warn',
                'Error cleaning up previous platform instance',
                { error }
            );
        }
        this.activePlatform = null;
        this.platformReady = false;
    }

    /**
     * Clean up partial initialization state
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupPartialInitialization() {
        try {
            // Stop any ongoing video detection
            this.stopVideoElementDetection();

            // Clean up platform instance
            if (this.activePlatform) {
                await this._cleanupPlatformInstance();
            }

            // Clear event buffer
            this.eventBuffer.clear();

            // Reset state
            this.platformReady = false;

            this.logWithFallback(
                'debug',
                'Partial initialization state cleaned up'
            );
        } catch (error) {
            this.logWithFallback(
                'warn',
                'Error during partial initialization cleanup',
                { error }
            );
        }
    }

    // ========================================
    // CONFIGURATION MANAGEMENT
    // ========================================

    /**
     * Normalize configuration to handle backward compatibility
     * @private
     */
    _normalizeConfiguration() {
        // Handle transition from useNativeSubtitles to useOfficialTranslations
        if (
            this.currentConfig.useOfficialTranslations === undefined &&
            this.currentConfig.useNativeSubtitles !== undefined
        ) {
            this.currentConfig.useOfficialTranslations =
                this.currentConfig.useNativeSubtitles;
            this.logWithFallback(
                'debug',
                'Normalized useOfficialTranslations from useNativeSubtitles',
                {
                    value: this.currentConfig.useOfficialTranslations,
                }
            );
        }

        // Ensure useOfficialTranslations has a default value
        if (this.currentConfig.useOfficialTranslations === undefined) {
            this.currentConfig.useOfficialTranslations = true; // Default to true
            this.logWithFallback(
                'debug',
                'Set default useOfficialTranslations value',
                {
                    value: this.currentConfig.useOfficialTranslations,
                }
            );
        }
    }

    /**
     * Setup configuration change listeners
     */
    setupConfigurationListeners() {
        this.configService.onChanged(async (changes) => {
            this.logWithFallback('info', 'Config changed, updating', {
                changes,
            });
            const newConfig = await this.configService.getAll();

            Object.assign(this.currentConfig, newConfig);

            this._normalizeConfiguration();

            this.applyConfigurationChanges(changes);

            // Handle AI Context enablement and related changes immediately without requiring page reloads
            try {
                await this._handleAIContextConfigurationChanges(changes);
            } catch (error) {
                this.logWithFallback(
                    'warn',
                    'Failed to apply AI Context config changes',
                    {
                        error: error.message,
                    }
                );
            }
        });
    }

    /**
     * Apply configuration changes with immediate visual feedback
     * @param {Object} changes - Configuration changes
     */
    applyConfigurationChanges(changes) {
        // Check if any changes affect subtitle functionality (exclude UI-only settings)
        const uiOnlySettings = ['appearanceAccordionOpen'];
        const functionalChanges = Object.keys(changes).filter(
            (key) => !uiOnlySettings.includes(key)
        );

        // Re-apply styles and trigger a subtitle re-render only if functional settings changed
        if (
            functionalChanges.length > 0 &&
            this.activePlatform &&
            this.subtitleUtils &&
            this.subtitleUtils.subtitlesActive
        ) {
            this.subtitleUtils.applySubtitleStyling(this.currentConfig);
            const videoElement = this.activePlatform.getVideoElement();
            if (videoElement) {
                this.subtitleUtils.updateSubtitles(
                    videoElement.currentTime,
                    this.activePlatform,
                    this.currentConfig,
                    this.logPrefix
                );
            }
        }
    }

    /**
     * Handle AI Context related configuration changes without requiring reloads
     * - Starts AI Context when enabled
     * - Stops AI Context when disabled
     * - Restarts AI Context when provider or core settings change
     * @param {Object} changes - Configuration changes map from chrome.storage.onChanged
     * @private
     */
    async _handleAIContextConfigurationChanges(changes) {
        try {
            const aiKeys = new Set([
                'aiContextEnabled',
                'aiContextProvider',
                'aiContextTypes',
                'aiContextTimeout',
                'aiContextRetryAttempts',
                'aiContextRateLimit',
                'aiContextBurstLimit',
                'aiContextMandatoryDelay',
                'openaiApiKey',
                'openaiBaseUrl',
                'openaiModel',
                'geminiApiKey',
                'geminiModel',
            ]);

            const changedKeys = Object.keys(changes || {});
            const hasAIChanges = changedKeys.some((k) => aiKeys.has(k));
            if (!hasAIChanges) {
                return;
            }

            // If the enablement flag changed, handle start/stop directly
            if (
                Object.prototype.hasOwnProperty.call(
                    changes,
                    'aiContextEnabled'
                )
            ) {
                const enabled = !!changes.aiContextEnabled;
                if (enabled) {
                    // Start or restart AI Context features
                    await this._restartAIContextFeatures();
                } else {
                    // Stop AI Context features and keep interactive subtitles only
                    await this._cleanupAIContextManager();
                    await this._initializeInteractiveSubtitlesOnly(
                        await this._getAIContextConfiguration()
                    );
                }
                return;
            }

            // Other AI settings changed while enabled: restart to apply changes
            if (this.aiContextManager && this.currentConfig?.aiContextEnabled) {
                await this._restartAIContextFeatures();
            }
        } catch (error) {
            this.logWithFallback(
                'warn',
                'AI Context configuration change handling failed',
                {
                    error: error.message,
                }
            );
        }
    }

    /**
     * Restart AI Context features by performing a clean destroy and fresh initialization
     * @private
     */
    async _restartAIContextFeatures() {
        try {
            await this._cleanupAIContextManager();
            await this.initializeAIContextFeatures();
        } catch (error) {
            this.logWithFallback(
                'warn',
                'Failed to restart AI Context features',
                {
                    error: error.message,
                }
            );
        }
    }

    // ========================================
    // EVENT HANDLING AND BUFFERING
    // ========================================

    /**
     * Setup early event handling for subtitle data with enhanced buffering
     */
    setupEarlyEventHandling() {
        const config = this.getInjectScriptConfig();

        // Attach event listener immediately to catch early events with proper cleanup tracking
        if (!this.eventListenerAttached) {
            const eventHandler = (e) => this.handleEarlyInjectorEvents(e);
            document.addEventListener(config.eventId, eventHandler, {
                passive: true,
            });
            this.eventListenerAttached = true;

            // Track cleanup function for proper memory management
            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(config.eventId, eventHandler);
                this.eventListenerAttached = false;
                this.logWithFallback('debug', 'Early event listener removed', {
                    eventId: config.eventId,
                });
            });

            this.logWithFallback('debug', 'Early event listener attached', {
                eventId: config.eventId,
            });
        }

        // Inject script early to catch subtitle data
        this.injectScriptEarly();
    }

    /**
     * Handle early injector events and buffer them until platform is ready
     * Enhanced with better error handling and memory management
     * @param {Event} e - Custom event from injected script
     */
    handleEarlyInjectorEvents(e) {
        try {
            if (!e || !e.detail) {
                this.logWithFallback('warn', 'Received invalid event data');
                return;
            }

            const data = e.detail;
            if (!data || !data.type) {
                this.logWithFallback(
                    'warn',
                    'Event data missing required type field'
                );
                return;
            }

            // Enhanced event processing with timestamp and validation
            // Preserve original data fields (including url) and add extra contextual
            // information without overwriting them.  Use a separate property
            // `pageUrl` so the subtitle URL remains intact.
            const eventData = {
                ...data,
                timestamp: Date.now(),
                pageUrl: window.location.href,
            };

            if (data.type === 'INJECT_SCRIPT_READY') {
                this.logWithFallback('info', 'Inject script is ready');
                // Clear any stale buffered events when script reloads
                if (this.eventBuffer.size() > 0) {
                    this.logWithFallback(
                        'debug',
                        'Clearing stale buffered events on script reload'
                    );
                    this.eventBuffer.clear();
                }
            } else if (
                data.type === 'SUBTITLE_DATA_FOUND' ||
                data.type === 'SUBTITLE_URL_FOUND'
            ) {
                // Enhanced buffering with size limits to prevent memory issues
                if (this.eventBuffer.size() >= 100) {
                    this.logWithFallback(
                        'warn',
                        'Event buffer size limit reached, clearing old events'
                    );
                    this.eventBuffer.clear();
                }
                this.eventBuffer.add(eventData);
                this.logWithFallback('debug', 'Subtitle data buffered', {
                    bufferSize: this.eventBuffer.size(),
                    eventType: data.type,
                });
            }

            // Process buffered events if platform is ready
            if (
                this.platformReady &&
                this.activePlatform &&
                this.eventBuffer.size() > 0
            ) {
                this.processBufferedEvents();
            }
        } catch (error) {
            this.logWithFallback(
                'error',
                'Error handling early injector event',
                {
                    error: error.message,
                    stack: error.stack,
                }
            );
        }
    }

    /**
     * Process buffered events with enhanced error handling and validation
     */
    processBufferedEvents() {
        if (!this.activePlatform) {
            this.logWithFallback(
                'warn',
                'Cannot process buffered events: platform not ready'
            );
            return;
        }

        const bufferSize = this.eventBuffer.size();
        this.logWithFallback('info', 'Processing buffered events', {
            count: bufferSize,
        });

        this.eventBuffer.processAll((eventData, index) => {
            try {
                // Validate event data before processing
                if (!eventData || !eventData.type) {
                    this.logWithFallback(
                        'warn',
                        'Skipping invalid buffered event',
                        { index, eventData }
                    );
                    return;
                }

                // Check if event is still relevant (not too old)
                const eventAge = Date.now() - (eventData.timestamp || 0);
                const maxEventAge = 30000; // 30 seconds
                if (eventAge > maxEventAge) {
                    this.logWithFallback(
                        'debug',
                        'Skipping stale buffered event',
                        {
                            index,
                            age: eventAge,
                            type: eventData.type,
                        }
                    );
                    return;
                }

                if (
                    eventData.type === 'SUBTITLE_DATA_FOUND' ||
                    eventData.type === 'SUBTITLE_URL_FOUND'
                ) {
                    this.activePlatform.handleInjectorEvents({
                        detail: eventData,
                    });
                    this.logWithFallback(
                        'debug',
                        'Processed buffered subtitle event',
                        { index }
                    );
                }
            } catch (error) {
                this.logWithFallback(
                    'error',
                    'Error processing buffered event',
                    {
                        index,
                        error: error.message,
                        eventType: eventData?.type,
                    }
                );
            }
        });

        this.logWithFallback('info', 'Finished processing buffered events', {
            originalCount: bufferSize,
            remainingCount: this.eventBuffer.size(),
        });
    }

    /**
     * Inject script early to catch subtitle data
     */
    injectScriptEarly() {
        const config = this.getInjectScriptConfig();

        injectScript(
            chrome.runtime.getURL(config.filename),
            config.tagId,
            () =>
                this.logWithFallback(
                    'info',
                    'Early inject script loaded successfully'
                ),
            (error) => {
                this.logWithFallback(
                    'error',
                    'Failed to load early inject script!',
                    { error }
                );
                // Retry after a short delay
                setTimeout(() => this.injectScriptEarly(), 100);
            },
            (msg) => this.logWithFallback('debug', msg),
            true // Treat as a module
        );
    }

    // ========================================
    // SUBTITLE DATA HANDLING
    // ========================================

    /**
     * Handle subtitle data found callback
     * @param {Object} subtitleData - Subtitle data from platform
     */
    handleSubtitleDataFound(subtitleData) {
        this.logWithFallback('info', 'Subtitle data found callback triggered', {
            hasSubtitleData: !!subtitleData,
            videoId: subtitleData?.videoId,
            hasVttText: !!subtitleData?.vttText,
            hasTargetVttText: !!subtitleData?.targetVttText,
            useNativeTarget: subtitleData?.useNativeTarget,
            sourceLanguage: subtitleData?.sourceLanguage,
            targetLanguage: subtitleData?.targetLanguage,
            hasSubtitleUtils: !!this.subtitleUtils,
            hasActivePlatform: !!this.activePlatform,
            subtitlesActive: this.subtitleUtils?.subtitlesActive,
        });

        if (this.subtitleUtils && this.subtitleUtils.handleSubtitleDataFound) {
            this.subtitleUtils.handleSubtitleDataFound(
                subtitleData,
                this.activePlatform,
                this.currentConfig,
                this.logPrefix
            );
        } else {
            this.logWithFallback(
                'error',
                'Cannot handle subtitle data - missing dependencies',
                {
                    hasSubtitleUtils: !!this.subtitleUtils,
                    hasHandleMethod:
                        !!this.subtitleUtils?.handleSubtitleDataFound,
                    hasActivePlatform: !!this.activePlatform,
                }
            );
        }
    }

    /**
     * Handle video ID change callback
     * @param {string} newVideoId - New video ID
     */
    handleVideoIdChange(newVideoId) {
        if (this.subtitleUtils) {
            if (this.subtitleUtils.handleVideoIdChange) {
                this.subtitleUtils.handleVideoIdChange(
                    newVideoId,
                    this.logPrefix
                );
            }
            if (this.subtitleUtils.setCurrentVideoId) {
                this.subtitleUtils.setCurrentVideoId(newVideoId);
            }
        }
    }

    // ========================================
    // VIDEO ELEMENT DETECTION
    // ========================================

    /**
     * Start video element detection with retry mechanism
     */
    startVideoElementDetection() {
        this.logWithFallback('info', 'Starting video element detection');
        this.videoDetectionRetries = 0;

        // Clear any existing detection interval
        if (this.videoDetectionIntervalId) {
            clearInterval(this.videoDetectionIntervalId);
            this.videoDetectionIntervalId = null;
        }

        // Try immediately first
        if (this.attemptVideoSetup()) {
            return; // Success, no need for interval
        }

        // Start retry mechanism
        this.videoDetectionIntervalId = setInterval(() => {
            this.videoDetectionRetries++;
            this.logWithFallback('debug', 'Video detection attempt', {
                attempt: this.videoDetectionRetries,
                maxAttempts: this.maxVideoDetectionRetries,
            });

            if (this.attemptVideoSetup()) {
                // Success! Clear the interval
                clearInterval(this.videoDetectionIntervalId);
                this.videoDetectionIntervalId = null;
                this.logWithFallback(
                    'info',
                    'Video element found and setup completed',
                    {
                        attempts: this.videoDetectionRetries,
                    }
                );
            } else if (
                this.videoDetectionRetries >= this.maxVideoDetectionRetries
            ) {
                // Give up after max retries
                clearInterval(this.videoDetectionIntervalId);
                this.videoDetectionIntervalId = null;
                this.logWithFallback(
                    'warn',
                    'Could not find video element after max attempts. Giving up',
                    {
                        maxAttempts: this.maxVideoDetectionRetries,
                    }
                );
            }
        }, this.videoDetectionInterval);
    }

    /**
     * Attempt to setup video element and subtitle container
     * @returns {boolean} Success status
     */
    attemptVideoSetup() {
        if (
            !this.activePlatform ||
            !this.subtitleUtils ||
            !this.currentConfig
        ) {
            return false;
        }

        const videoElement = this.activePlatform.getVideoElement();
        if (!videoElement) {
            return false; // Video not ready yet
        }

        this.logWithFallback(
            'info',
            'Video element found! Setting up subtitle container and listeners'
        );
        this.logWithFallback('debug', 'Current subtitlesActive state', {
            subtitlesActive: this.subtitleUtils.subtitlesActive,
        });

        // Ensure container and timeupdate listener
        this.subtitleUtils.ensureSubtitleContainer(
            this.activePlatform,
            this.currentConfig,
            this.logPrefix
        );

        if (this.subtitleUtils.subtitlesActive) {
            this.logWithFallback(
                'info',
                'Subtitles are active, showing container and setting up listeners'
            );
            this.subtitleUtils.showSubtitleContainer();
            if (videoElement.currentTime > 0) {
                this.subtitleUtils.updateSubtitles(
                    videoElement.currentTime,
                    this.activePlatform,
                    this.currentConfig,
                    this.logPrefix
                );
            }
        } else {
            this.logWithFallback(
                'info',
                'Subtitles are not active, hiding container'
            );
            this.subtitleUtils.hideSubtitleContainer();
        }

        return true; // Success
    }

    /**
     * Stop video element detection
     */
    stopVideoElementDetection() {
        if (this.videoDetectionIntervalId) {
            clearInterval(this.videoDetectionIntervalId);
            this.videoDetectionIntervalId = null;
            this.logWithFallback('info', 'Video element detection stopped');
        }
    }

    // ========================================
    // DOM OBSERVATION
    // ========================================

    /**
     * Setup DOM mutation observer for dynamic content changes
     */
    setupDOMObservation() {
        this.pageObserver = new MutationObserver((mutationsList) => {
            if (!this.subtitleUtils) return; // Utilities not loaded yet

            // Check for URL changes in case other detection methods missed it
            setTimeout(() => this.checkForUrlChange(), 100);

            if (!this.activePlatform && this.subtitleUtils.subtitlesActive) {
                this.logWithFallback(
                    'info',
                    'PageObserver detected DOM changes. Attempting to initialize platform'
                );
                this.initializePlatform();
                return;
            }

            if (!this.activePlatform) return;

            for (let mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    const videoElementNow =
                        this.activePlatform.getVideoElement();
                    const currentDOMVideoElement = document.querySelector(
                        'video[data-listener-attached="true"]'
                    );

                    if (
                        videoElementNow &&
                        (!currentDOMVideoElement ||
                            currentDOMVideoElement !== videoElementNow)
                    ) {
                        this.logWithFallback(
                            'debug',
                            'PageObserver detected video element appearance or change'
                        );
                        if (
                            this.subtitleUtils.subtitlesActive &&
                            this.platformReady &&
                            this.activePlatform
                        ) {
                            this.logWithFallback(
                                'debug',
                                'Platform is ready, re-ensuring container/listeners'
                            );
                            this.subtitleUtils.ensureSubtitleContainer(
                                this.activePlatform,
                                this.currentConfig,
                                this.logPrefix
                            );
                        }
                    } else if (currentDOMVideoElement && !videoElementNow) {
                        this.logWithFallback(
                            'debug',
                            'PageObserver detected video element removal'
                        );
                        this.subtitleUtils.hideSubtitleContainer();
                        if (this.subtitleUtils.clearSubtitleDOM) {
                            this.subtitleUtils.clearSubtitleDOM();
                        }
                    }
                }
            }
        });

        // Ensure document.body exists before observing
        if (document.body) {
            this.pageObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
        } else {
            // Wait for body to be available
            const waitForBody = () => {
                if (document.body) {
                    this.pageObserver.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    this.logWithFallback(
                        'info',
                        'Page observer started after body became available'
                    );
                } else {
                    setTimeout(waitForBody, 100);
                }
            };
            waitForBody();
        }
    }

    // ========================================
    // CHROME MESSAGE HANDLING
    // ========================================

    /**
     * Handle Chrome message routing and processing
     * Main entry point for all Chrome extension messages with extensible action-based routing
     * @param {Object} request - Chrome message request
     * @param {Object} sender - Message sender
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleChromeMessage(request, sender, sendResponse) {
        try {
            // Validate request object
            if (!request) {
                this.logWithFallback(
                    'warn',
                    'Received null or undefined request'
                );
                sendResponse({
                    success: false,
                    error: 'Invalid request format',
                });
                return false;
            }

            const action = request.action || request.type;

            if (action !== MessageActions.SIDEPANEL_GET_STATE) {
                this.logWithFallback('debug', 'Received Chrome message', {
                    action,
                    hasUtilities: !!(this.subtitleUtils && this.configService),
                    hasRegisteredHandler: this.messageHandlers.has(action),
                });
            }

            // Validate message structure
            if (!action) {
                this.logWithFallback(
                    'warn',
                    'Received message without action or type',
                    { request }
                );
                sendResponse({
                    success: false,
                    error: 'Message missing action or type',
                });
                return false;
            }

            // Check if we have a registered handler for this action
            const handlerConfig = this.messageHandlers.get(action);
            if (handlerConfig) {
                if (action !== MessageActions.SIDEPANEL_GET_STATE) {
                    this.logWithFallback(
                        'debug',
                        'Using registered message handler',
                        {
                            action,
                            description: handlerConfig.description,
                            requiresUtilities: handlerConfig.requiresUtilities,
                        }
                    );
                }

                // Check if handler requires utilities and they're not loaded
                if (
                    handlerConfig.requiresUtilities &&
                    (!this.subtitleUtils || !this.configService)
                ) {
                    this.logWithFallback(
                        'error',
                        'Handler requires utilities but they are not loaded',
                        { action }
                    );
                    sendResponse({
                        success: false,
                        error: 'Utilities not loaded',
                    });
                    return true; // Return true to indicate async handling (even though it's immediate)
                }

                return handlerConfig.handler(request, sendResponse);
            }

            // Check for utilities requirement for unknown actions
            if (!this.subtitleUtils || !this.configService) {
                this.logWithFallback(
                    'error',
                    'Utilities not loaded, cannot handle message',
                    { action }
                );
                sendResponse({ success: false, error: 'Utilities not loaded' });
                return true; // Return true to indicate async handling (even though it's immediate)
            }

            // Delegate to platform-specific handler for unregistered actions
            this.logWithFallback(
                'debug',
                'Delegating to platform-specific handler',
                { action }
            );
            return this.handlePlatformSpecificMessage(request, sendResponse);
        } catch (error) {
            this.logWithFallback('error', 'Error in Chrome message handling', {
                error: error.message,
                stack: error.stack,
                action: request.action || request.type,
            });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Handle toggle subtitles message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleToggleSubtitles(request, sendResponse) {
        try {
            this.logWithFallback('info', 'Handling toggle subtitles', {
                enabled: request.enabled,
            });

            this.subtitleUtils.setSubtitlesActive(request.enabled);

            return request.enabled
                ? this._enableSubtitles(sendResponse, request.enabled)
                : this._disableSubtitles(sendResponse, request.enabled);
        } catch (error) {
            this.logWithFallback('error', 'Error in handleToggleSubtitles', {
                error: error.message,
            });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Handle config changed message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleConfigChanged(request, sendResponse) {
        try {
            this.logWithFallback('debug', 'Handling config changed', {
                changes: request.changes,
            });

            if (
                request.changes &&
                this.activePlatform &&
                this.subtitleUtils.subtitlesActive
            ) {
                Object.assign(this.currentConfig, request.changes);

                if (
                    request.changes.useNativeSubtitles !== undefined &&
                    request.changes.useOfficialTranslations === undefined
                ) {
                    this.currentConfig.useOfficialTranslations =
                        request.changes.useNativeSubtitles;
                }

                this.subtitleUtils.applySubtitleStyling(this.currentConfig);
                const videoElement = this.activePlatform.getVideoElement();
                if (videoElement) {
                    this.subtitleUtils.updateSubtitles(
                        videoElement.currentTime,
                        this.activePlatform,
                        this.currentConfig,
                        this.logPrefix
                    );
                }
                this.logWithFallback(
                    'info',
                    'Applied immediate config changes',
                    {
                        changes: request.changes,
                    }
                );
            }
            sendResponse({ success: true });
            return false;
        } catch (error) {
            this.logWithFallback('error', 'Error in handleConfigChanged', {
                error: error.message,
            });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Handle logging level changed message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleLoggingLevelChanged(request, sendResponse) {
        try {
            this.logWithFallback('debug', 'Handling logging level change', {
                level: request.level,
            });

            if (this.contentLogger) {
                this.contentLogger.updateLevel(request.level);
                this.contentLogger.info(
                    'Logging level updated from background script',
                    {
                        newLevel: request.level,
                    }
                );
            } else {
                this.logWithFallback(
                    'info',
                    'Logging level change received but logger not initialized yet',
                    {
                        level: request.level,
                    }
                );
            }
            sendResponse({ success: true });
            return false;
        } catch (error) {
            this.logWithFallback(
                'error',
                'Error in handleLoggingLevelChanged',
                { error: error.message }
            );
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Disable subtitles helper method
     * @private
     * @param {Function} sendResponse - Response callback
     * @param {boolean} enabled - Enabled state
     * @returns {boolean} Whether response is handled asynchronously
     */
    _disableSubtitles(sendResponse, enabled) {
        this.stopVideoElementDetection();
        this.subtitleUtils.hideSubtitleContainer();
        this.subtitleUtils.clearSubtitlesDisplayAndQueue(
            this.activePlatform,
            true,
            this.logPrefix
        );
        if (this.activePlatform) {
            this.activePlatform.cleanup();
            this.activePlatform = null;
        }
        this.platformReady = false;
        sendResponse({ success: true, subtitlesEnabled: enabled });
        return false;
    }

    /**
     * Enable subtitles helper method
     * @private
     * @param {Function} sendResponse - Response callback
     * @param {boolean} enabled - Enabled state
     * @returns {boolean} Whether response is handled asynchronously
     */
    /**
     * Handle side panel get state: returns currently highlighted words and languages
     */
    handleSidePanelGetState(request, sendResponse) {
        try {
            const highlighted = Array.from(
                document.querySelectorAll('.dualsub-interactive-word.dualsub-word-selected')
            );
            const words = [];
            const seen = new Set();
            highlighted.forEach((el) => {
                const w = el.getAttribute('data-word') || el.textContent || '';
                const word = (w || '').trim();
                if (word && !seen.has(word)) {
                    seen.add(word);
                    words.push(word);
                }
            });

            // Keep this handler lightweight to avoid page lag
            sendResponse({
                success: true,
                selectedWords: words,
                sourceLanguage: 'auto',
            });
            return false;
        } catch (error) {
            this.logWithFallback('error', 'Error in handleSidePanelGetState', {
                error: error.message,
            });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Handle side panel update state: clear/apply highlights
     */
    handleSidePanelUpdateState(request, sendResponse) {
        try {
            const data = request.data || request; // support both shapes
            if (data.clearSelection) {
                document
                    .querySelectorAll('.dualsub-interactive-word.dualsub-word-selected')
                    .forEach((el) => el.classList.remove('dualsub-word-selected'));
            }

            if (Array.isArray(data.selectedWords)) {
                // Add highlights for given words (first-match strategy)
                data.selectedWords.forEach((word) => {
                    const el = Array.from(
                        document.querySelectorAll('.dualsub-interactive-word')
                    ).find((e) => (e.getAttribute('data-word') || '').trim() === word);
                    if (el) el.classList.add('dualsub-word-selected');
                });
            }

            sendResponse({ success: true });
            return false;
        } catch (error) {
            this.logWithFallback('error', 'Error in handleSidePanelUpdateState', {
                error: error.message,
            });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Pause the video using multiple strategies
     */
    async handleSidePanelPauseVideo(_request, sendResponse) {
        try {
            // Use platform-specific pause when available (e.g., Disney+ shadow button)
            if (this.activePlatform && typeof this.activePlatform.pausePlayback === 'function') {
                const ok = await this.activePlatform.pausePlayback();
                sendResponse({ success: !!ok });
                return false;
            }

            const pauseSucceeded = await (async () => {
                try {
                    // Strategy 1: Direct HTML5 pause (universal)
                    const v = document.querySelector('video[data-listener-attached="true"]')
                        || (this.activePlatform && typeof this.activePlatform.getVideoElement === 'function' ? this.activePlatform.getVideoElement() : null)
                        || document.querySelector('video');
                    if (v) {
                        try { v.pause(); } catch (_) {}
                        await new Promise((r) => setTimeout(r, 80));
                        if (v.paused) return true;
                    }

                    // Strategy 2: Click any visible Pause/Play control (generic platforms)
                    try {
                        const pauseBtn = document.querySelector(
                            'button[aria-label*="Pause" i], button[data-uia*="pause" i], button.play-button.control[part="play-button"], button[part="play-button"]'
                        );
                        if (pauseBtn) {
                            pauseBtn.click();
                            await new Promise((r) => setTimeout(r, 140));
                            const v2 = document.querySelector('video[data-listener-attached="true"]')
                                || (this.activePlatform && typeof this.activePlatform.getVideoElement === 'function' ? this.activePlatform.getVideoElement() : null)
                                || document.querySelector('video');
                            if (v2 && v2.paused) return true;
                        }
                    } catch (_) {}

                    // Strategy 3: As absolute fallback, try another direct pause
                    try {
                        const v3 = document.querySelector('video[data-listener-attached="true"]') || document.querySelector('video');
                        if (v3) {
                            v3.pause();
                            await new Promise((r) => setTimeout(r, 60));
                            if (v3.paused) return true;
                        }
                    } catch (_) {}
                    return false;
                } catch (_) {
                    return false;
                }
            })();

            sendResponse({ success: pauseSucceeded });
            return false;
        } catch (error) {
            this.logWithFallback('warn', 'Error while attempting to pause video', { error: error.message });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Resume the video
     */
    handleSidePanelResumeVideo(_request, sendResponse) {
        try {
            if (this.activePlatform && typeof this.activePlatform.resumePlayback === 'function') {
                Promise.resolve(this.activePlatform.resumePlayback())
                    .then((ok) => sendResponse({ success: !!ok }))
                    .catch(() => sendResponse({ success: false }));
                return true;
            }
            const v = (this.activePlatform && typeof this.activePlatform.getVideoElement === 'function')
                ? this.activePlatform.getVideoElement()
                : document.querySelector('video');
            if (v) {
                try { v.play(); } catch (_) {}
            }
            sendResponse({ success: true });
            return false;
        } catch (error) {
            this.logWithFallback('warn', 'Error while attempting to resume video', { error: error.message });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Handle analyzing state update: block/unblock word clicks
     */
    handleSidePanelSetAnalyzing(request, sendResponse) {
        try {
            const isAnalyzing = !!(request.data?.isAnalyzing ?? request.isAnalyzing);

            if (this.sidePanelIntegration) {
                this.sidePanelIntegration.isAnalyzing = isAnalyzing;
                this.logWithFallback('debug', 'Analyzing state updated', { isAnalyzing });
            }

            // 1) Mirror legacy modal signal so interactive subtitle code detects analyzing
            try {
                let modalContent = document.getElementById('dualsub-modal-content');
                if (!modalContent) {
                    modalContent = document.createElement('div');
                    modalContent.id = 'dualsub-modal-content';
                    // keep it invisible and out of layout
                    Object.assign(modalContent.style, {
                        display: 'none',
                    });
                    document.body.appendChild(modalContent);
                }
                if (isAnalyzing) {
                    modalContent.classList.add('is-analyzing');
                } else {
                    modalContent.classList.remove('is-analyzing');
                }
            } catch (_) {}

            // 2) Disable/enable pointer interactions on the original subtitle container
            try {
                const original = document.getElementById('dualsub-original-subtitle');
                if (original) {
                    if (isAnalyzing) {
                        original.style.pointerEvents = 'none';
                        original.classList.add('dualsub-subtitles-disabled');
                    } else {
                        original.style.removeProperty('pointer-events');
                        original.classList.remove('dualsub-subtitles-disabled');
                    }
                }
            } catch (_) {}

            sendResponse({ success: true });
            return false;
        } catch (error) {
            this.logWithFallback('error', 'Error in handleSidePanelSetAnalyzing', {
                error: error.message,
            });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    _enableSubtitles(sendResponse, enabled) {
        if (!this.activePlatform) {
            this.initializePlatform()
                .then(() =>
                    sendResponse({ success: true, subtitlesEnabled: enabled })
                )
                .catch((error) => {
                    this.logWithFallback(
                        'error',
                        'Error in platform initialization',
                        { error: error.message }
                    );
                    sendResponse({ success: false, error: error.message });
                });
            return true;
        }

        if (this.activePlatform.isPlayerPageActive()) {
            this.startVideoElementDetection();
        }
        sendResponse({ success: true, subtitlesEnabled: enabled });
        return false;
    }

    // ========================================
    // CLEANUP AND LIFECYCLE MANAGEMENT
    // ========================================

    /**
     * Setup cleanup handlers for proper resource disposal
     */
    setupCleanupHandlers() {
        // Setup Chrome message handler
        this._attachChromeMessageListener();

        // Handle extension context invalidation
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.logWithFallback(
                    'debug',
                    'Page hidden, pausing operations'
                );
            } else {
                this.logWithFallback(
                    'debug',
                    'Page visible, resuming operations'
                );
                // Re-check video setup when page becomes visible
                if (
                    this.activePlatform &&
                    this.subtitleUtils &&
                    this.subtitleUtils.subtitlesActive
                ) {
                    setTimeout(() => this.attemptVideoSetup(), 500);
                }
            }
        });
    }

    /**
     * Clean up all resources and event listeners with proper resource disposal
     * Comprehensive cleanup method that ensures no memory leaks or hanging resources
     * @param {boolean} force - Force cleanup even if already cleaned up
     * @returns {Promise<void>}
     */
    async cleanup(force = false) {
        if (this.isCleanedUp && !force) {
            this.logWithFallback(
                'debug',
                'Cleanup already performed, skipping'
            );
            return;
        }

        this.logWithFallback(
            'info',
            'Starting comprehensive content script cleanup'
        );

        // Mark as cleaning up to prevent concurrent cleanup calls
        this.isCleanedUp = true;

        // 1. Stop all detection and monitoring activities
        await this._stopAllDetectionActivities();

        // 2. Clean up AI Context Manager
        await this._cleanupAIContextManager();

        // 3. Clean up platform resources
        await this._cleanupPlatformResources();

        // 4. Clean up DOM and UI resources
        await this._cleanupDOMResources();

        // 5. Clean up event handling and listeners
        await this._cleanupEventHandling();

        // 6. Clean up intervals and timers
        await this._cleanupTimersAndIntervals();

        // 7. Clean up observers and watchers
        await this._cleanupObservers();

        // 7. Reset internal state
        this._resetInternalState();

        this.logWithFallback(
            'info',
            'Content script cleanup completed successfully'
        );
    }

    /**
     * Stop all detection and monitoring activities
     * @private
     * @returns {Promise<void>}
     */
    async _stopAllDetectionActivities() {
        try {
            // Stop video element detection
            this.stopVideoElementDetection();

            // Stop navigation detection if implemented
            if (typeof this.stopNavigationDetection === 'function') {
                this.stopNavigationDetection();
            }

            this.logWithFallback('debug', 'All detection activities stopped');
        } catch (error) {
            this.logWithFallback(
                'warn',
                'Error stopping detection activities',
                { error }
            );
        }
    }

    /**
     * Clean up AI Context Manager resources
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupAIContextManager() {
        try {
            if (this.aiContextManager) {
                this.logWithFallback(
                    'debug',
                    'Cleaning up AI Context Manager...'
                );
                await this.aiContextManager.destroy();
                this.aiContextManager = null;
                this.logWithFallback(
                    'debug',
                    'AI Context Manager cleaned up successfully'
                );
            }
        } catch (error) {
            this.logWithFallback(
                'error',
                'Error cleaning up AI Context Manager',
                {
                    error: error.message,
                    stack: error.stack,
                }
            );
        }
    }

    /**
     * Clean up platform-specific resources
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupPlatformResources() {
        try {
            if (this.activePlatform) {
                // Call platform cleanup with timeout protection
                const cleanupTimeout =
                    this.currentConfig?.cleanupTimeout ||
                    COMMON_CONSTANTS.CLEANUP_TIMEOUT;

                const cleanupPromise =
                    typeof this.activePlatform.cleanup === 'function'
                        ? this.activePlatform.cleanup()
                        : Promise.resolve();

                const timeoutPromise = new Promise((resolve) => {
                    setTimeout(() => {
                        this.logWithFallback(
                            'warn',
                            'Platform cleanup timed out'
                        );
                        resolve();
                    }, cleanupTimeout);
                });

                await Promise.race([cleanupPromise, timeoutPromise]);
                this.activePlatform = null;
                this.logWithFallback('debug', 'Platform resources cleaned up');
            }
        } catch (error) {
            this.logWithFallback(
                'warn',
                'Error cleaning up platform resources',
                { error }
            );
            this.activePlatform = null;
        }
    }

    /**
     * Clean up DOM and UI resources
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupDOMResources() {
        try {
            // Clean up subtitle utilities and DOM elements
            if (this.subtitleUtils) {
                if (typeof this.subtitleUtils.clearSubtitleDOM === 'function') {
                    this.subtitleUtils.clearSubtitleDOM();
                }
                if (
                    typeof this.subtitleUtils.hideSubtitleContainer ===
                    'function'
                ) {
                    this.subtitleUtils.hideSubtitleContainer();
                }
                if (typeof this.subtitleUtils.cleanup === 'function') {
                    await this.subtitleUtils.cleanup();
                }
            }

            // Remove any injected scripts
            const config = this.getInjectScriptConfig();
            const injectedScript = document.getElementById(config.tagId);
            if (injectedScript) {
                injectedScript.remove();
                this.logWithFallback(
                    'debug',
                    'Injected script removed from DOM'
                );
            }

            this.logWithFallback('debug', 'DOM resources cleaned up');
        } catch (error) {
            this.logWithFallback('warn', 'Error cleaning up DOM resources', {
                error,
            });
        }
    }

    /**
     * Clean up event handling and listeners with enhanced memory management
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupEventHandling() {
        try {
            // Clear event buffer
            if (this.eventBuffer) {
                this.eventBuffer.clear();
            }

            // Execute all tracked event listener cleanup functions
            if (
                this.eventListenerCleanupFunctions &&
                this.eventListenerCleanupFunctions.length > 0
            ) {
                this.logWithFallback(
                    'debug',
                    'Executing event listener cleanup functions',
                    {
                        count: this.eventListenerCleanupFunctions.length,
                    }
                );

                for (const cleanupFn of this.eventListenerCleanupFunctions) {
                    try {
                        cleanupFn();
                    } catch (cleanupError) {
                        this.logWithFallback(
                            'warn',
                            'Error in event listener cleanup function',
                            {
                                error: cleanupError.message,
                            }
                        );
                    }
                }
                this.eventListenerCleanupFunctions = [];
            }

            // Clean up Chrome message listeners
            if (chrome.runtime && chrome.runtime.onMessage) {
                // Note: Chrome extension listeners are automatically cleaned up when content script is destroyed
                this.logWithFallback(
                    'debug',
                    'Chrome message listeners will be cleaned up automatically'
                );
            }

            this.logWithFallback('debug', 'Event handling cleaned up');
        } catch (error) {
            this.logWithFallback('warn', 'Error cleaning up event handling', {
                error,
            });
        }
    }

    /**
     * Clean up timers and intervals
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupTimersAndIntervals() {
        try {
            // Stop all managed intervals
            if (this.intervalManager) {
                this.intervalManager.clearAll();
                this.logWithFallback('debug', 'All managed intervals cleared');
            }

            // Clear video detection interval (backup cleanup)
            if (this.videoDetectionIntervalId) {
                clearInterval(this.videoDetectionIntervalId);
                this.videoDetectionIntervalId = null;
            }

            this.logWithFallback('debug', 'Timers and intervals cleaned up');
        } catch (error) {
            this.logWithFallback(
                'warn',
                'Error cleaning up timers and intervals',
                { error }
            );
            throw error;
        }
    }

    /**
     * Clean up observers and watchers with enhanced memory management
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupObservers() {
        try {
            // Execute all tracked DOM observer cleanup functions
            if (
                this.domObserverCleanupFunctions &&
                this.domObserverCleanupFunctions.length > 0
            ) {
                this.logWithFallback(
                    'debug',
                    'Executing DOM observer cleanup functions',
                    {
                        count: this.domObserverCleanupFunctions.length,
                    }
                );

                for (const cleanupFn of this.domObserverCleanupFunctions) {
                    try {
                        cleanupFn();
                    } catch (cleanupError) {
                        this.logWithFallback(
                            'warn',
                            'Error in DOM observer cleanup function',
                            {
                                error: cleanupError.message,
                            }
                        );
                    }
                }
                this.domObserverCleanupFunctions = [];
            }

            // Disconnect DOM observer (fallback cleanup)
            if (this.pageObserver) {
                this.pageObserver.disconnect();
                this.pageObserver = null;
                this.logWithFallback(
                    'debug',
                    'Main DOM observer disconnected (fallback)'
                );
            }

            // Disconnect video element observer (fallback cleanup)
            if (this.videoElementObserver) {
                this.videoElementObserver.disconnect();
                this.videoElementObserver = null;
                this.logWithFallback(
                    'debug',
                    'Video element observer disconnected (fallback)'
                );
            }

            // Disconnect navigation observer (fallback cleanup)
            if (this.navigationObserver) {
                this.navigationObserver.disconnect();
                this.navigationObserver = null;
                this.logWithFallback(
                    'debug',
                    'Navigation observer disconnected (fallback)'
                );
            }

            // Disconnect passive video observer
            if (this.passiveVideoObserver) {
                this.passiveVideoObserver.disconnect();
                this.passiveVideoObserver = null;
                this.logWithFallback(
                    'debug',
                    'Passive video observer disconnected'
                );
            }

            // Clean up any other observers
            if (this.configObserver) {
                this.configObserver.disconnect();
                this.configObserver = null;
            }

            this.logWithFallback('debug', 'Observers cleaned up');
        } catch (error) {
            this.logWithFallback('warn', 'Error cleaning up observers', {
                error,
            });
        }
    }

    /**
     * Reset internal state to initial values
     * @private
     */
    _resetInternalState() {
        try {
            // Reset platform state
            this.platformReady = false;
            this.activePlatform = null;

            // Reset video detection state
            this.videoDetectionRetries = 0;
            this.videoDetectionIntervalId = null;

            // Reset navigation state
            this.currentUrl = window.location.href;
            this.lastKnownPathname = window.location.pathname;

            // Reset event handling state
            this.eventListenerAttached = false;

            // Clear configuration (keep reference but clear contents)
            if (this.currentConfig && typeof this.currentConfig === 'object') {
                Object.keys(this.currentConfig).forEach(
                    (key) => delete this.currentConfig[key]
                );
            }

            this.logWithFallback('debug', 'Internal state reset');
        } catch (error) {
            this.logWithFallback('warn', 'Error resetting internal state', {
                error,
            });
        }
    }

    /**
     * Get default configuration when storage is unavailable
     * @returns {Object} Default configuration object
     * @private
     */
    _getDefaultConfiguration() {
        return {
            // Core settings
            subtitlesEnabled: true,
            useOfficialTranslations: true,
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',

            // UI settings
            hideOfficialSubtitles: false,
            subtitleTimeOffset: 0.3,
            subtitleLayoutOrder: 'original_top',
            subtitleLayoutOrientation: 'column',

            // Translation settings
            selectedProvider: 'deepl_free',

            // AI Context settings
            aiContextEnabled: false,
            aiContextTypes: ['cultural', 'historical', 'linguistic'],

            // Logging
            loggingLevel: 3, // INFO level

            // Other defaults
            uiLanguage: 'en',
        };
    }
}
