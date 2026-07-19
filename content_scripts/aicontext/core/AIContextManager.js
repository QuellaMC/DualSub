/**
 * AI Context Manager - Core System Controller
 *
 * Central orchestrator for the AI context analysis system. Manages lifecycle,
 * coordinates between UI components, handlers, and providers, and maintains
 * system state across platform implementations.
 *
 * @author DualSub Extension - Modularization Architect
 * @version 2.0.0
 */

import { AI_CONTEXT_CONFIG, MODAL_STATES, EVENT_TYPES } from './constants.js';
import { AIContextModal } from '../ui/modal.js';
import { AIContextProvider } from '../providers/AIContextProvider.js';
import { TextSelectionHandler } from '../handlers/textSelection.js';
import {
    buildAnalyzeContextRequestMessage,
    MessageSenderRoles,
    parseAnalyzeContextResponseMessage,
} from '../../shared/protocol/messageProtocol.js';
import { AI_CONTEXT_SIGNAL_TYPES } from './AIContextChannel.js';
import Logger from '../../../utils/logger.js';

const TrustedPromise = Promise;
const TrustedMap = Map;
const TrustedSet = Set;
const trustedPromiseResolve = TrustedPromise.resolve.bind(TrustedPromise);
const trustedPromiseAllSettled = TrustedPromise.allSettled.bind(TrustedPromise);
const trustedPromiseThen = Function.prototype.call.bind(
    TrustedPromise.prototype.then
);
const trustedReflectApply = Reflect.apply;
const trustedArrayPush = Function.prototype.call.bind(Array.prototype.push);
const trustedQueueMicrotask =
    typeof globalThis.queueMicrotask === 'function'
        ? globalThis.queueMicrotask.bind(globalThis)
        : (callback) => {
              trustedPromiseThen(trustedPromiseResolve(), callback);
          };
const PRIVATE_MANAGER_STATES = new WeakMap();
const PRIVATE_CONTEXT_TYPES = Object.freeze([
    'cultural',
    'historical',
    'linguistic',
]);
const PRIVATE_CANCEL_REASONS = Object.freeze([
    'user',
    'superseded',
    'modal-closed',
    'selection-invalidated',
]);

function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function projectPrivateAnalysisAuthority(value) {
    try {
        if (!value || typeof value !== 'object') return null;
        const channel = value.channel;
        const allocateRequestId = value.allocateRequestId;
        const getSelectionSnapshot = value.getSelectionSnapshot;
        const clearSelection = value.clearSelection;
        if (
            !channel ||
            typeof channel.publish !== 'function' ||
            typeof channel.subscribe !== 'function' ||
            typeof allocateRequestId !== 'function' ||
            typeof getSelectionSnapshot !== 'function' ||
            typeof clearSelection !== 'function'
        ) {
            return null;
        }
        return Object.freeze({
            channel,
            allocateRequestId,
            getSelectionSnapshot,
            clearSelection,
        });
    } catch (_) {
        return null;
    }
}

function createPrivateManagerState(rawAuthority, requested) {
    return {
        requested,
        authority: projectPrivateAnalysisAuthority(rawAuthority),
        active: true,
        subscriptions: [],
        modalSubscriptions: new TrustedSet(),
        modalCapabilities: null,
        selectionSnapshot: null,
        pending: null,
        seenRequestIds: new TrustedSet(),
        resultLeases: new TrustedMap(),
        lastFailedRequest: null,
    };
}

function selectionIdentityMatches(left, right) {
    return Boolean(
        left &&
        right &&
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision
    );
}

function selectionSnapshotsMatch(left, right) {
    try {
        return Boolean(
            selectionIdentityMatches(left, right) &&
            left.reason === right.reason &&
            Array.isArray(left.entries) &&
            Array.isArray(right.entries) &&
            left.entries.length === right.entries.length &&
            left.entries.every(
                (entry, index) =>
                    entry.wordIndex === right.entries[index]?.wordIndex &&
                    entry.word === right.entries[index]?.word
            )
        );
    } catch (_) {
        return false;
    }
}

function copyPrivateContextTypes(value) {
    if (value === undefined) return [...PRIVATE_CONTEXT_TYPES];
    try {
        if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
            return null;
        }
        const copy = [];
        let previousIndex = -1;
        for (const contextType of value) {
            const canonicalIndex = PRIVATE_CONTEXT_TYPES.indexOf(contextType);
            if (canonicalIndex <= previousIndex) return null;
            copy.push(contextType);
            previousIndex = canonicalIndex;
        }
        return copy;
    } catch (_) {
        return null;
    }
}

function readPrivateLanguageProjection(value) {
    try {
        if (!value || typeof value !== 'object') return null;
        const keys = Reflect.ownKeys(value);
        if (
            keys.length !== 2 ||
            !keys.includes('targetLanguage') ||
            !keys.includes('originalLanguage')
        ) {
            return null;
        }
        const targetDescriptor = Object.getOwnPropertyDescriptor(
            value,
            'targetLanguage'
        );
        const originalDescriptor = Object.getOwnPropertyDescriptor(
            value,
            'originalLanguage'
        );
        const targetLanguage = targetDescriptor?.value;
        const originalLanguage = originalDescriptor?.value;
        if (
            targetDescriptor?.enumerable !== true ||
            originalDescriptor?.enumerable !== true ||
            typeof targetLanguage !== 'string' ||
            typeof originalLanguage !== 'string' ||
            targetLanguage.length === 0 ||
            originalLanguage.length === 0 ||
            targetLanguage !== targetLanguage.trim() ||
            originalLanguage !== originalLanguage.trim()
        ) {
            return null;
        }
        return Object.freeze({ targetLanguage, originalLanguage });
    } catch (_) {
        return null;
    }
}

/**
 * AIContextManager - Core system controller
 */
