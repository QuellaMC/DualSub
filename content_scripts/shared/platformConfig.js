/**
 * PlatformConfig - Platform configuration management for streaming platforms
 * 
 * This module provides a centralized system for managing platform-specific
 * configurations, making it easy to add new platforms and customize behavior
 * for different streaming services.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * PlatformConfigManager - Manages platform-specific configurations
 * 
 * This class provides a registry system for platform configurations,
 * allowing easy registration of new platforms and retrieval of
 * platform-specific settings.
 * 
 * @example
 * ```javascript
 * // Register a new platform
 * PlatformConfigManager.registerPlatform('hulu', {
 *     name: 'hulu',
 *     displayName: 'Hulu',
 *     urlPatterns: ['*.hulu.com'],
 *     playerPagePattern: '/watch/',
 *     navigationConfig: {
 *         intervalMs: 800,
 *         useHistoryAPI: true
 *     }
 * });
 * 
 * // Get platform configuration
 * const config = PlatformConfigManager.getConfig('hulu');
 * ```
 */
export class PlatformConfigManager {
    static _platforms = new Map();
    static _initialized = false;

    /**
     * Initialize the platform registry with default platforms
     */
    static initialize() {
        if (this._initialized) {
            return;
        }

        // Register default platforms
        this._registerDefaultPlatforms();
        this._initialized = true;
    }

    /**
     * Register a new platform configuration
     * @param {string} name - Platform name (lowercase identifier)
     * @param {Object} config - Platform configuration
     * @param {string} config.name - Platform identifier
     * @param {string} config.displayName - Human-readable platform name
     * @param {string[]} config.urlPatterns - URL patterns for platform detection
     * @param {string|Function} config.playerPagePattern - Pattern or function to detect player pages
     * @param {Object} [config.navigationConfig] - Navigation detection configuration
     * @param {Object} [config.subtitleConfig] - Subtitle processing configuration
     * @param {Object} [config.injectionConfig] - Script injection configuration
     * @param {Object} [config.videoDetectionConfig] - Video element detection configuration
     * @param {Object} [config.platformSpecific] - Platform-specific settings
     */
    static registerPlatform(name, config) {
        const normalizedName = name.toLowerCase();
        
        // Validate required fields
        this._validatePlatformConfig(config);
        
        // Merge with defaults
        const fullConfig = this._mergeWithDefaults(config);
        
        this._platforms.set(normalizedName, fullConfig);
        
        console.log(`[PlatformConfig] Registered platform: ${normalizedName}`, {
            displayName: fullConfig.displayName,
            urlPatterns: fullConfig.urlPatterns
        });
    }

    /**
     * Get platform configuration by name
     * @param {string} name - Platform name
     * @returns {Object|null} Platform configuration or null if not found
     */
    static getConfig(name) {
        this.initialize();
        const normalizedName = name.toLowerCase();
        return this._platforms.get(normalizedName) || null;
    }

    /**
     * Get all registered platforms
     * @returns {Map} Map of platform configurations
     */
    static getAllPlatforms() {
        this.initialize();
        return new Map(this._platforms);
    }

    /**
     * Check if a platform is registered
     * @param {string} name - Platform name
     * @returns {boolean} Whether the platform is registered
     */
    static isPlatformRegistered(name) {
        this.initialize();
        return this._platforms.has(name.toLowerCase());
    }

    /**
     * Detect platform from URL
     * @param {string} url - URL to check
     * @returns {Object|null} Platform configuration if detected
     */
    static detectPlatformFromUrl(url) {
        this.initialize();
        
        for (const [name, config] of this._platforms) {
            if (this._urlMatchesPlatform(url, config.urlPatterns)) {
                return { name, ...config };
            }
        }
        
        return null;
    }

    /**
     * Get platform-specific navigation configuration
     * @param {string} name - Platform name
     * @returns {Object} Navigation configuration
     */
    static getNavigationConfig(name) {
        const config = this.getConfig(name);
        return config ? config.navigationConfig : this._getDefaultNavigationConfig();
    }

