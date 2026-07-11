/**
 * Message Handler for Background Services
 *
 * Handles all chrome.runtime.onMessage communication between
 * content scripts and background services.
 *
 * Maintains exact same API interface as original background.js
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

// @ts-check

import { loggingManager } from '../utils/loggingManager.js';
import {
    ServiceProtocol,
    TranslationError,
    SubtitleProcessingError,
} from '../services/serviceInterfaces.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import {
    combineContextAnalyses,
    CONTEXT_TYPES,
} from '../../context_providers/contextSchemas.js';

const SUPPORTED_CONTEXT_TYPES = new Set(CONTEXT_TYPES);

/**
 * @typedef {'translate'|'translateBatch'|'checkBatchSupport'|'fetchVTT'|'changeProvider'|'analyzeContext'|'changeContextProvider'|'getContextStatus'|'getAvailableModels'|'getDefaultModel'|'reloadContextProviderConfig'|'ping'|'checkBackgroundReady'} MessageAction
 */

/**
 * @typedef {Object} IncomingMessage
 * @property {MessageAction} action
 * @property {string} [text]
 * @property {string[]} [texts]
 * @property {string} [targetLang]
 * @property {string} [delimiter]
 * @property {string} [batchId]
 * @property {Object} [cueMetadata]
 * @property {string} [url]
 * @property {string} [videoId]
 * @property {Object} [data]
 * @property {string} [source]
 * @property {string} [contextType]
 * @property {string[]} [contextTypes]
 */

class MessageHandler {
    /**
     * Validate incoming message payload for critical actions.
     * Returns { valid: boolean, error?: string }
     * @param {IncomingMessage} message
     */
    static validateMessagePayload(message) {
        if (!message || typeof message !== 'object') {
            return { valid: false, error: 'Invalid message object' };
        }
        const action = /** @type {any} */ (message.action);
        if (!action || typeof action !== 'string') {
            return { valid: false, error: 'Missing or invalid action' };
        }
        switch (action) {
            case MessageActions.TRANSLATE:
                if (
                    typeof message.text !== 'string' ||
                    typeof message.targetLang !== 'string'
                ) {
                    return {
                        valid: false,
                        error: 'translate requires text and targetLang',
                    };
                }
                break;
            case MessageActions.TRANSLATE_BATCH:
                if (
                    !Array.isArray(message.texts) ||
                    typeof message.targetLang !== 'string'
                ) {
                    return {
                        valid: false,
                        error: 'translateBatch requires texts[] and targetLang',
                    };
                }
                break;
            case MessageActions.FETCH_VTT:
                // Accept either URL-based or Netflix data-based payload shape
                if (
                    !message.url &&
                    !(message.data && Array.isArray(message.data.tracks))
                ) {
                    return {
                        valid: false,
                        error: 'fetchVTT requires url or data.tracks[]',
                    };
                }
                break;
            default:
                // For other actions, do minimal validation
                break;
        }
        return { valid: true };
    }

    static normalizeContextTypes(
        contextType,
        contextTypes,
        hasExplicitContextTypes = Array.isArray(contextTypes)
    ) {
        if (hasExplicitContextTypes) {
            if (!Array.isArray(contextTypes)) {
                return {
                    valid: false,
                    error: 'Context types must be an array',
                };
            }

            const normalized = [...new Set(contextTypes)];
            if (normalized.length === 0) {
                return {
                    valid: false,
                    error: 'Select at least one context type',
                };
            }

            const invalidTypes = normalized.filter(
                (type) => !SUPPORTED_CONTEXT_TYPES.has(type)
            );
            if (invalidTypes.length > 0) {
                return {
                    valid: false,
                    error: `Unsupported context type: ${invalidTypes.join(', ')}`,
                };
            }

            return { valid: true, contextTypes: normalized };
        }

        if (contextType === undefined || contextType === 'all') {
            return { valid: true, contextTypes: ['all'] };
        }
        if (SUPPORTED_CONTEXT_TYPES.has(contextType)) {
            return { valid: true, contextTypes: [contextType] };
        }

        return {
            valid: false,
            error: `Unsupported context type: ${String(contextType)}`,
        };
    }

