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
import { MessageActions } from '../../shared/constants/messageActions.js';
import {
    isProvenMessagingNonDelivery,
    sendRuntimeMessageWithRetry,
} from '../../shared/messaging.js';
import {
    buildAnalyzeContextRequestMessage,
    buildBackgroundReadinessRequestMessage,
    MessageSenderRoles,
    parseAnalyzeContextResponseMessage,
    parseBackgroundReadinessResponseMessage,
} from '../../shared/protocol/messageProtocol.js';
import Logger from '../../../utils/logger.js';

const TrustedPromise = Promise;
const trustedPromiseResolve = TrustedPromise.resolve.bind(TrustedPromise);
const logger = Logger.create('AIContextProvider');
const ANALYSIS_CANCELLED_ERROR = 'Analysis request cancelled';
const ANALYSIS_DELIVERY_ERROR = 'Analysis request could not be delivered';
const ANALYSIS_INVALID_REQUEST_ERROR = 'Invalid analysis request';
const ANALYSIS_REQUEST_ERROR = 'Analysis request failed';
const INVALID_ANALYSIS_RESPONSE_ERROR = 'Invalid analysis response';

function createFailureResponse(requestId, error, shouldRetry) {
    return Object.freeze({
        success: false,
        error,
        requestId,
        shouldRetry,
    });
}

