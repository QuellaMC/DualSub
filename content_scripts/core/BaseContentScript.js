// @ts-check

import { EventBuffer, injectScript } from './utils.js';
import { COMMON_CONSTANTS } from './constants.js';
import {
    getOrCreateUiRoot,
    finalizeExpiredSubtitleIfNeeded,
    resolvePlaybackTime,
} from '../shared/subtitleUtilities.js';
import { MessageActions } from '../shared/constants/messageActions.js';
import { NavigationDetectionManager } from '../shared/navigationUtils.js';
import { AI_CONTEXT_SIGNAL_TYPES } from '../aicontext/core/AIContextChannel.js';
import {
    buildContentControlResponseMessage,
    buildSidePanelSelectionRemovalCommandResponse,
    buildSidePanelSelectionRepublishAck,
    classifyExtensionMessageSender,
    MessageSenderRoles,
    parseConfigChangedRequestMessage,
    parseLoggingLevelChangedRequestMessage,
    readProtocolMessageAction,
    parseSidePanelPauseVideoRequestMessage,
    parseSidePanelSelectionRemovalCommandMessage,
    parseSidePanelSelectionRepublishRequestMessage,
} from '../shared/protocol/messageProtocol.js';
import { prepareSettingValue } from '../../config/configSchema.js';
import {
    AI_CONTEXT_CONFIGURATION_KEYS,
    AI_CONTEXT_LIFECYCLE_CONFIG_KEYS,
    beginAIContextFeatureLifecycle,
    commitAIContextInteractionState,
    createAIContextHostFacade,
    destroyAIContextManagerCandidate,
    destroySidePanelIntegrationCandidate,
    getAIContextFeatureOwnerState,
    getAIContextLifecycleState,
    initializeAIContextLifecycle,
    isAIContextFeatureOwnerCurrent,
    logAIContextLifecycleFailure,
    preventStaleAIContextInteractionCommit,
    readExactOwnDataProjection,
    registerAIContextFeatureCleanup,
    registerAIContextInteractiveCleanup,
    setAIContextInteractionsEnabled,
    settleAllAIContextTaskGroups,
    trackAIContextInteractiveInitialization,
    trackAIContextManagerCandidateFactory,
} from './aiContextLifecycle.js';
import {
    allocateAnalysisRequestId,
    allocateContentSelectionRevision,
    clearContentSelectionHighlights,
    createCanonicalContentSelectionSnapshot,
    endContentSelectionAuthority,
    getContentSelectionAuthorityState,
    initializeContentSelectionAuthority,
    publishSelectionSnapshotToOwner,
    queueContentSelectionSnapshot,
} from './contentSelectionAuthority.js';
import { SidePanelWordRouter } from './sidePanelWordRouter.js';

function buildChromeMessageFailureResponse(request, error) {
    try {
        return buildContentControlResponseMessage(request, {
            success: false,
            error,
        });
    } catch {
        return { success: false, error };
    }
}

export class BaseContentScript {
    constructor(logPrefix) {
        if (new.target === BaseContentScript) {
            throw new Error(
                'BaseContentScript is abstract and cannot be instantiated directly'
            );
        }

        this.logPrefix = logPrefix;
        this.contentLogger = null;
        this.activePlatform = null;
        this.platformInitializationPromise = null;
        this.platformInitializationGeneration = 0;
        this.platformRetryTimeoutId = null;
        this.platformRetryResolve = null;
        this.pageEnterTask = null;
        this.cleanedPlatformInstances = new WeakSet();
        this.currentConfig = {};
        this.subtitleUtils = null;
        this.PlatformClass = null;
        this.configService = null;
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
        this.eventBuffer = new EventBuffer(() =>
            this.logWithFallback('debug', 'Event buffer diagnostic event.')
        );
        this.eventListenerAttached = false;
        this.visibilityChangeHandler = null;
        this.platformReady = false;
        this.eventListenerCleanupFunctions = [];
        this.pageObserver = null;
        this.pageObserverTask = null;
        this.domObservationSetupGeneration = 0;
        this.domObservationCancellationDepth = 0;

        this.aiContextManager = null;
        this.sidePanelIntegration = null;
        this.aiContextConfigurationIntentGeneration = 0;
        this.pendingAIContextConfigurationKeys = new Map();
        this.configurationSubscriptionGeneration = 0;
        this.configurationRefreshGeneration = 0;
        this.navigationDetectionManager = null;
        this.chromeMessageListener = null;
        this.configUnsubscribe = null;
        this.pageShowSelectionHandler = null;
        this.earlyInjectionRetryTask = null;
        this.messageHandlers = new Map();
        initializeAIContextLifecycle(this);
        initializeContentSelectionAuthority(this);
        this._setupCommonMessageHandlers();
        this._attachChromeMessageListener();
    }

