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
import { getTrustedTranslationFailureMetadata } from '../services/serviceInterfaces.js';
import { getDisneySubtitleFailureMetadata } from '../services/subtitleService.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import {
    authorizeSubtitleRequest,
    isAuthorizedSubtitleRequestSnapshot,
} from '../utils/subtitleRequestPolicy.js';
import {
    combineContextAnalyses,
    CONTEXT_TYPES,
} from '../../context_providers/contextSchemas.js';
import {
    buildAnalyzeContextFailureResponse,
    buildAnalyzeContextSuccessResponse,
    buildBackgroundReadinessResponseMessage,
    buildSidePanelContentSelectionSnapshotResponse,
    buildTranslationFailureResponse,
    buildTranslationSuccessResponse,
    classifyExtensionMessageSender,
    MessageSenderRoles,
    parseAnalyzeContextRequestMessage,
    parseBackgroundReadinessRequestMessage,
    parseSidePanelContentSelectionSnapshotMessage,
    parseSidePanelWordIntentMessage,
    parseTranslationRequestMessage,
    readProtocolMessageAction,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

const MAX_TRANSLATION_RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SUBTITLE_RESPONDERS_PER_FLIGHT = 8;
const MAX_SUBTITLE_FLIGHTS_PER_TAB_SOURCE = 2;
const MAX_SUBTITLE_FLIGHTS_GLOBAL = 8;
const SUBTITLE_PROCESSING_FAILURE_ERROR = 'Subtitle processing failed';
const SUBTITLE_SERVICE_UNAVAILABLE_ERROR = 'Subtitle service not initialized';
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
const ANALYZE_CONTEXT_FAILED_ERROR = 'Context analysis failed';
const ANALYZE_CONTEXT_REJECTED_ERROR = 'Context analysis rejected';
const ANALYZE_CONTEXT_UNAVAILABLE_ERROR = 'Context analysis unavailable';
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
const UNPINNED_MESSAGE_ACTION = Symbol('unpinned-message-action');
const DISNEY_AUTHORIZED_SNAPSHOT_KEYS = Object.freeze([
    'action',
    'source',
    'tabId',
    'videoId',
    'url',
    'targetLanguage',
    'originalLanguage',
]);
const NETFLIX_AUTHORIZED_SNAPSHOT_KEYS = Object.freeze([
    'action',
    'source',
    'tabId',
    'videoId',
    'targetLanguage',
    'originalLanguage',
    'useNativeSubtitles',
    'useOfficialTranslations',
    'data',
]);
const NETFLIX_TRACK_KEYS = Object.freeze([
    'language',
    'displayName',
    'isNoneTrack',
    'isForcedNarrative',
    'ttDownloadables',
]);

function hasExactOwnKeys(value, expectedKeys) {
    const keys = Reflect.ownKeys(value);
    return (
        keys.length === expectedKeys.length &&
        expectedKeys.every((key) => Object.hasOwn(value, key))
    );
}

function isSameNetflixTrack(left, right) {
    const leftHasTrackType = Object.hasOwn(left, 'trackType');
    const rightHasTrackType = Object.hasOwn(right, 'trackType');
    const expectedTrackKeys = leftHasTrackType
        ? [...NETFLIX_TRACK_KEYS, 'trackType']
        : NETFLIX_TRACK_KEYS;
    if (
        leftHasTrackType !== rightHasTrackType ||
        !hasExactOwnKeys(left, expectedTrackKeys) ||
        !hasExactOwnKeys(right, expectedTrackKeys) ||
        left.language !== right.language ||
        left.displayName !== right.displayName ||
        (leftHasTrackType && left.trackType !== right.trackType) ||
        left.isNoneTrack !== right.isNoneTrack ||
        left.isForcedNarrative !== right.isForcedNarrative
    ) {
        return false;
    }

    const leftFormats = Reflect.ownKeys(left.ttDownloadables);
    const rightFormats = Reflect.ownKeys(right.ttDownloadables);
    if (
        leftFormats.length !== 1 ||
        rightFormats.length !== 1 ||
        typeof leftFormats[0] !== 'string' ||
        leftFormats[0] !== rightFormats[0]
    ) {
        return false;
    }

    const leftFormat = left.ttDownloadables[leftFormats[0]];
    const rightFormat = right.ttDownloadables[rightFormats[0]];
    if (
        !hasExactOwnKeys(leftFormat, ['urls']) ||
        !hasExactOwnKeys(rightFormat, ['urls']) ||
        !Array.isArray(leftFormat.urls) ||
        !Array.isArray(rightFormat.urls) ||
        leftFormat.urls.length !== 1 ||
        rightFormat.urls.length !== 1 ||
        Reflect.ownKeys(leftFormat.urls).length !== 2 ||
        Reflect.ownKeys(rightFormat.urls).length !== 2
    ) {
        return false;
    }

    return leftFormat.urls[0] === rightFormat.urls[0];
}

function isSameNetflixAuthorizedRequest(left, right) {
    if (
        !hasExactOwnKeys(left, NETFLIX_AUTHORIZED_SNAPSHOT_KEYS) ||
        !hasExactOwnKeys(right, NETFLIX_AUTHORIZED_SNAPSHOT_KEYS) ||
        !hasExactOwnKeys(left.data, ['tracks']) ||
        !hasExactOwnKeys(right.data, ['tracks']) ||
        left.action !== right.action ||
        left.tabId !== right.tabId ||
        left.videoId !== right.videoId ||
        left.targetLanguage !== right.targetLanguage ||
        left.originalLanguage !== right.originalLanguage ||
        left.useNativeSubtitles !== right.useNativeSubtitles ||
        left.useOfficialTranslations !== right.useOfficialTranslations ||
        left.data.tracks.length !== right.data.tracks.length
    ) {
        return false;
    }

    for (let index = 0; index < left.data.tracks.length; index += 1) {
        if (
            !isSameNetflixTrack(
                left.data.tracks[index],
                right.data.tracks[index]
            )
        ) {
            return false;
        }
    }
    return true;
}

function isSameAuthorizedSubtitleRequest(left, right) {
    if (
        !isAuthorizedSubtitleRequestSnapshot(left) ||
        !isAuthorizedSubtitleRequestSnapshot(right) ||
        left.source !== right.source
    ) {
        return false;
    }

    if (left.source === SubtitleRequestSources.DISNEY_PLUS) {
        return (
            hasExactOwnKeys(left, DISNEY_AUTHORIZED_SNAPSHOT_KEYS) &&
            hasExactOwnKeys(right, DISNEY_AUTHORIZED_SNAPSHOT_KEYS) &&
            left.action === right.action &&
            left.tabId === right.tabId &&
            left.videoId === right.videoId &&
            left.url === right.url &&
            left.targetLanguage === right.targetLanguage &&
            left.originalLanguage === right.originalLanguage
        );
    }

    if (left.source === SubtitleRequestSources.NETFLIX) {
        return isSameNetflixAuthorizedRequest(left, right);
    }

    return false;
}

function createSubtitleRequestLease(snapshot) {
    if (!isAuthorizedSubtitleRequestSnapshot(snapshot)) return null;
    return Object.freeze({
        frameId: 0,
        platform: snapshot.source,
        tabId: snapshot.tabId,
        videoId: snapshot.videoId,
    });
}

function subtitleRequestLeasesEqual(left, right) {
    return Boolean(
        left &&
        right &&
        left.frameId === right.frameId &&
        left.platform === right.platform &&
        left.tabId === right.tabId &&
        left.videoId === right.videoId
    );
}

/**
 * Read an own data property without executing an accessor.
 *
 * @param {object} object
 * @param {PropertyKey} key
 * @returns {unknown}
 */
function getOwnDataProperty(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
        !descriptor ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
        throw new TypeError('Expected an own data property');
    }
    return descriptor.value;
}

