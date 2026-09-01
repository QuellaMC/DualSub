import { jest } from '@jest/globals';

import { BaseContentScript } from '../core/BaseContentScript.js';
import { AIContextManager } from '../aicontext/core/AIContextManager.js';
import { createInjectionChannel } from '../shared/injectionChannel.js';
import {
    ChromeApiMock,
    mockChromeApi,
} from '../../test-utils/chrome-api-mock.js';

const AI_DOCUMENT_EVENTS = [
    'dualsub-system-initialized',
    'dualsub-analysis-complete',
    'dualsub-analysis-error',
    'dualsub-modal-state-change',
    'fullscreenchange',
];
const AI_MANAGER_MODULE_URL = new URL(
    '../aicontext/core/AIContextManager.js',
    import.meta.url
).href;

class TestPlatform {
    isPlayerPageActive() {
        return true;
    }

    async initialize() {}

    handleNativeSubtitles() {}

    async cleanup() {}
}

class TestContentScript extends BaseContentScript {
    constructor() {
        super('TestContent');
        this.injectConfig = {
            filename: 'injected_scripts/testInject.js',
            tagId: 'test-inject-script',
            eventId: 'test-subtitle-event',
            channel: createInjectionChannel('netflix'),
        };
    }

    getPlatformName() {
        return 'test';
    }

    getPlatformClass() {
        return TestPlatform;
    }

    getInjectScriptConfig() {
        return this.injectConfig;
    }

    setupNavigationDetection() {
        return this._setupNavigationManager({
            useFocusEvents: false,
            useIntervalChecking: false,
            usePopstateEvents: false,
        });
    }

    leavePlayerPage() {
        this._cleanupOnPlayerPageLeave();
    }

    _isPlayerPath(pathname) {
        return pathname.startsWith('/watch/');
    }
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function createSubtitleUtils(overrides = {}) {
    return {
        applySubtitleStyling: jest.fn(),
        cleanup: jest.fn().mockResolvedValue(),
        clearSubtitleDOM: jest.fn(),
        clearSubtitlesDisplayAndQueue: jest.fn(),
        ensureSubtitleContainer: jest.fn(),
        hideSubtitleContainer: jest.fn(),
        initializeInteractiveSubtitleFeatures: jest
            .fn()
            .mockResolvedValue(undefined),
        setInteractiveSubtitlesEnabled: jest.fn(),
        setSubtitlesActive: jest.fn(),
        showSubtitleContainer: jest.fn(),
        subtitlesActive: true,
        updateSubtitlePosition: jest.fn(),
        updateSubtitles: jest.fn(),
        ...overrides,
    };
}

function createPlatform({ initialize = Promise.resolve(), ...overrides } = {}) {
    return {
        cleanup: jest.fn().mockResolvedValue(),
        handleNativeSubtitles: jest.fn(),
        initialize: jest.fn(() => initialize),
        isPlayerPageActive: jest.fn(() => true),
        ...overrides,
    };
}

function createControllableVideo({ paused = false } = {}) {
    const video = document.createElement('video');
    const state = { paused };
    video.dataset.listenerAttached = 'true';
    Object.defineProperties(video, {
        paused: {
            configurable: true,
            get: () => state.paused,
        },
        pause: {
            configurable: true,
            value: jest.fn(() => {
                state.paused = true;
            }),
        },
    });
    return { state, video };
}

function installControlledMutationObserver() {
    const OriginalMutationObserver = global.MutationObserver;
    const instances = [];

    class ControlledMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.observe = jest.fn();
            this.disconnect = jest.fn();
            instances.push(this);
        }
    }

    global.MutationObserver = ControlledMutationObserver;
    return {
        instances,
        restore() {
            global.MutationObserver = OriginalMutationObserver;
        },
    };
}

function getActiveAIListeners(addEventListener, removeEventListener) {
    const active = new Map(
        AI_DOCUMENT_EVENTS.map((eventName) => [eventName, new Set()])
    );
    for (const [eventName, listener] of addEventListener.mock.calls) {
        active.get(eventName)?.add(listener);
    }
    for (const [eventName, listener] of removeEventListener.mock.calls) {
        active.get(eventName)?.delete(listener);
    }
    return active;
}