    get aiContextLifecycleGeneration() {
        return getAIContextLifecycleState(this)?.generation ?? 0;
    }

    get aiContextActiveGeneration() {
        return getAIContextLifecycleState(this)?.activeGeneration ?? null;
    }

    get aiContextFeatureOwner() {
        return getAIContextLifecycleState(this)?.owner ?? null;
    }

    get isCleanedUp() {
        return getAIContextLifecycleState(this)?.terminal ?? true;
    }

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

    _setupCommonMessageHandlers() {
        const commonHandlers = [
            [
                MessageActions.SIDEPANEL_GET_STATE,
                this.handleSidePanelGetState,
                false,
                MessageSenderRoles.BACKGROUND,
            ],
            [
                MessageActions.SIDEPANEL_UPDATE_STATE,
                this.handleSidePanelUpdateState,
                false,
                MessageSenderRoles.BACKGROUND,
            ],
            [
                MessageActions.CONFIG_CHANGED,
                this.handleConfigChanged,
                true,
                MessageSenderRoles.POPUP,
            ],
            [
                MessageActions.LOGGING_LEVEL_CHANGED,
                this.handleLoggingLevelChanged,
                false,
                MessageSenderRoles.BACKGROUND,
            ],
            [
                MessageActions.SIDEPANEL_PAUSE_VIDEO,
                this.handleSidePanelPauseVideo,
                false,
                MessageSenderRoles.BACKGROUND,
            ],
        ];
        for (const [
            action,
            handler,
            requiresUtilities,
            senderRole,
        ] of commonHandlers) {
            this.messageHandlers.set(action, {
                handler: handler.bind(this),
                requiresUtilities,
                senderRoles: [senderRole],
            });
        }
    }

    _attachChromeMessageListener() {
        if (this.chromeMessageListener) return;

        if (
            typeof chrome !== 'undefined' &&
            chrome.runtime &&
            chrome.runtime.onMessage
        ) {
            const listener = this.handleChromeMessage.bind(this);
            chrome.runtime.onMessage.addListener(listener);
            this.chromeMessageListener = listener;
            this.logWithFallback('debug', 'Chrome message listener attached.');
        } else {
            this.logWithFallback(
                'debug',
                'Chrome API not available, skipping message listener attachment.'
            );
        }
    }

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

    getPlatformName() {
        throw new Error('getPlatformName() must be implemented by subclass');
    }

    getPlatformClass() {
        throw new Error('getPlatformClass() must be implemented by subclass');
    }

    getInjectScriptConfig() {
        throw new Error(
            'getInjectScriptConfig() must be implemented by subclass'
        );
    }

    setupNavigationDetection() {
        throw new Error(
            'setupNavigationDetection() must be implemented by subclass'
        );
    }

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