    /**
     * Get platform-specific subtitle configuration
     * @param {string} name - Platform name
     * @returns {Object} Subtitle configuration
     */
    static getSubtitleConfig(name) {
        const config = this.getConfig(name);
        return config ? config.subtitleConfig : this._getDefaultSubtitleConfig();
    }

    /**
     * Get platform-specific injection configuration
     * @param {string} name - Platform name
     * @returns {Object} Injection configuration
     */
    static getInjectionConfig(name) {
        const config = this.getConfig(name);
        return config ? config.injectionConfig : this._getDefaultInjectionConfig();
    }

    // ========================================
    // PRIVATE METHODS
    // ========================================

    /**
     * Register default platforms
     * @private
     */
    static _registerDefaultPlatforms() {
        // Netflix configuration
        this.registerPlatform('netflix', {
            name: 'netflix',
            displayName: 'Netflix',
            urlPatterns: ['*.netflix.com'],
            playerPagePattern: '/watch/',
            navigationConfig: {
                intervalMs: 1000,
                useHistoryAPI: true,
                usePopstateEvents: true,
                useIntervalChecking: true,
                useFocusEvents: true,
                pageTransitionDelay: 1500
            },
            subtitleConfig: {
                supportsOfficialTranslations: true,
                maxVideoDetectionRetries: 40,
                videoDetectionInterval: 1000,
                timeOffset: 0,
                supportedFormats: ['vtt', 'ttml', 'json']
            },
            injectionConfig: {
                filename: 'injected_scripts/netflixInject.js',
                tagId: 'netflix-dualsub-injector-script-tag',
                eventId: 'netflix-dualsub-injector-event',
                retryDelay: 10,
                maxRetries: 100
            },
            videoDetectionConfig: {
                selectors: ['video'],
                containerSelectors: ['.watch-video', '.nfp'],
                progressBarSelectors: ['[role="slider"][aria-label*="seek"]']
            },
            platformSpecific: {
                requiresEnhancedNavigation: true,
                complexSPARouting: true,
                hasOfficialSubtitleAPI: true
            }
        });

        // Disney+ configuration
        this.registerPlatform('disneyplus', {
            name: 'disneyplus',
            displayName: 'Disney+',
            urlPatterns: ['*.disneyplus.com'],
            playerPagePattern: (pathname) => {
                return pathname.includes('/video/') || 
                       pathname.includes('/movies/') || 
                       pathname.includes('/series/');
            },
            navigationConfig: {
                intervalMs: 500, // More frequent for Disney+
                useHistoryAPI: true,
                usePopstateEvents: true,
                useIntervalChecking: true,
                useFocusEvents: true,
                pageTransitionDelay: 1000
            },
            subtitleConfig: {
                supportsOfficialTranslations: false, // Disney+ doesn't provide official translations yet
                maxVideoDetectionRetries: 30,
                videoDetectionInterval: 800,
                timeOffset: 0,
                supportedFormats: ['vtt', 'webvtt']
            },
            injectionConfig: {
                filename: 'injected_scripts/disneyPlusInject.js',
                tagId: 'disneyplus-dualsub-injector-script-tag',
                eventId: 'disneyplus-dualsub-injector-event',
                retryDelay: 15,
                maxRetries: 80
            },
            videoDetectionConfig: {
                selectors: ['video'],
                containerSelectors: ['.btm-media-overlays-container', '.video-player-container'],
                progressBarSelectors: ['[role="slider"]', '.scrubber-bar']
            },
            platformSpecific: {
                requiresEnhancedNavigation: true,
                complexSPARouting: true,
                hasNavigationIssues: true,
                needsPlayerReadyDetection: true
            }
        });
    }

    /**
     * Validate platform configuration
     * @private
     * @param {Object} config - Configuration to validate
     */
    static _validatePlatformConfig(config) {
        const required = ['name', 'displayName', 'urlPatterns'];
        
        for (const field of required) {
            if (!config[field]) {
                throw new Error(`Platform configuration missing required field: ${field}`);
            }
        }

        if (!Array.isArray(config.urlPatterns) || config.urlPatterns.length === 0) {
            throw new Error('Platform configuration must have at least one URL pattern');
        }
    }