    constructor() {
        this.logger = null;
        this.translationService = null;
        this.subtitleService = null;
        this.aiContextService = null;
        this.sidePanelService = null;
        this.serviceReadiness = null;
        this.runtimeMessageListener = null;
        this.sidePanelGestureOperations = new WeakMap();
        this.isInitialized = false;
    }

    /**
     * Initialize message handler with service dependencies
     */
    initialize(serviceReadiness = null) {
        if (serviceReadiness) {
            this.serviceReadiness = serviceReadiness;
        }

        if (this.isInitialized) {
            return;
        }

        this.logger = loggingManager.createLogger('MessageHandler');

        this.runtimeMessageListener = (message, sender, sendResponse) => {
            this.captureSynchronousSidePanelGesture(message, sender);

            if (!this.serviceReadiness || this.serviceReadiness.isReady()) {
                return this.handleMessage(message, sender, sendResponse);
            }

            this.serviceReadiness
                .waitUntilReady()
                .then(() => {
                    let responded = false;
                    const deferredSendResponse = (response) => {
                        responded = true;
                        return sendResponse(response);
                    };
                    const keepsChannelOpen = this.handleMessage(
                        message,
                        sender,
                        deferredSendResponse
                    );
                    if (keepsChannelOpen !== true && !responded) {
                        sendResponse();
                    }
                })
                .catch((error) => {
                    this.logger.error(
                        'Background services failed before message handling',
                        error,
                        { action: message?.action }
                    );
                    try {
                        sendResponse({
                            success: false,
                            error:
                                error?.message ||
                                'Background services failed to initialize',
                        });
                    } catch (_) {}
                });

            return true;
        };

        chrome.runtime.onMessage.addListener(this.runtimeMessageListener);

        this.logger.info('Message handler initialized');
        this.isInitialized = true;
    }

    destroy() {
        if (
            this.runtimeMessageListener &&
            typeof chrome !== 'undefined' &&
            chrome.runtime?.onMessage?.removeListener
        ) {
            chrome.runtime.onMessage.removeListener(
                this.runtimeMessageListener
            );
        }
        this.runtimeMessageListener = null;
        this.isInitialized = false;
    }

    /**
     * Set service dependencies (will be injected after services are created)
     * Supports either positional args or an options object:
     *   setServices({ translationService, subtitleService, aiContextService?, sidePanelService? })
     * For backward compatibility, the positional signature remains supported.
     */
    setServices(
        translationService,
        subtitleService,
        aiContextService = null,
        sidePanelService = null
    ) {
        /** @type {{translationService?: any, subtitleService?: any, aiContextService?: any, sidePanelService?: any}} */
        let services;
        if (
            arguments.length === 1 &&
            translationService &&
            typeof translationService === 'object' &&
            [
                'translationService',
                'subtitleService',
                'aiContextService',
                'sidePanelService',
            ].some((key) =>
                Object.prototype.hasOwnProperty.call(translationService, key)
            )
        ) {
            services = translationService;
        } else {
            services = {
                translationService,
                subtitleService,
                aiContextService,
                sidePanelService,
            };
        }

        for (const serviceName of [
            'translationService',
            'subtitleService',
            'aiContextService',
            'sidePanelService',
        ]) {
            if (Object.prototype.hasOwnProperty.call(services, serviceName)) {
                this[serviceName] = services[serviceName] || null;
            }
        }

        this.logger?.debug('Services injected into message handler', {
            hasTranslation: !!this.translationService,
            hasSubtitle: !!this.subtitleService,
            hasAIContext: !!this.aiContextService,
            hasSidePanel: !!this.sidePanelService,
        });
    }

    captureSynchronousSidePanelGesture(message, sender) {
        if (
            !message ||
            typeof message !== 'object' ||
            !this.sidePanelService ||
            (message.action !== MessageActions.SIDEPANEL_OPEN &&
                message.action !== MessageActions.SIDEPANEL_WORD_SELECTED)
        ) {
            return;
        }

        const tabId = sender?.tab?.id;
        if (typeof tabId !== 'number') {
            return;
        }

        // Calling the async method itself is deliberate: it invokes
        // chrome.sidePanel.open before its first await, while the browser's
        // original click gesture is still active.
        let operation;
        try {
            operation = Promise.resolve(
                this.sidePanelService.openSidePanelImmediate(
                    tabId,
                    message.options || {}
                )
            ).catch((error) => ({
                success: false,
                error: error.message || 'Failed to open side panel',
            }));
        } catch (error) {
            operation = Promise.resolve({
                success: false,
                error: error.message || 'Failed to open side panel',
            });
        }
        this.sidePanelGestureOperations.set(message, operation);
    }

