/**
 * Service Interface Definitions
 *
 * Defines clear interfaces and contracts between services to ensure
 * proper separation of concerns and data flow.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

/**
 * Translation Service Interface
 *
 * Handles all translation-related operations including provider management,
 * caching, rate limiting, and batch processing preparation.
 */
export class ITranslationService {
    /**
     * Initialize the translation service
     * @returns {Promise<void>}
     */
    async initialize() {
        throw new Error('Method must be implemented');
    }

    /**
     * Translate text using current provider
     * @param {string} text - Text to translate
     * @param {string} sourceLang - Source language code
     * @param {string} targetLang - Target language code
     * @param {Object} options - Translation options
     * @returns {Promise<string>} Translated text
     */
    async translate(text, sourceLang, targetLang, options = {}) {
        throw new Error('Method must be implemented');
    }

    /**
     * Change translation provider
     * @param {string} providerId - New provider ID
     * @returns {Promise<Object>} Result object
     */
    async changeProvider(providerId) {
        throw new Error('Method must be implemented');
    }

    /**
     * Get current provider information
     * @returns {Object} Provider information
     */
    getCurrentProvider() {
        throw new Error('Method must be implemented');
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        throw new Error('Method must be implemented');
    }
}

/**
 * Subtitle Service Interface
 *
 * Handles subtitle fetching, processing, and platform-specific coordination.
 * Coordinates with parser modules and manages subtitle workflows.
 */
export class ISubtitleService {
    /**
     * Initialize the subtitle service
     * @returns {Promise<void>}
     */
    async initialize() {
        throw new Error('Method must be implemented');
    }

    /**
     * Process Netflix subtitle data
     * @param {Object} data - Netflix subtitle data
     * @param {string} targetLanguage - Target language code
     * @param {string} originalLanguage - Original language code
     * @param {boolean} useNativeSubtitles - Whether to use native subtitles
     * @param {boolean} useOfficialTranslations - Whether to use official translations
     * @returns {Promise<Object>} Processed subtitle result
     */
    async processNetflixSubtitles(
        data,
        targetLanguage,
        originalLanguage,
        useNativeSubtitles,
        useOfficialTranslations
    ) {
        throw new Error('Method must be implemented');
    }

    /**
     * Fetch and process generic subtitles
     * @param {string} url - Subtitle URL
     * @param {string} targetLanguage - Target language code
     * @param {string} originalLanguage - Original language code
     * @returns {Promise<Object>} Processed subtitle result
     */
    async fetchAndProcessSubtitles(url, targetLanguage, originalLanguage) {
        throw new Error('Method must be implemented');
    }

    /**
     * Process subtitles for any supported platform
     * @param {string} platform - Platform identifier
     * @param {Object} data - Platform-specific data
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} Processed subtitle result
     */
    async processSubtitles(platform, data, options = {}) {
        throw new Error('Method must be implemented');
    }

    /**
     * Get available subtitle languages for platform data
     * @param {string} platform - Platform identifier
     * @param {Object} data - Platform-specific data
     * @returns {Promise<Array>} Available languages
     */
    async getAvailableLanguages(platform, data) {
        throw new Error('Method must be implemented');
    }

    /**
     * Get supported platforms
     * @returns {Array} Supported platform names
     */
    getSupportedPlatforms() {
        throw new Error('Method must be implemented');
    }
}

/**
 * Service Communication Protocol
 *
 * Defines the standard message format and response structure
 * for communication between services and external components.
 */
export class ServiceProtocol {
    /**
     * Create a standard service request
     * @param {string} service - Service name
     * @param {string} method - Method name
     * @param {Object} params - Method parameters
     * @param {Object} metadata - Request metadata
     * @returns {Object} Standard request object
     */
    static createRequest(service, method, params, metadata = {}) {
        return {
            service,
            method,
            params,
            metadata: {
                timestamp: Date.now(),
                requestId: this.generateRequestId(),
                ...metadata,
            },
        };
    }