    /**
     * Merge configuration with defaults
     * @private
     * @param {Object} config - User configuration
     * @returns {Object} Merged configuration
     */
    static _mergeWithDefaults(config) {
        const defaults = {
            navigationConfig: this._getDefaultNavigationConfig(),
            subtitleConfig: this._getDefaultSubtitleConfig(),
            injectionConfig: this._getDefaultInjectionConfig(),
            videoDetectionConfig: this._getDefaultVideoDetectionConfig(),
            platformSpecific: {}
        };

        return {
            ...defaults,
            ...config,
            // Deep merge nested objects
            navigationConfig: {
                ...defaults.navigationConfig,
                ...(config.navigationConfig || {})
            },
            subtitleConfig: {
                ...defaults.subtitleConfig,
                ...(config.subtitleConfig || {})
            },
            injectionConfig: {
                ...defaults.injectionConfig,
                ...(config.injectionConfig || {})
            },
            videoDetectionConfig: {
                ...defaults.videoDetectionConfig,
                ...(config.videoDetectionConfig || {})
            },
            platformSpecific: {
                ...defaults.platformSpecific,
                ...(config.platformSpecific || {})
            }
        };
    }

    /**
     * Check if URL matches platform patterns
     * @private
     * @param {string} url - URL to check
     * @param {string[]} patterns - URL patterns
     * @returns {boolean} Whether URL matches
     */
    static _urlMatchesPlatform(url, patterns) {
        return patterns.some(pattern => {
            // Convert glob pattern to regex
            const regexPattern = pattern
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*');
            
            const regex = new RegExp(regexPattern, 'i');
            return regex.test(url);
        });
    }

    /**
     * Get default navigation configuration
     * @private
     * @returns {Object} Default navigation config
     */
    static _getDefaultNavigationConfig() {
        return {
            intervalMs: 1000,
            useHistoryAPI: true,
            usePopstateEvents: true,
            useIntervalChecking: true,
            useFocusEvents: true,
            pageTransitionDelay: 1000
        };
    }

    /**
     * Get default subtitle configuration
     * @private
     * @returns {Object} Default subtitle config
     */
    static _getDefaultSubtitleConfig() {
        return {
            supportsOfficialTranslations: false,
            maxVideoDetectionRetries: 30,
            videoDetectionInterval: 1000,
            timeOffset: 0,
            supportedFormats: ['vtt', 'webvtt']
        };
    }

    /**
     * Get default injection configuration
     * @private
     * @returns {Object} Default injection config
     */
    static _getDefaultInjectionConfig() {
        return {
            filename: null,
            tagId: null,
            eventId: null,
            retryDelay: 10,
            maxRetries: 50
        };
    }

    /**
     * Get default video detection configuration
     * @private
     * @returns {Object} Default video detection config
     */
    static _getDefaultVideoDetectionConfig() {
        return {
            selectors: ['video'],
            containerSelectors: ['.video-container', '.player-container'],
            progressBarSelectors: ['[role="slider"]']
        };
    }
}

/**
 * PlatformDetector - Utility class for detecting current platform
 * 
 * This class provides methods to detect which streaming platform
 * the user is currently on and retrieve the appropriate configuration.
 */
export class PlatformDetector {
    /**
     * Detect current platform from window location
     * @returns {Object|null} Platform configuration if detected
     */
    static detectCurrentPlatform() {
        return PlatformConfigManager.detectPlatformFromUrl(window.location.href);
    }

    /**
     * Check if current page is a player page for the detected platform
     * @returns {boolean} Whether current page is a player page
     */
    static isCurrentPagePlayerPage() {
        const platform = this.detectCurrentPlatform();
        if (!platform) {
            return false;
        }

        const pathname = window.location.pathname;
        
        if (typeof platform.playerPagePattern === 'function') {
            return platform.playerPagePattern(pathname);
        } else if (typeof platform.playerPagePattern === 'string') {
            return pathname.includes(platform.playerPagePattern);
        }

        return false;
    }

    /**
     * Get platform name from current URL
     * @returns {string|null} Platform name or null if not detected
     */
    static getCurrentPlatformName() {
        const platform = this.detectCurrentPlatform();
        return platform ? platform.name : null;
    }
}

/**
 * Platform configuration templates for easy platform addition
 */