export class AIContextManager {
    constructor(platform, config = {}) {
        const analysisAuthority = config?.analysisAuthority;
        const managerConfig = { ...config };
        delete managerConfig.analysisAuthority;

        this.platform = platform;
        this.config = { ...AI_CONTEXT_CONFIG, ...managerConfig };
        this.initialized = false;
        this.features = new Map();
        this.components = new Map();
        this.eventListeners = new Map();

        this.contentScript = managerConfig.contentScript || null;
        this.logger =
            this.contentScript?.contentLogger ||
            Logger.create('AIContextManager');
        this.modal = null;
        this.provider = null;
        this.textHandler = null;

        this.currentState = MODAL_STATES.HIDDEN;
        this.activeRequest = null;
        this.enabledFeatures = new Set();

        // Performance monitoring
        this.metrics = {
            initializationTime: null,
            analysisCount: 0,
            errorCount: 0,
            lastActivity: null,
            componentInitTimes: {},
            eventCounts: {},
        };

        this._handleSystemError = this._handleSystemError.bind(this);
        this._handleAnalysisRequest = this._handleAnalysisRequest.bind(this);
        this._handleModalStateChange = this._handleModalStateChange.bind(this);

        // Early word-selection buffering for SPA navigation timing
        this.earlySelectionQueue = [];
        this._earlyWordSelectionListener = null;
        this._initializePromise = null;
        this._destroyStarted = false;
        this._destroyPromise = null;

        PRIVATE_MANAGER_STATES.set(
            this,
            createPrivateManagerState(
                analysisAuthority,
                analysisAuthority !== null && analysisAuthority !== undefined
            )
        );
    }

    /**
     * Initialize the AI Context system
     * @returns {Promise<boolean>} Success status
     */
    initialize() {
        if (this._destroyStarted) return trustedPromiseResolve(false);
        if (this._initializePromise) return this._initializePromise;

        this._initializePromise = trustedPromiseThen(
            trustedPromiseResolve(),
            () => this._performInitialize()
        );
        return this._initializePromise;
    }

    async _performInitialize() {
        if (this._destroyStarted) return false;
        const startTime = performance.now();

        try {
            this._log('info', 'Initializing AI Context Manager', {
                platform: this.platform,
                configKeys: Object.keys(this.config || {}),
                hasContentScript: Boolean(this.contentScript),
            });

            // Validate platform support
            if (!this._validatePlatform()) {
                throw new Error(`Platform '${this.platform}' is not supported`);
            }

            if (!this._setupPrivateAnalysisAuthority()) {
                throw new Error('Private analysis authority is invalid');
            }

            const componentsInitialized = await this._initializeComponents();
            if (this._destroyStarted) return false;
            if (componentsInitialized === false) {
                return this._rollbackFailedInitialization();
            }
            const coordinationReady = await this._setupEventCoordination();
            if (this._destroyStarted) return false;
            if (coordinationReady === false) {
                return this._rollbackFailedInitialization();
            }
            const defaultFeaturesEnabled = await this._enableDefaultFeatures();
            if (this._destroyStarted) return false;
            if (defaultFeaturesEnabled === false) {
                return this._rollbackFailedInitialization();
            }

            this.initialized = true;
            this.metrics.initializationTime = performance.now() - startTime;

            this._dispatchEvent(EVENT_TYPES.SYSTEM_INITIALIZED, {
                platform: this.platform,
                features: Array.from(this.enabledFeatures),
                initTime: this.metrics.initializationTime,
            });

            this._log('info', 'AI Context Manager initialized successfully', {
                initTime: this.metrics.initializationTime,
                features: Array.from(this.enabledFeatures),
            });

            return true;
        } catch (error) {
            if (this._destroyStarted) return false;
            console.error('AIContextManager initialization error:', error);
            this._handleSystemError(error, 'initialization');
            return this._rollbackFailedInitialization();
        }
    }

    async _rollbackFailedInitialization() {
        if (this._destroyStarted) return false;
        try {
            await this.destroy();
        } catch (_) {}
        return false;
    }

    /**
     * Enable a specific feature
     * @param {string} feature - Feature to enable
     * @returns {Promise<boolean>} Success status
     */
    async enableFeature(feature) {
        if (this._destroyStarted) return false;
        if (
            this._hasPrivateAnalysisAuthority() &&
            feature === AI_CONTEXT_CONFIG.FEATURES.TEXT_SELECTION
        ) {
            return false;
        }

        try {
            if (this.enabledFeatures.has(feature)) {
                this._log('debug', `Feature '${feature}' already enabled`);
                return true;
            }

            switch (feature) {
                case AI_CONTEXT_CONFIG.FEATURES.INTERACTIVE_SUBTITLES:
                    await this._enableInteractiveSubtitles();
                    break;
                case AI_CONTEXT_CONFIG.FEATURES.CONTEXT_MODAL:
                    await this._enableContextModal();
                    break;
                case AI_CONTEXT_CONFIG.FEATURES.TEXT_SELECTION:
                    await this._enableTextSelection();
                    break;
                default:
                    this._log('warn', `Unknown feature: ${feature}`);
                    return false;
            }

            if (this._destroyStarted) return false;
            this.enabledFeatures.add(feature);
            this._log('info', `Feature '${feature}' enabled`);
            return true;
        } catch (error) {
            if (this._destroyStarted) return false;
            this._log('error', `Failed to enable feature '${feature}'`, error);
            return false;
        }
    }

    /**
     * Get enabled features
     * @returns {Array<string>} List of enabled features
     */
    getEnabledFeatures() {
        return Array.from(this.enabledFeatures);
    }

    /**
     * Get component instances
     */
    getModal() {
        return this.modal;
    }
    getProvider() {
        return this.provider;
    }
    getTextHandler() {
        return this.textHandler;
    }

