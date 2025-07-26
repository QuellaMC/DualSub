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

import {
    EventBuffer,
    IntervalManager,
    analyzeConfigChanges,
    injectScript,
    isExtensionContextValid,
    safeChromeApiCall,
    COMMON_CONSTANTS
} from './utils.js';

export class BaseContentScript {
    /**
     * Creates a new BaseContentScript instance
     * @param {string} logPrefix - The log prefix for this content script (e.g., 'NetflixContent')
     */
    constructor(logPrefix) {
        if (new.target === BaseContentScript) {
            throw new Error('BaseContentScript is abstract and cannot be instantiated directly');
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
     * Initialize core properties
     * @private
     */
    _initializeCoreProperties() {
        this.contentLogger = null;
        this.activePlatform = null;
        this.currentConfig = {};
    }

    /**
     * Initialize module references
     * @private
     */
    _initializeModuleReferences() {
        this.subtitleUtils = null;
        this.PlatformClass = null;
        this.configService = null;
    }

    /**
     * Initialize video detection state
     * @private
     */
    _initializeVideoDetectionState() {
        this.videoDetectionRetries = 0;
        this.videoDetectionIntervalId = null;
        this.maxVideoDetectionRetries = COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES;
        this.videoDetectionInterval = COMMON_CONSTANTS.VIDEO_DETECTION_INTERVAL;
    }

    /**
     * Initialize event handling properties
     * @private
     */
    _initializeEventHandling() {
        this.eventBuffer = new EventBuffer((msg, data) => this.logWithFallback('debug', msg, data));
        this.eventListenerAttached = false;
        this.platformReady = false;
        this.eventListenerCleanupFunctions = [];
        this.domObserverCleanupFunctions = [];
    }

    /**
     * Initialize navigation state
     * @private
     */
    _initializeNavigationState() {
        this.currentUrl = window.location.href;
        this.lastKnownPathname = window.location.pathname;
    }

    /**
     * Initialize managers
     * @private
     */
    _initializeManagers() {
        this.intervalManager = new IntervalManager();
        this.pageObserver = null;
    }

    /**
     * Initialize cleanup tracking
     * @private
     */
    _initializeCleanupTracking() {
        this.isCleanedUp = false;
        this.passiveVideoObserver = null;
        
        // Initialize AbortController with fallback for environments that don't support it
        try {
            this.abortController = new AbortController();
        } catch (error) {
            this.logWithFallback('warn', 'AbortController not available, using fallback cleanup', { error });
            this.abortController = null;
        }
    }

    /**
     * Initialize Chrome message handling
     * Sets up extensible message handler registry with action-based routing
     * @private
     */
    _initializeMessageHandling() {
        this.messageHandlers = new Map();
        this._setupCommonMessageHandlers();
        this.registerPlatformMessageHandlers();
        this._attachChromeMessageListener();
    }

    /**
     * Setup common message handlers for all platforms
     * Registers extensible message handlers with action-based routing for common functionality
     * @private
     */
    _setupCommonMessageHandlers() {
        // Define common handlers with their configurations
        const commonHandlers = [
            {
                action: 'toggleSubtitles',
                handler: this.handleToggleSubtitles.bind(this),
                requiresUtilities: true,
                description: 'Toggle subtitle display on/off and manage platform initialization'
            },
            {
                action: 'configChanged',
                handler: this.handleConfigChanged.bind(this),
                requiresUtilities: true,
                description: 'Handle configuration changes and apply them immediately'
            },
            {
                action: 'LOGGING_LEVEL_CHANGED',
                handler: this.handleLoggingLevelChanged.bind(this),
                requiresUtilities: false,
                description: 'Update logging level for content script logger'
            }
        ];

        // Register all handlers
        commonHandlers.forEach(({ action, handler, requiresUtilities, description }) => {
            this.registerMessageHandler(action, handler, { requiresUtilities, description });
        });
    }

    /**
     * Attach Chrome message listener
     * @private
     */
    _attachChromeMessageListener() {
        // Only attach listener if Chrome API is available (not in test environment)
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                return this.handleChromeMessage(request, sender, sendResponse);
            });
            this.logWithFallback('debug', 'Chrome message listener attached');
        } else {
            this.logWithFallback('debug', 'Chrome API not available, skipping message listener attachment');
        }
    }

    /**
     * Register a message handler for a specific action/type
     * Supports extensible message handler registry with action-based routing
     * @param {string} action - The action or type to handle
     * @param {Function} handler - The handler function that takes (request, sendResponse) and returns boolean for async handling
     * @param {Object} options - Optional configuration for the handler
     * @param {boolean} options.requiresUtilities - Whether handler requires utilities to be loaded (default: true)
     * @param {string} options.description - Description of what this handler does
     */
    registerMessageHandler(action, handler, options = {}) {
        if (typeof action !== 'string' || !action.trim()) {
            throw new Error('Action must be a non-empty string');
        }
        
        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function');
        }

        const handlerConfig = {
            handler,
            requiresUtilities: options.requiresUtilities !== false, // Default to true
            description: options.description || `Handler for ${action}`,
            registeredAt: new Date().toISOString()
        };

        this.messageHandlers.set(action, handlerConfig);
        this.logWithFallback('debug', 'Registered message handler', { 
            action, 
            requiresUtilities: handlerConfig.requiresUtilities,
            description: handlerConfig.description
        });
    }

    /**
     * Unregister a message handler
     * @param {string} action - The action or type to unregister
     * @returns {boolean} Whether a handler was actually removed
     */
    unregisterMessageHandler(action) {
        const removed = this.messageHandlers.delete(action);
        if (removed) {
            this.logWithFallback('debug', 'Unregistered message handler', { action });
        } else {
            this.logWithFallback('warn', 'Attempted to unregister non-existent message handler', { action });
        }
        return removed;
    }

    /**
     * Get information about registered message handlers
     * @returns {Array<Object>} Array of handler information
     */
    getRegisteredHandlers() {
        const handlers = [];
        for (const [action, config] of this.messageHandlers.entries()) {
            handlers.push({
                action,
                requiresUtilities: config.requiresUtilities,
                description: config.description,
                registeredAt: config.registeredAt
            });
        }
        return handlers;
    }

    /**
     * Check if a message handler is registered for a specific action
     * @param {string} action - The action to check
     * @returns {boolean} Whether a handler is registered
     */
    hasMessageHandler(action) {
        return this.messageHandlers.has(action);
    }

    /**
     * Register platform-specific message handlers
     * This method should be called by subclasses to register their own message handlers
     * @protected
     */
    registerPlatformMessageHandlers() {
        // Default implementation does nothing
        // Subclasses can override this to register platform-specific handlers
        this.logWithFallback('debug', 'No platform-specific message handlers registered');
    }

    /**
     * Initialize fallback console logging until Logger is loaded
     * @param {string} level - Log level (error, warn, info, debug)
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
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
     * Get the platform name (e.g., 'netflix', 'disneyplus')
     * @abstract
     * @returns {string} Platform name
     */
    getPlatformName() {
        throw new Error('getPlatformName() must be implemented by subclass');
    }

    /**
     * Get the platform class constructor
     * @abstract
     * @returns {Function} Platform class constructor
     */
    getPlatformClass() {
        throw new Error('getPlatformClass() must be implemented by subclass');
    }

    /**
     * Get the inject script configuration
     * @abstract
     * @returns {Object} Inject script configuration
     * @returns {string} returns.filename - Path to inject script
     * @returns {string} returns.tagId - DOM element ID for script tag
     * @returns {string} returns.eventId - Custom event ID for communication
     */
    getInjectScriptConfig() {
        throw new Error('getInjectScriptConfig() must be implemented by subclass');
    }

    /**
     * Setup platform-specific navigation detection
     * @abstract
     */
    setupNavigationDetection() {
        throw new Error('setupNavigationDetection() must be implemented by subclass');
    }

    /**
     * Check for URL changes (platform-specific implementation)
     * @abstract
     */
    checkForUrlChange() {
        throw new Error('checkForUrlChange() must be implemented by subclass');
    }

    /**
     * Handle platform-specific Chrome messages
     * @abstract
     * @param {Object} request - Chrome message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handlePlatformSpecificMessage(request, sendResponse) { // eslint-disable-line no-unused-vars
        throw new Error('handlePlatformSpecificMessage() must be implemented by subclass');
    }

    // ========================================
    // TEMPLATE METHODS - Common initialization flow
    // ========================================

    /**
     * Main initialization method - template method pattern
     * Orchestrates the complete initialization flow
     */
    async initialize() {
        try {
            this.logWithFallback('info', 'Starting content script initialization');

            // Step 1: Initialize core modules
            this.logWithFallback('debug', 'Step 1: Initializing core modules');
            const coreSuccess = await this.initializeCore();
            if (!coreSuccess) {
                this.logWithFallback('error', 'Initialization failed at Step 1: initializeCore');
                return false;
            }
            this.logWithFallback('debug', 'Step 1: Core modules initialized successfully');

            // Step 2: Initialize configuration
            this.logWithFallback('debug', 'Step 2: Initializing configuration');
            const configSuccess = await this.initializeConfiguration();
            if (!configSuccess) {
                this.logWithFallback('error', 'Initialization failed at Step 2: initializeConfiguration');
                return false;
            }
            this.logWithFallback('debug', 'Step 2: Configuration initialized successfully');

            // Step 3: Initialize event handling
            this.logWithFallback('debug', 'Step 3: Initializing event handling');
            const eventSuccess = await this.initializeEventHandling();
            if (!eventSuccess) {
                this.logWithFallback('error', 'Initialization failed at Step 3: initializeEventHandling');
                return false;
            }
            this.logWithFallback('debug', 'Step 3: Event handling initialized successfully');

            // Step 4: Initialize observers
            this.logWithFallback('debug', 'Step 4: Initializing observers');
            const observerSuccess = await this.initializeObservers();
            if (!observerSuccess) {
                this.logWithFallback('error', 'Initialization failed at Step 4: initializeObservers');
                return false;
            }
            this.logWithFallback('debug', 'Step 4: Observers initialized successfully');

            this.logWithFallback('info', 'Content script initialization completed successfully');
            return true;

        } catch (error) {
            this.logWithFallback('error', 'Error during initialization', { 
                error: error.message,
                stack: error.stack,
                name: error.name
            });
            return false;
        }
    }

    /**
     * Initialize core modules and services
     * @returns {Promise<boolean>} Success status
     */
    async initializeCore() {
        try {
            this.logWithFallback('debug', 'Loading required modules...');
            const modulesLoaded = await this.loadModules();
            if (!modulesLoaded) {
                this.logWithFallback('error', 'Failed to load required modules');
                return false;
            }
            this.logWithFallback('debug', 'All required modules loaded successfully');
            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error in initializeCore', {
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * Initialize configuration and listeners
     * @returns {Promise<boolean>} Success status
     */
    async initializeConfiguration() {
        try {
            this.logWithFallback('debug', 'Loading configuration from configService...');
            this.currentConfig = await this.configService.getAll();
            this._normalizeConfiguration();
            this.logWithFallback('info', 'Loaded initial configuration', {
                config: this.currentConfig
            });
            
            this.logWithFallback('debug', 'Setting up configuration listeners...');
            this.setupConfigurationListeners();
            this.logWithFallback('debug', 'Configuration listeners set up successfully');
            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error in initializeConfiguration', {
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * Initialize event handling and platform
     * @returns {Promise<boolean>} Success status
     */
    async initializeEventHandling() {
        try {
            this.logWithFallback('debug', 'Setting up early event handling...');
            this.setupEarlyEventHandling();
            this.logWithFallback('debug', 'Early event handling set up successfully');

            if (this.currentConfig.subtitlesEnabled) {
                this.logWithFallback('debug', 'Subtitles enabled, initializing platform...');
                await this.initializePlatform();
                this.logWithFallback('debug', 'Platform initialization completed');
            } else {
                this.logWithFallback('debug', 'Subtitles disabled, skipping platform initialization');
            }
            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error in initializeEventHandling', {
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * Initialize observers and cleanup handlers
     * @returns {Promise<boolean>} Success status
     */
    async initializeObservers() {
        try {
            this.logWithFallback('debug', 'Setting up navigation detection...');
            this.setupNavigationDetection();
            this.logWithFallback('debug', 'Navigation detection set up successfully');

            this.logWithFallback('debug', 'Setting up DOM observation...');
            this.setupDOMObservation();
            this.logWithFallback('debug', 'DOM observation set up successfully');

            this.logWithFallback('debug', 'Setting up cleanup handlers...');
            this.setupCleanupHandlers();
            this.logWithFallback('debug', 'Cleanup handlers set up successfully');

            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error in initializeObservers', {
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * Load required modules dynamically
     * @returns {Promise<boolean>} Success status
     */
    async loadModules() {
        try {
            this.logWithFallback('debug', 'Loading subtitle utilities...');
            await this._loadSubtitleUtilities();
            this.logWithFallback('debug', 'Subtitle utilities loaded successfully');

            this.logWithFallback('debug', 'Loading platform class...');
            await this._loadPlatformClass();
            this.logWithFallback('debug', 'Platform class loaded successfully');

            this.logWithFallback('debug', 'Loading config service...');
            await this._loadConfigService();
            this.logWithFallback('debug', 'Config service loaded successfully');

            this.logWithFallback('debug', 'Loading and initializing logger...');
            await this._loadAndInitializeLogger();
            this.logWithFallback('debug', 'Logger loaded and initialized successfully');

            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error loading modules', { 
                error: error.message,
                stack: error.stack,
                name: error.name
            });
            return false;
        }
    }

    /**
     * Load subtitle utilities module
     * @private
     */
    async _loadSubtitleUtilities() {
        try {
            const utilsUrl = chrome.runtime.getURL('content_scripts/shared/subtitleUtilities.js');
            this.logWithFallback('debug', 'Loading subtitle utilities from:', { url: utilsUrl });
            const utilsModule = await import(utilsUrl);
            this.subtitleUtils = utilsModule;
            this.logWithFallback('debug', 'Subtitle utilities module loaded successfully');
        } catch (error) {
            this.logWithFallback('error', 'Failed to load subtitle utilities', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Load platform-specific class
     * @private
     */
    async _loadPlatformClass() {
        try {
            const platformName = this.getPlatformName();
            const fileName = this._getPlatformFileName(platformName);
            const className = this._getPlatformClassName(platformName);
            const platformUrl = chrome.runtime.getURL(`video_platforms/${fileName}`);
            
            this.logWithFallback('debug', 'Loading platform class', {
                platformName,
                fileName,
                className,
                url: platformUrl
            });
            
            const platformModule = await import(platformUrl);
            this.PlatformClass = platformModule[className];
            
            if (!this.PlatformClass) {
                throw new Error(`Platform class '${className}' not found in module`);
            }
            
            this.logWithFallback('debug', 'Platform class loaded successfully', {
                className,
                hasClass: !!this.PlatformClass
            });
        } catch (error) {
            this.logWithFallback('error', 'Failed to load platform class', {
                error: error.message,
                stack: error.stack,
                platformName: this.getPlatformName()
            });
            throw error;
        }
    }

    /**
     * Get platform file name from platform name
     * @private
     * @param {string} platformName - Platform name
     * @returns {string} File name
     */
    _getPlatformFileName(platformName) {
        // Handle special case for Disney+ where the file is disneyPlusPlatform.js
        if (platformName === 'disneyplus') {
            return 'disneyPlusPlatform.js';
        }
        if (platformName === 'netflix') {
            return 'netflixPlatform.js';
        }
        // Default case: capitalize first letter and add Platform.js
        return `${platformName.charAt(0).toUpperCase()}${platformName.slice(1)}Platform.js`;
    }

    /**
     * Get platform class name from platform name
     * @private
     * @param {string} platformName - Platform name
     * @returns {string} Class name
     */
    _getPlatformClassName(platformName) {
        // Handle special case for Disney+ where the class is DisneyPlusPlatform
        if (platformName === 'disneyplus') {
            return 'DisneyPlusPlatform';
        }
        if (platformName === 'netflix') {
            return 'NetflixPlatform';
        }
        // Default case: capitalize first letter and add Platform
        return `${platformName.charAt(0).toUpperCase()}${platformName.slice(1)}Platform`;
    }

    /**
     * Load configuration service
     * @private
     */
    async _loadConfigService() {
        try {
            const configUrl = chrome.runtime.getURL('services/configService.js');
            this.logWithFallback('debug', 'Loading config service from:', { url: configUrl });
            const configModule = await import(configUrl);
            this.configService = configModule.configService;
            
            if (!this.configService) {
                throw new Error('configService not found in module');
            }
            
            this.logWithFallback('debug', 'Config service loaded successfully');
        } catch (error) {
            this.logWithFallback('error', 'Failed to load config service', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Load and initialize logger
     * @private
     */
    async _loadAndInitializeLogger() {
        try {
            const loggerUrl = chrome.runtime.getURL('utils/logger.js');
            this.logWithFallback('debug', 'Loading logger from:', { url: loggerUrl });
            const loggerModule = await import(loggerUrl);
            const Logger = loggerModule.default;
            
            if (!Logger) {
                throw new Error('Logger not found in module');
            }
            
            this.logWithFallback('debug', 'Creating logger instance with prefix:', { prefix: this.logPrefix });
            this.contentLogger = Logger.create(this.logPrefix);
            
            this.logWithFallback('debug', 'Initializing logger level...');
            await this._initializeLoggerLevel(Logger);
            this.logWithFallback('debug', 'Logger initialized successfully');
        } catch (error) {
            this.logWithFallback('error', 'Failed to load and initialize logger', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Initialize logger level from configuration
     * @private
     * @param {Object} Logger - Logger class
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
        const initializationContext = this._createInitializationContext(retryCount);
        
        if (!this._validateInitializationPrerequisites()) {
            return false;
        }

        try {
            return await this._executeInitializationFlow(initializationContext);
        } catch (error) {
            return await this._handleInitializationError(error, initializationContext);
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
            totalAttempts: retryConfig.maxRetries + 1
        };
    }

    /**
     * Validate all prerequisites for initialization
     * @private
     * @returns {boolean} Whether prerequisites are met
     */
    _validateInitializationPrerequisites() {
        return this._validateModulesLoaded() && this._validatePlatformPrerequisites();
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
            maxRetries: this.currentConfig?.platformInitMaxRetries || COMMON_CONSTANTS.PLATFORM_INIT_MAX_RETRIES,
            retryDelay: this.currentConfig?.platformInitRetryDelay || COMMON_CONSTANTS.PLATFORM_INIT_RETRY_DELAY
        };
    }

    /**
     * Validate that required modules are loaded
     * @private
     * @returns {boolean} Validation result
     */
    _validateModulesLoaded() {
        if (!this.PlatformClass || !this.subtitleUtils || !this.configService) {
            this.logWithFallback('error', 'Required modules not loaded for platform initialization');
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
            maxRetries: maxRetries + 1
        });
    }

    /**
     * Prepare for platform initialization
     * @private
     * @returns {Promise<void>}
     */
    async _prepareForInitialization() {
        // Sync subtitleUtils state with saved configuration
        if (this.subtitleUtils && typeof this.subtitleUtils.setSubtitlesActive === 'function') {
            this.subtitleUtils.setSubtitlesActive(this.currentConfig.subtitlesEnabled);
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
        this.activePlatform.handleNativeSubtitles();

        this.platformReady = true;
        this.processBufferedEvents();
        this.startVideoElementDetection();

        this.logWithFallback('info', 'Platform initialization completed successfully');
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
        this.logWithFallback('error', 'Error initializing platform', {
            error: error.message,
            attempt: context.attempt,
            maxRetries: context.totalAttempts
        });

        await this._cleanupPartialInitialization();

        if (context.retryCount < context.maxRetries) {
            return await this._scheduleRetry(context.retryCount, context.retryDelay);
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
        this.logWithFallback('info', `Retrying platform initialization in ${delay}ms`, {
            nextAttempt: retryCount + 2,
            delay
        });

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
        this.logWithFallback('error', 'Platform initialization failed after all retry attempts');
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
            this.logWithFallback('debug', 'Platform instance created successfully', {
                platformName: this.getPlatformName(),
                className: this.PlatformClass.name
            });
            return platform;
        } catch (error) {
            const errorContext = {
                error: error.message,
                stack: error.stack,
                platformName: this.getPlatformName(),
                className: this.PlatformClass?.name || 'unknown',
                currentUrl: window.location.href
            };
            this.logWithFallback('error', 'Failed to create platform instance', errorContext);
            throw new Error(`Platform instantiation failed: ${error.message}`);
        }
    }

    /**
     * Initialize platform with timeout protection
     * @private
     * @returns {Promise<void>}
     */
    async _initializePlatformWithTimeout() {
        const timeout = this.currentConfig?.platformInitTimeout || COMMON_CONSTANTS.PLATFORM_INIT_TIMEOUT;

        const initPromise = this.activePlatform.initialize(
            (subtitleData) => this.handleSubtitleDataFound(subtitleData),
            (newVideoId) => this.handleVideoIdChange(newVideoId)
        );

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Platform initialization timed out after ${timeout}ms`));
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
            if (this.activePlatform && typeof this.activePlatform.cleanup === 'function') {
                await this.activePlatform.cleanup();
                this.logWithFallback('debug', 'Previous platform instance cleaned up');
            }
        } catch (error) {
            this.logWithFallback('warn', 'Error cleaning up previous platform instance', { error });
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

            this.logWithFallback('debug', 'Partial initialization state cleaned up');
        } catch (error) {
            this.logWithFallback('warn', 'Error during partial initialization cleanup', { error });
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
        if (this.currentConfig.useOfficialTranslations === undefined && 
            this.currentConfig.useNativeSubtitles !== undefined) {
            this.currentConfig.useOfficialTranslations = this.currentConfig.useNativeSubtitles;
            this.logWithFallback('debug', 'Normalized useOfficialTranslations from useNativeSubtitles', {
                value: this.currentConfig.useOfficialTranslations
            });
        }
        
        // Ensure useOfficialTranslations has a default value
        if (this.currentConfig.useOfficialTranslations === undefined) {
            this.currentConfig.useOfficialTranslations = true; // Default to true
            this.logWithFallback('debug', 'Set default useOfficialTranslations value', {
                value: this.currentConfig.useOfficialTranslations
            });
        }
    }

    /**
     * Setup configuration change listeners
     */
    setupConfigurationListeners() {
        this.configService.onChanged(async (changes) => {
            this.logWithFallback('info', 'Config changed, updating', { changes });
            const newConfig = await this.configService.getAll();
            
            // Normalize the new configuration
            const oldConfig = this.currentConfig;
            this.currentConfig = newConfig;
            this._normalizeConfiguration();

            // Update existing object properties while preserving the reference
            Object.keys(this.currentConfig).forEach((key) => delete this.currentConfig[key]);
            Object.assign(this.currentConfig, newConfig);

            // Apply configuration changes
            this.applyConfigurationChanges(changes);
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
            document.addEventListener(config.eventId, eventHandler, { passive: true });
            this.eventListenerAttached = true;
            
            // Track cleanup function for proper memory management
            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(config.eventId, eventHandler);
                this.eventListenerAttached = false;
                this.logWithFallback('debug', 'Early event listener removed', { eventId: config.eventId });
            });
            
            this.logWithFallback('debug', 'Early event listener attached', { eventId: config.eventId });
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
                this.logWithFallback('warn', 'Event data missing required type field');
                return;
            }

            // Enhanced event processing with timestamp and validation
            // Preserve original data fields (including url) and add extra contextual
            // information without overwriting them.  Use a separate property
            // `pageUrl` so the subtitle URL remains intact.
            const eventData = {
                ...data,
                timestamp: Date.now(),
                pageUrl: window.location.href
            };

            if (data.type === 'INJECT_SCRIPT_READY') {
                this.logWithFallback('info', 'Inject script is ready');
                // Clear any stale buffered events when script reloads
                if (this.eventBuffer.size() > 0) {
                    this.logWithFallback('debug', 'Clearing stale buffered events on script reload');
                    this.eventBuffer.clear();
                }
            } else if (data.type === 'SUBTITLE_DATA_FOUND' || data.type === 'SUBTITLE_URL_FOUND') {
                // Enhanced buffering with size limits to prevent memory issues
                if (this.eventBuffer.size() >= 100) {
                    this.logWithFallback('warn', 'Event buffer size limit reached, clearing old events');
                    this.eventBuffer.clear();
                }
                this.eventBuffer.add(eventData);
                this.logWithFallback('debug', 'Subtitle data buffered', { 
                    bufferSize: this.eventBuffer.size(),
                    eventType: data.type 
                });
            }

            // Process buffered events if platform is ready
            if (this.platformReady && this.activePlatform && this.eventBuffer.size() > 0) {
                this.processBufferedEvents();
            }
        } catch (error) {
            this.logWithFallback('error', 'Error handling early injector event', { 
                error: error.message,
                stack: error.stack 
            });
        }
    }

    /**
     * Process buffered events with enhanced error handling and validation
     */
    processBufferedEvents() {
        if (!this.activePlatform) {
            this.logWithFallback('warn', 'Cannot process buffered events: platform not ready');
            return;
        }

        const bufferSize = this.eventBuffer.size();
        this.logWithFallback('info', 'Processing buffered events', { count: bufferSize });

        this.eventBuffer.processAll((eventData, index) => {
            try {
                // Validate event data before processing
                if (!eventData || !eventData.type) {
                    this.logWithFallback('warn', 'Skipping invalid buffered event', { index, eventData });
                    return;
                }

                // Check if event is still relevant (not too old)
                const eventAge = Date.now() - (eventData.timestamp || 0);
                const maxEventAge = 30000; // 30 seconds
                if (eventAge > maxEventAge) {
                    this.logWithFallback('debug', 'Skipping stale buffered event', { 
                        index, 
                        age: eventAge,
                        type: eventData.type 
                    });
                    return;
                }

                if (eventData.type === 'SUBTITLE_DATA_FOUND' || eventData.type === 'SUBTITLE_URL_FOUND') {
                    this.activePlatform.handleInjectorEvents({ detail: eventData });
                    this.logWithFallback('debug', 'Processed buffered subtitle event', { index });
                }
            } catch (error) {
                this.logWithFallback('error', 'Error processing buffered event', { 
                    index, 
                    error: error.message,
                    eventType: eventData?.type 
                });
            }
        });

        this.logWithFallback('info', 'Finished processing buffered events', { 
            originalCount: bufferSize,
            remainingCount: this.eventBuffer.size() 
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
            () => this.logWithFallback('info', 'Early inject script loaded successfully'),
            (error) => {
                this.logWithFallback('error', 'Failed to load early inject script!', { error });
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
        if (this.subtitleUtils && this.subtitleUtils.handleSubtitleDataFound) {
            this.subtitleUtils.handleSubtitleDataFound(
                subtitleData,
                this.activePlatform,
                this.currentConfig,
                this.logPrefix
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
                this.subtitleUtils.handleVideoIdChange(newVideoId, this.logPrefix);
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
                this.logWithFallback('info', 'Video element found and setup completed', {
                    attempts: this.videoDetectionRetries,
                });
            } else if (this.videoDetectionRetries >= this.maxVideoDetectionRetries) {
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
        if (!this.activePlatform || !this.subtitleUtils || !this.currentConfig) {
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
            this.logWithFallback('info', 'Subtitles are not active, hiding container');
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
                    const videoElementNow = this.activePlatform.getVideoElement();
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
            this.pageObserver.observe(document.body, { childList: true, subtree: true });
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
                this.logWithFallback('warn', 'Received null or undefined request');
                sendResponse({ success: false, error: 'Invalid request format' });
                return false;
            }

            const action = request.action || request.type;
            
            this.logWithFallback('debug', 'Received Chrome message', { 
                action, 
                hasUtilities: !!(this.subtitleUtils && this.configService),
                hasRegisteredHandler: this.messageHandlers.has(action)
            });

            // Validate message structure
            if (!action) {
                this.logWithFallback('warn', 'Received message without action or type', { request });
                sendResponse({ success: false, error: 'Message missing action or type' });
                return false;
            }

            // Check if we have a registered handler for this action
            const handlerConfig = this.messageHandlers.get(action);
            if (handlerConfig) {
                this.logWithFallback('debug', 'Using registered message handler', { 
                    action,
                    description: handlerConfig.description,
                    requiresUtilities: handlerConfig.requiresUtilities
                });

                // Check if handler requires utilities and they're not loaded
                if (handlerConfig.requiresUtilities && (!this.subtitleUtils || !this.configService)) {
                    this.logWithFallback('error', 'Handler requires utilities but they are not loaded', { action });
                    sendResponse({ success: false, error: 'Utilities not loaded' });
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
            this.logWithFallback('debug', 'Delegating to platform-specific handler', { action });
            return this.handlePlatformSpecificMessage(request, sendResponse);

        } catch (error) {
            this.logWithFallback('error', 'Error in Chrome message handling', { 
                error: error.message, 
                stack: error.stack,
                action: request.action || request.type 
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
            this.logWithFallback('info', 'Handling toggle subtitles', { enabled: request.enabled });
            
            this.subtitleUtils.setSubtitlesActive(request.enabled);

            if (!request.enabled) {
                return this._disableSubtitles(sendResponse, request.enabled);
            } else {
                return this._enableSubtitles(sendResponse, request.enabled);
            }
        } catch (error) {
            this.logWithFallback('error', 'Error in handleToggleSubtitles', { error: error.message });
            sendResponse({
                success: false,
                error: error.message
            });
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
            this.logWithFallback('debug', 'Handling config changed', { changes: request.changes });

            if (
                request.changes &&
                this.activePlatform &&
                this.subtitleUtils.subtitlesActive
            ) {
                // Update local config with the changes for immediate effect
                Object.assign(this.currentConfig, request.changes);
                
                // Handle backward compatibility for useNativeSubtitles -> useOfficialTranslations
                if (request.changes.useNativeSubtitles !== undefined && 
                    request.changes.useOfficialTranslations === undefined) {
                    this.currentConfig.useOfficialTranslations = request.changes.useNativeSubtitles;
                    this.logWithFallback('debug', 'Normalized useOfficialTranslations from immediate change', {
                        value: this.currentConfig.useOfficialTranslations
                    });
                }

                // Apply the changes immediately for instant visual feedback
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
                this.logWithFallback('info', 'Applied immediate config changes', {
                    changes: request.changes,
                });
            }
            sendResponse({ success: true });
            return false;
        } catch (error) {
            this.logWithFallback('error', 'Error in handleConfigChanged', { error: error.message });
            sendResponse({
                success: false,
                error: error.message
            });
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
            this.logWithFallback('debug', 'Handling logging level change', { level: request.level });

            if (this.contentLogger) {
                this.contentLogger.updateLevel(request.level);
                this.contentLogger.info('Logging level updated from background script', {
                    newLevel: request.level,
                });
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
            this.logWithFallback('error', 'Error in handleLoggingLevelChanged', { error: error.message });
            sendResponse({
                success: false,
                error: error.message
            });
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
        }
        this.activePlatform = null;
        this.platformReady = false;
        sendResponse({
            success: true,
            subtitlesEnabled: enabled,
        });
        return false;
    }

    /**
     * Enable subtitles helper method
     * @private
     * @param {Function} sendResponse - Response callback
     * @param {boolean} enabled - Enabled state
     * @returns {boolean} Whether response is handled asynchronously
     */
    _enableSubtitles(sendResponse, enabled) {
        if (!this.activePlatform) {
            this.initializePlatform()
                .then(() => {
                    sendResponse({
                        success: true,
                        subtitlesEnabled: enabled,
                    });
                })
                .catch((error) => {
                    this.logWithFallback(
                        'error',
                        'Error in platform initialization',
                        { error: error.message }
                    );
                    sendResponse({
                        success: false,
                        error: error.message,
                    });
                });
            return true; // Async response
        } else if (this.activePlatform.isPlayerPageActive()) {
            this.startVideoElementDetection();
            sendResponse({
                success: true,
                subtitlesEnabled: enabled,
            });
        } else {
            sendResponse({
                success: true,
                subtitlesEnabled: enabled,
            });
        }
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
        this.setupChromeMessageHandler();

        // Handle extension context invalidation
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.logWithFallback('debug', 'Page hidden, pausing operations');
            } else {
                this.logWithFallback('debug', 'Page visible, resuming operations');
                // Re-check video setup when page becomes visible
                if (this.activePlatform && this.subtitleUtils && this.subtitleUtils.subtitlesActive) {
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
            this.logWithFallback('debug', 'Cleanup already performed, skipping');
            return;
        }

        this.logWithFallback('info', 'Starting comprehensive content script cleanup');

        // Mark as cleaning up to prevent concurrent cleanup calls
        this.isCleanedUp = true;

        // 1. Stop all detection and monitoring activities
        await this._stopAllDetectionActivities();

        // 2. Clean up platform resources
        await this._cleanupPlatformResources();

        // 3. Clean up DOM and UI resources
        await this._cleanupDOMResources();

        // 4. Clean up event handling and listeners
        await this._cleanupEventHandling();

        // 5. Clean up intervals and timers
        await this._cleanupTimersAndIntervals();

        // 6. Clean up observers and watchers
        await this._cleanupObservers();

        // 7. Reset internal state
        this._resetInternalState();

        this.logWithFallback('info', 'Content script cleanup completed successfully');
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
            this.logWithFallback('warn', 'Error stopping detection activities', { error });
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
                const cleanupTimeout = this.currentConfig?.cleanupTimeout || COMMON_CONSTANTS.CLEANUP_TIMEOUT;

                const cleanupPromise = typeof this.activePlatform.cleanup === 'function'
                    ? this.activePlatform.cleanup()
                    : Promise.resolve();

                const timeoutPromise = new Promise((resolve) => {
                    setTimeout(() => {
                        this.logWithFallback('warn', 'Platform cleanup timed out');
                        resolve();
                    }, cleanupTimeout);
                });

                await Promise.race([cleanupPromise, timeoutPromise]);
                this.activePlatform = null;
                this.logWithFallback('debug', 'Platform resources cleaned up');
            }
        } catch (error) {
            this.logWithFallback('warn', 'Error cleaning up platform resources', { error });
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
                if (typeof this.subtitleUtils.hideSubtitleContainer === 'function') {
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
                this.logWithFallback('debug', 'Injected script removed from DOM');
            }

            this.logWithFallback('debug', 'DOM resources cleaned up');
        } catch (error) {
            this.logWithFallback('warn', 'Error cleaning up DOM resources', { error });
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
            if (this.eventListenerCleanupFunctions && this.eventListenerCleanupFunctions.length > 0) {
                this.logWithFallback('debug', 'Executing event listener cleanup functions', { 
                    count: this.eventListenerCleanupFunctions.length 
                });
                
                for (const cleanupFn of this.eventListenerCleanupFunctions) {
                    try {
                        cleanupFn();
                    } catch (cleanupError) {
                        this.logWithFallback('warn', 'Error in event listener cleanup function', { 
                            error: cleanupError.message 
                        });
                    }
                }
                this.eventListenerCleanupFunctions = [];
            }

            // Clean up Chrome message listeners
            if (chrome.runtime && chrome.runtime.onMessage) {
                // Note: Chrome extension listeners are automatically cleaned up when content script is destroyed
                this.logWithFallback('debug', 'Chrome message listeners will be cleaned up automatically');
            }

            this.logWithFallback('debug', 'Event handling cleaned up');
        } catch (error) {
            this.logWithFallback('warn', 'Error cleaning up event handling', { error });
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
            this.logWithFallback('warn', 'Error cleaning up timers and intervals', { error });
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
            if (this.domObserverCleanupFunctions && this.domObserverCleanupFunctions.length > 0) {
                this.logWithFallback('debug', 'Executing DOM observer cleanup functions', { 
                    count: this.domObserverCleanupFunctions.length 
                });
                
                for (const cleanupFn of this.domObserverCleanupFunctions) {
                    try {
                        cleanupFn();
                    } catch (cleanupError) {
                        this.logWithFallback('warn', 'Error in DOM observer cleanup function', { 
                            error: cleanupError.message 
                        });
                    }
                }
                this.domObserverCleanupFunctions = [];
            }

            // Disconnect DOM observer (fallback cleanup)
            if (this.pageObserver) {
                this.pageObserver.disconnect();
                this.pageObserver = null;
                this.logWithFallback('debug', 'Main DOM observer disconnected (fallback)');
            }

            // Disconnect video element observer (fallback cleanup)
            if (this.videoElementObserver) {
                this.videoElementObserver.disconnect();
                this.videoElementObserver = null;
                this.logWithFallback('debug', 'Video element observer disconnected (fallback)');
            }

            // Disconnect navigation observer (fallback cleanup)
            if (this.navigationObserver) {
                this.navigationObserver.disconnect();
                this.navigationObserver = null;
                this.logWithFallback('debug', 'Navigation observer disconnected (fallback)');
            }

            // Disconnect passive video observer
            if (this.passiveVideoObserver) {
                this.passiveVideoObserver.disconnect();
                this.passiveVideoObserver = null;
                this.logWithFallback('debug', 'Passive video observer disconnected');
            }

            // Clean up any other observers
            if (this.configObserver) {
                this.configObserver.disconnect();
                this.configObserver = null;
            }

            this.logWithFallback('debug', 'Observers cleaned up');
        } catch (error) {
            this.logWithFallback('warn', 'Error cleaning up observers', { error });
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
                Object.keys(this.currentConfig).forEach(key => delete this.currentConfig[key]);
            }

            this.logWithFallback('debug', 'Internal state reset');
        } catch (error) {
            this.logWithFallback('warn', 'Error resetting internal state', { error });
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
                this.logWithFallback('info', 'Video element found and setup completed', {
                    attempts: this.videoDetectionRetries,
                });
            } else if (this.videoDetectionRetries >= this.maxVideoDetectionRetries) {
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
        if (!this.activePlatform || !this.subtitleUtils || !this.currentConfig) {
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
            this.logWithFallback('info', 'Subtitles are not active, hiding container');
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
                    const videoElementNow = this.activePlatform.getVideoElement();
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
            this.pageObserver.observe(document.body, { childList: true, subtree: true });
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



    // ========================================
    // CLEANUP AND MEMORY MANAGEMENT
    // ========================================

    /**
     * Setup cleanup handlers to prevent memory leaks
     */
    setupCleanupHandlers() {
        // Listen for extension context invalidation
        chrome.runtime.onConnect.addListener((port) => {
            port.onDisconnect.addListener(() => {
                if (chrome.runtime.lastError) {
                    this.logWithFallback(
                        'info',
                        'Extension context invalidated, cleaning up'
                    );
                    this.cleanup();
                }
            });
        });

        // Handle page unload
        window.addEventListener('beforeunload', () => this.cleanup());
    }

}