function elapsedSince(startedAt) {
    const elapsed = Date.now() - startedAt;
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

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
        this._destroyed = false;
        this._initializePromise = null;
        this._initializationGeneration = 0;
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
    initialize() {
        if (this._destroyed) return trustedPromiseResolve(false);
        if (this.initialized) return trustedPromiseResolve(true);
        if (this._initializePromise) return this._initializePromise;

        const generation = ++this._initializationGeneration;
        this._initializePromise = this._performInitialize(generation);
        return this._initializePromise;
    }

    async _performInitialize(generation) {
        const isCurrent = () =>
            !this._destroyed && generation === this._initializationGeneration;
        try {
            this._log('info', 'Initializing AI Context Provider');

            // Setup provider discovery and rate limiting
            await this._discoverProviders();
            if (!isCurrent()) return false;
            await this._setupRateLimiting();
            if (!isCurrent()) return false;

            // Test connection to background script
            await this._testBackgroundConnection();
            if (!isCurrent()) return false;

            this.initialized = true;
            this._log('info', 'AI Context Provider initialized successfully', {
                currentProvider: this.currentProvider,
                availableProviders: this.availableProviders,
            });
            return true;
        } catch (error) {
            if (!isCurrent()) return false;
            this._log('error', 'Failed to initialize provider', error);
            return false;
        } finally {
            if (generation === this._initializationGeneration) {
                this._initializePromise = null;
            }
        }
    }

    /**
     * Analyze text context
     * @param {string} text - Text to analyze
     * @param {Object} options - Analysis options
     * @returns {Promise<Object>} Analysis result
     */
    async analyzeContext(text, options = {}) {
        if (this._destroyed || !this.initialized) {
            throw new Error('Provider not initialized');
        }

        const requestId =
            options.requestId ??
            `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        const startedAt = Date.now();
        let activeRequest = null;
        const isCurrentRequest = () =>
            this.initialized === true &&
            this.activeRequests.get(requestId) === activeRequest;
        const finish = (response) => {
            const responseTime = elapsedSince(startedAt);
            this._updateMetrics(responseTime, response.success === true);
            this._log(
                response.success === true ? 'info' : 'warn',
                'Context analysis completed',
                {
                    requestId,
                    responseTime,
                    success: response.success,
                }
            );
            return response;
        };

        this._log('info', 'Starting context analysis', {
            textLength: typeof text === 'string' ? text.length : 0,
            requestId,
            contextTypeCount: Array.isArray(options.contextTypes)
                ? options.contextTypes.length
                : 3,
            language: options.language || 'auto',
            targetLanguage: options.targetLanguage || 'en',
            platform: options.platform || 'unknown',
        });

        this.metrics.requestCount++;

        try {
            // Respect simple rate limiting to avoid backend overload
            if (!this._checkRateLimit()) {
                return finish(
                    createFailureResponse(
                        requestId,
                        'Rate limit exceeded',
                        true
                    )
                );
            }

            // Prepare request data
            let requestData;
            try {
                requestData = buildAnalyzeContextRequestMessage(
                    MessageSenderRoles.CONTENT,
                    {
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
                    }
                );
            } catch (_) {
                return finish(
                    createFailureResponse(
                        requestId,
                        ANALYSIS_INVALID_REQUEST_ERROR,
                        false
                    )
                );
            }

            // Add to active requests
            activeRequest = Object.freeze({
                requestId,
                startedAt,
            });
            this.activeRequests.set(requestId, activeRequest);
            this.requestStartTimes.set(requestId, startedAt);

            // Send request to background script with retry to handle service worker wake-ups
            let wireResponse;
            try {
                wireResponse = await sendRuntimeMessageWithRetry(requestData, {
                    retries: 2,
                    baseDelayMs: 120,
                    pingBeforeRetry: false,
                    canDispatch: isCurrentRequest,
                });
            } catch (error) {
                if (!isCurrentRequest()) {
                    return finish(
                        createFailureResponse(
                            requestId,
                            ANALYSIS_CANCELLED_ERROR,
                            false
                        )
                    );
                }
                const shouldRetry = isProvenMessagingNonDelivery(error);
                return finish(
                    createFailureResponse(
                        requestId,
                        shouldRetry
                            ? ANALYSIS_DELIVERY_ERROR
                            : ANALYSIS_REQUEST_ERROR,
                        shouldRetry
                    )
                );
            }

            if (!isCurrentRequest()) {
                return finish(
                    createFailureResponse(
                        requestId,
                        ANALYSIS_CANCELLED_ERROR,
                        false
                    )
                );
            }

            const parsedResponse = parseAnalyzeContextResponseMessage(
                wireResponse,
                requestData,
                MessageSenderRoles.CONTENT
            );
            const response = !parsedResponse
                ? createFailureResponse(
                      requestId,
                      INVALID_ANALYSIS_RESPONSE_ERROR,
                      false
                  )
                : parsedResponse.status === 'success'
                  ? Object.freeze({
                        success: true,
                        result: parsedResponse.result,
                        requestId: parsedResponse.requestId,
                    })
                  : createFailureResponse(
                        parsedResponse.requestId,
                        parsedResponse.error,
                        parsedResponse.shouldRetry
                    );

            if (!isCurrentRequest()) {
                return finish(
                    createFailureResponse(
                        requestId,
                        ANALYSIS_CANCELLED_ERROR,
                        false
                    )
                );
            }
            return finish(response);
        } catch (_) {
            return finish(
                createFailureResponse(
                    requestId,
                    activeRequest && !isCurrentRequest()
                        ? ANALYSIS_CANCELLED_ERROR
                        : ANALYSIS_REQUEST_ERROR,
                    false
                )
            );
        } finally {
            if (
                activeRequest &&
                this.activeRequests.get(requestId) === activeRequest
            ) {
                this.activeRequests.delete(requestId);
                this.requestStartTimes.delete(requestId);
            }
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
        if (this._destroyed) return;
        this._destroyed = true;
        this._initializationGeneration += 1;
        this._initializePromise = null;
        this.initialized = false;

        try {
            this._log('info', 'Destroying AI Context Provider');

            // Cancel all active requests
            for (const requestId of this.activeRequests.keys()) {
                this.cancelRequest(requestId);
            }

            // Reset state
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
            const request = buildBackgroundReadinessRequestMessage(
                MessageActions.PING
            );
            const response = await chrome.runtime.sendMessage(request);
            const parsedResponse = parseBackgroundReadinessResponseMessage(
                response,
                request
            );

            if (parsedResponse) {
                this._log('debug', 'Background connection test successful', {
                    ready: parsedResponse.ready,
                });
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
        const safeData =
            data instanceof Error
                ? { errorType: data.name || 'UnknownError' }
                : data;
        const logData = {
            initialized: this.initialized,
            activeRequests: this.activeRequests.size,
            ...safeData,
        };

        if (level === 'error') {
            logger.error(message, null, logData);
            return;
        }

        const logMethod = logger[level] || logger.info;
        logMethod.call(logger, message, logData);
    }
}