    /**
     * Cleanup and destroy the manager
     */
    destroy() {
        if (this._destroyPromise) {
            return this._destroyPromise;
        }

        let resolveDestroy;
        this._destroyPromise = new TrustedPromise((resolve) => {
            resolveDestroy = resolve;
        });
        this._destroyStarted = true;
        this._destroyPrivateAnalysisAuthority();

        let cleanupFailureCount = 0;
        const documentListeners = [...this.eventListeners.entries()];
        this.eventListeners.clear();
        const earlyWordSelectionListener = this._earlyWordSelectionListener;
        this._earlyWordSelectionListener = null;
        this.earlySelectionQueue.length = 0;

        for (const [event, listener] of documentListeners) {
            try {
                document.removeEventListener(event, listener);
            } catch (_) {
                cleanupFailureCount += 1;
            }
        }
        if (earlyWordSelectionListener) {
            try {
                document.removeEventListener(
                    'dualsub-word-selected',
                    earlyWordSelectionListener,
                    true
                );
            } catch (_) {
                cleanupFailureCount += 1;
            }
        }

        const ownedComponents = new Set([
            this.modal,
            this.provider,
            this.textHandler,
            ...this.components.values(),
        ]);
        ownedComponents.delete(null);
        ownedComponents.delete(undefined);

        const detachField = (key, value) => {
            try {
                this[key] = value;
            } catch (_) {
                // A hostile collaborator must not prevent other fields detaching.
            }
        };
        const detachFreshMap = (key) => {
            try {
                this[key] = new TrustedMap();
            } catch (_) {
                // Continue detaching fields independently.
            }
        };
        const detachFreshSet = (key) => {
            try {
                this[key] = new TrustedSet();
            } catch (_) {
                // Continue detaching fields independently.
            }
        };
        const detachManagerState = () => {
            detachField('modal', null);
            detachField('provider', null);
            detachField('textHandler', null);
            detachFreshMap('components');
            detachFreshMap('features');
            detachFreshMap('eventListeners');
            detachFreshSet('enabledFeatures');
            detachFreshSet('_inflightIds');
            detachField('earlySelectionQueue', []);
            detachField('_earlyWordSelectionListener', null);
            detachField('initialized', false);
            detachField('currentState', MODAL_STATES.HIDDEN);
            detachField('activeRequest', null);
            detachField('contentScript', null);
            detachField('config', null);
        };
        detachManagerState();

        const performDestroy = async () => {
            const cleanupPromises = [];
            try {
                for (const component of ownedComponents) {
                    let cleanupResult;
                    let cleanupReturned = false;
                    try {
                        const destroyComponent = component.destroy;
                        if (typeof destroyComponent !== 'function') {
                            continue;
                        }
                        cleanupResult = trustedReflectApply(
                            destroyComponent,
                            component,
                            []
                        );
                        cleanupReturned = true;
                    } catch (_) {
                        cleanupFailureCount += 1;
                    } finally {
                        detachManagerState();
                    }
                    if (cleanupReturned) {
                        try {
                            trustedArrayPush(
                                cleanupPromises,
                                trustedPromiseResolve(cleanupResult)
                            );
                        } catch (_) {
                            cleanupFailureCount += 1;
                        }
                    }
                }

                const cleanupResults =
                    await trustedPromiseAllSettled(cleanupPromises);
                for (let index = 0; index < cleanupResults.length; index += 1) {
                    if (cleanupResults[index].status === 'rejected') {
                        cleanupFailureCount += 1;
                    }
                }
            } catch (_) {
                cleanupFailureCount += 1;
            } finally {
                detachManagerState();

                try {
                    this._log(
                        cleanupFailureCount > 0 ? 'error' : 'info',
                        cleanupFailureCount > 0
                            ? 'AI Context Manager cleanup completed with failures'
                            : 'AI Context Manager destroyed',
                        cleanupFailureCount > 0 ? { cleanupFailureCount } : {}
                    );
                } catch (_) {
                    // Cleanup settlement must not depend on telemetry success.
                }
                detachField('logger', null);
            }
        };

        trustedPromiseThen(
            performDestroy(),
            () => resolveDestroy(),
            () => resolveDestroy()
        );
        return this._destroyPromise;
    }

    // Private methods

    _hasPrivateAnalysisAuthority() {
        const state = PRIVATE_MANAGER_STATES.get(this);
        return Boolean(state?.requested && state.authority);
    }

    _setupPrivateAnalysisAuthority() {
        const state = PRIVATE_MANAGER_STATES.get(this);
        if (!state?.requested) return true;
        if (!state.active || !state.authority) return false;
        if (state.subscriptions.length > 0) return true;

        try {
            const subscribe = state.authority.channel.subscribe;
            const subscribeSignal = (type, listener) => {
                const unsubscribe = trustedReflectApply(
                    subscribe,
                    state.authority.channel,
                    [type, listener]
                );
                if (typeof unsubscribe !== 'function') {
                    throw new TypeError('Invalid private channel subscription');
                }
                state.subscriptions.push(unsubscribe);
            };

            subscribeSignal(
                AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
                (envelope) => this._handlePrivateSelectionSnapshot(envelope)
            );
            subscribeSignal(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, (envelope) =>
                this._handlePrivateWordIntent(envelope)
            );
            subscribeSignal(
                AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_REQUEST,
                (envelope) => this._handlePrivateAnalysisRequest(envelope)
            );
            subscribeSignal(
                AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_CANCEL,
                (envelope) => this._handlePrivateAnalysisCancel(envelope)
            );
            let currentSelection = null;
            try {
                currentSelection = trustedReflectApply(
                    state.authority.getSelectionSnapshot,
                    undefined,
                    []
                );
            } catch (_) {}
            if (currentSelection) {
                trustedReflectApply(
                    state.authority.channel.publish,
                    state.authority.channel,
                    [
                        AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
                        currentSelection,
                    ]
                );
            }
            return true;
        } catch (_) {
            for (const unsubscribe of state.subscriptions.splice(0)) {
                try {
                    trustedReflectApply(unsubscribe, undefined, []);
                } catch (_) {}
            }
            return false;
        }
    }

    _createPrivateModalCapabilities() {
        const state = PRIVATE_MANAGER_STATES.get(this);
        if (!state?.active || !state.authority) return null;
        if (state.modalCapabilities) return state.modalCapabilities;

        state.modalCapabilities = Object.freeze({
            requestAnalysis: (options) => this._requestPrivateAnalysis(options),
            cancelAnalysis: (requestId, reason) =>
                this._cancelPrivateAnalysis(requestId, reason),
            subscribeSettled: (listener) =>
                this._subscribePrivateSettled(listener),
            takeResult: (requestId) =>
                this._takePrivateAnalysisResult(requestId),
            clearSelection: () => this._clearPrivateSelection(),
        });
        return state.modalCapabilities;
    }

    _clearPrivateSelection() {
        const state = PRIVATE_MANAGER_STATES.get(this);
        if (this._destroyStarted || !state?.active || !state.authority) {
            return false;
        }
        try {
            return (
                trustedReflectApply(
                    state.authority.clearSelection,
                    undefined,
                    []
                ) === true
            );
        } catch (_) {
            return false;
        }
    }

