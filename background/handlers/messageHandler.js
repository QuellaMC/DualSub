// @ts-check

import { loggingManager } from '../utils/loggingManager.js';
import { getDisneySubtitleFailureMetadata } from '../services/subtitleService.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import { authorizeSubtitleRequest } from '../utils/subtitleRequestPolicy.js';
import {
    combineContextAnalyses,
    CONTEXT_TYPES,
} from '../../context_providers/contextSchemas.js';
import {
    buildAnalyzeContextFailureResponse,
    buildAnalyzeContextSuccessResponse,
    buildSidePanelContentSelectionSnapshotResponse,
    buildTranslationFailureResponse,
    buildTranslationSuccessResponse,
    classifyExtensionMessageSender,
    MessageSenderRoles,
    parseAnalyzeContextRequestMessage,
    parseSidePanelContentSelectionSnapshotMessage,
    parseSidePanelWordIntentMessage,
    parseTranslationRequestMessage,
    readProtocolMessageAction,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

const MAX_SUBTITLE_RESPONDERS_PER_FLIGHT = 8;
const MAX_SUBTITLE_FLIGHTS_PER_TAB_SOURCE = 2;
const MAX_SUBTITLE_FLIGHTS_GLOBAL = 8;

const SUBTITLE_PROCESSING_FAILURE_ERROR = 'Subtitle processing failed';
const SUBTITLE_SERVICE_UNAVAILABLE_ERROR = 'Subtitle service not initialized';
const ANALYZE_CONTEXT_FAILED_ERROR = 'Context analysis failed';
const ANALYZE_CONTEXT_REJECTED_ERROR = 'Context analysis rejected';
const ANALYZE_CONTEXT_UNAVAILABLE_ERROR = 'Context analysis unavailable';

const SUBTITLE_REQUEST_REJECTED_RESPONSE = Object.freeze({
    success: false,
    error: 'Subtitle request rejected',
});
const SUBTITLE_READINESS_FAILURE_RESPONSE = Object.freeze({
    success: false,
    error: 'Background services unavailable',
});
const INVALID_MESSAGE_RESPONSE = Object.freeze({
    success: false,
    error: 'Invalid message',
});
const SIDEPANEL_WORD_INTENT_ACCEPTED_RESPONSE = Object.freeze({
    success: true,
});
const SIDEPANEL_WORD_INTENT_REJECTED_RESPONSE = Object.freeze({
    success: false,
});

const UNKNOWN_DISNEY_SUBTITLE_FAILURE = Object.freeze({
    stage: 'unknown',
    errorCode: 'DISNEY_SUBTITLE_PROCESSING_FAILED',
});
const ALLOWED_DISNEY_SUBTITLE_FAILURES = new Map([
    ['master-fetch', 'DISNEY_MASTER_FETCH_FAILED'],
    ['master-parse', 'DISNEY_MASTER_PARSE_FAILED'],
    ['media-fetch', 'DISNEY_MEDIA_FETCH_FAILED'],
    ['vtt-fetch', 'DISNEY_VTT_FETCH_FAILED'],
]);

function sendResponseSafely(sendResponse, response) {
    try {
        sendResponse(response);
    } catch (_) {}
}

function createAnalyzeSenderSnapshot(identity) {
    if (identity?.role === MessageSenderRoles.SIDEPANEL) {
        return Object.freeze({ role: identity.role });
    }
    if (identity?.role !== MessageSenderRoles.CONTENT) return null;

    return Object.freeze({
        role: identity.role,
        platform: identity.platform,
        tabId: identity.tabId,
        windowId: identity.windowId,
        documentId: identity.documentId,
        documentLifecycle: identity.documentLifecycle,
        frameId: identity.frameId,
    });
}

function createContentSenderSnapshot(identity) {
    if (identity?.role !== MessageSenderRoles.CONTENT) return null;

    return Object.freeze({
        role: identity.role,
        platform: identity.platform,
        tabId: identity.tabId,
        windowId: identity.windowId,
        documentId: identity.documentId,
        documentLifecycle: identity.documentLifecycle,
        frameId: identity.frameId,
    });
}

function createAnalyzeMetadata(request, sender) {
    const metadata = {
        requestedContextTypes: Object.freeze([...request.contextTypes]),
        sourceLanguage:
            sender.role === MessageSenderRoles.CONTENT
                ? request.language
                : 'auto',
        targetLanguage: request.targetLanguage,
    };
    if (sender.role === MessageSenderRoles.CONTENT) {
        metadata.platform = sender.platform;
    }
    return Object.freeze(metadata);
}

function subtitleFlightKey(snapshot) {
    return JSON.stringify([snapshot.source, snapshot.tabId, snapshot.videoId]);
}

function subtitleRequestSignature(snapshot) {
    return JSON.stringify(snapshot);
}

function createSubtitleSuccessResponse(result, videoId) {
    if (
        !result ||
        typeof result !== 'object' ||
        typeof result.vttText !== 'string' ||
        (result.targetVttText !== null &&
            typeof result.targetVttText !== 'string') ||
        typeof result.sourceLanguage !== 'string' ||
        typeof result.targetLanguage !== 'string' ||
        typeof result.useNativeTarget !== 'boolean'
    ) {
        throw new TypeError('Invalid subtitle result');
    }

    let displayName = result.sourceLanguage;
    if (result.availableLanguages !== undefined) {
        if (!Array.isArray(result.availableLanguages)) {
            throw new TypeError('Invalid subtitle result');
        }
        const selectedLanguage = result.availableLanguages.find(
            (language) =>
                language?.normalizedCode === result.sourceLanguage &&
                typeof language.displayName === 'string'
        );
        if (selectedLanguage) displayName = selectedLanguage.displayName;
    }

    return {
        success: true,
        vttText: result.vttText,
        targetVttText: result.targetVttText,
        videoId,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        useNativeTarget: result.useNativeTarget,
        selectedLanguage: {
            normalizedCode: result.sourceLanguage,
            displayName,
        },
    };
}

function createSubtitleProcessingFailureResponse(videoId) {
    return {
        success: false,
        error: SUBTITLE_PROCESSING_FAILURE_ERROR,
        videoId,
    };
}

function createSubtitleServiceUnavailableResponse(videoId) {
    return {
        success: false,
        error: SUBTITLE_SERVICE_UNAVAILABLE_ERROR,
        videoId,
    };
}

function createSubtitleResponseForRecipient(response) {
    if (response.selectedLanguage) {
        return {
            ...response,
            selectedLanguage: { ...response.selectedLanguage },
        };
    }
    return { ...response };
}

function getSafeDisneySubtitleFailureMetadata(error) {
    const metadata = getDisneySubtitleFailureMetadata(error);
    return metadata &&
        ALLOWED_DISNEY_SUBTITLE_FAILURES.get(metadata.stage) ===
            metadata.errorCode
        ? metadata
        : UNKNOWN_DISNEY_SUBTITLE_FAILURE;
}

class MessageHandler {
    #translationService = null;
    #subtitleService = null;
    #aiContextService = null;
    #sidePanelService = null;
    #serviceReadiness = null;
    #runtimeMessageListener = null;
    #subtitleFlights = new Map();
    #translationReadinessFlights = new Set();
    #analyzeContextFlights = new Set();
    #lifecycleEpoch = 0;
    #initialized = false;

    constructor() {
        this.logger = null;
    }

    initialize(serviceReadiness = null) {
        if (serviceReadiness) this.#serviceReadiness = serviceReadiness;
        if (this.#initialized) return;

        const listenerEpoch = ++this.#lifecycleEpoch;
        this.logger = loggingManager.createLogger('MessageHandler');
        this.#runtimeMessageListener = (message, sender, sendResponse) => {
            const action = readProtocolMessageAction(message);
            switch (action) {
                case MessageActions.FETCH_VTT:
                    return this.#handleSubtitleRequest(
                        message,
                        sender,
                        sendResponse,
                        listenerEpoch
                    );
                case MessageActions.TRANSLATE:
                    return this.#handleTranslationRequest(
                        message,
                        sender,
                        sendResponse,
                        listenerEpoch
                    );
                case MessageActions.ANALYZE_CONTEXT:
                    return this.#handleAnalyzeContextRequest(
                        message,
                        sender,
                        sendResponse,
                        listenerEpoch
                    );
                case MessageActions.SIDEPANEL_SELECTION_SYNC:
                    return this.#handleSidePanelSelectionSync(
                        message,
                        sender,
                        sendResponse,
                        listenerEpoch
                    );
                case MessageActions.SIDEPANEL_WORD_SELECTED:
                    return this.#handleSidePanelWordIntent(
                        message,
                        sender,
                        sendResponse,
                        listenerEpoch
                    );
                default:
                    sendResponseSafely(sendResponse, INVALID_MESSAGE_RESPONSE);
                    return false;
            }
        };

        chrome.runtime.onMessage.addListener(this.#runtimeMessageListener);
        this.#initialized = true;
        this.logger.info('Message handler initialized');
    }

    setServices(services) {
        if (!services || typeof services !== 'object') {
            throw new TypeError('Message handler services must be an object');
        }

        if (Object.hasOwn(services, 'translationService')) {
            this.#translationService = services.translationService || null;
        }
        if (Object.hasOwn(services, 'subtitleService')) {
            this.#subtitleService = services.subtitleService || null;
        }
        if (Object.hasOwn(services, 'aiContextService')) {
            this.#aiContextService = services.aiContextService || null;
        }
        if (Object.hasOwn(services, 'sidePanelService')) {
            this.#sidePanelService = services.sidePanelService || null;
        }

        this.logger?.debug('Services injected into message handler', {
            hasTranslation: Boolean(this.#translationService),
            hasSubtitle: Boolean(this.#subtitleService),
            hasAIContext: Boolean(this.#aiContextService),
            hasSidePanel: Boolean(this.#sidePanelService),
        });
    }

    destroy() {
        this.#lifecycleEpoch += 1;
        if (
            this.#runtimeMessageListener &&
            typeof chrome !== 'undefined' &&
            chrome.runtime?.onMessage?.removeListener
        ) {
            chrome.runtime.onMessage.removeListener(
                this.#runtimeMessageListener
            );
        }
        this.#runtimeMessageListener = null;

        for (const flight of this.#subtitleFlights.values()) {
            this.#finalizeSubtitleFlight(
                flight,
                SUBTITLE_READINESS_FAILURE_RESPONSE,
                { abort: true }
            );
        }
        this.#subtitleFlights.clear();

        for (const flight of this.#translationReadinessFlights) {
            this.#finalizeTranslationReadinessFlight(
                flight,
                buildTranslationFailureResponse(flight.request, {})
            );
        }
        this.#translationReadinessFlights.clear();

        for (const flight of this.#analyzeContextFlights) {
            this.#failAnalyzeContextFlight(
                flight,
                ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                false
            );
        }
        this.#analyzeContextFlights.clear();
        this.#initialized = false;
    }

    #isCurrent(listenerEpoch) {
        return this.#initialized && this.#lifecycleEpoch === listenerEpoch;
    }

    #handleTranslationRequest(message, sender, sendResponse, listenerEpoch) {
        const request = parseTranslationRequestMessage(message);
        if (!request) {
            sendResponseSafely(sendResponse, INVALID_MESSAGE_RESPONSE);
            return false;
        }

        const identity = classifyExtensionMessageSender(sender);
        if (
            identity?.role !== MessageSenderRoles.CONTENT ||
            !this.#isCurrent(listenerEpoch)
        ) {
            sendResponseSafely(
                sendResponse,
                buildTranslationFailureResponse(request, {})
            );
            return false;
        }

        if (!this.#serviceReadiness || this.#serviceReadiness.isReady()) {
            void this.#respondToTranslation(request, sendResponse);
            return true;
        }

        const flight = {
            listenerEpoch,
            request,
            responder: sendResponse,
            settled: false,
        };
        this.#translationReadinessFlights.add(flight);
        void this.#runTranslationReadinessFlight(flight);
        return true;
    }

    async #runTranslationReadinessFlight(flight) {
        try {
            await this.#serviceReadiness.waitUntilReady();
        } catch (_) {
            if (!flight.settled) {
                this.logger?.error(
                    'Background services unavailable before translation handling',
                    { action: MessageActions.TRANSLATE }
                );
                this.#finalizeTranslationReadinessFlight(
                    flight,
                    buildTranslationFailureResponse(flight.request, {})
                );
            }
            return;
        }

        if (flight.settled) return;
        if (!this.#isCurrent(flight.listenerEpoch)) {
            this.#finalizeTranslationReadinessFlight(
                flight,
                buildTranslationFailureResponse(flight.request, {})
            );
            return;
        }

        const request = flight.request;
        const responder = flight.responder;
        flight.settled = true;
        this.#translationReadinessFlights.delete(flight);
        flight.request = null;
        flight.responder = null;
        await this.#respondToTranslation(request, responder);
    }

    #finalizeTranslationReadinessFlight(flight, response) {
        if (flight.settled) return false;
        flight.settled = true;
        this.#translationReadinessFlights.delete(flight);
        const responder = flight.responder;
        flight.request = null;
        flight.responder = null;
        sendResponseSafely(responder, response);
        return true;
    }

    async #respondToTranslation(request, sendResponse) {
        if (!this.#translationService) {
            sendResponseSafely(
                sendResponse,
                buildTranslationFailureResponse(request, {})
            );
            return;
        }

        try {
            const translatedText = await this.#translationService.translate(
                request.text,
                'auto',
                request.targetLang
            );
            const response = buildTranslationSuccessResponse(request, {
                translatedText,
            });
            sendResponseSafely(sendResponse, response);
        } catch (_) {
            this.logger?.error('Translation failed', {
                textLength: request.text.length,
                targetLang: request.targetLang,
            });
            sendResponseSafely(
                sendResponse,
                buildTranslationFailureResponse(request, {})
            );
        }
    }

    #handleAnalyzeContextRequest(message, sender, sendResponse, listenerEpoch) {
        const senderSnapshot = createAnalyzeSenderSnapshot(
            classifyExtensionMessageSender(sender)
        );
        if (!senderSnapshot) {
            sendResponseSafely(sendResponse, INVALID_MESSAGE_RESPONSE);
            return false;
        }

        const request = parseAnalyzeContextRequestMessage(
            message,
            senderSnapshot.role
        );
        if (!request) {
            sendResponseSafely(sendResponse, INVALID_MESSAGE_RESPONSE);
            return false;
        }
        if (
            senderSnapshot.role === MessageSenderRoles.CONTENT &&
            request.platform !== senderSnapshot.platform
        ) {
            sendResponseSafely(
                sendResponse,
                buildAnalyzeContextFailureResponse(
                    senderSnapshot.role,
                    request,
                    {
                        error: ANALYZE_CONTEXT_REJECTED_ERROR,
                        shouldRetry: false,
                    }
                )
            );
            return false;
        }
        if (!this.#isCurrent(listenerEpoch)) {
            sendResponseSafely(
                sendResponse,
                buildAnalyzeContextFailureResponse(
                    senderSnapshot.role,
                    request,
                    {
                        error: ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                        shouldRetry: false,
                    }
                )
            );
            return false;
        }

        const flight = {
            listenerEpoch,
            request,
            responder: sendResponse,
            sender: senderSnapshot,
            settled: false,
        };
        this.#analyzeContextFlights.add(flight);
        void this.#runAnalyzeContextFlight(flight);
        return true;
    }

    #isCurrentAnalyzeContextFlight(flight) {
        return (
            !flight.settled &&
            this.#analyzeContextFlights.has(flight) &&
            this.#isCurrent(flight.listenerEpoch)
        );
    }

    async #runAnalyzeContextFlight(flight) {
        if (this.#serviceReadiness && !this.#serviceReadiness.isReady()) {
            try {
                await this.#serviceReadiness.waitUntilReady();
            } catch (_) {
                if (!flight.settled) {
                    this.logger?.error(
                        'Background services unavailable before context analysis',
                        { action: MessageActions.ANALYZE_CONTEXT }
                    );
                    this.#failAnalyzeContextFlight(
                        flight,
                        ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                        false
                    );
                }
                return;
            }
        }

        if (!this.#isCurrentAnalyzeContextFlight(flight)) {
            if (!flight.settled) {
                this.#failAnalyzeContextFlight(
                    flight,
                    ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                    false
                );
            }
            return;
        }
        if (!this.#aiContextService) {
            this.#failAnalyzeContextFlight(
                flight,
                ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                false
            );
            return;
        }

        try {
            const result = await this.#analyzeRequestedContextTypes(flight);
            if (!this.#isCurrentAnalyzeContextFlight(flight)) return;
            if (result.success !== true) {
                this.#failAnalyzeContextFlight(
                    flight,
                    ANALYZE_CONTEXT_FAILED_ERROR,
                    result.shouldRetry === true
                );
                return;
            }
            const response = buildAnalyzeContextSuccessResponse(
                flight.sender.role,
                flight.request,
                { analysis: result.analysis }
            );
            this.#finalizeAnalyzeContextFlight(flight, response);
        } catch (_) {
            if (flight.settled) return;
            this.logger?.error('Context analysis failed', {
                action: MessageActions.ANALYZE_CONTEXT,
            });
            this.#failAnalyzeContextFlight(
                flight,
                this.#isCurrentAnalyzeContextFlight(flight)
                    ? ANALYZE_CONTEXT_FAILED_ERROR
                    : ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                false
            );
        }
    }

    async #analyzeRequestedContextTypes(flight) {
        const { request, sender } = flight;
        const metadata = createAnalyzeMetadata(request, sender);
        const analyzeOne = async (contextType) => {
            if (!this.#isCurrentAnalyzeContextFlight(flight)) {
                throw new Error(ANALYZE_CONTEXT_UNAVAILABLE_ERROR);
            }
            const result = await this.#aiContextService.analyzeContext(
                request.text,
                contextType,
                metadata
            );
            if (!this.#isCurrentAnalyzeContextFlight(flight)) {
                throw new Error(ANALYZE_CONTEXT_UNAVAILABLE_ERROR);
            }
            return result?.success === true
                ? { success: true, analysis: result.analysis }
                : {
                      success: false,
                      shouldRetry: result?.shouldRetry === true,
                  };
        };

        if (request.contextTypes.length === 1) {
            return analyzeOne(request.contextTypes[0]);
        }

        const requestsFullSet =
            request.contextTypes.length === CONTEXT_TYPES.length &&
            CONTEXT_TYPES.every((type) => request.contextTypes.includes(type));
        if (requestsFullSet) return analyzeOne('all');

        const resultsByType = {};
        for (const contextType of request.contextTypes) {
            const result = await analyzeOne(contextType);
            if (result.success !== true) return result;
            resultsByType[contextType] = { analysis: result.analysis };
        }
        return {
            success: true,
            analysis: combineContextAnalyses(
                request.contextTypes,
                resultsByType
            ),
        };
    }

    #failAnalyzeContextFlight(flight, error, shouldRetry) {
        if (flight.settled) return false;
        const response = buildAnalyzeContextFailureResponse(
            flight.sender.role,
            flight.request,
            { error, shouldRetry: shouldRetry === true }
        );
        return this.#finalizeAnalyzeContextFlight(flight, response);
    }

    #finalizeAnalyzeContextFlight(flight, response) {
        if (flight.settled) return false;
        flight.settled = true;
        this.#analyzeContextFlights.delete(flight);
        const responder = flight.responder;
        flight.request = null;
        flight.responder = null;
        flight.sender = null;
        sendResponseSafely(responder, response);
        return true;
    }

    #handleSidePanelSelectionSync(
        message,
        sender,
        sendResponse,
        listenerEpoch
    ) {
        const senderSnapshot = createContentSenderSnapshot(
            classifyExtensionMessageSender(sender)
        );
        const snapshot = parseSidePanelContentSelectionSnapshotMessage(message);
        let accepted = false;
        if (
            senderSnapshot &&
            snapshot &&
            this.#isCurrent(listenerEpoch) &&
            typeof this.#sidePanelService?.acceptSelectionSnapshot ===
                'function'
        ) {
            try {
                accepted =
                    this.#sidePanelService.acceptSelectionSnapshot(
                        senderSnapshot,
                        snapshot
                    ) === true;
            } catch (_) {}
        }

        sendResponseSafely(
            sendResponse,
            buildSidePanelContentSelectionSnapshotResponse(
                accepted ? 'accepted' : 'rejected'
            )
        );
        return false;
    }

    #handleSidePanelWordIntent(message, sender, sendResponse, listenerEpoch) {
        const intent = parseSidePanelWordIntentMessage(message);
        const senderSnapshot = createContentSenderSnapshot(
            classifyExtensionMessageSender(sender)
        );
        if (
            !intent ||
            !senderSnapshot ||
            !this.#isCurrent(listenerEpoch) ||
            typeof this.#sidePanelService?.openSidePanelImmediate !== 'function'
        ) {
            sendResponseSafely(
                sendResponse,
                SIDEPANEL_WORD_INTENT_REJECTED_RESPONSE
            );
            return false;
        }

        let operation;
        try {
            operation = Promise.resolve(
                this.#sidePanelService.openSidePanelImmediate(
                    senderSnapshot.tabId,
                    intent.options
                )
            );
        } catch (_) {
            sendResponseSafely(
                sendResponse,
                SIDEPANEL_WORD_INTENT_REJECTED_RESPONSE
            );
            return false;
        }

        operation.then(
            (result) =>
                sendResponseSafely(
                    sendResponse,
                    result?.success === true
                        ? SIDEPANEL_WORD_INTENT_ACCEPTED_RESPONSE
                        : SIDEPANEL_WORD_INTENT_REJECTED_RESPONSE
                ),
            () =>
                sendResponseSafely(
                    sendResponse,
                    SIDEPANEL_WORD_INTENT_REJECTED_RESPONSE
                )
        );
        return true;
    }

    #handleSubtitleRequest(message, sender, sendResponse, listenerEpoch) {
        let snapshot;
        try {
            snapshot = authorizeSubtitleRequest(message, sender);
        } catch (_) {
            this.logger?.warn('Subtitle request rejected', {
                stage: 'authorize',
            });
            sendResponseSafely(
                sendResponse,
                SUBTITLE_REQUEST_REJECTED_RESPONSE
            );
            return false;
        }

        if (!this.#isCurrent(listenerEpoch)) {
            this.logger?.warn('Subtitle request rejected', {
                stage: 'lifecycle',
            });
            sendResponseSafely(
                sendResponse,
                SUBTITLE_REQUEST_REJECTED_RESPONSE
            );
            return false;
        }

        return this.#admitSubtitleRequest(snapshot, sendResponse);
    }

    #admitSubtitleRequest(snapshot, sendResponse) {
        const key = subtitleFlightKey(snapshot);
        const signature = subtitleRequestSignature(snapshot);
        const existingFlight = this.#subtitleFlights.get(key);
        if (existingFlight?.signature === signature) {
            if (
                existingFlight.responders.length >=
                MAX_SUBTITLE_RESPONDERS_PER_FLIGHT
            ) {
                return this.#rejectSubtitleRequestAtCapacity(
                    snapshot,
                    sendResponse,
                    'responders',
                    existingFlight.responders.length
                );
            }
            existingFlight.responders.push(sendResponse);
            return true;
        }
        if (existingFlight) {
            this.#finalizeSubtitleFlight(
                existingFlight,
                SUBTITLE_REQUEST_REJECTED_RESPONSE,
                { abort: true }
            );
        }

        let partitionCount = 0;
        for (const flight of this.#subtitleFlights.values()) {
            if (
                flight.snapshot.tabId === snapshot.tabId &&
                flight.snapshot.source === snapshot.source
            ) {
                partitionCount += 1;
            }
        }
        if (partitionCount >= MAX_SUBTITLE_FLIGHTS_PER_TAB_SOURCE) {
            return this.#rejectSubtitleRequestAtCapacity(
                snapshot,
                sendResponse,
                'tab-source',
                partitionCount
            );
        }
        if (this.#subtitleFlights.size >= MAX_SUBTITLE_FLIGHTS_GLOBAL) {
            return this.#rejectSubtitleRequestAtCapacity(
                snapshot,
                sendResponse,
                'global',
                this.#subtitleFlights.size
            );
        }

        const flight = {
            key,
            signature,
            snapshot,
            responders: [sendResponse],
            abortController: new AbortController(),
            settled: false,
        };
        this.#subtitleFlights.set(key, flight);
        void this.#runSubtitleFlight(flight);
        return true;
    }

    #rejectSubtitleRequestAtCapacity(snapshot, sendResponse, scope, count) {
        this.logger?.warn('Subtitle request capacity reached', {
            stage: 'admission',
            scope,
            tabId: snapshot.tabId,
            source: snapshot.source,
            count,
        });
        sendResponseSafely(sendResponse, SUBTITLE_REQUEST_REJECTED_RESPONSE);
        return false;
    }

    async #runSubtitleFlight(flight) {
        if (this.#serviceReadiness && !this.#serviceReadiness.isReady()) {
            try {
                await this.#serviceReadiness.waitUntilReady();
            } catch (_) {
                if (!flight.settled) {
                    this.logger?.error(
                        'Background services unavailable for subtitle request',
                        null,
                        {
                            stage: 'readiness',
                            tabId: flight.snapshot.tabId,
                            source: flight.snapshot.source,
                        }
                    );
                    this.#finalizeSubtitleFlight(
                        flight,
                        SUBTITLE_READINESS_FAILURE_RESPONSE
                    );
                }
                return;
            }
        }

        if (flight.settled) return;
        const response = await this.#processSubtitleRequest(flight);
        this.#finalizeSubtitleFlight(flight, response);
    }

    async #processSubtitleRequest(flight) {
        const { snapshot } = flight;
        if (!this.#subtitleService) {
            this.logger?.error('Subtitle service not available');
            return createSubtitleServiceUnavailableResponse(snapshot.videoId);
        }

        try {
            const options = { signal: flight.abortController.signal };
            const result =
                snapshot.source === SubtitleRequestSources.NETFLIX
                    ? await this.#subtitleService.processNetflixSubtitles(
                          snapshot,
                          options
                      )
                    : await this.#subtitleService.processDisneyPlusSubtitles(
                          snapshot,
                          options
                      );
            return createSubtitleSuccessResponse(result, snapshot.videoId);
        } catch (error) {
            if (snapshot.source === SubtitleRequestSources.DISNEY_PLUS) {
                const failure = getSafeDisneySubtitleFailureMetadata(error);
                this.logger?.error('Disney VTT processing failed', null, {
                    stage: failure.stage,
                    errorCode: failure.errorCode,
                    source: SubtitleRequestSources.DISNEY_PLUS,
                    hasVideoId: snapshot.videoId.length > 0,
                });
            } else {
                this.logger?.error('Netflix VTT processing failed', null, {
                    stage: 'process',
                    source: SubtitleRequestSources.NETFLIX,
                    hasVideoId: snapshot.videoId.length > 0,
                });
            }
            return createSubtitleProcessingFailureResponse(snapshot.videoId);
        }
    }

    #finalizeSubtitleFlight(flight, response, { abort = false } = {}) {
        if (flight.settled) return false;
        flight.settled = true;
        if (this.#subtitleFlights.get(flight.key) === flight) {
            this.#subtitleFlights.delete(flight.key);
        }
        if (abort) {
            try {
                flight.abortController.abort();
            } catch (_) {}
        }

        const responders = flight.responders.splice(0);
        flight.snapshot = null;
        flight.abortController = null;
        for (const responder of responders) {
            sendResponseSafely(
                responder,
                createSubtitleResponseForRecipient(response)
            );
        }
        return true;
    }
}

export const messageHandler = new MessageHandler();
export { MessageHandler };
