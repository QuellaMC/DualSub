/**
 * BaseContentScript - Abstract base class for platform-specific content scripts
 *
 * This class provides common functionality shared across all streaming platform
 * content scripts, including module loading, platform initialization, video element
 * detection, configuration management, Chrome message handling, and navigation detection.
 *
 * Platform-specific content scripts should extend this class and implement the
 * abstract methods to provide platform-specific behavior.
 *
 * ## Architecture Overview
 *
 * The BaseContentScript follows the Template Method Pattern, where the base class
 * defines the algorithm structure and subclasses implement specific steps. This
 * ensures consistent behavior across all platforms while allowing customization.
 *
 * ## Key Features
 *
 * - **Module Loading**: Dynamic loading of required modules with error handling
 * - **Platform Lifecycle**: Standardized initialization and cleanup patterns
 * - **Message Handling**: Extensible Chrome message handling with action-based routing
 * - **Navigation Detection**: Shared, lifecycle-owned SPA navigation manager
 * - **Configuration Management**: Real-time configuration updates and validation
 * - **Error Recovery**: Comprehensive error handling with retry mechanisms
 * - **Resource Management**: Automatic cleanup and memory management
 *
 * ## Usage Example
 *
 * ```javascript
 * import { BaseContentScript } from '../core/BaseContentScript.js';
 *
 * export class MyPlatformContentScript extends BaseContentScript {
 *     constructor() {
 *         super('MyPlatformContent');
 *     }
 *
 *     // Implement required abstract methods
 *     getPlatformName() { return 'myplatform'; }
 *     getPlatformClass() { return 'MyPlatformPlatform'; }
 *     getInjectScriptConfig() { return { ... }; }
 *     setupNavigationDetection() { ... }
 * }
 *
 * // Initialize the content script
 * const contentScript = new MyPlatformContentScript();
 * await contentScript.initialize();
 * ```
 *
 * ## Abstract Methods
 *
 * Subclasses must implement these abstract methods:
 * - `getPlatformName()`: Return platform identifier (e.g., 'netflix')
 * - `getPlatformClass()`: Return platform class name (e.g., 'NetflixPlatform')
 * - `getInjectScriptConfig()`: Return injection script configuration
 * - `setupNavigationDetection()`: Configure the shared navigation manager
 *
 * ## Template Methods
 *
 * These methods orchestrate the initialization flow and should not be overridden:
 * - `initialize()`: Main initialization method
 * - `initializeCore()`: Core module initialization
 * - `initializeConfiguration()`: Configuration setup
 * - `initializeEventHandling()`: Event handling setup
 * - `initializeObservers()`: Observer setup
 *
 * @abstract
 * @author DualSub Extension
 * @version 2.5.0
 * @since 1.0.0
 *
 * @example
 * // Basic platform implementation
 * class ExampleContentScript extends BaseContentScript {
 *     constructor() {
 *         super('ExampleContent');
 *     }
 *
 *     getPlatformName() {
 *         return 'example';
 *     }
 *
 *     getPlatformClass() {
 *         return 'ExamplePlatform';
 *     }
 *
 *     getInjectScriptConfig() {
 *         return {
 *             filename: 'injected_scripts/exampleInject.js',
 *             tagId: 'example-dualsub-injector-script-tag',
 *             eventId: 'example-dualsub-injector-event'
 *         };
 *     }
 *
 *     setupNavigationDetection() {
 *         this._setupNavigationManager();
 *     }
 * }
 */

// @ts-check

import { EventBuffer, IntervalManager, injectScript } from './utils.js';
import { COMMON_CONSTANTS } from './constants.js';
import {
    getOrCreateUiRoot,
    finalizeExpiredSubtitleIfNeeded,
    resolvePlaybackTime,
} from '../shared/subtitleUtilities.js';
import { MessageActions } from '../shared/constants/messageActions.js';
import { NavigationDetectionManager } from '../shared/navigationUtils.js';
import {
    AI_CONTEXT_SIGNAL_TYPES,
    createAIContextChannel,
} from '../aicontext/core/AIContextChannel.js';
import { SelectionModel } from '../aicontext/core/state/SelectionModel.js';
import {
    isProvenMessagingNonDelivery,
    sendRuntimeMessageWithRetry,
} from '../shared/messaging.js';
import {
    acceptInjectedEvent,
    createInjectedScriptUrl,
    extendAcceptedInjectedEvent,
    revokeInjectionChannel,
} from '../shared/injectionChannel.js';
import {
    buildSidePanelContentSelectionSnapshotMessage,
    buildContentControlResponseMessage,
    buildSidePanelSelectionRemovalCommandResponse,
    buildSidePanelSelectionRepublishAck,
    buildSidePanelWordIntentMessage,
    classifyExtensionMessageSender,
    MessageSenderRoles,
    parseSidePanelContentSelectionSnapshotResponse,
    parseConfigChangedRequestMessage,
    parseLoggingLevelChangedRequestMessage,
    readProtocolMessageAction,
    parseSidePanelPauseVideoRequestMessage,
    parseSidePanelSelectionRemovalCommandMessage,
    parseSidePanelSelectionRepublishRequestMessage,
} from '../shared/protocol/messageProtocol.js';
import {
    prepareSettingValue,
    validateSetting,
} from '../../config/configSchema.js';

const TRUSTED_REFLECT_APPLY = Reflect.apply;
const AI_CONTEXT_CONFIGURATION_KEYS = Object.freeze([
    'aiContextEnabled',
    'aiContextProvider',
    'aiContextTypes',
    'aiContextTimeout',
    'aiContextRetryAttempts',
]);
const AI_CONTEXT_CONFIGURATION_KEY_SET = new Set(AI_CONTEXT_CONFIGURATION_KEYS);
const MESSAGE_ACTION_SET = new Set(Object.values(MessageActions));
const AI_CONTEXT_FEATURE_OWNER_STATES = new WeakMap();
const AI_CONTEXT_LIFECYCLE_STATES = new WeakMap();
const CONTENT_SELECTION_AUTHORITY_STATES = new WeakMap();
let nextContentSelectionLifecycleGeneration = 0;
let nextPrivateAnalysisRequestId = 0;

function buildChromeMessageFailureResponse(request, error) {
    try {
        return buildContentControlResponseMessage(request, {
            success: false,
            error,
        });
    } catch (_) {
        return { success: false, error };
    }
}

function allocateMonotonicPositiveSafeInteger(counterName) {
    if (counterName === 'selectionLifecycle') {
        if (
            nextContentSelectionLifecycleGeneration >= Number.MAX_SAFE_INTEGER
        ) {
            return null;
        }
        nextContentSelectionLifecycleGeneration += 1;
        return nextContentSelectionLifecycleGeneration;
    }
    if (nextPrivateAnalysisRequestId >= Number.MAX_SAFE_INTEGER) return null;
    nextPrivateAnalysisRequestId += 1;
    return nextPrivateAnalysisRequestId;
}

function initializeContentSelectionAuthority(contentScript) {
    const lifecycleGeneration =
        allocateMonotonicPositiveSafeInteger('selectionLifecycle');
    CONTENT_SELECTION_AUTHORITY_STATES.set(contentScript, {
        lifecycleGeneration,
        lastAllocatedSelectionRevision: 0,
        currentRenderRevision: null,
        selectionModel: new SelectionModel(),
        snapshot: null,
        publicationTail: Promise.resolve(false),
        publisherCleanup: null,
        publisherInstallationGeneration: 0,
        pendingRemoval: null,
        terminal: lifecycleGeneration === null,
    });
}

function getContentSelectionAuthorityState(contentScript) {
    return CONTENT_SELECTION_AUTHORITY_STATES.get(contentScript) || null;
}

function allocateContentSelectionRevision(state) {
    if (
        !state ||
        state.terminal ||
        state.lastAllocatedSelectionRevision >= Number.MAX_SAFE_INTEGER
    ) {
        return null;
    }
    state.lastAllocatedSelectionRevision += 1;
    return state.lastAllocatedSelectionRevision;
}

function createCanonicalContentSelectionSnapshot(
    state,
    selectionRevision,
    renderRevision,
    reason,
    entries
) {
    try {
        const message = buildSidePanelContentSelectionSnapshotMessage({
            lifecycleGeneration: state.lifecycleGeneration,
            selectionRevision,
            renderRevision,
            reason,
            entries,
        });
        return Object.freeze({
            selectionRevision: message.data.selectionRevision,
            renderRevision: message.data.renderRevision,
            reason: message.data.reason,
            entries: message.data.entries,
        });
    } catch (_) {
        return null;
    }
}

function buildContentSelectionWireMessage(state, snapshot) {
    return buildSidePanelContentSelectionSnapshotMessage({
        lifecycleGeneration: state.lifecycleGeneration,
        selectionRevision: snapshot.selectionRevision,
        renderRevision: snapshot.renderRevision,
        reason: snapshot.reason,
        entries: snapshot.entries,
    });
}

function queueContentSelectionSnapshot(
    contentScript,
    snapshot,
    canDispatchExtra = () => true
) {
    const state = getContentSelectionAuthorityState(contentScript);
    if (!state || state.terminal || !snapshot) {
        return Promise.resolve(false);
    }

    const run = state.publicationTail.then(async () => {
        if (state.terminal || canDispatchExtra() !== true) return false;
        let message;
        try {
            message = buildContentSelectionWireMessage(state, snapshot);
        } catch (_) {
            return false;
        }
        try {
            const response = await sendRuntimeMessageWithRetry(message, {
                retries: 2,
                baseDelayMs: 120,
                pingBeforeRetry: false,
                canDispatch: () =>
                    !state.terminal && canDispatchExtra() === true,
            });
            return (
                parseSidePanelContentSelectionSnapshotResponse(response)
                    ?.status === 'accepted'
            );
        } catch (_) {
            return false;
        }
    });
    state.publicationTail = run.then(
        () => false,
        () => false
    );
    return run;
}

function clearContentSelectionHighlights() {
    try {
        document
            .querySelectorAll('.dualsub-interactive-word.dualsub-word-selected')
            .forEach((element) =>
                element.classList.remove('dualsub-word-selected')
            );
    } catch (_) {}
}

function publishSelectionSnapshotToOwner(owner, snapshot) {
    const ownerState = getAIContextFeatureOwnerState(owner);
    if (!ownerState || ownerState.drained || !snapshot) return 0;
    try {
        return ownerState.channel.publish(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            snapshot
        );
    } catch (_) {
        return 0;
    }
}

function getAIContextFeatureOwnerState(owner) {
    if (
        owner === null ||
        (typeof owner !== 'object' && typeof owner !== 'function')
    ) {
        return null;
    }
    return AI_CONTEXT_FEATURE_OWNER_STATES.get(owner) || null;
}

function getAIContextLifecycleState(contentScript) {
    return AI_CONTEXT_LIFECYCLE_STATES.get(contentScript) || null;
}

function isAIContextFeatureOwnerStateOwnedBy(ownerState, contentScript) {
    return Boolean(
        ownerState &&
        ownerState.attached &&
        ownerState.contentScript === contentScript
    );
}

function logAIContextLifecycleFailure(contentScript, level, message) {
    try {
        contentScript.logWithFallback(level, message);
    } catch {
        // Cleanup authority must never depend on telemetry success.
    }
}

function hasExactAIContextLanguageKeys(keys) {
    try {
        if (!Array.isArray(keys)) return false;
        // A transparent Proxy is observationally identical to its Array target;
        // validation still detaches the only data sent across the boundary.
        if (Object.getPrototypeOf(keys) !== Array.prototype) return false;
        const ownKeys = Reflect.ownKeys(keys);
        if (
            ownKeys.length !== 3 ||
            ownKeys[0] !== '0' ||
            ownKeys[1] !== '1' ||
            ownKeys[2] !== 'length'
        ) {
            return false;
        }
        const lengthDescriptor = Object.getOwnPropertyDescriptor(
            keys,
            'length'
        );
        const targetDescriptor = Object.getOwnPropertyDescriptor(keys, '0');
        const originalDescriptor = Object.getOwnPropertyDescriptor(keys, '1');
        return Boolean(
            lengthDescriptor &&
            Object.hasOwn(lengthDescriptor, 'value') &&
            lengthDescriptor.value === 2 &&
            targetDescriptor &&
            Object.hasOwn(targetDescriptor, 'value') &&
            targetDescriptor.value === 'targetLanguage' &&
            originalDescriptor &&
            Object.hasOwn(originalDescriptor, 'value') &&
            originalDescriptor.value === 'originalLanguage'
        );
    } catch {
        return false;
    }
}

function projectAIContextLanguageRecord(value) {
    const projection = Object.create(null);
    if (value === null || typeof value !== 'object') {
        return Object.freeze(projection);
    }

    let targetLanguage;
    let originalLanguage;
    try {
        const targetDescriptor = Object.getOwnPropertyDescriptor(
            value,
            'targetLanguage'
        );
        const originalDescriptor = Object.getOwnPropertyDescriptor(
            value,
            'originalLanguage'
        );
        if (
            targetDescriptor &&
            Object.hasOwn(targetDescriptor, 'value') &&
            typeof targetDescriptor.value === 'string'
        ) {
            targetLanguage = targetDescriptor.value;
        }
        if (
            originalDescriptor &&
            Object.hasOwn(originalDescriptor, 'value') &&
            typeof originalDescriptor.value === 'string'
        ) {
            originalLanguage = originalDescriptor.value;
        }
    } catch {
        return Object.freeze(projection);
    }

    if (targetLanguage !== undefined) {
        Object.defineProperty(projection, 'targetLanguage', {
            enumerable: true,
            value: targetLanguage,
        });
    }
    if (originalLanguage !== undefined) {
        Object.defineProperty(projection, 'originalLanguage', {
            enumerable: true,
            value: originalLanguage,
        });
    }
    return Object.freeze(projection);
}

function projectAIContextUiLanguageChange(value) {
    if (value === null || typeof value !== 'object') return null;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, 'uiLanguage');
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            typeof descriptor.value !== 'string'
        ) {
            return null;
        }
        const projection = Object.create(null);
        Object.defineProperty(projection, 'uiLanguage', {
            enumerable: true,
            value: descriptor.value,
        });
        return Object.freeze(projection);
    } catch {
        return null;
    }
}

function createAIContextUnsubscribe(rawUnsubscribe, revoke = () => {}) {
    let active = true;
    return async () => {
        if (!active) return false;
        active = false;
        revoke();
        if (typeof rawUnsubscribe !== 'function') return false;
        try {
            await TRUSTED_REFLECT_APPLY(rawUnsubscribe, undefined, []);
            return true;
        } catch {
            return false;
        }
    };
}

function createAIContextHostFacade(contentScript) {
    const configServiceFacade = Object.create(null);
    Object.defineProperties(configServiceFacade, {
        get: {
            enumerable: true,
            value: async (key) => {
                if (typeof key !== 'string' || key !== 'uiLanguage') {
                    return undefined;
                }
                try {
                    const configService = contentScript.configService;
                    const get = configService?.get;
                    if (typeof get !== 'function') return undefined;
                    const result = await TRUSTED_REFLECT_APPLY(
                        get,
                        configService,
                        [key]
                    );
                    return typeof result === 'string' ? result : undefined;
                } catch {
                    return undefined;
                }
            },
        },
        getMultiple: {
            enumerable: true,
            value: async (keys) => {
                if (!hasExactAIContextLanguageKeys(keys)) return undefined;
                try {
                    const configService = contentScript.configService;
                    const getMultiple = configService?.getMultiple;
                    if (typeof getMultiple !== 'function') return undefined;
                    return projectAIContextLanguageRecord(
                        await TRUSTED_REFLECT_APPLY(
                            getMultiple,
                            configService,
                            [['targetLanguage', 'originalLanguage']]
                        )
                    );
                } catch {
                    return undefined;
                }
            },
        },
        onChanged: {
            enumerable: true,
            value: (...args) => {
                if (args.length !== 1 || typeof args[0] !== 'function') {
                    return createAIContextUnsubscribe();
                }
                const [callback] = args;
                let configService;
                let onChanged;
                try {
                    configService = contentScript.configService;
                    onChanged = configService?.onChanged;
                } catch {
                    return createAIContextUnsubscribe();
                }
                if (typeof onChanged !== 'function') {
                    return createAIContextUnsubscribe();
                }
                const projectorState = { active: true };
                const revokeProjector = () => {
                    projectorState.active = false;
                };
                const projector = async (changes) => {
                    if (!projectorState.active) return undefined;
                    const projectedChanges =
                        projectAIContextUiLanguageChange(changes);
                    if (!projectedChanges || !projectorState.active) {
                        return undefined;
                    }
                    try {
                        await TRUSTED_REFLECT_APPLY(callback, undefined, [
                            projectedChanges,
                        ]);
                    } catch {}
                    return undefined;
                };
                let rawUnsubscribe;
                try {
                    rawUnsubscribe = TRUSTED_REFLECT_APPLY(
                        onChanged,
                        configService,
                        [projector]
                    );
                } catch {
                    revokeProjector();
                    return createAIContextUnsubscribe();
                }
                if (typeof rawUnsubscribe !== 'function') {
                    revokeProjector();
                    return createAIContextUnsubscribe();
                }
                return createAIContextUnsubscribe(
                    rawUnsubscribe,
                    revokeProjector
                );
            },
        },
    });
    Object.freeze(configServiceFacade);

    const activePlatformFacade = Object.create(null);
    Object.defineProperty(activePlatformFacade, 'pausePlayback', {
        enumerable: true,
        value: async () => {
            try {
                const activePlatform = contentScript.activePlatform;
                const pausePlayback = activePlatform?.pausePlayback;
                if (typeof pausePlayback !== 'function') return false;
                const result = await TRUSTED_REFLECT_APPLY(
                    pausePlayback,
                    activePlatform,
                    []
                );
                return result === true;
            } catch {
                return false;
            }
        },
    });
    Object.freeze(activePlatformFacade);

    const hostFacade = Object.create(null);
    Object.defineProperties(hostFacade, {
        contentLogger: {
            enumerable: true,
            value: contentScript.contentLogger,
        },
        configService: {
            enumerable: true,
            get: () => {
                try {
                    return contentScript.configService
                        ? configServiceFacade
                        : null;
                } catch {
                    return null;
                }
            },
        },
        activePlatform: {
            enumerable: true,
            get: () => {
                try {
                    return typeof contentScript.activePlatform
                        ?.pausePlayback === 'function'
                        ? activePlatformFacade
                        : null;
                } catch {
                    return null;
                }
            },
        },
    });
    return Object.freeze(hostFacade);
}

function createAIContextFeatureOwner(contentScript, generation) {
    const owner = {};
    const state = {
        contentScript,
        attached: true,
        generation,
        channel: createAIContextChannel({
            lifecycleGeneration: generation,
        }),
        cleanups: [],
        drained: false,
        taskGroup: null,
        eventListenersAttached: false,
        fullscreenListenerAttached: false,
        interactiveCleanupAttached: false,
    };
    AI_CONTEXT_FEATURE_OWNER_STATES.set(owner, state);
    Object.defineProperties(owner, {
        channel: {
            configurable: false,
            enumerable: false,
            get: () => state.channel,
        },
        generation: {
            configurable: false,
            enumerable: false,
            get: () => state.generation,
        },
        drained: {
            configurable: false,
            enumerable: false,
            get: () => state.drained,
        },
    });
    return Object.freeze(owner);
}

function createAIContextRoleSlotDescriptor(lifecycleState, valueKey) {
    return {
        configurable: false,
        enumerable: true,
        get: () => lifecycleState[valueKey],
        set: (value) => {
            if (lifecycleState.terminal) {
                if (value === null) {
                    lifecycleState[valueKey] = null;
                }
                return;
            }

            if (
                value !== null &&
                (typeof value === 'object' || typeof value === 'function') &&
                lifecycleState.candidateCleanupPromises.has(value)
            ) {
                return;
            }
            lifecycleState[valueKey] = value;
        },
    };
}

function initializeAIContextLifecycle(contentScript) {
    const initialOwner = createAIContextFeatureOwner(contentScript, 0);
    const lifecycleState = {
        generation: 0,
        activeGeneration: null,
        owner: initialOwner,
        activeTaskGroups: new Set(),
        terminal: false,
        terminalCleanupPromise: null,
        candidateCleanupPromises: new WeakMap(),
        managerCandidateClaims: new WeakMap(),
        aiContextManagerValue: null,
        sidePanelIntegrationValue: null,
    };
    AI_CONTEXT_LIFECYCLE_STATES.set(contentScript, lifecycleState);
    Object.defineProperties(contentScript, {
        aiContextManager: createAIContextRoleSlotDescriptor(
            lifecycleState,
            'aiContextManagerValue'
        ),
        sidePanelIntegration: createAIContextRoleSlotDescriptor(
            lifecycleState,
            'sidePanelIntegrationValue'
        ),
        aiContextLifecycleGeneration: {
            configurable: false,
            enumerable: true,
            get: () =>
                getAIContextLifecycleState(contentScript)?.generation ?? 0,
        },
        aiContextActiveGeneration: {
            configurable: false,
            enumerable: true,
            get: () =>
                getAIContextLifecycleState(contentScript)?.activeGeneration ??
                null,
        },
        aiContextFeatureOwner: {
            configurable: false,
            enumerable: true,
            get: () => getAIContextLifecycleState(contentScript)?.owner ?? null,
        },
        isCleanedUp: {
            configurable: false,
            enumerable: true,
            get: () =>
                getAIContextLifecycleState(contentScript)?.terminal ?? true,
        },
    });
}

function isAIContextFeatureOwnerCurrent(contentScript, owner) {
    const lifecycleState = getAIContextLifecycleState(contentScript);
    const ownerState = getAIContextFeatureOwnerState(owner);
    return (
        Boolean(lifecycleState) &&
        !lifecycleState.terminal &&
        isAIContextFeatureOwnerStateOwnedBy(ownerState, contentScript) &&
        !ownerState.drained &&
        lifecycleState.owner === owner &&
        ownerState.generation === lifecycleState.generation
    );
}

function adoptAIContextCleanupResult(result) {
    // Keep the observer on a fresh, unexposed Promise. Hostile values are
    // assimilated into wrapper rejection instead of receiving a direct `.then`.
    return new Promise((resolve) => {
        resolve(result);
    });
}

function createAIContextTaskGroup(contentScript) {
    const lifecycleState = getAIContextLifecycleState(contentScript);
    if (!lifecycleState) {
        throw new Error('AI context lifecycle state is unavailable');
    }

    let resolveSettlement;
    const group = {
        closed: false,
        pending: 1,
        promise: new Promise((resolve) => {
            resolveSettlement = resolve;
        }),
        run(taskFactory, failureMessage = 'AI lifecycle cleanup task failed') {
            if (group.closed) return false;
            group.pending += 1;
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                group.pending -= 1;
                if (group.pending === 0) {
                    group.closed = true;
                    lifecycleState.activeTaskGroups.delete(group);
                    resolveSettlement();
                }
            };

            let task;
            try {
                task = taskFactory();
            } catch {
                logAIContextLifecycleFailure(
                    contentScript,
                    'warn',
                    failureMessage
                );
                finish();
                return true;
            }

            let adoptedTask;
            try {
                adoptedTask = adoptAIContextCleanupResult(task);
            } catch {
                logAIContextLifecycleFailure(
                    contentScript,
                    'warn',
                    failureMessage
                );
                finish();
                return true;
            }

            // Adoption and settlement failures are projected to a fixed
            // message without exposing hostile Promise or thenable details.
            void adoptedTask.then(finish, () => {
                logAIContextLifecycleFailure(
                    contentScript,
                    'warn',
                    failureMessage
                );
                finish();
            });
            return true;
        },
        closeSetup() {
            if (group.closed) return;
            group.pending -= 1;
            if (group.pending === 0) {
                group.closed = true;
                lifecycleState.activeTaskGroups.delete(group);
                resolveSettlement();
            }
        },
    };

    // The setup sentinel keeps the group live while synchronous callbacks may
    // register nested work. Register before invoking any lifecycle callback.
    lifecycleState.activeTaskGroups.add(group);
    return group;
}

function runAIContextCleanupInNewGroup(contentScript, cleanup) {
    const group = createAIContextTaskGroup(contentScript);
    group.run(cleanup, 'AI feature cleanup failed');
    group.closeSetup();
    return group;
}

function registerAIContextFeatureCleanup(contentScript, owner, cleanup) {
    if (typeof cleanup !== 'function') return;

    // Contract: a registered destructor must return all asynchronous work and
    // must not recursively await terminal content-script cleanup. Unreturned
    // fire-and-forget work is intentionally outside lifecycle settlement.

    const ownerState = getAIContextFeatureOwnerState(owner);
    if (!isAIContextFeatureOwnerStateOwnedBy(ownerState, contentScript)) {
        runAIContextCleanupInNewGroup(contentScript, cleanup);
        return;
    }

    if (ownerState.drained) {
        if (!ownerState.taskGroup || ownerState.taskGroup.closed) {
            ownerState.taskGroup = runAIContextCleanupInNewGroup(
                contentScript,
                cleanup
            );
        } else {
            ownerState.taskGroup.run(cleanup, 'AI feature cleanup failed');
        }
        return;
    }

    ownerState.cleanups.push(cleanup);
}

function drainAIContextFeatureOwner(contentScript, owner, taskGroup) {
    const ownerState = getAIContextFeatureOwnerState(owner);
    if (!isAIContextFeatureOwnerStateOwnedBy(ownerState, contentScript)) {
        return;
    }
    if (ownerState.drained) return;

    ownerState.drained = true;
    ownerState.taskGroup = taskGroup;

    try {
        ownerState.channel.destroy();
    } catch {
        logAIContextLifecycleFailure(
            contentScript,
            'warn',
            'AI context channel destruction failed'
        );
    }

    const cleanups = ownerState.cleanups.splice(0);
    for (const cleanup of cleanups) {
        taskGroup.run(cleanup, 'AI feature cleanup failed');
    }
}

