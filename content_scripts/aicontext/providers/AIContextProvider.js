/**
 * AI Context Provider - Unified AI Communication Interface
 *
 * Decoupled AI provider interface that standardizes communication with
 * external AI systems. Handles request routing, response processing,
 * and error management across different AI providers.
 *
 * @author DualSub Extension - AI Integration Strategist
 * @version 2.0.0
 */

import { PROVIDER_CONFIG } from '../core/constants.js';

/**
 * AIContextProvider - Unified AI communication interface
 */
export class AIContextProvider {
    constructor(config = {}) {
        this.config = {
            ...PROVIDER_CONFIG,
            timeout: 30000,
            maxRetries: 3,
            retryDelay: 1000,
            batchSize: 5,
            ...config,
        };

        this.activeRequests = new Map();
        this.requestQueue = [];
        this.rateLimiter = null;

        // Provider state
        this.initialized = false;
        this.currentProvider = 'background'; // Use background script as provider
        this.availableProviders = ['background'];

        // Performance metrics
        this.metrics = {
            requestCount: 0,
            successCount: 0,
            errorCount: 0,
            averageResponseTime: 0,
            totalResponseTime: 0,
        };

        // Request tracking
        this.requestStartTimes = new Map();

        this._log('info', 'AIContextProvider initialized');
    }