    takeSynchronousSidePanelGesture(message) {
        const operation = this.sidePanelGestureOperations.get(message) || null;
        if (operation) {
            this.sidePanelGestureOperations.delete(message);
        }
        return operation;
    }

    /**
     * Handle incoming messages from content scripts
     * @param {Object} message - The message object
     * @param {Object} sender - The sender information
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} True if response is async
     */
    handleMessage(message, sender, sendResponse) {
        this.logger.debug('Received message', {
            action: message?.action,
            source: message?.source,
            tabId: sender?.tab?.id,
        });

        const validation = MessageHandler.validateMessagePayload(message);
        if (!validation.valid) {
            this.logger.warn('Invalid message payload', {
                error: validation.error,
            });
            try {
                sendResponse({ success: false, error: validation.error });
            } catch (_) {}
            return false;
        }

        switch (message.action) {
            case MessageActions.TRANSLATE:
                return this.handleTranslateMessage(message, sendResponse);

            case MessageActions.TRANSLATE_BATCH:
                return this.handleTranslateBatchMessage(message, sendResponse);

            case MessageActions.CHECK_BATCH_SUPPORT:
                return this.handleCheckBatchSupportMessage(
                    message,
                    sendResponse
                );

            case MessageActions.FETCH_VTT:
                return this.handleFetchVTTMessage(message, sendResponse);

            case MessageActions.CHANGE_PROVIDER:
                return this.handleChangeProviderMessage(message, sendResponse);

            case MessageActions.ANALYZE_CONTEXT:
                return this.handleAnalyzeContextMessage(message, sendResponse);

            case MessageActions.CHANGE_CONTEXT_PROVIDER:
                return this.handleChangeContextProviderMessage(
                    message,
                    sendResponse
                );

            case MessageActions.GET_CONTEXT_STATUS:
                return this.handleGetContextStatusMessage(
                    message,
                    sendResponse
                );

            case MessageActions.GET_AVAILABLE_MODELS:
                return this.handleGetAvailableModelsMessage(
                    message,
                    sendResponse
                );

            case MessageActions.GET_DEFAULT_MODEL:
                return this.handleGetDefaultModelMessage(message, sendResponse);

            case MessageActions.RELOAD_CONTEXT_PROVIDER_CONFIG:
                return this.handleReloadContextProviderConfigMessage(
                    message,
                    sendResponse
                );

            case MessageActions.PING:
                return this.handlePingMessage(message, sendResponse);

            case MessageActions.CHECK_BACKGROUND_READY:
                return this.handleCheckBackgroundReadyMessage(
                    message,
                    sendResponse
                );

            case MessageActions.SIDEPANEL_OPEN:
                return this.handleSidePanelOpenMessage(
                    message,
                    sender,
                    sendResponse
                );

            case MessageActions.SIDEPANEL_WORD_SELECTED:
                return this.handleSidePanelWordSelectedMessage(
                    message,
                    sender,
                    sendResponse
                );

            case MessageActions.SIDEPANEL_SELECTION_SYNC:
                return this.handleSidePanelSelectionSyncMessage(
                    message,
                    sender,
                    sendResponse
                );

            case MessageActions.SIDEPANEL_SET_ANALYZING:
                return this.handleSidePanelSetAnalyzingMessage(
                    message,
                    sender,
                    sendResponse
                );

            default:
                this.logger.warn('Unknown message action', {
                    action: message.action,
                });
                return false;
        }
    }