function getOptionalOwnDataProperty(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return undefined;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError('Expected an own data property');
    }
    return descriptor.value;
}

function readInternalSubtitleSignal(options, invalidInputMessage) {
    if (options === undefined) return undefined;
    if (
        options === null ||
        (typeof options !== 'object' && typeof options !== 'function')
    ) {
        throw new TypeError(invalidInputMessage);
    }

    let descriptor;
    try {
        descriptor = Object.getOwnPropertyDescriptor(options, 'signal');
    } catch (_) {
        throw new TypeError(invalidInputMessage);
    }
    if (!descriptor) return undefined;
    if (!Object.hasOwn(descriptor, 'value')) {
        throw new TypeError(invalidInputMessage);
    }
    return descriptor.value;
}

function normalizeRetryAfter(resetTime, now) {
    if (
        typeof resetTime !== 'number' ||
        !Number.isFinite(resetTime) ||
        resetTime < now
    ) {
        return null;
    }
    const retryAfter = Math.ceil(resetTime - now);
    return Number.isSafeInteger(retryAfter) &&
        retryAfter >= 0 &&
        retryAfter <= MAX_TRANSLATION_RETRY_AFTER_MS
        ? retryAfter
        : null;
}

function getRateLimitRetryAfter(resetTimes) {
    const now = Date.now();
    const applicableResetTimes = resetTimes.filter(
        (resetTime) =>
            typeof resetTime === 'number' &&
            Number.isFinite(resetTime) &&
            resetTime >= now
    );
    if (applicableResetTimes.length === 0) {
        return null;
    }
    return normalizeRetryAfter(Math.max(...applicableResetTimes), now);
}

function getTranslationFailureMetadata(error) {
    const safeDefault = { retryable: false, retryAfter: null };
    try {
        const metadata = getTrustedTranslationFailureMetadata(error);
        if (!metadata) {
            return safeDefault;
        }
        if (
            metadata.resetTimes !== null &&
            !Array.isArray(metadata.resetTimes)
        ) {
            return safeDefault;
        }
        return {
            retryable: metadata.retryable === true,
            retryAfter:
                metadata.resetTimes === null
                    ? null
                    : getRateLimitRetryAfter(metadata.resetTimes),
        };
    } catch (_) {
        return safeDefault;
    }
}

function getSafeDisneySubtitleFailureMetadata(error) {
    try {
        const metadata = getDisneySubtitleFailureMetadata(error);
        if (
            metadata &&
            ALLOWED_DISNEY_SUBTITLE_FAILURES.get(metadata.stage) ===
                metadata.errorCode
        ) {
            return metadata;
        }
    } catch (_) {}
    return UNKNOWN_DISNEY_SUBTITLE_FAILURE;
}

function getSafeProcessingTime(startedAt) {
    const elapsed = Date.now() - startedAt;
    return Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : 0;
}

function getSubtitleDisplayName(result, sourceLanguage) {
    const availableLanguages = getOptionalOwnDataProperty(
        result,
        'availableLanguages'
    );
    if (availableLanguages === undefined) return sourceLanguage;
    if (!Array.isArray(availableLanguages)) {
        throw new TypeError('Subtitle processing result is invalid');
    }

    const length = getOwnDataProperty(availableLanguages, 'length');
    if (!Number.isSafeInteger(length) || length < 0) {
        throw new TypeError('Subtitle processing result is invalid');
    }

    for (let index = 0; index < length; index += 1) {
        const language = getOwnDataProperty(availableLanguages, String(index));
        if (!language || typeof language !== 'object') {
            throw new TypeError('Subtitle processing result is invalid');
        }
        const languagePrototype = Object.getPrototypeOf(language);
        if (
            languagePrototype !== Object.prototype &&
            languagePrototype !== null
        ) {
            throw new TypeError('Subtitle processing result is invalid');
        }
        const normalizedCode = getOwnDataProperty(language, 'normalizedCode');
        if (typeof normalizedCode !== 'string') {
            throw new TypeError('Subtitle processing result is invalid');
        }
        if (normalizedCode !== sourceLanguage) continue;

        const displayName = getOwnDataProperty(language, 'displayName');
        if (typeof displayName !== 'string') {
            throw new TypeError('Subtitle processing result is invalid');
        }
        return displayName;
    }

    return sourceLanguage;
}