function destroyAIContextCandidate(contentScript, candidate, level, message) {
    const lifecycleState = getAIContextLifecycleState(contentScript);
    if (
        !lifecycleState ||
        !candidate ||
        (typeof candidate !== 'object' && typeof candidate !== 'function')
    ) {
        return Promise.resolve();
    }

    const existing = lifecycleState.candidateCleanupPromises.get(candidate);
    if (existing) {
        detachAIContextCandidate(contentScript, candidate);
        return existing;
    }

    let resolveCleanup;
    const cleanupPromise = new Promise((resolve) => {
        resolveCleanup = resolve;
    });
    // Publish the canonical promise before destroy can synchronously reenter.
    lifecycleState.candidateCleanupPromises.set(candidate, cleanupPromise);
    detachAIContextCandidate(contentScript, candidate);

    let result;
    try {
        result = candidate.destroy?.();
    } catch {
        logAIContextLifecycleFailure(contentScript, level, message);
        detachAIContextCandidate(contentScript, candidate);
        resolveCleanup();
        return cleanupPromise;
    }
    detachAIContextCandidate(contentScript, candidate);

    let adoptedResult;
    try {
        adoptedResult = adoptAIContextCleanupResult(result);
    } catch {
        logAIContextLifecycleFailure(contentScript, level, message);
        detachAIContextCandidate(contentScript, candidate);
        resolveCleanup();
        return cleanupPromise;
    }

    void adoptedResult.then(
        () => {
            detachAIContextCandidate(contentScript, candidate);
            resolveCleanup();
        },
        () => {
            logAIContextLifecycleFailure(contentScript, level, message);
            detachAIContextCandidate(contentScript, candidate);
            resolveCleanup();
        }
    );
    return cleanupPromise;
}

function destroyAIContextManagerCandidate(contentScript, candidate) {
    return destroyAIContextCandidate(
        contentScript,
        candidate,
        'error',
        'AI context manager destruction failed'
    );
}

function detachAIContextCandidate(contentScript, candidate) {
    try {
        if (contentScript.aiContextManager === candidate) {
            contentScript.aiContextManager = null;
        }
    } catch {
        // Public role accessors cannot strand canonical cleanup settlement.
    }
    try {
        if (contentScript.sidePanelIntegration === candidate) {
            contentScript.sidePanelIntegration = null;
        }
    } catch {
        // Keep role failures isolated so the other exact slot can still clear.
    }
}

function releaseAIContextManagerCandidate(
    contentScript,
    claimToken,
    candidate
) {
    const lifecycleState = getAIContextLifecycleState(contentScript);
    const isCandidate = Boolean(
        candidate &&
        (typeof candidate === 'object' || typeof candidate === 'function')
    );
    if (
        lifecycleState &&
        isCandidate &&
        lifecycleState.candidateCleanupPromises.has(candidate)
    ) {
        detachAIContextCandidate(contentScript, candidate);
        // The raw cleanup task is already the canonical waiter. A tracker
        // reentering from destroy must not join that ancestor promise.
        return Promise.resolve();
    }
    if (lifecycleState && isCandidate) {
        const existingClaimToken =
            lifecycleState.managerCandidateClaims.get(candidate);
        if (existingClaimToken && existingClaimToken !== claimToken) {
            return Promise.resolve();
        }
        if (!existingClaimToken) {
            // The first tracker to release an unclaimed result owns destruction.
            // Keep the token as a tombstone so this identity cannot be reused.
            lifecycleState.managerCandidateClaims.set(candidate, claimToken);
        }
    }

    detachAIContextCandidate(contentScript, candidate);
    return destroyAIContextManagerCandidate(contentScript, candidate);
}

function destroySidePanelIntegrationCandidate(contentScript, candidate) {
    return destroyAIContextCandidate(
        contentScript,
        candidate,
        'warn',
        'Side panel integration destruction failed'
    );
}

function destroyAIContextTransitionCandidate(
    contentScript,
    candidate,
    destroyCandidate
) {
    const lifecycleState = getAIContextLifecycleState(contentScript);
    const isCandidate = Boolean(
        candidate &&
        (typeof candidate === 'object' || typeof candidate === 'function')
    );
    if (
        lifecycleState &&
        isCandidate &&
        lifecycleState.candidateCleanupPromises.has(candidate)
    ) {
        detachAIContextCandidate(contentScript, candidate);
        // The ancestor raw cleanup task already waits for returned reentrant
        // work. This transition must not adopt that ancestor promise.
        return Promise.resolve();
    }

    const cleanupPromise = destroyCandidate(contentScript, candidate);
    detachAIContextCandidate(contentScript, candidate);
    return adoptAIContextCleanupResult(cleanupPromise).then(
        () => {
            detachAIContextCandidate(contentScript, candidate);
        },
        () => {
            detachAIContextCandidate(contentScript, candidate);
        }
    );
}

function setAIContextInteractionsEnabled(contentScript, enabled) {
    try {
        contentScript.subtitleUtils?.setInteractiveSubtitlesEnabled?.(enabled);
        return true;
    } catch {
        logAIContextLifecycleFailure(
            contentScript,
            'warn',
            'AI interaction state update failed'
        );
        return false;
    }
}

async function settleAllAIContextTaskGroups(contentScript) {
    const lifecycleState = getAIContextLifecycleState(contentScript);
    if (!lifecycleState) return;

    // New late-cleanup groups can appear while an earlier snapshot settles.
    // Terminal teardown therefore repeats until the private registry is empty.
    while (lifecycleState.activeTaskGroups.size > 0) {
        await Promise.all(
            Array.from(
                lifecycleState.activeTaskGroups,
                (group) => group.promise
            )
        );
    }
}

function beginAIContextFeatureLifecycle(
    contentScript,
    joinAllTaskGroups = false
) {
    const lifecycleState = getAIContextLifecycleState(contentScript);
    if (!lifecycleState) {
        throw new Error('AI context lifecycle state is unavailable');
    }
    const previousOwner = lifecycleState.owner;
    const unownedManager = contentScript.aiContextManager;
    const unownedSidePanel = contentScript.sidePanelIntegration;
    contentScript.aiContextManager = null;
    contentScript.sidePanelIntegration = null;

    const generation = lifecycleState.generation + 1;
    const owner = createAIContextFeatureOwner(contentScript, generation);
    lifecycleState.generation = generation;
    lifecycleState.activeGeneration = null;
    lifecycleState.owner = owner;

    const taskGroup = createAIContextTaskGroup(contentScript);

    // Terminal replacement channels are tombstones: revoke them before any
    // previous-owner cleanup or UI collaborator can reenter.
    if (lifecycleState.terminal) {
        drainAIContextFeatureOwner(contentScript, owner, taskGroup);
    }

    drainAIContextFeatureOwner(contentScript, previousOwner, taskGroup);

    setAIContextInteractionsEnabled(contentScript, false);

    if (unownedManager) {
        taskGroup.run(() =>
            destroyAIContextTransitionCandidate(
                contentScript,
                unownedManager,
                destroyAIContextManagerCandidate
            )
        );
    }
    if (unownedSidePanel) {
        taskGroup.run(() =>
            destroyAIContextTransitionCandidate(
                contentScript,
                unownedSidePanel,
                destroySidePanelIntegrationCandidate
            )
        );
    }

    taskGroup.closeSetup();
    return {
        owner,
        cleanupPromise:
            lifecycleState.terminal && joinAllTaskGroups
                ? settleAllAIContextTaskGroups(contentScript)
                : taskGroup.promise,
    };
}

function trackAIContextManagerCandidateFactory(
    contentScript,
    owner,
    candidatePromise
) {
    const claimToken = {};
    const claimCandidate = (candidate) => {
        const lifecycleState = getAIContextLifecycleState(contentScript);
        if (
            !lifecycleState ||
            !isAIContextFeatureOwnerCurrent(contentScript, owner) ||
            !candidate ||
            (typeof candidate !== 'object' &&
                typeof candidate !== 'function') ||
            lifecycleState.managerCandidateClaims.has(candidate) ||
            lifecycleState.candidateCleanupPromises.has(candidate)
        ) {
            return false;
        }

        lifecycleState.managerCandidateClaims.set(candidate, claimToken);
        return true;
    };
    const releaseCandidate = (candidate) =>
        releaseAIContextManagerCandidate(contentScript, claimToken, candidate);

    if (!isAIContextFeatureOwnerCurrent(contentScript, owner)) {
        let invalidOwnerCleanupPromise = null;
        const requestCleanup = () => {
            if (!invalidOwnerCleanupPromise) {
                invalidOwnerCleanupPromise = Promise.resolve(
                    candidatePromise
                ).then(
                    (candidate) => releaseCandidate(candidate),
                    () => undefined
                );
            }
            return invalidOwnerCleanupPromise;
        };
        registerAIContextFeatureCleanup(contentScript, owner, requestCleanup);
        return {
            claimCandidate,
            requestCleanup,
            setSetupPromise: () => {},
        };
    }

    let setupPromise = Promise.resolve();
    let setupDecisionMade = false;
    let resolveSetupDecision;
    const setupDecision = new Promise((resolve) => {
        resolveSetupDecision = resolve;
    });
    let cleanupPromise = null;

    const setSetupPromise = (promise) => {
        if (setupDecisionMade) return;
        setupDecisionMade = true;
        setupPromise = Promise.resolve(promise);
        resolveSetupDecision();
    };

    const requestCleanup = () => {
        if (!cleanupPromise) {
            cleanupPromise = Promise.resolve(candidatePromise).then(
                async (candidate) => {
                    await setupDecision;
                    await setupPromise.catch(() => undefined);
                    await releaseCandidate(candidate);
                },
                () => undefined
            );
        }
        return cleanupPromise;
    };

    registerAIContextFeatureCleanup(contentScript, owner, requestCleanup);
    return { claimCandidate, requestCleanup, setSetupPromise };
}

function registerAIContextInteractiveCleanup(contentScript, owner) {
    const ownerState = getAIContextFeatureOwnerState(owner);
    if (
        !isAIContextFeatureOwnerStateOwnedBy(ownerState, contentScript) ||
        ownerState.interactiveCleanupAttached
    ) {
        return;
    }
    ownerState.interactiveCleanupAttached = true;
    const ownerGeneration = ownerState.generation;
    registerAIContextFeatureCleanup(contentScript, owner, () => {
        const lifecycleState = getAIContextLifecycleState(contentScript);
        if (!lifecycleState) return;
        if (lifecycleState.activeGeneration === ownerGeneration) {
            lifecycleState.activeGeneration = null;
        }
        if (
            lifecycleState.owner === owner ||
            lifecycleState.activeGeneration === null
        ) {
            setAIContextInteractionsEnabled(contentScript, false);
        }
    });
}

function preventStaleAIContextInteractionCommit(contentScript, owner) {
    const lifecycleState = getAIContextLifecycleState(contentScript);
    if (!lifecycleState) return;
    const currentOwner = lifecycleState.owner;
    const currentOwnerState = getAIContextFeatureOwnerState(currentOwner);
    if (
        currentOwner !== owner &&
        lifecycleState.activeGeneration !== currentOwnerState?.generation
    ) {
        setAIContextInteractionsEnabled(contentScript, false);
    }
}

function trackAIContextInteractiveInitialization(
    contentScript,
    owner,
    initializationPromise
) {
    let cleanupPromise = null;
    const waitForInteractiveCleanup = () => {
        if (!cleanupPromise) {
            cleanupPromise = Promise.resolve(initializationPromise)
                .catch(() => undefined)
                .then(() => {
                    preventStaleAIContextInteractionCommit(
                        contentScript,
                        owner
                    );
                });
        }
        return cleanupPromise;
    };

    registerAIContextFeatureCleanup(
        contentScript,
        owner,
        waitForInteractiveCleanup
    );
    return waitForInteractiveCleanup;
}

function commitAIContextInteractionState(contentScript, owner) {
    if (!isAIContextFeatureOwnerCurrent(contentScript, owner)) {
        return false;
    }

    const lifecycleState = getAIContextLifecycleState(contentScript);
    const ownerState = getAIContextFeatureOwnerState(owner);
    if (!lifecycleState || !ownerState) return false;
    lifecycleState.activeGeneration = ownerState.generation;
    // Reassert at the final generation commit. A stale interactive initializer
    // may have completed between the helper's final await and continuation.
    setAIContextInteractionsEnabled(contentScript, true);
    return true;
}

function copyDenseAIContextTypes(value) {
    try {
        if (!Array.isArray(value)) return null;

        const ownKeys = Reflect.ownKeys(value);
        const lengthDescriptor = Object.getOwnPropertyDescriptor(
            value,
            'length'
        );
        if (
            !lengthDescriptor ||
            !Object.hasOwn(lengthDescriptor, 'value') ||
            lengthDescriptor.enumerable ||
            lengthDescriptor.configurable ||
            !Number.isSafeInteger(lengthDescriptor.value) ||
            lengthDescriptor.value < 0 ||
            ownKeys.length !== lengthDescriptor.value + 1
        ) {
            return null;
        }

        const copy = [];
        for (let index = 0; index < lengthDescriptor.value; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(
                value,
                String(index)
            );
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                !descriptor.enumerable ||
                typeof descriptor.value !== 'string'
            ) {
                return null;
            }
            copy.push(descriptor.value);
        }
        return copy;
    } catch {
        return null;
    }
}

function readExactOwnDataProjection(result, keys, keySet) {
    try {
        if (result === null || typeof result !== 'object') return null;

        const valuesDescriptor = Object.getOwnPropertyDescriptor(
            result,
            'values'
        );
        if (
            !valuesDescriptor ||
            !Object.hasOwn(valuesDescriptor, 'value') ||
            !valuesDescriptor.enumerable ||
            valuesDescriptor.value === null ||
            typeof valuesDescriptor.value !== 'object'
        ) {
            return null;
        }

        const values = valuesDescriptor.value;
        const valuesPrototype = Object.getPrototypeOf(values);
        if (valuesPrototype !== null && valuesPrototype !== Object.prototype) {
            return null;
        }
        const ownKeys = Reflect.ownKeys(values);
        if (
            ownKeys.length !== keys.length ||
            ownKeys.some((key) => typeof key !== 'string' || !keySet.has(key))
        ) {
            return null;
        }

        const projection = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(values, key);
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                !descriptor.enumerable ||
                !validateSetting(key, descriptor.value)
            ) {
                return null;
            }
            projection[key] = descriptor.value;
        }

        const aiContextTypes = copyDenseAIContextTypes(
            projection.aiContextTypes
        );
        if (aiContextTypes === null) return null;

        if (typeof globalThis.structuredClone !== 'function') return null;
        // Native structured cloning rejects transparent and revoked Proxy
        // objects. Clone only the validated values projection so unrelated
        // outer result properties are never traversed.
        globalThis.structuredClone(values);
        return {
            ...projection,
            aiContextTypes,
        };
    } catch {
        return null;
    }
}

const AI_CONTEXT_LIFECYCLE_CONFIG_KEYS = new Set([
    'aiContextEnabled',
    'aiContextProvider',
    'aiContextTypes',
    'aiContextTimeout',
    'aiContextRetryAttempts',
    'aiContextRateLimit',
    'aiContextBurstLimit',
    'aiContextMandatoryDelay',
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
    'geminiApiKey',
    'geminiModel',
]);

export class BaseContentScript {
    /**
     * Creates a new BaseContentScript instance.
     * @param {string} logPrefix - The log prefix for this content script (e.g., 'NetflixContent').
     */
    constructor(logPrefix) {
        if (new.target === BaseContentScript) {
            throw new Error(
                'BaseContentScript is abstract and cannot be instantiated directly'
            );
        }

        this.logPrefix = logPrefix;
        this._initializeCoreProperties();
        this._initializeModuleReferences();
        this._initializeVideoDetectionState();
        this._initializeEventHandling();
        BaseContentScript.prototype._initializeManagers.call(this);
        initializeAIContextLifecycle(this);
        initializeContentSelectionAuthority(this);
        this._initializeCleanupTracking();
        this._initializeMessageHandling();
    }

    /**
     * Initializes core properties for the content script instance.
     * @private
     */
    _initializeCoreProperties() {
        this.contentLogger = null;
        this.activePlatform = null;
        this.platformInitializationPromise = null;
        this.platformInitializationGeneration = 0;
        this.platformRetryTimeoutId = null;
        this.platformRetryResolve = null;
        this.pageEnterTask = null;
        this.cleanedPlatformInstances = new WeakSet();
        this.currentConfig = {};
    }

    /**
     * Initializes references to dynamically loaded modules.
     * @private
     */
    _initializeModuleReferences() {
        this.subtitleUtils = null;
        this.PlatformClass = null;
        this.configService = null;
    }

    /**
     * Initializes state related to video element detection.
     * @private
     */
    _initializeVideoDetectionState() {
        this.videoDetectionRetries = 0;
        this.videoDetectionIntervalId = null;
        this.videoDetectionIntervalOwner = null;
        this.videoDetectionGeneration = 0;
        this.videoDetectionTask = null;
        this.visibilityVideoSetupGeneration = 0;
        this.visibilityVideoSetupTask = null;
        this.lastVideoSetupScope = null;
        this.maxVideoDetectionRetries =
            COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES;
        this.videoDetectionInterval = COMMON_CONSTANTS.VIDEO_DETECTION_INTERVAL;
    }

    /**
     * Initializes properties for event handling and buffering.
     * @private
     */
    _initializeEventHandling() {
        this.eventBuffer = new EventBuffer(() =>
            this.logWithFallback('debug', 'Event buffer diagnostic event.')
        );
        this.eventListenerAttached = false;
        this.visibilityChangeHandler = null;
        this.platformReady = false;
        this.eventListenerCleanupFunctions = [];
        this.domObserverCleanupFunctions = [];
    }

    /**
     * Initializes manager instances for intervals and observers.
     * @private
     */
    _initializeManagers() {
        this.intervalManager = new IntervalManager();
        this.pageObserver = null;
        this.pageObserverTask = null;
        this.domObservationSetupGeneration = 0;
        this.domObservationCancellationDepth = 0;

        // Initialize AI Context Manager (will be configured during initializeAIContextFeatures)
        this.aiContextManager = null;
        this.sidePanelIntegration = null;
        this.aiContextConfigurationIntentGeneration = 0;
        // Store key identities only; reconciliation values come from getAll().
        this.pendingAIContextConfigurationKeys = new Map();
        this.configurationSubscriptionGeneration = 0;
        // Monotonic authority for the latest configuration subscription/refresh.
        this.configurationRefreshGeneration = 0;

        // Sole owner of navigation detection
        this.navigationDetectionManager = null;
    }

    /**
     * Initializes properties for tracking cleanup state.
     * @private
     */
    _initializeCleanupTracking() {
        this.passiveVideoObserver = null;
        this.chromeMessageListener = null;
        this.chromeMessageListenerAttached = false;
        this.configUnsubscribe = null;
        this.pageShowSelectionHandler = null;
        this.earlyInjectionRetryTask = null;
        // Event-handler cleanup is terminal for this instance. A fresh content
        // script instance is required before subscriptions may be accepted.
        this.configurationSubscriptionsAccepted = true;

        try {
            this.abortController = new AbortController();
        } catch {
            this.logWithFallback(
                'warn',
                'AbortController not available, using fallback cleanup'
            );
            this.abortController = null;
        }
    }

    /**
     * Initializes the Chrome message handling system.
     * @private
     */
    _initializeMessageHandling() {
        this.messageHandlers = new Map();
        this._setupCommonMessageHandlers();
        this._attachChromeMessageListener();
    }

    /**
     * Unified navigation detection manager setup. Platforms can call this with optional overrides.
     * @protected
     * @param {Object} [options]
     */
    _setupNavigationManager(options = {}) {
        const previousManager = this.navigationDetectionManager;
        this.navigationDetectionManager = null;
        previousManager?.cleanup();

        let manager = null;
        try {
            const isPlayerPathFn =
                typeof this._isPlayerPath === 'function'
                    ? (pathname) => this._isPlayerPath(pathname)
                    : () => false;

            manager = new NavigationDetectionManager(
                this.getPlatformName ? this.getPlatformName() : 'unknown',
                {
                    ...options,
                    isPlayerPage: isPlayerPathFn,
                    onUrlChange: (oldUrl, newUrl) => {
                        let oldPathname = '';
                        let newPathname = '';
                        try {
                            oldPathname = new URL(oldUrl, window.location.href)
                                .pathname;
                            newPathname = new URL(newUrl, window.location.href)
                                .pathname;
                        } catch (_) {}

                        const playerIdentityChanged =
                            isPlayerPathFn(oldPathname) &&
                            isPlayerPathFn(newPathname) &&
                            oldPathname !== newPathname;
                        if (playerIdentityChanged) {
                            let preserveAdoptedPlayerState = false;
                            try {
                                preserveAdoptedPlayerState =
                                    this.activePlatform?.hasAdoptedPlayerRoute?.(
                                        newUrl
                                    ) === true;
                            } catch (_) {}
                            this._invalidatePlayerNavigationState({
                                preserveAdoptedPlayerState,
                            });
                        }

                        try {
                            this.activePlatform?.onUrlChange?.(newUrl);
                        } catch (_) {}

                        if (playerIdentityChanged) {
                            this._rearmVideoElementDetectionForPlayerNavigation?.();
                        }
                    },
                    onPageTransition: (wasPlayer, isPlayer) => {
                        try {
                            this._handlePageTransition(wasPlayer, isPlayer);
                        } catch (_) {}
                    },
                    logger: () =>
                        this.logWithFallback(
                            'debug',
                            'Navigation manager diagnostic event.'
                        ),
                    enableNavigationLogging: false,
                }
            );
            manager.setupComprehensiveNavigation();
            this.navigationDetectionManager = manager;
            return true;
        } catch (e) {
            manager?.cleanup();
            this.navigationDetectionManager = null;
            this.logWithFallback(
                'error',
                'Failed to setup NavigationDetectionManager.'
            );
            throw e;
        }
    }

    /**
     * Revoke state owned by the prior player identity before replacement work.
     * Query/hash-only URL changes intentionally do not cross this boundary.
     * A delayed navigation observation preserves playback state that the
     * adapter proves already belongs to the destination player route.
     * @private
     * @param {Object} [options]
     * @param {boolean} [options.preserveAdoptedPlayerState=false]
     */
    _invalidatePlayerNavigationState({
        preserveAdoptedPlayerState = false,
    } = {}) {
        const platform = this.activePlatform;

        if (preserveAdoptedPlayerState) return;

        this._clearCanonicalContentSelection('clear');
        try {
            platform?.setVideoIdAndNotify?.(null);
        } catch (_) {}
        try {
            platform?.resetVttRequestState?.();
        } catch (_) {}
        try {
            this.subtitleUtils?.clearSubtitlesDisplayAndQueue?.(
                platform,
                true,
                this.logPrefix
            );
        } catch (_) {}
        try {
            this.subtitleUtils?.clearSubtitleDOM?.();
        } catch (_) {}
        try {
            this.eventBuffer?.clear();
        } catch (_) {}
    }

    /**
     * Sets up common message handlers for all platforms.
     * @private
     */
    _setupCommonMessageHandlers() {
        const commonHandlers = [
            {
                action: MessageActions.SIDEPANEL_GET_STATE,
                handler: this.handleSidePanelGetState.bind(this),
                requiresUtilities: false,
                senderRoles: [MessageSenderRoles.BACKGROUND],
                description:
                    'Return current word selection state from page highlights.',
            },
            {
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                handler: this.handleSidePanelUpdateState.bind(this),
                requiresUtilities: false,
                senderRoles: [MessageSenderRoles.BACKGROUND],
                description:
                    'Apply selection updates (clear/apply highlights) from side panel.',
            },
            {
                action: MessageActions.CONFIG_CHANGED,
                handler: this.handleConfigChanged.bind(this),
                requiresUtilities: true,
                senderRoles: [MessageSenderRoles.POPUP],
                description:
                    'Handle and apply configuration changes immediately.',
            },
            {
                action: MessageActions.LOGGING_LEVEL_CHANGED,
                handler: this.handleLoggingLevelChanged.bind(this),
                requiresUtilities: false,
                senderRoles: [MessageSenderRoles.BACKGROUND],
                description:
                    'Update logging level for the content script logger.',
            },
            {
                action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
                handler: this.handleSidePanelPauseVideo.bind(this),
                requiresUtilities: false,
                senderRoles: [MessageSenderRoles.BACKGROUND],
                description:
                    'Pause the video on the page using multiple strategies.',
            },
        ];

        commonHandlers.forEach(
            ({
                action,
                handler,
                requiresUtilities,
                senderRoles,
                description,
            }) => {
                this.registerMessageHandler(action, handler, {
                    requiresUtilities,
                    senderRoles,
                    description,
                });
            }
        );
    }

    /**
     * Attaches the listener for incoming Chrome messages.
     * @private
     */
    _attachChromeMessageListener() {
        if (this.chromeMessageListenerAttached) {
            return;
        }

        if (
            typeof chrome !== 'undefined' &&
            chrome.runtime &&
            chrome.runtime.onMessage
        ) {
            if (!this.chromeMessageListener) {
                this.chromeMessageListener =
                    this.handleChromeMessage.bind(this);
            }
            chrome.runtime.onMessage.addListener(this.chromeMessageListener);
            this.chromeMessageListenerAttached = true;
            this.logWithFallback('debug', 'Chrome message listener attached.');
        } else {
            this.logWithFallback(
                'debug',
                'Chrome API not available, skipping message listener attachment.'
            );
        }
    }

    /**
     * Registers a message handler for a specific action.
     * @param {string} action - The action to handle.
     * @param {Function} handler - The handler function `(request, sendResponse) => boolean`.
     * @param {Object} [options] - Optional configuration.
     * @param {boolean} [options.requiresUtilities=true] - Whether the handler requires utilities to be loaded.
     * @param {string[]} [options.senderRoles] - Exact extension sender roles allowed to invoke the handler.
     * @param {string} [options.description] - A description of the handler.
     */
    registerMessageHandler(action, handler, options = {}) {
        if (typeof action !== 'string' || !action.trim()) {
            throw new Error('Action must be a non-empty string.');
        }
        if (!MESSAGE_ACTION_SET.has(action)) {
            throw new Error('Action must be present in MessageActions.');
        }

        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function.');
        }

        const senderRoles = options.senderRoles;
        if (
            !Array.isArray(senderRoles) ||
            senderRoles.length === 0 ||
            senderRoles.some(
                (role) => !Object.values(MessageSenderRoles).includes(role)
            )
        ) {
            throw new Error(
                'Handler senderRoles must be a non-empty role list.'
            );
        }