    /**
     * Handle translation requests using service protocol
     */
    handleTranslateMessage(message, sendResponse) {
        const request = ServiceProtocol.createRequest(
            'translation',
            'translate',
            {
                text: message.text,
                sourceLang: 'auto',
                targetLang: message.targetLang,
                options: {
                    cueStart: message.cueStart,
                    cueVideoId: message.cueVideoId,
                },
            }
        );

        if (!this.translationService) {
            const error = new TranslationError(
                'Translation service not initialized'
            );
            const response = ServiceProtocol.createResponse(
                request,
                null,
                error
            );
            sendResponse({
                ...response,
                originalText: message.text,
                cueStart: message.cueStart,
                cueVideoId: message.cueVideoId,
            });
            return true;
        }

        const { text, targetLang, cueStart, cueVideoId } = message;

        this.translationService
            .translate(text, 'auto', targetLang)
            .then((translatedText) => {
                const response = ServiceProtocol.createResponse(request, {
                    translatedText,
                    originalText: text,
                    sourceLanguage: 'auto',
                    targetLanguage: targetLang,
                    cached: false,
                    processingTime: Date.now() - request.metadata.timestamp,
                });

                sendResponse({
                    ...response.result,
                    cueStart,
                    cueVideoId,
                });
            })
            .catch((error) => {
                this.logger.error('Translation failed', error, {
                    textLength: text.length,
                    targetLang,
                });

                const translationError = new TranslationError(
                    'Translation failed',
                    {
                        originalError: error.message,
                        provider:
                            this.translationService.getCurrentProvider()?.id,
                    }
                );
                const response = ServiceProtocol.createResponse(
                    request,
                    null,
                    translationError
                );

                sendResponse({
                    error: response.error.message,
                    errorType: response.error.type,
                    details: response.error.details,
                    originalText: text,
                    cueStart,
                    cueVideoId,
                });
            });

        return true; // Async response
    }

    /**
     * Handle batch translation requests
     */
    handleTranslateBatchMessage(message, sendResponse) {
        const request = ServiceProtocol.createRequest(
            'translation',
            'translateBatch',
            {
                texts: message.texts,
                sourceLang: 'auto',
                targetLang: message.targetLang,
                delimiter: message.delimiter,
                options: {
                    batchId: message.batchId,
                    cueMetadata: message.cueMetadata,
                },
            }
        );

        if (!this.translationService) {
            const error = new TranslationError(
                'Translation service not initialized'
            );
            const response = ServiceProtocol.createResponse(
                request,
                null,
                error
            );
            sendResponse({
                ...response,
                batchId: message.batchId,
            });
            return true;
        }

        this.translationService
            .translateBatch(message.texts, 'auto', message.targetLang, {
                delimiter: message.delimiter,
                batchId: message.batchId,
            })
            .then((translations) => {
                const response = ServiceProtocol.createResponse(request, {
                    translations,
                    batchId: message.batchId,
                    originalTexts: message.texts,
                    processingTime: Date.now() - request.metadata.timestamp,
                });

                sendResponse({
                    success: true,
                    translations,
                    batchId: message.batchId,
                    processingTime: response.metadata.processingTime,
                });
            })
            .catch((error) => {
                this.logger.error('Batch translation failed', error, {
                    batchId: message.batchId,
                    textCount: message.texts?.length || 0,
                });

                const translationError = new TranslationError(
                    'Batch translation failed',
                    {
                        originalError: error.message,
                        batchId: message.batchId,
                        provider:
                            this.translationService.getCurrentProvider()?.id,
                    }
                );
                const response = ServiceProtocol.createResponse(
                    request,
                    null,
                    translationError
                );

                sendResponse({
                    success: false,
                    error: response.error.message,
                    errorType: response.error.type,
                    batchId: message.batchId,
                });
            });

        return true; // Async response
    }

    /**
     * Handle batch support check requests
     */
    handleCheckBatchSupportMessage(message, sendResponse) {
        if (!this.translationService) {
            sendResponse({ supportsBatch: false });
            return true;
        }

        const supportsBatch =
            this.translationService.currentProviderSupportsBatch();
        const provider = this.translationService.getCurrentProvider();

        sendResponse({
            supportsBatch,
            provider: provider?.name || 'Unknown',
            providerId: this.translationService.currentProviderId,
        });

        return true;
    }

    /**
     * Handle VTT fetching requests
     */
    handleFetchVTTMessage(message, sendResponse) {
        if (!this.subtitleService) {
            this.logger.error('Subtitle service not available');
            sendResponse({
                success: false,
                error: 'Subtitle service not initialized',
                videoId: message.videoId,
            });
            return true;
        }

        if (message.source === 'netflix') {
            this.handleNetflixVTTRequest(message, sendResponse);
        } else {
            this.handleGenericVTTRequest(message, sendResponse);
        }

        return true; // Async response
    }