    _requestPrivateAnalysis(options = {}) {
        const state = PRIVATE_MANAGER_STATES.get(this);
        if (
            this._destroyStarted ||
            !state?.active ||
            !state.authority ||
            !options ||
            typeof options !== 'object'
        ) {
            return null;
        }

        const cause = options.cause ?? 'user';
        const retryOf = options.retryOf ?? null;
        const contextTypes = copyPrivateContextTypes(options.contextTypes);
        if (
            !contextTypes ||
            (cause !== 'user' && cause !== 'retry') ||
            (cause === 'user' && retryOf !== null) ||
            (cause === 'retry' && !isPositiveSafeInteger(retryOf))
        ) {
            return null;
        }

        let requestId;
        try {
            requestId = trustedReflectApply(
                state.authority.allocateRequestId,
                undefined,
                []
            );
        } catch (_) {
            return null;
        }
        if (
            !isPositiveSafeInteger(requestId) ||
            state.seenRequestIds.has(requestId)
        ) {
            return null;
        }

        let selectionSnapshot;
        try {
            selectionSnapshot = trustedReflectApply(
                state.authority.getSelectionSnapshot,
                undefined,
                []
            );
        } catch (_) {
            selectionSnapshot = null;
        }

        let selectionDelivered = 0;
        if (selectionSnapshot) {
            try {
                selectionDelivered = trustedReflectApply(
                    state.authority.channel.publish,
                    state.authority.channel,
                    [
                        AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
                        selectionSnapshot,
                    ]
                );
            } catch (_) {
                selectionDelivered = 0;
            }
        }

        const currentSelection = state.selectionSnapshot;
        if (
            selectionDelivered < 1 ||
            !selectionSnapshotsMatch(currentSelection, selectionSnapshot)
        ) {
            state.seenRequestIds.add(requestId);
            this._schedulePrivateStandaloneFailure(
                state,
                requestId,
                'stale-selection',
                false,
                currentSelection?.selectionRevision ?? null
            );
            return requestId;
        }

        let delivered = 0;
        try {
            delivered = trustedReflectApply(
                state.authority.channel.publish,
                state.authority.channel,
                [
                    AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_REQUEST,
                    Object.freeze({
                        requestId,
                        selectionRevision: currentSelection.selectionRevision,
                        cause,
                        retryOf,
                        contextTypes,
                    }),
                ]
            );
        } catch (_) {
            delivered = 0;
        }
        if (delivered < 1 && !state.seenRequestIds.has(requestId)) {
            state.seenRequestIds.add(requestId);
            this._schedulePrivateStandaloneFailure(
                state,
                requestId,
                'internal',
                false,
                currentSelection.selectionRevision
            );
        }
        return requestId;
    }

    _cancelPrivateAnalysis(requestId, reason) {
        const state = PRIVATE_MANAGER_STATES.get(this);
        if (
            this._destroyStarted ||
            !state?.active ||
            !state.authority ||
            !isPositiveSafeInteger(requestId) ||
            !PRIVATE_CANCEL_REASONS.includes(reason)
        ) {
            return false;
        }
        try {
            return (
                trustedReflectApply(
                    state.authority.channel.publish,
                    state.authority.channel,
                    [
                        AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_CANCEL,
                        Object.freeze({ requestId, reason }),
                    ]
                ) > 0
            );
        } catch (_) {
            return false;
        }
    }

    _subscribePrivateSettled(listener) {
        const state = PRIVATE_MANAGER_STATES.get(this);
        if (
            !state?.active ||
            !state.authority ||
            typeof listener !== 'function'
        ) {
            return () => {};
        }

        let active = true;
        let unsubscribe = () => {};
        try {
            unsubscribe = trustedReflectApply(
                state.authority.channel.subscribe,
                state.authority.channel,
                [
                    AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_SETTLED,
                    (envelope) => {
                        if (!active || !state.active) return;
                        try {
                            listener(envelope.payload);
                        } catch (_) {}
                    },
                ]
            );
        } catch (_) {
            return () => {};
        }
        if (typeof unsubscribe !== 'function') return () => {};

        const release = () => {
            if (!active) return;
            active = false;
            state.modalSubscriptions.delete(release);
            try {
                trustedReflectApply(unsubscribe, undefined, []);
            } catch (_) {}
        };
        state.modalSubscriptions.add(release);
        return release;
    }

    _takePrivateAnalysisResult(requestId) {
        const state = PRIVATE_MANAGER_STATES.get(this);
        if (!state?.active || !isPositiveSafeInteger(requestId)) return null;
        const result = state.resultLeases.get(requestId) ?? null;
        state.resultLeases.delete(requestId);
        return result;
    }

    _schedulePrivateSettlement(state, payload) {
        trustedQueueMicrotask(() => {
            if (!state.active || this._destroyStarted) {
                state.resultLeases.delete(payload.requestId);
                return;
            }
            try {
                trustedReflectApply(
                    state.authority.channel.publish,
                    state.authority.channel,
                    [AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_SETTLED, payload]
                );
            } catch (_) {
            } finally {
                state.resultLeases.delete(payload.requestId);
            }
        });
    }

    _schedulePrivateStandaloneFailure(
        state,
        requestId,
        code,
        retryable,
        selectionRevision
    ) {
        state.resultLeases.delete(requestId);
        state.lastFailedRequest = Object.freeze({
            requestId,
            retryable,
            selectionRevision,
        });
        this._schedulePrivateSettlement(
            state,
            Object.freeze({
                requestId,
                outcome: 'failed',
                code,
                retryable,
            })
        );
    }

    _finishPrivatePending(state, pending, payload, cancelProvider = false) {
        if (
            !state.active ||
            !pending ||
            pending.terminal ||
            state.pending !== pending
        ) {
            return false;
        }

        pending.terminal = true;
        state.pending = null;
        this.activeRequest = null;
        if (cancelProvider) {
            try {
                const cancelRequest = this.provider?.cancelRequest;
                if (typeof cancelRequest === 'function') {
                    trustedReflectApply(cancelRequest, this.provider, [
                        pending.providerRequestId,
                    ]);
                }
            } catch (_) {}
        }

        if (payload.outcome === 'failed') {
            state.resultLeases.delete(pending.requestId);
            state.lastFailedRequest = Object.freeze({
                requestId: pending.requestId,
                retryable: payload.retryable,
                selectionRevision: pending.selectionRevision,
            });
        } else if (payload.outcome !== 'succeeded') {
            state.resultLeases.delete(pending.requestId);
            state.lastFailedRequest = null;
        } else {
            state.lastFailedRequest = null;
        }

        this._schedulePrivateSettlement(state, Object.freeze(payload));
        return true;
    }