        const handlerConfig = {
            handler,
            requiresUtilities: options.requiresUtilities !== false,
            senderRoles: Object.freeze([...new Set(senderRoles)]),
            description: options.description || `Handler for ${action}`,
            registeredAt: new Date().toISOString(),
        };

        this.messageHandlers.set(action, handlerConfig);
        this.logWithFallback('debug', 'Registered message handler.', {
            requiresUtilities: Boolean(handlerConfig.requiresUtilities),
        });
    }

    /**
     * Unregisters a message handler for a specific action.
     * @param {string} action - The action to unregister.
     * @returns {boolean} `true` if a handler was removed, otherwise `false`.
     */
    unregisterMessageHandler(action) {
        const removed = this.messageHandlers.delete(action);
        if (removed) {
            this.logWithFallback('debug', 'Unregistered message handler.');
        } else {
            this.logWithFallback(
                'warn',
                'Attempted to unregister non-existent message handler.'
            );
        }
        return removed;
    }

    /**
     * Gets information about all registered message handlers.
     * @returns {Array<Object>} An array of handler information objects.
     */
    getRegisteredHandlers() {
        return Array.from(this.messageHandlers.entries()).map(
            ([action, config]) => ({
                action,
                requiresUtilities: config.requiresUtilities,
                senderRoles: config.senderRoles,
                description: config.description,
                registeredAt: config.registeredAt,
            })
        );
    }

    /**
     * Checks if a message handler is registered for a specific action.
     * @param {string} action - The action to check.
     * @returns {boolean} `true` if a handler is registered, otherwise `false`.
     */
    hasMessageHandler(action) {
        return this.messageHandlers.has(action);
    }

    /**
     * Logs a message, falling back to `console.log` if the logger is not yet initialized.
     * @param {string} level - The log level ('error', 'warn', 'info', 'debug').
     * @param {string} message - The log message.
     * @param {Object} [data={}] - Additional data to log.
     */
    logWithFallback(level, message, data = {}) {
        if (this.contentLogger) {
            this.contentLogger[level](message, data);
        } else {
            console.log(
                `[${this.logPrefix}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }

    // ========================================
    // ABSTRACT METHODS - Must be implemented by subclasses
    // ========================================

    /**
     * Get the platform name (e.g., 'netflix', 'disneyplus').
     * @abstract
     * @returns {string} The platform name.
     */
    getPlatformName() {
        throw new Error('getPlatformName() must be implemented by subclass');
    }

    /**
     * Get the platform class constructor name.
     * @abstract
     * @returns {string} The platform class constructor name.
     */
    getPlatformClass() {
        throw new Error('getPlatformClass() must be implemented by subclass');
    }

    /**
     * Get the inject script configuration.
     * @abstract
     * @returns {{filename: string, tagId: string, eventId: string}} The inject script configuration.
     */
    getInjectScriptConfig() {
        throw new Error(
            'getInjectScriptConfig() must be implemented by subclass'
        );
    }

    /**
     * Set up platform-specific navigation detection.
     * @abstract
     */
    setupNavigationDetection() {
        throw new Error(
            'setupNavigationDetection() must be implemented by subclass'
        );
    }

    // ========================================
    // TEMPLATE METHODS - Common initialization flow
    // ========================================

    /**
     * Main initialization method that orchestrates the entire setup process.
     * This is a template method and should not be overridden by subclasses.
     * @returns {Promise<boolean>} A promise that resolves to `true` if initialization is successful, otherwise `false`.
     */
    async initialize() {
        try {
            this.logWithFallback(
                'info',
                'Starting content script initialization'
            );

            if (!(await this.initializeCore())) {
                this.logWithFallback(
                    'error',
                    'Initialization failed at core module setup.'
                );
                return false;
            }

            if (!(await this.initializeConfiguration())) {
                this.logWithFallback(
                    'error',
                    'Initialization failed at configuration setup.'
                );
                return false;
            }

            if (!(await this.initializeEventHandling())) {
                this.logWithFallback(
                    'error',
                    'Initialization failed at event handling setup.'
                );
                return false;
            }

            if (!(await this.initializeObservers())) {
                this.logWithFallback(
                    'error',
                    'Initialization failed at observer setup.'
                );
                return false;
            }

            // Initialize AI context features if enabled
            if (!(await this.initializeAIContextFeatures())) {
                this.logWithFallback(
                    'warn',
                    'AI context features initialization failed, continuing without AI context.'
                );
                // Don't fail the entire initialization for AI context issues
            }

            this.logWithFallback(
                'info',
                'Content script initialization completed successfully'
            );
            return true;
        } catch {
            this.logWithFallback(
                'error',
                'An unexpected error occurred during initialization.'
            );
            return false;
        }
    }

    /**
     * Initializes core modules and services.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeCore() {
        try {
            this.logWithFallback('debug', 'Loading required modules...');
            if (!(await this.loadModules())) {
                this.logWithFallback(
                    'error',
                    'Failed to load required modules.'
                );
                return false;
            }
            this.logWithFallback(
                'debug',
                'All required modules loaded successfully.'
            );
            return true;
        } catch {
            this.logWithFallback('error', 'Error initializing core modules.');
            return false;
        }
    }

    /**
     * Initializes configuration and sets up listeners for changes.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeConfiguration() {
        try {
            this.logWithFallback(
                'debug',
                'Loading configuration from configService...'
            );

            try {
                this.currentConfig = await this.configService.getAll({
                    includeSensitive: false,
                });
            } catch {
                this.logWithFallback(
                    'error',
                    'Failed to load configuration from configService.'
                );
                return false;
            }

            this._normalizeConfiguration();
            this.logWithFallback('info', 'Loaded initial configuration.', {
                settingCount: Object.keys(this.currentConfig).length,
                subtitlesEnabled: Boolean(this.currentConfig.subtitlesEnabled),
                aiContextEnabled: Boolean(this.currentConfig.aiContextEnabled),
            });

            this.logWithFallback(
                'debug',
                'Setting up configuration listeners...'
            );

            try {
                this.setupConfigurationListeners();
                this.logWithFallback(
                    'debug',
                    'Configuration listeners set up successfully.'
                );
            } catch {
                this.logWithFallback(
                    'warn',
                    'Failed to setup configuration listeners, continuing without live updates'
                );
            }

            return true;
        } catch {
            this.logWithFallback(
                'error',
                'Unexpected configuration initialization failure.'
            );
            return false;
        }
    }

    /**
     * Initializes event handling and the platform-specific logic.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeEventHandling() {
        try {
            this.logWithFallback('debug', 'Setting up early event handling...');
            this.setupEarlyEventHandling();
            this.logWithFallback(
                'debug',
                'Early event handling set up successfully.'
            );

            if (this.currentConfig.subtitlesEnabled) {
                this.logWithFallback(
                    'debug',
                    'Subtitles enabled, initializing platform...'
                );
                await this.initializePlatform();
            } else {
                this.logWithFallback(
                    'debug',
                    'Subtitles disabled, skipping platform initialization.'
                );
            }
            return true;
        } catch {
            this.logWithFallback('error', 'Error initializing event handling.');
            return false;
        }
    }

    /**
     * Initializes observers and cleanup handlers.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeObservers() {
        try {
            this.logWithFallback('debug', 'Setting up navigation detection...');
            this.setupNavigationDetection();
            this.logWithFallback(
                'debug',
                'Navigation detection set up successfully.'
            );

            this.logWithFallback('debug', 'Setting up DOM observation...');
            this.setupDOMObservation();
            this.logWithFallback(
                'debug',
                'DOM observation set up successfully.'
            );

            this.logWithFallback('debug', 'Setting up cleanup handlers...');
            this.setupCleanupHandlers();
            this.logWithFallback(
                'debug',
                'Cleanup handlers set up successfully.'
            );

            return true;
        } catch {
            this.logWithFallback('error', 'Error initializing observers.');
            return false;
        }
    }

    /**
     * Initialize AI context features if enabled in configuration
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async initializeAIContextFeatures() {
        const { owner, cleanupPromise } = beginAIContextFeatureLifecycle(this);

        try {
            this.logWithFallback(
                'debug',
                'Checking AI context configuration...'
            );

            // Check if configuration is available
            if (!this.configService) {
                this.logWithFallback(
                    'debug',
                    'Config service not available, skipping AI context initialization'
                );
                return false;
            }

            // Get AI context configuration
            const aiContextConfig = await this._getAIContextConfiguration();
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                return false;
            }

            if (aiContextConfig?.aiContextEnabled !== true) {
                this.logWithFallback(
                    'debug',
                    'AI context disabled in configuration; leaving subtitles non-interactive'
                );
                await this._disableAIContextInteractions(owner, cleanupPromise);
                return true; // Not an error, just disabled
            }

            this.logWithFallback(
                'info',
                'Initializing AI context features with new modular system...',
                {
                    configKeyCount: Object.keys(aiContextConfig || {}).length,
                }
            );

            // Initialize side panel integration early so it captures events before modal listeners
            await this._initializeSidePanelIntegration(owner);
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                return false;
            }

            // Initialize new modular AI Context Manager
            return await this._initializeModularAIContextFeatures(
                aiContextConfig,
                owner
            );
        } catch {
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                preventStaleAIContextInteractionCommit(this, owner);
                return false;
            }
            this.logWithFallback(
                'error',
                'Error initializing AI context features.'
            );
            return false;
        }
    }

    /** @private */
    async _createAIContextManager(
        aiContextConfig,
        owner = this.aiContextFeatureOwner
    ) {
        if (!isAIContextFeatureOwnerCurrent(this, owner)) {
            throw new Error('Invalid AI context feature owner');
        }
        const { AIContextManager } = await import(
            chrome.runtime.getURL(
                'content_scripts/aicontext/core/AIContextManager.js'
            )
        );
        const ownerState = getAIContextFeatureOwnerState(owner);
        if (!isAIContextFeatureOwnerCurrent(this, owner) || !ownerState) {
            throw new Error('Invalid AI context feature owner');
        }

        const contentScriptFacade = createAIContextHostFacade(this);
        const analysisAuthority = this._createPrivateAnalysisAuthority(owner);
        if (!analysisAuthority) {
            throw new Error('Private analysis authority unavailable');
        }
        return new AIContextManager(this.getPlatformName(), {
            modal: {
                maxWidth: '900px',
                maxHeight: '80vh',
            },
            provider: {
                timeout: aiContextConfig.aiContextTimeout || 30000,
                maxRetries: 3,
            },
            textHandler: {
                maxSelectionLength: aiContextConfig.maxSelectionLength || 500,
                minSelectionLength: 2,
                smartBoundaries: true,
                autoAnalysis: true,
            },
            contentScript: contentScriptFacade,
            analysisAuthority,
        });
    }

    /** @private */
    async _initializeAIContextManagerCandidate(candidate, owner) {
        const initResult = await candidate.initialize();
        if (!initResult || !isAIContextFeatureOwnerCurrent(this, owner)) {
            return false;
        }

        await candidate.enableFeature('interactiveSubtitles');
        if (!isAIContextFeatureOwnerCurrent(this, owner)) return false;
        await candidate.enableFeature('contextModal');
        if (!isAIContextFeatureOwnerCurrent(this, owner)) return false;
        return isAIContextFeatureOwnerCurrent(this, owner);
    }

    /** @private */
    async _initializeModularAIContextFeatures(aiContextConfig, owner) {
        if (!isAIContextFeatureOwnerCurrent(this, owner)) return false;

        let candidate = null;
        let candidateOwnership = null;
        let requestCandidateCleanup = null;

        try {
            const candidatePromise = Promise.resolve().then(() =>
                this._createAIContextManager(aiContextConfig, owner)
            );
            candidateOwnership = trackAIContextManagerCandidateFactory(
                this,
                owner,
                candidatePromise
            );
            requestCandidateCleanup = candidateOwnership.requestCleanup;
            candidate = await candidatePromise;
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                candidateOwnership.setSetupPromise(Promise.resolve(false));
                await requestCandidateCleanup();
                return false;
            }
            if (
                candidate &&
                (typeof candidate === 'object' ||
                    typeof candidate === 'function') &&
                !candidateOwnership.claimCandidate(candidate)
            ) {
                candidateOwnership.setSetupPromise(Promise.resolve(false));
                await requestCandidateCleanup();
                return false;
            }

            const setupPromise = this._initializeAIContextManagerCandidate(
                candidate,
                owner
            );
            candidateOwnership.setSetupPromise(setupPromise);
            const initialized = await setupPromise;

            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                await requestCandidateCleanup();
                return false;
            }
            if (!initialized) {
                throw new Error('AIContextManager initialization failed');
            }

            registerAIContextInteractiveCleanup(this, owner);
            const interactiveInitialization =
                this._initializeSubtitleUtilsInteractiveFeatures(
                    aiContextConfig,
                    owner
                );
            trackAIContextInteractiveInitialization(
                this,
                owner,
                interactiveInitialization
            );
            await interactiveInitialization;
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                await requestCandidateCleanup();
                preventStaleAIContextInteractionCommit(this, owner);
                return false;
            }

            // Commit only after every asynchronous setup step still belongs to
            // this generation. Cleanup closures capture the candidate itself.
            this.aiContextManager = candidate;
            commitAIContextInteractionState(this, owner);
            this._setupAIContextEventListeners(owner);
            this._setupFullscreenHandling(owner);

            this.logWithFallback(
                'info',
                'New AI Context Manager initialized successfully'
            );
            return true;
        } catch {
            candidateOwnership?.setSetupPromise(Promise.resolve(false));
            if (requestCandidateCleanup) {
                await requestCandidateCleanup();
            } else if (candidate) {
                await destroyAIContextManagerCandidate(this, candidate);
            }

            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                preventStaleAIContextInteractionCommit(this, owner);
                return false;
            }

            this.logWithFallback(
                'error',
                'Failed to initialize new AI Context Manager, falling back to legacy system'
            );

            const legacyInitialization =
                this._initializeLegacyAIContextFeatures(aiContextConfig, owner);
            trackAIContextInteractiveInitialization(
                this,
                owner,
                legacyInitialization
            );
            const initialized = await legacyInitialization;
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                preventStaleAIContextInteractionCommit(this, owner);
                return false;
            }
            if (initialized) {
                commitAIContextInteractionState(this, owner);
            }
            return initialized;
        }
    }

    /**
     * Initialize legacy AI context features as fallback
     * @param {Object} _aiContextConfig - AI context configuration
     * @returns {Promise<boolean>} Success status
     * @private
     */
    async _initializeLegacyAIContextFeatures(
        aiContextConfig,
        owner = this.aiContextFeatureOwner
    ) {
        try {
            this.logWithFallback(
                'info',
                'Initializing legacy AI context features...'
            );

            // Initialize interactive subtitle features if subtitle utilities are available
            if (
                this.subtitleUtils &&
                this.subtitleUtils.initializeInteractiveSubtitleFeatures
            ) {
                const ownerState = getAIContextFeatureOwnerState(owner);
                if (
                    !ownerState ||
                    !isAIContextFeatureOwnerCurrent(this, owner)
                ) {
                    return false;
                }
                registerAIContextInteractiveCleanup(this, owner);
                const bindingCleanup =
                    await this.subtitleUtils.initializeInteractiveSubtitleFeatures(
                        {
                            enabled: true, // Always enable interactive subtitles
                            contextTypes: aiContextConfig.aiContextTypes || [
                                'cultural',
                                'historical',
                                'linguistic',
                            ],
                            interactionMethods: {
                                click: true, // Always enable click interactions
                                selection: true, // Always enable selection interactions
                            },
                            textSelection: {
                                maxLength: 100,
                                smartBoundaries: true,
                            },
                            loadingStates: {
                                timeout:
                                    aiContextConfig.aiContextTimeout || 30000,
                                retryAttempts:
                                    aiContextConfig.aiContextRetryAttempts || 3,
                            },
                            platform: this.getPlatformName(),
                        },
                        () => isAIContextFeatureOwnerCurrent(this, owner),
                        (intent) => this._handlePrivateWordIntent(owner, intent)
                    );
                registerAIContextFeatureCleanup(this, owner, bindingCleanup);
                if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                    preventStaleAIContextInteractionCommit(this, owner);
                    return false;
                }
                this.subtitleUtils.setInteractiveSubtitlesEnabled?.(true);

                this.logWithFallback(
                    'info',
                    'Legacy AI context features initialized successfully'
                );
                return true;
            } else {
                this.logWithFallback(
                    'warn',
                    'Subtitle utilities not available for legacy AI context initialization'
                );
                return false;
            }
        } catch {
            this.logWithFallback(
                'error',
                'Failed to initialize legacy AI context features'
            );
            return false;
        }
    }

    /**
     * Setup AI Context event listeners for cross-component communication
     * @private
     */
    _setupAIContextEventListeners(owner = this.aiContextFeatureOwner) {
        if (!this.aiContextManager) {
            this.logWithFallback(
                'debug',
                'AI Context Manager not available, skipping event listener setup'
            );
            return;
        }
        const ownerState = getAIContextFeatureOwnerState(owner);
        if (
            !ownerState ||
            !isAIContextFeatureOwnerCurrent(this, owner) ||
            ownerState.eventListenersAttached
        ) {
            return;
        }

        const registeredListeners = [];
        try {
            ownerState.eventListenersAttached = true;
            // Listen for system events from AI Context Manager
            const systemInitializedListener = () => {
                if (!isAIContextFeatureOwnerCurrent(this, owner)) return;
                this.logWithFallback('info', 'AI Context system initialized');
            };
            document.addEventListener(
                'dualsub-system-initialized',
                systemInitializedListener
            );
            registeredListeners.push([
                'dualsub-system-initialized',
                systemInitializedListener,
            ]);
            registerAIContextFeatureCleanup(this, owner, () => {
                document.removeEventListener(
                    'dualsub-system-initialized',
                    systemInitializedListener
                );
            });

            // Listen for analysis completion events
            const analysisCompleteListener = () => {
                if (!isAIContextFeatureOwnerCurrent(this, owner)) return;
                this.logWithFallback('debug', 'AI Context analysis completed');
            };
            document.addEventListener(
                'dualsub-analysis-complete',
                analysisCompleteListener
            );
            registeredListeners.push([
                'dualsub-analysis-complete',
                analysisCompleteListener,
            ]);
            registerAIContextFeatureCleanup(this, owner, () => {
                document.removeEventListener(
                    'dualsub-analysis-complete',
                    analysisCompleteListener
                );
            });

            // Listen for analysis error events
            const analysisErrorListener = () => {
                if (!isAIContextFeatureOwnerCurrent(this, owner)) return;
                this.logWithFallback('warn', 'AI Context analysis error');
            };
            document.addEventListener(
                'dualsub-analysis-error',
                analysisErrorListener
            );
            registeredListeners.push([
                'dualsub-analysis-error',
                analysisErrorListener,
            ]);
            registerAIContextFeatureCleanup(this, owner, () => {
                document.removeEventListener(
                    'dualsub-analysis-error',
                    analysisErrorListener
                );
            });

            // Listen for modal state changes
            const modalStateListener = () => {
                if (!isAIContextFeatureOwnerCurrent(this, owner)) return;
                this.logWithFallback('debug', 'AI Context modal state changed');
            };
            document.addEventListener(
                'dualsub-modal-state-change',
                modalStateListener
            );
            registeredListeners.push([
                'dualsub-modal-state-change',
                modalStateListener,
            ]);
            registerAIContextFeatureCleanup(this, owner, () => {
                document.removeEventListener(
                    'dualsub-modal-state-change',
                    modalStateListener
                );
            });

            this.logWithFallback(
                'debug',
                'AI Context event listeners setup complete'
            );
        } catch {
            for (const [eventName, listener] of registeredListeners) {
                document.removeEventListener(eventName, listener);
            }
            ownerState.eventListenersAttached = false;
            this.logWithFallback(
                'error',
                'Failed to setup AI Context event listeners'
            );
        }
    }

    /**
     * Setup fullscreen transition handling for UI root container
     * @private
     */
    _setupFullscreenHandling(owner = this.aiContextFeatureOwner) {
        const ownerState = getAIContextFeatureOwnerState(owner);
        if (
            !ownerState ||
            !isAIContextFeatureOwnerCurrent(this, owner) ||
            ownerState.fullscreenListenerAttached
        ) {
            return;
        }
        ownerState.fullscreenListenerAttached = true;

        const handleFullscreenChange = () => {
            if (!isAIContextFeatureOwnerCurrent(this, owner)) return;
            const uiRoot = getOrCreateUiRoot();
            const fullscreenElement = document.fullscreenElement;

            if (fullscreenElement) {
                // Entering fullscreen: move UI root into fullscreen element
                this.logWithFallback(
                    'info',
                    'Entering fullscreen, moving UI root.'
                );
                fullscreenElement.appendChild(uiRoot);
            } else {
                // Exiting fullscreen: move UI root back to body
                this.logWithFallback(
                    'info',
                    'Exiting fullscreen, moving UI root back to body.'
                );
                document.body.appendChild(uiRoot);
            }

            // Recalculate positions after container move
            if (this.subtitleUtils?.updateSubtitlePosition) {
                this.subtitleUtils.updateSubtitlePosition(this.activePlatform);
            }
        };

        try {
            document.addEventListener(
                'fullscreenchange',
                handleFullscreenChange
            );

            // Add cleanup for fullscreen listener
            registerAIContextFeatureCleanup(this, owner, () => {
                document.removeEventListener(
                    'fullscreenchange',
                    handleFullscreenChange
                );
            });

            this.logWithFallback('debug', 'Fullscreen handling setup complete');
        } catch {
            ownerState.fullscreenListenerAttached = false;
            this.logWithFallback(
                'error',
                'Failed to setup fullscreen handling'
            );
        }
    }

    /**
     * Initialize side panel integration for routing word selections
     * @param {Object} [owner] - Captured AI feature owner.
     * @returns {Promise<Object|null>} Current integration, or null when stale/unavailable.
     * @private
     */
    async _initializeSidePanelIntegration(owner = this.aiContextFeatureOwner) {
        let integration = null;
        try {
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                return null;
            }

            this.logWithFallback(
                'info',
                'Initializing side panel integration...'
            );

            // Cleanup existing integration to prevent duplicate listeners
            const previousIntegration = this.sidePanelIntegration;
            if (previousIntegration) {
                this.sidePanelIntegration = null;
                await destroySidePanelIntegrationCandidate(
                    this,
                    previousIntegration
                );
                if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                    return null;
                }
            }

            // Create inline side panel integration
            const isCurrent = () => isAIContextFeatureOwnerCurrent(this, owner);
            const logSidePanelCallbackFailure = () =>
                logAIContextLifecycleFailure(
                    this,
                    'error',
                    'Side panel integration callback failed.'
                );
            const sendSidePanelMessageSafely = (
                send,
                message,
                onExplicitFailure
            ) => {
                try {
                    const result = send(message);
                    void Promise.resolve(result).then(
                        (response) => {
                            if (
                                parseSidePanelContentSelectionSnapshotResponse(
                                    response
                                )?.status === 'rejected'
                            ) {
                                onExplicitFailure?.();
                            }
                        },
                        (error) => {
                            if (isProvenMessagingNonDelivery(error)) {
                                onExplicitFailure?.();
                                return;
                            }
                            logSidePanelCallbackFailure();
                        }
                    );
                } catch (error) {
                    if (isProvenMessagingNonDelivery(error)) {
                        onExplicitFailure?.();
                        return;
                    }
                    logSidePanelCallbackFailure();
                }
            };
            integration = {
                initialized: false,
                destroyed: false,
                useSidePanel: false,
                autoOpen: true,
                autoPauseVideo: true,
                storageChangeHandler: null,

                async initialize() {
                    if (this.initialized) return true;
                    if (this.destroyed || !isCurrent()) return false;

                    this._send = (message) =>
                        sendRuntimeMessageWithRetry(message, {
                            retries: 2,
                            baseDelayMs: 120,
                            canDispatch: () => !this.destroyed && isCurrent(),
                        });
                    if (this.destroyed || !isCurrent()) return false;

                    // Check settings
                    await this.checkSettings();
                    if (this.destroyed || !isCurrent()) return false;

                    // Listen for storage changes
                    this.storageChangeHandler = (changes, area) => {
                        if (area === 'sync') {
                            if (
                                changes.sidePanelUseSidePanel ||
                                changes.sidePanelAutoOpen ||
                                changes.sidePanelAutoPauseVideo
                            ) {
                                this.checkSettings();
                            }
                        }
                    };
                    chrome.storage.onChanged.addListener(
                        this.storageChangeHandler
                    );

                    this.initialized = true;
                    return true;
                },

                async checkSettings() {
                    try {
                        const settings = await chrome.storage.sync.get([
                            'sidePanelUseSidePanel',
                            'sidePanelAutoOpen',
                            'sidePanelAutoPauseVideo',
                        ]);
                        this.useSidePanel =
                            settings.sidePanelUseSidePanel !== false;
                        this.autoOpen = settings.sidePanelAutoOpen !== false;
                        this.autoPauseVideo =
                            settings.sidePanelAutoPauseVideo !== false;
                    } catch (error) {
                        this.useSidePanel = false;
                        this.autoOpen = false;
                        this.autoPauseVideo = false;
                    }
                },

                notifyWordIntent(onExplicitFailure) {
                    if (
                        this.destroyed ||
                        !this.initialized ||
                        !this.useSidePanel ||
                        !isCurrent()
                    ) {
                        return false;
                    }
                    sendSidePanelMessageSafely(
                        this._send,
                        buildSidePanelWordIntentMessage({
                            autoOpen: this.autoOpen,
                            pauseVideo: this.autoPauseVideo,
                        }),
                        onExplicitFailure
                    );
                    return true;
                },

                destroy() {
                    if (this.destroyed) return;
                    this.destroyed = true;
                    if (this.storageChangeHandler) {
                        chrome.storage.onChanged.removeListener(
                            this.storageChangeHandler
                        );
                        this.storageChangeHandler = null;
                    }
                    this._send = null;
                    this.initialized = false;
                },

                isSidePanelEnabled() {
                    return this.useSidePanel;
                },
            };

            const cleanupIntegration = () => {
                if (this.sidePanelIntegration === integration) {
                    this.sidePanelIntegration = null;
                }
                return destroySidePanelIntegrationCandidate(this, integration);
            };
            registerAIContextFeatureCleanup(this, owner, cleanupIntegration);

            const initialized = await integration.initialize();
            if (!initialized || !isAIContextFeatureOwnerCurrent(this, owner)) {
                await cleanupIntegration();
                return null;
            }

            this.sidePanelIntegration = integration;

            this.logWithFallback(
                'info',
                'Side panel integration initialized successfully',
                {
                    enabled: Boolean(integration.isSidePanelEnabled()),
                }
            );
            return integration;
        } catch (error) {
            if (integration) {
                await destroySidePanelIntegrationCandidate(this, integration);
            }
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                return null;
            }
            this.logWithFallback(
                'error',
                'Failed to initialize side panel integration'
            );
            // Non-critical error, continue without side panel integration
            return null;
        }
    }

    /** Disable click affordances and routing when AI context is disabled. */
    async _disableAIContextInteractions(
        owner = null,
        cleanupPromise = Promise.resolve()
    ) {
        if (!owner) {
            const transition = beginAIContextFeatureLifecycle(this);
            owner = transition.owner;
            cleanupPromise = transition.cleanupPromise;
        }

        try {
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                await cleanupPromise;
                return;
            }

            this._clearCanonicalContentSelection('clear', owner);
            setAIContextInteractionsEnabled(this, false);

            document
                .querySelectorAll(
                    '.dualsub-interactive-word, .dualsub-word-selected, .dualsub-interactive-word--hover'
                )
                .forEach((element) => {
                    element.classList.remove('dualsub-interactive-word');
                    element.classList.remove('dualsub-word-selected');
                    element.classList.remove('dualsub-interactive-word--hover');
                    element.removeAttribute('role');
                    element.removeAttribute('tabindex');
                });

            await cleanupPromise;
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to disable AI context interactions'
            );
        }
    }

    /**
     * Initialize interactive features in legacy SubtitleUtils system
     * This ensures subtitle formatting works with the new AI Context system
     * @param {Object} aiContextConfig - AI context configuration
     * @returns {Promise<void>}
     * @private
     */
    async _initializeSubtitleUtilsInteractiveFeatures(
        aiContextConfig,
        owner = this.aiContextFeatureOwner
    ) {
        try {
            this.logWithFallback(
                'info',
                'Initializing SubtitleUtils interactive features for new AI Context system',
                {
                    hasSubtitleUtils: Boolean(this.subtitleUtils),
                }
            );

            // Initialize interactive subtitle features in legacy SubtitleUtils
            if (
                this.subtitleUtils &&
                this.subtitleUtils.initializeInteractiveSubtitleFeatures
            ) {
                const ownerState = getAIContextFeatureOwnerState(owner);
                if (
                    !ownerState ||
                    !isAIContextFeatureOwnerCurrent(this, owner)
                ) {
                    return;
                }
                registerAIContextInteractiveCleanup(this, owner);
                const bindingCleanup =
                    await this.subtitleUtils.initializeInteractiveSubtitleFeatures(
                        {
                            enabled: true, // Always enable interactive subtitles
                            contextTypes: aiContextConfig.aiContextTypes || [
                                'cultural',
                                'historical',
                                'linguistic',
                            ],
                            interactionMethods: {
                                click: true, // Always enable click interactions
                                selection: true, // Always enable selection interactions
                            },
                            textSelection: {
                                maxLength: 100,
                                smartBoundaries: true,
                            },
                            loadingStates: {
                                timeout:
                                    aiContextConfig.aiContextTimeout || 30000,
                                retryAttempts:
                                    aiContextConfig.aiContextRetryAttempts || 3,
                            },
                            platform: this.getPlatformName(),
                        },
                        () => isAIContextFeatureOwnerCurrent(this, owner),
                        (intent) => this._handlePrivateWordIntent(owner, intent)
                    );
                registerAIContextFeatureCleanup(this, owner, bindingCleanup);
                if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                    preventStaleAIContextInteractionCommit(this, owner);
                    return;
                }
                this.subtitleUtils.setInteractiveSubtitlesEnabled?.(true);

                this.logWithFallback(
                    'info',
                    'SubtitleUtils interactive features initialized successfully'
                );
            } else {
                this.logWithFallback(
                    'warn',
                    'SubtitleUtils not available for interactive feature initialization',
                    {
                        hasSubtitleUtils: !!this.subtitleUtils,
                        hasInitMethod:
                            !!this.subtitleUtils
                                ?.initializeInteractiveSubtitleFeatures,
                    }
                );
            }
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to initialize SubtitleUtils interactive features'
            );
        }
    }

    /**
     * Get AI context configuration from config service
     * @returns {Promise<Object|null>} Verified AI context configuration
     * @private
     */
    async _getAIContextConfiguration() {
        try {
            const result = await this.configService.readMultipleResultStrict(
                AI_CONTEXT_CONFIGURATION_KEYS
            );
            return readExactOwnDataProjection(
                result,
                AI_CONTEXT_CONFIGURATION_KEYS,
                AI_CONTEXT_CONFIGURATION_KEY_SET
            );
        } catch {
            this.logWithFallback(
                'warn',
                'AI context configuration could not be verified.'
            );
            return null;
        }
    }

    /**
     * Loads required modules dynamically.
     * @returns {Promise<boolean>} `true` on success, `false` on failure.
     */
    async loadModules() {
        try {
            await this._loadSubtitleUtilities();
            await this._loadPlatformClass();
            await this._loadConfigService();
            await this._loadAndInitializeLogger();
            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error loading modules.');
            return false;
        }
    }

    /**
     * Loads the subtitle utilities module.
     * @private
     */
    _installContentSelectionPublisher(utilsModule) {
        const state = getContentSelectionAuthorityState(this);
        const beginPublisher = utilsModule?.beginSubtitleStatePublisher;
        if (!state || state.terminal || typeof beginPublisher !== 'function') {
            return false;
        }

        state.publisherInstallationGeneration += 1;
        const installationGeneration = state.publisherInstallationGeneration;
        const previousCleanup = state.publisherCleanup;
        state.publisherCleanup = null;
        try {
            previousCleanup?.();
        } catch (_) {}

        let cleanup;
        try {
            cleanup = beginPublisher({
                publishSubtitleState: (payload) => {
                    if (
                        state.terminal ||
                        state.publisherInstallationGeneration !==
                            installationGeneration
                    ) {
                        return;
                    }
                    this._handlePrivateSubtitleState(payload);
                },
            });
        } catch (_) {
            return false;
        }
        if (typeof cleanup !== 'function') return false;

        let cleaned = false;
        state.publisherCleanup = () => {
            if (cleaned) return;
            cleaned = true;
            if (
                state.publisherInstallationGeneration === installationGeneration
            ) {
                state.publisherCleanup = null;
            }
            try {
                cleanup();
            } catch (_) {}
        };
        return true;
    }

    _handlePrivateSubtitleState(payload) {
        const state = getContentSelectionAuthorityState(this);
        if (
            !state ||
            state.terminal ||
            !payload ||
            !Number.isSafeInteger(payload.renderRevision) ||
            payload.renderRevision <= 0 ||
            (state.currentRenderRevision !== null &&
                payload.renderRevision <= state.currentRenderRevision) ||
            !['render', 'refresh', 'expired', 'clear'].includes(payload.reason)
        ) {
            return false;
        }

        state.pendingRemoval = null;
        state.selectionModel.clear();
        clearContentSelectionHighlights();
        state.currentRenderRevision = payload.renderRevision;
        const selectionRevision = allocateContentSelectionRevision(state);
        if (selectionRevision === null) {
            state.terminal = true;
            return false;
        }
        const snapshot = createCanonicalContentSelectionSnapshot(
            state,
            selectionRevision,
            payload.renderRevision,
            'subtitle-change',
            []
        );
        if (!snapshot) return false;
        state.snapshot = snapshot;

        void queueContentSelectionSnapshot(this, snapshot);
        const owner = this.aiContextFeatureOwner;
        publishSelectionSnapshotToOwner(owner, snapshot);
        const ownerState = getAIContextFeatureOwnerState(owner);
        try {
            ownerState?.channel.publish(
                AI_CONTEXT_SIGNAL_TYPES.SUBTITLE_CHANGED,
                payload
            );
        } catch (_) {}
        return true;
    }

    _clearCanonicalContentSelection(
        reason = 'clear',
        owner = this.aiContextFeatureOwner
    ) {
        const state = getContentSelectionAuthorityState(this);
        if (!state || state.terminal) return null;

        state.pendingRemoval = null;
        state.selectionModel.clear();
        const renderRevision =
            state.currentRenderRevision ?? state.snapshot?.renderRevision;
        const selectionRevision = Number.isSafeInteger(renderRevision)
            ? allocateContentSelectionRevision(state)
            : null;
        const snapshot =
            selectionRevision === null
                ? null
                : createCanonicalContentSelectionSnapshot(
                      state,
                      selectionRevision,
                      renderRevision,
                      reason,
                      []
                  );
        if (snapshot) {
            state.snapshot = snapshot;
            void queueContentSelectionSnapshot(this, snapshot);
            publishSelectionSnapshotToOwner(owner, snapshot);
        }
        clearContentSelectionHighlights();
        return snapshot;
    }

    async _repairCanonicalContentSelection(state, current) {
        if (!state || state.terminal || state.snapshot !== current) {
            return false;
        }
        const selectionRevision = allocateContentSelectionRevision(state);
        const entries = state.selectionModel.getOrderedEntries();
        const repair =
            selectionRevision === null
                ? null
                : createCanonicalContentSelectionSnapshot(
                      state,
                      selectionRevision,
                      current.renderRevision,
                      entries.length > 0 ? 'restore' : 'clear',
                      entries
                  );
        if (!repair) return false;

        state.snapshot = repair;
        publishSelectionSnapshotToOwner(this.aiContextFeatureOwner, repair);
        return await queueContentSelectionSnapshot(
            this,
            repair,
            () => !state.terminal && state.snapshot === repair
        );
    }

    _findPrivateSelectionWordElement(intent) {
        try {
            return (
                this.subtitleUtils?.resolveInteractiveOriginalWordOccurrence?.(
                    intent
                ) ?? null
            );
        } catch (_) {
            return null;
        }
    }

    _clearPrivateSelectionWordProjection(intent) {
        try {
            const container = document.getElementById(
                'dualsub-original-subtitle'
            );
            if (
                !container ||
                !Number.isSafeInteger(intent?.renderRevision) ||
                intent.renderRevision <= 0 ||
                !Number.isSafeInteger(intent?.wordIndex) ||
                intent.wordIndex < 0 ||
                typeof intent?.word !== 'string' ||
                intent.word.length === 0
            ) {
                return false;
            }

            let cleared = false;
            for (const element of container.querySelectorAll(
                '.dualsub-word-selected[data-render-revision][data-word-index][data-word]'
            )) {
                if (
                    element.getAttribute('data-render-revision') ===
                        String(intent.renderRevision) &&
                    element.getAttribute('data-word-index') ===
                        String(intent.wordIndex) &&
                    element.getAttribute('data-word') === intent.word
                ) {
                    element.classList.remove('dualsub-word-selected');
                    cleared = true;
                }
            }
            return cleared;
        } catch (_) {
            return false;
        }
    }

    _handlePrivateWordIntent(owner, intent) {
        const state = getContentSelectionAuthorityState(this);
        if (
            !state ||
            state.terminal ||
            state.pendingRemoval ||
            !isAIContextFeatureOwnerCurrent(this, owner) ||
            !intent ||
            intent.action !== 'toggle' ||
            intent.renderRevision !== state.currentRenderRevision ||
            !Number.isSafeInteger(intent.wordIndex) ||
            intent.wordIndex < 0 ||
            typeof intent.word !== 'string' ||
            intent.word.length === 0
        ) {
            return false;
        }

        const element = this._findPrivateSelectionWordElement(intent);
        if (!element) return false;
        const positionKey = `original:${intent.renderRevision}:${intent.wordIndex}`;
        const position = {
            wordIndex: intent.wordIndex,
            index: intent.wordIndex,
            subtitleType: 'original',
            element,
        };
        const toggleResult = state.selectionModel.toggle(
            intent.word,
            position,
            positionKey
        );
        if (toggleResult === 'noop') return false;

        const candidateRevision =
            state.lastAllocatedSelectionRevision < Number.MAX_SAFE_INTEGER
                ? state.lastAllocatedSelectionRevision + 1
                : null;
        const entries = state.selectionModel.getOrderedEntries();
        const snapshot =
            candidateRevision === null
                ? null
                : createCanonicalContentSelectionSnapshot(
                      state,
                      candidateRevision,
                      intent.renderRevision,
                      'toggle',
                      entries
                  );
        if (!snapshot) {
            state.selectionModel.toggle(intent.word, position, positionKey);
            return false;
        }

        state.lastAllocatedSelectionRevision = candidateRevision;
        state.snapshot = snapshot;
        element.classList.toggle(
            'dualsub-word-selected',
            toggleResult === 'added'
        );
        void queueContentSelectionSnapshot(this, snapshot);

        publishSelectionSnapshotToOwner(owner, snapshot);
        if (
            state.terminal ||
            state.snapshot !== snapshot ||
            state.currentRenderRevision !== intent.renderRevision ||
            !isAIContextFeatureOwnerCurrent(this, owner)
        ) {
            return true;
        }

        let fallbackPublished = false;
        const publishLegacyWordIntent = () => {
            const currentState = getContentSelectionAuthorityState(this);
            if (
                fallbackPublished ||
                currentState !== state ||
                state.terminal ||
                state.snapshot !== snapshot ||
                state.currentRenderRevision !== intent.renderRevision ||
                !isAIContextFeatureOwnerCurrent(this, owner)
            ) {
                return false;
            }
            fallbackPublished = true;
            const ownerState = getAIContextFeatureOwnerState(owner);
            try {
                ownerState?.channel.publish(
                    AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT,
                    intent
                );
            } catch (_) {}
            return true;
        };

        let handledBySidePanel = false;
        try {
            handledBySidePanel =
                this.sidePanelIntegration?.notifyWordIntent?.(
                    publishLegacyWordIntent
                ) === true;
        } catch (_) {}
        if (
            state.terminal ||
            state.snapshot !== snapshot ||
            state.currentRenderRevision !== intent.renderRevision ||
            !isAIContextFeatureOwnerCurrent(this, owner)
        ) {
            return true;
        }
        if (handledBySidePanel) return true;
        publishLegacyWordIntent();
        return true;
    }

    _createPrivateAnalysisAuthority(owner) {
        const state = getContentSelectionAuthorityState(this);
        const ownerState = getAIContextFeatureOwnerState(owner);
        if (
            !state ||
            state.terminal ||
            !ownerState ||
            !isAIContextFeatureOwnerCurrent(this, owner)
        ) {
            return null;
        }
        return Object.freeze({
            channel: ownerState.channel,
            allocateRequestId: () => {
                if (
                    state.terminal ||
                    !isAIContextFeatureOwnerCurrent(this, owner)
                ) {
                    return null;
                }
                return allocateMonotonicPositiveSafeInteger('analysisRequest');
            },
            getSelectionSnapshot: () => {
                if (
                    state.terminal ||
                    !isAIContextFeatureOwnerCurrent(this, owner)
                ) {
                    return null;
                }
                return state.snapshot;
            },
            clearSelection: () => {
                if (
                    state.terminal ||
                    !isAIContextFeatureOwnerCurrent(this, owner)
                ) {
                    return false;
                }
                return Boolean(
                    this._clearCanonicalContentSelection('clear', owner)
                );
            },
        });
    }

    async _loadSubtitleUtilities() {
        try {
            const utilsUrl = chrome.runtime.getURL(
                'content_scripts/shared/subtitleUtilities.js'
            );
            this.logWithFallback('debug', 'Loading subtitle utilities.');
            const utilsModule = await import(utilsUrl);
            this.subtitleUtils = utilsModule;
            this._installContentSelectionPublisher(utilsModule);
        } catch (error) {
            this.logWithFallback('error', 'Failed to load subtitle utilities.');
            throw error;
        }
    }

    /**
     * Loads the platform-specific class.
     * @private
     */
    async _loadPlatformClass() {
        try {
            const platformName = this.getPlatformName();
            const fileName = this._getPlatformFileName(platformName);
            const className = this.getPlatformClass();
            const platformUrl = chrome.runtime.getURL(
                `video_platforms/${fileName}`
            );

            this.logWithFallback('debug', 'Loading platform class.');

            const platformModule = await import(platformUrl);
            this.PlatformClass = platformModule[className];

            if (!this.PlatformClass) {
                throw new Error(
                    `Platform class '${className}' not found in module.`
                );
            }
        } catch (error) {
            this.logWithFallback('error', 'Failed to load platform class.');
            throw error;
        }
    }

    /**
     * Gets the platform file name from the platform name.
     * @private
     * @param {string} _platformName - The name of the platform.
     * @returns {string} The corresponding file name.
     */
    _getPlatformFileName(platformName) {
        if (platformName === 'disneyplus') return 'disneyPlusPlatform.js';
        if (platformName === 'netflix') return 'netflixPlatform.js';
        return `${platformName.charAt(0).toUpperCase()}${platformName.slice(1)}Platform.js`;
    }

    /**
     * Gets the platform class name from the platform name.
     * @private
     * @param {string} platformName - The name of the platform.
     * @returns {string} The corresponding class name.
     */
    _getPlatformClassName(_platformName) {
        return this.getPlatformClass();
    }

    /**
     * Loads the configuration service.
     * @private
     */
    async _loadConfigService() {
        try {
            const configUrl = chrome.runtime.getURL(
                'services/configService.js'
            );
            this.logWithFallback('debug', 'Loading config service.');
            const configModule = await import(configUrl);
            this.configService = configModule.configService;

            if (!this.configService) {
                throw new Error('configService not found in module.');
            }
        } catch (error) {
            this.logWithFallback('error', 'Failed to load config service.');
            throw error;
        }
    }

    /**
     * Loads and initializes the logger.
     * @private
     */
    async _loadAndInitializeLogger() {
        try {
            const loggerUrl = chrome.runtime.getURL('utils/logger.js');
            this.logWithFallback('debug', 'Loading logger.');
            const loggerModule = await import(loggerUrl);
            const Logger = loggerModule.default;

            if (!Logger) {
                throw new Error('Logger not found in module.');
            }

            this.contentLogger = Logger.create(this.logPrefix);
            await this._initializeLoggerLevel(Logger);
        } catch (error) {
            this.logWithFallback(
                'error',
                'Failed to load and initialize logger.'
            );
            throw error;
        }
    }

    /**
     * Initializes the logger level from configuration.
     * @private
     * @param {Object} Logger - The Logger class.
     */
    async _initializeLoggerLevel(Logger) {
        try {
            const loggingLevel = await this.configService.get('loggingLevel');
            this.contentLogger.updateLevel(loggingLevel);
            this.contentLogger.info('Content script logger initialized');
        } catch (error) {
            // Fallback to INFO level if config can't be read
            this.contentLogger.updateLevel(Logger.LEVELS.INFO);
            this.contentLogger.warn(
                'Failed to load logging level from config, using INFO level'
            );
        }
    }

    /**
     * Initialize the platform instance with error handling and retry logic
     * Template method that orchestrates platform initialization with robust error handling
     * @param {number} retryCount - Current retry attempt (internal use)
     * @returns {Promise<boolean>} Success status
     */
    initializePlatform(retryCount = 0) {
        if (this.isCleanedUp) {
            this.logWithFallback(
                'debug',
                'Platform initialization skipped after comprehensive cleanup'
            );
            return Promise.resolve(false);
        }

        if (this.platformInitializationPromise) {
            return this.platformInitializationPromise;
        }

        const generation = this.platformInitializationGeneration;
        let resolveInitialization;
        let rejectInitialization;
        const initializationPromise = new Promise((resolve, reject) => {
            resolveInitialization = resolve;
            rejectInitialization = reject;
        });

        // Claim the single-flight slot before any initialization collaborator
        // can run synchronously and re-enter this public method.
        this.platformInitializationPromise = initializationPromise;
        try {
            Promise.resolve(
                this._initializePlatformForGeneration(retryCount, generation)
            ).then(resolveInitialization, rejectInitialization);
        } catch (error) {
            rejectInitialization(error);
        }

        const clearInitializationPromise = () => {
            if (this.platformInitializationPromise === initializationPromise) {
                this.platformInitializationPromise = null;
            }
        };
        initializationPromise.then(
            clearInitializationPromise,
            clearInitializationPromise
        );

        return initializationPromise;
    }

    /**
     * Invalidate pending platform work and allow a new lifecycle generation.
     * Subclasses should call this before navigation-specific platform teardown.
     * @protected
     * @returns {number} The new lifecycle generation.
     */
    _invalidatePlatformInitialization() {
        this._cancelPlayerRootObservation();
        this._cancelPlatformRetry();
        this._cancelPageEnterTask();
        this._cancelVisibilityVideoSetupRetry();
        this.platformInitializationGeneration += 1;
        this.platformInitializationPromise = null;
        this.lastVideoSetupScope = null;
        return this.platformInitializationGeneration;
    }

    /**
     * Schedule the single navigation-delayed page-enter task for this lifecycle.
     * Replacing or invalidating the lifecycle cancels the prior task.
     * @protected
     * @param {Function} callback - Receives the captured platform generation.
     * @param {number} delay - Delay in milliseconds.
     */
    _schedulePageEnterTask(callback, delay) {
        this._cancelPageEnterTask();

        const generation = this.platformInitializationGeneration;
        const task = { timeoutId: null };
        this.pageEnterTask = task;
        task.timeoutId = setTimeout(() => {
            if (this.pageEnterTask !== task) {
                return;
            }
            task.timeoutId = null;
            const isCurrent = () =>
                this.pageEnterTask === task &&
                this._isPlatformGenerationCurrent(generation);
            if (!isCurrent()) {
                return;
            }

            let taskResult;
            try {
                taskResult = callback(generation, isCurrent);
            } catch {
                this.logWithFallback('error', 'Delayed page-enter task failed');
                if (this.pageEnterTask === task) {
                    this.pageEnterTask = null;
                }
                return;
            }

            Promise.resolve(taskResult)
                .catch(() => {
                    this.logWithFallback(
                        'error',
                        'Delayed page-enter task failed'
                    );
                })
                .finally(() => {
                    if (this.pageEnterTask === task) {
                        this.pageEnterTask = null;
                    }
                });
        }, delay);
    }

    /**
     * Schedule the shared player-page initialization flow for a navigation.
     * Generation and route checks bracket every asynchronous boundary.
     * @protected
     * @param {Function} loadConfig - Returns the configuration projection.
     * @param {Function} isPlayerPageActive - Returns whether the route is still a player.
     * @param {number} [delay=1500] - Navigation settling delay.
     */
    _schedulePlatformInitializationOnPageEnter(
        loadConfig,
        isPlayerPageActive,
        delay = 1500
    ) {
        this._schedulePageEnterTask(async (_generation, isCurrent) => {
            try {
                if (!isCurrent() || !isPlayerPageActive()) {
                    return;
                }

                const config = await loadConfig();
                if (
                    !isCurrent() ||
                    !isPlayerPageActive() ||
                    !config?.subtitlesEnabled
                ) {
                    return;
                }

                this.logWithFallback(
                    'info',
                    'Subtitles enabled, initializing platform.'
                );
                const initialized = await this.initializePlatform();
                if (
                    initialized !== true ||
                    !isCurrent() ||
                    !isPlayerPageActive()
                ) {
                    return;
                }

                if (config?.aiContextEnabled) {
                    try {
                        await this._restartAIContextFeatures();
                    } catch {
                        this.logWithFallback(
                            'warn',
                            'AI Context restart on page enter failed'
                        );
                    }
                }
            } catch {
                this.logWithFallback(
                    'error',
                    'Error during URL change initialization.'
                );
            }
        }, delay);
    }

    /**
     * Cancel the currently owned delayed page-enter task.
     * @private
     */
    _cancelPageEnterTask() {
        const task = this.pageEnterTask;
        this.pageEnterTask = null;
        if (task?.timeoutId !== null && task?.timeoutId !== undefined) {
            clearTimeout(task.timeoutId);
        }
    }

    /**
     * Tear down the player-page platform lifecycle without terminating the
     * content-script instance. Navigation callers intentionally do not await
     * platform cleanup, so all shared state is detached synchronously first.
     * @protected
     */
    _cleanupOnPlayerPageLeave() {
        const platform = this.activePlatform;
        this.activePlatform = null;
        this.platformReady = false;
        this._invalidatePlatformInitialization();
        try {
            this.stopVideoElementDetection();
        } catch {
            this.logWithFallback(
                'warn',
                'Failed to stop video detection on page leave'
            );
        }

        if (this.subtitleUtils) {
            try {
                this.subtitleUtils.clearSubtitlesDisplayAndQueue?.(
                    platform,
                    true,
                    this.logPrefix
                );
            } catch {
                this.logWithFallback(
                    'warn',
                    'Failed to clear subtitle display and queue on page leave'
                );
            }

            try {
                this.subtitleUtils.clearSubtitleDOM?.();
            } catch {
                this.logWithFallback(
                    'warn',
                    'Failed to clear subtitle DOM on page leave'
                );
            }
        }

        try {
            this.eventBuffer?.clear();
        } catch {
            this.logWithFallback(
                'warn',
                'Failed to clear event buffer on page leave'
            );
        }

        this._cleanupPlatformCandidate(platform).catch(() => {
            this.logWithFallback(
                'warn',
                'Error cleaning up platform after leaving player page'
            );
        });
    }

    /**
     * Cancel a pending Base-owned platform retry and settle its wait.
     * @private
     */
    _cancelPlatformRetry() {
        if (this.platformRetryTimeoutId !== null) {
            clearTimeout(this.platformRetryTimeoutId);
            this.platformRetryTimeoutId = null;
        }

        const resolveRetry = this.platformRetryResolve;
        this.platformRetryResolve = null;
        if (resolveRetry) {
            resolveRetry(false);
        }
    }

    /**
     * Check whether asynchronous work still belongs to the active lifecycle.
     * @private
     * @param {number} generation - Captured lifecycle generation.
     * @param {Object|null} [platform=null] - Optional captured platform candidate.
     * @returns {boolean} Whether the work may mutate shared state.
     */
    _isPlatformGenerationCurrent(generation, platform = null) {
        return (
            generation === this.platformInitializationGeneration &&
            (!platform || this.activePlatform === platform)
        );
    }

    /**
     * Run one generation of the platform initialization flow.
     * @private
     * @param {number} retryCount - Current retry attempt.
     * @param {number} generation - Lifecycle generation captured by the caller.
     * @returns {Promise<boolean>} Success status.
     */
    async _initializePlatformForGeneration(retryCount, generation) {
        const initializationContext =
            this._createInitializationContext(retryCount);

        if (!this._validateInitializationPrerequisites()) {
            return false;
        }

        try {
            return await this._executeInitializationFlow(
                initializationContext,
                generation
            );
        } catch (error) {
            return await this._handleInitializationError(
                error,
                initializationContext,
                generation
            );
        }
    }

    /**
     * Create initialization context with configuration and state
     * @private
     * @param {number} retryCount - Current retry attempt
     * @returns {Object} Initialization context
     */
    _createInitializationContext(retryCount) {
        const retryConfig = this._getRetryConfiguration();

        return {
            retryCount,
            maxRetries: retryConfig.maxRetries,
            retryDelay: retryConfig.retryDelay,
            attempt: retryCount + 1,
            totalAttempts: retryConfig.maxRetries + 1,
            platform: null,
        };
    }

    /**
     * Validate essential prerequisites for initialization (only platform class).
     * @private
     * @returns {boolean} Whether prerequisites are met
     */
    _validateInitializationPrerequisites() {
        return this._validateModulesLoaded();
    }

    /**
     * Execute the main initialization flow
     * @private
     * @param {Object} context - Initialization context
     * @returns {Promise<boolean>} Success status
     */
    async _executeInitializationFlow(context, generation) {
        this._logInitializationStart(context);

        await this._prepareForInitialization();
        if (!this._isPlatformGenerationCurrent(generation)) {
            return false;
        }

        const platform = await this._createPlatformInstance();
        context.platform = platform;
        if (!this._isPlatformGenerationCurrent(generation)) {
            await this._cleanupPlatformCandidate(platform);
            return false;
        }

        this.activePlatform = platform;

        return await this._initializeBasedOnPageType(platform, generation);
    }

    // ========================================
    // PLATFORM INITIALIZATION HELPERS - Private methods for initialization flow
    // ========================================

    /**
     * Get retry configuration from current config or defaults
     * @private
     * @returns {Object} Retry configuration
     */
    _getRetryConfiguration() {
        return {
            maxRetries:
                this.currentConfig?.platformInitMaxRetries ??
                COMMON_CONSTANTS.PLATFORM_INIT_MAX_RETRIES,
            retryDelay:
                this.currentConfig?.platformInitRetryDelay ??
                COMMON_CONSTANTS.PLATFORM_INIT_RETRY_DELAY,
        };
    }

    /**
     * Validate that required modules are loaded
     * @private
     * @returns {boolean} Validation result
     */
    _validateModulesLoaded() {
        if (!this.PlatformClass || !this.subtitleUtils || !this.configService) {
            this.logWithFallback(
                'error',
                'Required modules not loaded for platform initialization'
            );
            return false;
        }
        return true;
    }

    /**
     * Log initialization start with attempt information
     * @private
     * @param {Object} context - Initialization context
     */
    _logInitializationStart(context) {
        this.logWithFallback('info', 'Starting platform initialization', {
            attempt: context.attempt,
            maxRetries: context.totalAttempts,
        });
    }

    /**
     * Prepare for platform initialization
     * @private
     * @returns {Promise<void>}
     */
    async _prepareForInitialization() {
        // Sync subtitleUtils state with saved configuration
        if (
            this.subtitleUtils &&
            typeof this.subtitleUtils.setSubtitlesActive === 'function'
        ) {
            this.subtitleUtils.setSubtitlesActive(
                this.currentConfig.subtitlesEnabled
            );
        }

        // Clean up any existing platform instance
        if (this.activePlatform) {
            await this._cleanupPlatformInstance();
        }
    }

    /**
     * Initialize platform based on page type (player vs non-player)
     * @private
     * @returns {Promise<boolean>} Success status
     */
    async _initializeBasedOnPageType(platform, generation) {
        // Check if this candidate was cleaned up during initialization
        if (!this._isPlatformGenerationCurrent(generation, platform)) {
            this.logWithFallback(
                'warn',
                'Platform cleaned up during initialization, aborting'
            );
            return false;
        }

        if (platform.isPlayerPageActive()) {
            return await this._initializeForPlayerPage(platform, generation);
        } else {
            return this._initializeForNonPlayerPage(platform, generation);
        }
    }

    /**
     * Initialize platform for player page
     * @private
     * @returns {Promise<boolean>} Success status
     */
    async _initializeForPlayerPage(platform, generation) {
        this.logWithFallback('info', 'Initializing platform on player page');

        await this._initializePlatformWithTimeout(platform, generation);

        // Check if this candidate was cleaned up during async initialization
        if (!this._isPlatformGenerationCurrent(generation, platform)) {
            this.logWithFallback(
                'warn',
                'Platform cleaned up during player page initialization, aborting'
            );
            await this._cleanupPlatformCandidate(platform);
            return false;
        }

        platform.handleNativeSubtitles();

        this.platformReady = true;
        this.processBufferedEvents();
        this.startVideoElementDetection();

        this.logWithFallback(
            'info',
            'Platform initialization completed successfully'
        );
        return true;
    }

    /**
     * Initialize platform for non-player page
     * @private
     * @returns {boolean} Success status
     */
    _initializeForNonPlayerPage(platform, generation) {
        if (!this._isPlatformGenerationCurrent(generation, platform)) {
            return false;
        }
        this.logWithFallback('info', 'Not on a player page. UI setup deferred');
        if (this.subtitleUtils && this.subtitleUtils.hideSubtitleContainer) {
            this.subtitleUtils.hideSubtitleContainer();
        }
        return true;
    }

    /**
     * Handle initialization error with retry logic
     * @private
     * @param {Error} error - The error that occurred
     * @param {Object} context - Initialization context
     * @returns {Promise<boolean>} Success status
     */
    async _handleInitializationError(error, context, generation) {
        if (!this._isPlatformGenerationCurrent(generation, context.platform)) {
            await this._cleanupPlatformCandidate(context.platform);
            return false;
        }

        if (error.message?.includes('Extension context invalidated')) {
            this.logWithFallback(
                'warn',
                'Extension context invalidated during platform initialization. Aborting and cleaning up.'
            );
            await this.cleanup();
            return false;
        }

        this.logWithFallback('error', 'Error initializing platform', {
            attempt: context.attempt,
            maxRetries: context.totalAttempts,
        });

        await this._cleanupPartialInitialization(context.platform, generation);

        if (!this._isPlatformGenerationCurrent(generation)) {
            return false;
        }

        if (context.retryCount < context.maxRetries) {
            return await this._scheduleRetry(
                context.retryCount,
                context.retryDelay,
                generation
            );
        } else {
            return this._handleMaxRetriesExceeded();
        }
    }

    /**
     * Schedule a retry with exponential backoff
     * @private
     * @param {number} retryCount - Current retry count
     * @param {number} baseDelay - Base delay for retry
     * @param {number} generation - Captured lifecycle generation
     * @returns {Promise<boolean>} Success status
     */
    async _scheduleRetry(retryCount, baseDelay, generation) {
        const delay = baseDelay * Math.pow(2, retryCount);
        this.logWithFallback('info', 'Retrying platform initialization', {
            nextAttempt: retryCount + 2,
            delay,
        });

        return new Promise((resolve) => {
            if (!this._isPlatformGenerationCurrent(generation)) {
                resolve(false);
                return;
            }

            this._cancelPlatformRetry();
            this.platformRetryResolve = resolve;
            this.platformRetryTimeoutId = setTimeout(async () => {
                this.platformRetryTimeoutId = null;
                this.platformRetryResolve = null;
                if (!this._isPlatformGenerationCurrent(generation)) {
                    resolve(false);
                    return;
                }

                const result = await this._initializePlatformForGeneration(
                    retryCount + 1,
                    generation
                );
                resolve(result);
            }, delay);
        });
    }

    /**
     * Handle case when maximum retries are exceeded
     * @private
     * @returns {boolean} Success status (always false)
     */
    _handleMaxRetriesExceeded() {
        this.logWithFallback(
            'error',
            'Platform initialization failed after all retry attempts'
        );
        this._cancelPlayerRootObservation();
        this.activePlatform = null;
        this.platformReady = false;
        return false;
    }

    /**
     * Validate platform prerequisites before initialization
     * @private
     * @returns {boolean} Validation result
     */
    _validatePlatformPrerequisites() {
        if (!this.PlatformClass) {
            this.logWithFallback('error', 'Platform class not loaded');
            return false;
        }

        if (!this.subtitleUtils) {
            this.logWithFallback('error', 'Subtitle utilities not loaded');
            return false;
        }

        if (!this.configService) {
            this.logWithFallback('error', 'Config service not loaded');
            return false;
        }

        if (!this.currentConfig) {
            this.logWithFallback('error', 'Configuration not loaded');
            return false;
        }

        return true;
    }

    /**
     * Create platform instance with error handling
     * @private
     * @returns {Promise<Object>} Platform instance
     */
    async _createPlatformInstance() {
        try {
            const platform = new this.PlatformClass();
            this.logWithFallback(
                'debug',
                'Platform instance created successfully'
            );
            return platform;
        } catch (error) {
            this.logWithFallback('error', 'Failed to create platform instance');
            throw new Error(`Platform instantiation failed: ${error.message}`);
        }
    }

    /**
     * Initialize platform with timeout protection
     * @private
     * @returns {Promise<void>}
     */
    async _initializePlatformWithTimeout(
        platform = this.activePlatform,
        generation = this.platformInitializationGeneration
    ) {
        const timeout =
            this.currentConfig?.platformInitTimeout ||
            COMMON_CONSTANTS.PLATFORM_INIT_TIMEOUT;

        const initPromise = platform.initialize(
            (subtitleData) => {
                if (this._isPlatformGenerationCurrent(generation, platform)) {
                    this.handleSubtitleDataFound(subtitleData);
                }
            },
            (newVideoId) => {
                if (this._isPlatformGenerationCurrent(generation, platform)) {
                    this.handleVideoIdChange(newVideoId);
                }
            }
        );

        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(
                    new Error(
                        `Platform initialization timed out after ${timeout}ms`
                    )
                );
            }, timeout);
        });

        try {
            await Promise.race([initPromise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutId);
        }
        this.logWithFallback('debug', 'Platform initialized within timeout');
    }

    /**
     * Clean up existing platform instance
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupPlatformInstance(platform = this.activePlatform) {
        const wasActivePlatform = this.activePlatform === platform;
        if (wasActivePlatform) {
            this._cancelPlayerRootObservation();
            this.activePlatform = null;
            this.platformReady = false;
        }

        try {
            if (await this._cleanupPlatformCandidate(platform)) {
                this.logWithFallback(
                    'debug',
                    'Previous platform instance cleaned up'
                );
            }
        } catch {
            this.logWithFallback(
                'warn',
                'Error cleaning up previous platform instance'
            );
        }
    }

    /**
     * Clean up one captured platform candidate at most once.
     * @private
     * @param {Object|null} platform - Captured platform candidate.
     * @returns {Promise<boolean>} Whether cleanup was invoked.
     */
    async _cleanupPlatformCandidate(platform) {
        if (
            !platform ||
            typeof platform !== 'object' ||
            this.cleanedPlatformInstances.has(platform)
        ) {
            return false;
        }

        this.cleanedPlatformInstances.add(platform);
        if (typeof platform.cleanup === 'function') {
            await platform.cleanup();
            return true;
        }
        return false;
    }

    /**
     * Clean up partial initialization state
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupPartialInitialization(
        platform = this.activePlatform,
        generation = this.platformInitializationGeneration
    ) {
        if (!this._isPlatformGenerationCurrent(generation, platform)) {
            try {
                await this._cleanupPlatformCandidate(platform);
            } catch {
                this.logWithFallback(
                    'warn',
                    'Error cleaning up stale platform candidate'
                );
            }
            return;
        }

        try {
            this.stopVideoElementDetection();
        } catch {
            this.logWithFallback(
                'warn',
                'Error stopping video detection during partial cleanup'
            );
        }

        if (platform) {
            await this._cleanupPlatformInstance(platform);
        }

        if (!this._isPlatformGenerationCurrent(generation)) {
            return;
        }

        try {
            this.eventBuffer.clear();
        } catch {
            this.logWithFallback(
                'warn',
                'Error clearing event buffer during partial cleanup'
            );
        }

        this.platformReady = false;
        this.logWithFallback(
            'debug',
            'Partial initialization state cleaned up'
        );
    }

    // ========================================
    // CONFIGURATION MANAGEMENT
    // ========================================

    /**
     * Normalize configuration to handle backward compatibility
     * @private
     */
    _normalizeConfiguration() {
        // Handle transition from useNativeSubtitles to useOfficialTranslations
        if (
            this.currentConfig.useOfficialTranslations === undefined &&
            this.currentConfig.useNativeSubtitles !== undefined
        ) {
            this.currentConfig.useOfficialTranslations =
                this.currentConfig.useNativeSubtitles;
            this.logWithFallback(
                'debug',
                'Normalized useOfficialTranslations from useNativeSubtitles',
                {
                    value: Boolean(this.currentConfig.useOfficialTranslations),
                }
            );
        }

        // Ensure useOfficialTranslations has a default value
        if (this.currentConfig.useOfficialTranslations === undefined) {
            this.currentConfig.useOfficialTranslations = true; // Default to true
            this.logWithFallback(
                'debug',
                'Set default useOfficialTranslations value',
                {
                    value: Boolean(this.currentConfig.useOfficialTranslations),
                }
            );
        }
    }

    /**
     * Setup configuration change listeners
     */
    setupConfigurationListeners() {
        if (!this._acceptsConfigurationSubscriptions()) {
            return;
        }

        const subscriptionGeneration = ++this
            .configurationSubscriptionGeneration;
        this.configurationRefreshGeneration += 1;

        // Take ownership before unsubscribe can synchronously re-enter setup.
        const previousUnsubscribe = this.configUnsubscribe;
        this.configUnsubscribe = null;
        if (typeof previousUnsubscribe === 'function') {
            previousUnsubscribe();
        }

        const unsubscribe = this.configService.onChanged(
            async (changes) => {
                if (
                    !this._isCurrentConfigurationSubscription(
                        subscriptionGeneration
                    )
                ) {
                    return;
                }
                const refreshGeneration = ++this.configurationRefreshGeneration;
                const aiContextIntentGeneration =
                    this._captureAIContextConfigurationIntent(changes);
                this.logWithFallback('info', 'Config changed, updating', {
                    changedKeyCount: Object.keys(changes || {}).length,
                });
                let newConfig;
                try {
                    newConfig = await this.configService.getAll({
                        includeSensitive: false,
                    });
                } catch {
                    if (
                        this._isCurrentConfigurationSubscription(
                            subscriptionGeneration
                        ) &&
                        refreshGeneration ===
                            this.configurationRefreshGeneration
                    ) {
                        this.logWithFallback(
                            'error',
                            'Failed to refresh configuration from configService.'
                        );
                    }
                    return;
                }

                if (
                    !this._isCurrentConfigurationSubscription(
                        subscriptionGeneration
                    ) ||
                    refreshGeneration !== this.configurationRefreshGeneration
                ) {
                    return;
                }

                const reconciliationGeneration =
                    this.aiContextConfigurationIntentGeneration;
                const pendingAIContextKeys = new Map();
                for (const [key, intentGeneration] of this
                    .pendingAIContextConfigurationKeys) {
                    if (intentGeneration <= reconciliationGeneration) {
                        pendingAIContextKeys.set(key, intentGeneration);
                    }
                }
                const canonicalAIContextChanges = {};
                for (const key of pendingAIContextKeys.keys()) {
                    const descriptor = Object.getOwnPropertyDescriptor(
                        newConfig,
                        key
                    );
                    canonicalAIContextChanges[key] =
                        descriptor && Object.hasOwn(descriptor, 'value')
                            ? descriptor.value
                            : undefined;
                }

                Object.assign(this.currentConfig, newConfig);

                this._normalizeConfiguration();

                this.applyConfigurationChanges(changes);

                // Handle AI Context enablement and related changes immediately without requiring page reloads
                try {
                    await this._handleAIContextConfigurationChanges(
                        pendingAIContextKeys.size > 0
                            ? canonicalAIContextChanges
                            : changes,
                        pendingAIContextKeys.size > 0
                            ? reconciliationGeneration
                            : aiContextIntentGeneration
                    );
                    if (pendingAIContextKeys.size > 0) {
                        for (const [
                            key,
                            intentGeneration,
                        ] of pendingAIContextKeys) {
                            if (
                                this.pendingAIContextConfigurationKeys.get(
                                    key
                                ) === intentGeneration
                            ) {
                                this.pendingAIContextConfigurationKeys.delete(
                                    key
                                );
                            }
                        }
                    }
                } catch {
                    this.logWithFallback(
                        'warn',
                        'Failed to apply AI Context config changes'
                    );
                }
            },
            { includeSensitive: false }
        );

        if (!this._isCurrentConfigurationSubscription(subscriptionGeneration)) {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
            return;
        }
        this.configUnsubscribe =
            typeof unsubscribe === 'function' ? unsubscribe : null;
    }

    /** @private */
    _acceptsConfigurationSubscriptions() {
        return (
            this.configurationSubscriptionsAccepted === true &&
            !this.isCleanedUp
        );
    }

    /** @private */
    _isCurrentConfigurationSubscription(subscriptionGeneration) {
        return (
            this._acceptsConfigurationSubscriptions() &&
            subscriptionGeneration === this.configurationSubscriptionGeneration
        );
    }

    /** @private */
    _captureAIContextConfigurationIntent(changes) {
        const aiContextKeys = Object.keys(changes || {}).filter((key) =>
            AI_CONTEXT_LIFECYCLE_CONFIG_KEYS.has(key)
        );
        if (aiContextKeys.length === 0) {
            return null;
        }

        this.aiContextConfigurationIntentGeneration += 1;
        const intentGeneration = this.aiContextConfigurationIntentGeneration;
        for (const key of aiContextKeys) {
            this.pendingAIContextConfigurationKeys.set(key, intentGeneration);
        }
        return intentGeneration;
    }

    /**
     * Apply configuration changes with immediate visual feedback
     * @param {Object} changes - Configuration changes
     */
    applyConfigurationChanges(changes) {
        // Check if any changes affect subtitle functionality (exclude UI-only settings)
        const uiOnlySettings = ['appearanceAccordionOpen'];
        const functionalChanges = Object.keys(changes).filter(
            (key) => !uiOnlySettings.includes(key)
        );

        // Re-apply styles and trigger a subtitle re-render only if functional settings changed
        if (
            functionalChanges.length > 0 &&
            this.activePlatform &&
            this.subtitleUtils &&
            this.subtitleUtils.subtitlesActive
        ) {
            this.subtitleUtils.applySubtitleStyling(this.currentConfig);
            const videoElement = this.activePlatform.getVideoElement();
            const playbackTime = resolvePlaybackTime(
                this.activePlatform,
                videoElement
            );
            if (playbackTime !== null) {
                this.subtitleUtils.updateSubtitles(
                    playbackTime,
                    this.activePlatform,
                    this.currentConfig,
                    this.logPrefix
                );
            }
        }
    }

    /**
     * Handle AI Context related configuration changes without requiring reloads
     * - Starts AI Context when enabled
     * - Stops AI Context when disabled
     * - Restarts AI Context when provider or core settings change
     * @param {Object} changes - Configuration changes map from chrome.storage.onChanged
     * @private
     */
    async _handleAIContextConfigurationChanges(
        changes,
        capturedIntentGeneration = undefined
    ) {
        try {
            const changedKeys = Object.keys(changes || {});
            const hasAIChanges = changedKeys.some((key) =>
                AI_CONTEXT_LIFECYCLE_CONFIG_KEYS.has(key)
            );
            if (!hasAIChanges) {
                return;
            }

            const intentGeneration =
                capturedIntentGeneration === undefined
                    ? this._captureAIContextConfigurationIntent(changes)
                    : capturedIntentGeneration;
            if (
                intentGeneration === null ||
                intentGeneration !== this.aiContextConfigurationIntentGeneration
            ) {
                return;
            }

            // If the enablement flag changed, handle start/stop directly
            if (
                Object.prototype.hasOwnProperty.call(
                    changes,
                    'aiContextEnabled'
                )
            ) {
                const enabled = !!changes.aiContextEnabled;
                if (enabled) {
                    // Start or restart AI Context features
                    await this._restartAIContextFeatures();
                } else {
                    // Stop AI Context features and remove inactive click affordances
                    await this._disableAIContextInteractions();
                }
                return;
            }

            // Other AI settings changed while enabled: restart to apply changes
            if (this.currentConfig?.aiContextEnabled) {
                await this._restartAIContextFeatures();
            }
        } catch {
            this.logWithFallback(
                'warn',
                'AI Context configuration change handling failed'
            );
        }
    }

    /**
     * Restart AI Context features by performing a clean destroy and fresh initialization
     * @private
     */
    async _restartAIContextFeatures() {
        try {
            return await this.initializeAIContextFeatures();
        } catch {
            this.logWithFallback(
                'warn',
                'Failed to restart AI Context features'
            );
            return false;
        }
    }

    // ========================================
    // EVENT HANDLING AND BUFFERING
    // ========================================

    /**
     * Setup early event handling for subtitle data with enhanced buffering
     */
    setupEarlyEventHandling() {
        const config = this.getInjectScriptConfig();

        // Attach event listener immediately to catch early events with proper cleanup tracking
        if (!this.eventListenerAttached) {
            const eventHandler = (e) => this.handleEarlyInjectorEvents(e);
            document.addEventListener(config.eventId, eventHandler, {
                passive: true,
            });
            this.eventListenerAttached = true;

            // Track cleanup function for proper memory management
            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(config.eventId, eventHandler);
                this.eventListenerAttached = false;
                this.logWithFallback('debug', 'Early event listener removed');
            });

            this.logWithFallback('debug', 'Early event listener attached');
        }

        // Inject script early to catch subtitle data
        this.injectScriptEarly();
    }

    /**
     * Handle early injector events and buffer them until platform is ready
     * Enhanced with better error handling and memory management
     * @param {Event} e - Custom event from injected script
     */
    handleEarlyInjectorEvents(e) {
        if (getAIContextLifecycleState(this)?.terminal) return false;
        try {
            const config = this.getInjectScriptConfig();
            const data = acceptInjectedEvent(config, e);
            if (!data) return;

            // Enhanced event processing with timestamp and validation
            // Preserve original data fields (including url) and add extra contextual
            // information without overwriting them.  Use a separate property
            // `pageUrl` so the subtitle URL remains intact.
            const eventData = extendAcceptedInjectedEvent(data, {
                timestamp: Date.now(),
                pageUrl: window.location.href,
            });
            if (!eventData) return;

            if (data.type === 'INJECT_SCRIPT_READY') {
                this.logWithFallback('info', 'Inject script is ready');
                // Clear any stale buffered events when script reloads
                if (this.eventBuffer.size() > 0) {
                    this.logWithFallback(
                        'debug',
                        'Clearing stale buffered events on script reload'
                    );
                    this.eventBuffer.clear();
                }
            } else if (
                data.type === 'SUBTITLE_DATA_FOUND' ||
                data.type === 'SUBTITLE_URL_FOUND'
            ) {
                // Enhanced buffering with size limits to prevent memory issues
                if (this.eventBuffer.size() >= 100) {
                    this.logWithFallback(
                        'warn',
                        'Event buffer size limit reached, clearing old events'
                    );
                    this.eventBuffer.clear();
                }
                this.eventBuffer.add(eventData);
                this.logWithFallback('debug', 'Subtitle data buffered', {
                    bufferSize: this.eventBuffer.size(),
                });
            }

            // Process buffered events if platform is ready
            if (
                this.platformReady &&
                this.activePlatform &&
                this.eventBuffer.size() > 0
            ) {
                this.processBufferedEvents();
            }
        } catch {
            this.logWithFallback(
                'error',
                'Error handling early injector event'
            );
        }
    }

    /**
     * Process buffered events with enhanced error handling and validation
     */
    processBufferedEvents() {
        if (!this.activePlatform) {
            this.logWithFallback(
                'warn',
                'Cannot process buffered events: platform not ready'
            );
            return;
        }

        const bufferSize = this.eventBuffer.size();
        this.logWithFallback('info', 'Processing buffered events', {
            count: bufferSize,
        });

        this.eventBuffer.processAll((eventData, index) => {
            try {
                // Validate event data before processing
                if (!eventData || !eventData.type) {
                    this.logWithFallback(
                        'warn',
                        'Skipping invalid buffered event',
                        { index }
                    );
                    return;
                }

                // Check if event is still relevant (not too old)
                const eventAge = Date.now() - (eventData.timestamp || 0);
                const maxEventAge = 30000; // 30 seconds
                if (eventAge > maxEventAge) {
                    this.logWithFallback(
                        'debug',
                        'Skipping stale buffered event',
                        {
                            index,
                            age: eventAge,
                        }
                    );
                    return;
                }

                if (
                    eventData.type === 'SUBTITLE_DATA_FOUND' ||
                    eventData.type === 'SUBTITLE_URL_FOUND'
                ) {
                    this.activePlatform.handleInjectorEvents({
                        detail: eventData,
                    });
                    this.logWithFallback(
                        'debug',
                        'Processed buffered subtitle event',
                        { index }
                    );
                }
            } catch {
                this.logWithFallback(
                    'error',
                    'Error processing buffered event',
                    { index }
                );
            }
        });

        this.logWithFallback('info', 'Finished processing buffered events', {
            originalCount: bufferSize,
            remainingCount: this.eventBuffer.size(),
        });
    }

    /**
     * Inject script early to catch subtitle data
     */
    injectScriptEarly() {
        if (getAIContextLifecycleState(this)?.terminal) return false;
        const config = this.getInjectScriptConfig();
        const scriptUrl = createInjectedScriptUrl(
            config,
            chrome.runtime.getURL(config.filename)
        );
        if (!scriptUrl) return false;

        return injectScript(
            scriptUrl,
            config.tagId,
            () =>
                this.logWithFallback(
                    'info',
                    'Early inject script loaded successfully'
                ),
            () => {
                this.logWithFallback(
                    'error',
                    'Failed to load early inject script!'
                );
                try {
                    document.getElementById(config.tagId)?.remove();
                } catch (_) {}
                this._cancelEarlyInjectionRetry();
                if (getAIContextLifecycleState(this)?.terminal) return;
                const task = { timeoutId: null };
                this.earlyInjectionRetryTask = task;
                task.timeoutId = setTimeout(() => {
                    if (
                        this.earlyInjectionRetryTask !== task ||
                        getAIContextLifecycleState(this)?.terminal
                    ) {
                        return;
                    }
                    this.earlyInjectionRetryTask = null;
                    this.injectScriptEarly();
                }, 100);
            },
            () => {}
        );
    }

    _cancelEarlyInjectionRetry() {
        const task = this.earlyInjectionRetryTask;
        this.earlyInjectionRetryTask = null;
        if (task?.timeoutId !== null && task?.timeoutId !== undefined) {
            clearTimeout(task.timeoutId);
        }
    }

    // ========================================
    // SUBTITLE DATA HANDLING
    // ========================================

    /**
     * Handle subtitle data found callback
     * @param {Object} subtitleData - Subtitle data from platform
     */
    handleSubtitleDataFound(subtitleData) {
        this.logWithFallback('info', 'Subtitle data found callback triggered', {
            hasSubtitleData: Boolean(subtitleData),
            hasVttText: Boolean(subtitleData?.vttText),
            hasTargetVttText: Boolean(subtitleData?.targetVttText),
            usesNativeTarget: Boolean(subtitleData?.useNativeTarget),
            hasSubtitleUtils: Boolean(this.subtitleUtils),
            hasActivePlatform: Boolean(this.activePlatform),
            subtitlesActive: Boolean(this.subtitleUtils?.subtitlesActive),
        });

        if (this.subtitleUtils && this.subtitleUtils.handleSubtitleDataFound) {
            this.subtitleUtils.handleSubtitleDataFound(
                subtitleData,
                this.activePlatform,
                this.currentConfig,
                this.logPrefix
            );
        } else {
            this.logWithFallback(
                'error',
                'Cannot handle subtitle data - missing dependencies',
                {
                    hasSubtitleUtils: !!this.subtitleUtils,
                    hasHandleMethod:
                        !!this.subtitleUtils?.handleSubtitleDataFound,
                    hasActivePlatform: !!this.activePlatform,
                }
            );
        }
    }

    /**
     * Handle video ID change callback
     * @param {string} newVideoId - New video ID
     */
    handleVideoIdChange(newVideoId) {
        if (this.subtitleUtils) {
            if (this.subtitleUtils.handleVideoIdChange) {
                this.subtitleUtils.handleVideoIdChange(
                    newVideoId,
                    this.logPrefix
                );
            }
            if (this.subtitleUtils.setCurrentVideoId) {
                this.subtitleUtils.setCurrentVideoId(newVideoId);
            }
        }
    }

    // ========================================
    // VIDEO ELEMENT DETECTION
    // ========================================

    /**
     * Start video element detection with retry mechanism.
     * @param {Object} [options] - Optional owned detection context.
     * @param {Object|null} [options.platform] - Captured platform identity.
     * @param {number} [options.platformGeneration] - Captured platform generation.
     * @param {Object|null} [options.previousScope] - Last verified video/root scope.
     * @param {boolean} [options.replacementRequired=false] - Wait for a replacement scope.
     * @param {string} [options.pathname] - Exact player path captured by the caller.
     */
    startVideoElementDetection(options = {}) {
        const previousDetectionGeneration = this.videoDetectionGeneration;
        const previousDetectionTask = this.videoDetectionTask;
        const previousDetectionIntervalId = this.videoDetectionIntervalId;
        const previousDetectionIntervalOwner = this.videoDetectionIntervalOwner;
        const platform = options.platform || this.activePlatform;
        const platformGeneration =
            options.platformGeneration ?? this.platformInitializationGeneration;
        const pathname = options.pathname ?? window.location.pathname;

        this.logWithFallback('info', 'Starting video element detection');
        if (
            this.videoDetectionGeneration !== previousDetectionGeneration ||
            this.videoDetectionTask !== previousDetectionTask ||
            this.videoDetectionIntervalId !== previousDetectionIntervalId ||
            this.videoDetectionIntervalOwner !==
                previousDetectionIntervalOwner ||
            this.platformInitializationGeneration !== platformGeneration ||
            this.activePlatform !== platform
        ) {
            return;
        }

        this._cancelVisibilityVideoSetupRetry();
        if (
            this.videoDetectionGeneration !== previousDetectionGeneration ||
            this.videoDetectionTask !== previousDetectionTask ||
            this.videoDetectionIntervalId !== previousDetectionIntervalId ||
            this.videoDetectionIntervalOwner !==
                previousDetectionIntervalOwner ||
            this.platformInitializationGeneration !== platformGeneration ||
            this.activePlatform !== platform
        ) {
            return;
        }

        this.videoDetectionRetries = 0;
        this.videoDetectionGeneration += 1;
        const claimedDetectionGeneration = this.videoDetectionGeneration;

        // Clear any existing detection interval
        this.videoDetectionTask = null;
        this.videoDetectionIntervalId = null;
        this.videoDetectionIntervalOwner = null;
        if (previousDetectionTask?.intervalId === previousDetectionIntervalId) {
            previousDetectionTask.intervalId = null;
        }
        if (previousDetectionIntervalId !== null) {
            clearInterval(previousDetectionIntervalId);
        }
        if (
            this.videoDetectionGeneration !== claimedDetectionGeneration ||
            this.videoDetectionTask !== null ||
            this.videoDetectionIntervalId !== null ||
            this.videoDetectionIntervalOwner !== null ||
            this.platformInitializationGeneration !== platformGeneration ||
            this.activePlatform !== platform
        ) {
            return;
        }

        const detectionContext = {
            detectionGeneration: this.videoDetectionGeneration,
            platform,
            platformGeneration,
            previousScope: options.previousScope || null,
            previousScopeDisconnected: false,
            replacementRequired: options.replacementRequired === true,
            requiresVerifiedScope: options.replacementRequired === true,
            pathname,
            intervalId: null,
            intervalInstallationPending: false,
        };
        this.videoDetectionTask = detectionContext;

        // Try immediately first
        let immediateResult;
        try {
            immediateResult = this._attemptVideoDetection(detectionContext);
        } catch (_) {
            this._handleVideoDetectionAttemptFailure(detectionContext, null);
            return;
        }
        if (immediateResult !== 'pending') {
            this._releaseVideoDetectionTask(detectionContext, null);
            return; // Success, no need for interval
        }
        if (!this._isVideoDetectionContextCurrent(detectionContext)) {
            this._releaseVideoDetectionTask(detectionContext, null);
            return;
        }

        // Start retry mechanism
        let intervalId = null;
        let firedBeforeInstallationCompleted = false;
        const runDetectionAttempt = () => {
            if (intervalId === null) {
                firedBeforeInstallationCompleted = true;
                return;
            }
            if (!this._isVideoDetectionContextCurrent(detectionContext)) {
                this._releaseVideoDetectionTask(detectionContext, intervalId);
                return;
            }

            let result;
            try {
                this.videoDetectionRetries++;
                this.logWithFallback('debug', 'Video detection attempt', {
                    attempt: this.videoDetectionRetries,
                    maxAttempts: this.maxVideoDetectionRetries,
                });
                result = this._attemptVideoDetection(detectionContext);
            } catch (_) {
                this._handleVideoDetectionAttemptFailure(
                    detectionContext,
                    intervalId
                );
                return;
            }
            if (result !== 'pending') {
                // Success! Clear the interval
                this._releaseVideoDetectionTask(detectionContext, intervalId);
                if (result === 'success') {
                    this.logWithFallback(
                        'info',
                        'Video element found and setup completed',
                        {
                            attempts: this.videoDetectionRetries,
                        }
                    );
                }
            } else if (
                this.videoDetectionRetries >= this.maxVideoDetectionRetries
            ) {
                // Give up after max retries
                this._releaseVideoDetectionTask(detectionContext, intervalId);
                this.logWithFallback(
                    'warn',
                    'Could not find video element after max attempts. Giving up',
                    {
                        maxAttempts: this.maxVideoDetectionRetries,
                    }
                );
            }
        };

        detectionContext.intervalInstallationPending = true;
        try {
            intervalId = setInterval(
                runDetectionAttempt,
                this.videoDetectionInterval
            );
        } catch (_) {
            this._handleVideoDetectionAttemptFailure(detectionContext, null);
            return;
        }
        if (firedBeforeInstallationCompleted) {
            this._releaseVideoDetectionTask(detectionContext, intervalId);
            return;
        }
        if (!this._isVideoDetectionContextCurrent(detectionContext)) {
            this._releaseVideoDetectionTask(detectionContext, intervalId);
            return;
        }
        detectionContext.intervalId = intervalId;
        detectionContext.intervalInstallationPending = false;
        this.videoDetectionIntervalId = intervalId;
        this.videoDetectionIntervalOwner = detectionContext;
    }

    /**
     * Release only the exact detector task and interval owned by a context.
     * @private
     * @param {Object} context - Captured detection context.
     * @param {*} intervalId - Captured interval identifier, or `null`.
     */
    _releaseVideoDetectionTask(context, intervalId) {
        const ownsInstalledInterval =
            this.videoDetectionIntervalOwner === context &&
            this.videoDetectionIntervalId === intervalId &&
            context?.intervalId === intervalId;
        const ownsPreInstallationTask =
            this.videoDetectionTask === context &&
            this.videoDetectionIntervalOwner === null &&
            this.videoDetectionIntervalId === null &&
            context?.intervalId === null &&
            context?.intervalInstallationPending !== true;
        const conflictsWithNewerInterval =
            this.videoDetectionIntervalOwner !== null &&
            this.videoDetectionIntervalOwner !== context &&
            this.videoDetectionIntervalId === intervalId;
        const ownsProvisionalInterval =
            context?.intervalInstallationPending === true &&
            context?.intervalId === null &&
            !conflictsWithNewerInterval;
        if (
            !ownsInstalledInterval &&
            !ownsPreInstallationTask &&
            !ownsProvisionalInterval
        ) {
            return false;
        }

        if (ownsInstalledInterval) {
            this.videoDetectionIntervalId = null;
            this.videoDetectionIntervalOwner = null;
        }
        if (this.videoDetectionTask === context) {
            this.videoDetectionTask = null;
        }
        if (context?.intervalId === intervalId) {
            context.intervalId = null;
        }
        if (context) {
            context.intervalInstallationPending = false;
        }
        if (intervalId !== null) {
            clearInterval(intervalId);
        }
        return true;
    }

    /**
     * Terminate a detector after a collaborator throws without exposing details.
     * @private
     * @param {Object} context - Captured detection context.
     * @param {*} intervalId - Captured interval identifier, or `null`.
     */
    _handleVideoDetectionAttemptFailure(context, intervalId) {
        const visibilityTask = this.visibilityVideoSetupTask;
        if (
            visibilityTask === context ||
            visibilityTask?.detectionTask === context
        ) {
            this._cancelVisibilityVideoSetupRetry(visibilityTask);
        }
        this._releaseVideoDetectionTask(context, intervalId);
        try {
            this.logWithFallback(
                'warn',
                'Video detection attempt failed safely'
            );
        } catch (_) {}
    }

    /**
     * Run one owned video-detection attempt.
     * @private
     * @param {Object} context - Captured detection context.
     * @returns {'success'|'pending'|'aborted'} Detection result.
     */
    _attemptVideoDetection(context) {
        if (!this._isVideoDetectionTaskCurrent(context)) {
            return 'aborted';
        }

        if (!context.replacementRequired) {
            return this.attemptVideoSetup(context) ? 'success' : 'pending';
        }

        if (!this._isReplacementDetectionContextCurrent(context)) {
            return 'aborted';
        }

        const previousScope = context.previousScope;
        if (
            previousScope &&
            (!previousScope.root.isConnected ||
                !previousScope.video.isConnected ||
                (previousScope.root !== previousScope.video &&
                    !previousScope.root.contains?.(previousScope.video)))
        ) {
            context.previousScopeDisconnected = true;
        }

        const currentScope = this._getVerifiedVideoSetupScope(context.platform);
        if (!this._isReplacementDetectionContextCurrent(context)) {
            return 'aborted';
        }
        if (!currentScope) {
            return 'pending';
        }

        if (
            previousScope &&
            !context.previousScopeDisconnected &&
            currentScope.root === previousScope.root &&
            currentScope.video === previousScope.video
        ) {
            return 'pending';
        }

        const setupComplete = this.attemptVideoSetup(context);
        if (!this._isReplacementDetectionContextCurrent(context)) {
            return 'aborted';
        }
        if (!setupComplete) {
            return 'pending';
        }

        const completedScope = this.lastVideoSetupScope;
        if (
            !completedScope ||
            completedScope.platform !== context.platform ||
            completedScope.platformGeneration !== context.platformGeneration
        ) {
            return 'pending';
        }

        if (
            previousScope &&
            !context.previousScopeDisconnected &&
            completedScope.root === previousScope.root &&
            completedScope.video === previousScope.video
        ) {
            return 'pending';
        }

        return 'success';
    }

    /**
     * Check exact ownership of the active video-detection task.
     * @private
     * @param {Object} context - Captured detection context.
     * @returns {boolean} Whether the task may continue.
     */
    _isVideoDetectionTaskCurrent(context) {
        return (
            this.videoDetectionTask === context &&
            context.detectionGeneration === this.videoDetectionGeneration &&
            !this.isCleanedUp &&
            (context.intervalId === null
                ? this.videoDetectionIntervalId === null &&
                  this.videoDetectionIntervalOwner === null
                : this.videoDetectionIntervalId === context.intervalId &&
                  this.videoDetectionIntervalOwner === context)
        );
    }

    /**
     * Check platform and route ownership in addition to exact detector ownership.
     * @private
     * @param {Object} context - Captured detection context.
     * @returns {boolean} Whether the context may continue.
     */
    _isVideoDetectionContextCurrent(context) {
        if (
            !context.platform ||
            !this._isVideoDetectionTaskCurrent(context) ||
            !this._isPlatformGenerationCurrent(
                context.platformGeneration,
                context.platform
            )
        ) {
            return false;
        }

        if (window.location.pathname !== context.pathname) {
            return false;
        }
        const pathnameBeforeRouteCheck = window.location.pathname;
        const isPlayerRoute = this._isCurrentPlayerRoute(context.platform);
        if (
            !isPlayerRoute ||
            window.location.pathname !== pathnameBeforeRouteCheck ||
            window.location.pathname !== context.pathname
        ) {
            return false;
        }

        return (
            this._isVideoDetectionTaskCurrent(context) &&
            this._isPlatformGenerationCurrent(
                context.platformGeneration,
                context.platform
            )
        );
    }

    /**
     * Check that replacement detection still owns the active player lifecycle.
     * @private
     * @param {Object} context - Captured detection context.
     * @returns {boolean} Whether the context may continue.
     */
    _isReplacementDetectionContextCurrent(context) {
        return (
            context.replacementRequired === true &&
            this._isVideoDetectionContextCurrent(context)
        );
    }

    /**
     * Check whether a captured platform still owns an active player route.
     * @private
     * @param {Object|null} platform - Captured platform identity.
     * @returns {boolean} Whether replacement detection may continue.
     */
    _isCurrentPlayerRoute(platform) {
        try {
            if (typeof this._isPlayerPath === 'function') {
                return this._isPlayerPath(window.location.pathname);
            }
            return platform?.isPlayerPageActive?.() === true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Return the connected, platform-owned player root without ever widening
     * observation to the page document.
     * @private
     * @param {Object|null} platform - Platform to query.
     * @returns {Element|null} Verified player root.
     */
    _getVerifiedPlayerRoot(platform) {
        try {
            if (!platform || this.activePlatform !== platform) {
                return null;
            }

            const root = platform.getPlayerContainerElement?.();
            if (
                !(root instanceof Element) ||
                !root.isConnected ||
                root === document.body ||
                root === document.documentElement
            ) {
                return null;
            }
            return root;
        } catch (_) {
            return null;
        }
    }

    _getVerifiedPlayerObservationShell(root) {
        try {
            const shell = root?.parentElement;
            if (
                !(shell instanceof Element) ||
                !shell.isConnected ||
                shell === document.body ||
                shell === document.documentElement ||
                !shell.contains(root)
            ) {
                return null;
            }
            return shell;
        } catch (_) {
            return null;
        }
    }

    /**
     * Return a connected, player-contained video/root pair.
     * @private
     * @param {Object|null} platform - Platform to query.
     * @param {HTMLVideoElement|null} [videoElement] - Optional captured video.
     * @returns {Object|null} Verified scope.
     */
    _getVerifiedVideoSetupScope(platform, videoElement = null) {
        try {
            if (!platform || this.activePlatform !== platform) {
                return null;
            }

            const video = videoElement || platform.getVideoElement?.();
            const root = this._getVerifiedPlayerRoot(platform);
            if (
                !(video instanceof HTMLVideoElement) ||
                !root ||
                !video.isConnected ||
                root === video ||
                !root.contains(video)
            ) {
                return null;
            }

            return { root, video };
        } catch (_) {
            return null;
        }
    }

    /**
     * Rearm the existing bounded detector for a player-to-player replacement.
     * @protected
     */
    _rearmVideoElementDetectionForPlayerNavigation() {
        const platform = this.activePlatform;
        const platformGeneration = this.platformInitializationGeneration;
        const detectionGeneration = this.videoDetectionGeneration;
        const detectionTask = this.videoDetectionTask;
        const detectionIntervalId = this.videoDetectionIntervalId;
        const pathname = window.location.pathname;
        if (
            !platform ||
            !this._isPlatformGenerationCurrent(platformGeneration, platform)
        ) {
            return;
        }
        const isPlayerRoute = this._isCurrentPlayerRoute(platform);
        if (
            !isPlayerRoute ||
            window.location.pathname !== pathname ||
            this.videoDetectionGeneration !== detectionGeneration ||
            this.videoDetectionTask !== detectionTask ||
            this.videoDetectionIntervalId !== detectionIntervalId ||
            !this._isPlatformGenerationCurrent(platformGeneration, platform)
        ) {
            return;
        }
        const lastScope = this.lastVideoSetupScope;
        const previousScope =
            lastScope?.platform === platform &&
            lastScope?.platformGeneration === platformGeneration
                ? lastScope
                : this._getVerifiedVideoSetupScope(platform);
        if (window.location.pathname !== pathname) {
            return;
        }
        const isStillPlayerRoute = this._isCurrentPlayerRoute(platform);
        if (
            !isStillPlayerRoute ||
            window.location.pathname !== pathname ||
            this.videoDetectionGeneration !== detectionGeneration ||
            this.videoDetectionTask !== detectionTask ||
            this.videoDetectionIntervalId !== detectionIntervalId ||
            !this._isPlatformGenerationCurrent(platformGeneration, platform)
        ) {
            return;
        }

        this.startVideoElementDetection({
            platform,
            platformGeneration,
            previousScope,
            replacementRequired: true,
            pathname,
        });
    }

    /**
     * Attempt to setup video element and subtitle container
     * @param {Object|null} [detectionContext=null] - Optional owned detector task.
     * @returns {boolean} Success status
     */
    attemptVideoSetup(detectionContext = null) {
        if (
            !this.activePlatform ||
            !this.subtitleUtils ||
            !this.currentConfig
        ) {
            return false;
        }

        const platform = this.activePlatform;
        const platformGeneration = this.platformInitializationGeneration;
        const subtitleUtils = this.subtitleUtils;
        const config = this.currentConfig;
        if (
            detectionContext &&
            !this._isVideoSetupAttemptCurrent(
                detectionContext,
                platform,
                platformGeneration
            )
        ) {
            return false;
        }
        const videoElement = platform.getVideoElement();
        if (!videoElement) {
            return false; // Video not ready yet
        }

        const verifiedScope = this._getVerifiedVideoSetupScope(
            platform,
            videoElement
        );
        if (
            !this._isVideoSetupAttemptCurrent(
                detectionContext,
                platform,
                platformGeneration
            ) ||
            (detectionContext?.requiresVerifiedScope && !verifiedScope)
        ) {
            return false;
        }

        this.logWithFallback(
            'info',
            'Video element found! Setting up subtitle container and listeners'
        );
        if (
            !this._isVideoSetupAttemptCurrent(
                detectionContext,
                platform,
                platformGeneration
            )
        ) {
            return false;
        }
        this.logWithFallback('debug', 'Current subtitlesActive state', {
            subtitlesActive: Boolean(subtitleUtils.subtitlesActive),
        });
        if (
            !this._isVideoSetupAttemptCurrent(
                detectionContext,
                platform,
                platformGeneration
            )
        ) {
            return false;
        }

        // Ensure container and timeupdate listener
        subtitleUtils.ensureSubtitleContainer(platform, config, this.logPrefix);

        if (
            platform.getVideoElement() !== videoElement ||
            !this._isVideoSetupAttemptCurrent(
                detectionContext,
                platform,
                platformGeneration
            )
        ) {
            return false;
        }

        const stableVerifiedScope =
            verifiedScope &&
            verifiedScope.root.isConnected &&
            verifiedScope.video.isConnected &&
            verifiedScope.root.contains(verifiedScope.video)
                ? verifiedScope
                : null;
        if (detectionContext?.requiresVerifiedScope && !stableVerifiedScope) {
            return false;
        }

        if (stableVerifiedScope) {
            this.lastVideoSetupScope = {
                ...stableVerifiedScope,
                platform,
                platformGeneration,
            };
        }

        if (
            !this._isVideoSetupAttemptCurrent(
                detectionContext,
                platform,
                platformGeneration
            )
        ) {
            return false;
        }

        if (subtitleUtils.subtitlesActive) {
            this.logWithFallback(
                'info',
                'Subtitles are active, showing container and setting up listeners'
            );
            if (
                !this._isVideoSetupAttemptCurrent(
                    detectionContext,
                    platform,
                    platformGeneration
                )
            ) {
                return false;
            }
            subtitleUtils.showSubtitleContainer();
            const playbackTime = resolvePlaybackTime(platform, videoElement);
            if (
                playbackTime !== null &&
                playbackTime > 0 &&
                this._isVideoSetupAttemptCurrent(
                    detectionContext,
                    platform,
                    platformGeneration
                )
            ) {
                subtitleUtils.updateSubtitles(
                    playbackTime,
                    platform,
                    config,
                    this.logPrefix
                );
            }
        } else {
            this.logWithFallback(
                'info',
                'Subtitles are not active, hiding container'
            );
            if (
                !this._isVideoSetupAttemptCurrent(
                    detectionContext,
                    platform,
                    platformGeneration
                )
            ) {
                return false;
            }
            subtitleUtils.hideSubtitleContainer();
        }

        const setupIsCurrent = this._isVideoSetupAttemptCurrent(
            detectionContext,
            platform,
            platformGeneration
        );
        if (setupIsCurrent && stableVerifiedScope) {
            this._refreshPlayerRootObservationAfterVideoSetup(
                stableVerifiedScope,
                platform,
                platformGeneration
            );
        }
        return this._isVideoSetupAttemptCurrent(
            detectionContext,
            platform,
            platformGeneration
        );
    }

    /**
     * Check lifecycle and optional detector-task ownership for video setup.
     * @private
     * @param {Object|null} detectionContext - Optional detector task.
     * @param {Object} platform - Captured platform identity.
     * @param {number} platformGeneration - Captured platform generation.
     * @returns {boolean} Whether setup may continue.
     */
    _isVideoSetupAttemptCurrent(
        detectionContext,
        platform,
        platformGeneration
    ) {
        if (
            this.isCleanedUp ||
            !this._isPlatformGenerationCurrent(platformGeneration, platform)
        ) {
            return false;
        }

        if (!detectionContext) {
            return true;
        }

        if (detectionContext.ownerType === 'visibility-video-setup') {
            return (
                detectionContext.platform === platform &&
                detectionContext.platformGeneration === platformGeneration &&
                this._isVisibilityVideoSetupTaskCurrent(detectionContext)
            );
        }

        if (
            detectionContext.platform !== platform ||
            detectionContext.platformGeneration !== platformGeneration ||
            !this._isVideoDetectionTaskCurrent(detectionContext)
        ) {
            return false;
        }

        return this._isVideoDetectionContextCurrent(detectionContext);
    }

    /**
     * Stop video element detection
     */
    stopVideoElementDetection() {
        this._cancelVisibilityVideoSetupRetry();
        this.videoDetectionGeneration += 1;
        const intervalId = this.videoDetectionIntervalId;
        const intervalOwner = this.videoDetectionIntervalOwner;
        this.videoDetectionIntervalId = null;
        this.videoDetectionIntervalOwner = null;
        this.videoDetectionTask = null;
        if (intervalOwner?.intervalId === intervalId) {
            intervalOwner.intervalId = null;
        }
        if (intervalId !== null) {
            clearInterval(intervalId);
            this.logWithFallback('info', 'Video element detection stopped');
        }
    }

    /**
     * Cancel the visibility-owned video setup retry, if any.
     * @private
     */
    _cancelVisibilityVideoSetupRetry(expectedTask = null) {
        const task = this.visibilityVideoSetupTask;
        if (expectedTask && task !== expectedTask) {
            return false;
        }
        this.visibilityVideoSetupGeneration += 1;
        this.visibilityVideoSetupTask = null;
        if (task?.timeoutId !== null && task?.timeoutId !== undefined) {
            clearTimeout(task.timeoutId);
            task.timeoutId = null;
        }
        return task !== null;
    }

    /**
     * Schedule one visibility-owned video setup attempt.
     * @private
     * @param {number} [delay=500] - Delay before the guarded attempt.
     * @returns {boolean} Whether an owned timeout was installed.
     */
    _scheduleVisibilityVideoSetupRetry(delay = 500) {
        const visibilityGeneration = this.visibilityVideoSetupGeneration + 1;
        this._cancelVisibilityVideoSetupRetry();
        if (
            this.visibilityVideoSetupGeneration !== visibilityGeneration ||
            this.visibilityVideoSetupTask !== null
        ) {
            return false;
        }

        const platform = this.activePlatform;
        const platformGeneration = this.platformInitializationGeneration;
        const pathname = window.location.pathname;
        const detectionGeneration = this.videoDetectionGeneration;
        const detectionTask = this.videoDetectionTask;
        const detectionIntervalId = this.videoDetectionIntervalId;
        if (
            !platform ||
            !this.subtitleUtils?.subtitlesActive ||
            this.isCleanedUp ||
            !this._isPlatformGenerationCurrent(platformGeneration, platform)
        ) {
            return false;
        }
        const isPlayerRoute = this._isCurrentPlayerRoute(platform);
        if (
            !isPlayerRoute ||
            window.location.pathname !== pathname ||
            !this._isPlatformGenerationCurrent(platformGeneration, platform) ||
            this.videoDetectionGeneration !== detectionGeneration ||
            this.videoDetectionTask !== detectionTask ||
            this.videoDetectionIntervalId !== detectionIntervalId ||
            this.visibilityVideoSetupGeneration !== visibilityGeneration ||
            this.visibilityVideoSetupTask !== null
        ) {
            return false;
        }

        const task = {
            ownerType: 'visibility-video-setup',
            visibilityGeneration,
            timeoutId: null,
            platform,
            platformGeneration,
            pathname,
            detectionGeneration,
            detectionTask,
            detectionIntervalId,
            requiresVerifiedScope: true,
        };
        this.visibilityVideoSetupTask = task;

        let timeoutId = null;
        let firedBeforeInstallationCompleted = false;
        const runVisibilitySetup = () => {
            if (timeoutId === null) {
                firedBeforeInstallationCompleted = true;
                return;
            }
            if (!this._isVisibilityVideoSetupTaskCurrent(task)) {
                if (this.visibilityVideoSetupTask === task) {
                    this.visibilityVideoSetupTask = null;
                }
                task.timeoutId = null;
                return;
            }

            task.timeoutId = null;
            try {
                this.attemptVideoSetup(task);
            } catch (_) {
                this._handleVideoDetectionAttemptFailure(task, null);
                return;
            }
            if (this.visibilityVideoSetupTask === task) {
                this.visibilityVideoSetupTask = null;
            }
        };

        try {
            timeoutId = setTimeout(runVisibilitySetup, delay);
        } catch (_) {
            this._handleVideoDetectionAttemptFailure(task, null);
            return false;
        }
        if (firedBeforeInstallationCompleted) {
            clearTimeout(timeoutId);
            if (this.visibilityVideoSetupTask === task) {
                this.visibilityVideoSetupTask = null;
            }
            return false;
        }
        if (!this._isVisibilityVideoSetupTaskCurrent(task)) {
            clearTimeout(timeoutId);
            if (this.visibilityVideoSetupTask === task) {
                this.visibilityVideoSetupTask = null;
            }
            return false;
        }
        task.timeoutId = timeoutId;
        return true;
    }

    /**
     * Check exact ownership of a delayed visibility video setup.
     * @private
     * @param {Object} task - Captured visibility task.
     * @returns {boolean} Whether the task may continue.
     */
    _isVisibilityVideoSetupTaskCurrent(task) {
        if (
            this.visibilityVideoSetupTask !== task ||
            this.visibilityVideoSetupGeneration !== task.visibilityGeneration ||
            this.isCleanedUp ||
            !this._isPlatformGenerationCurrent(
                task.platformGeneration,
                task.platform
            ) ||
            this.videoDetectionGeneration !== task.detectionGeneration ||
            this.videoDetectionTask !== task.detectionTask ||
            this.videoDetectionIntervalId !== task.detectionIntervalId ||
            window.location.pathname !== task.pathname
        ) {
            return false;
        }

        const pathnameBeforeRouteCheck = window.location.pathname;
        const isPlayerRoute = this._isCurrentPlayerRoute(task.platform);
        if (
            !isPlayerRoute ||
            window.location.pathname !== pathnameBeforeRouteCheck ||
            window.location.pathname !== task.pathname
        ) {
            return false;
        }

        return (
            this.visibilityVideoSetupTask === task &&
            this.visibilityVideoSetupGeneration === task.visibilityGeneration &&
            !this.isCleanedUp &&
            this._isPlatformGenerationCurrent(
                task.platformGeneration,
                task.platform
            ) &&
            this.videoDetectionGeneration === task.detectionGeneration &&
            this.videoDetectionTask === task.detectionTask &&
            this.videoDetectionIntervalId === task.detectionIntervalId &&
            window.location.pathname === task.pathname
        );
    }

    // ========================================
    // DOM OBSERVATION
    // ========================================

    /**
     * Check one captured player lifecycle without relying on broad page state.
     * Route checks are treated as re-entrant collaborators, so every check is
     * followed by the same identity snapshot.
     * @private
     * @param {Object} platform - Captured platform identity.
     * @param {number} platformGeneration - Captured platform generation.
     * @param {string} pathname - Captured exact pathname.
     * @param {Element|null} [root=null] - Optional connected player root.
     * @returns {boolean} Whether the lifecycle is still current.
     */
    _isPlayerLifecycleCurrent(
        platform,
        platformGeneration,
        pathname,
        root = null
    ) {
        if (
            !platform ||
            this.isCleanedUp ||
            !this._isPlatformGenerationCurrent(platformGeneration, platform) ||
            window.location.pathname !== pathname ||
            (root && !root.isConnected)
        ) {
            return false;
        }

        const pathnameBeforeRouteCheck = window.location.pathname;
        const isPlayerRoute = this._isCurrentPlayerRoute(platform);
        return (
            isPlayerRoute &&
            pathnameBeforeRouteCheck === pathname &&
            window.location.pathname === pathname &&
            !this.isCleanedUp &&
            this._isPlatformGenerationCurrent(platformGeneration, platform) &&
            (!root || root.isConnected)
        );
    }

    /**
     * Check exact observer ownership and the captured player lifecycle.
     * @private
     * @param {Object} task - Captured player-root observation task.
     * @returns {boolean} Whether the task may continue.
     */
    _isPlayerRootObservationTaskCurrent(task) {
        const observationRoot = task?.observationShell || task?.root;
        if (
            !task ||
            this.pageObserverTask !== task ||
            this.pageObserver !== task.observer ||
            !(task.root instanceof Element) ||
            task.root === document.body ||
            task.root === document.documentElement ||
            !(observationRoot instanceof Element) ||
            observationRoot === document.body ||
            observationRoot === document.documentElement ||
            !this._isPlayerLifecycleCurrent(
                task.platform,
                task.platformGeneration,
                task.pathname,
                observationRoot
            )
        ) {
            return false;
        }

        return (
            this.pageObserverTask === task &&
            this.pageObserver === task.observer &&
            this._isPlatformGenerationCurrent(
                task.platformGeneration,
                task.platform
            ) &&
            window.location.pathname === task.pathname &&
            observationRoot.isConnected
        );
    }

    /**
     * Release only the exact observer task (or one legacy unowned observer).
     * Shared ownership is detached before timer/observer collaborators run.
     * @private
     * @param {Object|null} task - Expected task identity.
     * @param {MutationObserver|null} [legacyObserver=null] - Legacy fallback.
     * @returns {boolean} Whether an observer owner was released.
     */
    _releasePlayerRootObservationTask(task, legacyObserver = null) {
        if (task) {
            if (
                this.pageObserverTask !== task ||
                this.pageObserver !== task.observer
            ) {
                return false;
            }

            this.pageObserverTask = null;
            this.pageObserver = null;
            const timeoutId = task.timeoutId;
            task.timeoutId = null;
            task.timeoutInstallationPending = false;
            if (timeoutId !== null && timeoutId !== undefined) {
                try {
                    clearTimeout(timeoutId);
                } catch (_) {}
            }
            try {
                task.observer.disconnect();
            } catch (_) {}
            return true;
        }

        if (
            legacyObserver &&
            this.pageObserverTask === null &&
            this.pageObserver === legacyObserver
        ) {
            this.pageObserver = null;
            try {
                legacyObserver.disconnect();
            } catch (_) {}
            return true;
        }
        return false;
    }

    /**
     * Invalidate setup work and cancel the exact current observer owner.
     * @private
     * @param {Object|null} [expectedTask=null] - Optional exact owner guard.
     * @returns {boolean} Whether the current owner was released.
     */
    _cancelPlayerRootObservation(expectedTask = null) {
        const task = this.pageObserverTask;
        if (expectedTask && task !== expectedTask) {
            return false;
        }
        this.domObservationSetupGeneration += 1;
        this.domObservationCancellationDepth += 1;
        try {
            return this._releasePlayerRootObservationTask(
                task,
                task ? null : this.pageObserver
            );
        } finally {
            this.domObservationCancellationDepth -= 1;
        }
    }

    /**
     * Clear a provisional timeout only when a newer exact owner has not
     * already claimed the same reusable host timer id.
     * @private
     * @param {Object} task - Stale or current installation task.
     * @param {*} timeoutId - Provisional host timer id.
     * @returns {boolean} Whether a clear was attempted.
     */
    _clearUnclaimedPlayerRootTimeout(task, timeoutId) {
        const currentTask = this.pageObserverTask;
        if (
            currentTask &&
            currentTask !== task &&
            (currentTask.timeoutInstallationPending ||
                currentTask.timeoutId === timeoutId)
        ) {
            return false;
        }
        try {
            clearTimeout(timeoutId);
        } catch (_) {}
        return true;
    }

    /**
     * Coalesce one relevant player-root mutation burst behind an exactly-owned
     * 100 ms timeout.
     * @private
     * @param {Object} task - Captured observer task.
     * @param {MutationRecord[]} mutationsList - Delivered mutations.
     */
    _schedulePlayerRootMutation(task, mutationsList) {
        if (!this._isPlayerRootObservationTaskCurrent(task)) {
            return;
        }

        let hasRelevantMutation = false;
        try {
            hasRelevantMutation = Array.from(mutationsList || []).some(
                (mutation) =>
                    mutation?.type === 'childList' &&
                    (mutation.target === task.root ||
                        mutation.target === task.observationShell ||
                        (mutation.target instanceof Node &&
                            task.root.contains(mutation.target)))
            );
        } catch (_) {
            return;
        }
        if (
            !hasRelevantMutation ||
            !this._isPlayerRootObservationTaskCurrent(task) ||
            task.timeoutInstallationPending ||
            task.timeoutId !== null
        ) {
            return;
        }

        task.timeoutInstallationPending = true;
        let timeoutId = null;
        let firedBeforeInstallationCompleted = false;
        const runMutationTask = () => {
            if (timeoutId === null) {
                firedBeforeInstallationCompleted = true;
                return;
            }
            if (
                task.timeoutInstallationPending ||
                task.timeoutId !== timeoutId ||
                !this._isPlayerRootObservationTaskCurrent(task)
            ) {
                return;
            }

            task.timeoutId = null;
            this._processPlayerRootMutation(task);
        };

        try {
            timeoutId = setTimeout(runMutationTask, 100);
        } catch (_) {
            if (
                this.pageObserverTask === task &&
                task.timeoutInstallationPending
            ) {
                task.timeoutInstallationPending = false;
            }
            return;
        }

        if (firedBeforeInstallationCompleted) {
            this._clearUnclaimedPlayerRootTimeout(task, timeoutId);
            if (
                this.pageObserverTask === task &&
                task.timeoutInstallationPending
            ) {
                task.timeoutInstallationPending = false;
            }
            return;
        }
        if (
            !this._isPlayerRootObservationTaskCurrent(task) ||
            !task.timeoutInstallationPending ||
            task.timeoutId !== null
        ) {
            this._clearUnclaimedPlayerRootTimeout(task, timeoutId);
            if (this.pageObserverTask === task) {
                task.timeoutInstallationPending = false;
            }
            return;
        }

        task.timeoutInstallationPending = false;
        task.timeoutId = timeoutId;
    }

    /**
     * Reconcile one valid same-root video replacement/removal through the
     * existing bounded video-detection and setup seams.
     * @private
     * @param {Object} task - Captured observer task.
     */
    _processPlayerRootMutation(task) {
        if (!this._isPlayerRootObservationTaskCurrent(task)) {
            return;
        }

        const currentRoot = this._getVerifiedPlayerRoot(task.platform);
        if (!this._isPlayerRootObservationTaskCurrent(task)) {
            return;
        }

        if (currentRoot !== task.root) {
            if (!currentRoot) return;
            let currentVideo = null;
            try {
                currentVideo = task.platform.getVideoElement?.() || null;
            } catch (_) {
                return;
            }
            if (
                !(currentVideo instanceof HTMLVideoElement) ||
                !currentVideo.isConnected ||
                !currentRoot.contains(currentVideo) ||
                !this._isPlayerRootObservationTaskCurrent(task)
            ) {
                return;
            }
            this.startVideoElementDetection({
                platform: task.platform,
                platformGeneration: task.platformGeneration,
                previousScope: task.videoScope,
                replacementRequired: true,
                pathname: task.pathname,
            });
            return;
        }

        let currentVideo = null;
        try {
            currentVideo = task.platform.getVideoElement?.() || null;
        } catch (_) {
            return;
        }
        if (!this._isPlayerRootObservationTaskCurrent(task)) {
            return;
        }

        const currentScope =
            currentVideo instanceof HTMLVideoElement &&
            currentVideo.isConnected &&
            currentRoot.contains(currentVideo) &&
            currentRoot !== currentVideo
                ? { root: currentRoot, video: currentVideo }
                : null;
        if (!this._isPlayerRootObservationTaskCurrent(task)) {
            return;
        }
        const previousScope = task.videoScope;
        if (
            currentScope &&
            previousScope?.root === currentScope.root &&
            previousScope?.video === currentScope.video
        ) {
            return;
        }

        if (currentScope) {
            if (!this._isPlayerRootObservationTaskCurrent(task)) {
                return;
            }
            this.startVideoElementDetection({
                platform: task.platform,
                platformGeneration: task.platformGeneration,
                previousScope,
                replacementRequired: true,
                pathname: task.pathname,
            });
            if (!this._isPlayerRootObservationTaskCurrent(task)) {
                return;
            }

            const completedScope = this.lastVideoSetupScope;
            if (
                completedScope?.platform === task.platform &&
                completedScope?.platformGeneration ===
                    task.platformGeneration &&
                completedScope.root === currentScope.root &&
                completedScope.video === currentScope.video
            ) {
                task.videoScope = currentScope;
            }
            return;
        }

        if (!previousScope) {
            return;
        }
        task.videoScope = null;
        const subtitleUtils = this.subtitleUtils;
        if (typeof subtitleUtils?.hideSubtitleContainer === 'function') {
            try {
                subtitleUtils.hideSubtitleContainer();
            } catch (_) {}
            if (
                !this._isPlayerRootObservationTaskCurrent(task) ||
                this.subtitleUtils !== subtitleUtils
            ) {
                return;
            }
        }
        if (typeof subtitleUtils?.clearSubtitleDOM === 'function') {
            try {
                subtitleUtils.clearSubtitleDOM();
            } catch (_) {}
            if (
                !this._isPlayerRootObservationTaskCurrent(task) ||
                this.subtitleUtils !== subtitleUtils
            ) {
                return;
            }
        }

        if (!this._isPlayerRootObservationTaskCurrent(task)) {
            return;
        }
        this.startVideoElementDetection({
            platform: task.platform,
            platformGeneration: task.platformGeneration,
            previousScope,
            replacementRequired: true,
            pathname: task.pathname,
        });
    }

    /**
     * Keep an existing same-root observation in sync after successful video
     * setup, or establish it when setup completed before observer startup.
     * @private
     * @param {{root: Element, video: HTMLVideoElement}} scope - Verified scope.
     * @param {Object} platform - Captured platform identity.
     * @param {number} platformGeneration - Captured platform generation.
     * @returns {boolean} Whether an observer owns the verified scope.
     */
    _refreshPlayerRootObservationAfterVideoSetup(
        scope,
        platform,
        platformGeneration
    ) {
        const pathname = window.location.pathname;
        if (
            !scope?.root?.isConnected ||
            !scope?.video?.isConnected ||
            !scope.root.contains(scope.video) ||
            !this._isPlayerLifecycleCurrent(
                platform,
                platformGeneration,
                pathname,
                scope.root
            )
        ) {
            return false;
        }

        const task = this.pageObserverTask;
        if (
            task?.platform === platform &&
            task.platformGeneration === platformGeneration &&
            task.pathname === pathname &&
            task.root === scope.root &&
            this._isPlayerRootObservationTaskCurrent(task)
        ) {
            task.videoScope = { root: scope.root, video: scope.video };
            return true;
        }

        return this.setupDOMObservation();
    }

    /**
     * Setup one lifecycle-owned observer scoped to a verified player root and,
     * when available, its bounded direct-parent shell.
     * There is deliberately no document/body fallback.
     * @returns {boolean} Whether an observer owns the current verified scope.
     */
    setupDOMObservation() {
        if (this.domObservationCancellationDepth > 0) {
            return false;
        }
        const setupGeneration = this.domObservationSetupGeneration + 1;
        this.domObservationSetupGeneration = setupGeneration;
        const previousTask = this.pageObserverTask;
        const previousObserver = this.pageObserver;
        const platform = this.activePlatform;
        const platformGeneration = this.platformInitializationGeneration;
        const pathname = window.location.pathname;
        const stillOwnsInitialSnapshot = () =>
            this.domObservationSetupGeneration === setupGeneration &&
            this.pageObserverTask === previousTask &&
            this.pageObserver === previousObserver;
        const releaseInitialSnapshot = () => {
            if (!stillOwnsInitialSnapshot()) {
                return;
            }
            this._releasePlayerRootObservationTask(
                previousTask,
                previousTask ? null : previousObserver
            );
        };

        if (
            !this._isPlayerLifecycleCurrent(
                platform,
                platformGeneration,
                pathname
            ) ||
            !stillOwnsInitialSnapshot()
        ) {
            releaseInitialSnapshot();
            return false;
        }

        const verifiedScope = this._getVerifiedVideoSetupScope(platform);
        if (
            !verifiedScope ||
            !stillOwnsInitialSnapshot() ||
            !this._isPlayerLifecycleCurrent(
                platform,
                platformGeneration,
                pathname,
                verifiedScope.root
            ) ||
            !stillOwnsInitialSnapshot()
        ) {
            releaseInitialSnapshot();
            return false;
        }

        if (
            previousTask?.platform === platform &&
            previousTask.platformGeneration === platformGeneration &&
            previousTask.pathname === pathname &&
            previousTask.root === verifiedScope.root &&
            previousTask.videoScope?.video === verifiedScope.video &&
            this._isPlayerRootObservationTaskCurrent(previousTask) &&
            stillOwnsInitialSnapshot()
        ) {
            return true;
        }

        releaseInitialSnapshot();
        if (
            this.domObservationSetupGeneration !== setupGeneration ||
            this.pageObserverTask !== null ||
            this.pageObserver !== null ||
            !this._isPlayerLifecycleCurrent(
                platform,
                platformGeneration,
                pathname,
                verifiedScope.root
            ) ||
            this.domObservationSetupGeneration !== setupGeneration
        ) {
            return false;
        }

        const observationShell = this._getVerifiedPlayerObservationShell(
            verifiedScope.root
        );
        const task = {
            observer: null,
            timeoutId: null,
            timeoutInstallationPending: false,
            platform,
            platformGeneration,
            pathname,
            root: verifiedScope.root,
            observationShell,
            videoScope: verifiedScope,
        };
        let observer;
        try {
            observer = new MutationObserver((mutationsList) => {
                this._schedulePlayerRootMutation(task, mutationsList);
            });
        } catch (_) {
            return false;
        }
        task.observer = observer;

        if (
            this.domObservationSetupGeneration !== setupGeneration ||
            this.pageObserverTask !== null ||
            this.pageObserver !== null ||
            !this._isPlayerLifecycleCurrent(
                platform,
                platformGeneration,
                pathname,
                verifiedScope.root
            ) ||
            this.domObservationSetupGeneration !== setupGeneration
        ) {
            try {
                observer.disconnect();
            } catch (_) {}
            return false;
        }

        this.pageObserverTask = task;
        this.pageObserver = observer;
        try {
            observer.observe(verifiedScope.root, {
                childList: true,
                subtree: true,
            });
            if (task.observationShell) {
                try {
                    observer.observe(task.observationShell, {
                        childList: true,
                        subtree: false,
                    });
                } catch (_) {
                    task.observationShell = null;
                }
            }
        } catch (_) {
            this._releasePlayerRootObservationTask(task);
            return false;
        }

        if (
            this.domObservationSetupGeneration !== setupGeneration ||
            !this._isPlayerRootObservationTaskCurrent(task)
        ) {
            if (!this._releasePlayerRootObservationTask(task)) {
                try {
                    observer.disconnect();
                } catch (_) {}
            }
            return false;
        }
        return true;
    }

    // ========================================
    // CHROME MESSAGE HANDLING
    // ========================================

    /**
     * Handle Chrome message routing and processing
     * Main entry point for all Chrome extension messages with extensible action-based routing
     * @param {Object} request - Chrome message request
     * @param {Object} sender - Message sender
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleChromeMessage(request, sender, sendResponse) {
        if (getAIContextLifecycleState(this)?.terminal) {
            try {
                sendResponse(
                    buildChromeMessageFailureResponse(
                        request,
                        'Content script lifecycle is terminal'
                    )
                );
            } catch (_) {}
            return false;
        }
        try {
            // Validate request object
            if (!request) {
                this.logWithFallback(
                    'warn',
                    'Received null or undefined request'
                );
                sendResponse({
                    success: false,
                    error: 'Invalid request format',
                });
                return false;
            }

            const action = readProtocolMessageAction(request);

            if (action !== MessageActions.SIDEPANEL_GET_STATE) {
                this.logWithFallback('debug', 'Received Chrome message', {
                    hasUtilities: Boolean(
                        this.subtitleUtils && this.configService
                    ),
                });
            }

            // Validate message structure
            if (!action) {
                this.logWithFallback(
                    'warn',
                    'Received message without a valid protocol action',
                    { requestKeyCount: Object.keys(request).length }
                );
                sendResponse({
                    success: false,
                    error: 'Invalid message action',
                });
                return false;
            }

            // Check if we have a registered handler for this action
            const handlerConfig = this.messageHandlers.get(action);
            if (handlerConfig) {
                const senderIdentity = classifyExtensionMessageSender(sender);
                if (
                    !senderIdentity ||
                    !handlerConfig.senderRoles.includes(senderIdentity.role)
                ) {
                    this.logWithFallback(
                        'warn',
                        'Rejected message from unauthorized sender'
                    );
                    sendResponse({
                        success: false,
                        error: 'Unauthorized message sender',
                    });
                    return false;
                }

                if (action !== MessageActions.SIDEPANEL_GET_STATE) {
                    this.logWithFallback(
                        'debug',
                        'Using registered message handler',
                        {
                            requiresUtilities: Boolean(
                                handlerConfig.requiresUtilities
                            ),
                        }
                    );
                }

                // Check if handler requires utilities and they're not loaded
                if (
                    handlerConfig.requiresUtilities &&
                    (!this.subtitleUtils || !this.configService)
                ) {
                    this.logWithFallback(
                        'error',
                        'Handler requires utilities but they are not loaded'
                    );
                    sendResponse(
                        buildChromeMessageFailureResponse(
                            request,
                            'Utilities not loaded'
                        )
                    );
                    return true; // Return true to indicate async handling (even though it's immediate)
                }

                return handlerConfig.handler(
                    request,
                    sendResponse,
                    senderIdentity
                );
            }

            this.logWithFallback('warn', 'Unknown message action');
            sendResponse({ success: false, error: 'Unknown message action' });
            return false;
        } catch {
            this.logWithFallback('error', 'Error in Chrome message handling');
            sendResponse(
                buildChromeMessageFailureResponse(
                    request,
                    'Message handling failed'
                )
            );
            return false;
        }
    }

    /**
     * Handle config changed message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleConfigChanged(request, sendResponse, senderIdentity) {
        const parsedRequest = parseConfigChangedRequestMessage(
            request,
            senderIdentity?.role
        );
        if (!parsedRequest) {
            sendResponse(null);
            return false;
        }

        try {
            const canonicalChanges = {};
            for (const key of Object.keys(parsedRequest.changes)) {
                Object.defineProperty(canonicalChanges, key, {
                    value: prepareSettingValue(key, parsedRequest.changes[key]),
                    enumerable: true,
                    configurable: true,
                    writable: true,
                });
            }

            this.logWithFallback('debug', 'Handling config changed', {
                changedKeyCount: Object.keys(canonicalChanges).length,
            });

            if (this.activePlatform && this.subtitleUtils.subtitlesActive) {
                Object.assign(this.currentConfig, canonicalChanges);

                if (
                    canonicalChanges.useNativeSubtitles !== undefined &&
                    canonicalChanges.useOfficialTranslations === undefined
                ) {
                    this.currentConfig.useOfficialTranslations =
                        canonicalChanges.useNativeSubtitles;
                }

                this.subtitleUtils.applySubtitleStyling(this.currentConfig);
                const videoElement = this.activePlatform.getVideoElement();
                const playbackTime = resolvePlaybackTime(
                    this.activePlatform,
                    videoElement
                );
                if (playbackTime !== null) {
                    this.subtitleUtils.updateSubtitles(
                        playbackTime,
                        this.activePlatform,
                        this.currentConfig,
                        this.logPrefix
                    );
                }
                this.logWithFallback(
                    'info',
                    'Applied immediate config changes',
                    {
                        changedKeyCount: Object.keys(canonicalChanges).length,
                    }
                );
            }
            sendResponse(
                buildContentControlResponseMessage(parsedRequest, {
                    success: true,
                })
            );
            return false;
        } catch (error) {
            this.logWithFallback('error', 'Error in handleConfigChanged');
            sendResponse(
                buildContentControlResponseMessage(parsedRequest, {
                    success: false,
                    error: 'Invalid configuration change',
                })
            );
            return false;
        }
    }

    /**
     * Handle logging level changed message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleLoggingLevelChanged(request, sendResponse, senderIdentity) {
        const parsedRequest = parseLoggingLevelChangedRequestMessage(
            request,
            senderIdentity?.role
        );
        if (!parsedRequest) {
            sendResponse(null);
            return false;
        }

        try {
            this.logWithFallback('debug', 'Handling logging level change');

            if (this.contentLogger) {
                this.contentLogger.updateLevel(parsedRequest.level);
                this.contentLogger.info(
                    'Logging level updated from background script'
                );
            } else {
                this.logWithFallback(
                    'info',
                    'Logging level change received but logger not initialized yet'
                );
            }
            sendResponse(
                buildContentControlResponseMessage(parsedRequest, {
                    success: true,
                })
            );
            return false;
        } catch (error) {
            this.logWithFallback('error', 'Error in handleLoggingLevelChanged');
            sendResponse(
                buildContentControlResponseMessage(parsedRequest, {
                    success: false,
                    error: 'Logging level update failed',
                })
            );
            return false;
        }
    }

    /**
     * Handle side panel get state: returns currently highlighted words and languages
     */
    handleSidePanelGetState(request, sendResponse) {
        const republishRequest =
            parseSidePanelSelectionRepublishRequestMessage(request);
        const state = getContentSelectionAuthorityState(this);
        if (!republishRequest || !state || state.terminal || !state.snapshot) {
            sendResponse(null);
            return false;
        }

        const snapshot = state.snapshot;
        const lifecycleGeneration = state.lifecycleGeneration;
        void queueContentSelectionSnapshot(
            this,
            snapshot,
            () =>
                !state.terminal &&
                state.lifecycleGeneration === lifecycleGeneration &&
                state.snapshot === snapshot
        ).then(
            (accepted) => {
                sendResponse(
                    accepted &&
                        !state.terminal &&
                        state.lifecycleGeneration === lifecycleGeneration &&
                        state.snapshot === snapshot
                        ? buildSidePanelSelectionRepublishAck(republishRequest)
                        : null
                );
            },
            () => sendResponse(null)
        );
        return true;
    }

    /**
     * Handle side panel update state: clear/apply highlights
     */
    handleSidePanelUpdateState(request, sendResponse) {
        const command = parseSidePanelSelectionRemovalCommandMessage(request);
        const state = getContentSelectionAuthorityState(this);
        const reject = () => {
            try {
                sendResponse(
                    command
                        ? buildSidePanelSelectionRemovalCommandResponse(
                              command,
                              'rejected'
                          )
                        : null
                );
            } catch (_) {
                sendResponse(null);
            }
        };
        if (!command) {
            reject();
            return false;
        }
        const current = state?.snapshot;
        const entry = current?.entries.find(
            (candidate) => candidate.wordIndex === command.wordIndex
        );
        const positionKey = `original:${command.renderRevision}:${command.wordIndex}`;
        const element = entry
            ? this._findPrivateSelectionWordElement({
                  renderRevision: command.renderRevision,
                  wordIndex: command.wordIndex,
                  word: entry.word,
              })
            : null;
        if (
            !state ||
            state.terminal ||
            state.pendingRemoval ||
            !current ||
            command.lifecycleGeneration !== state.lifecycleGeneration ||
            command.selectionRevision !== current.selectionRevision ||
            command.renderRevision !== current.renderRevision ||
            !entry ||
            !element ||
            !state.selectionModel.has(positionKey)
        ) {
            reject();
            return false;
        }

        const successorRevision = allocateContentSelectionRevision(state);
        const successor =
            successorRevision === null
                ? null
                : createCanonicalContentSelectionSnapshot(
                      state,
                      successorRevision,
                      current.renderRevision,
                      'remove',
                      current.entries.filter(
                          (candidate) =>
                              candidate.wordIndex !== command.wordIndex
                      )
                  );
        if (!successor) {
            reject();
            return false;
        }

        const pending = {
            command,
            current,
            successor,
            positionKey,
            entry,
            element,
        };
        state.pendingRemoval = pending;
        void queueContentSelectionSnapshot(
            this,
            successor,
            () => state.pendingRemoval === pending && state.snapshot === current
        ).then(
            async (accepted) => {
                if (
                    !accepted ||
                    state.terminal ||
                    state.pendingRemoval !== pending ||
                    state.snapshot !== current ||
                    state.currentRenderRevision !== current.renderRevision ||
                    !state.selectionModel.has(positionKey)
                ) {
                    if (state.pendingRemoval === pending) {
                        state.pendingRemoval = null;
                    }
                    if (!state.terminal && state.snapshot === current) {
                        await this._repairCanonicalContentSelection(
                            state,
                            current
                        );
                    }
                    reject();
                    return;
                }

                const removed = state.selectionModel.remove(
                    entry.word,
                    null,
                    positionKey
                );
                if (!removed) {
                    state.pendingRemoval = null;
                    await this._repairCanonicalContentSelection(state, current);
                    reject();
                    return;
                }
                state.snapshot = successor;
                state.pendingRemoval = null;
                try {
                    element.classList.remove('dualsub-word-selected');
                } catch (_) {}
                this._clearPrivateSelectionWordProjection({
                    renderRevision: command.renderRevision,
                    wordIndex: command.wordIndex,
                    word: entry.word,
                });
                publishSelectionSnapshotToOwner(
                    this.aiContextFeatureOwner,
                    successor
                );
                sendResponse(
                    buildSidePanelSelectionRemovalCommandResponse(
                        command,
                        'applied'
                    )
                );
            },
            async () => {
                if (state.pendingRemoval === pending) {
                    state.pendingRemoval = null;
                }
                if (!state.terminal && state.snapshot === current) {
                    await this._repairCanonicalContentSelection(state, current);
                }
                reject();
            }
        );
        return true;
    }

    /**
     * Pause the video using multiple strategies
     */
    handleSidePanelPauseVideo(request, sendResponse, senderIdentity) {
        const parsedRequest = parseSidePanelPauseVideoRequestMessage(
            request,
            senderIdentity?.role
        );
        if (!parsedRequest) {
            sendResponse(null);
            return false;
        }

        const respond = (result) =>
            sendResponse(
                buildContentControlResponseMessage(parsedRequest, result)
            );

        void (async () => {
            try {
                // Prefer the platform action, but only trust an explicitly
                // verified success. Stateful players may veto the generic
                // media fallback when bypassing their controller would split
                // playback and UI state.
                const playbackPlatform = this.activePlatform;
                let allowsDirectMediaFallback = true;
                if (
                    playbackPlatform &&
                    typeof playbackPlatform.pausePlayback === 'function'
                ) {
                    try {
                        const fallbackPolicy =
                            playbackPlatform.allowsDirectMediaPlaybackFallback;
                        if (typeof fallbackPolicy === 'function') {
                            allowsDirectMediaFallback =
                                TRUSTED_REFLECT_APPLY(
                                    fallbackPolicy,
                                    playbackPlatform,
                                    []
                                ) !== false;
                        }
                    } catch (_) {}
                    try {
                        const platformPaused =
                            await playbackPlatform.pausePlayback();
                        if (platformPaused === true) {
                            respond({ success: true });
                            return;
                        }
                    } catch {
                        this.logWithFallback(
                            'warn',
                            'Platform-specific pause failed; using fallback'
                        );
                    }
                    if (!allowsDirectMediaFallback) {
                        respond({
                            success: false,
                            error: 'Platform playback control could not pause the video',
                        });
                        return;
                    }
                }

                const pauseSucceeded = await (async () => {
                    try {
                        const getCurrentVideo = () => {
                            if (
                                this.activePlatform &&
                                typeof this.activePlatform.getVideoElement ===
                                    'function'
                            ) {
                                try {
                                    const platformVideo =
                                        this.activePlatform.getVideoElement();
                                    if (platformVideo) return platformVideo;
                                } catch (_) {}
                            }

                            const attachedVideo = document.querySelector(
                                'video[data-listener-attached="true"]'
                            );
                            if (attachedVideo) return attachedVideo;

                            return document.querySelector('video');
                        };
                        const isStopped = (video) =>
                            Boolean(video && (video.paused || video.ended));

                        // Strategy 1: Direct HTML5 pause (universal)
                        const v = getCurrentVideo();
                        if (v) {
                            if (isStopped(v)) return true;
                            try {
                                v.pause();
                            } catch (_) {}
                            await new Promise((resolve) =>
                                setTimeout(resolve, 80)
                            );
                            if (isStopped(getCurrentVideo())) return true;
                        }

                        // Strategy 2: Click any visible Pause/Play control (generic platforms)
                        try {
                            const pauseBtn = document.querySelector(
                                'button[aria-label*="Pause" i], button[data-uia*="pause" i], button.play-button.control[part="play-button"], button[part="play-button"]'
                            );
                            if (pauseBtn) {
                                pauseBtn.click();
                                await new Promise((resolve) =>
                                    setTimeout(resolve, 140)
                                );
                                if (isStopped(getCurrentVideo())) return true;
                            }
                        } catch (_) {}

                        // Strategy 3: As absolute fallback, try another direct pause
                        try {
                            const v3 = getCurrentVideo();
                            if (v3) {
                                if (isStopped(v3)) return true;
                                try {
                                    v3.pause();
                                } catch (_) {}
                                await new Promise((resolve) =>
                                    setTimeout(resolve, 60)
                                );
                                if (isStopped(getCurrentVideo())) return true;
                            }
                        } catch (_) {}
                        return false;
                    } catch (_) {
                        return false;
                    }
                })();

                respond(
                    pauseSucceeded
                        ? { success: true }
                        : {
                              success: false,
                              error: 'No active video could be paused',
                          }
                );
            } catch (error) {
                this.logWithFallback(
                    'warn',
                    'Error while attempting to pause video'
                );
                respond({
                    success: false,
                    error: 'Video pause failed',
                });
            }
        })();

        // Chrome before 148 requires a literal true to keep sendResponse alive.
        return true;
    }

    // ========================================
    // CLEANUP AND LIFECYCLE MANAGEMENT
    // ========================================

    /**
     * Setup cleanup handlers for proper resource disposal
     */
    setupCleanupHandlers() {
        // Setup Chrome message handler
        this._attachChromeMessageListener();

        // Handle extension context invalidation
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

        // Handle page visibility changes with tracked cleanup ownership.
        if (!this.visibilityChangeHandler) {
            const visibilityChangeHandler = () => {
                if (document.hidden) {
                    this._cancelVisibilityVideoSetupRetry();
                    this.logWithFallback(
                        'debug',
                        'Page hidden, pausing operations'
                    );
                    return;
                }

                this.logWithFallback(
                    'debug',
                    'Page visible, resuming operations'
                );
                try {
                    finalizeExpiredSubtitleIfNeeded(0.1, this.activePlatform);
                } catch (_) {
                    this.logWithFallback(
                        'warn',
                        'Failed to finalize subtitles after visibility restore'
                    );
                }
                if (
                    this.activePlatform &&
                    this.subtitleUtils &&
                    this.subtitleUtils.subtitlesActive
                ) {
                    this._scheduleVisibilityVideoSetupRetry();
                }
                const selectionState = getContentSelectionAuthorityState(this);
                if (
                    selectionState &&
                    !selectionState.terminal &&
                    selectionState.snapshot
                ) {
                    void queueContentSelectionSnapshot(
                        this,
                        selectionState.snapshot
                    );
                }
            };
            this.visibilityChangeHandler = visibilityChangeHandler;
            document.addEventListener(
                'visibilitychange',
                visibilityChangeHandler
            );
            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(
                    'visibilitychange',
                    visibilityChangeHandler
                );
                if (this.visibilityChangeHandler === visibilityChangeHandler) {
                    this.visibilityChangeHandler = null;
                }
                this._cancelVisibilityVideoSetupRetry();
            });
        }

        if (!this.pageShowSelectionHandler) {
            const pageShowSelectionHandler = () => {
                const selectionState = getContentSelectionAuthorityState(this);
                if (
                    selectionState &&
                    !selectionState.terminal &&
                    selectionState.snapshot
                ) {
                    void queueContentSelectionSnapshot(
                        this,
                        selectionState.snapshot
                    );
                }
            };
            this.pageShowSelectionHandler = pageShowSelectionHandler;
            window.addEventListener('pageshow', pageShowSelectionHandler);
            this.eventListenerCleanupFunctions.push(() => {
                window.removeEventListener(
                    'pageshow',
                    pageShowSelectionHandler
                );
                if (
                    this.pageShowSelectionHandler === pageShowSelectionHandler
                ) {
                    this.pageShowSelectionHandler = null;
                }
            });
        }
    }

    /**
     * Clean up all resources and event listeners with proper resource disposal
     * Comprehensive cleanup method that ensures no memory leaks or hanging resources
     * @param {boolean} force - Force cleanup even if already cleaned up
     * @returns {Promise<void>}
     */
    cleanup(force = false) {
        const lifecycleState = getAIContextLifecycleState(this);
        if (lifecycleState?.terminalCleanupPromise) {
            return lifecycleState.terminalCleanupPromise;
        }
        if (lifecycleState?.terminal && !force) {
            logAIContextLifecycleFailure(
                this,
                'debug',
                'Cleanup already performed, skipping'
            );
            return Promise.resolve();
        }

        const selectionState = getContentSelectionAuthorityState(this);
        if (selectionState && !selectionState.terminal) {
            selectionState.terminal = true;
            selectionState.pendingRemoval = null;
            selectionState.publisherInstallationGeneration += 1;
            const publisherCleanup = selectionState.publisherCleanup;
            selectionState.publisherCleanup = null;
            try {
                publisherCleanup?.();
            } catch (_) {}
        }

        let resolveTerminalCleanup;
        let rejectTerminalCleanup;
        const terminalCleanupPromise = new Promise((resolve, reject) => {
            resolveTerminalCleanup = resolve;
            rejectTerminalCleanup = reject;
        });
        if (lifecycleState) {
            // Publish the canonical terminal promise before any destructor or
            // lifecycle callback can synchronously reenter cleanup().
            lifecycleState.terminalCleanupPromise = terminalCleanupPromise;
        }

        const performTerminalCleanup = async () => {
            const failures = [];
            const attemptSync = (cleanupPhase) => {
                try {
                    return cleanupPhase();
                } catch (error) {
                    failures.push(error);
                    return undefined;
                }
            };
            const attemptAsync = async (cleanupPhase) => {
                try {
                    return await cleanupPhase();
                } catch (error) {
                    failures.push(error);
                    return undefined;
                }
            };
            const hadAIContextManager = Boolean(this.aiContextManager);
            if (lifecycleState) {
                lifecycleState.terminal = true;
            }
            attemptSync(() =>
                revokeInjectionChannel(this.getInjectScriptConfig())
            );
            const terminalAIContextTransition = attemptSync(() =>
                beginAIContextFeatureLifecycle(this, true)
            );

            logAIContextLifecycleFailure(
                this,
                'info',
                'Starting comprehensive content script cleanup'
            );

            attemptSync(() => this._invalidatePlatformInitialization());
            attemptSync(() => this._cancelEarlyInjectionRetry());

            // 1. Stop all detection and monitoring activities
            await attemptAsync(() => this._stopAllDetectionActivities());

            // 2. Clean up AI Context Manager
            await attemptAsync(() =>
                BaseContentScript.prototype._cleanupAIContextManager.call(
                    this,
                    terminalAIContextTransition,
                    hadAIContextManager
                )
            );

            // 3. Clean up platform resources
            await attemptAsync(() => this._cleanupPlatformResources());

            // 4. Clean up DOM and UI resources
            await attemptAsync(() => this._cleanupDOMResources());

            // 5. Clean up event handling and listeners
            await attemptAsync(() => this._cleanupEventHandling());

            // 6. Clean up intervals and timers
            await attemptAsync(() => this._cleanupTimersAndIntervals());

            // 7. Clean up observers and watchers
            await attemptAsync(() => this._cleanupObservers());

            // 8. Reset internal state
            attemptSync(() => this._resetInternalState());

            // Late stale registrations use fresh private groups. Repeat the
            // terminal join after downstream teardown to catch all of them.
            await attemptAsync(() => settleAllAIContextTaskGroups(this));

            if (failures.length === 0) {
                logAIContextLifecycleFailure(
                    this,
                    'info',
                    'Content script cleanup completed successfully'
                );
                return;
            }
            if (failures.length === 1) {
                throw failures[0];
            }
            throw new AggregateError(
                failures,
                'Content script cleanup failed in multiple phases'
            );
        };

        void performTerminalCleanup().then(
            () => {
                if (
                    lifecycleState?.terminalCleanupPromise ===
                    terminalCleanupPromise
                ) {
                    lifecycleState.terminalCleanupPromise = null;
                }
                resolveTerminalCleanup();
            },
            (error) => {
                if (
                    lifecycleState?.terminalCleanupPromise ===
                    terminalCleanupPromise
                ) {
                    lifecycleState.terminalCleanupPromise = null;
                }
                rejectTerminalCleanup(error);
            }
        );
        return terminalCleanupPromise;
    }

    /**
     * Stop all detection and monitoring activities
     * @private
     * @returns {Promise<void>}
     */
    async _stopAllDetectionActivities() {
        const navigationManager = this.navigationDetectionManager;
        this.navigationDetectionManager = null;
        try {
            navigationManager?.cleanup();
        } catch {
            logAIContextLifecycleFailure(
                this,
                'warn',
                'Error stopping navigation detection'
            );
        }

        try {
            this.stopVideoElementDetection();
        } catch {
            logAIContextLifecycleFailure(
                this,
                'warn',
                'Error stopping video detection'
            );
        }

        logAIContextLifecycleFailure(
            this,
            'debug',
            'All detection activities stopped'
        );
    }

    /**
     * Clean up AI Context Manager resources
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupAIContextManager(transition = null, hadManager = null) {
        if (hadManager === null) {
            hadManager = Boolean(this.aiContextManager);
        }
        if (!transition) {
            transition = beginAIContextFeatureLifecycle(this);
        }
        try {
            if (hadManager) {
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'Cleaning up AI Context Manager...'
                );
            }

            await transition.cleanupPromise;

            if (hadManager) {
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'AI Context Manager cleaned up successfully'
                );
            }
        } catch {
            logAIContextLifecycleFailure(
                this,
                'error',
                'Error cleaning up AI Context Manager'
            );
        }
    }

    /**
     * Clean up platform-specific resources
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupPlatformResources() {
        try {
            if (this.activePlatform) {
                const platform = this.activePlatform;
                this.activePlatform = null;
                this.platformReady = false;

                // Call platform cleanup with timeout protection
                const cleanupTimeout =
                    this.currentConfig?.cleanupTimeout ||
                    COMMON_CONSTANTS.CLEANUP_TIMEOUT;

                const cleanupPromise = this._cleanupPlatformCandidate(platform);

                let timeoutId;
                const timeoutPromise = new Promise((resolve) => {
                    timeoutId = setTimeout(() => {
                        try {
                            logAIContextLifecycleFailure(
                                this,
                                'warn',
                                'Platform cleanup timed out'
                            );
                        } finally {
                            resolve();
                        }
                    }, cleanupTimeout);
                });

                try {
                    await Promise.race([cleanupPromise, timeoutPromise]);
                } finally {
                    clearTimeout(timeoutId);
                }
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'Platform resources cleaned up'
                );
            }
        } catch {
            logAIContextLifecycleFailure(
                this,
                'warn',
                'Error cleaning up platform resources'
            );
            this.activePlatform = null;
        }
    }

    /**
     * Clean up DOM and UI resources
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupDOMResources() {
        try {
            // Clean up subtitle utilities and DOM elements
            if (this.subtitleUtils) {
                if (typeof this.subtitleUtils.clearSubtitleDOM === 'function') {
                    this.subtitleUtils.clearSubtitleDOM();
                }
                if (
                    typeof this.subtitleUtils.hideSubtitleContainer ===
                    'function'
                ) {
                    this.subtitleUtils.hideSubtitleContainer();
                }
                if (typeof this.subtitleUtils.cleanup === 'function') {
                    await this.subtitleUtils.cleanup();
                }
            }

            // Remove any injected scripts
            const config = this.getInjectScriptConfig();
            const injectedScript = document.getElementById(config.tagId);
            if (injectedScript) {
                injectedScript.remove();
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'Injected script removed from DOM'
                );
            }

            logAIContextLifecycleFailure(
                this,
                'debug',
                'DOM resources cleaned up'
            );
        } catch {
            logAIContextLifecycleFailure(
                this,
                'warn',
                'Error cleaning up DOM resources'
            );
        }
    }

    /**
     * Clean up event handling and listeners with enhanced memory management
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupEventHandling() {
        const attemptCleanup = (cleanupPhase, warning) => {
            try {
                cleanupPhase();
            } catch {
                logAIContextLifecycleFailure(this, 'warn', warning);
            }
        };

        attemptCleanup(
            () => revokeInjectionChannel(this.getInjectScriptConfig()),
            'Error revoking injected-script channel'
        );

        // Revoke acceptance before any unsubscribe can synchronously
        // re-enter setup. This teardown is terminal for this instance.
        this.configurationSubscriptionsAccepted = false;
        this.configurationSubscriptionGeneration += 1;
        this.configurationRefreshGeneration += 1;
        const configUnsubscribe = this.configUnsubscribe;
        this.configUnsubscribe = null;
        if (typeof configUnsubscribe === 'function') {
            attemptCleanup(
                () => configUnsubscribe(),
                'Error removing configuration listener'
            );
        }

        if (this.eventBuffer) {
            attemptCleanup(
                () => this.eventBuffer.clear(),
                'Error clearing event buffer'
            );
        }

        if (
            this.eventListenerCleanupFunctions &&
            this.eventListenerCleanupFunctions.length > 0
        ) {
            logAIContextLifecycleFailure(
                this,
                'debug',
                'Executing event listener cleanup functions'
            );
            const cleanupFunctions = this.eventListenerCleanupFunctions;
            this.eventListenerCleanupFunctions = [];
            for (const cleanupFn of cleanupFunctions) {
                attemptCleanup(
                    () => cleanupFn(),
                    'Error in event listener cleanup function'
                );
            }
        }

        if (this.chromeMessageListenerAttached) {
            const listener = this.chromeMessageListener;
            this.chromeMessageListenerAttached = false;
            if (
                typeof chrome !== 'undefined' &&
                chrome.runtime?.onMessage?.removeListener
            ) {
                attemptCleanup(
                    () => chrome.runtime.onMessage.removeListener(listener),
                    'Error removing Chrome message listener'
                );
            }
            logAIContextLifecycleFailure(
                this,
                'debug',
                'Chrome message listener removed'
            );
        }

        logAIContextLifecycleFailure(
            this,
            'debug',
            'Event handling cleaned up'
        );
    }

    /**
     * Clean up timers and intervals
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupTimersAndIntervals() {
        try {
            this._cancelVisibilityVideoSetupRetry();

            // Stop all managed intervals
            if (this.intervalManager) {
                this.intervalManager.clearAll();
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'All managed intervals cleared'
                );
            }

            // Clear video detection interval (backup cleanup)
            if (this.videoDetectionIntervalId !== null) {
                const intervalId = this.videoDetectionIntervalId;
                const intervalOwner = this.videoDetectionIntervalOwner;
                this.videoDetectionIntervalId = null;
                this.videoDetectionIntervalOwner = null;
                if (intervalOwner?.intervalId === intervalId) {
                    intervalOwner.intervalId = null;
                }
                clearInterval(intervalId);
            } else {
                this.videoDetectionIntervalOwner = null;
            }

            logAIContextLifecycleFailure(
                this,
                'debug',
                'Timers and intervals cleaned up'
            );
        } catch (error) {
            logAIContextLifecycleFailure(
                this,
                'warn',
                'Error cleaning up timers and intervals'
            );
            throw error;
        }
    }

    /**
     * Clean up observers and watchers with enhanced memory management
     * @private
     * @returns {Promise<void>}
     */
    async _cleanupObservers() {
        try {
            // Execute all tracked DOM observer cleanup functions
            if (
                this.domObserverCleanupFunctions &&
                this.domObserverCleanupFunctions.length > 0
            ) {
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'Executing DOM observer cleanup functions'
                );

                for (const cleanupFn of this.domObserverCleanupFunctions) {
                    try {
                        cleanupFn();
                    } catch {
                        logAIContextLifecycleFailure(
                            this,
                            'warn',
                            'Error in DOM observer cleanup function'
                        );
                    }
                }
                this.domObserverCleanupFunctions = [];
            }

            // Disconnect the exactly-owned player-root observer (including its
            // pending debounce) or one legacy unowned observer.
            if (this.pageObserverTask || this.pageObserver) {
                this._cancelPlayerRootObservation();
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'Player-root DOM observer disconnected'
                );
            }

            // Disconnect video element observer (fallback cleanup)
            if (this.videoElementObserver) {
                this.videoElementObserver.disconnect();
                this.videoElementObserver = null;
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'Video element observer disconnected (fallback)'
                );
            }

            // Disconnect passive video observer
            if (this.passiveVideoObserver) {
                this.passiveVideoObserver.disconnect();
                this.passiveVideoObserver = null;
                logAIContextLifecycleFailure(
                    this,
                    'debug',
                    'Passive video observer disconnected'
                );
            }

            // Clean up any other observers
            if (this.configObserver) {
                this.configObserver.disconnect();
                this.configObserver = null;
            }

            logAIContextLifecycleFailure(this, 'debug', 'Observers cleaned up');
        } catch {
            logAIContextLifecycleFailure(
                this,
                'warn',
                'Error cleaning up observers'
            );
        }
    }

    /**
     * Reset internal state to initial values
     * @private
     */
    _resetInternalState() {
        try {
            // Reset platform state
            this.platformReady = false;
            this.activePlatform = null;

            // Reset video detection state
            this.videoDetectionRetries = 0;
            this.videoDetectionIntervalId = null;
            this.videoDetectionIntervalOwner = null;
            this.videoDetectionGeneration += 1;
            this.videoDetectionTask = null;
            this.visibilityVideoSetupGeneration += 1;
            this.visibilityVideoSetupTask = null;
            this.lastVideoSetupScope = null;
            this.pageObserverTask = null;
            this.pageObserver = null;
            this.domObservationSetupGeneration += 1;
            this.domObservationCancellationDepth = 0;

            // Reset event handling state
            this.eventListenerAttached = false;

            // Clear configuration (keep reference but clear contents)
            if (this.currentConfig && typeof this.currentConfig === 'object') {
                Object.keys(this.currentConfig).forEach(
                    (key) => delete this.currentConfig[key]
                );
            }

            logAIContextLifecycleFailure(this, 'debug', 'Internal state reset');
        } catch {
            logAIContextLifecycleFailure(
                this,
                'warn',
                'Error resetting internal state'
            );
        }
    }
}