function createSubtitleSuccessResponse(result, videoId) {
    if (!result || typeof result !== 'object') {
        throw new TypeError('Subtitle processing result is invalid');
    }
    const resultPrototype = Object.getPrototypeOf(result);
    if (resultPrototype !== Object.prototype && resultPrototype !== null) {
        throw new TypeError('Subtitle processing result is invalid');
    }
    const vttText = getOwnDataProperty(result, 'vttText');
    const targetVttText = getOwnDataProperty(result, 'targetVttText');
    const sourceLanguage = getOwnDataProperty(result, 'sourceLanguage');
    const targetLanguage = getOwnDataProperty(result, 'targetLanguage');
    const useNativeTarget = getOwnDataProperty(result, 'useNativeTarget');
    if (
        typeof vttText !== 'string' ||
        (targetVttText !== null && typeof targetVttText !== 'string') ||
        typeof sourceLanguage !== 'string' ||
        typeof targetLanguage !== 'string' ||
        typeof useNativeTarget !== 'boolean'
    ) {
        throw new TypeError('Subtitle processing result is invalid');
    }

    const displayName = getSubtitleDisplayName(result, sourceLanguage);

    return {
        success: true,
        vttText,
        targetVttText,
        videoId,
        sourceLanguage,
        targetLanguage,
        useNativeTarget,
        selectedLanguage: {
            normalizedCode: sourceLanguage,
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

function createSubtitleSuccessResponseForRecipient(response) {
    return {
        success: true,
        vttText: response.vttText,
        targetVttText: response.targetVttText,
        videoId: response.videoId,
        sourceLanguage: response.sourceLanguage,
        targetLanguage: response.targetLanguage,
        useNativeTarget: response.useNativeTarget,
        selectedLanguage: {
            normalizedCode: response.selectedLanguage.normalizedCode,
            displayName: response.selectedLanguage.displayName,
        },
    };
}

function createSubtitleResponseForRecipient(response) {
    if (response?.success === true) {
        return createSubtitleSuccessResponseForRecipient(response);
    }
    if (response?.success === false && Object.hasOwn(response, 'videoId')) {
        if (response.error === SUBTITLE_PROCESSING_FAILURE_ERROR) {
            return createSubtitleProcessingFailureResponse(response.videoId);
        }
        if (response.error === SUBTITLE_SERVICE_UNAVAILABLE_ERROR) {
            return createSubtitleServiceUnavailableResponse(response.videoId);
        }
    }
    return response;
}

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

function createSelectionSenderSnapshot(identity) {
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

function normalizeAnalyzeServiceResult(senderRole, request, result) {
    try {
        if (getOwnDataProperty(result, 'success') !== true) {
            return {
                success: false,
                shouldRetry:
                    getOptionalOwnDataProperty(result, 'shouldRetry') === true,
            };
        }

        const response = buildAnalyzeContextSuccessResponse(
            senderRole,
            request,
            { analysis: getOwnDataProperty(result, 'analysis') }
        );
        return { success: true, analysis: response.result.analysis };
    } catch (_) {
        return { success: false, shouldRetry: false };
    }
}

/**
 * @typedef {'translate'|'fetchVTT'|'analyzeContext'|'ping'|'checkBackgroundReady'} MessageAction
 */

/**
 * @typedef {Object} IncomingMessage
 * @property {MessageAction} action
 * @property {string} [text]
 * @property {string} [targetLang]
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
     * @param {IncomingMessage} message
     */
    static validateMessagePayload(
        message,
        pinnedAction = UNPINNED_MESSAGE_ACTION
    ) {
        if (!message || typeof message !== 'object') {
            return { valid: false, error: 'Invalid message object' };
        }
        let action = pinnedAction;
        if (action === UNPINNED_MESSAGE_ACTION) {
            try {
                action = getOwnDataProperty(message, 'action');
            } catch (_) {
                return { valid: false, error: 'Missing or invalid action' };
            }
        }
        if (!action || typeof action !== 'string') {
            return { valid: false, error: 'Missing or invalid action' };
        }
        switch (action) {
            case MessageActions.TRANSLATE: {
                const request = parseTranslationRequestMessage(message);
                if (!request) {
                    return {
                        valid: false,
                        error: 'Invalid translation request',
                    };
                }
                return { valid: true, action, request };
            }
            case MessageActions.FETCH_VTT:
                // Runtime FETCH_VTT messages are validated and copied by the
                // subtitle request policy before they reach generic dispatch.
                // Direct calls must reach the private-brand gate without
                // traversing attacker-controlled URL or track properties.
                break;
            default:
                // For other actions, do minimal validation
                break;
        }
        return { valid: true, action };
    }

    constructor() {
        this.logger = null;
        this.translationService = null;
        this.subtitleService = null;
        this.aiContextService = null;
        this.sidePanelService = null;
        this.serviceReadiness = null;
        this.runtimeMessageListener = null;
        this.subtitleRequestFlights = new Set();
        this.translationReadinessFlights = new Set();
        this.analyzeContextFlights = new Set();
        this.lifecycleEpoch = 0;
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

        const listenerEpoch = this.lifecycleEpoch + 1;
        this.lifecycleEpoch = listenerEpoch;

        this.logger = loggingManager.createLogger('MessageHandler');

        this.runtimeMessageListener = (message, sender, sendResponse) => {
            if (!this.isInitialized || this.lifecycleEpoch !== listenerEpoch) {
                const staleAction = readProtocolMessageAction(message);
                if (staleAction === MessageActions.SIDEPANEL_SELECTION_SYNC) {
                    return this.handleSidePanelSelectionSyncIngress(
                        message,
                        sender,
                        sendResponse,
                        listenerEpoch
                    );
                }
                if (staleAction === MessageActions.SIDEPANEL_WORD_SELECTED) {
                    return this.handleSidePanelWordIntentIngress(
                        message,
                        sender,
                        sendResponse,
                        listenerEpoch
                    );
                }
                sendResponseSafely(
                    sendResponse,
                    SUBTITLE_REQUEST_REJECTED_RESPONSE
                );
                return false;
            }

            const action = readProtocolMessageAction(message);
            if (!action) {
                sendResponseSafely(sendResponse, INVALID_MESSAGE_RESPONSE);
                return false;
            }
            if (action === MessageActions.FETCH_VTT) {
                return this.handleSubtitleRequestIngress(
                    message,
                    sender,
                    sendResponse,
                    listenerEpoch
                );
            }
            if (action === MessageActions.TRANSLATE) {
                return this.handleTranslationRequestIngress(
                    message,
                    sender,
                    sendResponse,
                    listenerEpoch
                );
            }
            if (action === MessageActions.ANALYZE_CONTEXT) {
                return this.handleAnalyzeContextRequestIngress(
                    message,
                    sender,
                    sendResponse,
                    listenerEpoch
                );
            }
            if (action === MessageActions.SIDEPANEL_SELECTION_SYNC) {
                return this.handleSidePanelSelectionSyncIngress(
                    message,
                    sender,
                    sendResponse,
                    listenerEpoch
                );
            }
            if (action === MessageActions.SIDEPANEL_WORD_SELECTED) {
                return this.handleSidePanelWordIntentIngress(
                    message,
                    sender,
                    sendResponse,
                    listenerEpoch
                );
            }
            if (
                action === MessageActions.PING ||
                action === MessageActions.CHECK_BACKGROUND_READY
            ) {
                return this.handleBackgroundReadinessIngress(
                    message,
                    sender,
                    sendResponse
                );
            }

            if (!this.serviceReadiness || this.serviceReadiness.isReady()) {
                return this.handleMessage(
                    message,
                    sender,
                    sendResponse,
                    action
                );
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
                        deferredSendResponse,
                        action
                    );
                    if (keepsChannelOpen !== true && !responded) {
                        sendResponse();
                    }
                })
                .catch((error) => {
                    this.logger.error(
                        'Background services failed before message handling',
                        error,
                        { action }
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

    handleTranslationRequestIngress(
        message,
        sender,
        sendResponse,
        listenerEpoch = this.lifecycleEpoch
    ) {
        const request = parseTranslationRequestMessage(message);
        if (!request) {
            // Inexact records have no trusted cue identity to echo. Return the
            // generic fixed rejection without inspecting individual fields;
            // sender rejections below can use the detached request envelope.
            sendResponseSafely(sendResponse, INVALID_MESSAGE_RESPONSE);
            return false;
        }

        const classifiedSender = classifyExtensionMessageSender(sender);
        const senderSnapshot = classifiedSender
            ? Object.freeze({ role: classifiedSender.role })
            : null;
        if (senderSnapshot?.role !== MessageSenderRoles.CONTENT) {
            sendResponseSafely(
                sendResponse,
                buildTranslationFailureResponse(request, {
                    retryable: false,
                    retryAfter: null,
                })
            );
            return false;
        }

        if (!this.isInitialized || this.lifecycleEpoch !== listenerEpoch) {
            sendResponseSafely(
                sendResponse,
                buildTranslationFailureResponse(request, {
                    retryable: false,
                    retryAfter: null,
                })
            );
            return false;
        }

        if (!this.serviceReadiness || this.serviceReadiness.isReady()) {
            return this.handleTranslateMessage(request, sendResponse);
        }

        const flight = {
            accepting: true,
            listenerEpoch,
            request,
            responder: sendResponse,
            sender: senderSnapshot,
        };
        this.translationReadinessFlights.add(flight);
        this.serviceReadiness
            .waitUntilReady()
            .then(() => {
                if (!flight.accepting) return;
                if (
                    !this.isInitialized ||
                    this.lifecycleEpoch !== flight.listenerEpoch ||
                    flight.sender.role !== MessageSenderRoles.CONTENT
                ) {
                    this.settleTranslationReadinessFlight(
                        flight,
                        buildTranslationFailureResponse(flight.request, {
                            retryable: false,
                            retryAfter: null,
                        })
                    );
                    return;
                }

                flight.accepting = false;
                this.translationReadinessFlights.delete(flight);
                this.handleTranslateMessage(flight.request, flight.responder);
            })
            .catch(() => {
                if (!flight.accepting) return;
                try {
                    this.logger?.error(
                        'Background services unavailable before translation handling',
                        { action: MessageActions.TRANSLATE }
                    );
                } catch (_) {}
                this.settleTranslationReadinessFlight(
                    flight,
                    buildTranslationFailureResponse(flight.request, {
                        retryable: false,
                        retryAfter: null,
                    })
                );
            });

        return true;
    }

    settleTranslationReadinessFlight(flight, response) {
        if (!flight.accepting) return;
        flight.accepting = false;
        this.translationReadinessFlights.delete(flight);
        sendResponseSafely(flight.responder, response);
        flight.request = null;
        flight.responder = null;
        flight.sender = null;
    }

    handleAnalyzeContextRequestIngress(
        message,
        sender,
        sendResponse,
        listenerEpoch = this.lifecycleEpoch
    ) {
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

        if (!this.isInitialized || this.lifecycleEpoch !== listenerEpoch) {
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
            accepting: true,
            listenerEpoch,
            request,
            responder: sendResponse,
            sender: senderSnapshot,
        };
        this.analyzeContextFlights.add(flight);

        if (!this.serviceReadiness || this.serviceReadiness.isReady()) {
            this.startAnalyzeContextFlight(flight);
            return true;
        }

        this.serviceReadiness
            .waitUntilReady()
            .then(() => this.startAnalyzeContextFlight(flight))
            .catch(() => {
                if (!flight.accepting) return;
                try {
                    this.logger?.error(
                        'Background services unavailable before context analysis',
                        { action: MessageActions.ANALYZE_CONTEXT }
                    );
                } catch (_) {}
                this.failAnalyzeContextFlight(
                    flight,
                    ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                    false
                );
            });

        return true;
    }

    handleSidePanelSelectionSyncIngress(
        message,
        sender,
        sendResponse,
        listenerEpoch = this.lifecycleEpoch
    ) {
        const senderSnapshot = createSelectionSenderSnapshot(
            classifyExtensionMessageSender(sender)
        );
        const snapshot = parseSidePanelContentSelectionSnapshotMessage(message);
        let accepted = false;

        if (
            senderSnapshot &&
            snapshot &&
            this.isInitialized &&
            this.lifecycleEpoch === listenerEpoch &&
            typeof this.sidePanelService?.acceptSelectionSnapshot === 'function'
        ) {
            try {
                accepted =
                    this.sidePanelService.acceptSelectionSnapshot(
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

    isCurrentAnalyzeContextFlight(flight) {
        return Boolean(
            flight?.accepting &&
            this.analyzeContextFlights.has(flight) &&
            this.isInitialized &&
            this.lifecycleEpoch === flight.listenerEpoch
        );
    }

    startAnalyzeContextFlight(flight) {
        if (!flight?.accepting) return;
        if (!this.isCurrentAnalyzeContextFlight(flight)) {
            this.failAnalyzeContextFlight(
                flight,
                ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                false
            );
            return;
        }
        if (!this.aiContextService) {
            this.failAnalyzeContextFlight(
                flight,
                ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                false
            );
            return;
        }

        this.analyzeRequestedContextTypes(flight)
            .then((result) => {
                if (!flight.accepting) return;
                if (!this.isCurrentAnalyzeContextFlight(flight)) {
                    this.failAnalyzeContextFlight(
                        flight,
                        ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                        false
                    );
                    return;
                }

                if (result.success !== true) {
                    this.failAnalyzeContextFlight(
                        flight,
                        ANALYZE_CONTEXT_FAILED_ERROR,
                        result.shouldRetry === true
                    );
                    return;
                }

                let response;
                try {
                    response = buildAnalyzeContextSuccessResponse(
                        flight.sender.role,
                        flight.request,
                        { analysis: result.analysis }
                    );
                } catch (_) {
                    this.failAnalyzeContextFlight(
                        flight,
                        ANALYZE_CONTEXT_FAILED_ERROR,
                        false
                    );
                    return;
                }
                this.settleAnalyzeContextFlight(flight, response);
            })
            .catch(() => {
                if (!flight.accepting) return;
                try {
                    this.logger?.error('Context analysis failed', {
                        action: MessageActions.ANALYZE_CONTEXT,
                    });
                } catch (_) {}
                this.failAnalyzeContextFlight(
                    flight,
                    this.isCurrentAnalyzeContextFlight(flight)
                        ? ANALYZE_CONTEXT_FAILED_ERROR
                        : ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                    false
                );
            });
    }

    failAnalyzeContextFlight(flight, error, shouldRetry) {
        if (!flight?.accepting) return;
        const response = buildAnalyzeContextFailureResponse(
            flight.sender.role,
            flight.request,
            { error, shouldRetry: shouldRetry === true }
        );
        this.settleAnalyzeContextFlight(flight, response);
    }

    settleAnalyzeContextFlight(flight, response) {
        if (!flight?.accepting) return;
        flight.accepting = false;
        this.analyzeContextFlights.delete(flight);
        const responder = flight.responder;
        flight.request = null;
        flight.responder = null;
        flight.sender = null;
        sendResponseSafely(responder, response);
    }

    handleSubtitleRequestIngress(
        message,
        sender,
        sendResponse,
        listenerEpoch = this.lifecycleEpoch
    ) {
        let snapshot;
        try {
            snapshot = authorizeSubtitleRequest(message, sender);
        } catch (_) {
            try {
                this.logger?.warn('Subtitle request rejected', {
                    stage: 'authorize',
                });
            } catch (_) {}
            sendResponseSafely(
                sendResponse,
                SUBTITLE_REQUEST_REJECTED_RESPONSE
            );
            return false;
        }

        if (!this.isInitialized || this.lifecycleEpoch !== listenerEpoch) {
            try {
                this.logger?.warn('Subtitle request rejected', {
                    stage: 'lifecycle',
                });
            } catch (_) {}
            sendResponseSafely(
                sendResponse,
                SUBTITLE_REQUEST_REJECTED_RESPONSE
            );
            return false;
        }

        return this.admitAuthorizedSubtitleRequest(snapshot, sendResponse);
    }

    admitAuthorizedSubtitleRequest(snapshot, sendResponse) {
        if (
            !this.isInitialized ||
            !isAuthorizedSubtitleRequestSnapshot(snapshot)
        ) {
            sendResponseSafely(
                sendResponse,
                SUBTITLE_REQUEST_REJECTED_RESPONSE
            );
            return false;
        }

        for (const flight of this.subtitleRequestFlights) {
            if (
                flight.accepting &&
                isSameAuthorizedSubtitleRequest(flight.snapshot, snapshot)
            ) {
                if (
                    flight.responders.length >=
                    MAX_SUBTITLE_RESPONDERS_PER_FLIGHT
                ) {
                    return this.rejectSubtitleRequestAtCapacity(
                        snapshot,
                        sendResponse,
                        'responders',
                        flight.responders.length
                    );
                }
                flight.responders.push(sendResponse);
                return true;
            }
        }

        const lease = createSubtitleRequestLease(snapshot);
        if (!lease) {
            sendResponseSafely(
                sendResponse,
                SUBTITLE_REQUEST_REJECTED_RESPONSE
            );
            return false;
        }
        for (const flight of [...this.subtitleRequestFlights]) {
            if (
                flight.accepting &&
                subtitleRequestLeasesEqual(flight.lease, lease)
            ) {
                this.supersedeSubtitleRequestFlight(flight);
            }
        }

        let partitionCount = 0;
        for (const flight of this.subtitleRequestFlights) {
            if (
                flight.accepting &&
                flight.snapshot.tabId === snapshot.tabId &&
                flight.snapshot.source === snapshot.source
            ) {
                partitionCount += 1;
            }
        }
        if (partitionCount >= MAX_SUBTITLE_FLIGHTS_PER_TAB_SOURCE) {
            return this.rejectSubtitleRequestAtCapacity(
                snapshot,
                sendResponse,
                'tab-source',
                partitionCount
            );
        }
        if (this.subtitleRequestFlights.size >= MAX_SUBTITLE_FLIGHTS_GLOBAL) {
            return this.rejectSubtitleRequestAtCapacity(
                snapshot,
                sendResponse,
                'global',
                this.subtitleRequestFlights.size
            );
        }

        const flight = {
            abortController: new AbortController(),
            snapshot,
            lease,
            responders: [sendResponse],
            accepting: true,
            cancelled: false,
            serviceStarted: false,
            promise: null,
        };
        this.subtitleRequestFlights.add(flight);

        let operation;
        try {
            operation = this.handleAuthorizedSubtitleRequestWhenReady(flight);
        } catch (_) {
            operation = Promise.reject();
        }
        const flightPromise = Promise.resolve(operation)
            .catch(() => SUBTITLE_REQUEST_REJECTED_RESPONSE)
            .then((response) => {
                this.settleSubtitleRequestFlight(flight, response);
                return response;
            });
        if (
            flight.cancelled ||
            !flight.accepting ||
            !this.subtitleRequestFlights.has(flight)
        ) {
            flight.promise = null;
        } else {
            flight.promise = flightPromise;
        }

        return true;
    }

    rejectSubtitleRequestAtCapacity(snapshot, sendResponse, scope, count) {
        try {
            this.logger?.warn('Subtitle request capacity reached', {
                stage: 'admission',
                scope,
                tabId: snapshot.tabId,
                source: snapshot.source,
                count,
            });
        } catch (_) {}
        sendResponseSafely(sendResponse, SUBTITLE_REQUEST_REJECTED_RESPONSE);
        return false;
    }

    handleAuthorizedSubtitleRequestWhenReady(flight) {
        let readinessOperation;
        try {
            readinessOperation =
                !this.serviceReadiness || this.serviceReadiness.isReady()
                    ? Promise.resolve()
                    : this.serviceReadiness.waitUntilReady();
        } catch (_) {
            readinessOperation = Promise.reject();
        }

        return Promise.resolve(readinessOperation).then(
            () => {
                if (flight.cancelled) {
                    return SUBTITLE_READINESS_FAILURE_RESPONSE;
                }
                const snapshot = flight.snapshot;
                if (!isAuthorizedSubtitleRequestSnapshot(snapshot)) {
                    return SUBTITLE_REQUEST_REJECTED_RESPONSE;
                }
                flight.serviceStarted = true;
                return this.createAuthorizedFetchVTTResponse(snapshot, {
                    signal: flight.abortController.signal,
                });
            },
            () => {
                if (flight.cancelled) {
                    return SUBTITLE_READINESS_FAILURE_RESPONSE;
                }
                const snapshot = flight.snapshot;
                try {
                    this.logger?.error(
                        'Background services unavailable for subtitle request',
                        null,
                        {
                            stage: 'readiness',
                            tabId: snapshot.tabId,
                            source: snapshot.source,
                        }
                    );
                } catch (_) {}
                return SUBTITLE_READINESS_FAILURE_RESPONSE;
            }
        );
    }

    createAuthorizedFetchVTTResponse(snapshot, options) {
        if (!isAuthorizedSubtitleRequestSnapshot(snapshot)) {
            return Promise.resolve(SUBTITLE_REQUEST_REJECTED_RESPONSE);
        }

        if (!this.subtitleService) {
            try {
                this.logger?.error('Subtitle service not available');
            } catch (_) {}
            return Promise.resolve(
                createSubtitleServiceUnavailableResponse(snapshot.videoId)
            );
        }

        if (snapshot.source === SubtitleRequestSources.NETFLIX) {
            return this.createNetflixVTTResponse(snapshot, options);
        }
        if (snapshot.source === SubtitleRequestSources.DISNEY_PLUS) {
            return this.createGenericVTTResponse(snapshot, options);
        }
        return Promise.resolve(SUBTITLE_REQUEST_REJECTED_RESPONSE);
    }

    settleSubtitleRequestFlight(flight, response) {
        if (!flight.accepting) return;
        flight.accepting = false;
        this.subtitleRequestFlights.delete(flight);
        const responders = flight.responders.splice(0);
        flight.abortController = null;
        flight.lease = null;
        flight.snapshot = null;
        flight.promise = null;
        for (const responder of responders) {
            sendResponseSafely(
                responder,
                createSubtitleResponseForRecipient(response)
            );
        }
    }

    supersedeSubtitleRequestFlight(flight) {
        if (!flight?.accepting) return false;
        const abortController = flight.abortController;
        flight.cancelled = true;
        flight.accepting = false;
        this.subtitleRequestFlights.delete(flight);
        const responders = flight.responders.splice(0);
        flight.abortController = null;
        flight.lease = null;
        flight.snapshot = null;
        flight.promise = null;
        try {
            abortController?.abort();
        } catch (_) {}
        for (const responder of responders) {
            sendResponseSafely(
                responder,
                createSubtitleResponseForRecipient(
                    SUBTITLE_REQUEST_REJECTED_RESPONSE
                )
            );
        }
        return true;
    }

    destroy() {
        this.lifecycleEpoch += 1;
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
        for (const flight of this.subtitleRequestFlights) {
            if (!flight.serviceStarted) {
                flight.cancelled = true;
                this.settleSubtitleRequestFlight(
                    flight,
                    SUBTITLE_READINESS_FAILURE_RESPONSE
                );
            }
        }
        this.subtitleRequestFlights.clear();
        for (const flight of this.translationReadinessFlights) {
            this.settleTranslationReadinessFlight(
                flight,
                buildTranslationFailureResponse(flight.request, {
                    retryable: false,
                    retryAfter: null,
                })
            );
        }
        this.translationReadinessFlights.clear();
        for (const flight of this.analyzeContextFlights) {
            this.failAnalyzeContextFlight(
                flight,
                ANALYZE_CONTEXT_UNAVAILABLE_ERROR,
                false
            );
        }
        this.analyzeContextFlights.clear();
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

    handleSidePanelWordIntentIngress(
        message,
        sender,
        sendResponse,
        listenerEpoch = this.lifecycleEpoch
    ) {
        const intent = parseSidePanelWordIntentMessage(message);
        const senderSnapshot = createSelectionSenderSnapshot(
            classifyExtensionMessageSender(sender)
        );
        if (
            !intent ||
            !senderSnapshot ||
            !this.isInitialized ||
            this.lifecycleEpoch !== listenerEpoch ||
            typeof this.sidePanelService?.openSidePanelImmediate !== 'function'
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
                this.sidePanelService.openSidePanelImmediate(
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

        operation
            .then((result) => {
                sendResponseSafely(
                    sendResponse,
                    result?.success === true
                        ? SIDEPANEL_WORD_INTENT_ACCEPTED_RESPONSE
                        : SIDEPANEL_WORD_INTENT_REJECTED_RESPONSE
                );
            })
            .catch(() => {
                sendResponseSafely(
                    sendResponse,
                    SIDEPANEL_WORD_INTENT_REJECTED_RESPONSE
                );
            });
        return true;
    }

    /**
     * Handle incoming messages from content scripts
     * @param {Object} message - The message object
     * @param {Object} sender - The sender information
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} True if response is async
     */
    handleMessage(
        message,
        sender,
        sendResponse,
        pinnedAction = UNPINNED_MESSAGE_ACTION
    ) {
        const validation = MessageHandler.validateMessagePayload(
            message,
            pinnedAction
        );
        if (!validation.valid) {
            try {
                this.logger?.warn('Invalid message payload', {
                    error: validation.error,
                });
            } catch (_) {}
            try {
                sendResponse({
                    success: false,
                    error: validation.error,
                });
            } catch (_) {}
            return false;
        }

        try {
            this.logger?.debug('Received message', {
                action: validation.action,
                tabId: sender?.tab?.id,
            });
        } catch (_) {}

        switch (validation.action) {
            case MessageActions.TRANSLATE:
                return this.handleTranslateMessage(
                    validation.request,
                    sendResponse
                );

            case MessageActions.FETCH_VTT:
                return this.handleAuthorizedFetchVTTMessage(
                    message,
                    sendResponse
                );

            case MessageActions.PING:
            case MessageActions.CHECK_BACKGROUND_READY:
                return this.handleBackgroundReadinessIngress(
                    message,
                    sender,
                    sendResponse
                );

            default:
                this.logger.warn('Unknown message action', {
                    action: validation.action,
                });
                return false;
        }
    }

    /**
     * Handle translation requests using service protocol
     */
    handleTranslateMessage(request, sendResponse) {
        if (!this.translationService) {
            sendResponseSafely(
                sendResponse,
                buildTranslationFailureResponse(request, {
                    retryable: false,
                    retryAfter: null,
                })
            );
            return true;
        }

        const { text, targetLang } = request;
        const startedAt = Date.now();
        let cached = false;
        let translationOperation;
        try {
            translationOperation = Promise.resolve(
                this.translationService.translate(text, 'auto', targetLang, {
                    _onCacheHit: () => {
                        cached = true;
                    },
                })
            );
        } catch (error) {
            translationOperation = Promise.reject(error);
        }

        translationOperation
            .then((translatedText) => {
                const response = buildTranslationSuccessResponse(request, {
                    translatedText,
                    cached,
                    processingTime: getSafeProcessingTime(startedAt),
                });

                sendResponseSafely(sendResponse, response);
            })
            .catch((error) => {
                const { retryable, retryAfter } =
                    getTranslationFailureMetadata(error);
                try {
                    this.logger?.error('Translation failed', {
                        textLength: text.length,
                        targetLang,
                        retryable,
                        retryAfter,
                    });
                } catch (_) {}

                sendResponseSafely(
                    sendResponse,
                    buildTranslationFailureResponse(request, {
                        retryable,
                        retryAfter,
                    })
                );
            });

        return true; // Async response
    }

    /**
     * Handle VTT fetching requests
     */
    handleAuthorizedFetchVTTMessage(message, sendResponse) {
        if (!isAuthorizedSubtitleRequestSnapshot(message)) {
            sendResponseSafely(
                sendResponse,
                SUBTITLE_REQUEST_REJECTED_RESPONSE
            );
            return false;
        }

        this.createAuthorizedFetchVTTResponse(message)
            .then((response) => sendResponseSafely(sendResponse, response))
            .catch(() =>
                sendResponseSafely(
                    sendResponse,
                    SUBTITLE_REQUEST_REJECTED_RESPONSE
                )
            );

        return true; // Async response
    }

    /**
     * Handle Netflix-specific VTT requests using service protocol
     */
    createNetflixVTTResponse(snapshot, options) {
        if (
            !isAuthorizedSubtitleRequestSnapshot(snapshot) ||
            snapshot.source !== SubtitleRequestSources.NETFLIX
        ) {
            return Promise.resolve(SUBTITLE_REQUEST_REJECTED_RESPONSE);
        }

        const { videoId } = snapshot;

        let serviceOperation;
        try {
            const signal = readInternalSubtitleSignal(
                options,
                'Netflix subtitle processing input is invalid.'
            );
            serviceOperation = Promise.resolve(
                signal === undefined
                    ? this.subtitleService.processNetflixSubtitles(snapshot)
                    : this.subtitleService.processNetflixSubtitles(snapshot, {
                          signal,
                      })
            );
        } catch (error) {
            serviceOperation = Promise.reject(error);
        }

        return serviceOperation
            .then((result) => {
                return createSubtitleSuccessResponse(result, videoId);
            })
            .catch(() => {
                try {
                    this.logger?.error('Netflix VTT processing failed', null, {
                        stage: 'process',
                        source: SubtitleRequestSources.NETFLIX,
                        hasVideoId:
                            typeof videoId === 'string' && videoId.length > 0,
                    });
                } catch (_) {}

                return createSubtitleProcessingFailureResponse(videoId);
            })
            .catch(() => createSubtitleProcessingFailureResponse(videoId));
    }

    /**
     * Handle generic VTT requests
     */
    createGenericVTTResponse(snapshot, options) {
        if (
            !isAuthorizedSubtitleRequestSnapshot(snapshot) ||
            snapshot.source !== SubtitleRequestSources.DISNEY_PLUS
        ) {
            return Promise.resolve(SUBTITLE_REQUEST_REJECTED_RESPONSE);
        }

        const { videoId } = snapshot;

        let serviceOperation;
        try {
            const signal = readInternalSubtitleSignal(
                options,
                'Disney subtitle processing input is invalid.'
            );
            serviceOperation = Promise.resolve(
                signal === undefined
                    ? this.subtitleService.processDisneyPlusSubtitles(snapshot)
                    : this.subtitleService.processDisneyPlusSubtitles(
                          snapshot,
                          {
                              signal,
                          }
                      )
            );
        } catch (error) {
            serviceOperation = Promise.reject(error);
        }

        return serviceOperation
            .then((result) => {
                return createSubtitleSuccessResponse(result, videoId);
            })
            .catch((error) => {
                const failure = getSafeDisneySubtitleFailureMetadata(error);
                try {
                    this.logger?.error('Disney VTT processing failed', null, {
                        stage: failure.stage,
                        errorCode: failure.errorCode,
                        source: SubtitleRequestSources.DISNEY_PLUS,
                        hasVideoId:
                            typeof videoId === 'string' && videoId.length > 0,
                    });
                } catch (_) {}
                return createSubtitleProcessingFailureResponse(videoId);
            })
            .catch(() => createSubtitleProcessingFailureResponse(videoId));
    }

    async analyzeRequestedContextTypes(flight) {
        const { request, sender } = flight;
        const metadata = createAnalyzeMetadata(request, sender);
        const analyzeOne = async (contextType) => {
            if (!this.isCurrentAnalyzeContextFlight(flight)) {
                throw new Error(ANALYZE_CONTEXT_UNAVAILABLE_ERROR);
            }
            const rawResult = await this.aiContextService.analyzeContext(
                request.text,
                contextType,
                metadata
            );
            if (!this.isCurrentAnalyzeContextFlight(flight)) {
                throw new Error(ANALYZE_CONTEXT_UNAVAILABLE_ERROR);
            }
            return normalizeAnalyzeServiceResult(
                sender.role,
                request,
                rawResult
            );
        };

        if (request.contextTypes.length === 1) {
            return analyzeOne(request.contextTypes[0]);
        }

        const requestsCanonicalFullSet =
            request.contextTypes.length === CONTEXT_TYPES.length &&
            CONTEXT_TYPES.every((type) => request.contextTypes.includes(type));
        if (requestsCanonicalFullSet) {
            return analyzeOne('all');
        }

        const resultsByType = {};
        for (const requestedType of request.contextTypes) {
            const result = await analyzeOne(requestedType);
            if (result.success !== true) return result;
            resultsByType[requestedType] = { analysis: result.analysis };
        }

        return {
            success: true,
            analysis: combineContextAnalyses(
                request.contextTypes,
                resultsByType
            ),
        };
    }

    handleBackgroundReadinessIngress(message, sender, sendResponse) {
        const classifiedSender = classifyExtensionMessageSender(sender);
        const request = parseBackgroundReadinessRequestMessage(
            message,
            classifiedSender?.role
        );
        if (!request || !this.isInitialized) {
            sendResponseSafely(sendResponse, INVALID_MESSAGE_RESPONSE);
            return false;
        }

        const services = {
            translation: Boolean(this.translationService),
            subtitle: Boolean(this.subtitleService),
            aiContext: Boolean(this.aiContextService),
            aiContextInitialized: Boolean(this.aiContextService?.isInitialized),
        };
        const ready =
            services.translation &&
            services.subtitle &&
            services.aiContext &&
            services.aiContextInitialized;
        this.logger.debug('Received background readiness request', {
            action: request.action,
            ready,
        });
        sendResponseSafely(
            sendResponse,
            buildBackgroundReadinessResponseMessage(request, {
                ready,
                services,
            })
        );
        return false;
    }
}

// Export singleton instance
export const messageHandler = new MessageHandler();
export { MessageHandler };