    _handlePrivateSelectionSnapshot(envelope) {
        const state = PRIVATE_MANAGER_STATES.get(this);
        const snapshot = envelope?.payload;
        if (!state?.active || !snapshot) return;

        const previous = state.selectionSnapshot;
        state.selectionSnapshot = snapshot;
        const pending = state.pending;
        if (pending && !selectionIdentityMatches(pending, snapshot)) {
            this._finishPrivatePending(
                state,
                pending,
                {
                    requestId: pending.requestId,
                    outcome: 'cancelled',
                    reason: 'selection-invalidated',
                },
                true
            );
        }

        if (!selectionSnapshotsMatch(previous, snapshot) || !previous) {
            this._reapplyPrivateSelectionSnapshot();
        }
    }

    _handlePrivateWordIntent(envelope) {
        const state = PRIVATE_MANAGER_STATES.get(this);
        const intent = envelope?.payload;
        const selection = state?.selectionSnapshot;
        const modal = this.modal;
        if (
            !state?.active ||
            !intent ||
            intent.action !== 'toggle' ||
            !selection ||
            selection.renderRevision !== intent.renderRevision ||
            !Array.isArray(selection.entries) ||
            !selection.entries.some(
                (entry) =>
                    entry.wordIndex === intent.wordIndex &&
                    entry.word === intent.word
            ) ||
            !modal ||
            typeof modal.showSelectionMode !== 'function'
        ) {
            return false;
        }
        try {
            const activePlatform = this.contentScript?.activePlatform;
            const pausePlayback = activePlatform?.pausePlayback;
            if (typeof pausePlayback === 'function') {
                const pauseResult = trustedReflectApply(
                    pausePlayback,
                    activePlatform,
                    []
                );
                void trustedPromiseThen(
                    trustedPromiseResolve(pauseResult),
                    undefined,
                    () => undefined
                );
            }
        } catch (_) {}
        try {
            return (
                modal.showSelectionMode({
                    trigger: 'word-selection',
                    preserveSelection: true,
                }) === true
            );
        } catch (_) {
            return false;
        }
    }

    _reapplyPrivateSelectionSnapshot() {
        const state = PRIVATE_MANAGER_STATES.get(this);
        const modal = this.modal;
        if (
            !state?.active ||
            !state.selectionSnapshot ||
            !modal ||
            typeof modal.applySelectionSnapshot !== 'function'
        ) {
            return false;
        }
        try {
            return (
                modal.applySelectionSnapshot(state.selectionSnapshot) === true
            );
        } catch (_) {
            return false;
        }
    }

    _handlePrivateAnalysisRequest(envelope) {
        const state = PRIVATE_MANAGER_STATES.get(this);
        const request = envelope?.payload;
        if (
            !state?.active ||
            !request ||
            !isPositiveSafeInteger(request.requestId) ||
            state.seenRequestIds.has(request.requestId)
        ) {
            return;
        }
        state.seenRequestIds.add(request.requestId);

        if (state.pending) {
            this._schedulePrivateStandaloneFailure(
                state,
                request.requestId,
                'busy',
                false,
                request.selectionRevision
            );
            return;
        }

        const selection = state.selectionSnapshot;
        const retryIsAuthorized =
            request.cause === 'user' ||
            (request.cause === 'retry' &&
                state.lastFailedRequest?.requestId === request.retryOf &&
                state.lastFailedRequest.retryable === true &&
                state.lastFailedRequest.selectionRevision ===
                    request.selectionRevision);
        if (
            !selection ||
            selection.entries.length === 0 ||
            selection.selectionRevision !== request.selectionRevision ||
            !retryIsAuthorized
        ) {
            this._schedulePrivateStandaloneFailure(
                state,
                request.requestId,
                'stale-selection',
                false,
                request.selectionRevision
            );
            return;
        }

        const pending = {
            requestId: request.requestId,
            selectionRevision: selection.selectionRevision,
            renderRevision: selection.renderRevision,
            providerRequestId: `aicontext-${request.requestId}`,
            terminal: false,
        };
        state.pending = pending;
        this.activeRequest = pending.providerRequestId;
        this.metrics.analysisCount += 1;
        this.metrics.lastActivity = Date.now();
        void this._executePrivateAnalysisRequest(
            state,
            pending,
            request,
            selection
        );
    }

    _handlePrivateAnalysisCancel(envelope) {
        const state = PRIVATE_MANAGER_STATES.get(this);
        const cancellation = envelope?.payload;
        const pending = state?.pending;
        if (
            !state?.active ||
            !pending ||
            cancellation?.requestId !== pending.requestId
        ) {
            return;
        }
        this._finishPrivatePending(
            state,
            pending,
            {
                requestId: pending.requestId,
                outcome: 'cancelled',
                reason: cancellation.reason,
            },
            true
        );
    }

    _isPrivatePendingCurrent(state, pending, selection) {
        return Boolean(
            state.active &&
            !this._destroyStarted &&
            state.pending === pending &&
            !pending.terminal &&
            selectionIdentityMatches(state.selectionSnapshot, selection)
        );
    }

