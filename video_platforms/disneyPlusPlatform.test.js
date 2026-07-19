import { describe, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DisneyPlusPlatform } from './disneyPlusPlatform.js';
import { BasePlatformAdapter } from './BasePlatformAdapter.js';
import { ChromeApiMock } from '../test-utils/chrome-api-mock.js';
import { createLoggerMock } from '../test-utils/logger-mock.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import flushPromises from '../test-utils/flush-promises.js';
import { SubtitleRequestSources } from '../content_scripts/shared/constants/messageActions.js';
import { createInjectionChannel } from '../content_scripts/shared/injectionChannel.js';

function readChannelCapability(channel) {
    const url = channel.createScriptUrl(
        'chrome-extension://test-extension/injected_scripts/disneyPlusInject.js'
    );
    const match = new URL(url).hash.match(
        /^#dualsub-channel=disneyplus\.([0-9a-f]{64})$/u
    );
    return match?.[1] || null;
}

function createAuthorizedInjectorEvent(channel, fields) {
    return {
        detail: {
            ...fields,
            dualsubChannel: {
                platform: 'disneyplus',
                capability: readChannelCapability(channel),
            },
        },
    };
}

function authorizeFunctionalInjectorEvent(channel, event) {
    try {
        const eventDescriptor = Object.getOwnPropertyDescriptor(
            event,
            'detail'
        );
        if (!eventDescriptor || !Object.hasOwn(eventDescriptor, 'value')) {
            return event;
        }
        const detail = eventDescriptor.value;
        if (
            detail === null ||
            typeof detail !== 'object' ||
            Object.hasOwn(detail, 'dualsubChannel')
        ) {
            return event;
        }
        const authorizedDetail = Object.create(
            Object.getPrototypeOf(detail),
            Object.getOwnPropertyDescriptors(detail)
        );
        Object.defineProperty(authorizedDetail, 'dualsubChannel', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: {
                platform: 'disneyplus',
                capability: readChannelCapability(channel),
            },
        });
        return { detail: authorizedDetail };
    } catch (_) {
        return event;
    }
}