function enabledAIConfig() {
    return {
        values: {
            aiContextEnabled: true,
            aiContextProvider: 'openai',
            aiContextTypes: ['cultural'],
            aiContextTimeout: 30000,
            aiContextRetryAttempts: 1,
        },
    };
}

function disabledAIConfig() {
    return {
        values: {
            aiContextEnabled: false,
            aiContextProvider: 'openai',
            aiContextTypes: ['cultural'],
            aiContextTimeout: 30000,
            aiContextRetryAttempts: 1,
        },
    };
}

describe('BaseContentScript observable host behavior', () => {
    let chromeMock;
    let contentScript;
    let originalPath;
    let restoreChrome;

    beforeEach(() => {
        chromeMock = ChromeApiMock.create();
        restoreChrome = mockChromeApi(chromeMock);
        chromeMock.runtime.id = 'test';
        chromeMock.runtime.getManifest.mockReturnValue({
            background: { service_worker: 'background.js' },
            options_ui: { page: 'options/options.html' },
            action: { default_popup: 'popup/popup.html' },
            side_panel: { default_path: 'sidepanel/sidepanel.html' },
        });
        chromeMock.runtime.getURL.mockImplementation(
            (path = '') => `chrome-extension://test/${path}`
        );
        chromeMock.runtime.sendMessage.mockImplementation(
            (_message, callback) => {
                const response = { success: true };
                callback?.(response);
                return Promise.resolve(response);
            }
        );
        chromeMock.storage.sync.get.mockResolvedValue({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        });

        originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        document.body.replaceChildren();
        contentScript = new TestContentScript();
    });

    afterEach(async () => {
        try {
            await contentScript.cleanup();
        } finally {
            jest.useRealTimers();
            history.replaceState({}, '', originalPath || '/');
            document.body.replaceChildren();
            document.head
                .querySelectorAll('#test-inject-script')
                .forEach((element) => element.remove());
            restoreChrome();
        }
    });

    function createExtensionSender(path) {
        return {
            id: chromeMock.runtime.id,
            url: chromeMock.runtime.getURL(path),
        };
    }

    function createBackgroundSender() {
        return createExtensionSender('background.js');
    }

    function createPopupSender() {
        return createExtensionSender('popup/popup.html');
    }

    function configurePlatformInitialization() {
        contentScript.subtitleUtils = createSubtitleUtils();
        contentScript.configService = {};
        contentScript.currentConfig = {
            subtitlesEnabled: true,
            platformInitMaxRetries: 0,
            platformInitRetryDelay: 0,
            platformInitTimeout: 5000,
        };
        contentScript.processBufferedEvents = jest.fn();
        contentScript.startVideoElementDetection = jest.fn();
    }

    function installAIManagerModule() {
        chromeMock.runtime.getURL.mockImplementation((path = '') =>
            path === 'content_scripts/aicontext/core/AIContextManager.js'
                ? AI_MANAGER_MODULE_URL
                : `chrome-extension://test/${path}`
        );
    }

    function configureAI(config = enabledAIConfig()) {
        installAIManagerModule();
        contentScript.configService = {
            readMultipleResultStrict: jest.fn().mockResolvedValue(config),
        };
        contentScript.subtitleUtils = createSubtitleUtils();
        const initializations = [];
        const initialize = jest
            .spyOn(AIContextManager.prototype, 'initialize')
            .mockImplementation(function () {
                const outcome = initializations.shift();
                return outcome === undefined ? Promise.resolve(true) : outcome;
            });
        const enableFeature = jest
            .spyOn(AIContextManager.prototype, 'enableFeature')
            .mockImplementation(function (feature) {
                this.enabledFeatures.add(feature);
                return Promise.resolve(true);
            });
        const destroy = jest
            .spyOn(AIContextManager.prototype, 'destroy')
            .mockResolvedValue(undefined);
        return {
            destroy,
            enableFeature,
            initializations,
            initialize,
            readConfiguration:
                contentScript.configService.readMultipleResultStrict,
        };
    }

    describe('message routing', () => {
        beforeEach(() => {
            contentScript.subtitleUtils = createSubtitleUtils();
            contentScript.configService = {};
        });

        test('attaches one Chrome listener and removes it during cleanup', async () => {
            const registeredListener =
                chromeMock.runtime.onMessage.addListener.mock.calls[0][0];

            contentScript.setupCleanupHandlers();
            expect(
                chromeMock.runtime.onMessage.addListener
            ).toHaveBeenCalledTimes(1);

            await contentScript.cleanup();

            expect(
                chromeMock.runtime.onMessage.removeListener
            ).toHaveBeenCalledWith(registeredListener);
        });

        test('applies an authorized valid configuration change', () => {
            const video = document.createElement('video');
            video.currentTime = 42;
            contentScript.activePlatform = {
                getVideoElement: jest.fn(() => video),
            };
            contentScript.currentConfig = { sidePanelTheme: 'light' };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                {
                    action: 'configChanged',
                    changes: { sidePanelTheme: 'dark' },
                },
                createPopupSender(),
                sendResponse
            );

            expect(result).toBe(false);
            expect(contentScript.currentConfig.sidePanelTheme).toBe('dark');
            expect(
                contentScript.subtitleUtils.applySubtitleStyling
            ).toHaveBeenCalledWith(contentScript.currentConfig);
            expect(
                contentScript.subtitleUtils.updateSubtitles
            ).toHaveBeenCalledWith(
                42,
                contentScript.activePlatform,
                contentScript.currentConfig,
                'TestContent'
            );
            expect(sendResponse).toHaveBeenCalledWith({
                success: true,
            });
        });

        test('rejects a mixed valid and invalid configuration change atomically', () => {
            contentScript.currentConfig = { uiLanguage: 'en' };
            contentScript.activePlatform = {};
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                {
                    action: 'configChanged',
                    changes: {
                        uiLanguage: 'ja',
                        aiContextTimeout: 1,
                    },
                },
                createPopupSender(),
                sendResponse
            );

            expect(result).toBe(false);
            expect(contentScript.currentConfig).toEqual({ uiLanguage: 'en' });
            expect(
                contentScript.subtitleUtils.applySubtitleStyling
            ).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Invalid configuration change',
            });
        });

        test.each([
            ['sidePanelGetState', createPopupSender],
            ['sidePanelUpdateState', createPopupSender],
            ['configChanged', createBackgroundSender],
            ['LOGGING_LEVEL_CHANGED', createPopupSender],
            ['sidePanelPauseVideo', createPopupSender],
        ])('rejects an unauthorized sender for %s', (action, createSender) => {
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                { action },
                createSender(),
                sendResponse
            );

            expect(result).toBe(false);
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Unauthorized message sender',
            });
        });

        test('keeps the response channel open for a successful platform pause', async () => {
            contentScript.activePlatform = {
                pausePlayback: jest.fn().mockResolvedValue(true),
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                { action: 'sidePanelPauseVideo' },
                createBackgroundSender(),
                sendResponse
            );

            expect(result).toBe(true);
            expect(sendResponse).not.toHaveBeenCalled();
            await Promise.resolve();
            await Promise.resolve();
            expect(sendResponse).toHaveBeenCalledWith({
                success: true,
            });
        });

        test('falls back to the platform media element when needed', async () => {
            jest.useFakeTimers();
            const { video } = createControllableVideo();
            document.body.appendChild(video);
            contentScript.activePlatform = {
                pausePlayback: jest.fn().mockResolvedValue(false),
                getVideoElement: jest.fn(() => video),
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                { action: 'sidePanelPauseVideo' },
                createBackgroundSender(),
                sendResponse
            );
            await jest.advanceTimersByTimeAsync(80);

            expect(result).toBe(true);
            expect(video.pause).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                success: true,
            });
        });

        test('honors a platform veto of direct media fallback', async () => {
            const { video } = createControllableVideo();
            document.body.appendChild(video);
            contentScript.activePlatform = {
                pausePlayback: jest.fn().mockResolvedValue(false),
                allowsDirectMediaPlaybackFallback: jest.fn(() => false),
                getVideoElement: jest.fn(() => video),
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                { action: 'sidePanelPauseVideo' },
                createBackgroundSender(),
                sendResponse
            );
            await Promise.resolve();
            await Promise.resolve();

            expect(result).toBe(true);
            expect(video.pause).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Platform playback control could not pause the video',
            });
        });
    });

    describe('platform initialization', () => {
        beforeEach(configurePlatformInitialization);

        test('coalesces concurrent callers into one initialization', async () => {
            const gate = createDeferred();
            const platform = createPlatform({ initialize: gate.promise });
            contentScript.PlatformClass = jest.fn(() => platform);

            const first = contentScript.initializePlatform();
            const second = contentScript.initializePlatform();

            expect(second).toBe(first);
            await Promise.resolve();
            await Promise.resolve();
            expect(contentScript.PlatformClass).toHaveBeenCalledTimes(1);
            expect(platform.initialize).toHaveBeenCalledTimes(1);

            gate.resolve();
            await expect(first).resolves.toBe(true);
        });

        test('lets only the latest lifecycle generation become active', async () => {
            const firstGate = createDeferred();
            const secondGate = createDeferred();
            const firstPlatform = createPlatform({
                initialize: firstGate.promise,
            });
            const secondPlatform = createPlatform({
                initialize: secondGate.promise,
            });
            contentScript.PlatformClass = jest
                .fn()
                .mockImplementationOnce(() => firstPlatform)
                .mockImplementationOnce(() => secondPlatform);

            const first = contentScript.initializePlatform();
            await Promise.resolve();
            await Promise.resolve();
            contentScript.leavePlayerPage();
            const second = contentScript.initializePlatform();
            await Promise.resolve();
            await Promise.resolve();

            secondGate.resolve();
            await expect(second).resolves.toBe(true);
            firstGate.resolve();
            await expect(first).resolves.toBe(false);

            expect(firstPlatform.cleanup).toHaveBeenCalledTimes(1);
            expect(firstPlatform.handleNativeSubtitles).not.toHaveBeenCalled();
            expect(secondPlatform.handleNativeSubtitles).toHaveBeenCalledTimes(
                1
            );
            expect(contentScript.activePlatform).toBe(secondPlatform);
            expect(contentScript.platformReady).toBe(true);
        });

        test('cleans a failed candidate and permits a fresh initialization', async () => {
            const firstPlatform = createPlatform({
                initialize: Promise.reject(new Error('failed')),
            });
            const secondPlatform = createPlatform();
            contentScript.PlatformClass = jest
                .fn()
                .mockImplementationOnce(() => firstPlatform)
                .mockImplementationOnce(() => secondPlatform);

            await expect(contentScript.initializePlatform()).resolves.toBe(
                false
            );
            expect(firstPlatform.cleanup).toHaveBeenCalledTimes(1);

            await expect(contentScript.initializePlatform()).resolves.toBe(
                true
            );
            expect(contentScript.PlatformClass).toHaveBeenCalledTimes(2);
            expect(secondPlatform.handleNativeSubtitles).toHaveBeenCalledTimes(
                1
            );
        });

        test('terminal cleanup cancels a pending retry', async () => {
            jest.useFakeTimers();
            contentScript.PlatformClass = jest.fn(() => {
                throw new Error('failed');
            });
            contentScript.currentConfig.platformInitMaxRetries = 1;
            contentScript.currentConfig.platformInitRetryDelay = 1000;

            const initialization = contentScript.initializePlatform();
            for (let index = 0; index < 10; index += 1) {
                await Promise.resolve();
            }
            expect(jest.getTimerCount()).toBe(1);

            await contentScript.cleanup();
            await expect(initialization).resolves.toBe(false);
            expect(jest.getTimerCount()).toBe(0);
            await jest.advanceTimersByTimeAsync(1000);
            expect(contentScript.PlatformClass).toHaveBeenCalledTimes(1);
            await expect(contentScript.initializePlatform()).resolves.toBe(
                false
            );
        });
    });

    describe('navigation lifecycle', () => {
        test('preserves an already adopted player identity and rearms detection', () => {
            jest.useFakeTimers();
            history.replaceState({}, '', '/watch/111');
            const platform = {
                currentVideoId: '111',
                hasAdoptedPlayerRoute: jest.fn(function (url) {
                    return (
                        new URL(url).pathname ===
                        `/watch/${this.currentVideoId}`
                    );
                }),
                onUrlChange: jest.fn(),
                resetVttRequestState: jest.fn(),
                setVideoIdAndNotify: jest.fn(function (videoId) {
                    this.currentVideoId = videoId;
                }),
            };
            const clearBuffer = jest.spyOn(contentScript.eventBuffer, 'clear');
            contentScript.activePlatform = platform;
            contentScript.subtitleUtils = createSubtitleUtils();
            contentScript.startVideoElementDetection = jest.fn();
            contentScript.setupNavigationDetection();

            history.pushState({}, '', '/watch/222');
            platform.setVideoIdAndNotify('222');
            jest.advanceTimersByTime(100);

            expect(platform.hasAdoptedPlayerRoute).toHaveBeenCalledWith(
                `${window.location.origin}/watch/222`
            );
            expect(platform.setVideoIdAndNotify).toHaveBeenCalledTimes(1);
            expect(platform.resetVttRequestState).not.toHaveBeenCalled();
            expect(clearBuffer).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils.clearSubtitlesDisplayAndQueue
            ).not.toHaveBeenCalled();
            expect(
                contentScript.startVideoElementDetection
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    platform,
                    pathname: '/watch/222',
                    replacementRequired: true,
                })
            );
            expect(platform.onUrlChange).toHaveBeenCalledWith(
                `${window.location.origin}/watch/222`
            );
        });

        test('terminal cleanup cancels a pending navigation notification', async () => {
            jest.useFakeTimers();
            history.replaceState({}, '', '/watch/old');
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            const onUrlChange = jest.fn();
            contentScript.activePlatform = { onUrlChange };
            contentScript.setupNavigationDetection();

            history.pushState({}, '', '/watch/pending');
            await contentScript.cleanup();
            await jest.advanceTimersByTimeAsync(100);

            expect(onUrlChange).not.toHaveBeenCalled();
            expect(history.pushState).toBe(originalPushState);
            expect(history.replaceState).toBe(originalReplaceState);
        });

        test('terminal cleanup disconnects a pending player-root observation', async () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const originalVideo = document.createElement('video');
            root.appendChild(originalVideo);
            document.body.appendChild(root);
            let currentVideo = originalVideo;
            const platform = {
                cleanup: jest.fn().mockResolvedValue(),
                getPlayerContainerElement: jest.fn(() => root),
                getVideoElement: jest.fn(() => currentVideo),
            };
            const subtitleUtils = createSubtitleUtils();
            history.replaceState({}, '', '/watch/root');
            contentScript.activePlatform = platform;
            contentScript.platformReady = true;
            contentScript.subtitleUtils = subtitleUtils;
            contentScript.currentConfig = {};

            try {
                expect(contentScript.setupDOMObservation()).toBe(true);
                const observer = observerHarness.instances[0];
                const replacementVideo = document.createElement('video');
                currentVideo = replacementVideo;
                originalVideo.replaceWith(replacementVideo);
                observer.callback([{ type: 'childList', target: root }]);
                expect(jest.getTimerCount()).toBe(1);

                await contentScript.cleanup();

                expect(observer.disconnect).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);
                subtitleUtils.ensureSubtitleContainer.mockClear();
                observer.callback([{ type: 'childList', target: root }]);
                await jest.advanceTimersByTimeAsync(100);
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
            } finally {
                observerHarness.restore();
            }
        });
    });

    describe('AI context lifecycle', () => {
        test('enables the manager, interactive subtitles, and document listeners', async () => {
            const ai = configureAI();
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );
            const log = jest.spyOn(contentScript, 'logWithFallback');

            await expect(
                contentScript.initializeAIContextFeatures()
            ).resolves.toBe(true);

            const [manager] = ai.initialize.mock.instances;
            expect(ai.initialize).toHaveBeenCalledTimes(1);
            expect([...manager.enabledFeatures]).toEqual([
                'interactiveSubtitles',
                'contextModal',
            ]);
            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).toHaveBeenCalledTimes(1);
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(true);
            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            for (const eventName of AI_DOCUMENT_EVENTS) {
                expect(active.get(eventName).size).toBe(1);
            }

            document.dispatchEvent(new Event('dualsub-analysis-complete'));
            expect(log).toHaveBeenCalledWith(
                'debug',
                'AI Context analysis completed'
            );
        });

        test('prevents a stale initialization from committing after disable', async () => {
            const ai = configureAI();
            const gate = createDeferred();
            ai.initializations.push(gate.promise);
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );

            const staleInitialization =
                contentScript.initializeAIContextFeatures();
            while (ai.initialize.mock.calls.length === 0) {
                await Promise.resolve();
            }
            ai.readConfiguration.mockResolvedValue(disabledAIConfig());
            const disable = contentScript.initializeAIContextFeatures();

            gate.resolve(true);
            await expect(staleInitialization).resolves.toBe(false);
            await expect(disable).resolves.toBe(true);

            const [staleManager] = ai.initialize.mock.instances;
            expect(
                ai.destroy.mock.instances.filter(
                    (manager) => manager === staleManager
                )
            ).toHaveLength(1);
            expect([...staleManager.enabledFeatures]).toEqual([]);
            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(false);
            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            for (const eventName of AI_DOCUMENT_EVENTS) {
                expect(active.get(eventName).size).toBe(0);
            }
        });

        test('disable removes listeners and interactive word styling', async () => {
            const ai = configureAI();
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );
            await contentScript.initializeAIContextFeatures();
            document.body.innerHTML = `
                <span class="dualsub-interactive-word dualsub-word-selected dualsub-interactive-word--hover" role="button" tabindex="0">hello</span>
            `;

            ai.readConfiguration.mockResolvedValue(disabledAIConfig());
            await expect(
                contentScript.initializeAIContextFeatures()
            ).resolves.toBe(true);

            const [manager] = ai.initialize.mock.instances;
            const word = document.querySelector('span');
            expect(
                ai.destroy.mock.instances.filter(
                    (destroyedManager) => destroyedManager === manager
                )
            ).toHaveLength(1);
            expect(word).not.toHaveClass('dualsub-interactive-word');
            expect(word).not.toHaveClass('dualsub-word-selected');
            expect(word).not.toHaveAttribute('role');
            expect(word).not.toHaveAttribute('tabindex');
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(false);
            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            for (const eventName of AI_DOCUMENT_EVENTS) {
                expect(active.get(eventName).size).toBe(0);
            }
        });

        test.each([
            [
                'has no config service',
                () => {
                    contentScript.configService = null;
                },
                false,
                false,
            ],
            [
                'cannot verify its strict configuration',
                () => {
                    contentScript.configService = {
                        readMultipleResultStrict: jest
                            .fn()
                            .mockRejectedValue(new Error('private failure')),
                    };
                    contentScript.subtitleUtils = createSubtitleUtils();
                },
                true,
                true,
            ],
        ])(
            'fails closed when AI context %s',
            async (
                _description,
                arrange,
                expectedResult,
                disabledSubtitles
            ) => {
                installAIManagerModule();
                arrange();

                await expect(
                    contentScript.initializeAIContextFeatures()
                ).resolves.toBe(expectedResult);

                if (disabledSubtitles) {
                    expect(
                        contentScript.subtitleUtils
                            .setInteractiveSubtitlesEnabled
                    ).toHaveBeenCalledWith(false);
                }
            }
        );
    });
});