    async _executePrivateAnalysisRequest(state, pending, request, selection) {
        let languages;
        try {
            const configService = this.contentScript?.configService;
            const getMultiple = configService?.getMultiple;
            if (typeof getMultiple !== 'function') {
                throw new TypeError('Configuration unavailable');
            }
            languages = readPrivateLanguageProjection(
                await trustedReflectApply(getMultiple, configService, [
                    ['targetLanguage', 'originalLanguage'],
                ])
            );
        } catch (_) {
            languages = null;
        }
        if (!this._isPrivatePendingCurrent(state, pending, selection)) return;
        if (!languages) {
            this._finishPrivatePending(state, pending, {
                requestId: pending.requestId,
                outcome: 'failed',
                code: 'configuration',
                retryable: false,
            });
            return;
        }

        const text = selection.entries.map((entry) => entry.word).join(' ');
        let expectedRequest;
        try {
            expectedRequest = buildAnalyzeContextRequestMessage(
                MessageSenderRoles.CONTENT,
                {
                    text,
                    contextTypes: request.contextTypes,
                    language: languages.originalLanguage,
                    targetLanguage: languages.targetLanguage,
                    platform: this.platform,
                    requestId: pending.providerRequestId,
                }
            );
        } catch (_) {
            this._finishPrivatePending(state, pending, {
                requestId: pending.requestId,
                outcome: 'failed',
                code: 'configuration',
                retryable: false,
            });
            return;
        }

        const analyzeContext = this.provider?.analyzeContext;
        if (typeof analyzeContext !== 'function') {
            this._finishPrivatePending(state, pending, {
                requestId: pending.requestId,
                outcome: 'failed',
                code: 'provider-unavailable',
                retryable: false,
            });
            return;
        }

        let response;
        try {
            response = await trustedReflectApply(
                analyzeContext,
                this.provider,
                [
                    text,
                    {
                        contextTypes: request.contextTypes,
                        language: languages.originalLanguage,
                        targetLanguage: languages.targetLanguage,
                        platform: this.platform,
                        requestId: pending.providerRequestId,
                    },
                ]
            );
        } catch (_) {
            if (!this._isPrivatePendingCurrent(state, pending, selection)) {
                return;
            }
            this._finishPrivatePending(state, pending, {
                requestId: pending.requestId,
                outcome: 'failed',
                code: 'internal',
                retryable: false,
            });
            return;
        }
        if (!this._isPrivatePendingCurrent(state, pending, selection)) return;

        const parsed = parseAnalyzeContextResponseMessage(
            response,
            expectedRequest,
            MessageSenderRoles.CONTENT
        );
        if (!parsed) {
            this._finishPrivatePending(state, pending, {
                requestId: pending.requestId,
                outcome: 'failed',
                code: 'invalid-response',
                retryable: false,
            });
            return;
        }
        if (parsed.status === 'failure') {
            this.metrics.errorCount += 1;
            this._finishPrivatePending(state, pending, {
                requestId: pending.requestId,
                outcome: 'failed',
                code: 'provider-error',
                retryable: parsed.shouldRetry,
            });
            return;
        }

        state.resultLeases.set(pending.requestId, parsed.result);
        this._finishPrivatePending(state, pending, {
            requestId: pending.requestId,
            outcome: 'succeeded',
        });
    }

    _destroyPrivateAnalysisAuthority() {
        const state = PRIVATE_MANAGER_STATES.get(this);
        if (!state || !state.active) return;
        state.active = false;

        const pending = state.pending;
        state.pending = null;
        if (pending && !pending.terminal) {
            pending.terminal = true;
            try {
                const cancelRequest = this.provider?.cancelRequest;
                if (typeof cancelRequest === 'function') {
                    trustedReflectApply(cancelRequest, this.provider, [
                        pending.providerRequestId,
                    ]);
                }
            } catch (_) {}
        }
        for (const release of [...state.modalSubscriptions]) {
            try {
                release();
            } catch (_) {}
        }
        for (const unsubscribe of state.subscriptions.splice(0)) {
            try {
                trustedReflectApply(unsubscribe, undefined, []);
            } catch (_) {}
        }
        state.resultLeases.clear();
        state.seenRequestIds.clear();
        state.lastFailedRequest = null;
        state.selectionSnapshot = null;
        state.modalCapabilities = null;
    }

    _validatePlatform() {
        const platformConfig =
            AI_CONTEXT_CONFIG.PLATFORMS[this.platform.toUpperCase()];
        return !!platformConfig;
    }

    async _initializeComponents() {
        if (this._destroyStarted) return false;

        this._log('debug', 'Initializing components');
        const privateAnalysis = this._hasPrivateAnalysisAuthority();

        try {
            // Attach an early listener to buffer word selections that occur before modal events are ready
            if (!privateAnalysis && !this._earlyWordSelectionListener) {
                this._earlyWordSelectionListener = (evt) => {
                    if (this._destroyStarted) return;
                    try {
                        // If modal events are not yet available, buffer the event
                        const eventsReady = !!(this.modal && this.modal.events);
                        if (!eventsReady) {
                            this.earlySelectionQueue.push(evt.detail);
                            this._log(
                                'debug',
                                'Buffered early word selection event',
                                {
                                    bufferedCount:
                                        this.earlySelectionQueue.length,
                                    wordLength:
                                        typeof evt.detail?.word === 'string'
                                            ? evt.detail.word.length
                                            : 0,
                                    subtitleType: evt.detail?.subtitleType,
                                }
                            );
                        }
                    } catch (e) {
                        // Ignore buffering errors, just log
                        this._log(
                            'warn',
                            'Failed to buffer early word selection',
                            {
                                error: e.message,
                            }
                        );
                    }
                };
                document.addEventListener(
                    'dualsub-word-selected',
                    this._earlyWordSelectionListener,
                    true // capture early
                );
                if (this._destroyStarted) return false;
            }

            // Initialize modal
            const modalConfig = {
                ...this.config.modal,
                contentScript: this.contentScript,
                ...(privateAnalysis
                    ? {
                          analysisCapabilities:
                              this._createPrivateModalCapabilities(),
                          onSelectionRestored: () =>
                              this._reapplyPrivateSelectionSnapshot(),
                      }
                    : {}),
            };
            const modal = new AIContextModal(modalConfig);
            this.modal = modal;
            modal.setLogger(this.logger);
            if (this._destroyStarted) return false;
            await modal.initialize();
            if (this._destroyStarted) return false;
            this.components.set('modal', modal);

            // Remove early listener to prevent double handling once events are ready
            if (this._earlyWordSelectionListener) {
                try {
                    document.removeEventListener(
                        'dualsub-word-selected',
                        this._earlyWordSelectionListener,
                        true
                    );
                } catch (_) {}
                this._earlyWordSelectionListener = null;
            }

            // Initialize provider
            const provider = new AIContextProvider(this.config.provider || {});
            this.provider = provider;
            const providerInitialized = await provider.initialize();
            if (this._destroyStarted) return false;
            if (providerInitialized !== true) {
                throw new Error('AI Context Provider failed to initialize');
            }
            this.components.set('provider', provider);

            // Initialize text handler
            if (!privateAnalysis) {
                const textHandler = new TextSelectionHandler(
                    this.config.textHandler || {}
                );
                this.textHandler = textHandler;
                textHandler.setLogger(this.logger);
                await textHandler.initialize(this.platform);
                if (this._destroyStarted) return false;
                this.components.set('textHandler', textHandler);
            }

            this._log('debug', 'Components initialized successfully');

            // Wait for modal to be fully ready (DOM + events bound) before flushing buffered events
            try {
                await modal.core.onceReady;
            } catch (_) {}
            if (this._destroyStarted) return false;

            // Drain any buffered early word selections now that UI and events are fully ready
            if (!privateAnalysis && this.earlySelectionQueue.length > 0) {
                this._log('info', 'Replaying buffered word selection events', {
                    count: this.earlySelectionQueue.length,
                });
                const buffered = [...this.earlySelectionQueue];
                this.earlySelectionQueue = [];
                for (const detail of buffered) {
                    if (this._destroyStarted) return false;
                    try {
                        const replayDetail = { ...detail, action: 'add' };
                        const replayEvent = new CustomEvent(
                            'dualsub-word-selected',
                            { detail: replayDetail }
                        );
                        if (
                            this.modal &&
                            typeof this.modal.handleWordSelection === 'function'
                        ) {
                            this.modal.handleWordSelection(replayEvent);
                        } else {
                            document.dispatchEvent(replayEvent);
                        }
                    } catch (e) {
                        this._log(
                            'warn',
                            'Failed to replay buffered selection event',
                            {
                                error: e.message,
                                detailKeys: detail ? Object.keys(detail) : [],
                            }
                        );
                    }
                }

                if (this._destroyStarted) return false;
                try {
                    if (this.modal && !this.modal.isVisible) {
                        this.modal.showSelectionMode({
                            trigger: 'word-selection',
                        });
                    }
                } catch (_) {}
            }
            if (privateAnalysis) {
                this._reapplyPrivateSelectionSnapshot();
            }
            return true;
        } catch (error) {
            if (this._destroyStarted) return false;
            this._log('error', 'Failed to initialize components', error);
            console.error('Component initialization error:', error);
            throw error;
        }
    }

