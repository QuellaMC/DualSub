import { describe, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NetflixPlatform } from './netflixPlatform.js';
import { mockChromeApi, ChromeApiMock } from '../test-utils/chrome-api-mock.js';
import { createLoggerMock } from '../test-utils/logger-mock.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import flushPromises from '../test-utils/flush-promises.js';
import { SubtitleRequestSources } from '../content_scripts/shared/constants/messageActions.js';
import { createInjectionChannel } from '../content_scripts/shared/injectionChannel.js';

const RESOLVED_NETFLIX_SETTINGS = {
    targetLanguage: 'zh-CN',
    originalLanguage: 'en',
    useNativeSubtitles: true,
    useOfficialTranslations: true,
};
const NETFLIX_INJECT_SCRIPT_URL =
    'chrome-extension://dualsub-test/injected_scripts/netflixInject.js';
let netflixCapability;

function createNetflixChannelAuthority(
    capability = netflixCapability,
    platform = 'netflix'
) {
    return { capability, platform };
}

function extractNetflixCapability(channel) {
    const scriptUrl = channel?.createScriptUrl(NETFLIX_INJECT_SCRIPT_URL);
    const match = /#dualsub-channel=netflix\.([0-9a-f]{64})$/u.exec(
        scriptUrl ?? ''
    );
    if (!match) throw new Error('Netflix test injection channel unavailable.');
    return match[1];
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

