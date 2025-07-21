/**
 * Platform Configuration Factory
 * 
 * Factory pattern implementation for creating platform-specific configurations.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

import { DEFAULT_PLATFORM_CONFIGS } from './constants.js';

/**
 * Platform configuration factory
 */
export class PlatformConfigFactory {
    static #registeredPlatforms = new Map();

    /**
     * Register a platform configuration
     * @param {string} platformName - Platform name
     * @param {Object} config - Platform configuration
     */
    static register(platformName, config) {
        this.#registeredPlatforms.set(platformName, config);
    }

    /**
     * Create platform configuration by name
     * @param {string} platformName - Platform name
     * @returns {Object|null} Platform configuration or null
     */
    static create(platformName) {
        // Check registered platforms first
        if (this.#registeredPlatforms.has(platformName)) {
            return { ...this.#registeredPlatforms.get(platformName) };
        }

        // Fall back to default configurations
        if (DEFAULT_PLATFORM_CONFIGS[platformName]) {
            return { ...DEFAULT_PLATFORM_CONFIGS[platformName] };
        }

        return null;
    }

    /**
     * Create platform configuration by URL
     * @param {string} url - URL to match against
     * @returns {Object|null} Platform configuration or null
     */
    static createByUrl(url = window.location.href) {
        // Check registered platforms first
        for (const [name, config] of this.#registeredPlatforms) {
            if (this.#matchesUrlPatterns(url, config.navigation?.urlPatterns || [])) {
                return { ...config };
            }
        }

        // Check default configurations
        for (const [name, config] of Object.entries(DEFAULT_PLATFORM_CONFIGS)) {
            if (this.#matchesUrlPatterns(url, config.navigation.urlPatterns)) {
                return { ...config };
            }
        }

        return null;
    }

    /**
     * Get all registered platform names
     * @returns {string[]} Array of platform names
     */
    static getRegisteredPlatforms() {
        return [
            ...Array.from(this.#registeredPlatforms.keys()),
            ...Object.keys(DEFAULT_PLATFORM_CONFIGS)
        ];
    }

    /**
     * Check if platform is supported
     * @param {string} platformName - Platform name
     * @returns {boolean} Whether platform is supported
     */
    static isSupported(platformName) {
        return this.#registeredPlatforms.has(platformName) || 
               DEFAULT_PLATFORM_CONFIGS.hasOwnProperty(platformName);
    }

    /**
     * Validate platform configuration
     * @param {Object} config - Configuration to validate
     * @returns {Object} Validation result
     */
    static validate(config) {
        const errors = [];
        const warnings = [];

        // Required fields
        const requiredFields = ['name', 'injectScript', 'navigation', 'videoDetection'];
        for (const field of requiredFields) {
            if (!config[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }

        // Validate injectScript
        if (config.injectScript) {
            const requiredInjectFields = ['filename', 'tagId', 'eventId'];
            for (const field of requiredInjectFields) {
                if (!config.injectScript[field]) {
                    errors.push(`Missing required injectScript field: ${field}`);
                }
            }
        }

        // Validate navigation
        if (config.navigation) {
            if (!config.navigation.urlPatterns || !Array.isArray(config.navigation.urlPatterns)) {
                warnings.push('navigation.urlPatterns must be an array');
            }
            if (typeof config.navigation.spaHandling !== 'boolean') {
                warnings.push('navigation.spaHandling should be a boolean');
            }
        }

        // Validate videoDetection
        if (config.videoDetection) {
            if (typeof config.videoDetection.maxRetries !== 'number') {
                warnings.push('videoDetection.maxRetries should be a number');
            }
            if (typeof config.videoDetection.retryInterval !== 'number') {
                warnings.push('videoDetection.retryInterval should be a number');
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Create configuration builder for custom platforms
     * @param {string} platformName - Platform name
     * @returns {PlatformConfigBuilder} Configuration builder
     */
    static builder(platformName) {
        return new PlatformConfigBuilder(platformName);
    }

    /**
     * Check if URL matches any of the patterns
     * @private
     * @param {string} url - URL to check
     * @param {string[]} patterns - URL patterns to match
     * @returns {boolean} Whether URL matches any pattern
     */
    static #matchesUrlPatterns(url, patterns) {
        return patterns.some(pattern => {
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                // Regex pattern
                const regex = new RegExp(pattern.slice(1, -1));
                return regex.test(url);
            } else {
                // Simple string match
                return url.includes(pattern);
            }
        });
    }
}

/**
 * Builder pattern for creating platform configurations
 */
export class PlatformConfigBuilder {
    constructor(name) {
        this.config = {
            name,
            injectScript: {},
            navigation: {
                urlPatterns: [],
                spaHandling: false,
                checkInterval: 2000
            },
            videoDetection: {
                maxRetries: 30,
                retryInterval: 1000
            }
        };
    }

    /**
     * Set injection script configuration
     * @param {string} filename - Script filename
     * @param {string} tagId - Script tag ID
     * @param {string} eventId - Event ID
     * @returns {PlatformConfigBuilder} Builder instance
     */
    withInjectScript(filename, tagId, eventId) {
        this.config.injectScript = { filename, tagId, eventId };
        return this;
    }

    /**
     * Set navigation configuration
     * @param {string[]} urlPatterns - URL patterns
     * @param {boolean} spaHandling - Whether SPA handling is needed
     * @param {number} checkInterval - Check interval in ms
     * @returns {PlatformConfigBuilder} Builder instance
     */
    withNavigation(urlPatterns, spaHandling = false, checkInterval = 2000) {
        this.config.navigation = { urlPatterns, spaHandling, checkInterval };
        return this;
    }

    /**
     * Set video detection configuration
     * @param {number} maxRetries - Maximum retries
     * @param {number} retryInterval - Retry interval in ms
     * @returns {PlatformConfigBuilder} Builder instance
     */
    withVideoDetection(maxRetries = 30, retryInterval = 1000) {
        this.config.videoDetection = { maxRetries, retryInterval };
        return this;
    }

    /**
     * Set log prefix
     * @param {string} logPrefix - Log prefix
     * @returns {PlatformConfigBuilder} Builder instance
     */
    withLogPrefix(logPrefix) {
        this.config.logPrefix = logPrefix;
        return this;
    }

    /**
     * Build the configuration
     * @returns {Object} Platform configuration
     */
    build() {
        const validation = PlatformConfigFactory.validate(this.config);
        if (!validation.isValid) {
            throw new Error(`Invalid platform configuration: ${validation.errors.join(', ')}`);
        }
        return { ...this.config };
    }
}

// Default platforms are automatically available through DEFAULT_PLATFORM_CONFIGS
// No need to register them explicitly as they're handled in the create() method