    /**
     * Handle Netflix-specific VTT requests using service protocol
     */
    handleNetflixVTTRequest(message, sendResponse) {
        const {
            data,
            videoId,
            targetLanguage,
            originalLanguage,
            useNativeSubtitles,
            useOfficialTranslations,
        } = message;

        const request = ServiceProtocol.createRequest(
            'subtitle',
            'processNetflixSubtitles',
            {
                data,
                targetLanguage,
                originalLanguage,
                useNativeSubtitles,
                useOfficialTranslations,
            },
            { videoId }
        );

        this.subtitleService
            .processNetflixSubtitles(
                data,
                targetLanguage,
                originalLanguage,
                useNativeSubtitles,
                useOfficialTranslations
            )
            .then((result) => {
                const response = ServiceProtocol.createResponse(
                    request,
                    result
                );
                sendResponse({
                    success: true,
                    ...result,
                    videoId,
                    processingTime: response.metadata.processingTime,
                });
            })
            .catch((error) => {
                this.logger.error('Netflix VTT processing failed', error, {
                    videoId,
                });

                const subtitleError = new SubtitleProcessingError(
                    `Netflix VTT Processing Error: ${error.message}`,
                    { platform: 'netflix', videoId }
                );
                const response = ServiceProtocol.createResponse(
                    request,
                    null,
                    subtitleError
                );

                sendResponse({
                    success: false,
                    error: response.error.message,
                    errorType: response.error.type,
                    videoId,
                });
            });
    }

    /**
     * Handle generic VTT requests
     */
    handleGenericVTTRequest(message, sendResponse) {
        const { url, videoId, targetLanguage, originalLanguage } = message;

        this.subtitleService
            .fetchAndProcessSubtitles(url, targetLanguage, originalLanguage)
            .then((result) => {
                sendResponse({
                    success: true,
                    vttText: result.vttText,
                    targetVttText: result.targetVttText,
                    videoId,
                    url,
                    sourceLanguage: result.sourceLanguage,
                    targetLanguage: result.targetLanguage,
                    useNativeTarget: result.useNativeTarget,
                    availableLanguages: result.availableLanguages,
                    selectedLanguage: result.selectedLanguage,
                    targetLanguageInfo: result.targetLanguageInfo,
                });
            })
            .catch((error) => {
                this.logger.error('VTT processing failed', error, {
                    urlLength: typeof url === 'string' ? url.length : 0,
                });
                sendResponse({
                    success: false,
                    error: `VTT Processing Error: ${error.message}`,
                    videoId,
                    url,
                });
            });
    }

    /**
     * Handle provider change requests
     */
    handleChangeProviderMessage(message, sendResponse) {
        if (!this.translationService) {
            this.logger.error('Translation service not available');
            sendResponse({
                success: false,
                message: 'Translation service not initialized',
            });
            return true;
        }

        const { providerId } = message;

        this.translationService
            .changeProvider(providerId)
            .then((result) => {
                sendResponse({
                    success: true,
                    message: result.message,
                });
            })
            .catch((error) => {
                this.logger.error('Provider change failed', error, {
                    providerId,
                });
                sendResponse({
                    success: false,
                    message: error.message || 'Failed to change provider',
                });
            });

        return true; // Async response
    }

