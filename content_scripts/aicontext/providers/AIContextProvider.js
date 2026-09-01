import {
    isProvenMessagingNonDelivery,
    sendRuntimeMessageWithRetry,
} from '../../shared/messaging.js';
import {
    buildAnalyzeContextRequestMessage,
    MessageSenderRoles,
} from '../../shared/protocol/messageProtocol.js';
import { CONTEXT_TYPES } from '../../shared/constants/contextTypes.js';
import Logger from '../../../utils/logger.js';

const logger = Logger.create('AIContextProvider');
const ANALYSIS_RETRIES = 2;
const ANALYSIS_RETRY_DELAY_MS = 120;

const FAILURE = Object.freeze({
    cancelled: 'Analysis request cancelled',
    delivery: 'Analysis request could not be delivered',
    invalidRequest: 'Invalid analysis request',
    request: 'Analysis request failed',
});

function failure(error, shouldRetry = false) {
    return Object.freeze({ success: false, error, shouldRetry });
}

export class AIContextProvider {
    constructor() {
        this.activeRequests = new Map();
        this.initialized = false;
        this.destroyed = false;
    }

    initialize() {
        if (this.destroyed) return Promise.resolve(false);
        this.initialized = true;
        return Promise.resolve(true);
    }

    async analyzeContext(text, options = {}) {
        if (!this.initialized || this.destroyed) {
            throw new Error('Provider not initialized');
        }

        const requestId =
            options.requestId ??
            `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        let request;
        try {
            request = buildAnalyzeContextRequestMessage(
                MessageSenderRoles.CONTENT,
                {
                    text,
                    contextTypes: options.contextTypes ?? CONTEXT_TYPES,
                    language: options.language ?? 'auto',
                    targetLanguage: options.targetLanguage ?? 'en',
                    platform: options.platform ?? 'unknown',
                    requestId,
                }
            );
        } catch (_) {
            return failure(FAILURE.invalidRequest);
        }

        const activeRequest = { requestId };
        const isCurrent = () =>
            this.initialized &&
            !this.destroyed &&
            this.activeRequests.get(requestId) === activeRequest;
        this.activeRequests.set(requestId, activeRequest);
        this._log('info', 'Starting context analysis', {
            requestId,
            textLength: request.text.length,
            contextTypeCount: request.contextTypes.length,
            platform: request.platform,
        });

        try {
            const response = await sendRuntimeMessageWithRetry(request, {
                retries: ANALYSIS_RETRIES,
                baseDelayMs: ANALYSIS_RETRY_DELAY_MS,
                canDispatch: isCurrent,
            });
            if (!isCurrent()) return failure(FAILURE.cancelled);

            this._log('info', 'Context analysis response received', {
                requestId,
            });
            return response;
        } catch (error) {
            if (!isCurrent()) return failure(FAILURE.cancelled);

            const shouldRetry = isProvenMessagingNonDelivery(error);
            this._log('warn', 'Context analysis delivery failed', {
                requestId,
                shouldRetry,
            });
            return failure(
                shouldRetry ? FAILURE.delivery : FAILURE.request,
                shouldRetry
            );
        } finally {
            if (this.activeRequests.get(requestId) === activeRequest) {
                this.activeRequests.delete(requestId);
            }
        }
    }

    cancelRequest(requestId) {
        const cancelled = this.activeRequests.delete(requestId);
        if (cancelled) {
            this._log('info', 'Context analysis cancelled', { requestId });
        }
        return cancelled;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.initialized = false;
        this.activeRequests.clear();
    }

    _log(level, message, data = {}) {
        const logData = {
            initialized: this.initialized,
            activeRequests: this.activeRequests.size,
            ...data,
        };
        const logMethod = logger[level] || logger.info;
        logMethod.call(logger, message, logData);
    }
}