    async _setupEventCoordination() {
        if (this._destroyStarted) return false;

        this._log('debug', 'Setting up event coordination');
        const privateAnalysis = this._hasPrivateAnalysisAuthority();

        try {
            // Listen for context analysis requests (from modal)
            if (!privateAnalysis) {
                const contextAnalysisListener = (event) => {
                    this._handleAnalysisRequest(event);
                };
                document.addEventListener(
                    'dualsub-analyze-selection',
                    contextAnalysisListener
                );
                this.eventListeners.set(
                    'dualsub-analyze-selection',
                    contextAnalysisListener
                );
            }

            if (!privateAnalysis) {
                // Legacy mode coordinates through public document events.
                document.addEventListener(
                    EVENT_TYPES.MODAL_STATE_CHANGE,
                    this._handleModalStateChange
                );
                this.eventListeners.set(
                    EVENT_TYPES.MODAL_STATE_CHANGE,
                    this._handleModalStateChange
                );

                // Listen for analysis pause requests to cancel in-flight work.
                const pauseAnalysisListener = (event) => {
                    try {
                        const reqId =
                            event?.detail?.requestId || this.activeRequest;
                        this._log('debug', 'Received analysis pause request', {
                            requestId: reqId,
                            activeRequest: this.activeRequest,
                        });
                        this._handlePauseAnalysisEvent({ requestId: reqId });
                    } catch (e) {
                        this._log(
                            'warn',
                            'Failed to handle pause analysis event',
                            { error: e.message }
                        );
                    }
                };
                document.addEventListener(
                    EVENT_TYPES.ANALYSIS_PAUSE,
                    pauseAnalysisListener
                );
                this.eventListeners.set(
                    EVENT_TYPES.ANALYSIS_PAUSE,
                    pauseAnalysisListener
                );
            }

            this._log('debug', 'Event coordination setup complete');
        } catch (error) {
            this._log('error', 'Failed to setup event coordination', error);
            throw error;
        }
    }

    async _enableDefaultFeatures() {
        const defaultFeatures = [
            AI_CONTEXT_CONFIG.FEATURES.CONTEXT_MODAL,
            ...(this._hasPrivateAnalysisAuthority()
                ? []
                : [AI_CONTEXT_CONFIG.FEATURES.TEXT_SELECTION]),
        ];

        for (const feature of defaultFeatures) {
            if (!(await this.enableFeature(feature)) || this._destroyStarted) {
                return false;
            }
        }
        return true;
    }

    async _enableInteractiveSubtitles() {
        this._log('debug', 'Enabling interactive subtitles');
    }

    async _enableContextModal() {
        this._log('debug', 'Enabling context modal');

        if (!this.modal) {
            throw new Error('Modal not initialized');
        }

        // Modal is already initialized, just mark as enabled
        this._log('info', 'Context modal enabled');
    }

    async _enableTextSelection() {
        this._log('debug', 'Enabling text selection');

        if (!this.textHandler) {
            throw new Error('Text handler not initialized');
        }

        // Text handler is already initialized, just mark as enabled
        this._log('info', 'Text selection enabled');
    }

    _handleSystemError(error, context = 'unknown') {
        this.metrics.errorCount++;
        this._log('error', `System error in ${context}`, error);

        this._dispatchEvent(EVENT_TYPES.SYSTEM_ERROR, {
            error: error.message,
            context,
            timestamp: Date.now(),
        });
    }