    /**
     * Handle AI context analysis requests
     */
    handleAnalyzeContextMessage(message, sendResponse) {
        const {
            text,
            metadata = {},
            targetLanguage,
            language: sourceLanguage,
            requestId,
        } = message;
        const normalizedContextTypes = MessageHandler.normalizeContextTypes(
            message.contextType,
            message.contextTypes,
            Object.prototype.hasOwnProperty.call(message, 'contextTypes')
        );
        const contextTypes = normalizedContextTypes.contextTypes || [];
        const contextType =
            contextTypes.length === 1 ? contextTypes[0] : 'combined';

        this.logger.debug('Received context analysis message', {
            messageKeys: Object.keys(message),
            textLength: text?.length || 0,
            contextType,
            hasMetadata: Object.keys(metadata).length > 0,
            hasAiContextService: !!this.aiContextService,
            requestId,
        });

        if (!normalizedContextTypes.valid) {
            sendResponse({
                success: false,
                error: normalizedContextTypes.error,
                contextTypes,
                originalText: text,
                requestId,
            });
            return true;
        }

        if (!this.aiContextService) {
            const errorResponse = {
                success: false,
                error: 'AI Context service not available',
                contextType,
                originalText: text,
                requestId,
            };
            this.logger.error('AI Context service not available', null, {
                requestId,
                contextType,
                textLength: text?.length || 0,
            });
            sendResponse(errorResponse);
            return true;
        }

        // Include target language in metadata for AI providers
        const enhancedMetadata = {
            ...metadata,
            targetLanguage: targetLanguage || 'en', // Default to English if not provided
            sourceLanguage: sourceLanguage || 'auto', // Pass source language to AI providers
            requestedContextTypes: contextTypes,
        };

        this.logger.debug('Processing context analysis request', {
            textLength: text?.length || 0,
            contextType,
            metadataKeys: Object.keys(enhancedMetadata),
            sourceLanguage: enhancedMetadata.sourceLanguage,
            targetLanguage: enhancedMetadata.targetLanguage,
        });

        this.analyzeRequestedContextTypes(text, contextTypes, enhancedMetadata)
            .then((result) => {
                this.logger.debug('AI Context service returned result', {
                    success: result.success,
                    hasAnalysis: !!result.analysis,
                    hasResult: !!result.result,
                    hasError: !!result.error,
                    resultKeys: Object.keys(result),
                    contextType: result.contextType,
                });

                const response = {
                    success: result.success,
                    result: result, // Pass the entire result object
                    error: result.error,
                    shouldRetry: result.shouldRetry,
                    shouldCache: result.shouldCache,
                    requestId,
                };

                this.logger.debug('Sending response to content script', {
                    responseSuccess: response.success,
                    hasResponseResult: !!response.result,
                    hasResponseError: !!response.error,
                    responseKeys: Object.keys(response),
                });

                sendResponse(response);
            })
            .catch((error) => {
                this.logger.error('Context analysis failed', error, {
                    textLength: text?.length || 0,
                    contextType,
                });

                const errorResponse = {
                    success: false,
                    error: error.message || 'Context analysis failed',
                    result: null,
                    requestId,
                };

                this.logger.debug(
                    'Sending error response to content script',
                    errorResponse
                );
                sendResponse(errorResponse);
            });

        return true; // Async response
    }

    async analyzeRequestedContextTypes(text, contextTypes, metadata) {
        if (contextTypes.length === 1) {
            return this.aiContextService.analyzeContext(
                text,
                contextTypes[0],
                metadata
            );
        }

        const requestsCanonicalFullSet =
            contextTypes.length === CONTEXT_TYPES.length &&
            CONTEXT_TYPES.every((type) => contextTypes.includes(type));
        if (requestsCanonicalFullSet) {
            const result = await this.aiContextService.analyzeContext(
                text,
                'all',
                metadata
            );
            return { ...result, contextTypes };
        }

        const resultsByType = {};
        for (const requestedType of contextTypes) {
            const result = await this.aiContextService.analyzeContext(
                text,
                requestedType,
                metadata
            );
            resultsByType[requestedType] = result;

            if (!result?.success) {
                return {
                    success: false,
                    error:
                        result?.error ||
                        `${requestedType} context analysis failed`,
                    contextType: 'combined',
                    contextTypes,
                    componentResults: resultsByType,
                    originalText: text,
                    metadata,
                    shouldRetry: result?.shouldRetry,
                    shouldCache: false,
                };
            }
        }

        return {
            success: true,
            contextType: 'combined',
            contextTypes,
            analysis: combineContextAnalyses(contextTypes, resultsByType),
            componentResults: resultsByType,
            originalText: text,
            metadata,
            shouldCache: contextTypes.every(
                (type) => resultsByType[type].shouldCache !== false
            ),
        };
    }

    /**
     * Handle context provider change requests
     */
    handleChangeContextProviderMessage(message, sendResponse) {
        const { providerId } = message;

        if (!this.aiContextService) {
            sendResponse({
                success: false,
                message: 'AI Context service not available',
            });
            return true;
        }

        this.logger.debug('Processing context provider change', { providerId });

        this.aiContextService
            .changeProvider(providerId)
            .then((result) => {
                sendResponse(result);
            })
            .catch((error) => {
                this.logger.error('Context provider change failed', error, {
                    providerId,
                });
                sendResponse({
                    success: false,
                    message:
                        error.message || 'Failed to change context provider',
                });
            });

        return true; // Async response
    }