function createNetflixSubtitleEvent(movieId) {
    return {
        detail: {
            type: 'SUBTITLE_DATA_FOUND',
            dualsubChannel: createNetflixChannelAuthority(),
            payload: {
                movieId,
                timedtexttracks: [
                    {
                        language: 'en',
                        episodeId: movieId,
                        ttDownloadables: {
                            webvtt: {
                                urls: [
                                    {
                                        url: `https://example.com/${movieId}.vtt`,
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        },
    };
}

function createSuccessfulNetflixResponse(message) {
    const episodeId = message.data.tracks[0].episodeId;
    return {
        success: true,
        videoId: message.videoId,
        vttText: `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${episodeId}`,
        targetVttText: null,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeTarget: false,
        selectedLanguage: {
            normalizedCode: 'en',
            displayName: 'English',
        },
    };
}

function createNetflixSubtitleMutation() {
    const subtitleNode = document.createElement('div');
    subtitleNode.className = 'player-timedtext';
    return [
        {
            type: 'childList',
            addedNodes: [subtitleNode],
        },
    ];
}

function mountNetflixPlayerRoot() {
    const playerRoot = document.createElement('div');
    playerRoot.className = 'watch-video';
    playerRoot.appendChild(document.createElement('video'));
    document.body.appendChild(playerRoot);
    return playerRoot;
}

function createPlaybackVideo({ paused = true, ended = false } = {}) {
    const video = document.createElement('video');
    const state = { paused, ended };

    Object.defineProperties(video, {
        paused: {
            configurable: true,
            get: () => state.paused,
        },
        ended: {
            configurable: true,
            get: () => state.ended,
        },
        pause: {
            configurable: true,
            value: jest.fn(() => {
                state.paused = true;
            }),
        },
        play: {
            configurable: true,
            value: jest.fn(async () => {
                state.paused = false;
                state.ended = false;
            }),
        },
    });

    return { video, state };
}

describe('NetflixPlatform Logging Integration', () => {
    let platform;
    let mockLogger;
    let chromeApiMock;
    let locationCleanup;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup configService mock
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
            useNativeSubtitles: true,
            useOfficialTranslations: true,
        });
        jest.spyOn(configService, 'get').mockResolvedValue(true);

        // Setup Chrome API mock
        chromeApiMock = ChromeApiMock.create();
        mockChromeApi(chromeApiMock);

        // Create logger mock using centralized utility
        mockLogger = createLoggerMock();
        jest.spyOn(Logger, 'create').mockReturnValue(mockLogger);

        // Create platform instance
        platform = new NetflixPlatform();
        platform.injectionChannel = createInjectionChannel('netflix');
        netflixCapability = extractNetflixCapability(platform.injectionChannel);

        // Mock platform detection methods to simulate Netflix environment
        jest.spyOn(platform, 'isPlatformActive').mockReturnValue(true);
        jest.spyOn(platform, 'isPlayerPageActive').mockReturnValue(true);
        jest.spyOn(platform, 'extractMovieIdFromUrl').mockReturnValue('12345');

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
    });

    describe('Logger Initialization', () => {
        test('should create logger instance with correct component name', () => {
            expect(Logger.create).toHaveBeenCalledWith(
                'NetflixPlatform',
                expect.any(Object)
            );
            expect(platform.logger).toBe(mockLogger);
        });

        test('does not expose logger initialization failures to telemetry', async () => {
            const loggerError = Object.assign(
                new Error('NETFLIX_LOGGER_INIT_MESSAGE_CANARY'),
                {
                    cause: 'NETFLIX_LOGGER_INIT_CAUSE_CANARY',
                    customSecret: 'NETFLIX_LOGGER_INIT_CUSTOM_CANARY',
                }
            );
            mockLogger.updateLevel.mockRejectedValueOnce(loggerError);

            await platform.initializeLogger();

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Failed to initialize logger level, continuing with defaults',
                { chromeApiAvailable: true }
            );
            expectSensitiveValueAbsentFromLogs(
                mockLogger.warn.mock.calls,
                loggerError
            );
        });

        test('does not derive fallback telemetry from logger creation failures', async () => {
            const loggerError = Object.assign(
                new Error('NETFLIX_LOGGER_CREATE_MESSAGE_CANARY'),
                {
                    cause: 'NETFLIX_LOGGER_CREATE_CAUSE_CANARY',
                    customSecret: 'NETFLIX_LOGGER_CREATE_CUSTOM_CANARY',
                }
            );
            const consoleMocks = ['debug', 'info', 'warn', 'error'].map(
                (level) =>
                    jest.spyOn(console, level).mockImplementation(() => {
                        throw new Error(`FALLBACK_${level}_LOGGER_CANARY`);
                    })
            );
            Logger.create
                .mockReset()
                .mockReturnValueOnce(mockLogger)
                .mockReturnValueOnce(mockLogger)
                .mockImplementationOnce(() => {
                    throw loggerError;
                });

            let fallbackPlatform;
            expect(() => {
                fallbackPlatform = new NetflixPlatform();
            }).not.toThrow();
            await flushPromises();

            expect(console.warn).toHaveBeenCalledWith(
                '[NetflixPlatform]',
                'Failed to create proper logger, using fallback',
                { loggerCreated: false }
            );
            expectSensitiveValueAbsentFromLogs(
                consoleMocks.flatMap((mock) => mock.mock.calls),
                loggerError
            );
            fallbackPlatform.cleanup();
            for (const mock of consoleMocks) mock.mockRestore();
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

        test('proves ownership only for the canonical Netflix route currently adopted by the adapter', () => {
            platform.currentVideoId = '22222';

            expect(
                platform.hasAdoptedPlayerRoute(
                    'https://www.netflix.com/watch/22222'
                )
            ).toBe(true);
            expect(
                platform.hasAdoptedPlayerRoute(
                    'https://www.netflix.com/watch/11111'
                )
            ).toBe(false);
            expect(
                platform.hasAdoptedPlayerRoute(
                    'https://www.netflix.com/browse/watch/22222'
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

        test('keeps initialization ownership consistent when telemetry throws after config subscription', async () => {
            const unsubscribe = jest.fn();
            const onChanged = jest
                .spyOn(configService, 'onChanged')
                .mockReturnValueOnce(unsubscribe);
            mockLogger.debug.mockImplementation(() => {
                throw new Error('POST_SUBSCRIPTION_LOGGER_CANARY');
            });
            const onSubtitleFound = jest.fn();
            const onVideoIdChange = jest.fn();

            await expect(
                platform.initialize(onSubtitleFound, onVideoIdChange)
            ).resolves.toBeUndefined();

            expect(onChanged).toHaveBeenCalledWith(platform.storageListener);
            expect(platform.eventListener).toEqual(expect.any(Function));
            expect(platform.storageListener).toEqual(expect.any(Function));
            expect(platform.subtitleSelectors).toEqual(expect.any(Array));
            expect(platform.unsubscribeFromChanges).toBe(unsubscribe);
            expect(platform.onSubtitleUrlFoundCallback).toBe(onSubtitleFound);
            expect(platform.onVideoIdChangeCallback).toBe(onVideoIdChange);
        });
    });

    describe('Injected event capability lifecycle', () => {
        test('replaces and revokes one adapter handle per initialization', async () => {
            jest.spyOn(
                platform,
                'setupNativeSubtitleSettingsListener'
            ).mockImplementation(() => {});
            const seededChannel = platform.injectionChannel;
            const readyEvent = {
                detail: {
                    type: 'INJECT_SCRIPT_READY',
                    dualsubChannel: createNetflixChannelAuthority(),
                },
            };

            await platform.initialize(jest.fn(), jest.fn());
            const firstChannel = platform.injectionChannel;
            const firstListener = platform.eventListener;

            expect(firstChannel).not.toBe(seededChannel);
            expect(extractNetflixCapability(firstChannel)).toBe(
                netflixCapability
            );
            expect(seededChannel.accept(readyEvent)).toBeNull();

            await platform.initialize(jest.fn(), jest.fn());

            expect(platform.injectionChannel).not.toBe(firstChannel);
            expect(extractNetflixCapability(platform.injectionChannel)).toBe(
                netflixCapability
            );
            expect(firstChannel.accept(readyEvent)).toBeNull();

            mockLogger.info.mockClear();
            firstListener(readyEvent);
            expect(mockLogger.info).not.toHaveBeenCalled();

            platform.eventListener(readyEvent);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Inject script is ready'
            );
        });

        test('makes a saved listener inert synchronously during cleanup', async () => {
            jest.spyOn(
                platform,
                'setupNativeSubtitleSettingsListener'
            ).mockImplementation(() => {});
            await platform.initialize(jest.fn(), jest.fn());
            const savedListener = platform.eventListener;
            const readyEvent = {
                detail: {
                    type: 'INJECT_SCRIPT_READY',
                    dualsubChannel: createNetflixChannelAuthority(),
                },
            };

            platform.cleanup();
            mockLogger.info.mockClear();
            savedListener(readyEvent);

            expect(mockLogger.info).not.toHaveBeenCalled();
            expect(platform.injectionChannel).toBeNull();
        });

        test('retires deferred lifecycle A before lifecycle B can dispatch or receive it', async () => {
            const deferredSettings = createDeferred();
            configService.getMultiple
                .mockImplementationOnce(() => deferredSettings.promise)
                .mockResolvedValue(RESOLVED_NETFLIX_SETTINGS);
            const callbackA = jest.fn();
            const callbackB = jest.fn();
            const requestVtt = jest.spyOn(
                platform,
                'requestNetflixVttWithTracks'
            );

            await platform.initialize(callbackA, jest.fn());
            const lifecycleARequest = platform.handleInjectorEvents(
                createNetflixSubtitleEvent('12345')
            );
            await Promise.resolve();

            await platform.initialize(callbackB, jest.fn());
            deferredSettings.resolve(RESOLVED_NETFLIX_SETTINGS);
            await lifecycleARequest;

            expect(requestVtt).not.toHaveBeenCalled();
            expect(callbackA).not.toHaveBeenCalled();
            expect(callbackB).not.toHaveBeenCalled();
            expect(platform.pendingVttUrlForVideoId['12345']).toBeUndefined();
        });

        test('clears lifecycle A preloads and keeps its saved listener inert under B', async () => {
            let routeMovieId = '11111';
            platform.extractMovieIdFromUrl.mockImplementation(
                () => routeMovieId
            );
            const requestVtt = jest.spyOn(
                platform,
                'requestNetflixVttWithTracks'
            );

            await platform.initialize(jest.fn(), jest.fn());
            const lifecycleAListener = platform.eventListener;
            const lifecycleAEvent = createNetflixSubtitleEvent('22222');
            lifecycleAEvent.detail.dualsubChannel =
                createNetflixChannelAuthority(
                    extractNetflixCapability(platform.injectionChannel)
                );
            lifecycleAListener(lifecycleAEvent);
            expect(platform.preloadedSubtitleBuffer['22222']).toBeDefined();

            await platform.initialize(jest.fn(), jest.fn());
            routeMovieId = '22222';
            lifecycleAListener(lifecycleAEvent);
            platform.onUrlChange('https://www.netflix.com/watch/22222');
            await flushPromises();

            expect(platform.preloadedSubtitleBuffer['22222']).toBeUndefined();
            expect(requestVtt).not.toHaveBeenCalled();
        });

        test('rejects missing, wrong, old, and predictable authorities before side effects', async () => {
            await flushPromises();
            const authorizedHandler = jest.spyOn(
                platform,
                '_handleAlreadyAuthorizedInjectorData'
            );
            for (const level of ['debug', 'info', 'warn', 'error']) {
                mockLogger[level].mockClear();
            }
            const invalidDetails = [
                { type: 'INJECT_SCRIPT_READY' },
                {
                    type: 'INJECT_SCRIPT_READY',
                    dualsubChannel: createNetflixChannelAuthority(
                        netflixCapability,
                        'disneyplus'
                    ),
                },
                {
                    type: 'INJECT_SCRIPT_READY',
                    dualsubChannel: createNetflixChannelAuthority(
                        'd4'.repeat(32)
                    ),
                },
                {
                    type: 'INJECT_SCRIPT_READY',
                    dualsubChannel: createNetflixChannelAuthority(
                        '0'.repeat(64)
                    ),
                },
            ];

            for (const detail of invalidDetails) {
                platform.handleInjectorEvents({ detail });
            }

            expect(authorizedHandler).not.toHaveBeenCalled();
            for (const level of ['debug', 'info', 'warn', 'error']) {
                expect(mockLogger[level]).not.toHaveBeenCalled();
            }
            expect(chromeApiMock.runtime.sendMessage).not.toHaveBeenCalled();
        });

        test('rejects non-exact and hostile authority records without invoking getters', async () => {
            await flushPromises();
            const authorityGetter = jest.fn(() =>
                createNetflixChannelAuthority()
            );
            const accessorDetail = { type: 'INJECT_SCRIPT_READY' };
            Object.defineProperty(accessorDetail, 'dualsubChannel', {
                enumerable: true,
                get: authorityGetter,
            });
            const inheritedDetail = Object.create({
                dualsubChannel: createNetflixChannelAuthority(),
            });
            Object.defineProperty(inheritedDetail, 'type', {
                enumerable: true,
                value: 'INJECT_SCRIPT_READY',
            });
            const hostileOwnKeys = jest.fn(() => {
                throw new Error('hostile ownKeys');
            });
            const hostileDetail = new Proxy({}, { ownKeys: hostileOwnKeys });
            const extraAuthorityDetail = {
                type: 'INJECT_SCRIPT_READY',
                dualsubChannel: {
                    ...createNetflixChannelAuthority(),
                    extra: true,
                },
            };
            const authorizedHandler = jest.spyOn(
                platform,
                '_handleAlreadyAuthorizedInjectorData'
            );
            for (const level of ['debug', 'info', 'warn', 'error']) {
                mockLogger[level].mockClear();
            }

            for (const detail of [
                accessorDetail,
                inheritedDetail,
                hostileDetail,
                extraAuthorityDetail,
            ]) {
                expect(() =>
                    platform.handleInjectorEvents({ detail })
                ).not.toThrow();
            }

            expect(authorityGetter).not.toHaveBeenCalled();
            expect(hostileOwnKeys).toHaveBeenCalledTimes(1);
            expect(authorizedHandler).not.toHaveBeenCalled();
            for (const level of ['debug', 'info', 'warn', 'error']) {
                expect(mockLogger[level]).not.toHaveBeenCalled();
            }
        });
    });

    describe('Subtitle Data Processing Logging', () => {
        test('should log inject script ready event', () => {
            const mockEvent = {
                detail: {
                    type: 'INJECT_SCRIPT_READY',
                    dualsubChannel: createNetflixChannelAuthority(),
                },
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Inject script is ready'
            );
        });

        test('should log subtitle data received', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    dualsubChannel: createNetflixChannelAuthority(),
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            { language: 'en', downloadables: {} },
                        ],
                    },
                },
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Raw subtitle data received',
                expect.objectContaining({
                    hasPayload: true,
                    trackCount: 1,
                })
            );
        });

        test('should log error for missing movieId', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    dualsubChannel: createNetflixChannelAuthority(),
                    payload: {
                        timedtexttracks: [],
                    },
                },
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'SUBTITLE_DATA_FOUND event missing a valid movieId',
                null,
                expect.objectContaining({
                    hasPayload: true,
                    receivedType: 'undefined',
                })
            );
        });

        test('should log error for missing timedtexttracks', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    dualsubChannel: createNetflixChannelAuthority(),
                    payload: {
                        movieId: '12345',
                    },
                },
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'SUBTITLE_DATA_FOUND event missing timedtexttracks',
                null,
                expect.objectContaining({
                    hasPayload: true,
                })
            );
        });
    });

    describe('Video Context Change Logging', () => {
        test('should log video context change', () => {
            platform.currentVideoId = '11111';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    dualsubChannel: createNetflixChannelAuthority(),
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            {
                                language: 'en',
                                ttDownloadables: {
                                    webvtt: {
                                        urls: [
                                            {
                                                url: 'http://example.com/subtitle.vtt',
                                            },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                },
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Video context changing',
                expect.objectContaining({
                    hadPreviousVideoId: true,
                    hasNewVideoId: true,
                })
            );
        });
    });

    describe('Canonical subtitle request identity', () => {
        test('normalizes the event ID and pins the canonical Netflix source', async () => {
            const sendMessage = jest
                .spyOn(platform, '_sendMessageResilient')
                .mockImplementation((message) =>
                    Promise.resolve(createSuccessfulNetflixResponse(message))
                );
            const event = createNetflixSubtitleEvent(12345);
            event.detail.source = 'page-forged-source';
            event.detail.payload.source = 'page-forged-source';

            await platform.handleInjectorEvents(event);

            expect(platform.currentVideoId).toBe('12345');
            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'fetchVTT',
                    videoId: '12345',
                    source: SubtitleRequestSources.NETFLIX,
                }),
                expect.any(Object)
            );
        });

        test('buffers a valid numeric mismatch but revalidates it before replay', async () => {
            let routeMovieId = '11111';
            platform.extractMovieIdFromUrl.mockImplementation(
                () => routeMovieId
            );
            const sendMessage = jest
                .spyOn(platform, '_sendMessageResilient')
                .mockImplementation((message) =>
                    Promise.resolve(createSuccessfulNetflixResponse(message))
                );

            platform.handleInjectorEvents(createNetflixSubtitleEvent('22222'));

            expect(platform.currentVideoId).toBeNull();
            expect(sendMessage).not.toHaveBeenCalled();
            expect(platform.preloadedSubtitleBuffer['22222']).toEqual(
                expect.any(Array)
            );

            routeMovieId = '22222';
            platform.onUrlChange('https://www.netflix.com/watch/22222');
            await flushPromises();

            expect(platform.currentVideoId).toBe('22222');
            expect(sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    videoId: '22222',
                    source: SubtitleRequestSources.NETFLIX,
                }),
                expect.any(Object)
            );
            expect(platform.preloadedSubtitleBuffer['22222']).toBeUndefined();
        });

        test('rejects a proxied track array whose reported length is not a safe integer', () => {
            let lengthReads = 0;
            const proxiedTracks = new Proxy(
                createNetflixSubtitleEvent('22222').detail.payload
                    .timedtexttracks,
                {
                    get(target, property, receiver) {
                        if (property === 'length') {
                            lengthReads += 1;
                            return '1';
                        }
                        return Reflect.get(target, property, receiver);
                    },
                }
            );
            platform.extractMovieIdFromUrl.mockReturnValue('11111');

            expect(() =>
                platform.handleInjectorEvents({
                    detail: {
                        type: 'SUBTITLE_DATA_FOUND',
                        dualsubChannel: createNetflixChannelAuthority(),
                        payload: {
                            movieId: '22222',
                            timedtexttracks: proxiedTracks,
                        },
                    },
                })
            ).not.toThrow();

            expect(lengthReads).toBe(1);
            expect(platform.preloadedSubtitleBuffer['22222']).toBeUndefined();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Raw subtitle data received',
                { hasPayload: true, trackCount: 0 }
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Netflix SUBTITLE_DATA_FOUND for movieId',
                expect.objectContaining({ trackCount: 0 })
            );
        });

        test('captures a proxied track count once before buffering a preload', () => {
            const repeatedLengthError = Object.assign(
                new Error('NETFLIX_TRACK_LENGTH_MESSAGE_CANARY'),
                {
                    cause: 'NETFLIX_TRACK_LENGTH_CAUSE_CANARY',
                    customSecret: 'NETFLIX_TRACK_LENGTH_CUSTOM_CANARY',
                }
            );
            let lengthReads = 0;
            const proxiedTracks = new Proxy(
                createNetflixSubtitleEvent('22222').detail.payload
                    .timedtexttracks,
                {
                    get(target, property, receiver) {
                        if (property === 'length') {
                            lengthReads += 1;
                            if (lengthReads > 1) throw repeatedLengthError;
                            return 1;
                        }
                        return Reflect.get(target, property, receiver);
                    },
                }
            );
            platform.extractMovieIdFromUrl.mockReturnValue('11111');

            expect(() =>
                platform.handleInjectorEvents({
                    detail: {
                        type: 'SUBTITLE_DATA_FOUND',
                        dualsubChannel: createNetflixChannelAuthority(),
                        payload: {
                            movieId: '22222',
                            timedtexttracks: proxiedTracks,
                        },
                    },
                })
            ).not.toThrow();

            expect(lengthReads).toBe(1);
            expect(platform.preloadedSubtitleBuffer['22222']).toBe(
                proxiedTracks
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Raw subtitle data received',
                { hasPayload: true, trackCount: 1 }
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Buffering preloaded subtitle data for upcoming movieId',
                expect.objectContaining({ trackCount: 1 })
            );
            expectSensitiveValueAbsentFromLogs(
                [
                    ...mockLogger.debug.mock.calls,
                    ...mockLogger.info.mock.calls,
                    ...mockLogger.warn.mock.calls,
                    ...mockLogger.error.mock.calls,
                ],
                repeatedLengthError
            );
        });

        test('contains a proxied track length getter that throws', () => {
            const lengthError = Object.assign(
                new Error('NETFLIX_THROWING_LENGTH_MESSAGE_CANARY'),
                {
                    cause: 'NETFLIX_THROWING_LENGTH_CAUSE_CANARY',
                    customSecret: 'NETFLIX_THROWING_LENGTH_CUSTOM_CANARY',
                }
            );
            let lengthReads = 0;
            const proxiedTracks = new Proxy([], {
                get(target, property, receiver) {
                    if (property === 'length') {
                        lengthReads += 1;
                        throw lengthError;
                    }
                    return Reflect.get(target, property, receiver);
                },
            });
            platform.extractMovieIdFromUrl.mockReturnValue('11111');

            expect(() =>
                platform.handleInjectorEvents({
                    detail: {
                        type: 'SUBTITLE_DATA_FOUND',
                        dualsubChannel: createNetflixChannelAuthority(),
                        payload: {
                            movieId: '22222',
                            timedtexttracks: proxiedTracks,
                        },
                    },
                })
            ).not.toThrow();

            expect(lengthReads).toBe(1);
            expect(platform.preloadedSubtitleBuffer['22222']).toBeUndefined();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Raw subtitle data received',
                { hasPayload: true, trackCount: 0 }
            );
            expectSensitiveValueAbsentFromLogs(
                [
                    ...mockLogger.debug.mock.calls,
                    ...mockLogger.info.mock.calls,
                    ...mockLogger.warn.mock.calls,
                    ...mockLogger.error.mock.calls,
                ],
                lengthError
            );
        });

        test('contains a revoked proxied track array', () => {
            const { proxy: revokedTracks, revoke } = Proxy.revocable([], {});
            revoke();
            platform.extractMovieIdFromUrl.mockReturnValue('11111');

            expect(() =>
                platform.handleInjectorEvents({
                    detail: {
                        type: 'SUBTITLE_DATA_FOUND',
                        dualsubChannel: createNetflixChannelAuthority(),
                        payload: {
                            movieId: '22222',
                            timedtexttracks: revokedTracks,
                        },
                    },
                })
            ).not.toThrow();

            expect(platform.preloadedSubtitleBuffer['22222']).toBeUndefined();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Raw subtitle data received',
                { hasPayload: true, trackCount: 0 }
            );
        });

        test('validates the length of a page-derived filtered track array once', () => {
            let derivedLengthReads = 0;
            const derivedTracks = new Proxy([], {
                get(target, property, receiver) {
                    if (property === 'length') {
                        derivedLengthReads += 1;
                        return '1';
                    }
                    return Reflect.get(target, property, receiver);
                },
            });
            const event = createNetflixSubtitleEvent('12345');
            event.detail.payload.timedtexttracks.filter = jest.fn(
                () => derivedTracks
            );
            const requestVtt = jest.spyOn(
                platform,
                'requestNetflixVttWithTracks'
            );

            expect(() => platform.handleInjectorEvents(event)).not.toThrow();

            expect(derivedLengthReads).toBe(1);
            expect(requestVtt).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Netflix filtered to valid tracks',
                expect.objectContaining({ validTrackCount: 0 })
            );
        });

        test('drops noncanonical mismatches without logging raw identity or URL', () => {
            platform.extractMovieIdFromUrl.mockReturnValue('11111');
            const rawVideoId = 'forged-not-numeric';
            const rawUrl =
                'https://attacker.invalid/raw-netflix-url-secret.vtt';
            const event = createNetflixSubtitleEvent(rawVideoId);
            event.detail.payload.timedtexttracks[0].ttDownloadables.webvtt.urls[0].url =
                rawUrl;
            const requestVtt = jest.spyOn(
                platform,
                'requestNetflixVttWithTracks'
            );

            platform.handleInjectorEvents(event);

            expect(platform.currentVideoId).toBeNull();
            expect(requestVtt).not.toHaveBeenCalled();
            expect(Object.keys(platform.preloadedSubtitleBuffer)).toEqual([]);
            const serializedLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedLogs).not.toContain(rawVideoId);
            expect(serializedLogs).not.toContain(rawUrl);
        });

        test('does not invoke accessor-backed payload identity fields', () => {
            const movieIdGetter = jest.fn(() => '12345');
            const payload = {
                timedtexttracks:
                    createNetflixSubtitleEvent('12345').detail.payload
                        .timedtexttracks,
            };
            Object.defineProperty(payload, 'movieId', {
                get: movieIdGetter,
            });
            const requestVtt = jest.spyOn(
                platform,
                'requestNetflixVttWithTracks'
            );

            platform.handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    dualsubChannel: createNetflixChannelAuthority(),
                    payload,
                },
            });

            expect(movieIdGetter).not.toHaveBeenCalled();
            expect(requestVtt).not.toHaveBeenCalled();
            expect(platform.currentVideoId).toBeNull();
        });
    });

    describe('URL Extraction Logging', () => {
        test('should log successful movieId extraction', () => {
            // Test the mocked behavior - the mock returns '12345'
            const movieId = platform.extractMovieIdFromUrl();
            expect(movieId).toBe('12345');

            // Since this is a logging integration test, we focus on the fact that
            // the method is called and returns the expected value
            expect(platform.extractMovieIdFromUrl).toHaveBeenCalled();
        });

        test('should log warning for invalid URL format', () => {
            // Mock the method to return null (simulating invalid URL)
            platform.extractMovieIdFromUrl.mockReturnValue(null);

            const movieId = platform.extractMovieIdFromUrl();
            expect(movieId).toBeNull();
            expect(platform.extractMovieIdFromUrl).toHaveBeenCalled();
        });

        test('models URL extraction failure telemetry without raw errors', () => {
            const extractionError = Object.assign(
                new Error('URL_EXTRACTION_MESSAGE_CANARY'),
                {
                    cause: 'URL_EXTRACTION_CAUSE_CANARY',
                    customSecret: 'URL_EXTRACTION_CUSTOM_CANARY',
                }
            );
            platform.extractMovieIdFromUrl.mockImplementation(() => {
                mockLogger.error('Error extracting movieId from URL', {
                    extractionSucceeded: false,
                });
                return null;
            });

            const movieId = platform.extractMovieIdFromUrl();
            expect(movieId).toBeNull();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error extracting movieId from URL',
                { extractionSucceeded: false }
            );
            expectSensitiveValueAbsentFromLogs(
                mockLogger.error.mock.calls,
                extractionError
            );
        });
    });

    describe('Playback controls', () => {
        beforeEach(() => {
            document.body.replaceChildren();
        });

        afterEach(() => {
            document.body.replaceChildren();
        });

        test('treats ended media as not playing', () => {
            const endedVideo = createPlaybackVideo({
                paused: false,
                ended: true,
            });
            document.body.appendChild(endedVideo.video);

            expect(platform.isPlaying()).toBe(false);

            endedVideo.video.remove();
            expect(platform.isPlaying()).toBeNull();
        });

        test('returns false when no video exists', async () => {
            document.body.replaceChildren();

            await expect(platform.pausePlayback()).resolves.toBe(false);
            await expect(platform.resumePlayback()).resolves.toBe(false);
        });

        test('verifies that pause and resume actions changed media state', async () => {
            const playingVideo = createPlaybackVideo({ paused: false });
            Object.defineProperty(playingVideo.video, 'pause', {
                configurable: true,
                value: jest.fn(),
            });
            document.body.appendChild(playingVideo.video);

            await expect(platform.pausePlayback()).resolves.toBe(false);

            playingVideo.video.remove();
            const pausedVideo = createPlaybackVideo({ paused: true });
            Object.defineProperty(pausedVideo.video, 'play', {
                configurable: true,
                value: jest.fn().mockResolvedValue(undefined),
            });
            document.body.appendChild(pausedVideo.video);

            await expect(platform.resumePlayback()).resolves.toBe(false);
        });

        test('returns true only after reaching the requested media state', async () => {
            const video = createPlaybackVideo({ paused: false });
            document.body.appendChild(video.video);

            await expect(platform.pausePlayback()).resolves.toBe(true);
            expect(video.video.pause).toHaveBeenCalledTimes(1);

            await expect(platform.resumePlayback()).resolves.toBe(true);
            expect(video.video.play).toHaveBeenCalledTimes(1);
        });

        test('verifies the current video after a pause action replaces it', async () => {
            const original = createPlaybackVideo({ paused: false });
            const replacement = createPlaybackVideo({ paused: false });
            Object.defineProperty(original.video, 'pause', {
                configurable: true,
                value: jest.fn(() => {
                    original.state.paused = true;
                    original.video.replaceWith(replacement.video);
                }),
            });
            document.body.appendChild(original.video);

            await expect(platform.pausePlayback()).resolves.toBe(false);
            expect(platform.getVideoElement()).toBe(replacement.video);
        });
    });

    describe('Background Communication Logging', () => {
        test('projects a current Netflix response into the exact privacy-safe callback payload', async () => {
            const signedUrlCanary =
                'https://captions.nflxvideo.net/private/en.ttml?token=NETFLIX_CALLBACK_SECRET';
            const sourceLanguageCanary =
                'https://language.example/source?token=NETFLIX_SOURCE_LANGUAGE_SECRET';
            const targetLanguageCanary =
                'https://language.example/target?token=NETFLIX_TARGET_LANGUAGE_SECRET';
            const selectedCodeCanary =
                'https://language.example/selected?token=NETFLIX_SELECTED_CODE_SECRET';
            const selectedNameCanary =
                'https://language.example/display?token=NETFLIX_SELECTED_NAME_SECRET';
            const response = {
                success: true,
                vttText: 'WEBVTT original',
                targetVttText: 'WEBVTT target',
                videoId: '12345',
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
                        displayName: 'English CC',
                        uri: signedUrlCanary,
                        downloadUrl: signedUrlCanary,
                    },
                ],
                targetLanguageInfo: { uri: signedUrlCanary },
                processingTime: 28,
                futureResponseSecret: signedUrlCanary,
            };
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            jest.spyOn(
                platform,
                'requestNetflixVttWithTracks'
            ).mockResolvedValue(response);
            platform.extractMovieIdFromUrl.mockReturnValue('12345');

            await platform.handleInjectorEvents(
                createNetflixSubtitleEvent('12345')
            );

            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith({
                vttText: 'WEBVTT original',
                targetVttText: 'WEBVTT target',
                videoId: '12345',
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
                'NETFLIX_CALLBACK_SECRET'
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

        test('keeps configured language values out of telemetry while preserving the request contract', async () => {
            const targetLanguageCanary =
                'https://config.example/target?token=NETFLIX_CONFIG_TARGET_SECRET';
            const originalLanguageCanary =
                'https://config.example/original?token=NETFLIX_CONFIG_ORIGINAL_SECRET';
            configService.getMultiple.mockResolvedValueOnce({
                targetLanguage: targetLanguageCanary,
                originalLanguage: originalLanguageCanary,
                useNativeSubtitles: true,
                useOfficialTranslations: true,
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(
                    createSuccessfulNetflixResponse({
                        videoId: '12345',
                        data: { tracks: [{ episodeId: '12345' }] },
                    })
                );

            await platform.handleInjectorEvents(
                createNetflixSubtitleEvent('12345')
            );

            expect(requestVtt).toHaveBeenCalledWith(
                expect.any(Array),
                targetLanguageCanary,
                originalLanguageCanary,
                true,
                '12345',
                expect.any(Function)
            );
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            const serializedLogs = JSON.stringify({
                debug: mockLogger.debug.mock.calls,
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedLogs).not.toContain(targetLanguageCanary);
            expect(serializedLogs).not.toContain(originalLanguageCanary);
        });

        test('does not reflect arbitrary configured flag objects into telemetry', async () => {
            const nativeFlag = {
                customSecret: 'NETFLIX_NATIVE_FLAG_OBJECT_CANARY',
            };
            const officialFlag = {
                customSecret: 'NETFLIX_OFFICIAL_FLAG_OBJECT_CANARY',
            };
            configService.getMultiple.mockResolvedValueOnce({
                targetLanguage: 'zh-CN',
                originalLanguage: 'en',
                useNativeSubtitles: nativeFlag,
                useOfficialTranslations: officialFlag,
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(
                    createSuccessfulNetflixResponse({
                        videoId: '12345',
                        data: { tracks: [{ episodeId: '12345' }] },
                    })
                );

            await platform.handleInjectorEvents(
                createNetflixSubtitleEvent('12345')
            );

            expect(requestVtt).toHaveBeenCalledWith(
                expect.any(Array),
                'zh-CN',
                'en',
                officialFlag,
                '12345',
                expect.any(Function)
            );
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            const logCalls = [
                ...mockLogger.debug.mock.calls,
                ...mockLogger.info.mock.calls,
                ...mockLogger.warn.mock.calls,
                ...mockLogger.error.mock.calls,
            ];
            expect(containsObjectIdentity(logCalls, nativeFlag)).toBe(false);
            expect(containsObjectIdentity(logCalls, officialFlag)).toBe(false);
            const serializedLogs = JSON.stringify(logCalls);
            expect(serializedLogs).not.toContain(nativeFlag.customSecret);
            expect(serializedLogs).not.toContain(officialFlag.customSecret);
        });

        test('retries the same Netflix subtitle after a delivery callback throws', async () => {
            const videoId = '33333';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
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
            platform.extractMovieIdFromUrl.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

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

        test('retries Netflix delivery when the live route changes inside the callback', async () => {
            const videoId = '44444';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
            let liveRouteVideoId = videoId;
            platform.extractMovieIdFromUrl.mockImplementation(
                () => liveRouteVideoId
            );
            const onSubtitleFound = jest.fn().mockImplementationOnce(() => {
                liveRouteVideoId = '55555';
            });
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

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

        test('coalesces a synchronous Netflix replay during subtitle delivery', async () => {
            const videoId = '66666';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
            platform.extractMovieIdFromUrl.mockReturnValue(videoId);
            const onSubtitleFound = jest.fn(() => {
                platform.handleInjectorEvents(event);
            });
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

            await platform.handleInjectorEvents(event);
            await flushPromises();

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
        });

        test('retries Netflix delivery after a missing callback is installed', async () => {
            const videoId = '77777';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
            platform.extractMovieIdFromUrl.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

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

        test('commits Netflix delivery when success telemetry throws', async () => {
            const videoId = '88888';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
            mockLogger.info.mockImplementation((message) => {
                if (message === 'Netflix VTT processed successfully') {
                    throw new Error('SUCCESS_LOGGER_CANARY');
                }
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractMovieIdFromUrl.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        test('delivers Netflix subtitles when request telemetry throws after ownership is claimed', async () => {
            const videoId = '99999';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
            mockLogger.info.mockImplementation((message) => {
                if (message === 'Requesting VTT processing from background') {
                    throw new Error('REQUEST_LOGGER_CANARY');
                }
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractMovieIdFromUrl.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

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

        test('delivers Netflix subtitles when mode telemetry throws after ownership is claimed', async () => {
            const videoId = '90909';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
            mockLogger.info.mockImplementation((message) => {
                if (message === 'Netflix subtitle processing mode determined') {
                    throw new Error('MODE_LOGGER_CANARY');
                }
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractMovieIdFromUrl.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

            await expect(platform.handleInjectorEvents(event)).resolves.toBe(
                undefined
            );

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId[videoId]).toBe(url);
            expect(platform.pendingVttUrlForVideoId[videoId]).toBeUndefined();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        test('delivers Netflix subtitles when page-event telemetry throws before ownership is claimed', async () => {
            const videoId = '91919';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
            mockLogger.debug.mockImplementation((message) => {
                if (message === 'Raw subtitle data received') {
                    throw new Error('PAGE_EVENT_LOGGER_CANARY');
                }
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractMovieIdFromUrl.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

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

        test('retries Netflix delivery after settings resolution throws synchronously', async () => {
            const videoId = '10101';
            const url = `https://example.com/${videoId}.vtt`;
            const event = createNetflixSubtitleEvent(videoId);
            const response = createSuccessfulNetflixResponse({
                videoId,
                data: { tracks: [{ episodeId: videoId }] },
            });
            const settingsError = new Error('SYNC_SETTINGS_FAILURE');
            configService.getMultiple
                .mockImplementationOnce(() => {
                    throw settingsError;
                })
                .mockResolvedValueOnce(RESOLVED_NETFLIX_SETTINGS);
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            platform.extractMovieIdFromUrl.mockReturnValue(videoId);
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue(response);

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

        test('does not send deferred episode A subtitles after SPA navigation to episode B', async () => {
            const episodeASettings = createDeferred();
            const episodeBSettings = createDeferred();
            configService.getMultiple
                .mockImplementationOnce(() => episodeASettings.promise)
                .mockImplementationOnce(() => episodeBSettings.promise);

            let urlMovieId = '11111';
            platform.extractMovieIdFromUrl.mockImplementation(() => urlMovieId);

            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());

            const sentMessages = [];
            chromeApiMock.runtime.sendMessage.mockImplementation((message) => {
                sentMessages.push(message);
                return Promise.resolve(
                    createSuccessfulNetflixResponse(message)
                );
            });

            platform.handleInjectorEvents(createNetflixSubtitleEvent('11111'));
            // Netflix commonly preloads the next episode before the URL changes.
            platform.handleInjectorEvents(createNetflixSubtitleEvent('22222'));
            urlMovieId = '22222';
            platform.onUrlChange('https://www.netflix.com/watch/22222');

            episodeASettings.resolve(RESOLVED_NETFLIX_SETTINGS);
            await flushPromises();

            expect(sentMessages).toHaveLength(0);
            expect(onSubtitleFound).not.toHaveBeenCalled();
            expect(platform.pendingVttUrlForVideoId['11111']).toBeUndefined();
            expect(platform.lastKnownVttUrlForVideoId['11111']).toBeUndefined();

            episodeBSettings.resolve(RESOLVED_NETFLIX_SETTINGS);
            await flushPromises();

            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0]).toEqual(
                expect.objectContaining({
                    videoId: '22222',
                    data: expect.objectContaining({
                        tracks: expect.arrayContaining([
                            expect.objectContaining({
                                episodeId: '22222',
                            }),
                        ]),
                    }),
                })
            );
            expect(JSON.stringify(sentMessages)).not.toContain(
                netflixCapability
            );
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith(
                expect.objectContaining({
                    videoId: '22222',
                    vttText: expect.stringContaining('22222'),
                })
            );
            const serializedLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedLogs).not.toContain('11111');
            expect(serializedLogs).not.toContain(
                'https://example.com/11111.vtt'
            );
            expect(serializedLogs).not.toContain(netflixCapability);
        });

        test('releases a deferred-settings request after player-to-player navigation so it can retry', async () => {
            const deferredSettings = createDeferred();
            configService.getMultiple
                .mockImplementationOnce(() => deferredSettings.promise)
                .mockResolvedValue(RESOLVED_NETFLIX_SETTINGS);
            let routeMovieId = '11111';
            platform.extractMovieIdFromUrl.mockImplementation(
                () => routeMovieId
            );
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockResolvedValue({
                    success: true,
                    videoId: '11111',
                    vttText: 'WEBVTT A',
                    targetVttText: null,
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN',
                    useNativeTarget: false,
                    selectedLanguage: {
                        normalizedCode: 'en',
                        displayName: 'English',
                    },
                });
            const event = createNetflixSubtitleEvent('11111');

            const staleAttempt = platform.handleInjectorEvents(event);
            expect(platform.pendingVttUrlForVideoId['11111']).toBeDefined();

            routeMovieId = '22222';
            deferredSettings.resolve(RESOLVED_NETFLIX_SETTINGS);
            await staleAttempt;

            expect(requestVtt).not.toHaveBeenCalled();
            expect(onSubtitleFound).not.toHaveBeenCalled();
            expect(platform.pendingVttUrlForVideoId['11111']).toBeUndefined();
            expect(platform.lastKnownVttUrlForVideoId['11111']).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId['22222']).toBeUndefined();

            const serializedStaleLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedStaleLogs).not.toContain('11111');
            expect(serializedStaleLogs).not.toContain(
                'https://example.com/11111.vtt'
            );

            routeMovieId = '11111';
            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
        });

        test('blocks dispatch when the route changes at the dynamic messaging boundary and permits the new route', async () => {
            let routeMovieId = '11111';
            platform.extractMovieIdFromUrl.mockImplementation(
                () => routeMovieId
            );
            const originalGetUrl =
                chromeApiMock.runtime.getURL.getMockImplementation();
            let flipRouteAtImport = true;
            chromeApiMock.runtime.getURL.mockImplementation((path) => {
                if (flipRouteAtImport) {
                    routeMovieId = '22222';
                }
                return originalGetUrl(path);
            });

            const sentMessages = [];
            chromeApiMock.runtime.sendMessage.mockImplementation((message) => {
                sentMessages.push(message);
                return Promise.resolve(
                    createSuccessfulNetflixResponse(message)
                );
            });
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const staleEvent = createNetflixSubtitleEvent('11111');

            await platform.handleInjectorEvents(staleEvent);

            expect(sentMessages).toHaveLength(0);
            expect(onSubtitleFound).not.toHaveBeenCalled();
            expect(platform.pendingVttUrlForVideoId['11111']).toBeUndefined();
            expect(platform.lastKnownVttUrlForVideoId['11111']).toBeUndefined();

            const serializedStaleLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedStaleLogs).not.toContain('11111');
            expect(serializedStaleLogs).not.toContain(
                staleEvent.detail.payload.timedtexttracks[0].ttDownloadables
                    .webvtt.urls[0].url
            );

            flipRouteAtImport = false;
            await platform.handleInjectorEvents(
                createNetflixSubtitleEvent('22222')
            );

            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0]).toEqual(
                expect.objectContaining({ videoId: '22222' })
            );
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith(
                expect.objectContaining({ videoId: '22222' })
            );
        });

        test('drops a deferred response after player-to-player navigation without corrupting request state', async () => {
            const deferredResponse = createDeferred();
            let routeMovieId = '11111';
            platform.extractMovieIdFromUrl.mockImplementation(
                () => routeMovieId
            );
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            const requestVtt = jest
                .spyOn(platform, 'requestNetflixVttWithTracks')
                .mockImplementationOnce(() => deferredResponse.promise)
                .mockResolvedValueOnce({
                    success: true,
                    videoId: '11111',
                    vttText: 'WEBVTT retry',
                    targetVttText: null,
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN',
                    useNativeTarget: false,
                    selectedLanguage: {
                        normalizedCode: 'en',
                        displayName: 'English',
                    },
                });
            const event = createNetflixSubtitleEvent('11111');

            const staleAttempt = platform.handleInjectorEvents(event);
            await flushPromises();
            expect(requestVtt).toHaveBeenCalledTimes(1);

            routeMovieId = '22222';
            deferredResponse.resolve({
                success: true,
                videoId: '11111',
                vttText: 'WEBVTT stale',
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                url: 'https://example.com/11111.vtt',
            });
            await staleAttempt;

            expect(onSubtitleFound).not.toHaveBeenCalled();
            expect(platform.lastKnownVttUrlForVideoId['11111']).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId['11111']).toBeUndefined();
            expect(platform.lastKnownVttUrlForVideoId['22222']).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId['22222']).toBeUndefined();

            const serializedStaleLogs = JSON.stringify({
                info: mockLogger.info.mock.calls,
                warn: mockLogger.warn.mock.calls,
                error: mockLogger.error.mock.calls,
            });
            expect(serializedStaleLogs).not.toContain('11111');
            expect(serializedStaleLogs).not.toContain(
                'https://example.com/11111.vtt'
            );

            routeMovieId = '11111';
            await platform.handleInjectorEvents(event);

            expect(requestVtt).toHaveBeenCalledTimes(2);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(platform.lastKnownVttUrlForVideoId['11111']).toBe(
                'https://example.com/11111.vtt'
            );
        });

        test('retries the same subtitle event after settings resolution fails', async () => {
            const settingsError = Object.assign(
                new Error('NETFLIX_SETTINGS_MESSAGE_CANARY'),
                {
                    cause: 'NETFLIX_SETTINGS_CAUSE_CANARY',
                    customSecret: 'NETFLIX_SETTINGS_CUSTOM_CANARY',
                }
            );
            configService.getMultiple
                .mockRejectedValueOnce(settingsError)
                .mockResolvedValueOnce(RESOLVED_NETFLIX_SETTINGS);

            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());
            chromeApiMock.runtime.sendMessage.mockImplementation((message) =>
                Promise.resolve(createSuccessfulNetflixResponse(message))
            );
            const subtitleEvent = createNetflixSubtitleEvent('12345');

            await platform.handleInjectorEvents(subtitleEvent);
            expect(platform.lastKnownVttUrlForVideoId['12345']).toBeUndefined();
            expect(platform.pendingVttUrlForVideoId['12345']).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to resolve subtitle request settings',
                null,
                { hasVideoId: true, trackCount: 1 }
            );
            expectSensitiveValueAbsentFromLogs(
                [
                    ...mockLogger.debug.mock.calls,
                    ...mockLogger.info.mock.calls,
                    ...mockLogger.warn.mock.calls,
                    ...mockLogger.error.mock.calls,
                ],
                settingsError
            );

            await platform.handleInjectorEvents(subtitleEvent);

            expect(configService.getMultiple).toHaveBeenCalledTimes(2);
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith(
                expect.objectContaining({ videoId: '12345' })
            );
        });

        test('does not let a stale episode A failure clear episode B request state', async () => {
            const episodeAResponse = createDeferred();
            const episodeBResponse = createDeferred();
            const responseByEpisode = new Map([
                ['11111', episodeAResponse],
                ['22222', episodeBResponse],
            ]);
            const sentMessages = [];
            chromeApiMock.runtime.sendMessage.mockImplementation((message) => {
                sentMessages.push(message);
                return responseByEpisode.get(message.data.tracks[0].episodeId)
                    .promise;
            });

            let urlMovieId = '11111';
            platform.extractMovieIdFromUrl.mockImplementation(() => urlMovieId);
            const onSubtitleFound = jest.fn();
            platform.setCallbacks(onSubtitleFound, jest.fn());

            const episodeAAttempt = platform.handleInjectorEvents(
                createNetflixSubtitleEvent('11111')
            );
            await flushPromises();

            platform.handleInjectorEvents(createNetflixSubtitleEvent('22222'));
            urlMovieId = '22222';
            platform.onUrlChange('https://www.netflix.com/watch/22222');
            await flushPromises();
            expect(sentMessages).toHaveLength(2);

            episodeAResponse.resolve({
                success: false,
                videoId: '11111',
                error: 'Episode A failed',
            });
            await episodeAAttempt;

            platform.handleInjectorEvents(createNetflixSubtitleEvent('22222'));
            await flushPromises();
            expect(sentMessages).toHaveLength(2);

            episodeBResponse.resolve(
                createSuccessfulNetflixResponse(sentMessages[1])
            );
            await flushPromises();
            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith(
                expect.objectContaining({ videoId: '22222' })
            );
        });

        test('should log VTT processing request', () => {
            chromeApiMock.storage.sync.get.mockImplementation(
                (keys, callback) => {
                    callback({
                        targetLanguage: 'zh-CN',
                        originalLanguage: 'en',
                        useNativeSubtitles: true,
                    });
                }
            );

            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: true,
                        videoId: '12345',
                        vttText:
                            'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nTest subtitle',
                    });
                }
            );

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    dualsubChannel: createNetflixChannelAuthority(),
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            {
                                language: 'en',
                                ttDownloadables: {
                                    webvtt: {
                                        urls: [
                                            {
                                                url: 'http://example.com/subtitle.vtt',
                                            },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                },
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Requesting VTT processing from background',
                expect.objectContaining({
                    trackCount: 1,
                })
            );
        });

        test('should log successful VTT processing', async () => {
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback(createSuccessfulNetflixResponse(message));
                }
            );

            platform.currentVideoId = '12345';
            platform.setCallbacks(jest.fn(), jest.fn());

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    dualsubChannel: createNetflixChannelAuthority(),
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            {
                                language: 'en',
                                ttDownloadables: {
                                    webvtt: {
                                        urls: [
                                            {
                                                url: 'http://example.com/subtitle.vtt',
                                            },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                },
            };

            platform.handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Netflix VTT processed successfully',
                expect.objectContaining({
                    hasVideoId: true,
                    hasSourceLanguage: true,
                    hasTargetLanguage: true,
                })
            );
        });

        test('should log background processing errors', async () => {
            const backgroundErrorCanary =
                'https://errors.example/netflix?token=NETFLIX_BACKGROUND_ERROR_SECRET';
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: false,
                        error: backgroundErrorCanary,
                    });
                }
            );

            platform.currentVideoId = '12345';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    dualsubChannel: createNetflixChannelAuthority(),
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            {
                                language: 'en',
                                ttDownloadables: {
                                    webvtt: {
                                        urls: [
                                            {
                                                url: 'http://example.com/subtitle.vtt',
                                            },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                },
            };

            platform.handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Netflix background failed to process VTT',
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

        test.each([
            [
                'No downloadable subtitle tracks',
                'Netflix official subtitles not available for this content',
            ],
            [
                'No suitable Netflix subtitle language',
                'Netflix requested languages not found in available tracks',
            ],
        ])(
            'does not branch on obsolete background error detail %s',
            async (error, obsoleteWarning) => {
                chromeApiMock.runtime.sendMessage.mockImplementation(
                    (_message, callback) => {
                        callback({
                            success: false,
                            error,
                            videoId: '12345',
                        });
                    }
                );
                platform.currentVideoId = '12345';

                await platform.handleInjectorEvents(
                    createNetflixSubtitleEvent('12345')
                );

                expect(
                    mockLogger.warn.mock.calls.map(([message]) => message)
                ).not.toContain(obsoleteWarning);
            }
        );
    });

    describe('Subtitle CSS logging privacy', () => {
        test('does not expose DOM insertion failures to telemetry', () => {
            const cssError = Object.assign(
                new Error('NETFLIX_CSS_MESSAGE_CANARY'),
                {
                    cause: 'NETFLIX_CSS_CAUSE_CANARY',
                    customSecret: 'NETFLIX_CSS_CUSTOM_CANARY',
                }
            );
            const appendChild = jest
                .spyOn(document.head, 'appendChild')
                .mockImplementationOnce(() => {
                    throw cssError;
                });

            try {
                platform.addNetflixSubtitleCSS();

                expect(mockLogger.error).toHaveBeenCalledWith(
                    '[NetflixPlatform] Failed to inject CSS'
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
        test('observes the Netflix player root instead of the document body', () => {
            const OriginalMutationObserver = global.MutationObserver;
            const playerRoot = mountNetflixPlayerRoot();
            const observe = jest.fn();
            try {
                global.MutationObserver = jest.fn(() => ({
                    observe,
                    disconnect: jest.fn(),
                }));

                platform.setupSubtitleMutationObserver();

                expect(observe).toHaveBeenCalledWith(playerRoot, {
                    childList: true,
                    subtree: true,
                });
                expect(observe).not.toHaveBeenCalledWith(
                    document.body,
                    expect.anything()
                );
            } finally {
                playerRoot.remove();
                global.MutationObserver = OriginalMutationObserver;
            }
        });

        test('stops retrying after the finite player-root discovery budget', async () => {
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

        test('stops retrying after the finite observer-construction budget', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const playerRoot = mountNetflixPlayerRoot();
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
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('stops retrying after the finite observer-attachment budget', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const playerRoot = mountNetflixPlayerRoot();
            const disconnect = jest.fn();
            try {
                global.MutationObserver = jest.fn(() => ({
                    observe: jest.fn(() => {
                        throw new Error('observer attachment failed');
                    }),
                    disconnect,
                }));

                platform.setupSubtitleMutationObserver();
                await jest.advanceTimersByTimeAsync(5000);

                expect(global.MutationObserver).toHaveBeenCalledTimes(20);
                expect(disconnect).toHaveBeenCalledTimes(20);
                expect(jest.getTimerCount()).toBe(0);
            } finally {
                playerRoot.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('cancels a pending player-root retry during cleanup', async () => {
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

        test('ignores a stale retry callback after a new observer lifecycle starts', () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const playerRoot = mountNetflixPlayerRoot();
            const timeoutSpy = jest.spyOn(global, 'setTimeout');
            try {
                const getPlayerRoot = jest
                    .spyOn(platform, 'getPlayerContainerElement')
                    .mockReturnValueOnce(null)
                    .mockReturnValue(playerRoot);
                global.MutationObserver = jest.fn(() => ({
                    observe: jest.fn(),
                    disconnect: jest.fn(),
                }));

                platform.setupSubtitleMutationObserver();
                const staleRetryCallback = timeoutSpy.mock.calls[0][0];

                platform.setupSubtitleMutationObserver();
                const currentObserver = platform.subtitleObserver;
                expect(getPlayerRoot).toHaveBeenCalledTimes(2);
                expect(jest.getTimerCount()).toBe(0);

                staleRetryCallback();

                expect(getPlayerRoot).toHaveBeenCalledTimes(2);
                expect(platform.subtitleObserver).toBe(currentObserver);
            } finally {
                timeoutSpy.mockRestore();
                playerRoot.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('coalesces matching subtitle mutations into one owned reapply task', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const playerRoot = mountNetflixPlayerRoot();
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
                        className: 'player-timedtext-text-container',
                    })
                );

                platform.setupSubtitleMutationObserver();
                observerCallback([
                    ...createNetflixSubtitleMutation(),
                    {
                        type: 'childList',
                        addedNodes: [nestedSubtitle],
                    },
                ]);
                observerCallback(createNetflixSubtitleMutation());

                expect(jest.getTimerCount()).toBe(1);
                expect(platform.ownedTimeouts.size).toBe(1);

                await jest.advanceTimersByTimeAsync(100);

                expect(applySetting).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);
                expect(platform.ownedTimeouts.size).toBe(0);
            } finally {
                playerRoot.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('cancels a pending observer setup retry after an exception', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const playerRoot = mountNetflixPlayerRoot();
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
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('cancels reapply work on cleanup and supports a fresh observer lifecycle', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            const observerCallbacks = [];
            const observerRecords = [];
            let playerRoot = mountNetflixPlayerRoot();
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
                observerCallbacks[0](createNetflixSubtitleMutation());
                expect(jest.getTimerCount()).toBe(1);
                expect(platform.ownedTimeouts.size).toBe(1);

                playerRoot.remove();
                playerRoot = mountNetflixPlayerRoot();
                platform.setupSubtitleMutationObserver();
                expect(jest.getTimerCount()).toBe(0);
                expect(platform.ownedTimeouts.size).toBe(0);
                expect(observerRecords[0].disconnect).toHaveBeenCalledTimes(1);
                expect(observerRecords[1].observe).toHaveBeenCalledWith(
                    playerRoot,
                    { childList: true, subtree: true }
                );

                observerCallbacks[0](createNetflixSubtitleMutation());
                expect(jest.getTimerCount()).toBe(0);
                observerCallbacks[1](createNetflixSubtitleMutation());
                expect(jest.getTimerCount()).toBe(1);
                expect(platform.ownedTimeouts.size).toBe(1);

                platform.cleanup();
                expect(jest.getTimerCount()).toBe(0);
                expect(platform.ownedTimeouts.size).toBe(0);

                observerCallbacks[1](createNetflixSubtitleMutation());
                expect(jest.getTimerCount()).toBe(0);
                await jest.advanceTimersByTimeAsync(100);
                expect(applySetting).not.toHaveBeenCalled();

                platform.setupSubtitleMutationObserver();
                observerCallbacks[2](createNetflixSubtitleMutation());
                await jest.advanceTimersByTimeAsync(100);

                expect(applySetting).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);
                expect(platform.ownedTimeouts.size).toBe(0);
            } finally {
                playerRoot.remove();
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });

        test('does not finish an asynchronous reapply after cleanup', async () => {
            jest.useFakeTimers();
            const OriginalMutationObserver = global.MutationObserver;
            let observerCallback;
            const playerRoot = mountNetflixPlayerRoot();
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
                observerCallback(createNetflixSubtitleMutation());
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
                global.MutationObserver = OriginalMutationObserver;
                jest.useRealTimers();
            }
        });
    });

    describe('Cleanup Logging', () => {
        test('restores owned official subtitle DOM effects on terminal cleanup', () => {
            const subtitle = document.createElement('div');
            subtitle.className = 'player-timedtext';
            document.body.appendChild(subtitle);
            platform.hideOfficialSubtitleContainers(['.player-timedtext']);

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
            platform.currentVideoId = '12345';
            platform.onSubtitleUrlFoundCallback = jest.fn();
            platform.onVideoIdChangeCallback = jest.fn();
            platform.storageListener = jest.fn();
            platform.subtitleSelectors = ['.subtitle'];
            platform.unsubscribeFromChanges = jest.fn();
            platform.pendingVttUrlForVideoId['12345'] = {
                url: 'https://example.com/cleanup.vtt',
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
            expect(platform.pendingVttUrlForVideoId['12345']).toBeUndefined();
        });
    });
});