    async _handleAnalysisRequest(event) {
        if (this._destroyStarted || this._hasPrivateAnalysisAuthority()) return;

        const detail = event.detail;
        // Extract text from either direct text field or selection object
        const text = detail.text || detail.selection?.text;
        // Preserve provided requestId when present (tests and callers rely on this); otherwise generate one
        const requestId =
            detail.requestId ||
            `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
            this._log('debug', 'Handling analysis request', {
                requestId,
                textLength: typeof text === 'string' ? text.length : 0,
                contextTypeCount: Array.isArray(detail.contextTypes)
                    ? detail.contextTypes.length
                    : detail.contextType
                      ? 1
                      : 0,
            });

            // Skip if no valid text is available
            if (!text || typeof text !== 'string' || text.trim() === '') {
                this._log('warn', 'Skipping analysis request - no valid text', {
                    hasDetailText: !!detail.text,
                    hasSelectionText: !!detail.selection?.text,
                    textLength: text?.length || 0,
                });
                return;
            }

            this.metrics.analysisCount++;
            this.metrics.lastActivity = Date.now();

            // Route request via provider abstraction
            // De-duplicate in-flight ids to avoid parallel duplicates
            if (!this._inflightIds) this._inflightIds = new Set();
            if (this._inflightIds.has(requestId)) {
                this._log('debug', 'Duplicate analysis request ignored', {
                    requestId,
                });
                // Even if duplicate, count as error to surface back-pressure in tests
                this.metrics.errorCount++;
                return;
            }
            this._inflightIds.add(requestId);
            let response;
            try {
                response = await this.provider.analyzeContext(text, {
                    contextTypes: detail.contextTypes || [
                        'cultural',
                        'historical',
                        'linguistic',
                    ],
                    language: detail.language,
                    targetLanguage: detail.targetLanguage,
                    platform: this.platform,
                    requestId: requestId,
                });
            } catch (e) {
                if (this._destroyStarted) return;
                // When provider throws (e.g., messaging rejects), convert to error-shaped response
                response = {
                    success: false,
                    error: e?.message || 'Unknown error',
                };
            }
            if (this._destroyStarted) return;

            this._log('debug', 'Received response from background script', {
                success: response.success,
                hasResult: !!response.result,
                hasError: !!response.error,
                requestId: requestId,
            });

            // Dispatch result event (both new and legacy formats)
            document.dispatchEvent(
                new CustomEvent('dualsub-context-result', {
                    detail: {
                        requestId: requestId,
                        result: response.result,
                        success: response.success,
                        error: response.error,
                        shouldRetry:
                            response.shouldRetry ??
                            /timeout|rate limit|temporar/i.test(
                                response?.error || ''
                            ),
                    },
                })
            );

            // Dispatch new event format and track errors in metrics
            if (response && response.success) {
                this._dispatchEvent(EVENT_TYPES.ANALYSIS_COMPLETE, {
                    requestId: requestId,
                    result: response.result,
                });
            } else {
                // Track error metric for failed analysis responses
                this.metrics.errorCount++;
                this._dispatchEvent(EVENT_TYPES.ANALYSIS_ERROR, {
                    requestId: requestId,
                    error: response?.error || 'Unknown error',
                    shouldRetry: !!response?.shouldRetry,
                });
            }
        } catch (error) {
            if (this._destroyStarted) return;
            this.metrics.errorCount++;
            this._log('error', 'Failed to handle analysis request', {
                error: error.message,
                detailKeys: Object.keys(event.detail || {}),
                textLength:
                    typeof event.detail?.text === 'string'
                        ? event.detail.text.length
                        : 0,
            });

            // Dispatch error events (non-fatal). Keep UI in selection state, allow retry.
            document.dispatchEvent(
                new CustomEvent('dualsub-context-error', {
                    detail: {
                        requestId: requestId,
                        error: error.message,
                    },
                })
            );

            this._dispatchEvent(EVENT_TYPES.ANALYSIS_ERROR, {
                requestId: requestId,
                error: error.message,
            });
        } finally {
            try {
                if (this._inflightIds) this._inflightIds.delete(requestId);
            } catch (_) {}
        }
    }

    _handleModalStateChange(event) {
        if (this._destroyStarted) return;

        // Support both legacy (currentState/previousState) and new (newState/oldState) payload shapes
        const detail = event.detail || {};
        const nextState = detail.currentState || detail.newState;
        const prevState = detail.previousState || detail.oldState;
        const data = detail.data;

        this._log('debug', 'Modal state changed', {
            from: prevState,
            to: nextState,
            data,
        });

        // Update current state tracking
        this.currentState = nextState;

        // Handle state-specific logic
        switch (nextState) {
            case MODAL_STATES.PROCESSING:
                this.activeRequest = data.requestId;
                break;
            case MODAL_STATES.SELECTION:
                // When UI leaves processing state, clear active request tracking
                // unless another request is already set by a newer transition.
                if (this.activeRequest === (data && data.requestId)) {
                    this.activeRequest = null;
                }
                break;
            case MODAL_STATES.HIDDEN:
                this.activeRequest = null;
                break;
        }
    }

    /**
     * Handle analysis pause requests by cancelling in-flight provider work
     * @param {{requestId?: string}} param0
     * @private
     */
    _handlePauseAnalysisEvent({ requestId } = {}) {
        if (this._destroyStarted || this._hasPrivateAnalysisAuthority()) return;

        try {
            const targetId = requestId || this.activeRequest;
            if (!targetId) {
                this._log('debug', 'No active request to cancel');
                return;
            }

            if (
                this.provider &&
                typeof this.provider.cancelRequest === 'function'
            ) {
                const cancelled = this.provider.cancelRequest(targetId);
                this._log('info', 'Cancel request invoked on provider', {
                    requestId: targetId,
                    cancelled,
                });
            }

            this.activeRequest = null;

            // Notify listeners that analysis has been paused
            this._dispatchEvent(EVENT_TYPES.ANALYSIS_PAUSED, {
                requestId: targetId,
                timestamp: Date.now(),
            });

            // Also dispatch a legacy-style context error to ensure any pending UI flows abort
            document.dispatchEvent(
                new CustomEvent('dualsub-context-error', {
                    detail: {
                        requestId: targetId,
                        error: 'Analysis paused by user',
                        cancelled: true,
                    },
                })
            );
        } catch (error) {
            this._log('error', 'Failed to pause analysis', {
                error: error.message,
            });
        }
    }

    _dispatchEvent(type, detail) {
        if (this._destroyStarted) return;

        // Track event metrics
        this.metrics.eventCounts[type] =
            (this.metrics.eventCounts[type] || 0) + 1;

        document.dispatchEvent(new CustomEvent(type, { detail }));
    }

    _log(level, message, data = {}) {
        const method = this.logger?.[level];
        if (typeof method !== 'function') {
            return;
        }
        method.call(this.logger, message, {
            component: 'AIContextManager',
            platform: this.platform,
            ...data,
        });
    }
}