    /**
     * Create a standard service response
     * @param {Object} request - Original request
     * @param {Object} result - Method result
     * @param {Error} error - Error if any
     * @returns {Object} Standard response object
     */
    static createResponse(request, result = null, error = null) {
        return {
            requestId: request.metadata.requestId,
            service: request.service,
            method: request.method,
            success: !error,
            result,
            error: error
                ? {
                      message: error.message,
                      type: error.constructor.name,
                      stack: error.stack,
                  }
                : null,
            metadata: {
                timestamp: Date.now(),
                processingTime:
                    request.metadata &&
                    typeof request.metadata.timestamp === 'number'
                        ? Date.now() - request.metadata.timestamp
                        : 0,
            },
        };
    }

    /**
     * Generate unique request ID
     * @returns {string} Request ID
     */
    static generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Service Error Types
 *
 * Standard error types for service operations
 */
export class ServiceError extends Error {
    constructor(message, type = 'SERVICE_ERROR', details = {}) {
        super(message);
        this.name = 'ServiceError';
        this.type = type;
        this.details = details;
        this.timestamp = Date.now();
    }
}

export class TranslationError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'TRANSLATION_ERROR', details);
        this.name = 'TranslationError';
    }
}

export class SubtitleProcessingError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'SUBTITLE_PROCESSING_ERROR', details);
        this.name = 'SubtitleProcessingError';
    }
}

export class RateLimitError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'RATE_LIMIT_ERROR', details);
        this.name = 'RateLimitError';
    }
}

/**
 * Service Data Flow Contracts
 *
 * Defines the expected data structures for service interactions
 */
export const DataContracts = {
    // Translation request/response
    TranslationRequest: {
        text: 'string',
        sourceLang: 'string',
        targetLang: 'string',
        options: 'object?',
    },

    TranslationResponse: {
        translatedText: 'string',
        originalText: 'string',
        sourceLanguage: 'string',
        targetLanguage: 'string',
        cached: 'boolean',
        processingTime: 'number',
    },

    // Subtitle processing request/response
    SubtitleRequest: {
        platform: 'string',
        data: 'object',
        options: 'object?',
    },

    SubtitleResponse: {
        vttText: 'string',
        targetVttText: 'string?',
        sourceLanguage: 'string',
        targetLanguage: 'string',
        useNativeTarget: 'boolean',
        availableLanguages: 'array',
        url: 'string?',
    },

    // Netflix-specific data
    NetflixSubtitleData: {
        tracks: 'array',
        videoId: 'string?',
    },

    // Performance metrics
    PerformanceMetrics: {
        totalProcessed: 'number',
        averageProcessingTime: 'number',
        cacheHits: 'number',
        errors: 'number',
        errorRate: 'number',
    },
};

/**
 * Service Registry
 *
 * Central registry for service discovery and dependency injection
 */
export class ServiceRegistry {
    constructor() {
        this.services = new Map();
        this.dependencies = new Map();
    }

    /**
     * Register a service
     * @param {string} name - Service name
     * @param {Object} service - Service instance
     * @param {Array} dependencies - Service dependencies
     */
    register(name, service, dependencies = []) {
        this.services.set(name, service);
        this.dependencies.set(name, dependencies);
    }

    /**
     * Get a service
     * @param {string} name - Service name
     * @returns {Object} Service instance
     */
    get(name) {
        return this.services.get(name);
    }

    /**
     * Check if service is registered
     * @param {string} name - Service name
     * @returns {boolean} True if registered
     */
    has(name) {
        return this.services.has(name);
    }

    /**
     * Get all registered services
     * @returns {Array} Service names
     */
    getServiceNames() {
        return Array.from(this.services.keys());
    }

    /**
     * Validate service dependencies
     * @param {string} name - Service name
     * @returns {boolean} True if all dependencies are satisfied
     */
    validateDependencies(name) {
        const deps = this.dependencies.get(name) || [];
        return deps.every((dep) => this.services.has(dep));
    }
}

// Export singleton registry
export const serviceRegistry = new ServiceRegistry();