            if (!(await this.initializeAIContextFeatures())) {
                this.logWithFallback(
                    'warn',
                    'AI context features initialization failed, continuing without AI context.'
                );
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

    async initializeAIContextFeatures() {
        const { owner, cleanupPromise } = beginAIContextFeatureLifecycle(this);

        try {
            this.logWithFallback(
                'debug',
                'Checking AI context configuration...'
            );

            if (!this.configService) {
                this.logWithFallback(
                    'debug',
                    'Config service not available, skipping AI context initialization'
                );
                return false;
            }

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

            await this._initializeSidePanelIntegration(owner);
            if (!isAIContextFeatureOwnerCurrent(this, owner)) {
                return false;
            }

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
                'Failed to initialize AI Context Manager'
            );
            setAIContextInteractionsEnabled(this, false);
            return false;
        }
    }

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
            const events = [
                [
                    'dualsub-system-initialized',
                    'info',
                    'AI Context system initialized',
                ],
                [
                    'dualsub-analysis-complete',
                    'debug',
                    'AI Context analysis completed',
                ],
                ['dualsub-analysis-error', 'warn', 'AI Context analysis error'],
                [
                    'dualsub-modal-state-change',
                    'debug',
                    'AI Context modal state changed',
                ],
            ];
            for (const [eventName, level, message] of events) {
                const listener = () => {
                    if (isAIContextFeatureOwnerCurrent(this, owner)) {
                        this.logWithFallback(level, message);
                    }
                };
                document.addEventListener(eventName, listener);
                registeredListeners.push([eventName, listener]);
            }
            registerAIContextFeatureCleanup(this, owner, () => {
                for (const [eventName, listener] of registeredListeners) {
                    document.removeEventListener(eventName, listener);
                }
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
                this.logWithFallback(
                    'info',
                    'Entering fullscreen, moving UI root.'
                );
                fullscreenElement.appendChild(uiRoot);
            } else {
                this.logWithFallback(
                    'info',
                    'Exiting fullscreen, moving UI root back to body.'
                );
                document.body.appendChild(uiRoot);
            }

            if (this.subtitleUtils?.updateSubtitlePosition) {
                this.subtitleUtils.updateSubtitlePosition(this.activePlatform);
            }
        };

