/**
 * This module provides a centralized system for managing platform-specific
 * configurations, making it easy to add new platforms and customize behavior
 * for different streaming services.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * Manages platform-specific configurations, providing a registry for easy
 * registration and retrieval of settings.
 */
export class PlatformConfigManager {
    static _platforms = new Map();
    static _initialized = false;

    /**
     * Initializes the platform registry with default platforms.
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
     * Registers a new platform configuration.
     * @param {string} name - The platform name (e.g., 'netflix').
     * @param {Object} config - The platform configuration object.
     */
    static registerPlatform(name, config) {
        const normalizedName = name.toLowerCase();
        
        try {
            this._validatePlatformConfig(config);
            const fullConfig = this._mergeWithDefaults(config);
            this._platforms.set(normalizedName, fullConfig);
            
            console.log(`[PlatformConfig] Registered platform: ${normalizedName}`, {
                displayName: fullConfig.displayName,
                urlPatterns: fullConfig.urlPatterns
            });
        } catch (error) {
            console.error(`[PlatformConfig] Failed to register platform '${name}':`, error.message);
        }
    }

    /**
     * Gets the configuration for a specific platform.
     * @param {string} name - The name of the platform.
     * @returns {Object|null} The platform configuration, or `null` if not found.
     */
    static getConfig(name) {
        this.initialize();
        const normalizedName = name.toLowerCase();
        return this._platforms.get(normalizedName) || null;
    }

    /**
     * Gets all registered platform configurations.
     * @returns {Map<string, Object>} A map of platform configurations.
     */
    static getAllPlatforms() {
        this.initialize();
        return new Map(this._platforms);
    }

    /**
     * Checks if a platform is registered.
     * @param {string} name - The name of the platform.
     * @returns {boolean} `true` if the platform is registered, otherwise `false`.
     */
    static isPlatformRegistered(name) {
        this.initialize();
        return this._platforms.has(name.toLowerCase());
    }

    /**
     * Detects the platform from a given URL.
     * @param {string} url - The URL to check.
     * @returns {Object|null} The configuration of the detected platform, or `null`.
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
     * Gets the navigation configuration for a specific platform.
     * @param {string} name - The name of the platform.
     * @returns {Object} The navigation configuration.
     */
    static getNavigationConfig(name) {
        const config = this.getConfig(name);
        return config ? config.navigationConfig : this._getDefaultNavigationConfig();
    }

    /**
     * Gets the subtitle configuration for a specific platform.
     * @param {string} name - The name of the platform.
     * @returns {Object} The subtitle configuration.
     */
    static getSubtitleConfig(name) {
        const config = this.getConfig(name);
        return config ? config.subtitleConfig : this._getDefaultSubtitleConfig();
    }

    /**
     * Gets the script injection configuration for a specific platform.
     * @param {string} name - The name of the platform.
     * @returns {Object} The injection configuration.
     */
    static getInjectionConfig(name) {
        const config = this.getConfig(name);
        return config ? config.injectionConfig : this._getDefaultInjectionConfig();
    }

    // ========================================
    // PRIVATE METHODS
    // ========================================

    /**
     * Registers the default platform configurations.
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
     * Validates a platform configuration object.
     * @private
     * @param {Object} config - The configuration to validate.
     */
    static _validatePlatformConfig(config) {
        const required = ['name', 'displayName', 'urlPatterns'];
        
        for (const field of required) {
            if (!config[field]) {
                throw new Error(`Platform configuration missing required field: ${field}`);
            }
        }

        if (config.urlPatterns && !Array.isArray(config.urlPatterns)) {
            throw new Error('urlPatterns must be an array');
        }
        if (config.urlPatterns && config.urlPatterns.length === 0) {
            throw new Error('urlPatterns must contain at least one pattern');
        }
    }

    /**
     * Merges a platform configuration with default values.
     * @private
     * @param {Object} config - The user-provided configuration.
     * @returns {Object} The merged configuration.
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
     * Checks if a URL matches the patterns for a platform.
     * @private
     * @param {string} url - The URL to check.
     * @param {string[]} patterns - The URL patterns to match against.
     * @returns {boolean} `true` if the URL matches, otherwise `false`.
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
     * Gets the default navigation configuration.
     * @private
     * @returns {Object} The default navigation configuration.
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
     * Gets the default subtitle configuration.
     * @private
     * @returns {Object} The default subtitle configuration.
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
     * Gets the default script injection configuration.
     * @private
     * @returns {Object} The default injection configuration.
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
     * Gets the default video detection configuration.
     * @private
     * @returns {Object} The default video detection configuration.
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
 * A utility class for detecting the current platform.
 */
export class PlatformDetector {
    /**
     * Detects the current platform from the window's location.
     * @returns {Object|null} The configuration of the detected platform, or `null`.
     */
    static detectCurrentPlatform() {
        return PlatformConfigManager.detectPlatformFromUrl(window.location.href);
    }

    /**
     * Checks if the current page is a player page for the detected platform.
     * @returns {boolean} `true` if the current page is a player page, otherwise `false`.
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
     * Gets the name of the current platform from the URL.
     * @returns {string|null} The platform name, or `null` if not detected.
     */
    static getCurrentPlatformName() {
        const platform = this.detectCurrentPlatform();
        return platform ? platform.name : null;
    }
}

/**
 * Provides templates for creating platform configurations.
 */
export const PLATFORM_TEMPLATES = {
    /**
     * A template for basic streaming platforms.
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
     * A template for complex SPA-based streaming platforms.
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
 * Creates a platform configuration from a template.
 * @param {string} templateName - The name of the template to use.
 * @param {Object} overrides - Configuration properties to override the template defaults.
 * @returns {Object} A new platform configuration object.
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
 * Validates that a platform configuration is complete and correctly structured.
 * @param {Object} config - The platform configuration to validate.
 * @returns {{isValid: boolean, errors: string[], warnings: string[]}} The validation result.
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