    /**
     * Handle context service status requests
     */
    handleGetContextStatusMessage(message, sendResponse) {
        if (!this.aiContextService) {
            sendResponse({
                success: false,
                error: 'AI Context service not available',
            });
            return true;
        }

        try {
            const status = this.aiContextService.getStatus();
            sendResponse({
                success: true,
                status,
            });
        } catch (error) {
            this.logger.error('Failed to get context status', error);
            sendResponse({
                success: false,
                error: error.message || 'Failed to get context status',
            });
        }

        return true;
    }

    /**
     * Handle get available models requests
     */
    handleGetAvailableModelsMessage(message, sendResponse) {
        const { providerId } = message;

        if (!this.aiContextService) {
            sendResponse({
                success: false,
                error: 'AI Context service not available',
                models: [],
                needsRetry: true,
            });
            return true;
        }

        // Check if AI context service is fully initialized
        if (!this.aiContextService.isInitialized) {
            this.logger.debug(
                'AI Context service not yet initialized, deferring request',
                {
                    providerId,
                }
            );
            sendResponse({
                success: false,
                error: 'AI Context service is still initializing',
                models: [],
                needsRetry: true,
            });
            return true;
        }

        this.logger.debug('Processing get available models request', {
            providerId,
        });

        try {
            const models = this.aiContextService.getAvailableModels(providerId);
            sendResponse({
                success: true,
                models,
                providerId:
                    providerId || this.aiContextService.currentProviderId,
            });
        } catch (error) {
            this.logger.error('Failed to get available models', error, {
                providerId,
            });
            sendResponse({
                success: false,
                error: error.message || 'Failed to get available models',
                models: [],
                needsRetry: false,
            });
        }

        return true;
    }

    /**
     * Handle get default model requests
     */
    handleGetDefaultModelMessage(message, sendResponse) {
        const { providerId } = message;

        if (!this.aiContextService) {
            sendResponse({
                success: false,
                error: 'AI Context service not available',
                defaultModel: null,
                needsRetry: true,
            });
            return true;
        }

        // Check if AI context service is fully initialized
        if (!this.aiContextService.isInitialized) {
            this.logger.debug(
                'AI Context service not yet initialized, deferring request',
                {
                    providerId,
                }
            );
            sendResponse({
                success: false,
                error: 'AI Context service is still initializing',
                defaultModel: null,
                needsRetry: true,
            });
            return true;
        }

        this.logger.debug('Processing get default model request', {
            providerId,
        });

        try {
            const defaultModel =
                this.aiContextService.getDefaultModel(providerId);
            sendResponse({
                success: true,
                defaultModel,
                providerId:
                    providerId || this.aiContextService.currentProviderId,
            });
        } catch (error) {
            this.logger.error('Failed to get default model', error, {
                providerId,
            });
            sendResponse({
                success: false,
                error: error.message || 'Failed to get default model',
                defaultModel: null,
                needsRetry: false,
            });
        }

        return true;
    }

    /**
     * Handle reload context provider configuration requests
     */
    handleReloadContextProviderConfigMessage(message, sendResponse) {
        if (!this.aiContextService) {
            sendResponse({
                success: false,
                error: 'AI Context service not available',
            });
            return true;
        }

        this.logger.debug('Processing reload context provider config request');

        this.aiContextService
            .reloadProviderConfig()
            .then(() => {
                const status = this.aiContextService.getStatus();
                sendResponse({
                    success: true,
                    message: 'Provider configuration reloaded successfully',
                    currentProvider: status.currentProvider,
                });
            })
            .catch((error) => {
                this.logger.error(
                    'Failed to reload provider configuration',
                    error
                );
                sendResponse({
                    success: false,
                    error:
                        error.message ||
                        'Failed to reload provider configuration',
                });
            });

        return true; // Async response
    }

    /**
     * Handle ping requests for connection testing (Issue #1: Fixed provider connection)
     */
    handlePingMessage(message, sendResponse) {
        this.logger.debug('Received ping message', {
            timestamp: message.timestamp,
            source: message.source,
        });

        sendResponse({
            success: true,
            timestamp: Date.now(),
            originalTimestamp: message.timestamp,
            message: 'pong',
        });

        return true;
    }