        try {
            document.addEventListener(
                'fullscreenchange',
                handleFullscreenChange
            );

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

    async _initializeSidePanelIntegration(owner = this.aiContextFeatureOwner) {
        if (!isAIContextFeatureOwnerCurrent(this, owner)) return null;
        const previous = this.sidePanelIntegration;
        this.sidePanelIntegration = null;
        await destroySidePanelIntegrationCandidate(this, previous);
        if (!isAIContextFeatureOwnerCurrent(this, owner)) return null;

        const integration = new SidePanelWordRouter(
            () => isAIContextFeatureOwnerCurrent(this, owner),
            () =>
                logAIContextLifecycleFailure(
                    this,
                    'error',
                    'Side panel integration callback failed.'
                )
        );
        const cleanup = () => {
            if (this.sidePanelIntegration === integration) {
                this.sidePanelIntegration = null;
            }
            return destroySidePanelIntegrationCandidate(this, integration);
        };
        registerAIContextFeatureCleanup(this, owner, cleanup);
        if (!(await integration.initialize())) {
            await cleanup();
            return null;
        }
        this.sidePanelIntegration = integration;
        return integration;
    }

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

    async _initializeSubtitleUtilsInteractiveFeatures(
        aiContextConfig,
        owner = this.aiContextFeatureOwner
    ) {
        const initialize =
            this.subtitleUtils?.initializeInteractiveSubtitleFeatures;
        if (
            typeof initialize !== 'function' ||
            !getAIContextFeatureOwnerState(owner) ||
            !isAIContextFeatureOwnerCurrent(this, owner)
        ) {
            throw new Error('Interactive subtitle features are unavailable');
        }

        registerAIContextInteractiveCleanup(this, owner);
        const bindingCleanup = await initialize(
            {
                enabled: true,
                contextTypes: aiContextConfig.aiContextTypes,
                interactionMethods: { click: true, selection: true },
                textSelection: { maxLength: 100, smartBoundaries: true },
                loadingStates: {
                    timeout: aiContextConfig.aiContextTimeout,
                    retryAttempts: aiContextConfig.aiContextRetryAttempts,
                },
                platform: this.getPlatformName(),
            },
            () => isAIContextFeatureOwnerCurrent(this, owner),
            (intent) => this._handlePrivateWordIntent(owner, intent)
        );
        registerAIContextFeatureCleanup(this, owner, bindingCleanup);
        if (!isAIContextFeatureOwnerCurrent(this, owner)) return false;
        setAIContextInteractionsEnabled(this, true);
        return true;
    }

    async _getAIContextConfiguration() {
        try {
            const result = await this.configService.readMultipleResultStrict(
                AI_CONTEXT_CONFIGURATION_KEYS
            );
            return readExactOwnDataProjection(
                result,
                AI_CONTEXT_CONFIGURATION_KEYS
            );
        } catch {
            this.logWithFallback(
                'warn',
                'AI context configuration could not be verified.'
            );
            return null;
        }
    }

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

        let modalIntentPublished = false;
        const publishModalWordIntent = () => {
            const currentState = getContentSelectionAuthorityState(this);
            if (
                modalIntentPublished ||
                currentState !== state ||
                state.terminal ||
                state.snapshot !== snapshot ||
                state.currentRenderRevision !== intent.renderRevision ||
                !isAIContextFeatureOwnerCurrent(this, owner)
            ) {
                return false;
            }
            modalIntentPublished = true;
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
                    publishModalWordIntent
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
        publishModalWordIntent();
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
                return allocateAnalysisRequestId();
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

    _getPlatformFileName(platformName) {
        if (platformName === 'disneyplus') return 'disneyPlusPlatform.js';
        if (platformName === 'netflix') return 'netflixPlatform.js';
        return `${platformName.charAt(0).toUpperCase()}${platformName.slice(1)}Platform.js`;
    }

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

    async _initializeLoggerLevel(Logger) {
        try {
            const loggingLevel = await this.configService.get('loggingLevel');
            this.contentLogger.updateLevel(loggingLevel);
            this.contentLogger.info('Content script logger initialized');
        } catch (error) {
            this.contentLogger.updateLevel(Logger.LEVELS.INFO);
            this.contentLogger.warn(
                'Failed to load logging level from config, using INFO level'
            );
        }
    }

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

    _cancelPageEnterTask() {
        const task = this.pageEnterTask;
        this.pageEnterTask = null;
        if (task?.timeoutId !== null && task?.timeoutId !== undefined) {
            clearTimeout(task.timeoutId);
        }
    }

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

    _isPlatformGenerationCurrent(generation, platform = null) {
        return (
            generation === this.platformInitializationGeneration &&
            (!platform || this.activePlatform === platform)
        );
    }

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

    _validateInitializationPrerequisites() {
        return this._validateModulesLoaded();
    }

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

    _logInitializationStart(context) {
        this.logWithFallback('info', 'Starting platform initialization', {
            attempt: context.attempt,
            maxRetries: context.totalAttempts,
        });
    }

    async _prepareForInitialization() {
        if (
            this.subtitleUtils &&
            typeof this.subtitleUtils.setSubtitlesActive === 'function'
        ) {
            this.subtitleUtils.setSubtitlesActive(
                this.currentConfig.subtitlesEnabled
            );
        }

        if (this.activePlatform) {
            await this._cleanupPlatformInstance();
        }
    }

    async _initializeBasedOnPageType(platform, generation) {
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

    async _initializeForPlayerPage(platform, generation) {
        this.logWithFallback('info', 'Initializing platform on player page');

        await this._initializePlatformWithTimeout(platform, generation);

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

    async _initializePlatformWithTimeout(
        platform = this.activePlatform,
        generation = this.platformInitializationGeneration
    ) {
        const timeout =
            this.currentConfig?.platformInitTimeout ||
            COMMON_CONSTANTS.PLATFORM_INIT_TIMEOUT;

        const injectConfig = this.getInjectScriptConfig();
        const dispatchInjectorControl = (type) => {
            try {
                const detail = injectConfig.channel?.createEventDetail?.(type);
                if (!detail) return false;
                document.dispatchEvent(
                    new CustomEvent(injectConfig.eventId, { detail })
                );
                return true;
            } catch (_) {
                return false;
            }
        };

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
            },
            dispatchInjectorControl
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

    _normalizeConfiguration() {
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

    setupConfigurationListeners() {
        if (this.isCleanedUp) return;

        const subscriptionGeneration = ++this
            .configurationSubscriptionGeneration;
        this.configurationRefreshGeneration += 1;

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
                    canonicalAIContextChanges[key] = Object.hasOwn(
                        newConfig,
                        key
                    )
                        ? newConfig[key]
                        : undefined;
                }

                Object.assign(this.currentConfig, newConfig);

                this._normalizeConfiguration();

                this.applyConfigurationChanges(changes);

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

    _isCurrentConfigurationSubscription(subscriptionGeneration) {
        return (
            !this.isCleanedUp &&
            subscriptionGeneration === this.configurationSubscriptionGeneration
        );
    }

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

    applyConfigurationChanges(changes) {
        const uiOnlySettings = ['appearanceAccordionOpen'];
        const functionalChanges = Object.keys(changes).filter(
            (key) => !uiOnlySettings.includes(key)
        );

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

            if (
                Object.prototype.hasOwnProperty.call(
                    changes,
                    'aiContextEnabled'
                )
            ) {
                const enabled = !!changes.aiContextEnabled;
                if (enabled) {
                    await this._restartAIContextFeatures();
                } else {
                    await this._disableAIContextInteractions();
                }
                return;
            }

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

    setupEarlyEventHandling() {
        const config = this.getInjectScriptConfig();

        if (!this.eventListenerAttached) {
            const eventHandler = (e) => this.handleEarlyInjectorEvents(e);
            document.addEventListener(config.eventId, eventHandler, {
                passive: true,
            });
            this.eventListenerAttached = true;

            this.eventListenerCleanupFunctions.push(() => {
                document.removeEventListener(config.eventId, eventHandler);
                this.eventListenerAttached = false;
                this.logWithFallback('debug', 'Early event listener removed');
            });

            this.logWithFallback('debug', 'Early event listener attached');
        }

        this.injectScriptEarly();
    }

    handleEarlyInjectorEvents(e) {
        if (getAIContextLifecycleState(this)?.terminal) return false;
        try {
            const config = this.getInjectScriptConfig();
            const data = config.channel?.accept?.(e);
            if (!data) return;

            const eventData = Object.freeze({
                ...data,
                timestamp: Date.now(),
                pageUrl: window.location.href,
            });
            const isSubtitleEvent =
                data.type === 'SUBTITLE_DATA_FOUND' ||
                data.type === 'SUBTITLE_URL_FOUND';

            if (data.type === 'INJECT_SCRIPT_READY') {
                this.logWithFallback('info', 'Inject script is ready');
                if (this.eventBuffer.size() > 0) {
                    this.logWithFallback(
                        'debug',
                        'Clearing stale buffered events on script reload'
                    );
                    this.eventBuffer.clear();
                }
            }

            if (this.platformReady && this.activePlatform) {
                this.activePlatform.handleInjectorEvents(eventData);
            } else if (isSubtitleEvent) {
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
        } catch {
            this.logWithFallback(
                'error',
                'Error handling early injector event'
            );
        }
    }

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
                if (!eventData || !eventData.type) {
                    this.logWithFallback(
                        'warn',
                        'Skipping invalid buffered event',
                        { index }
                    );
                    return;
                }

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
                    this.activePlatform.handleInjectorEvents(eventData);
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

    injectScriptEarly() {
        if (getAIContextLifecycleState(this)?.terminal) return false;
        const config = this.getInjectScriptConfig();
        const scriptUrl = config.channel?.createScriptUrl?.(
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

    _isReplacementDetectionContextCurrent(context) {
        return (
            context.replacementRequired === true &&
            this._isVideoDetectionContextCurrent(context)
        );
    }

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

    _releasePlayerRootObservationTask(task, previousObserver = null) {
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
            previousObserver &&
            this.pageObserverTask === null &&
            this.pageObserver === previousObserver
        ) {
            this.pageObserver = null;
            try {
                previousObserver.disconnect();
            } catch (_) {}
            return true;
        }
        return false;
    }

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
                canonicalChanges[key] = prepareSettingValue(
                    key,
                    parsedRequest.changes[key]
                );
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
        sendResponse(buildSidePanelSelectionRepublishAck(republishRequest));
        void queueContentSelectionSnapshot(
            this,
            snapshot,
            () =>
                !state.terminal &&
                state.lifecycleGeneration === lifecycleGeneration &&
                state.snapshot === snapshot
        );
        return false;
    }

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
                                fallbackPolicy.call(playbackPlatform) !== false;
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

                let video = null;
                try {
                    video = playbackPlatform?.getVideoElement?.();
                } catch {}
                video ??= document.querySelector(
                    'video[data-listener-attached="true"], video'
                );
                let pauseSucceeded = Boolean(
                    video && (video.paused || video.ended)
                );
                if (video && !pauseSucceeded) {
                    try {
                        video.pause();
                        await new Promise((resolve) => setTimeout(resolve, 80));
                        pauseSucceeded = Boolean(video.paused || video.ended);
                    } catch {}
                }

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

        return true;
    }

    setupCleanupHandlers() {
        this._attachChromeMessageListener();

        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

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

    cleanup() {
        const lifecycleState = getAIContextLifecycleState(this);
        if (lifecycleState?.terminalCleanupPromise) {
            return lifecycleState.terminalCleanupPromise;
        }
        if (lifecycleState?.terminal) return Promise.resolve();

        endContentSelectionAuthority(this);

        let resolveTerminalCleanup;
        const terminalCleanupPromise = new Promise((resolve) => {
            resolveTerminalCleanup = resolve;
        });
        if (lifecycleState) {
            lifecycleState.terminalCleanupPromise = terminalCleanupPromise;
        }

        const performTerminalCleanup = async () => {
            const attemptSync = (cleanupPhase, warning) => {
                try {
                    return cleanupPhase();
                } catch {
                    logAIContextLifecycleFailure(this, 'warn', warning);
                    return undefined;
                }
            };
            const attempt = async (cleanupPhase, warning) => {
                try {
                    return await cleanupPhase();
                } catch {
                    logAIContextLifecycleFailure(this, 'warn', warning);
                }
            };
            lifecycleState.terminal = true;
            attemptSync(
                () =>
                    this.activePlatform?.prepareForInjectionChannelRevocation?.(),
                'Platform pre-revocation cleanup failed'
            );
            attemptSync(
                () => this.getInjectScriptConfig().channel?.revoke?.(),
                'Injected-script channel revocation failed'
            );
            const aiCleanup = beginAIContextFeatureLifecycle(this, true);
            this._invalidatePlatformInitialization();
            this._cancelEarlyInjectionRetry();
            await attempt(
                () => this._stopAllDetectionActivities(),
                'Detection cleanup failed'
            );
            await attempt(() => aiCleanup.cleanupPromise, 'AI cleanup failed');
            await attempt(
                () => this._cleanupPlatformResources(),
                'Platform cleanup failed'
            );
            await attempt(
                () => this._cleanupDOMResources(),
                'DOM cleanup failed'
            );
            await attempt(
                () => this._cleanupEventHandling(),
                'Event cleanup failed'
            );
            await attempt(
                () => settleAllAIContextTaskGroups(this),
                'Late AI cleanup failed'
            );
        };

        void performTerminalCleanup().then(resolveTerminalCleanup);
        return terminalCleanupPromise;
    }

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

    async _cleanupPlatformResources() {
        try {
            if (this.activePlatform) {
                const platform = this.activePlatform;
                this.activePlatform = null;
                this.platformReady = false;

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

    async _cleanupDOMResources() {
        try {
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

    async _cleanupEventHandling() {
        const attemptCleanup = (cleanupPhase, warning) => {
            try {
                cleanupPhase();
            } catch {
                logAIContextLifecycleFailure(this, 'warn', warning);
            }
        };

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

        if (this.chromeMessageListener) {
            const listener = this.chromeMessageListener;
            this.chromeMessageListener = null;
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
}