function createDeferred() {
    let resolve;
    const promise = new Promise((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

function containsObjectIdentity(value, target, seen = new Set()) {
    if (value === target) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) return false;

    seen.add(value);
    return Reflect.ownKeys(value).some((key) =>
        containsObjectIdentity(value[key], target, seen)
    );
}

function expectSensitiveValueAbsentFromLogs(calls, sensitiveValue) {
    expect(containsObjectIdentity(calls, sensitiveValue)).toBe(false);

    const serializedCalls = JSON.stringify(calls);
    for (const canary of [
        sensitiveValue.message,
        sensitiveValue.stack,
        sensitiveValue.cause,
        sensitiveValue.customSecret,
    ]) {
        expect(serializedCalls).not.toContain(String(canary));
    }
}

function createSuccessfulDisneyResponse(overrides = {}) {
    return {
        success: true,
        vttText: 'WEBVTT',
        targetVttText: null,
        videoId: '12345',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeTarget: false,
        selectedLanguage: {
            normalizedCode: 'en',
            displayName: 'English',
        },
        ...overrides,
    };
}

function createVideo({
    currentTime = 0,
    readyState = 0,
    paused = true,
    ended = false,
    currentSrc = '',
    width = 0,
    height = 0,
} = {}) {
    const video = document.createElement('video');
    const state = { currentTime, readyState, paused, ended, currentSrc };

    Object.defineProperties(video, {
        currentTime: {
            configurable: true,
            get: () => state.currentTime,
        },
        readyState: {
            configurable: true,
            get: () => state.readyState,
        },
        paused: {
            configurable: true,
            get: () => state.paused,
        },
        ended: {
            configurable: true,
            get: () => state.ended,
        },
        currentSrc: {
            configurable: true,
            get: () => state.currentSrc,
        },
    });
    video.getBoundingClientRect = jest.fn(() => ({
        width,
        height,
        top: 0,
        right: width,
        bottom: height,
        left: 0,
    }));

    return { video, state };
}

function createDisneyTimeline(value, max = 1500) {
    const overlay = document.createElement('main-app-controls-overlay');
    const overlayRoot = overlay.attachShadow({ mode: 'open' });
    const progressBar = document.createElement('progress-bar');
    const progressRoot = progressBar.attachShadow({ mode: 'open' });
    const timeline = document.createElement('div');

    timeline.className = 'progress-bar__seekable-range';
    timeline.setAttribute('role', 'slider');
    timeline.setAttribute('aria-label', 'Timeline');
    timeline.setAttribute('aria-valuenow', String(value));
    timeline.setAttribute('aria-valuemax', String(max));
    progressRoot.appendChild(timeline);
    overlayRoot.appendChild(progressBar);
    document.body.appendChild(overlay);

    return { overlay, timeline };
}

function createDisneyPlaybackToggle(label = 'Play') {
    const playerUi = document.createElement('disney-web-player-ui');
    const toggle = document.createElement('toggle-play-pause');
    const root = toggle.attachShadow({ mode: 'open' });
    const button = document.createElement('button');

    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', label);
    root.appendChild(button);
    playerUi.appendChild(toggle);
    document.body.appendChild(playerUi);

    return button;
}

function createDisneyPlaybackController(
    activeVideo,
    { nestedInPlayerShadowRoot = true, transitionDelay = 0 } = {}
) {
    const playerUi = document.createElement('disney-web-player-ui');
    const playerRoot = nestedInPlayerShadowRoot
        ? playerUi.attachShadow({ mode: 'open' })
        : playerUi;
    const toggle = document.createElement('toggle-play-pause');
    const toggleRoot = toggle.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    const controllerState = {
        playing: !activeVideo.state.paused && !activeVideo.state.ended,
    };
    const projectControllerState = () => {
        button.dataset.playbackState = controllerState.playing
            ? 'playing'
            : 'paused';
    };

    button.setAttribute('role', 'button');
    projectControllerState();
    button.addEventListener('click', () => {
        const commitTransition = () => {
            controllerState.playing = !controllerState.playing;
            activeVideo.state.paused = !controllerState.playing;
            if (controllerState.playing) {
                activeVideo.state.ended = false;
            }
            projectControllerState();
        };
        if (transitionDelay > 0) {
            setTimeout(commitTransition, transitionDelay);
        } else {
            commitTransition();
        }
    });
    toggleRoot.appendChild(button);
    playerRoot.appendChild(toggle);
    document.body.appendChild(playerUi);

    return { button, controllerState, playerUi, toggle };
}

function createDisneySubtitleMutation() {
    const subtitleNode = document.createElement('div');
    subtitleNode.className = 'TimedTextOverlay';
    return [
        {
            type: 'childList',
            addedNodes: [subtitleNode],
        },
    ];
}

function mountDisneySubtitleRoots() {
    const playerRoot = document.createElement('div');
    playerRoot.className = 'disney-player-root';
    playerRoot.appendChild(document.createElement('video'));
    document.body.appendChild(playerRoot);

    const overlay = document.createElement('main-app-controls-overlay');
    const overlayRoot = overlay.attachShadow({ mode: 'open' });
    document.body.appendChild(overlay);

    return { playerRoot, overlay, overlayRoot };
}

describe('DisneyPlusPlatform Logging Integration', () => {
    let platform;
    let mockLogger;
    let chromeApiMock;
    let locationCleanup;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        document.body.replaceChildren();

        // Setup configService mock
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        });
        jest.spyOn(configService, 'get').mockResolvedValue(true);

        // Setup Chrome API mock
        chromeApiMock = ChromeApiMock.create();
        global.chrome = chromeApiMock;

        // Create logger mock using centralized utility
        mockLogger = createLoggerMock();
        jest.spyOn(Logger, 'create').mockReturnValue(mockLogger);

        // Create platform instance
        platform = new DisneyPlusPlatform();
        platform._injectionChannel = createInjectionChannel('disneyplus');
        const handleInjectorEvents =
            DisneyPlusPlatform.prototype._handleInjectorEvents.bind(platform);
        jest.spyOn(platform, '_handleInjectorEvents').mockImplementation(
            (event, channel = platform._injectionChannel) =>
                handleInjectorEvents(
                    authorizeFunctionalInjectorEvent(channel, event),
                    channel
                )
        );

        // Mock platform detection methods to simulate Disney Plus environment
        jest.spyOn(platform, 'isPlatformActive').mockReturnValue(true);
        jest.spyOn(platform, 'isPlayerPageActive').mockReturnValue(true);
        jest.spyOn(platform, 'extractVideoIdFromCurrentRoute').mockReturnValue(
            '12345'
        );

        locationCleanup = () => {
            // No cleanup needed for method mocks
        };
    });

    afterEach(() => {
        // Cleanup platform
        if (platform) {
            platform.cleanup();
        }

        // Restore location mock
        if (locationCleanup) {
            locationCleanup();
        }

        // Reset Chrome API mock
        if (chromeApiMock) {
            chromeApiMock.reset();
        }

        // Reset logger mock
        if (mockLogger) {
            mockLogger.reset();
        }

        // Clear all Jest mocks
        jest.clearAllMocks();
        document.body.replaceChildren();
    });

    describe('Logger Initialization', () => {
        test('should create logger instance with correct component name', () => {
            expect(platform.logger).toBe(mockLogger);
        });

        test('does not expose logger initialization failures to telemetry', async () => {
            const loggerError = Object.assign(
                new Error('LOGGER_INIT_MESSAGE_CANARY'),
                {
                    cause: 'LOGGER_INIT_CAUSE_CANARY',
                    customSecret: 'LOGGER_INIT_CUSTOM_CANARY',
                }
            );
            mockLogger.updateLevel.mockRejectedValueOnce(loggerError);

            await platform.initializeLogger();

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'DisneyPlusPlatform: Failed to initialize logger level'
            );
            expectSensitiveValueAbsentFromLogs(
                mockLogger.warn.mock.calls,
                loggerError
            );
        });

        test('does not expose base-adapter logger initialization failures', async () => {
            const loggerError = Object.assign(
                new Error('BASE_LOGGER_INIT_MESSAGE_CANARY'),
                {
                    cause: 'BASE_LOGGER_INIT_CAUSE_CANARY',
                    customSecret: 'BASE_LOGGER_INIT_CUSTOM_CANARY',
                }
            );
            const basePlatform = new BasePlatformAdapter('TestBasePlatform');
            basePlatform.logger = createLoggerMock();
            basePlatform.logger.updateLevel.mockRejectedValueOnce(loggerError);

            await basePlatform.initializeLogger();

            expect(basePlatform.logger.warn).toHaveBeenCalledWith(
                'Failed to initialize logger level, continuing with defaults',
                { loggerInitialized: false }
            );
            expectSensitiveValueAbsentFromLogs(
                basePlatform.logger.warn.mock.calls,
                loggerError
            );
        });
    });

    describe('Platform Detection Logging', () => {
        test('should log platform active detection', () => {
            const isActive = platform.isPlatformActive();
            expect(isActive).toBe(true);
        });

        test('should log player page detection', () => {
            const isPlayerActive = platform.isPlayerPageActive();
            expect(isPlayerActive).toBe(true);
        });

        test('proves ownership only for the canonical Disney route currently adopted by the adapter', () => {
            platform.currentVideoId = 'episode-b';

            expect(
                platform.hasAdoptedPlayerRoute(
                    'https://www.disneyplus.com/play/episode-b'
                )
            ).toBe(true);
            expect(
                platform.hasAdoptedPlayerRoute(
                    'https://www.disneyplus.com/play/episode-a'
                )
            ).toBe(false);
            expect(
                platform.hasAdoptedPlayerRoute(
                    'https://www.disneyplus.com/play/episode-b/extra'
                )
            ).toBe(false);
        });
    });

    describe('Initialization Logging', () => {
        test('should log successful initialization', async () => {
            const mockOnSubtitleFound = jest.fn();
            const mockOnVideoIdChange = jest.fn();

            await platform.initialize(mockOnSubtitleFound, mockOnVideoIdChange);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Initialized and event listener added',
                expect.objectContaining({
                    selectors: expect.any(Array),
                })
            );
        });

        test('resumes the page bridge on initialize and pauses it on cleanup', async () => {
            const controlEvents = [];
            const controlListener = (event) => {
                if (event.detail?.type?.startsWith('PLAYBACK_BRIDGE_')) {
                    controlEvents.push(event.detail);
                }
            };
            document.addEventListener(
                'disneyplus-dualsub-injector-event',
                controlListener
            );

            try {
                await platform.initialize(jest.fn(), jest.fn());
                expect(controlEvents).toEqual([
                    expect.objectContaining({
                        type: 'PLAYBACK_BRIDGE_RESUME',
                        dualsubChannel: expect.objectContaining({
                            platform: 'disneyplus',
                            capability:
                                expect.stringMatching(/^[0-9a-f]{64}$/u),
                        }),
                    }),
                ]);

                platform.cleanup();
                expect(controlEvents).toEqual([
                    expect.objectContaining({
                        type: 'PLAYBACK_BRIDGE_RESUME',
                    }),
                    expect.objectContaining({
                        type: 'PLAYBACK_BRIDGE_PAUSE',
                    }),
                ]);
            } finally {
                document.removeEventListener(
                    'disneyplus-dualsub-injector-event',
                    controlListener
                );
            }
        });

        test('keeps a saved lifecycle listener inert after cleanup', async () => {
            const controlEvents = [];
            const controlListener = (event) => {
                if (event.detail?.type?.startsWith('PLAYBACK_BRIDGE_')) {
                    controlEvents.push(event.detail.type);
                }
            };
            document.addEventListener(
                'disneyplus-dualsub-injector-event',
                controlListener
            );

            try {
                await platform.initialize(jest.fn(), jest.fn());
                const staleListener = platform.eventListener;
                const staleReadyEvent = createAuthorizedInjectorEvent(
                    platform._injectionChannel,
                    { type: 'INJECT_SCRIPT_READY' }
                );
                platform.cleanup();
                const controlsAfterCleanup = [...controlEvents];

                staleListener(staleReadyEvent);

                expect(controlEvents).toEqual(controlsAfterCleanup);
            } finally {
                document.removeEventListener(
                    'disneyplus-dualsub-injector-event',
                    controlListener
                );
            }
        });

        test('retires deferred lifecycle A before lifecycle B can dispatch or receive it', async () => {
            const deferredSettings = createDeferred();
            configService.getMultiple
                .mockImplementationOnce(() => deferredSettings.promise)
                .mockResolvedValue({
                    targetLanguage: 'zh-CN',
                    originalLanguage: 'en',
                });
            const callbackA = jest.fn();
            const callbackB = jest.fn();
            const requestVtt = jest.spyOn(platform, 'requestVttViaMessaging');

            await platform.initialize(callbackA, jest.fn());
            const lifecycleARequest = platform.handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'https://example.com/lifecycle-a.m3u8',
                },
            });
            await Promise.resolve();

            await platform.initialize(callbackB, jest.fn());
            deferredSettings.resolve({
                targetLanguage: 'zh-CN',
                originalLanguage: 'en',
            });
            await lifecycleARequest;

            expect(requestVtt).not.toHaveBeenCalled();
            expect(callbackA).not.toHaveBeenCalled();
            expect(callbackB).not.toHaveBeenCalled();
            expect(platform.pendingVttUrlForVideoId['12345']).toBeUndefined();
        });
    });

    describe('Injection channel authority', () => {
        test('gates the raw entrypoint before parsing and strips valid authority', () => {
            platform._injectionChannel?.revoke();
            const channel = createInjectionChannel('disneyplus');
            platform._injectionChannel = channel;
            const capability = readChannelCapability(channel);
            const authorizedHandler = jest.spyOn(
                platform,
                '_handleAuthorizedInjectorData'
            );
            const capabilityGetter = jest.fn(() => capability);
            const channelGetter = jest.fn(() => ({
                platform: 'disneyplus',
                capability,
            }));
            const proxyGetter = jest.fn(() => capability);
            const accessorChannel = { platform: 'disneyplus' };
            Object.defineProperty(accessorChannel, 'capability', {
                enumerable: true,
                get: capabilityGetter,
            });
            const accessorDetail = { type: 'INJECT_SCRIPT_READY' };
            Object.defineProperty(accessorDetail, 'dualsubChannel', {
                enumerable: true,
                get: channelGetter,
            });
            const inheritedChannel = Object.create({
                platform: 'disneyplus',
                capability,
            });
            const hostileChannel = new Proxy(
                { platform: 'disneyplus', capability },
                {
                    getPrototypeOf() {
                        throw new Error('hostile channel');
                    },
                    get(_target, property) {
                        proxyGetter(property);
                        return capability;
                    },
                }
            );
            const eventDetailGetter = jest.fn(() => ({
                type: 'INJECT_SCRIPT_READY',
            }));
            const accessorEvent = {};
            Object.defineProperty(accessorEvent, 'detail', {
                get: eventDetailGetter,
            });
            const invalidEvents = [
                { detail: { type: 'INJECT_SCRIPT_READY' } },
                {
                    detail: {
                        type: 'INJECT_SCRIPT_READY',
                        dualsubChannel: {
                            platform: 'disneyplus',
                            capability: 'b'.repeat(64),
                        },
                    },
                },
                {
                    detail: {
                        type: 'INJECT_SCRIPT_READY',
                        dualsubChannel: {
                            platform: 'netflix',
                            capability,
                        },
                    },
                },
                {
                    detail: {
                        type: 'INJECT_SCRIPT_READY',
                        dualsubChannel: {
                            platform: 'disneyplus',
                            capability,
                            extra: true,
                        },
                    },
                },
                {
                    detail: {
                        type: 'INJECT_SCRIPT_READY',
                        dualsubChannel: accessorChannel,
                    },
                },
                { detail: accessorDetail },
                {
                    detail: {
                        type: 'INJECT_SCRIPT_READY',
                        dualsubChannel: inheritedChannel,
                    },
                },
                {
                    detail: {
                        type: 'INJECT_SCRIPT_READY',
                        dualsubChannel: hostileChannel,
                    },
                },
                accessorEvent,
            ];

            for (const event of invalidEvents) {
                DisneyPlusPlatform.prototype._handleInjectorEvents.call(
                    platform,
                    event,
                    channel
                );
            }

            expect(authorizedHandler).not.toHaveBeenCalled();
            expect(capabilityGetter).not.toHaveBeenCalled();
            expect(channelGetter).not.toHaveBeenCalled();
            expect(proxyGetter).not.toHaveBeenCalled();
            expect(eventDetailGetter).not.toHaveBeenCalled();

            DisneyPlusPlatform.prototype._handleInjectorEvents.call(
                platform,
                createAuthorizedInjectorEvent(channel, {
                    type: 'INJECT_SCRIPT_READY',
                }),
                channel
            );

            expect(authorizedHandler).toHaveBeenCalledTimes(1);
            const acceptedDetail = authorizedHandler.mock.calls[0][0];
            expect(Object.isFrozen(acceptedDetail)).toBe(true);
            expect(Object.hasOwn(acceptedDetail, 'dualsubChannel')).toBe(false);
            expect(acceptedDetail.type).toBe('INJECT_SCRIPT_READY');
        });

        test('keeps the capability out of runtime messages and logs', async () => {
            platform._injectionChannel?.revoke();
            const channel = createInjectionChannel('disneyplus');
            platform._injectionChannel = channel;
            const capability = readChannelCapability(channel);
            const sendMessage = jest
                .spyOn(platform, '_sendMessageResilient')
                .mockResolvedValue(createSuccessfulDisneyResponse());
            platform.setCallbacks(jest.fn(), jest.fn());

            await DisneyPlusPlatform.prototype.handleInjectorEvents.call(
                platform,
                createAuthorizedInjectorEvent(channel, {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'https://example.com/master.m3u8',
                })
            );

            expect(sendMessage).toHaveBeenCalledTimes(1);
            expect(sendMessage.mock.calls[0][0]).not.toHaveProperty(
                'dualsubChannel'
            );
            const serializedBoundaryData = JSON.stringify({
                runtime: sendMessage.mock.calls,
                debug: mockLogger.debug.mock.calls,
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedBoundaryData).not.toContain(capability);
        });
    });

    describe('Subtitle URL Processing Logging', () => {
        test('should log inject script ready event', () => {
            const resumePlaybackTimeline = jest.spyOn(
                platform,
                '_resumePlaybackTimeline'
            );
            const requestPlaybackTimeline = jest.spyOn(
                platform,
                '_requestPlaybackTimeline'
            );
            const mockEvent = {
                detail: {
                    type: 'INJECT_SCRIPT_READY',
                },
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Inject script is ready'
            );
            expect(resumePlaybackTimeline).toHaveBeenCalledTimes(1);
            expect(requestPlaybackTimeline).toHaveBeenCalledTimes(1);
        });

        test('should log subtitle URL found', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'SUBTITLE_URL_FOUND for current route',
                expect.objectContaining({
                    videoIdLength: '12345'.length,
                    urlLength: mockEvent.detail.url.length,
                })
            );
        });

        test('should log error for missing videoId', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'SUBTITLE_URL_FOUND event without a valid videoId',
                null,
                expect.objectContaining({
                    urlLength: mockEvent.detail.url.length,
                })
            );
        });
    });

    describe('Canonical subtitle request identity', () => {
        test('sends only the normalized route identity and canonical source', async () => {
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(
                'opaque id'
            );
            const sendMessage = jest
                .spyOn(platform, '_sendMessageResilient')
                .mockResolvedValue({
                    success: true,
                    videoId: 'opaque id',
                    vttText: 'WEBVTT',
                });

            await platform.handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'opaque%20id',
                    url: 'https://example.com/master.m3u8',
                    source: 'page-forged-source',
                },
            });

            expect(platform.currentVideoId).toBe('opaque id');
            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'fetchVTT',
                    videoId: 'opaque id',
                    source: SubtitleRequestSources.DISNEY_PLUS,
                }),
                expect.any(Object)
            );
        });

        test('rejects a forged route mismatch before state mutation or messaging', () => {
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(
                'route-video'
            );
            const requestVtt = jest.spyOn(platform, 'requestVttViaMessaging');
            const rawVideoId = 'forged-page-video';
            const rawUrl =
                'https://attacker.invalid/raw-subtitle-url-secret.m3u8';

            platform.handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: rawVideoId,
                    url: rawUrl,
                },
            });

            expect(platform.currentVideoId).toBeNull();
            expect(requestVtt).not.toHaveBeenCalled();
            expect(configService.getMultiple).not.toHaveBeenCalled();
            const serializedLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedLogs).not.toContain(rawVideoId);
            expect(serializedLogs).not.toContain(rawUrl);
        });

        test('does not invoke accessor-backed primitive event fields', () => {
            const videoIdGetter = jest.fn(() => '12345');
            const detail = {
                type: 'SUBTITLE_URL_FOUND',
                url: 'https://example.com/master.m3u8',
            };
            Object.defineProperty(detail, 'videoId', {
                get: videoIdGetter,
            });
            const requestVtt = jest.spyOn(platform, 'requestVttViaMessaging');

            platform.handleInjectorEvents({ detail });

            expect(videoIdGetter).not.toHaveBeenCalled();
            expect(requestVtt).not.toHaveBeenCalled();
            expect(platform.currentVideoId).toBeNull();
        });
    });

    describe('Video Context Change Logging', () => {
        test('should log video context change', async () => {
            platform.currentVideoId = '11111';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: true,
                        videoId: '12345',
                    });
                }
            );

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Video context changing',
                expect.objectContaining({
                    hadPreviousVideoId: true,
                    hasNewVideoId: true,
                })
            );
        });

        test('should log already processed URL', () => {
            platform.currentVideoId = '12345';
            platform.lastKnownVttUrlForVideoId['12345'] =
                'http://example.com/master.m3u8';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'VTT URL already processed or known',
                expect.objectContaining({
                    urlLength: mockEvent.detail.url.length,
                    hasVideoId: true,
                })
            );
        });

        test('coalesces duplicate subtitle URL events while a fetch is in flight', async () => {
            const onSubtitleFound = jest.fn();
            const onVideoIdChange = jest.fn();
            await platform.initialize(onSubtitleFound, onVideoIdChange);

            let resolveRequest;
            jest.spyOn(platform, 'requestVttViaMessaging').mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveRequest = resolve;
                    })
            );

            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'next-video-id',
                    url: 'https://example.com/subtitles/master.m3u8',
                },
            };
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(
                'next-video-id'
            );

            platform._handleInjectorEvents(event);
            platform._handleInjectorEvents(event);
            await flushPromises();

            expect(platform.requestVttViaMessaging).toHaveBeenCalledTimes(1);

            resolveRequest(
                createSuccessfulDisneyResponse({
                    videoId: 'next-video-id',
                    vttText: 'WEBVTT',
                })
            );
            await flushPromises();

            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
        });

        test('projects a current Disney response into the exact privacy-safe callback payload', async () => {
            const signedUrlCanary =
                'https://captions.media.dssott.com/private/en.vtt?token=DISNEY_CALLBACK_SECRET';
            const sourceLanguageCanary =
                'https://language.example/source?token=DISNEY_SOURCE_LANGUAGE_SECRET';
            const targetLanguageCanary =
                'https://language.example/target?token=DISNEY_TARGET_LANGUAGE_SECRET';
            const selectedCodeCanary =
                'https://language.example/selected?token=DISNEY_SELECTED_CODE_SECRET';
            const selectedNameCanary =
                'https://language.example/display?token=DISNEY_SELECTED_NAME_SECRET';
            const response = {
                success: true,
                vttText: 'WEBVTT original',
                targetVttText: 'WEBVTT target',
                videoId: 'privacy-video',
                sourceLanguage: sourceLanguageCanary,
                targetLanguage: targetLanguageCanary,
                useNativeTarget: true,
                selectedLanguage: {
                    normalizedCode: selectedCodeCanary,
                    displayName: selectedNameCanary,
                    uri: signedUrlCanary,
                    futureLanguageSecret: signedUrlCanary,
                },
                url: signedUrlCanary,
                availableLanguages: [
                    {
                        normalizedCode: 'en',
                        displayName: 'English',
                        uri: signedUrlCanary,
                        downloadUrl: signedUrlCanary,
                    },
                ],
                targetLanguageInfo: { uri: signedUrlCanary },
                processingTime: 32,
                futureResponseSecret: signedUrlCanary,
            };
            const onSubtitleFound = jest.fn();
            await platform.initialize(onSubtitleFound, jest.fn());
            jest.spyOn(platform, 'requestVttViaMessaging').mockResolvedValue(
                response
            );
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(
                'privacy-video'
            );

            await platform.handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'privacy-video',
                    url: 'https://example.com/privacy-video.m3u8',
                },
            });

            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith({
                vttText: 'WEBVTT original',
                targetVttText: 'WEBVTT target',
                videoId: 'privacy-video',
                sourceLanguage: sourceLanguageCanary,
                targetLanguage: targetLanguageCanary,
                useNativeTarget: true,
                selectedLanguage: {
                    normalizedCode: selectedCodeCanary,
                    displayName: selectedNameCanary,
                },
            });
            expect(Object.keys(onSubtitleFound.mock.calls[0][0])).toEqual([
                'vttText',
                'targetVttText',
                'videoId',
                'sourceLanguage',
                'targetLanguage',
                'useNativeTarget',
                'selectedLanguage',
            ]);
            expect(onSubtitleFound.mock.calls[0][0].selectedLanguage).not.toBe(
                response.selectedLanguage
            );
            expect(JSON.stringify(onSubtitleFound.mock.calls)).not.toContain(
                'DISNEY_CALLBACK_SECRET'
            );
            const serializedLogs = JSON.stringify({
                debug: mockLogger.debug.mock.calls,
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            for (const canary of [
                signedUrlCanary,
                sourceLanguageCanary,
                targetLanguageCanary,
                selectedCodeCanary,
                selectedNameCanary,
            ]) {
                expect(serializedLogs).not.toContain(canary);
            }
        });

        test('retries the same Disney subtitle after a delivery callback throws', async () => {
            const videoId = 'callback-retry-video';
            const url = 'https://example.com/callback-retry-video.m3u8';
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                },
            };
            const deliveredPayloads = [];
            const onSubtitleFound = jest
                .fn()
                .mockImplementationOnce((subtitleData) => {
                    deliveredPayloads.push(subtitleData);
                    throw new Error('CALLBACK_FAILURE_CANARY');
                })
                .mockImplementationOnce((subtitleData) => {
                    deliveredPayloads.push(subtitleData);
                });
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(createSuccessfulDisneyResponse({ videoId }));

            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(deliveredPayloads).toHaveLength(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
            expect(
                JSON.stringify({
                    info: mockLogger.info.mock.calls,
                    warn: mockLogger.warn.mock.calls,
                    error: mockLogger.error.mock.calls,
                })
            ).not.toContain('CALLBACK_FAILURE_CANARY');
            expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(
                url
            );

            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(2);
            expect(onSubtitleFound).toHaveBeenCalledTimes(2);
            expect(deliveredPayloads).toHaveLength(2);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
        });

        test('retries Disney delivery when the live route changes inside the callback', async () => {
            const videoId = 'route-retry-video';
            const url = 'https://example.com/route-retry-video.m3u8';
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                },
            };
            let liveRouteVideoId = videoId;
            platform.extractVideoIdFromCurrentRoute.mockImplementation(
                () => liveRouteVideoId
            );
            const onSubtitleFound = jest.fn().mockImplementationOnce(() => {
                liveRouteVideoId = 'other-live-route';
            });
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(createSuccessfulDisneyResponse({ videoId }));

            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.currentVideoId).toBe(videoId);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();

            liveRouteVideoId = videoId;
            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(2);
            expect(onSubtitleFound).toHaveBeenCalledTimes(2);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
        });

        test('coalesces a synchronous Disney replay during subtitle delivery', async () => {
            const videoId = 'reentrant-video';
            const url = 'https://example.com/reentrant-video.m3u8';
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                },
            };
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(videoId);
            const onSubtitleFound = jest.fn(() => {
                platform.handleInjectorEvents(event);
            });
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(createSuccessfulDisneyResponse({ videoId }));

            await platform.handleInjectorEvents(event);
            await flushPromises();

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
        });

        test('retries Disney delivery after a missing callback is installed', async () => {
            const videoId = 'late-callback-video';
            const url = 'https://example.com/late-callback-video.m3u8';
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                },
            };
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(createSuccessfulDisneyResponse({ videoId }));

            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();

            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(2);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
        });

        test('commits Disney delivery when success telemetry throws', async () => {
            const videoId = 'logger-throw-video';
            const url = 'https://example.com/logger-throw-video.m3u8';
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                },
            };
            mockLogger.info.mockImplementation((message) => {
                if (message === 'VTT fetched successfully') {
                    throw new Error('SUCCESS_LOGGER_CANARY');
                }
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(createSuccessfulDisneyResponse({ videoId }));

            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        test('delivers Disney subtitles when request telemetry throws after ownership is claimed', async () => {
            const videoId = 'request-logger-video';
            const url = 'https://example.com/request-logger-video.m3u8';
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                },
            };
            mockLogger.info.mockImplementation((message) => {
                if (message === 'Requesting VTT from background') {
                    throw new Error('REQUEST_LOGGER_CANARY');
                }
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(createSuccessfulDisneyResponse({ videoId }));

            await expect(
                Promise.resolve().then(() =>
                    platform.handleInjectorEvents(event)
                )
            ).resolves.toBeUndefined();

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        test('delivers Disney subtitles when page-event telemetry throws before ownership is claimed', async () => {
            const videoId = 'page-event-logger-video';
            const url = 'https://example.com/page-event-logger-video.m3u8';
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                },
            };
            mockLogger.info.mockImplementation((message) => {
                if (message === 'SUBTITLE_URL_FOUND for current route') {
                    throw new Error('PAGE_EVENT_LOGGER_CANARY');
                }
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(createSuccessfulDisneyResponse({ videoId }));

            await expect(
                Promise.resolve().then(() =>
                    platform.handleInjectorEvents(event)
                )
            ).resolves.toBeUndefined();

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        test('retries Disney delivery after settings resolution throws synchronously', async () => {
            const videoId = 'sync-settings-video';
            const url = 'https://example.com/sync-settings-video.m3u8';
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                },
            };
            const settingsError = new Error('SYNC_SETTINGS_FAILURE');
            configService.getMultiple
                .mockImplementationOnce(() => {
                    throw settingsError;
                })
                .mockResolvedValueOnce({
                    targetLanguage: 'zh-CN',
                    originalLanguage: 'en',
                });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(createSuccessfulDisneyResponse({ videoId }));

            await expect(
                Promise.resolve().then(() =>
                    platform.handleInjectorEvents(event)
                )
            ).resolves.toBeUndefined();

            expect(requestVtt).not.toHaveBeenCalled();
            expect(onSubtitleFound).not.toHaveBeenCalled();
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();

            await platform.handleInjectorEvents(event);

            expect(configService.getMultiple).toHaveBeenCalledTimes(2);
            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
        });

        test('keeps pending subtitle requests scoped to the video that emitted them', async () => {
            await platform.initialize(jest.fn(), jest.fn());
            jest.spyOn(platform, 'requestVttViaMessaging').mockImplementation(
                () => new Promise(() => {})
            );
            let routeVideoId = 'video-a';
            platform.extractVideoIdFromCurrentRoute.mockImplementation(
                () => routeVideoId
            );

            platform._handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-a',
                    url: 'https://example.com/video-a.m3u8',
                },
            });
            await flushPromises();
            routeVideoId = 'video-b';
            platform._handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-b',
                    url: 'https://example.com/video-b.m3u8',
                },
            });
            await flushPromises();

            expect(platform.requestVttViaMessaging).toHaveBeenNthCalledWith(
                1,
                'https://example.com/video-a.m3u8',
                'zh-CN',
                'en',
                'video-a',
                expect.any(Function)
            );
            expect(platform.requestVttViaMessaging).toHaveBeenNthCalledWith(
                2,
                'https://example.com/video-b.m3u8',
                'zh-CN',
                'en',
                'video-b',
                expect.any(Function)
            );
        });

        test('does not dispatch an older manifest after a newer URL supersedes it', async () => {
            const onSubtitleFound = jest.fn();
            await platform.initialize(onSubtitleFound, jest.fn());

            const requestResolvers = new Map();
            jest.spyOn(platform, 'requestVttViaMessaging').mockImplementation(
                (url) =>
                    new Promise((resolve) => {
                        requestResolvers.set(url, resolve);
                    })
            );

            const firstUrl = 'https://example.com/manifest-old.m3u8';
            const latestUrl = 'https://example.com/manifest-latest.m3u8';
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(
                'same-video'
            );
            for (const url of [firstUrl, latestUrl]) {
                platform._handleInjectorEvents({
                    detail: {
                        type: 'SUBTITLE_URL_FOUND',
                        videoId: 'same-video',
                        url,
                    },
                });
            }
            await flushPromises();

            expect(requestResolvers.has(firstUrl)).toBe(false);
            expect(requestResolvers.has(latestUrl)).toBe(true);
            requestResolvers.get(latestUrl)(
                createSuccessfulDisneyResponse({
                    videoId: 'same-video',
                    vttText: 'WEBVTT latest',
                })
            );
            await flushPromises();

            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith(
                expect.objectContaining({
                    vttText: 'WEBVTT latest',
                })
            );
        });

        test('allows the same manifest to retry after settings resolution fails', async () => {
            const settingsError = new Error('Settings read failed');
            configService.getMultiple
                .mockRejectedValueOnce(settingsError)
                .mockResolvedValueOnce({
                    targetLanguage: 'zh-CN',
                    originalLanguage: 'en',
                });

            const onSubtitleFound = jest.fn();
            await platform.initialize(onSubtitleFound, jest.fn());
            jest.spyOn(platform, 'requestVttViaMessaging').mockResolvedValue(
                createSuccessfulDisneyResponse({
                    videoId: 'retry-video',
                    vttText: 'WEBVTT retry',
                })
            );
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'retry-video',
                    url: 'https://example.com/retry-video.m3u8',
                },
            };
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(
                'retry-video'
            );

            platform._handleInjectorEvents(event);
            await flushPromises();
            expectSensitiveValueAbsentFromLogs(
                [
                    ...mockLogger.debug.mock.calls,
                    ...mockLogger.info.mock.calls,
                    ...mockLogger.warn.mock.calls,
                    ...mockLogger.error.mock.calls,
                ],
                settingsError
            );
            platform._handleInjectorEvents(event);
            await flushPromises();

            expect(configService.getMultiple).toHaveBeenCalledTimes(2);
            expect(platform.requestVttViaMessaging).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
        });

        test('drops a deferred-settings request after player-to-player navigation and permits retry', async () => {
            const deferredSettings = createDeferred();
            configService.getMultiple
                .mockImplementationOnce(() => deferredSettings.promise)
                .mockResolvedValue({
                    targetLanguage: 'zh-CN',
                    originalLanguage: 'en',
                });
            let routeVideoId = 'video-a';
            platform.extractVideoIdFromCurrentRoute.mockImplementation(
                () => routeVideoId
            );
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockResolvedValue(
                    createSuccessfulDisneyResponse({
                        videoId: 'video-a',
                        vttText: 'WEBVTT A',
                    })
                );
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-a',
                    url: 'https://example.com/video-a.m3u8',
                },
            };

            const staleAttempt = platform.handleInjectorEvents(event);
            expect(platform.pendingVttUrlForVideoId['video-a']).toBeDefined();

            routeVideoId = 'video-b';
            deferredSettings.resolve({
                targetLanguage: 'zh-CN',
                originalLanguage: 'en',
            });
            await staleAttempt;

            expect(requestVtt).not.toHaveBeenCalled();
            expect(onSubtitleFound).not.toHaveBeenCalled();
            expect(platform.pendingVttUrlForVideoId['video-a']).toBeUndefined();
            expect(
                platform.lastKnownVttUrlForVideoId['video-a']
            ).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId['video-b']).toBeUndefined();

            const serializedStaleLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedStaleLogs).not.toContain('video-a');
            expect(serializedStaleLogs).not.toContain(event.detail.url);

            routeVideoId = 'video-a';
            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
        });

        test('blocks dispatch when the route changes at the dynamic messaging boundary and permits the new route', async () => {
            let routeVideoId = 'video-a';
            platform.extractVideoIdFromCurrentRoute.mockImplementation(
                () => routeVideoId
            );
            const originalGetUrl =
                chromeApiMock.runtime.getURL.getMockImplementation();
            let flipRouteAtImport = true;
            chromeApiMock.runtime.getURL.mockImplementation((path) => {
                if (flipRouteAtImport) {
                    routeVideoId = 'video-b';
                }
                return originalGetUrl(path);
            });

            const sentMessages = [];
            chromeApiMock.runtime.sendMessage.mockImplementation((message) => {
                sentMessages.push(message);
                return Promise.resolve(
                    createSuccessfulDisneyResponse({
                        videoId: message.videoId,
                        vttText: 'WEBVTT',
                    })
                );
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const staleEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-a',
                    url: 'https://example.com/video-a.m3u8',
                },
            };

            await platform.handleInjectorEvents(staleEvent);

            expect(sentMessages).toHaveLength(0);
            expect(onSubtitleFound).not.toHaveBeenCalled();
            expect(platform.pendingVttUrlForVideoId['video-a']).toBeUndefined();
            expect(
                platform.lastKnownVttUrlForVideoId['video-a']
            ).toBeUndefined();

            const serializedStaleLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedStaleLogs).not.toContain('video-a');
            expect(serializedStaleLogs).not.toContain(staleEvent.detail.url);

            flipRouteAtImport = false;
            await platform.handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-b',
                    url: 'https://example.com/video-b.m3u8',
                },
            });

            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0]).toEqual(
                expect.objectContaining({ videoId: 'video-b' })
            );
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith(
                expect.objectContaining({ videoId: 'video-b' })
            );
        });

        test('drops a deferred response after player-to-player navigation without corrupting request state', async () => {
            const deferredResponse = createDeferred();
            let routeVideoId = 'video-a';
            platform.extractVideoIdFromCurrentRoute.mockImplementation(
                () => routeVideoId
            );
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestVttViaMessaging')
                .mockImplementationOnce(() => deferredResponse.promise)
                .mockResolvedValueOnce(
                    createSuccessfulDisneyResponse({
                        videoId: 'video-a',
                        vttText: 'WEBVTT retry',
                    })
                );
            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-a',
                    url: 'https://example.com/video-a.m3u8',
                },
            };

            const staleAttempt = platform.handleInjectorEvents(event);
            await flushPromises();
            expect(requestVtt).toHaveBeenCalledTimes(1);

            routeVideoId = 'video-b';
            deferredResponse.resolve({
                success: true,
                videoId: 'video-a',
                url: event.detail.url,
                vttText: 'WEBVTT stale',
            });
            await staleAttempt;

            expect(onSubtitleFound).not.toHaveBeenCalled();
            expect(
                platform.lastKnownVttUrlForVideoId['video-a']
            ).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId['video-a']).toBeUndefined();
            expect(
                platform.lastKnownVttUrlForVideoId['video-b']
            ).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId['video-b']).toBeUndefined();

            const serializedStaleLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedStaleLogs).not.toContain('video-a');
            expect(serializedStaleLogs).not.toContain(event.detail.url);

            routeVideoId = 'video-a';
            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(2);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId['video-a']).toBe(
                event.detail.url
            );
        });
    });

    describe('Playback clock', () => {
        test('selects the visible, ready video instead of a dormant first video', () => {
            const dormant = createVideo();
            const active = createVideo({
                currentTime: 430,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            active.video.id = 'hivePlayer1';
            document.body.append(dormant.video, active.video);

            expect(platform.getVideoElement()).toBe(active.video);
        });

        test('finds the semantic timeline through nested open shadow roots', () => {
            const { timeline } = createDisneyTimeline(1063);

            expect(platform.getProgressBarElement()).toBe(timeline);
        });

        test('uses active video time continuously after timeline calibration', () => {
            const active = createVideo({
                currentTime: 400,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            const firstTimeline = createDisneyTimeline(1000);

            expect(platform.getPlaybackTime()).toBeCloseTo(1000);

            active.state.currentTime = 401;
            expect(platform.getPlaybackTime()).toBeCloseTo(1001);

            firstTimeline.overlay.remove();
            active.state.currentTime = 410;
            expect(platform.getPlaybackTime()).toBeCloseTo(1010);

            createDisneyTimeline(1020);
            active.state.currentTime = 411;
            expect(platform.getPlaybackTime()).toBeCloseTo(1020);

            active.state.currentTime = 412;
            expect(platform.getPlaybackTime()).toBeCloseTo(1021);
        });

        test('drops stale timeline calibration immediately when the video seeks', () => {
            const active = createVideo({
                currentTime: 400,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            const { timeline } = createDisneyTimeline(1000);

            expect(platform.getPlaybackTime()).toBeCloseTo(1000);

            active.state.currentTime = 900;
            expect(platform.getPlaybackTime()).toBeCloseTo(900);

            timeline.setAttribute('aria-valuenow', '900');
            expect(platform.getPlaybackTime()).toBeCloseTo(900);
        });

        test('does not turn a slider-leading-media seek into a persistent offset', () => {
            const active = createVideo({
                currentTime: 100,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            const { timeline } = createDisneyTimeline(100);

            expect(platform.getPlaybackTime()).toBeCloseTo(100);

            timeline.setAttribute('aria-valuenow', '500');
            expect(platform.getPlaybackTime()).toBeCloseTo(100);

            active.state.currentTime = 500;
            expect(platform.getPlaybackTime()).toBeCloseTo(500);

            timeline.setAttribute('aria-valuenow', '501');
            active.state.currentTime = 501;
            expect(platform.getPlaybackTime()).toBeCloseTo(501);
        });

        test('falls back immediately to active video time before calibration', () => {
            const active = createVideo({
                currentTime: 25,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);

            expect(platform.getPlaybackTime()).toBe(25);
        });

        test('does not subtract a declared bumper when Disney skips it', () => {
            const active = createVideo({
                currentTime: 10,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/abc-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);

            const videoId = 'abc-video';
            const url = 'https://example.com/abc-master.m3u8';
            platform.currentVideoId = videoId;
            platform.lastKnownVttUrlForVideoId[videoId] = url;
            platform.extractVideoIdFromCurrentRoute.mockReturnValue(videoId);
            platform._handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId,
                    url,
                    programStartOffsetSeconds: 3.003,
                },
            });

            expect(platform.getPlaybackTime(active.video)).toBe(10);
        });

        test('anchors Disney program time to the continuously advancing video clock', () => {
            const active = createVideo({
                currentTime: 4.087,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/abc-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);

            platform.currentVideoId = 'abc-video';
            platform._handleInjectorEvents({
                detail: {
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    videoId: 'abc-video',
                    availId: 'abc-avail',
                    playbackSessionId: 'abc-session',
                    sequence: 1,
                    programTimeSeconds: 1.084,
                    isInterstitialPlaying: false,
                    isBumper: false,
                },
            });

            expect(platform.getPlaybackTime(active.video)).toBeCloseTo(1.084);

            active.state.currentTime = 5.087;
            expect(platform.getPlaybackTime(active.video)).toBeCloseTo(2.084);
        });

        test('ignores runtime samples without a playback identity', () => {
            const active = createVideo({
                currentTime: 10,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/anonymous',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            platform.currentVideoId = 'anonymous-video';

            platform._handleInjectorEvents({
                detail: {
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    videoId: 'anonymous-video',
                    sequence: 1,
                    programTimeSeconds: 100,
                    isInterstitialPlaying: false,
                    isBumper: false,
                },
            });

            expect(platform.getPlaybackTime(active.video)).toBe(10);
        });

        test('falls back when the active video is replaced before a new runtime sample', () => {
            const first = createVideo({
                currentTime: 20,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/first-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(first.video);
            platform.currentVideoId = 'replaced-video';
            platform._handleInjectorEvents({
                detail: {
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    videoId: 'replaced-video',
                    availId: 'replaced-avail',
                    playbackSessionId: 'replaced-session',
                    sequence: 1,
                    programTimeSeconds: 10,
                    isInterstitialPlaying: false,
                    isBumper: false,
                },
            });
            expect(platform.getPlaybackTime(first.video)).toBe(10);

            first.video.remove();
            const replacement = createVideo({
                currentTime: 25,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/replacement',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(replacement.video);

            expect(platform.getPlaybackTime(replacement.video)).toBe(25);
        });

        test('suppresses subtitles only while an interstitial actually plays', () => {
            const active = createVideo({
                currentTime: 1,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/branded-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            platform.currentVideoId = 'branded-video';
            platform._handleInjectorEvents({
                detail: {
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    videoId: 'branded-video',
                    availId: 'branded-avail',
                    playbackSessionId: 'branded-session',
                    sequence: 1,
                    programTimeSeconds: 0,
                    isInterstitialPlaying: true,
                    isBumper: true,
                },
            });

            expect(platform.getPlaybackTime(active.video)).toBe(-1);

            active.state.currentTime = 3.003;
            platform._handleInjectorEvents({
                detail: {
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    videoId: 'branded-video',
                    availId: 'branded-avail',
                    playbackSessionId: 'branded-session',
                    sequence: 2,
                    programTimeSeconds: 0,
                    isInterstitialPlaying: false,
                    isBumper: false,
                },
            });
            expect(platform.getPlaybackTime(active.video)).toBe(0);

            active.state.currentTime = 4.003;
            expect(platform.getPlaybackTime(active.video)).toBeCloseTo(1);
        });

        test('waits for a coherent program sample after seeking', () => {
            const active = createVideo({
                currentTime: 100,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/seek-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            platform.currentVideoId = 'seek-video';

            const updateTimeline = (sequence, programTimeSeconds) =>
                platform._handleInjectorEvents({
                    detail: {
                        type: 'PLAYBACK_TIMELINE_UPDATE',
                        videoId: 'seek-video',
                        availId: 'seek-avail',
                        playbackSessionId: 'seek-session',
                        sequence,
                        programTimeSeconds,
                        isInterstitialPlaying: false,
                        isBumper: false,
                    },
                });

            updateTimeline(1, 100);
            expect(platform.getPlaybackTime(active.video)).toBe(100);

            platform.invalidatePlaybackClockCalibration();
            active.state.currentTime = 500;
            updateTimeline(2, 101);
            expect(platform.getPlaybackTime(active.video)).toBe(-1);

            updateTimeline(3, 500);
            expect(platform.getPlaybackTime(active.video)).toBe(500);
        });

        test('recovers when a seek changes the media timestamp origin', () => {
            const active = createVideo({
                currentTime: 100,
                readyState: 4,
                paused: true,
                currentSrc: 'blob:https://www.disneyplus.com/discontinuity',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            platform.currentVideoId = 'discontinuity-video';

            const updateTimeline = (sequence, programTimeSeconds) =>
                platform._handleInjectorEvents({
                    detail: {
                        type: 'PLAYBACK_TIMELINE_UPDATE',
                        videoId: 'discontinuity-video',
                        availId: 'discontinuity-avail',
                        playbackSessionId: 'discontinuity-session',
                        sequence,
                        programTimeSeconds,
                        isInterstitialPlaying: false,
                        isBumper: false,
                    },
                });

            const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
            try {
                updateTimeline(1, 100);
                platform.invalidatePlaybackClockCalibration();
                active.state.currentTime = 500;

                updateTimeline(2, 400);
                expect(platform.getPlaybackTime(active.video)).toBe(-1);

                now.mockReturnValue(1200);
                updateTimeline(3, 400);
                expect(platform.getPlaybackTime(active.video)).toBe(400);
            } finally {
                now.mockRestore();
            }
        });

        test('rejects the previous playback session during an SPA transition', () => {
            const active = createVideo({
                currentTime: 10,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/reused-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            platform.currentVideoId = 'video-a';
            platform._handleInjectorEvents({
                detail: {
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    videoId: 'video-a',
                    availId: 'avail-a',
                    playbackSessionId: 'session-a',
                    sequence: 1,
                    programTimeSeconds: 100,
                    isInterstitialPlaying: false,
                    isBumper: false,
                },
            });
            expect(platform.getPlaybackTime(active.video)).toBe(100);

            const nextUrl = 'https://example.com/video-b.m3u8';
            platform.lastKnownVttUrlForVideoId['video-b'] = nextUrl;
            platform.extractVideoIdFromCurrentRoute.mockReturnValue('video-b');
            platform._handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-b',
                    url: nextUrl,
                },
            });
            active.state.currentTime = 11;
            platform._handleInjectorEvents({
                detail: {
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    videoId: 'video-b',
                    availId: 'avail-a',
                    playbackSessionId: 'session-a',
                    sequence: 2,
                    programTimeSeconds: 101,
                    isInterstitialPlaying: false,
                    isBumper: false,
                },
            });
            expect(platform.getPlaybackTime(active.video)).toBe(11);

            platform._handleInjectorEvents({
                detail: {
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    videoId: 'video-b',
                    availId: 'avail-b',
                    playbackSessionId: 'session-b',
                    sequence: 3,
                    programTimeSeconds: 1,
                    isInterstitialPlaying: false,
                    isBumper: false,
                },
            });
            expect(platform.getPlaybackTime(active.video)).toBe(1);
        });

        test('does not enable the generic progress-bar observer', () => {
            expect(platform.supportsProgressBarTracking()).toBe(false);
        });
    });

    describe('Playback controls', () => {
        test('forbids direct-media fallback because Disney owns playback state', () => {
            expect(platform.allowsDirectMediaPlaybackFallback()).toBe(false);
        });

        test('pauses through the nested Disney controller and the next native click resumes', async () => {
            jest.useFakeTimers();
            try {
                const active = createVideo({ paused: false, ended: false });
                const directPause = jest.fn(() => {
                    active.state.paused = true;
                });
                Object.defineProperty(active.video, 'pause', {
                    configurable: true,
                    value: directPause,
                });
                document.body.appendChild(active.video);
                const controller = createDisneyPlaybackController(active);

                const result = platform.pausePlayback();
                await jest.advanceTimersByTimeAsync(160);

                await expect(result).resolves.toBe(true);
                expect(active.state.paused).toBe(true);
                expect(controller.controllerState.playing).toBe(false);
                expect(controller.button).toHaveAttribute(
                    'data-playback-state',
                    'paused'
                );
                expect(directPause).not.toHaveBeenCalled();

                controller.button.click();

                expect(active.state.paused).toBe(false);
                expect(controller.controllerState.playing).toBe(true);
                expect(controller.button).toHaveAttribute(
                    'data-playback-state',
                    'playing'
                );
            } finally {
                jest.useRealTimers();
            }
        });

        test('skips a disabled nested controller and uses a connected actionable control', async () => {
            jest.useFakeTimers();
            try {
                const active = createVideo({ paused: false, ended: false });
                document.body.appendChild(active.video);
                const disabledController =
                    createDisneyPlaybackController(active);
                disabledController.button.disabled = true;
                const activeController = createDisneyPlaybackController(active);

                const result = platform.pausePlayback();
                await jest.advanceTimersByTimeAsync(160);

                await expect(result).resolves.toBe(true);
                expect(disabledController.controllerState.playing).toBe(true);
                expect(active.state.paused).toBe(true);
                expect(activeController.controllerState.playing).toBe(false);
            } finally {
                jest.useRealTimers();
            }
        });

        test('verifies the same Disney video that the native controller paused', async () => {
            jest.useFakeTimers();
            try {
                const selected = createVideo({ paused: false });
                const competing = createVideo({ paused: false });
                document.body.append(selected.video, competing.video);
                const controller = createDisneyPlaybackController(selected);

                const result = platform.pausePlayback();
                await jest.advanceTimersByTimeAsync(160);

                await expect(result).resolves.toBe(true);
                expect(selected.state.paused).toBe(true);
                expect(competing.state.paused).toBe(false);
                expect(controller.controllerState.playing).toBe(false);
            } finally {
                jest.useRealTimers();
            }
        });

        test('uses media state instead of localized control labels', () => {
            const active = createVideo({ paused: false, ended: false });
            document.body.appendChild(active.video);
            createDisneyPlaybackToggle('Reproducir');

            expect(platform.isPlaying()).toBe(true);

            active.state.ended = true;
            expect(platform.isPlaying()).toBe(false);

            active.video.remove();
            expect(platform.isPlaying()).toBeNull();
        });

        test('does not click a playback control when no video exists', async () => {
            const button = createDisneyPlaybackToggle('Pause');
            const clickSpy = jest.spyOn(button, 'click');

            await expect(platform.pausePlayback()).resolves.toBe(false);
            await expect(platform.resumePlayback()).resolves.toBe(false);

            expect(clickSpy).not.toHaveBeenCalled();
        });

        test('returns false when a needed playback control is missing', async () => {
            const active = createVideo({ paused: false, ended: false });
            document.body.appendChild(active.video);

            await expect(platform.pausePlayback()).resolves.toBe(false);
            expect(platform.allowsDirectMediaPlaybackFallback()).toBe(false);

            active.state.paused = true;
            await expect(platform.resumePlayback()).resolves.toBe(false);
            expect(platform.allowsDirectMediaPlaybackFallback()).toBe(false);
        });

        test('returns true without controls when media is already in the requested state', async () => {
            const active = createVideo({ paused: true, ended: false });
            document.body.appendChild(active.video);

            await expect(platform.pausePlayback()).resolves.toBe(true);

            active.state.paused = false;
            await expect(platform.resumePlayback()).resolves.toBe(true);
        });

        test('pauses through a misleadingly labelled control and verifies media state', async () => {
            jest.useFakeTimers();
            try {
                const active = createVideo({ paused: false, ended: false });
                document.body.appendChild(active.video);
                const button = createDisneyPlaybackToggle('Play');
                button.addEventListener('click', () => {
                    active.state.paused = true;
                });

                const result = platform.pausePlayback();
                await jest.advanceTimersByTimeAsync(160);

                await expect(result).resolves.toBe(true);
                expect(active.state.paused).toBe(true);
            } finally {
                jest.useRealTimers();
            }
        });

        test('returns false when a control click does not pause the video', async () => {
            jest.useFakeTimers();
            try {
                const active = createVideo({ paused: false, ended: false });
                document.body.appendChild(active.video);
                createDisneyPlaybackToggle('Pausar');

                const result = platform.pausePlayback();
                await jest.advanceTimersByTimeAsync(160);

                await expect(result).resolves.toBe(false);
                expect(platform.allowsDirectMediaPlaybackFallback()).toBe(
                    false
                );
            } finally {
                jest.useRealTimers();
            }
        });

        test('fails closed while a slow native controller is still transitioning', async () => {
            jest.useFakeTimers();
            try {
                const active = createVideo({ paused: false, ended: false });
                document.body.appendChild(active.video);
                const controller = createDisneyPlaybackController(active, {
                    transitionDelay: 320,
                });

                const result = platform.pausePlayback();
                await jest.advanceTimersByTimeAsync(160);

                await expect(result).resolves.toBe(false);
                expect(active.state.paused).toBe(false);
                expect(controller.controllerState.playing).toBe(true);
                expect(platform.allowsDirectMediaPlaybackFallback()).toBe(
                    false
                );
            } finally {
                jest.useRealTimers();
            }
        });

        test('returns false when the video disappears before pause verification', async () => {
            jest.useFakeTimers();
            try {
                const active = createVideo({ paused: false, ended: false });
                document.body.appendChild(active.video);
                const button = createDisneyPlaybackToggle('Pause');
                button.addEventListener('click', () => active.video.remove());

                const result = platform.pausePlayback();
                await jest.advanceTimersByTimeAsync(160);

                await expect(result).resolves.toBe(false);
            } finally {
                jest.useRealTimers();
            }
        });

        test('resumes ended media only after the media becomes playable', async () => {
            jest.useFakeTimers();
            try {
                const active = createVideo({ paused: true, ended: true });
                document.body.appendChild(active.video);
                const button = createDisneyPlaybackToggle('再生');
                button.addEventListener('click', () => {
                    active.state.paused = false;
                    active.state.ended = false;
                });

                const result = platform.resumePlayback();
                await jest.advanceTimersByTimeAsync(160);

                await expect(result).resolves.toBe(true);
                expect(platform.isPlaying()).toBe(true);
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('Background Communication Logging', () => {
        test('should log VTT request to background', async () => {
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: true,
                        videoId: '12345',
                    });
                }
            );

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Requesting VTT from background',
                expect.objectContaining({
                    urlLength: mockEvent.detail.url.length,
                    hasVideoId: true,
                })
            );
        });

        test('should log successful VTT fetch', async () => {
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback(createSuccessfulDisneyResponse());
                }
            );

            platform.currentVideoId = '12345';
            platform.setCallbacks(jest.fn(), jest.fn());

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'VTT fetched successfully',
                expect.objectContaining({
                    hasVideoId: true,
                    hasSourceLanguage: true,
                    hasTargetLanguage: true,
                })
            );
        });

        test('should log background fetch errors', async () => {
            const backgroundErrorCanary =
                'https://errors.example/disney?token=DISNEY_BACKGROUND_ERROR_SECRET';
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: false,
                        error: backgroundErrorCanary,
                        url: 'http://example.com/subtitle.vtt',
                    });
                }
            );

            platform.currentVideoId = '12345';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Background failed to fetch VTT',
                null,
                expect.objectContaining({
                    backgroundRejected: true,
                    hasVideoId: true,
                })
            );
            expect(
                JSON.stringify({
                    debug: mockLogger.debug.mock.calls,
                    info: mockLogger.info.mock.calls,
                    warn: mockLogger.warn.mock.calls,
                    error: mockLogger.error.mock.calls,
                })
            ).not.toContain(backgroundErrorCanary);
        });

        test('should log chrome runtime errors', async () => {
            const runtimeError = {
                message: 'DISNEY_LAST_ERROR_MESSAGE_CANARY',
                stack: 'DISNEY_LAST_ERROR_STACK_CANARY',
                cause: 'DISNEY_LAST_ERROR_CAUSE_CANARY',
                customSecret: 'DISNEY_LAST_ERROR_CUSTOM_CANARY',
            };
            chromeApiMock.runtime.lastError = runtimeError;
            // Force dynamic import path to fail so the code takes the callback-based fallback path
            chromeApiMock.runtime.getURL = jest.fn(
                () => 'file:///non-existent-module.js'
            );
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback();
                }
            );

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error for VTT fetch',
                null,
                expect.objectContaining({
                    hasRuntimeError: true,
                    urlLength: mockEvent.detail.url.length,
                    hasVideoId: true,
                })
            );
            expectSensitiveValueAbsentFromLogs(
                [
                    ...mockLogger.debug.mock.calls,
                    ...mockLogger.info.mock.calls,
                    ...mockLogger.warn.mock.calls,
                    ...mockLogger.error.mock.calls,
                ],
                runtimeError
            );

            // Reset lastError
            chromeApiMock.runtime.lastError = null;
        });

        test('should log video context mismatch warnings', async () => {
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: true,
                        videoId: '67890', // Different from current
                    });
                }
            );

            platform.currentVideoId = '12345';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Received VTT for different video context - discarding',
                expect.objectContaining({
                    hasReceivedVideoId: true,
                    idsMatch: false,
                })
            );
        });
    });

    describe('Subtitle CSS logging privacy', () => {
        test('does not expose DOM insertion failures to telemetry', () => {
            const cssError = Object.assign(
                new Error('DISNEY_CSS_MESSAGE_CANARY'),
                {
                    cause: 'DISNEY_CSS_CAUSE_CANARY',
                    customSecret: 'DISNEY_CSS_CUSTOM_CANARY',
                }
            );
            const appendChild = jest
                .spyOn(document.head, 'appendChild')
                .mockImplementationOnce(() => {
                    throw cssError;
                });

            try {
                platform.addDisneyPlusSubtitleCSS();

                expect(mockLogger.error).toHaveBeenCalledWith(
                    '[DisneyPlusPlatform] Failed to inject CSS'
                );
                expectSensitiveValueAbsentFromLogs(
                    mockLogger.error.mock.calls,
                    cssError
                );
            } finally {
                appendChild.mockRestore();
            }
        });
    });

    describe('Subtitle observer timer lifecycle', () => {
        test('observes scoped Disney player and controls roots instead of the document body', () => {
            const OriginalMutationObserver = global.MutationObserver;
            const { playerRoot, overlay, overlayRoot } =
                mountDisneySubtitleRoots();
            const observe = jest.fn();
            try {
                global.MutationObserver = jest.fn(() => ({
                    observe,
                    disconnect: jest.fn(),
                }));

                platform.setupSubtitleMutationObserver();

                expect(global.MutationObserver).toHaveBeenCalledTimes(1);
                expect(observe).toHaveBeenCalledTimes(2);
                expect(observe).toHaveBeenCalledWith(playerRoot, {
                    childList: true,
                    subtree: true,
                });
                expect(observe).toHaveBeenCalledWith(overlayRoot, {
                    childList: true,
                    subtree: true,
                });
                expect(observe).not.toHaveBeenCalledWith(
                    document.body,
                    expect.anything()
                );
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
            }
        });

        test('leaves Disney progress-bar discovery state untouched', () => {
            const OriginalMutationObserver = global.MutationObserver;
            const { playerRoot, overlay } = mountDisneySubtitleRoots();
            const cachedTimeline = document.createElement('div');
            try {
                global.MutationObserver = jest.fn(() => ({
                    observe: jest.fn(),
                    disconnect: jest.fn(),
                }));
                const getProgressBar = jest.spyOn(
                    platform,
                    'getProgressBarElement'
                );
                platform._cachedProgressBarElement = cachedTimeline;

                platform.setupSubtitleMutationObserver();

                expect(getProgressBar).not.toHaveBeenCalled();
                expect(platform._cachedProgressBarElement).toBe(cachedTimeline);
                expect(platform.supportsProgressBarTracking()).toBe(false);
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
            }
        });

        test('deduplicates the same scoped root discovered through both paths', () => {
            const OriginalMutationObserver = global.MutationObserver;
            const overlay = document.createElement('main-app-controls-overlay');
            const overlayRoot = overlay.attachShadow({ mode: 'open' });
            document.body.appendChild(overlay);
            const observe = jest.fn();
            try {
                jest.spyOn(
                    platform,
                    'getPlayerContainerElement'
                ).mockReturnValue(overlayRoot);
                global.MutationObserver = jest.fn(() => ({
                    observe,
                    disconnect: jest.fn(),
                }));

                platform.setupSubtitleMutationObserver();

                expect(observe).toHaveBeenCalledTimes(1);
                expect(observe).toHaveBeenCalledWith(overlayRoot, {
                    childList: true,
                    subtree: true,
                });
            } finally {
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
            }
        });

        test('stops retrying after the finite scoped-root discovery budget', async () => {
            jest.useFakeTimers();
            try {
                const getPlayerRoot = jest
                    .spyOn(platform, 'getPlayerContainerElement')
                    .mockReturnValue(null);

                platform.setupSubtitleMutationObserver();
                await jest.advanceTimersByTimeAsync(5000);

                expect(getPlayerRoot).toHaveBeenCalledTimes(20);
                expect(jest.getTimerCount()).toBe(0);

                await jest.advanceTimersByTimeAsync(5000);
                expect(getPlayerRoot).toHaveBeenCalledTimes(20);
            } finally {
                jest.useRealTimers();
            }
        });

        test('keeps successfully attached roots when another scoped root fails', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const { playerRoot, overlay, overlayRoot } =
                mountDisneySubtitleRoots();
            let observerCallback;
            const observer = {
                observe: jest.fn((root) => {
                    if (root === overlayRoot) {
                        throw new Error('shadow root attachment failed');
                    }
                }),
                disconnect: jest.fn(),
            };
            try {
                global.MutationObserver = jest.fn((callback) => {
                    observerCallback = callback;
                    return observer;
                });
                const applySetting = jest
                    .spyOn(platform, 'applyCurrentSubtitleSetting')
                    .mockResolvedValue();

                platform.setupSubtitleMutationObserver();

                expect(observer.observe).toHaveBeenCalledTimes(2);
                expect(platform.subtitleObserver).toBe(observer);
                expect(jest.getTimerCount()).toBe(0);

                observerCallback(createDisneySubtitleMutation());
                await jest.advanceTimersByTimeAsync(100);

                expect(applySetting).toHaveBeenCalledTimes(1);
                expect(observer.disconnect).not.toHaveBeenCalled();
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('stops retrying after the finite observer-construction budget', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const { playerRoot, overlay } = mountDisneySubtitleRoots();
            try {
                global.MutationObserver = jest.fn(() => {
                    throw new Error('observer construction failed');
                });

                platform.setupSubtitleMutationObserver();
                await jest.advanceTimersByTimeAsync(5000);

                expect(global.MutationObserver).toHaveBeenCalledTimes(20);
                expect(jest.getTimerCount()).toBe(0);
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('stops retrying when every scoped-root attachment fails', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const { playerRoot, overlay } = mountDisneySubtitleRoots();
            const observe = jest.fn(() => {
                throw new Error('observer attachment failed');
            });
            const disconnect = jest.fn();
            try {
                global.MutationObserver = jest.fn(() => ({
                    observe,
                    disconnect,
                }));

                platform.setupSubtitleMutationObserver();
                await jest.advanceTimersByTimeAsync(5000);

                expect(global.MutationObserver).toHaveBeenCalledTimes(20);
                expect(observe).toHaveBeenCalledTimes(40);
                expect(disconnect).toHaveBeenCalledTimes(20);
                expect(jest.getTimerCount()).toBe(0);
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('cancels a pending scoped-root retry during cleanup', async () => {
            jest.useFakeTimers();
            try {
                const getPlayerRoot = jest
                    .spyOn(platform, 'getPlayerContainerElement')
                    .mockReturnValue(null);

                platform.setupSubtitleMutationObserver();
                expect(jest.getTimerCount()).toBe(1);

                platform.cleanup();
                expect(jest.getTimerCount()).toBe(0);

                await jest.advanceTimersByTimeAsync(250);
                expect(getPlayerRoot).toHaveBeenCalledTimes(1);
            } finally {
                jest.useRealTimers();
            }
        });

        test('ignores a stale retry callback after a new scoped lifecycle starts', () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const timeoutSpy = jest.spyOn(global, 'setTimeout');
            const getPlayerRoot = jest.spyOn(
                platform,
                'getPlayerContainerElement'
            );
            let roots = null;
            try {
                global.MutationObserver = jest.fn(() => ({
                    observe: jest.fn(),
                    disconnect: jest.fn(),
                }));

                platform.setupSubtitleMutationObserver();
                const staleRetryCallback = timeoutSpy.mock.calls[0][0];

                roots = mountDisneySubtitleRoots();
                platform.setupSubtitleMutationObserver();
                const currentObserver = platform.subtitleObserver;
                expect(getPlayerRoot).toHaveBeenCalledTimes(2);
                expect(jest.getTimerCount()).toBe(0);

                staleRetryCallback();

                expect(getPlayerRoot).toHaveBeenCalledTimes(2);
                expect(platform.subtitleObserver).toBe(currentObserver);
            } finally {
                timeoutSpy.mockRestore();
                roots?.playerRoot.remove();
                roots?.overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('coalesces matching Disney subtitle mutations into one owned reapply task', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const { playerRoot, overlay } = mountDisneySubtitleRoots();
            let observerCallback;
            try {
                global.MutationObserver = jest.fn((callback) => {
                    observerCallback = callback;
                    return {
                        observe: jest.fn(),
                        disconnect: jest.fn(),
                    };
                });
                const applySetting = jest
                    .spyOn(platform, 'applyCurrentSubtitleSetting')
                    .mockResolvedValue();
                const nestedSubtitle = document.createElement('div');
                nestedSubtitle.appendChild(
                    Object.assign(document.createElement('span'), {
                        className: 'hive-subtitle-renderer-wrapper',
                    })
                );

                platform.setupSubtitleMutationObserver();
                observerCallback([
                    ...createDisneySubtitleMutation(),
                    {
                        type: 'childList',
                        addedNodes: [nestedSubtitle],
                    },
                ]);
                observerCallback(createDisneySubtitleMutation());

                expect(jest.getTimerCount()).toBe(1);
                expect(platform.ownedTimeouts.size).toBe(1);

                await jest.advanceTimersByTimeAsync(100);

                expect(applySetting).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);
                expect(platform.ownedTimeouts.size).toBe(0);
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('cancels a pending observer setup retry after an exception', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const { playerRoot, overlay } = mountDisneySubtitleRoots();
            try {
                global.MutationObserver = jest.fn(() => ({
                    observe: jest.fn(() => {
                        throw new Error('observe failed');
                    }),
                    disconnect: jest.fn(),
                }));
                const setupObserver = jest.spyOn(
                    platform,
                    'setupSubtitleMutationObserver'
                );

                platform.setupSubtitleMutationObserver();
                expect(jest.getTimerCount()).toBe(1);

                platform.cleanup();
                expect(jest.getTimerCount()).toBe(0);

                await jest.advanceTimersByTimeAsync(250);
                expect(setupObserver).toHaveBeenCalledTimes(1);
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('cancels reapply work on cleanup and supports a fresh observer lifecycle', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const observerCallbacks = [];
            const observerRecords = [];
            let roots = mountDisneySubtitleRoots();
            try {
                global.MutationObserver = jest.fn((callback) => {
                    observerCallbacks.push(callback);
                    const record = {
                        observe: jest.fn(),
                        disconnect: jest.fn(),
                    };
                    observerRecords.push(record);
                    return record;
                });
                const applySetting = jest
                    .spyOn(platform, 'applyCurrentSubtitleSetting')
                    .mockResolvedValue();

                platform.setupSubtitleMutationObserver();
                observerCallbacks[0](createDisneySubtitleMutation());
                expect(jest.getTimerCount()).toBe(1);
                expect(platform.ownedTimeouts.size).toBe(1);

                roots.playerRoot.remove();
                roots.overlay.remove();
                roots = mountDisneySubtitleRoots();
                platform.setupSubtitleMutationObserver();
                expect(jest.getTimerCount()).toBe(0);
                expect(platform.ownedTimeouts.size).toBe(0);
                expect(observerRecords[0].disconnect).toHaveBeenCalledTimes(1);
                expect(observerRecords[1].observe).toHaveBeenCalledWith(
                    roots.playerRoot,
                    { childList: true, subtree: true }
                );
                expect(observerRecords[1].observe).toHaveBeenCalledWith(
                    roots.overlayRoot,
                    { childList: true, subtree: true }
                );

                observerCallbacks[0](createDisneySubtitleMutation());
                expect(jest.getTimerCount()).toBe(0);
                observerCallbacks[1](createDisneySubtitleMutation());
                expect(jest.getTimerCount()).toBe(1);
                expect(platform.ownedTimeouts.size).toBe(1);

                platform.cleanup();
                expect(jest.getTimerCount()).toBe(0);
                expect(platform.ownedTimeouts.size).toBe(0);

                observerCallbacks[1](createDisneySubtitleMutation());
                expect(jest.getTimerCount()).toBe(0);
                await jest.advanceTimersByTimeAsync(100);
                expect(applySetting).not.toHaveBeenCalled();

                platform.setupSubtitleMutationObserver();
                observerCallbacks[2](createDisneySubtitleMutation());
                await jest.advanceTimersByTimeAsync(100);

                expect(applySetting).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);
                expect(platform.ownedTimeouts.size).toBe(0);
            } finally {
                roots.playerRoot.remove();
                roots.overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('does not finish an asynchronous reapply after cleanup', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            let observerCallback;
            const { playerRoot, overlay } = mountDisneySubtitleRoots();
            try {
                global.MutationObserver = jest.fn((callback) => {
                    observerCallback = callback;
                    return {
                        observe: jest.fn(),
                        disconnect: jest.fn(),
                    };
                });
                const settingsGate = createDeferred();
                configService.get.mockReturnValueOnce(settingsGate.promise);
                const hideSubtitles = jest.spyOn(
                    platform,
                    'hideOfficialSubtitleContainers'
                );
                const showSubtitles = jest.spyOn(
                    platform,
                    'showOfficialSubtitleContainers'
                );

                platform.setupSubtitleMutationObserver();
                observerCallback(createDisneySubtitleMutation());
                await jest.advanceTimersByTimeAsync(100);
                expect(configService.get).toHaveBeenCalledWith(
                    'hideOfficialSubtitles'
                );

                platform.cleanup();
                settingsGate.resolve(true);
                await Promise.resolve();
                await Promise.resolve();

                expect(hideSubtitles).not.toHaveBeenCalled();
                expect(showSubtitles).toHaveBeenCalledTimes(1);
                expect(platform._hideOfficialSubtitles).toBeUndefined();
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('does not commit an asynchronous reapply into a replacement lifecycle', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const observerCallbacks = [];
            const { playerRoot, overlay } = mountDisneySubtitleRoots();
            try {
                global.MutationObserver = jest.fn((callback) => {
                    observerCallbacks.push(callback);
                    return {
                        observe: jest.fn(),
                        disconnect: jest.fn(),
                    };
                });
                const settingsGate = createDeferred();
                configService.get.mockReturnValueOnce(settingsGate.promise);
                const hideSubtitles = jest.spyOn(
                    platform,
                    'hideOfficialSubtitleContainers'
                );
                const showSubtitles = jest.spyOn(
                    platform,
                    'showOfficialSubtitleContainers'
                );

                platform.setupSubtitleMutationObserver();
                observerCallbacks[0](createDisneySubtitleMutation());
                await jest.advanceTimersByTimeAsync(100);
                expect(configService.get).toHaveBeenCalledWith(
                    'hideOfficialSubtitles'
                );

                platform.setupSubtitleMutationObserver();
                settingsGate.resolve(true);
                await Promise.resolve();
                await Promise.resolve();

                expect(hideSubtitles).not.toHaveBeenCalled();
                expect(showSubtitles).not.toHaveBeenCalled();
                expect(platform._hideOfficialSubtitles).toBeUndefined();
            } finally {
                playerRoot.remove();
                overlay.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });
    });

    describe('Cleanup Logging', () => {
        test('restores owned official subtitle DOM effects on terminal cleanup', () => {
            const subtitle = document.createElement('div');
            subtitle.className = 'TimedTextOverlay';
            document.body.appendChild(subtitle);
            platform.hideOfficialSubtitleContainers(['.TimedTextOverlay']);

            platform.cleanup();

            expect(subtitle.style.display).toBe('');
            expect(subtitle.style.visibility).toBe('');
            expect(subtitle.style.opacity).toBe('');
            expect(subtitle).not.toHaveAttribute('data-dualsub-hidden');
        });

        test('should log successful cleanup', () => {
            platform.eventListener = jest.fn();
            platform.subtitleObserver = { disconnect: jest.fn() };

            platform.cleanup();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Event listener removed'
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Subtitle mutation observer cleaned up'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Platform cleaned up successfully'
            );
        });

        test('completes cleanup when every telemetry sink throws', () => {
            platform.eventListener = jest.fn();
            platform.subtitleObserver = { disconnect: jest.fn() };
            platform.currentVideoId = 'cleanup-video';
            platform.onSubtitleUrlFoundCallback = jest.fn();
            platform.onVideoIdChangeCallback = jest.fn();
            platform.storageListener = jest.fn();
            platform.subtitleSelectors = ['.subtitle'];
            platform.unsubscribeFromChanges = jest.fn();
            platform.pendingVttUrlForVideoId['cleanup-video'] = {
                url: 'https://example.com/cleanup.m3u8',
            };
            for (const level of ['debug', 'info', 'warn', 'error']) {
                mockLogger[level].mockImplementation(() => {
                    throw new Error(`CLEANUP_${level}_LOGGER_CANARY`);
                });
            }

            expect(() => platform.cleanup()).not.toThrow();

            expect(platform.eventListener).toBeNull();
            expect(platform.subtitleObserver).toBeNull();
            expect(platform.currentVideoId).toBeNull();
            expect(platform.onSubtitleUrlFoundCallback).toBeNull();
            expect(platform.onVideoIdChangeCallback).toBeNull();
            expect(platform.unsubscribeFromChanges).toBeNull();
            expect(platform.storageListener).toBeNull();
            expect(platform.subtitleSelectors).toBeNull();
            expect(
                platform.pendingVttUrlForVideoId['cleanup-video']
            ).toBeUndefined();
        });
    });
});