    /**
     * Initialize the provider
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        try {
            this._log('info', 'Initializing AI Context Provider');

            // Setup provider discovery and rate limiting
            await this._discoverProviders();
            await this._setupRateLimiting();

            // Test connection to background script
            await this._testBackgroundConnection();

            this.initialized = true;
            this._log('info', 'AI Context Provider initialized successfully', {
                currentProvider: this.currentProvider,
                availableProviders: this.availableProviders,
            });
            return true;
        } catch (error) {
            this._log('error', 'Failed to initialize provider', error);
            return false;
        }
    }

    /**
     * Analyze text context
     * @param {string} text - Text to analyze
     * @param {Object} options - Analysis options
     * @returns {Promise<Object>} Analysis result
     */
    async analyzeContext(text, options = {}) {
        if (!this.initialized) {
            throw new Error('Provider not initialized');
        }

        const requestId =
            options.requestId ||
            `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        this._log('info', 'Starting context analysis', {
            text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            requestId,
            options,
        });

        // Track request start time
        this.requestStartTimes.set(requestId, Date.now());
        this.metrics.requestCount++;

        try {
            // Respect simple rate limiting to avoid backend overload
            if (!this._checkRateLimit()) {
                return {
                    success: false,
                    error: 'Rate limit exceeded',
                    requestId,
                    shouldRetry: true,
                };
            }
            // Prepare request data
            const requestData = {
                action: 'analyzeContext',
                text,
                contextTypes: options.contextTypes || [
                    'cultural',
                    'historical',
                    'linguistic',
                ],
                language: options.language || 'auto',
                targetLanguage: options.targetLanguage || 'en',
                platform: options.platform || 'unknown',
                requestId,
            };

            // Add to active requests
            this.activeRequests.set(requestId, {
                startTime: Date.now(),
                text,
                options,
            });

            // Send request to background script with retry to handle service worker wake-ups
            let response;
            try {
                const { sendRuntimeMessageWithRetry } = await import(
                    chrome.runtime.getURL('content_scripts/shared/messaging.js')
                );
                response = await sendRuntimeMessageWithRetry(requestData, {
                    retries: 2,
                    baseDelayMs: 120,
                });
            } catch (_) {
                // Fallback to direct timeout wrapper if messaging util not available
                response = await this._sendRequestWithTimeout(
                    requestData,
                    this.config.timeout
                );
            }

            // Calculate response time
            const responseTime =
                Date.now() - this.requestStartTimes.get(requestId);
            this._updateMetrics(responseTime, true);

            // Clean up tracking
            this.activeRequests.delete(requestId);
            this.requestStartTimes.delete(requestId);

            this._log('info', 'Context analysis completed', {
                requestId,
                responseTime,
                success: response.success,
            });

            return response;
        } catch (error) {
            // Calculate response time even for errors
            const responseTime =
                Date.now() - this.requestStartTimes.get(requestId);
            this._updateMetrics(responseTime, false);

            // Clean up tracking
            this.activeRequests.delete(requestId);
            this.requestStartTimes.delete(requestId);

            this._log('error', 'Context analysis failed', {
                requestId,
                error: error.message,
                responseTime,
            });

            const transient = /timeout|network|temporar|rate limit/i.test(
                error?.message || ''
            );
            return {
                success: false,
                error: error.message,
                requestId,
                shouldRetry: transient,
            };
        }
    }

    /**
     * Cancel an active request
     * @param {string} requestId - Request ID to cancel
     * @returns {boolean} Success status
     */
    cancelRequest(requestId) {
        this._log('info', 'Canceling request', { requestId });

        const request = this.activeRequests.get(requestId);
        if (!request) {
            this._log('warn', 'Request not found for cancellation', {
                requestId,
            });
            return false;
        }

        // Remove from active requests
        this.activeRequests.delete(requestId);
        this.requestStartTimes.delete(requestId);

        // Note: Chrome extension messaging doesn't support request cancellation
        // The background script request will complete but we'll ignore the result

        this._log('info', 'Request canceled', { requestId });
        return true;
    }

    /**
     * Analyze multiple texts in batch
     * @param {string[]} texts - Array of texts to analyze
     * @param {Object} options - Analysis options
     * @returns {Promise<Object[]>} Array of analysis results
     */
    async analyzeBatch(texts, options = {}) {
        if (!this.initialized) {
            throw new Error('Provider not initialized');
        }

        this._log('info', 'Starting batch analysis', {
            count: texts.length,
            batchSize: this.config.batchSize,
        });

        const results = [];
        const batchSize = this.config.batchSize;

        // Process in batches to avoid overwhelming the system
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchPromises = batch.map((text, index) =>
                this.analyzeContext(text, {
                    ...options,
                    requestId: `batch-${Date.now()}-${i + index}`,
                })
            );

            try {
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
            } catch (error) {
                this._log('error', 'Batch analysis failed', {
                    batchIndex: Math.floor(i / batchSize),
                    error: error.message,
                });
                // Add error results for failed batch
                batch.forEach(() => {
                    results.push({
                        success: false,
                        error: error.message,
                    });
                });
            }
        }

        this._log('info', 'Batch analysis completed', {
            total: texts.length,
            successful: results.filter((r) => r.success).length,
        });

        return results;
    }

    /**
     * Get provider status
     * @returns {Object} Provider status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            currentProvider: this.currentProvider,
            availableProviders: this.availableProviders,
            activeRequests: this.activeRequests.size,
            metrics: { ...this.metrics },
        };
    }

    /**
     * Destroy the provider and cleanup
     */
    async destroy() {
        try {
            this._log('info', 'Destroying AI Context Provider');

            // Cancel all active requests
            for (const requestId of this.activeRequests.keys()) {
                this.cancelRequest(requestId);
            }

            // Reset state
            this.initialized = false;
            this.activeRequests.clear();
            this.requestQueue = [];

            this._log('info', 'AI Context Provider destroyed');
        } catch (error) {
            this._log('error', 'Error destroying provider', error);
        }
    }

    // Private methods

    async _discoverProviders() {
        this._log('debug', 'Discovering AI providers');

        // For now, we only use the background script as provider
        this.availableProviders = ['background'];
        this.currentProvider = 'background';

        this._log('debug', 'Provider discovery completed', {
            available: this.availableProviders,
            current: this.currentProvider,
        });
    }

    async _setupRateLimiting() {
        this._log('debug', 'Setting up rate limiting');

        // Simple rate limiting implementation
        this.rateLimiter = {
            requests: [],
            maxRequests: this.config.RATE_LIMIT?.REQUESTS_PER_MINUTE || 60,
            windowMs: 60000, // 1 minute
        };

        this._log('debug', 'Rate limiting setup completed', {
            maxRequests: this.rateLimiter.maxRequests,
            windowMs: this.rateLimiter.windowMs,
        });
    }

    async _testBackgroundConnection() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'ping',
                timestamp: Date.now(),
            });

            if (response && response.success) {
                this._log('debug', 'Background connection test successful');
            } else {
                throw new Error('Invalid response from background script');
            }
        } catch (error) {
            this._log('warn', 'Background connection test failed', error);
            // Don't throw - the provider can still work, just log the warning
        }
    }

    async _sendRequestWithTimeout(requestData, timeout) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);

            try {
                if (!chrome?.runtime?.sendMessage) {
                    clearTimeout(timeoutId);
                    reject(new Error('Messaging unavailable'));
                    return;
                }
                chrome.runtime
                    .sendMessage(requestData)
                    .then((response) => {
                        clearTimeout(timeoutId);
                        resolve(response);
                    })
                    .catch((error) => {
                        clearTimeout(timeoutId);
                        reject(error);
                    });
            } catch (err) {
                clearTimeout(timeoutId);
                reject(err);
            }
        });
    }

    _updateMetrics(responseTime, success) {
        this.metrics.totalResponseTime += responseTime;
        this.metrics.averageResponseTime =
            this.metrics.totalResponseTime / this.metrics.requestCount;

        if (success) {
            this.metrics.successCount++;
        } else {
            this.metrics.errorCount++;
        }
    }

    _checkRateLimit() {
        if (!this.rateLimiter) {
            return true;
        }

        const now = Date.now();
        const windowStart = now - this.rateLimiter.windowMs;

        // Remove old requests outside the window
        this.rateLimiter.requests = this.rateLimiter.requests.filter(
            (timestamp) => timestamp > windowStart
        );

        // Check if we're under the limit
        if (this.rateLimiter.requests.length >= this.rateLimiter.maxRequests) {
            return false;
        }

        // Add current request
        this.rateLimiter.requests.push(now);
        return true;
    }

    _log(level, message, data = {}) {
        const logData = {
            component: 'AIContextProvider',
            initialized: this.initialized,
            activeRequests: this.activeRequests.size,
            timestamp: new Date().toISOString(),
            ...data,
        };

        console[level](`[AIContext:Provider] ${message}`, logData);
    }
}