export const PLATFORM_TEMPLATES = {
    /**
     * Basic streaming platform template
     */
    basicStreaming: {
        navigationConfig: {
            intervalMs: 1000,
            useHistoryAPI: true,
            usePopstateEvents: true,
            useIntervalChecking: true,
            useFocusEvents: true
        },
        subtitleConfig: {
            supportsOfficialTranslations: false,
            maxVideoDetectionRetries: 30,
            videoDetectionInterval: 1000
        },
        videoDetectionConfig: {
            selectors: ['video'],
            containerSelectors: ['.video-container', '.player-container']
        }
    },

    /**
     * Complex SPA streaming platform template
     */
    complexSPA: {
        navigationConfig: {
            intervalMs: 800,
            useHistoryAPI: true,
            usePopstateEvents: true,
            useIntervalChecking: true,
            useFocusEvents: true,
            pageTransitionDelay: 1500
        },
        subtitleConfig: {
            supportsOfficialTranslations: false,
            maxVideoDetectionRetries: 40,
            videoDetectionInterval: 800
        },
        platformSpecific: {
            requiresEnhancedNavigation: true,
            complexSPARouting: true
        }
    }
};

/**
 * Utility functions for platform configuration
 */

/**
 * Create a platform configuration from a template
 * @param {string} templateName - Template name from PLATFORM_TEMPLATES
 * @param {Object} overrides - Configuration overrides
 * @returns {Object} Platform configuration
 * 
 * @example
 * ```javascript
 * const huluConfig = createPlatformFromTemplate('basicStreaming', {
 *     name: 'hulu',
 *     displayName: 'Hulu',
 *     urlPatterns: ['*.hulu.com'],
 *     playerPagePattern: '/watch/'
 * });
 * 
 * PlatformConfigManager.registerPlatform('hulu', huluConfig);
 * ```
 */
export function createPlatformFromTemplate(templateName, overrides) {
    const template = PLATFORM_TEMPLATES[templateName];
    if (!template) {
        throw new Error(`Unknown platform template: ${templateName}`);
    }

    return {
        ...template,
        ...overrides,
        // Deep merge nested objects
        navigationConfig: {
            ...template.navigationConfig,
            ...(overrides.navigationConfig || {})
        },
        subtitleConfig: {
            ...template.subtitleConfig,
            ...(overrides.subtitleConfig || {})
        },
        videoDetectionConfig: {
            ...template.videoDetectionConfig,
            ...(overrides.videoDetectionConfig || {})
        },
        platformSpecific: {
            ...template.platformSpecific,
            ...(overrides.platformSpecific || {})
        }
    };
}

/**
 * Validate that a platform configuration is complete
 * @param {Object} config - Platform configuration to validate
 * @returns {Object} Validation result
 * 
 * @example
 * ```javascript
 * const validation = validatePlatformConfig(myConfig);
 * if (!validation.isValid) {
 *     console.error('Configuration errors:', validation.errors);
 * }
 * ```
 */
export function validatePlatformConfig(config) {
    const errors = [];
    const warnings = [];

    // Required fields
    const required = ['name', 'displayName', 'urlPatterns'];
    required.forEach(field => {
        if (!config[field]) {
            errors.push(`Missing required field: ${field}`);
        }
    });

    // URL patterns validation
    if (config.urlPatterns && !Array.isArray(config.urlPatterns)) {
        errors.push('urlPatterns must be an array');
    } else if (config.urlPatterns && config.urlPatterns.length === 0) {
        errors.push('urlPatterns must contain at least one pattern');
    }

    // Player page pattern validation
    if (config.playerPagePattern && 
        typeof config.playerPagePattern !== 'string' && 
        typeof config.playerPagePattern !== 'function') {
        errors.push('playerPagePattern must be a string or function');
    }

    // Injection config validation
    if (config.injectionConfig) {
        const injection = config.injectionConfig;
        if (injection.filename && !injection.tagId) {
            warnings.push('injectionConfig has filename but no tagId');
        }
        if (injection.filename && !injection.eventId) {
            warnings.push('injectionConfig has filename but no eventId');
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}

// Initialize the platform registry
PlatformConfigManager.initialize();