    /**
     * Handle background readiness check requests
     */
    handleCheckBackgroundReadyMessage(message, sendResponse) {
        this.logger.debug('Received background readiness check', {
            timestamp: Date.now(),
        });

        const isReady = !!(
            this.translationService &&
            this.subtitleService &&
            this.aiContextService &&
            this.aiContextService.isInitialized
        );

        sendResponse({
            success: true,
            ready: isReady,
            timestamp: Date.now(),
            services: {
                translation: !!this.translationService,
                subtitle: !!this.subtitleService,
                aiContext: !!this.aiContextService,
                aiContextInitialized:
                    this.aiContextService?.isInitialized || false,
            },
        });

        return true;
    }

    /**
     * Handle side panel open requests
     */
    handleSidePanelOpenMessage(message, sender, sendResponse) {
        if (!this.sidePanelService) {
            sendResponse({
                success: false,
                error: 'Side panel service not available',
            });
            return true;
        }

        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({
                success: false,
                error: 'No tab ID available',
            });
            return true;
        }

        this.logger.debug('Handling side panel open request', { tabId });

        // Optionally store open reason before opening (do NOT override activeTab to avoid UI flips)
        try {
            if (message.options?.openReason) {
                this.sidePanelService.updateTabState(tabId, {
                    ...(message.options.openReason
                        ? { openReason: message.options.openReason }
                        : {}),
                });
            }
        } catch (_) {}

        // Attempt to open the side panel immediately to preserve user gesture
        const openOperation =
            this.takeSynchronousSidePanelGesture(message) ||
            this.sidePanelService.openSidePanelImmediate(
                tabId,
                message.options || {}
            );
        openOperation
            .then((result) => {
                sendResponse(result);
            })
            .catch((error) => {
                this.logger.error(
                    'Failed to open side panel (immediate)',
                    error,
                    { tabId }
                );
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to open side panel',
                });
            });

        return true; // Async response
    }

    /**
     * Handle word selection events from content scripts
     */
    handleSidePanelWordSelectedMessage(message, sender, sendResponse) {
        if (!this.sidePanelService) {
            sendResponse({
                success: false,
                error: 'Side panel service not available',
            });
            return true;
        }

        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({
                success: false,
                error: 'No tab ID available',
            });
            return true;
        }

        this.logger.debug('Handling word selection from content script', {
            tabId,
            wordLength:
                typeof message.word === 'string' ? message.word.length : 0,
        });

        const openOperation = this.takeSynchronousSidePanelGesture(message);
        this.sidePanelService
            .forwardWordSelection(tabId, message, openOperation)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                this.logger.error('Failed to forward word selection', error, {
                    tabId,
                });
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to forward word selection',
                });
            });

        return true; // Async response
    }

    handleSidePanelSelectionSyncMessage(message, sender, sendResponse) {
        if (!this.sidePanelService) {
            sendResponse({
                success: false,
                error: 'Side panel service not available',
            });
            return true;
        }

        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({
                success: false,
                error: 'No tab ID available',
            });
            return true;
        }

        this.sidePanelService
            .forwardSelectionSync(tabId, message?.data ?? message)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                this.logger.error('Failed to forward selection sync', error, {
                    tabId,
                });
                sendResponse({
                    success: false,
                    error: error.message || 'Failed to forward selection sync',
                });
            });

        return true;
    }

    /**
     * Handle analyzing state update from side panel
     * Broadcasts to content script to block/unblock word clicks
     */
    handleSidePanelSetAnalyzingMessage(message, sender, sendResponse) {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ success: false, error: 'No tab ID available' });
            return false;
        }

        const isAnalyzing = !!message.isAnalyzing;
        this.logger.debug('Setting analyzing state', { tabId, isAnalyzing });

        // Store state in side panel service
        if (this.sidePanelService) {
            this.sidePanelService.updateTabState(tabId, { isAnalyzing });
        }

        // Forward to content script to block word clicks
        chrome.tabs
            .sendMessage(tabId, {
                action: MessageActions.SIDEPANEL_SET_ANALYZING,
                isAnalyzing,
            })
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                this.logger.warn(
                    'Failed to send analyzing state to content script',
                    error,
                    { tabId }
                );
                sendResponse({ success: true }); // Don't fail the side panel
            });

        return true; // Async response
    }
}

// Export singleton instance
export const messageHandler = new MessageHandler();
export { MessageHandler };
