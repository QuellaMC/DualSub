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
 * Factory for creating and managing platform-specific configurations.
 */
export class PlatformConfigFactory {
    static #registeredPlatforms = new Map();

    /**
     * Registers a new platform configuration or overrides an existing one.
     * @param {string} platformName - The name of the platform.
     * @param {Object} config - The platform-specific configuration object.
     */
    static register(platformName, config) {
        this.#registeredPlatforms.set(platformName, config);
    }

    /**
     * Creates a platform configuration by its name.
     * It first checks for a custom registered platform, then falls back to default configurations.
     * @param {string} platformName - The name of the platform.
     * @returns {Object|null} A copy of the platform configuration, or null if not found.
     */
    static create(platformName) {
        if (this.#registeredPlatforms.has(platformName)) {
            return { ...this.#registeredPlatforms.get(platformName) };
        }

        if (DEFAULT_PLATFORM_CONFIGS[platformName]) {
            return { ...DEFAULT_PLATFORM_CONFIGS[platformName] };
        }

        return null;
    }

    /**
     * Creates a platform configuration by matching a URL against registered URL patterns.
     * @param {string} [url=window.location.href] - The URL to match.
     * @returns {Object|null} A copy of the matched platform configuration, or null if no match is found.
     */
    static createByUrl(url = window.location.href) {
        for (const [, config] of this.#registeredPlatforms) {
            if (this.#matchesUrlPatterns(url, config.navigation?.urlPatterns || [])) {
                return { ...config };
            }
        }

        for (const [, config] of Object.entries(DEFAULT_PLATFORM_CONFIGS)) {
            if (this.#matchesUrlPatterns(url, config.navigation.urlPatterns)) {
                return { ...config };
            }
        }

        return null;
    }

    /**
     * Gets a list of all registered platform names, including defaults.
     * @returns {string[]} An array of platform names.
     */
    static getRegisteredPlatforms() {
        const defaultPlatforms = Object.keys(DEFAULT_PLATFORM_CONFIGS);
        const customPlatforms = Array.from(this.#registeredPlatforms.keys());
        return [...new Set([...customPlatforms, ...defaultPlatforms])];
    }

    /**
     * Checks if a platform is supported (either as a default or custom registration).
     * @param {string} platformName - The name of the platform.
     * @returns {boolean} `true` if the platform is supported, otherwise `false`.
     */
    static isSupported(platformName) {
        return this.#registeredPlatforms.has(platformName) || 
               Object.prototype.hasOwnProperty.call(DEFAULT_PLATFORM_CONFIGS, platformName);
    }

    /**
     * Validates a platform configuration object.
     * @param {Object} config - The configuration object to validate.
     * @returns {{isValid: boolean, errors: string[], warnings: string[]}} The validation result.
     */
    static validate(config) {
        const errors = [];
        const warnings = [];

        const requiredFields = ['name', 'injectScript', 'navigation', 'videoDetection'];
        requiredFields.forEach(field => {
            if (!config[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        });

        if (config.injectScript) {
            const requiredInjectFields = ['filename', 'tagId', 'eventId'];
            requiredInjectFields.forEach(field => {
                if (!config.injectScript[field]) {
                    errors.push(`Missing required injectScript field: ${field}`);
                }
            });
        }

        if (config.navigation) {
            if (!Array.isArray(config.navigation.urlPatterns)) {
                warnings.push('navigation.urlPatterns must be an array.');
            }
            if (typeof config.navigation.spaHandling !== 'boolean') {
                warnings.push('navigation.spaHandling should be a boolean.');
            }
        }

        if (config.videoDetection) {
            if (typeof config.videoDetection.maxRetries !== 'number') {
                warnings.push('videoDetection.maxRetries should be a number.');
            }
            if (typeof config.videoDetection.retryInterval !== 'number') {
                warnings.push('videoDetection.retryInterval should be a number.');
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Creates a configuration builder instance for creating custom platform configurations.
     * @param {string} platformName - The name of the platform for the new configuration.
     * @returns {PlatformConfigBuilder} A new `PlatformConfigBuilder` instance.
     */
    static builder(platformName) {
        return new PlatformConfigBuilder(platformName);
    }

    /**
     * Checks if a URL matches any of the provided patterns.
     * @private
     * @param {string} url - The URL to check.
     * @param {string[]} patterns - An array of URL patterns (strings or regex-like strings).
     * @returns {boolean} `true` if the URL matches any pattern, otherwise `false`.
     */
    static #matchesUrlPatterns(url, patterns) {
        return patterns.some(pattern => {
            if (pattern.startsWith('/') && pattern.endsWith('/')) {
                try {
                    const regex = new RegExp(pattern.slice(1, -1));
                    return regex.test(url);
                } catch (error) {
                    console.error('Invalid regex pattern:', pattern, error);
                    return false;
                }
            }
            return url.includes(pattern);
        });
    }
}

/**
 * Provides a builder pattern for creating platform configurations fluently.
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
     * Sets the injection script configuration.
     * @param {string} filename - The path to the script file.
     * @param {string} tagId - The ID for the script tag.
     * @param {string} eventId - The event ID for communication.
     * @returns {PlatformConfigBuilder} The builder instance for chaining.
     */
    withInjectScript(filename, tagId, eventId) {
        this.config.injectScript = { filename, tagId, eventId };
        return this;
    }

    /**
     * Sets the navigation configuration.
     * @param {string[]} urlPatterns - An array of URL patterns to identify the platform.
     * @param {boolean} [spaHandling=false] - Whether the platform uses complex SPA routing.
     * @param {number} [checkInterval=2000] - The interval in milliseconds for URL checks.
     * @returns {PlatformConfigBuilder} The builder instance for chaining.
     */
    withNavigation(urlPatterns, spaHandling = false, checkInterval = 2000) {
        this.config.navigation = { urlPatterns, spaHandling, checkInterval };
        return this;
    }

    /**
     * Sets the video detection configuration.
     * @param {number} [maxRetries=30] - The maximum number of retry attempts.
     * @param {number} [retryInterval=1000] - The interval in milliseconds between retries.
     * @returns {PlatformConfigBuilder} The builder instance for chaining.
     */
    withVideoDetection(maxRetries = 30, retryInterval = 1000) {
        this.config.videoDetection = { maxRetries, retryInterval };
        return this;
    }

    /**
     * Sets the log prefix for platform-specific logs.
     * @param {string} logPrefix - The prefix for log messages.
     * @returns {PlatformConfigBuilder} The builder instance for chaining.
     */
    withLogPrefix(logPrefix) {
        this.config.logPrefix = logPrefix;
        return this;
    }

    /**
     * Builds and validates the final configuration object.
     * @returns {Object} The complete and validated platform configuration.
     * @throws {Error} If the configuration is invalid.
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