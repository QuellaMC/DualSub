import { jest } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
import { BackgroundServiceReadiness } from '../serviceReadiness.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import {
    authorizeSubtitleRequest,
    isAuthorizedSubtitleRequestSnapshot,
} from '../utils/subtitleRequestPolicy.js';

const TEST_EXTENSION_ID = 'dualsub-handler-policy-test';
const DISNEY_PAGE_URL = 'https://www.disneyplus.com/video/episode-123';
const DISNEY_SUBTITLE_URL =
    'https://captions.media.dssott.com/show/master.m3u8';
const NETFLIX_PAGE_URL = 'https://www.netflix.com/watch/80123456';
const NETFLIX_SUBTITLE_URL = 'https://captions.nflxvideo.net/show/en.ttml';

function createChromeHarness() {
    const listeners = [];
    globalThis.chrome = {
        runtime: {
            id: TEST_EXTENSION_ID,
            onMessage: {
                addListener: jest.fn((listener) => listeners.push(listener)),
                removeListener: jest.fn(),
            },
        },
    };
    return listeners;
}

function createDisneyMessage(overrides = {}) {
    return {
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.DISNEY_PLUS,
        url: DISNEY_SUBTITLE_URL,
        videoId: 'episode-123',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        ...overrides,
    };
}

function createDisneySender(overrides = {}) {
    return {
        id: TEST_EXTENSION_ID,
        tab: { id: 17, url: DISNEY_PAGE_URL },
        frameId: 0,
        url: DISNEY_PAGE_URL,
        origin: new URL(DISNEY_PAGE_URL).origin,
        ...overrides,
    };
}

function createDisneyServiceResult() {
    return {
        vttText: 'WEBVTT',
        targetVttText: null,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeTarget: false,
        availableLanguages: [],
        selectedLanguage: 'en',
        targetLanguageInfo: null,
    };
}

function createNetflixServiceResult(overrides = {}) {
    return {
        vttText: 'WEBVTT',
        targetVttText: null,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeTarget: false,
        availableLanguages: [{ normalizedCode: 'en', displayName: 'English' }],
        ...overrides,
    };
}

function createNetflixTrack({
    language = 'en',
    displayName = 'English',
    trackType = 'PRIMARY',
    format = 'dfxp',
    url = NETFLIX_SUBTITLE_URL,
} = {}) {
    const track = {
        language,
        displayName,
        isNoneTrack: false,
        isForcedNarrative: false,
        ttDownloadables: {
            [format]: { urls: [{ url }] },
        },
    };
    if (trackType !== null) track.trackType = trackType;
    return track;
}

function createNetflixMessage(overrides = {}) {
    return {
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.NETFLIX,
        data: { tracks: [createNetflixTrack()] },
        videoId: '80123456',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useNativeSubtitles: true,
        useOfficialTranslations: false,
        ...overrides,
    };
}

function createNetflixSender(overrides = {}) {
    return {
        id: TEST_EXTENSION_ID,
        tab: { id: 23, url: NETFLIX_PAGE_URL },
        frameId: 0,
        url: NETFLIX_PAGE_URL,
        origin: new URL(NETFLIX_PAGE_URL).origin,
        ...overrides,
    };
}

async function flushAsyncHandling() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function expectNoRawMarker(value, seen = new Set()) {
    if (typeof value === 'string') {
        expect(value).not.toContain('RAW_MARKER');
        return;
    }
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        expect(Object.hasOwn(descriptor, 'value')).toBe(true);
        expectNoRawMarker(descriptor.value, seen);
    }
}

describe('MessageHandler subtitle request policy ingress', () => {
    test('authorizes a cold-start Disney request before retaining it for readiness', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(createDisneyServiceResult()),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const message = createDisneyMessage();
        const sender = createDisneySender();
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](message, sender, sendResponse);

        expect(keepsChannelOpen).toBe(true);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();

        message.url =
            'https://captions.media.dssott.com/show/mutated.m3u8?marker=RAW_MARKER';
        sender.url = 'https://attacker.example/RAW_MARKER';
        sender.tab.url = 'https://attacker.example/RAW_MARKER';
        readiness.markReady();
        await readiness.waitUntilReady();
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        const [snapshot, options] =
            subtitleService.processDisneyPlusSubtitles.mock.calls[0];
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
        expect(snapshot).toMatchObject({
            source: SubtitleRequestSources.DISNEY_PLUS,
            url: DISNEY_SUBTITLE_URL,
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        });
        expect(options).toEqual({ signal: expect.anything() });
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.signal.aborted).toBe(false);
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('processes a Disney request from a stale same-document sender route against the live tab route', async () => {
        const listeners = createChromeHarness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(createDisneyServiceResult()),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const livePageUrl = 'https://www.disneyplus.com/video/episode-456';
        const message = createDisneyMessage({ videoId: 'episode-456' });
        const sender = createDisneySender({
            tab: { id: 17, url: livePageUrl },
        });
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](message, sender, sendResponse);
        await flushAsyncHandling();

        expect(keepsChannelOpen).toBe(true);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        expect(
            subtitleService.processDisneyPlusSubtitles.mock.calls[0][0]
        ).toMatchObject({
            source: SubtitleRequestSources.DISNEY_PLUS,
            tabId: 17,
            videoId: 'episode-456',
        });
        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                videoId: 'episode-456',
            })
        );
    });

    test('rejects an accessor-backed action without invoking it or waiting for services', () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const message = createDisneyMessage();
        const onActionAccess = jest.fn();
        Object.defineProperty(message, 'action', {
            configurable: true,
            enumerable: true,
            get() {
                onActionAccess();
                return MessageActions.FETCH_VTT;
            },
        });
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            message,
            createDisneySender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        expect(onActionAccess).not.toHaveBeenCalled();
        expect(waitUntilReady).not.toHaveBeenCalled();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Invalid message',
        });
    });

    test.each([
        ['empty string', ''],
        ['object', {}],
        ['array', []],
        ['symbol', Symbol('fetchVTT')],
        ['null', null],
    ])(
        'synchronously rejects an own-data %s action without cold readiness',
        (_label, action) => {
            const listeners = createChromeHarness();
            const readiness = new BackgroundServiceReadiness();
            const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
            const subtitleService = {
                processDisneyPlusSubtitles: jest.fn(),
                processNetflixSubtitles: jest.fn(),
            };
            const handler = new MessageHandler();
            handler.initialize(readiness);
            handler.setServices({ subtitleService });
            const sendResponse = jest.fn();

            const keepsChannelOpen = listeners[0](
                createDisneyMessage({ action }),
                createDisneySender(),
                sendResponse
            );

            expect(keepsChannelOpen).toBe(false);
            expect(waitUntilReady).not.toHaveBeenCalled();
            expect(
                subtitleService.processDisneyPlusSubtitles
            ).not.toHaveBeenCalled();
            expect(
                subtitleService.processNetflixSubtitles
            ).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Invalid message',
            });
        }
    );

    test.each([
        ['extension id', (_message, sender) => (sender.id = 'RAW_MARKER')],
        ['top frame', (_message, sender) => (sender.frameId = 1)],
        ['origin', (_message, sender) => (sender.origin = 'RAW_MARKER')],
        [
            'sender origin',
            (_message, sender) =>
                (sender.url = 'https://attacker.example/video/RAW_MARKER'),
        ],
        [
            'tab route',
            (_message, sender) =>
                (sender.tab.url =
                    'https://www.disneyplus.com/video/RAW_MARKER'),
        ],
        ['source', (message) => (message.source = 'RAW_MARKER')],
        ['missing source', (message) => delete message.source],
        [
            'leaked page channel authority',
            (message) =>
                (message.dualsubChannel = {
                    platform: SubtitleRequestSources.DISNEY_PLUS,
                    capability: 'a'.repeat(64),
                }),
        ],
    ])(
        'rejects an invalid %s before readiness or subtitle service work',
        (_label, invalidate) => {
            const listeners = createChromeHarness();
            const readiness = new BackgroundServiceReadiness();
            const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
            const subtitleService = {
                processDisneyPlusSubtitles: jest.fn(),
                processNetflixSubtitles: jest.fn(),
            };
            const handler = new MessageHandler();
            handler.initialize(readiness);
            handler.setServices({ subtitleService });
            handler.logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };
            const message = createDisneyMessage({
                targetLanguage: 'RAW_MARKER',
            });
            const sender = createDisneySender();
            invalidate(message, sender);
            const sendResponse = jest.fn();

            const keepsChannelOpen = listeners[0](
                message,
                sender,
                sendResponse
            );

            expect(keepsChannelOpen).toBe(false);
            expect(waitUntilReady).not.toHaveBeenCalled();
            expect(
                subtitleService.processDisneyPlusSubtitles
            ).not.toHaveBeenCalled();
            expect(
                subtitleService.processNetflixSubtitles
            ).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Subtitle request rejected',
            });
            expect(handler.logger.warn).toHaveBeenCalledWith(
                'Subtitle request rejected',
                { stage: 'authorize' }
            );
            expectNoRawMarker(sendResponse.mock.calls);
            expectNoRawMarker(handler.logger.warn.mock.calls);
        }
    );

    test.each([
        [
            'tab',
            () => ({
                firstMessage: createDisneyMessage(),
                firstSender: createDisneySender(),
                secondMessage: createDisneyMessage(),
                secondSender: createDisneySender({
                    tab: { id: 18, url: DISNEY_PAGE_URL },
                }),
            }),
        ],
        [
            'video',
            () => {
                const secondPageUrl =
                    'https://www.disneyplus.com/video/episode-456';
                return {
                    firstMessage: createDisneyMessage(),
                    firstSender: createDisneySender(),
                    secondMessage: createDisneyMessage({
                        videoId: 'episode-456',
                    }),
                    secondSender: createDisneySender({
                        tab: { id: 17, url: secondPageUrl },
                        url: secondPageUrl,
                        origin: new URL(secondPageUrl).origin,
                    }),
                };
            },
        ],
        [
            'source',
            () => ({
                firstMessage: createDisneyMessage(),
                firstSender: createDisneySender(),
                secondMessage: createNetflixMessage(),
                secondSender: createNetflixSender({
                    tab: { id: 17, url: NETFLIX_PAGE_URL },
                }),
            }),
        ],
        [
            'canonical query',
            () => ({
                firstMessage: createDisneyMessage({
                    url: `${DISNEY_SUBTITLE_URL}?token=one`,
                }),
                firstSender: createDisneySender(),
                secondMessage: createDisneyMessage({
                    url: `${DISNEY_SUBTITLE_URL}?token=two`,
                }),
                secondSender: createDisneySender(),
            }),
        ],
        [
            'language',
            () => ({
                firstMessage: createDisneyMessage(),
                firstSender: createDisneySender(),
                secondMessage: createDisneyMessage({ targetLanguage: 'fr' }),
                secondSender: createDisneySender(),
            }),
        ],
        [
            'original language',
            () => ({
                firstMessage: createDisneyMessage(),
                firstSender: createDisneySender(),
                secondMessage: createDisneyMessage({
                    originalLanguage: 'fr',
                }),
                secondSender: createDisneySender(),
            }),
        ],
    ])(
        'uses separate Disney leases only across a different tab, video, or source: %s',
        async (_label, createRequests) => {
            const listeners = createChromeHarness();
            const subtitleService = {
                processDisneyPlusSubtitles: jest
                    .fn()
                    .mockResolvedValue(createDisneyServiceResult()),
                processNetflixSubtitles: jest
                    .fn()
                    .mockResolvedValue(createNetflixServiceResult()),
            };
            const handler = new MessageHandler();
            handler.initialize();
            handler.setServices({ subtitleService });
            const { firstMessage, firstSender, secondMessage, secondSender } =
                createRequests();
            const firstResponse = jest.fn();
            const secondResponse = jest.fn();

            listeners[0](firstMessage, firstSender, firstResponse);
            listeners[0](secondMessage, secondSender, secondResponse);
            await flushAsyncHandling();

            const sharesLatestLease = !['tab', 'video', 'source'].includes(
                _label
            );
            if (_label === 'source') {
                expect(
                    subtitleService.processDisneyPlusSubtitles
                ).toHaveBeenCalledTimes(1);
                expect(
                    subtitleService.processNetflixSubtitles
                ).toHaveBeenCalledTimes(1);
            } else {
                expect(
                    subtitleService.processDisneyPlusSubtitles
                ).toHaveBeenCalledTimes(sharesLatestLease ? 1 : 2);
                expect(
                    subtitleService.processNetflixSubtitles
                ).not.toHaveBeenCalled();
            }
            if (_label === 'canonical query') {
                expect(
                    subtitleService.processDisneyPlusSubtitles.mock.calls.map(
                        ([snapshot]) => snapshot.url
                    )
                ).toEqual([`${DISNEY_SUBTITLE_URL}?token=two`]);
            }
            expect(firstResponse).toHaveBeenCalledTimes(1);
            expect(secondResponse).toHaveBeenCalledTimes(1);
            if (sharesLatestLease) {
                expect(firstResponse).toHaveBeenCalledWith({
                    success: false,
                    error: 'Subtitle request rejected',
                });
                expect(secondResponse).toHaveBeenCalledWith(
                    expect.objectContaining({ success: true })
                );
            }
        }
    );

    test('returns a fixed readiness failure without retaining or exposing raw input', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const message = createDisneyMessage();
        const sender = createDisneySender();
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](message, sender, sendResponse);
        message.url = `${DISNEY_SUBTITLE_URL}?marker=RAW_MARKER`;
        sender.url = 'https://attacker.example/RAW_MARKER';
        sender.tab.url = 'https://attacker.example/RAW_MARKER';
        readiness.markFailed(new Error('RAW_MARKER'));
        await readiness.waitUntilReady().catch(() => {});
        await flushAsyncHandling();

        expect(keepsChannelOpen).toBe(true);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Background services unavailable',
        });
        expect(handler.logger.error).toHaveBeenCalledWith(
            'Background services unavailable for subtitle request',
            null,
            { stage: 'readiness', tabId: 17, source: 'disneyplus' }
        );
        expectNoRawMarker(sendResponse.mock.calls);
        expectNoRawMarker(handler.logger.error.mock.calls);
    });

    test('passes the exact branded Netflix snapshot through cold readiness', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = {
            processNetflixSubtitles: jest
                .fn()
                .mockResolvedValue(createNetflixServiceResult()),
        };
        const handler = new MessageHandler();
        const admission = jest.spyOn(handler, 'admitAuthorizedSubtitleRequest');
        const finalServiceEntry = jest.spyOn(
            handler,
            'createAuthorizedFetchVTTResponse'
        );
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const message = createNetflixMessage();
        const sender = createNetflixSender();
        const sendResponse = jest.fn();

        listeners[0](message, sender, sendResponse);

        expect(admission).toHaveBeenCalledTimes(1);
        const snapshot = admission.mock.calls[0][0];
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
        expect(snapshot).not.toBe(message);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.data.tracks[0])).toBe(true);

        message.action = MessageActions.TRANSLATE;
        message.source = SubtitleRequestSources.DISNEY_PLUS;
        message.videoId = 'RAW_MARKER';
        message.targetLanguage = 'RAW_MARKER';
        message.data.tracks[0].language = 'RAW_MARKER';
        sender.url = 'https://attacker.example/RAW_MARKER';
        readiness.markReady();
        await readiness.waitUntilReady();
        await flushAsyncHandling();

        expect(finalServiceEntry).toHaveBeenCalledTimes(1);
        expect(finalServiceEntry.mock.calls[0][0]).toBe(snapshot);
        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledTimes(
            1
        );
        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledWith(
            snapshot,
            { signal: expect.anything() }
        );
        expect(subtitleService.processNetflixSubtitles.mock.calls[0][0]).toBe(
            snapshot
        );
        expect(
            subtitleService.processNetflixSubtitles.mock.calls[0][1].signal
        ).toBeInstanceOf(AbortSignal);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                vttText: 'WEBVTT',
                videoId: '80123456',
            })
        );
        expectNoRawMarker([snapshot]);
        expectNoRawMarker(sendResponse.mock.calls);
    });

    test('shares one in-flight Disney operation across canonical fragment variants', async () => {
        const listeners = createChromeHarness();
        const serviceOperation = createDeferred();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockReturnValue(serviceOperation.promise),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const firstResponse = jest.fn();
        const secondResponse = jest.fn();

        const firstKeepsOpen = listeners[0](
            createDisneyMessage({ url: `${DISNEY_SUBTITLE_URL}#one` }),
            createDisneySender(),
            firstResponse
        );
        const secondKeepsOpen = listeners[0](
            createDisneyMessage({ url: `${DISNEY_SUBTITLE_URL}#two` }),
            createDisneySender(),
            secondResponse
        );

        expect(firstKeepsOpen).toBe(true);
        expect(secondKeepsOpen).toBe(true);
        await Promise.resolve();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        const [snapshot, options] =
            subtitleService.processDisneyPlusSubtitles.mock.calls[0];
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
        expect(snapshot).toMatchObject({
            url: DISNEY_SUBTITLE_URL,
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        });
        expect(options).toEqual({ signal: expect.anything() });
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.signal.aborted).toBe(false);
        expect(firstResponse).not.toHaveBeenCalled();
        expect(secondResponse).not.toHaveBeenCalled();

        serviceOperation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();

        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(secondResponse).toHaveBeenCalledTimes(1);
        expect(firstResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                vttText: 'WEBVTT',
                videoId: 'episode-123',
            })
        );
        expect(firstResponse.mock.calls[0][0]).not.toBe(
            secondResponse.mock.calls[0][0]
        );
        expect(firstResponse.mock.calls[0][0]).toEqual(
            secondResponse.mock.calls[0][0]
        );

        const postSettlementResponse = jest.fn();
        listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            postSettlementResponse
        );
        await flushAsyncHandling();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(2);
        expect(postSettlementResponse).toHaveBeenCalledTimes(1);
    });

    test('bounds a cold same-video flood to one latest lease and one service dispatch', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(createDisneyServiceResult()),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const responders = Array.from({ length: 40 }, () => jest.fn());

        const keepsOpen = responders.map((responder, index) =>
            listeners[0](
                createDisneyMessage({
                    url: `${DISNEY_SUBTITLE_URL}?lease=${index}`,
                }),
                createDisneySender(),
                responder
            )
        );

        expect(keepsOpen).toEqual(Array(40).fill(true));
        expect(handler.subtitleRequestFlights).toHaveProperty('size', 1);
        expect(waitUntilReady).toHaveBeenCalledTimes(40);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        for (const responder of responders.slice(0, -1)) {
            expect(responder).toHaveBeenCalledWith({
                success: false,
                error: 'Subtitle request rejected',
            });
        }
        expect(responders.at(-1)).not.toHaveBeenCalled();

        readiness.markReady();
        await readiness.waitUntilReady();
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        expect(
            subtitleService.processDisneyPlusSubtitles.mock.calls[0][0].url
        ).toBe(`${DISNEY_SUBTITLE_URL}?lease=39`);
        expect(responders.at(-1)).toHaveBeenCalledWith(
            expect.objectContaining({ success: true })
        );
        expect(handler.subtitleRequestFlights).toHaveProperty('size', 0);
    });

    test('aborts and ignores started same-video work when a newer canonical request supersedes it', async () => {
        const listeners = createChromeHarness();
        const operations = [createDeferred(), createDeferred()];
        const signals = [];
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn((_snapshot, { signal }) => {
                signals.push(signal);
                return operations[signals.length - 1].promise;
            }),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const firstResponse = jest.fn();
        const latestResponse = jest.fn();

        listeners[0](
            createDisneyMessage({
                url: `${DISNEY_SUBTITLE_URL}?lease=old`,
            }),
            createDisneySender(),
            firstResponse
        );
        await Promise.resolve();
        expect(signals).toHaveLength(1);
        expect(signals[0].aborted).toBe(false);

        listeners[0](
            createDisneyMessage({
                url: `${DISNEY_SUBTITLE_URL}?lease=latest`,
            }),
            createDisneySender(),
            latestResponse
        );

        expect(signals[0].aborted).toBe(true);
        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(firstResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(handler.subtitleRequestFlights).toHaveProperty('size', 1);
        await Promise.resolve();
        expect(signals).toHaveLength(2);
        expect(signals[1].aborted).toBe(false);

        operations[0].resolve({
            ...createDisneyServiceResult(),
            vttText: 'STALE',
        });
        await flushAsyncHandling();
        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(latestResponse).not.toHaveBeenCalled();

        operations[1].resolve({
            ...createDisneyServiceResult(),
            vttText: 'LATEST',
        });
        await flushAsyncHandling();

        expect(latestResponse).toHaveBeenCalledTimes(1);
        expect(latestResponse).toHaveBeenCalledWith(
            expect.objectContaining({ success: true, vttText: 'LATEST' })
        );
        expect(handler.subtitleRequestFlights).toHaveProperty('size', 0);
    });

    test('shares one in-flight Netflix operation across deep-distinct exact arrivals', async () => {
        const listeners = createChromeHarness();
        const serviceOperation = createDeferred();
        const subtitleService = {
            processNetflixSubtitles: jest
                .fn()
                .mockReturnValue(serviceOperation.promise),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const firstResponse = jest.fn();
        const secondResponse = jest.fn();

        listeners[0](
            createNetflixMessage(),
            createNetflixSender(),
            firstResponse
        );
        listeners[0](
            createNetflixMessage(),
            createNetflixSender(),
            secondResponse
        );
        await Promise.resolve();

        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledTimes(
            1
        );

        serviceOperation.resolve(createNetflixServiceResult());
        await flushAsyncHandling();

        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(secondResponse).toHaveBeenCalledTimes(1);
        expect(firstResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                vttText: 'WEBVTT',
                videoId: '80123456',
            })
        );
        expect(firstResponse.mock.calls[0][0]).not.toBe(
            secondResponse.mock.calls[0][0]
        );
        expect(firstResponse.mock.calls[0][0]).toEqual(
            secondResponse.mock.calls[0][0]
        );
    });

    test.each([
        [
            'tab',
            () => [
                createNetflixMessage(),
                createNetflixMessage(),
                createNetflixSender(),
                createNetflixSender({
                    tab: { id: 24, url: NETFLIX_PAGE_URL },
                }),
            ],
        ],
        [
            'video',
            () => {
                const secondPageUrl = 'https://www.netflix.com/watch/80999999';
                return [
                    createNetflixMessage(),
                    createNetflixMessage({ videoId: '80999999' }),
                    createNetflixSender(),
                    createNetflixSender({
                        tab: { id: 23, url: secondPageUrl },
                        url: secondPageUrl,
                        origin: new URL(secondPageUrl).origin,
                    }),
                ];
            },
        ],
        [
            'target language',
            () => [
                createNetflixMessage(),
                createNetflixMessage({ targetLanguage: 'fr' }),
            ],
        ],
        [
            'original language',
            () => [
                createNetflixMessage(),
                createNetflixMessage({ originalLanguage: 'fr' }),
            ],
        ],
        [
            'request flag',
            () => [
                createNetflixMessage(),
                createNetflixMessage({ useNativeSubtitles: false }),
            ],
        ],
        [
            'official translation flag',
            () => [
                createNetflixMessage(),
                createNetflixMessage({ useOfficialTranslations: true }),
            ],
        ],
        [
            'track count',
            () => [
                createNetflixMessage(),
                createNetflixMessage({
                    data: {
                        tracks: [
                            createNetflixTrack(),
                            createNetflixTrack({
                                language: 'fr',
                                displayName: 'French',
                                url: 'https://captions.nflxvideo.net/show/fr.ttml',
                            }),
                        ],
                    },
                }),
            ],
        ],
        [
            'track language',
            () => [
                createNetflixMessage(),
                createNetflixMessage({
                    data: {
                        tracks: [createNetflixTrack({ language: 'fr' })],
                    },
                }),
            ],
        ],
        [
            'canonical track URL',
            () => [
                createNetflixMessage(),
                createNetflixMessage({
                    data: {
                        tracks: [
                            createNetflixTrack({
                                url: 'https://captions.nflxvideo.net/show/other.ttml',
                            }),
                        ],
                    },
                }),
            ],
        ],
        [
            'track URL query',
            () => [
                createNetflixMessage({
                    data: {
                        tracks: [
                            createNetflixTrack({
                                url: `${NETFLIX_SUBTITLE_URL}?token=one`,
                            }),
                        ],
                    },
                }),
                createNetflixMessage({
                    data: {
                        tracks: [
                            createNetflixTrack({
                                url: `${NETFLIX_SUBTITLE_URL}?token=two`,
                            }),
                        ],
                    },
                }),
            ],
        ],
        [
            'track display name',
            () => [
                createNetflixMessage(),
                createNetflixMessage({
                    data: {
                        tracks: [
                            createNetflixTrack({ displayName: 'English CC' }),
                        ],
                    },
                }),
            ],
        ],
        [
            'track type presence',
            () => [
                createNetflixMessage(),
                createNetflixMessage({
                    data: {
                        tracks: [createNetflixTrack({ trackType: null })],
                    },
                }),
            ],
        ],
        [
            'track type value',
            () => [
                createNetflixMessage(),
                createNetflixMessage({
                    data: {
                        tracks: [
                            createNetflixTrack({ trackType: 'SECONDARY' }),
                        ],
                    },
                }),
            ],
        ],
        [
            'download format',
            () => [
                createNetflixMessage(),
                createNetflixMessage({
                    data: {
                        tracks: [
                            createNetflixTrack({ format: 'webvtt-lssdh-ios8' }),
                        ],
                    },
                }),
            ],
        ],
        [
            'track order',
            () => {
                const english = () => createNetflixTrack();
                const french = () =>
                    createNetflixTrack({
                        language: 'fr',
                        displayName: 'French',
                        url: 'https://captions.nflxvideo.net/show/fr.ttml',
                    });
                return [
                    createNetflixMessage({
                        data: { tracks: [english(), french()] },
                    }),
                    createNetflixMessage({
                        data: { tracks: [french(), english()] },
                    }),
                ];
            },
        ],
    ])(
        'uses separate Netflix leases only across a different tab or video: %s',
        async (_label, createRequests) => {
            const listeners = createChromeHarness();
            const operations = [createDeferred(), createDeferred()];
            let nextOperation = 0;
            const subtitleService = {
                processNetflixSubtitles: jest
                    .fn()
                    .mockImplementation(
                        () => operations[nextOperation++].promise
                    ),
            };
            const handler = new MessageHandler();
            handler.initialize();
            handler.setServices({ subtitleService });
            const [
                firstMessage,
                secondMessage,
                firstSender = createNetflixSender(),
                secondSender = createNetflixSender(),
            ] = createRequests();
            const firstResponse = jest.fn();
            const secondResponse = jest.fn();

            listeners[0](firstMessage, firstSender, firstResponse);
            listeners[0](secondMessage, secondSender, secondResponse);
            await Promise.resolve();

            const sharesLatestLease = !['tab', 'video'].includes(_label);
            expect(
                subtitleService.processNetflixSubtitles
            ).toHaveBeenCalledTimes(sharesLatestLease ? 1 : 2);
            if (sharesLatestLease) {
                expect(firstResponse).toHaveBeenCalledWith({
                    success: false,
                    error: 'Subtitle request rejected',
                });
            } else {
                expect(firstResponse).not.toHaveBeenCalled();
            }
            expect(secondResponse).not.toHaveBeenCalled();

            operations[0].resolve(
                createNetflixServiceResult({
                    vttText: sharesLatestLease ? 'SECOND' : 'FIRST',
                })
            );
            if (!sharesLatestLease) {
                operations[1].resolve(
                    createNetflixServiceResult({ vttText: 'SECOND' })
                );
            }
            await flushAsyncHandling();

            expect(firstResponse).toHaveBeenCalledTimes(1);
            expect(secondResponse).toHaveBeenCalledTimes(1);
            if (!sharesLatestLease) {
                expect(firstResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        vttText: 'FIRST',
                    })
                );
            }
            expect(secondResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    vttText: 'SECOND',
                })
            );
            expect(firstResponse.mock.calls[0][0]).not.toBe(
                secondResponse.mock.calls[0][0]
            );
        }
    );

    test('accepts eight responders for one flight and fixed-rejects the ninth', async () => {
        const listeners = createChromeHarness();
        const serviceOperation = createDeferred();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockReturnValue(serviceOperation.promise),
        };
        const handler = new MessageHandler();
        const admission = jest.spyOn(handler, 'admitAuthorizedSubtitleRequest');
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const responders = Array.from({ length: 9 }, () => jest.fn());

        const keepsOpen = responders.map((responder) =>
            listeners[0](createDisneyMessage(), createDisneySender(), responder)
        );
        await Promise.resolve();

        expect(keepsOpen.slice(0, 8)).toEqual(Array(8).fill(true));
        expect(keepsOpen[8]).toBe(false);
        expect(admission).toHaveBeenCalledTimes(9);
        expect(
            admission.mock.calls.every(([snapshot]) =>
                isAuthorizedSubtitleRequestSnapshot(snapshot)
            )
        ).toBe(true);
        expect(
            new Set(admission.mock.calls.map(([snapshot]) => snapshot)).size
        ).toBe(9);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        expect(responders[8]).toHaveBeenCalledTimes(1);
        expect(responders[8]).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(handler.logger.warn).toHaveBeenCalledWith(
            'Subtitle request capacity reached',
            {
                stage: 'admission',
                scope: 'responders',
                tabId: 17,
                source: 'disneyplus',
                count: 8,
            }
        );
        expect(handler.logger.warn).toHaveBeenCalledTimes(1);

        serviceOperation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();

        const deliveredResponses = responders
            .slice(0, 8)
            .map((responder) => responder.mock.calls[0][0]);
        for (const responder of responders.slice(0, 8)) {
            expect(responder).toHaveBeenCalledTimes(1);
            expect(responder.mock.calls[0][0]).toEqual(deliveredResponses[0]);
        }
        expect(new Set(deliveredResponses).size).toBe(8);
        expect(
            new Set(
                deliveredResponses.map(
                    ({ selectedLanguage }) => selectedLanguage
                )
            ).size
        ).toBe(8);
        expect(responders[0]).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                vttText: 'WEBVTT',
                videoId: 'episode-123',
            })
        );
        expect(responders[8]).toHaveBeenCalledTimes(1);
    });

    test('fixed-rejects a third distinct flight in one tab and source partition', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        const admission = jest.spyOn(handler, 'admitAuthorizedSubtitleRequest');
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const responders = Array.from({ length: 4 }, () => jest.fn());
        const urls = ['one', 'two', 'three'].map(
            (name) => `https://captions.media.dssott.com/show/${name}.m3u8`
        );
        const videoIds = ['episode-one', 'episode-two', 'episode-three'];

        const keepsOpen = urls.map((url, index) =>
            listeners[0](
                createDisneyMessage({ url, videoId: videoIds[index] }),
                createDisneySender({
                    tab: {
                        id: 17,
                        url: `https://www.disneyplus.com/video/${videoIds[index]}`,
                    },
                    url: `https://www.disneyplus.com/video/${videoIds[index]}`,
                }),
                responders[index]
            )
        );
        const duplicateKeepsOpen = listeners[0](
            createDisneyMessage({ url: urls[0], videoId: videoIds[0] }),
            createDisneySender({
                tab: {
                    id: 17,
                    url: `https://www.disneyplus.com/video/${videoIds[0]}`,
                },
                url: `https://www.disneyplus.com/video/${videoIds[0]}`,
            }),
            responders[3]
        );

        expect(keepsOpen).toEqual([true, true, false]);
        expect(duplicateKeepsOpen).toBe(true);
        expect(admission).toHaveBeenCalledTimes(4);
        expect(
            admission.mock.calls.every(([snapshot]) =>
                isAuthorizedSubtitleRequestSnapshot(snapshot)
            )
        ).toBe(true);
        expect(waitUntilReady).toHaveBeenCalledTimes(2);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(responders[2]).toHaveBeenCalledTimes(1);
        expect(responders[2]).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(responders[3]).not.toHaveBeenCalled();
        expect(handler.logger.warn).toHaveBeenCalledWith(
            'Subtitle request capacity reached',
            {
                stage: 'admission',
                scope: 'tab-source',
                tabId: 17,
                source: 'disneyplus',
                count: 2,
            }
        );

        readiness.markFailed(new Error('test cleanup'));
        await readiness.waitUntilReady().catch(() => {});
        await flushAsyncHandling();

        for (const responder of [responders[0], responders[1], responders[3]]) {
            expect(responder).toHaveBeenCalledTimes(1);
            expect(responder).toHaveBeenCalledWith({
                success: false,
                error: 'Background services unavailable',
            });
        }
        expect(responders[3].mock.calls[0][0]).toBe(
            responders[0].mock.calls[0][0]
        );
        expect(responders[2]).toHaveBeenCalledTimes(1);
    });

    test('partitions the two-flight cap by both tab and source', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
            processNetflixSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const responders = Array.from({ length: 3 }, () => jest.fn());

        const keepsOpen = [
            listeners[0](
                createDisneyMessage({
                    url: 'https://captions.media.dssott.com/show/source-one.m3u8',
                }),
                createDisneySender(),
                responders[0]
            ),
            listeners[0](
                createDisneyMessage({
                    url: 'https://captions.media.dssott.com/show/source-two.m3u8',
                    videoId: 'episode-456',
                }),
                createDisneySender({
                    tab: {
                        id: 17,
                        url: 'https://www.disneyplus.com/video/episode-456',
                    },
                    url: 'https://www.disneyplus.com/video/episode-456',
                }),
                responders[1]
            ),
            listeners[0](
                createNetflixMessage(),
                createNetflixSender({
                    tab: { id: 17, url: NETFLIX_PAGE_URL },
                }),
                responders[2]
            ),
        ];

        expect(keepsOpen).toEqual([true, true, true]);
        expect(waitUntilReady).toHaveBeenCalledTimes(3);
        expect(handler.subtitleRequestFlights.size).toBe(3);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(subtitleService.processNetflixSubtitles).not.toHaveBeenCalled();

        handler.destroy();
        for (const responder of responders) {
            expect(responder).toHaveBeenCalledTimes(1);
            expect(responder).toHaveBeenCalledWith({
                success: false,
                error: 'Background services unavailable',
            });
        }

        readiness.markReady();
        await readiness.waitUntilReady();
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(subtitleService.processNetflixSubtitles).not.toHaveBeenCalled();
        for (const responder of responders) {
            expect(responder).toHaveBeenCalledTimes(1);
        }
    });

    test('fixed-rejects a ninth distinct flight globally across independent partitions', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = { processDisneyPlusSubtitles: jest.fn() };
        const handler = new MessageHandler();
        const admission = jest.spyOn(handler, 'admitAuthorizedSubtitleRequest');
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const responders = Array.from({ length: 9 }, () => jest.fn());

        const keepsOpen = responders.map((responder, index) =>
            listeners[0](
                createDisneyMessage({
                    url: `https://captions.media.dssott.com/show/global-${index}.m3u8`,
                }),
                createDisneySender({
                    tab: { id: 100 + index, url: DISNEY_PAGE_URL },
                }),
                responder
            )
        );

        expect(keepsOpen.slice(0, 8)).toEqual(Array(8).fill(true));
        expect(keepsOpen[8]).toBe(false);
        expect(admission).toHaveBeenCalledTimes(9);
        expect(
            admission.mock.calls.every(([snapshot]) =>
                isAuthorizedSubtitleRequestSnapshot(snapshot)
            )
        ).toBe(true);
        expect(waitUntilReady).toHaveBeenCalledTimes(8);
        expect(responders[8]).toHaveBeenCalledTimes(1);
        expect(responders[8]).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(handler.logger.warn).toHaveBeenCalledWith(
            'Subtitle request capacity reached',
            {
                stage: 'admission',
                scope: 'global',
                tabId: 108,
                source: 'disneyplus',
                count: 8,
            }
        );

        readiness.markFailed(new Error('test cleanup'));
        await readiness.waitUntilReady().catch(() => {});
        await flushAsyncHandling();

        for (const responder of responders.slice(0, 8)) {
            expect(responder).toHaveBeenCalledTimes(1);
            expect(responder).toHaveBeenCalledWith({
                success: false,
                error: 'Background services unavailable',
            });
        }
        expect(responders[8]).toHaveBeenCalledTimes(1);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
    });

    test.each(['ready', 'cold'])(
        'preserves the Disney service failure envelope for a synchronous throw when %s',
        async (readinessState) => {
            const listeners = createChromeHarness();
            const readiness = new BackgroundServiceReadiness();
            const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
            if (readinessState === 'ready') readiness.markReady();
            const subtitleService = {
                processDisneyPlusSubtitles: jest.fn(() => {
                    throw new Error('sync failure');
                }),
            };
            const handler = new MessageHandler();
            handler.initialize(readiness);
            handler.setServices({ subtitleService });
            const sendResponse = jest.fn();

            listeners[0](
                createDisneyMessage(),
                createDisneySender(),
                sendResponse
            );
            if (readinessState === 'cold') {
                readiness.markReady();
            }
            await flushAsyncHandling();

            expect(waitUntilReady).toHaveBeenCalledTimes(
                readinessState === 'cold' ? 1 : 0
            );
            expect(
                subtitleService.processDisneyPlusSubtitles
            ).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Subtitle processing failed',
                videoId: 'episode-123',
            });
        }
    );

    test('a saved runtime listener cannot start subtitle work after destroy and reinitialize', async () => {
        const listeners = createChromeHarness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(createDisneyServiceResult()),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const savedListener = listeners[0];
        const sendResponse = jest.fn();
        handler.destroy();
        handler.initialize();

        const keepsOpen = savedListener(
            createDisneyMessage(),
            createDisneySender(),
            sendResponse
        );
        await flushAsyncHandling();

        expect(keepsOpen).toBe(false);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
    });

    test('rechecks lifecycle ownership after a proxy reenters destroy during authorization', () => {
        const listeners = createChromeHarness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        const admission = jest.spyOn(handler, 'admitAuthorizedSubtitleRequest');
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        let destroyed = false;
        const message = new Proxy(createDisneyMessage(), {
            getOwnPropertyDescriptor(target, key) {
                if (key === 'source' && !destroyed) {
                    destroyed = true;
                    handler.destroy();
                }
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
        const sendResponse = jest.fn();

        const keepsOpen = listeners[0](
            message,
            createDisneySender(),
            sendResponse
        );

        expect(destroyed).toBe(true);
        expect(keepsOpen).toBe(false);
        expect(admission).not.toHaveBeenCalled();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(handler.logger.warn).toHaveBeenCalledWith(
            'Subtitle request rejected',
            { stage: 'lifecycle' }
        );
    });

    test('destroy fixed-settles a cold flight and prevents late readiness from starting service', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        const readinessEntry = jest.spyOn(
            handler,
            'handleAuthorizedSubtitleRequestWhenReady'
        );
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const sendResponse = jest.fn();

        listeners[0](createDisneyMessage(), createDisneySender(), sendResponse);
        const flight = readinessEntry.mock.calls[0][0];
        expect(isAuthorizedSubtitleRequestSnapshot(flight.snapshot)).toBe(true);
        handler.destroy();

        expect(flight.snapshot).toBeNull();
        expect(flight.promise).toBeNull();
        expect(flight.responders).toEqual([]);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Background services unavailable',
        });

        readiness.markReady();
        await readiness.waitUntilReady();
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('does not resurrect flight state when readiness reenters destroy', async () => {
        const listeners = createChromeHarness();
        const readinessOperation = createDeferred();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        let handler;
        const readiness = {
            isReady: jest.fn(() => false),
            waitUntilReady: jest.fn(() => {
                handler.destroy();
                return readinessOperation.promise;
            }),
        };
        handler = new MessageHandler();
        const readinessEntry = jest.spyOn(
            handler,
            'handleAuthorizedSubtitleRequestWhenReady'
        );
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const sendResponse = jest.fn();

        const keepsOpen = listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            sendResponse
        );
        const flight = readinessEntry.mock.calls[0][0];

        expect(keepsOpen).toBe(true);
        expect(flight.snapshot).toBeNull();
        expect(flight.promise).toBeNull();
        expect(flight.responders).toEqual([]);
        expect(handler.subtitleRequestFlights.size).toBe(0);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Background services unavailable',
        });

        readinessOperation.resolve();
        await flushAsyncHandling();

        expect(flight.snapshot).toBeNull();
        expect(flight.promise).toBeNull();
        expect(flight.responders).toEqual([]);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('destroy lets started work settle without disturbing a reinitialized flight', async () => {
        const listeners = createChromeHarness();
        const oldOperation = createDeferred();
        const newOperation = createDeferred();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockReturnValueOnce(oldOperation.promise)
                .mockReturnValueOnce(newOperation.promise),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const oldResponse = jest.fn();

        listeners[0](createDisneyMessage(), createDisneySender(), oldResponse);
        await Promise.resolve();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);

        handler.destroy();
        expect(oldResponse).not.toHaveBeenCalled();
        handler.initialize();
        const newResponse = jest.fn();
        listeners[1](createDisneyMessage(), createDisneySender(), newResponse);
        await Promise.resolve();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(2);

        oldOperation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();
        expect(oldResponse).toHaveBeenCalledTimes(1);
        expect(newResponse).not.toHaveBeenCalled();

        const newFollowerResponse = jest.fn();
        listeners[1](
            createDisneyMessage(),
            createDisneySender(),
            newFollowerResponse
        );
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(2);

        newOperation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();
        expect(newResponse).toHaveBeenCalledTimes(1);
        expect(newFollowerResponse).toHaveBeenCalledTimes(1);
        expect(newResponse.mock.calls[0][0]).not.toBe(
            newFollowerResponse.mock.calls[0][0]
        );
        expect(newResponse.mock.calls[0][0]).toEqual(
            newFollowerResponse.mock.calls[0][0]
        );
    });

    test('fans one readiness failure out to every exact duplicate responder', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const firstResponse = jest.fn();
        const secondResponse = jest.fn();

        listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            firstResponse
        );
        listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            secondResponse
        );
        expect(waitUntilReady).toHaveBeenCalledTimes(1);

        readiness.markFailed(new Error('readiness failed'));
        await readiness.waitUntilReady().catch(() => {});
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(secondResponse).toHaveBeenCalledTimes(1);
        expect(firstResponse.mock.calls[0][0]).toBe(
            secondResponse.mock.calls[0][0]
        );
        expect(firstResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Background services unavailable',
        });
    });

    test('one throwing responder cannot poison duplicate peer delivery', async () => {
        const listeners = createChromeHarness();
        const serviceOperation = createDeferred();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockReturnValue(serviceOperation.promise),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const throwingResponse = jest.fn(() => {
            throw new Error('closed response channel');
        });
        const peerResponse = jest.fn();

        listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            throwingResponse
        );
        listeners[0](createDisneyMessage(), createDisneySender(), peerResponse);
        await Promise.resolve();
        serviceOperation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        expect(throwingResponse).toHaveBeenCalledTimes(1);
        expect(peerResponse).toHaveBeenCalledTimes(1);
        expect(throwingResponse.mock.calls[0][0]).not.toBe(
            peerResponse.mock.calls[0][0]
        );
        expect(throwingResponse.mock.calls[0][0]).toEqual(
            peerResponse.mock.calls[0][0]
        );
    });

    test('reentrant fan-out starts a fresh flight without skipping old peers', async () => {
        const listeners = createChromeHarness();
        const oldOperation = createDeferred();
        const freshOperation = createDeferred();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockReturnValueOnce(oldOperation.promise)
                .mockReturnValueOnce(freshOperation.promise),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const freshResponse = jest.fn();
        const reentrantResponse = jest.fn(() => {
            listeners[0](
                createDisneyMessage(),
                createDisneySender(),
                freshResponse
            );
        });
        const oldPeerResponse = jest.fn();

        listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            reentrantResponse
        );
        listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            oldPeerResponse
        );
        await Promise.resolve();
        oldOperation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(2);
        expect(reentrantResponse).toHaveBeenCalledTimes(1);
        expect(oldPeerResponse).toHaveBeenCalledTimes(1);
        expect(oldPeerResponse.mock.calls[0][0]).not.toBe(
            reentrantResponse.mock.calls[0][0]
        );
        expect(oldPeerResponse.mock.calls[0][0]).toEqual(
            reentrantResponse.mock.calls[0][0]
        );
        expect(freshResponse).not.toHaveBeenCalled();

        freshOperation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();
        expect(freshResponse).toHaveBeenCalledTimes(1);
    });

    test('releases exact ownership after service rejection and admits a fresh retry', async () => {
        const listeners = createChromeHarness();
        const failedOperation = createDeferred();
        const retryOperation = createDeferred();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockReturnValueOnce(failedOperation.promise)
                .mockReturnValueOnce(retryOperation.promise),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const failedResponse = jest.fn();

        listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            failedResponse
        );
        await Promise.resolve();
        failedOperation.reject(new Error('service rejected'));
        await flushAsyncHandling();
        expect(failedResponse).toHaveBeenCalledTimes(1);

        const retryResponse = jest.fn();
        listeners[0](
            createDisneyMessage(),
            createDisneySender(),
            retryResponse
        );
        await Promise.resolve();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(2);

        retryOperation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();
        expect(retryResponse).toHaveBeenCalledTimes(1);
    });

    test('detaches a coalesced Netflix processing failure for every responder', async () => {
        const listeners = createChromeHarness();
        const subtitleService = {
            processNetflixSubtitles: jest.fn(() => {
                throw new Error('sync failure');
            }),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const firstResponse = jest.fn((response) => {
            response.error = 'MUTATED';
            response.extraSecret = 'MUTATED';
        });
        const secondResponse = jest.fn();

        listeners[0](
            createNetflixMessage(),
            createNetflixSender(),
            firstResponse
        );
        listeners[0](
            createNetflixMessage(),
            createNetflixSender(),
            secondResponse
        );
        await flushAsyncHandling();

        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledTimes(
            1
        );
        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(secondResponse).toHaveBeenCalledTimes(1);
        expect(firstResponse.mock.calls[0][0]).not.toBe(
            secondResponse.mock.calls[0][0]
        );
        expect(secondResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
    });

    test('detaches a coalesced dynamic service-unavailable response for every responder', async () => {
        const listeners = createChromeHarness();
        const handler = new MessageHandler();
        handler.initialize();
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const firstResponse = jest.fn((response) => {
            response.error = 'MUTATED';
            response.extraSecret = 'MUTATED';
        });
        const secondResponse = jest.fn();

        listeners[0](
            createNetflixMessage(),
            createNetflixSender(),
            firstResponse
        );
        listeners[0](
            createNetflixMessage(),
            createNetflixSender(),
            secondResponse
        );
        await flushAsyncHandling();

        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(secondResponse).toHaveBeenCalledTimes(1);
        expect(firstResponse.mock.calls[0][0]).not.toBe(
            secondResponse.mock.calls[0][0]
        );
        expect(secondResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle service not initialized',
            videoId: '80123456',
        });
    });

    test('detaches a coalesced subtitle success response for every responder', async () => {
        const listeners = createChromeHarness();
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue({
                vttText: 'WEBVTT original',
                targetVttText: null,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                useNativeTarget: false,
                availableLanguages: [
                    { normalizedCode: 'en', displayName: 'English' },
                ],
            }),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const firstResponse = jest.fn((response) => {
            response.selectedLanguage.displayName = 'MUTATED';
            response.extraSecret = 'MUTATED';
        });
        const secondResponse = jest.fn();

        listeners[0](
            createNetflixMessage(),
            createNetflixSender(),
            firstResponse
        );
        listeners[0](
            createNetflixMessage(),
            createNetflixSender(),
            secondResponse
        );
        await flushAsyncHandling();

        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledTimes(
            1
        );
        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(secondResponse).toHaveBeenCalledTimes(1);
        expect(firstResponse.mock.calls[0][0]).not.toBe(
            secondResponse.mock.calls[0][0]
        );
        expect(firstResponse.mock.calls[0][0].selectedLanguage).not.toBe(
            secondResponse.mock.calls[0][0].selectedLanguage
        );
        expect(secondResponse).toHaveBeenCalledWith({
            success: true,
            vttText: 'WEBVTT original',
            targetVttText: null,
            videoId: '80123456',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            selectedLanguage: {
                normalizedCode: 'en',
                displayName: 'English',
            },
        });
    });

    test('hard-rejects unbranded direct subtitle handler and admission calls', () => {
        createChromeHarness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
            processNetflixSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const directResponse = jest.fn();
        const admissionResponse = jest.fn();
        const rawMessage = createDisneyMessage();

        expect(
            handler.handleAuthorizedFetchVTTMessage(rawMessage, directResponse)
        ).toBe(false);
        expect(
            handler.admitAuthorizedSubtitleRequest(
                rawMessage,
                admissionResponse
            )
        ).toBe(false);

        expect(directResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(directResponse).toHaveBeenCalledTimes(1);
        expect(admissionResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(admissionResponse).toHaveBeenCalledTimes(1);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(subtitleService.processNetflixSubtitles).not.toHaveBeenCalled();
    });

    test.each([
        ['Disney', 'createGenericVTTResponse', createDisneyMessage],
        ['Netflix', 'createNetflixVTTResponse', createNetflixMessage],
    ])(
        'hard-rejects a forged %s direct service helper call without raw traversal',
        async (_platform, methodName, createMessage) => {
            createChromeHarness();
            const subtitleService = {
                processDisneyPlusSubtitles: jest.fn(),
                processNetflixSubtitles: jest.fn(),
            };
            const handler = new MessageHandler();
            handler.initialize();
            handler.setServices({ subtitleService });
            handler.logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };
            let rawReads = 0;
            const forgedMessage = new Proxy(createMessage(), {
                get() {
                    rawReads += 1;
                    throw new Error('RAW_MARKER');
                },
                ownKeys() {
                    rawReads += 1;
                    throw new Error('RAW_MARKER');
                },
                getOwnPropertyDescriptor() {
                    rawReads += 1;
                    throw new Error('RAW_MARKER');
                },
            });

            const expectedRejection = {
                success: false,
                error: 'Subtitle request rejected',
            };

            await expect(handler[methodName](createMessage())).resolves.toEqual(
                expectedRejection
            );
            await expect(handler[methodName](forgedMessage)).resolves.toEqual(
                expectedRejection
            );

            expect(rawReads).toBe(0);
            expect(
                subtitleService.processDisneyPlusSubtitles
            ).not.toHaveBeenCalled();
            expect(
                subtitleService.processNetflixSubtitles
            ).not.toHaveBeenCalled();
            expect(handler.logger.warn).not.toHaveBeenCalled();
            expect(handler.logger.error).not.toHaveBeenCalled();
        }
    );

    test('preserves exact branded Disney and Netflix snapshot identity', async () => {
        createChromeHarness();
        const disneyResult = createDisneyServiceResult();
        const netflixResult = createNetflixServiceResult();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(disneyResult),
            processNetflixSubtitles: jest.fn().mockResolvedValue(netflixResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const disneySnapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createDisneySender()
        );
        const netflixSnapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        await expect(
            handler.createGenericVTTResponse(disneySnapshot)
        ).resolves.toMatchObject({ success: true, videoId: 'episode-123' });
        await expect(
            handler.createNetflixVTTResponse(netflixSnapshot)
        ).resolves.toMatchObject({ success: true, videoId: '80123456' });

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        expect(subtitleService.processDisneyPlusSubtitles).toHaveBeenCalledWith(
            disneySnapshot
        );
        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledTimes(
            1
        );
        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledWith(
            netflixSnapshot
        );

        subtitleService.processDisneyPlusSubtitles.mockClear();
        subtitleService.processNetflixSubtitles.mockClear();
        await expect(
            handler.createGenericVTTResponse(netflixSnapshot)
        ).resolves.toEqual({
            success: false,
            error: 'Subtitle request rejected',
        });
        await expect(
            handler.createNetflixVTTResponse(disneySnapshot)
        ).resolves.toEqual({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(subtitleService.processNetflixSubtitles).not.toHaveBeenCalled();
    });

    test('projects a Disney service result into the exact privacy-safe success envelope', async () => {
        createChromeHarness();
        const signedUrlCanary =
            'https://captions.media.dssott.com/private/master.m3u8?token=DISNEY_SECRET';
        const serviceResult = {
            vttText: 'WEBVTT original',
            targetVttText: 'WEBVTT target',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: true,
            url: signedUrlCanary,
            availableLanguages: [
                {
                    normalizedCode: 'en',
                    displayName: 'English',
                    downloadUrl: signedUrlCanary,
                    uri: signedUrlCanary,
                    futureLanguageSecret: signedUrlCanary,
                },
            ],
            selectedLanguage: 'en',
            targetLanguageInfo: {
                normalizedCode: 'zh-CN',
                uri: signedUrlCanary,
            },
            processingTime: 47,
            extraSecret: signedUrlCanary,
            futureOwnField: signedUrlCanary,
        };
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createDisneySender()
        );

        const response = await handler.createGenericVTTResponse(snapshot);

        expect(response).toEqual({
            success: true,
            vttText: 'WEBVTT original',
            targetVttText: 'WEBVTT target',
            videoId: 'episode-123',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: true,
            selectedLanguage: {
                normalizedCode: 'en',
                displayName: 'English',
            },
        });
        expect(Object.keys(response)).toEqual([
            'success',
            'vttText',
            'targetVttText',
            'videoId',
            'sourceLanguage',
            'targetLanguage',
            'useNativeTarget',
            'selectedLanguage',
        ]);
        expect(response.selectedLanguage).not.toBe(
            serviceResult.availableLanguages[0]
        );
        expect(serviceResult.availableLanguages[0].uri).toBe(signedUrlCanary);
        expect(JSON.stringify(response)).not.toContain('DISNEY_SECRET');
    });

    test('projects a Netflix service result into the exact privacy-safe success envelope', async () => {
        createChromeHarness();
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/en.ttml?token=NETFLIX_SECRET';
        const serviceResult = {
            vttText: 'WEBVTT original',
            targetVttText: null,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            url: signedUrlCanary,
            availableLanguages: [
                {
                    normalizedCode: 'en',
                    displayName: 'English CC',
                    downloadUrl: signedUrlCanary,
                    uri: signedUrlCanary,
                    futureLanguageSecret: signedUrlCanary,
                },
            ],
            selectedLanguage: {
                normalizedCode: 'forged',
                displayName: signedUrlCanary,
                uri: signedUrlCanary,
            },
            targetLanguageInfo: { uri: signedUrlCanary },
            processingTime: 91,
            extraSecret: signedUrlCanary,
            futureOwnField: signedUrlCanary,
        };
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response).toEqual({
            success: true,
            vttText: 'WEBVTT original',
            targetVttText: null,
            videoId: '80123456',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            selectedLanguage: {
                normalizedCode: 'en',
                displayName: 'English CC',
            },
        });
        expect(Object.keys(response)).toEqual([
            'success',
            'vttText',
            'targetVttText',
            'videoId',
            'sourceLanguage',
            'targetLanguage',
            'useNativeTarget',
            'selectedLanguage',
        ]);
        expect(response.selectedLanguage).not.toBe(
            serviceResult.availableLanguages[0]
        );
        expect(serviceResult.availableLanguages[0].uri).toBe(signedUrlCanary);
        expect(JSON.stringify(response)).not.toContain('NETFLIX_SECRET');
    });

    test('uses the normalized source code when the service inventory has no matching display name', async () => {
        createChromeHarness();
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(
                createNetflixServiceResult({
                    availableLanguages: [
                        {
                            normalizedCode: 'fr',
                            displayName: 'French',
                        },
                    ],
                    selectedLanguage: {
                        normalizedCode: 'forged',
                        displayName: 'Forged',
                    },
                })
            ),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response.selectedLanguage).toEqual({
            normalizedCode: 'en',
            displayName: 'en',
        });
    });

    test('uses the normalized source code when the service omits its language inventory', async () => {
        createChromeHarness();
        const serviceResult = createNetflixServiceResult();
        delete serviceResult.availableLanguages;
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response.selectedLanguage).toEqual({
            normalizedCode: 'en',
            displayName: 'en',
        });
    });

    test('fails closed when a subtitle service resolves object-valued primitive fields', async () => {
        createChromeHarness();
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(
                createNetflixServiceResult({
                    vttText: {
                        extraSecret:
                            'https://captions.nflxvideo.net/private?token=NESTED_SECRET',
                    },
                })
            ),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
        expect(JSON.stringify(response)).not.toContain('NESTED_SECRET');
    });

    test('rejects accessor-backed subtitle result fields without invoking them', async () => {
        createChromeHarness();
        const sourceLanguageGetter = jest.fn(() => 'en');
        const serviceResult = createNetflixServiceResult();
        Object.defineProperty(serviceResult, 'sourceLanguage', {
            configurable: true,
            enumerable: true,
            get: sourceLanguageGetter,
        });
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(sourceLanguageGetter).not.toHaveBeenCalled();
        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
    });

    test('rejects accessor-backed available-language entries without invoking them', async () => {
        createChromeHarness();
        const displayNameGetter = jest.fn(() => 'English');
        const matchingLanguage = { normalizedCode: 'en' };
        Object.defineProperty(matchingLanguage, 'displayName', {
            configurable: true,
            enumerable: true,
            get: displayNameGetter,
        });
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(
                createNetflixServiceResult({
                    availableLanguages: [matchingLanguage],
                })
            ),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(displayNameGetter).not.toHaveBeenCalled();
        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
    });

    test('rejects exotic available-language records even when their fields look valid', async () => {
        createChromeHarness();
        const exoticLanguage = new Date(0);
        Object.defineProperties(exoticLanguage, {
            normalizedCode: {
                configurable: true,
                enumerable: true,
                value: 'en',
            },
            displayName: {
                configurable: true,
                enumerable: true,
                value: 'English',
            },
        });
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(
                createNetflixServiceResult({
                    availableLanguages: [exoticLanguage],
                })
            ),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
    });

    test.each([
        ['target VTT', { targetVttText: { extraSecret: 'TYPE_SECRET' } }],
        ['source language', { sourceLanguage: ['TYPE_SECRET'] }],
        ['target language', { targetLanguage: 7 }],
        ['native-target flag', { useNativeTarget: 'false' }],
    ])(
        'fails closed on a noncanonical %s service field',
        async (_label, overrides) => {
            createChromeHarness();
            const subtitleService = {
                processNetflixSubtitles: jest
                    .fn()
                    .mockResolvedValue(createNetflixServiceResult(overrides)),
            };
            const handler = new MessageHandler();
            handler.initialize();
            handler.setServices({ subtitleService });
            handler.logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };
            const snapshot = authorizeSubtitleRequest(
                createNetflixMessage(),
                createNetflixSender()
            );

            const response = await handler.createNetflixVTTResponse(snapshot);

            expect(response).toEqual({
                success: false,
                error: 'Subtitle processing failed',
                videoId: '80123456',
            });
            expect(JSON.stringify(response)).not.toContain('TYPE_SECRET');
        }
    );

    test('fails closed when a service result proxy throws during descriptor inspection', async () => {
        createChromeHarness();
        const serviceResult = new Proxy(createNetflixServiceResult(), {
            getOwnPropertyDescriptor() {
                throw new Error('PROXY_RESULT_SECRET');
            },
        });
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
        expect(JSON.stringify(response)).not.toContain('PROXY_RESULT_SECRET');
    });

    test('rejects a callable service result even when it carries valid-looking fields', async () => {
        createChromeHarness();
        const serviceResult = Object.assign(
            () => 'EXOTIC_RESULT_SECRET',
            createNetflixServiceResult()
        );
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
        expect(JSON.stringify(response)).not.toContain('EXOTIC_RESULT_SECRET');
    });

    test.each([
        [
            'custom prototype',
            () =>
                Object.assign(
                    Object.create({
                        inheritedSecret: 'EXOTIC_TOP_LEVEL_SECRET',
                    }),
                    createNetflixServiceResult()
                ),
        ],
        ['array', () => Object.assign([], createNetflixServiceResult())],
        [
            'Date',
            () => Object.assign(new Date(0), createNetflixServiceResult()),
        ],
    ])(
        'rejects a top-level service result with an exotic %s',
        async (_label, createServiceResult) => {
            createChromeHarness();
            const subtitleService = {
                processNetflixSubtitles: jest
                    .fn()
                    .mockResolvedValue(createServiceResult()),
            };
            const handler = new MessageHandler();
            handler.initialize();
            handler.setServices({ subtitleService });
            handler.logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };
            const snapshot = authorizeSubtitleRequest(
                createNetflixMessage(),
                createNetflixSender()
            );

            const response = await handler.createNetflixVTTResponse(snapshot);

            expect(response).toEqual({
                success: false,
                error: 'Subtitle processing failed',
                videoId: '80123456',
            });
            expect(JSON.stringify(response)).not.toContain(
                'EXOTIC_TOP_LEVEL_SECRET'
            );
        }
    );

    test('accepts a null-prototype service result with canonical own data fields', async () => {
        createChromeHarness();
        const serviceResult = Object.assign(
            Object.create(null),
            createNetflixServiceResult()
        );
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response).toEqual({
            success: true,
            vttText: 'WEBVTT',
            targetVttText: null,
            videoId: '80123456',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            selectedLanguage: {
                normalizedCode: 'en',
                displayName: 'English',
            },
        });
    });

    test('rejects an accessor-backed language inventory without invoking it', async () => {
        createChromeHarness();
        const availableLanguagesGetter = jest.fn(() => []);
        const serviceResult = createNetflixServiceResult();
        Object.defineProperty(serviceResult, 'availableLanguages', {
            configurable: true,
            enumerable: true,
            get: availableLanguagesGetter,
        });
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(availableLanguagesGetter).not.toHaveBeenCalled();
        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
    });

    test('fails closed on a revoked language-inventory proxy', async () => {
        createChromeHarness();
        const { proxy, revoke } = Proxy.revocable([], {});
        const serviceResult = createNetflixServiceResult({
            availableLanguages: proxy,
        });
        revoke();
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(serviceResult),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
    });

    test('returns a fixed Disney processing failure without exposing error or URL details', async () => {
        createChromeHarness();
        const signedUrlCanary =
            'https://captions.media.dssott.com/private/master.m3u8?token=DISNEY_ERROR_SECRET';
        const serviceError = new Error(`fetch failed: ${signedUrlCanary}`, {
            cause: { signedUrlCanary },
        });
        serviceError.stack = `STACK ${signedUrlCanary}`;
        serviceError.extraSecret = signedUrlCanary;
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(() => {
                throw serviceError;
            }),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage({ url: signedUrlCanary }),
            createDisneySender()
        );

        const response = await handler.createGenericVTTResponse(snapshot);

        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: 'episode-123',
        });
        expect(Object.keys(response)).toEqual(['success', 'error', 'videoId']);
        expect(JSON.stringify(response)).not.toContain('DISNEY_ERROR_SECRET');
        expect(handler.logger.error).toHaveBeenCalledWith(
            'Disney VTT processing failed',
            null,
            {
                stage: 'unknown',
                errorCode: 'DISNEY_SUBTITLE_PROCESSING_FAILED',
                source: 'disneyplus',
                hasVideoId: true,
            }
        );
        expect(handler.logger.error.mock.calls.flat()).not.toContain(
            serviceError
        );
        const serializedLoggerCalls = JSON.stringify(
            handler.logger.error.mock.calls
        );
        expect(serializedLoggerCalls).not.toContain('DISNEY_ERROR_SECRET');
        expect(serializedLoggerCalls).not.toContain('/private/master.m3u8');
        expect(serializedLoggerCalls).not.toContain('token=');
    });

    test('returns a fixed Netflix processing failure without exposing error details', async () => {
        createChromeHarness();
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/en.ttml?token=NETFLIX_ERROR_SECRET';
        const serviceError = new Error(`fetch failed: ${signedUrlCanary}`, {
            cause: { signedUrlCanary },
        });
        serviceError.stack = `STACK ${signedUrlCanary}`;
        serviceError.extraSecret = signedUrlCanary;
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockRejectedValue(serviceError),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );

        const response = await handler.createNetflixVTTResponse(snapshot);

        expect(response).toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
        expect(Object.keys(response)).toEqual(['success', 'error', 'videoId']);
        expect(JSON.stringify(response)).not.toContain('NETFLIX_ERROR_SECRET');
        expect(handler.logger.error).toHaveBeenCalledWith(
            'Netflix VTT processing failed',
            null,
            {
                stage: 'process',
                source: 'netflix',
                hasVideoId: true,
            }
        );
        expect(handler.logger.error.mock.calls.flat()).not.toContain(
            serviceError
        );
        const serializedLoggerCalls = JSON.stringify(
            handler.logger.error.mock.calls
        );
        expect(serializedLoggerCalls).not.toContain('NETFLIX_ERROR_SECRET');
        expect(serializedLoggerCalls).not.toContain('/private/en.ttml');
        expect(serializedLoggerCalls).not.toContain('token=');
    });

    test('passes an internal direct-call signal beside the exact Disney snapshot', async () => {
        createChromeHarness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(createDisneyServiceResult()),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createDisneySender()
        );
        const controller = new AbortController();
        const coercionGetter = jest.fn(() => {
            throw new Error('PRIVATE_DISNEY_OPTIONS_COERCION_CANARY');
        });
        const iteratorGetter = jest.fn(() => {
            throw new Error('PRIVATE_DISNEY_OPTIONS_ITERATOR_CANARY');
        });
        const options = { signal: controller.signal };
        Object.defineProperties(options, {
            [Symbol.toPrimitive]: { get: coercionGetter },
            [Symbol.iterator]: { get: iteratorGetter },
        });

        await handler.createGenericVTTResponse(snapshot, options);

        expect(subtitleService.processDisneyPlusSubtitles).toHaveBeenCalledWith(
            snapshot,
            { signal: controller.signal }
        );
        expect(coercionGetter).not.toHaveBeenCalled();
        expect(iteratorGetter).not.toHaveBeenCalled();
    });

    test('passes an internal direct-call signal beside the exact Netflix snapshot', async () => {
        createChromeHarness();
        const subtitleService = {
            processNetflixSubtitles: jest
                .fn()
                .mockResolvedValue(createNetflixServiceResult()),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );
        const controller = new AbortController();

        await handler.createNetflixVTTResponse(snapshot, {
            signal: controller.signal,
        });

        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledWith(
            snapshot,
            { signal: controller.signal }
        );
    });

    test.each([
        ['an unbranded snapshot', () => createDisneyMessage()],
        [
            'a branded cross-source snapshot',
            () =>
                authorizeSubtitleRequest(
                    createNetflixMessage(),
                    createNetflixSender()
                ),
        ],
    ])(
        'rejects %s before reading hostile internal Disney options',
        async (_scenario, createSnapshot) => {
            createChromeHarness();
            const subtitleService = {
                processDisneyPlusSubtitles: jest.fn(),
            };
            const handler = new MessageHandler();
            handler.initialize();
            handler.setServices({ subtitleService });
            handler.logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };
            const signalGetter = jest.fn(() => {
                throw new Error('PRIVATE_DISNEY_AUTHORITY_ORDER_CANARY');
            });
            const options = {};
            Object.defineProperty(options, 'signal', {
                configurable: true,
                enumerable: true,
                get: signalGetter,
            });

            await expect(
                handler.createGenericVTTResponse(createSnapshot(), options)
            ).resolves.toEqual({
                success: false,
                error: 'Subtitle request rejected',
            });

            expect(signalGetter).not.toHaveBeenCalled();
            expect(
                subtitleService.processDisneyPlusSubtitles
            ).not.toHaveBeenCalled();
            expect(handler.logger.warn).not.toHaveBeenCalled();
            expect(handler.logger.error).not.toHaveBeenCalled();
        }
    );

    test.each([
        [
            'an accessor-backed signal',
            () => {
                const signalGetter = jest.fn(() => {
                    throw new Error('PRIVATE_DISNEY_SIGNAL_ACCESSOR_CANARY');
                });
                const options = {};
                Object.defineProperty(options, 'signal', {
                    configurable: true,
                    enumerable: true,
                    get: signalGetter,
                });
                return {
                    options,
                    verify: () => expect(signalGetter).not.toHaveBeenCalled(),
                };
            },
        ],
        [
            'a throwing descriptor trap',
            () => {
                const descriptorTrap = jest.fn(() => {
                    throw new Error('PRIVATE_DISNEY_DESCRIPTOR_TRAP_CANARY');
                });
                return {
                    options: new Proxy(
                        {},
                        { getOwnPropertyDescriptor: descriptorTrap }
                    ),
                    verify: () =>
                        expect(descriptorTrap).toHaveBeenCalledTimes(1),
                };
            },
        ],
        [
            'a revoked options proxy',
            () => {
                const { proxy, revoke } = Proxy.revocable({}, {});
                revoke();
                return { options: proxy, verify: () => {} };
            },
        ],
    ])(
        'fails Disney subtitle processing safely for %s',
        async (_scenario, createOptions) => {
            createChromeHarness();
            const subtitleService = {
                processDisneyPlusSubtitles: jest
                    .fn()
                    .mockResolvedValue(createDisneyServiceResult()),
            };
            const handler = new MessageHandler();
            handler.initialize();
            handler.setServices({ subtitleService });
            handler.logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };
            const snapshot = authorizeSubtitleRequest(
                createDisneyMessage(),
                createDisneySender()
            );
            const { options, verify } = createOptions();

            await expect(
                handler.createGenericVTTResponse(snapshot, options)
            ).resolves.toEqual({
                success: false,
                error: 'Subtitle processing failed',
                videoId: 'episode-123',
            });

            verify();
            expect(
                subtitleService.processDisneyPlusSubtitles
            ).not.toHaveBeenCalled();
        }
    );

    test('ignores an inherited internal Netflix signal without consulting it', async () => {
        createChromeHarness();
        const subtitleService = {
            processNetflixSubtitles: jest
                .fn()
                .mockResolvedValue(createNetflixServiceResult()),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );
        const signalGetter = jest.fn(() => {
            throw new Error('PRIVATE_INHERITED_HANDLER_SIGNAL');
        });
        const prototype = {};
        Object.defineProperty(prototype, 'signal', {
            configurable: true,
            get: signalGetter,
        });

        await handler.createNetflixVTTResponse(
            snapshot,
            Object.create(prototype)
        );

        expect(signalGetter).not.toHaveBeenCalled();
        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledWith(
            snapshot
        );
    });

    test('rejects a cross-source direct Netflix call before reading hostile options', async () => {
        createChromeHarness();
        const subtitleService = { processNetflixSubtitles: jest.fn() };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const disneySnapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createDisneySender()
        );
        const signalGetter = jest.fn(() => {
            throw new Error('PRIVATE_CROSS_SOURCE_HANDLER_SIGNAL');
        });
        const options = {};
        Object.defineProperty(options, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });

        await expect(
            handler.createNetflixVTTResponse(disneySnapshot, options)
        ).resolves.toEqual({
            success: false,
            error: 'Subtitle request rejected',
        });

        expect(signalGetter).not.toHaveBeenCalled();
        expect(subtitleService.processNetflixSubtitles).not.toHaveBeenCalled();
    });

    test('rejects an accessor-backed internal Netflix signal without invoking it', async () => {
        createChromeHarness();
        const subtitleService = { processNetflixSubtitles: jest.fn() };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const snapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createNetflixSender()
        );
        const signalGetter = jest.fn(() => {
            throw new Error('PRIVATE_INTERNAL_HANDLER_SIGNAL');
        });
        const options = {};
        Object.defineProperty(options, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });

        await expect(
            handler.createNetflixVTTResponse(snapshot, options)
        ).resolves.toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });

        expect(signalGetter).not.toHaveBeenCalled();
        expect(subtitleService.processNetflixSubtitles).not.toHaveBeenCalled();
    });

    test('rejects a runtime Netflix message signal without invoking its getter', () => {
        const listeners = createChromeHarness();
        const subtitleService = { processNetflixSubtitles: jest.fn() };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        const message = createNetflixMessage();
        const signalGetter = jest.fn(() => {
            throw new Error('PRIVATE_RUNTIME_SIGNAL');
        });
        Object.defineProperty(message, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });
        const sendResponse = jest.fn();

        const keepsOpen = listeners[0](
            message,
            createNetflixSender(),
            sendResponse
        );

        expect(keepsOpen).toBe(false);
        expect(signalGetter).not.toHaveBeenCalled();
        expect(subtitleService.processNetflixSubtitles).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
    });

    test.each([
        [
            'throwing descriptor proxy',
            () =>
                new Proxy(createDisneyMessage(), {
                    getOwnPropertyDescriptor() {
                        throw new Error('RAW_MARKER');
                    },
                }),
        ],
        [
            'revoked proxy',
            () => {
                const { proxy, revoke } = Proxy.revocable(
                    createDisneyMessage(),
                    {}
                );
                revoke();
                return proxy;
            },
        ],
    ])(
        'fixed-rejects a %s at action classification without readiness',
        (_label, createMessage) => {
            const listeners = createChromeHarness();
            const readiness = new BackgroundServiceReadiness();
            const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
            const subtitleService = {
                processDisneyPlusSubtitles: jest.fn(),
            };
            const handler = new MessageHandler();
            handler.initialize(readiness);
            handler.setServices({ subtitleService });
            const sendResponse = jest.fn();

            const keepsOpen = listeners[0](
                createMessage(),
                createDisneySender(),
                sendResponse
            );

            expect(keepsOpen).toBe(false);
            expect(waitUntilReady).not.toHaveBeenCalled();
            expect(
                subtitleService.processDisneyPlusSubtitles
            ).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Invalid message',
            });
        }
    );

    test('does not reread a transparent proxy after synchronous authorization', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(createDisneyServiceResult()),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        const rawMessage = createDisneyMessage();
        const { proxy, revoke } = Proxy.revocable(rawMessage, {});
        const sendResponse = jest.fn();

        listeners[0](proxy, createDisneySender(), sendResponse);
        revoke();
        rawMessage.url = `${DISNEY_SUBTITLE_URL}?marker=RAW_MARKER`;
        readiness.markReady();
        await readiness.waitUntilReady();
        await flushAsyncHandling();

        const [snapshot, options] =
            subtitleService.processDisneyPlusSubtitles.mock.calls[0];
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
        expect(snapshot).toMatchObject({
            url: DISNEY_SUBTITLE_URL,
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        });
        expect(options).toEqual({ signal: expect.anything() });
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.signal.aborted).toBe(false);
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('rejects a cold inexact readiness lookalike without raw reclassification', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const ingress = jest.spyOn(handler, 'handleSubtitleRequestIngress');
        let actionDescriptorReads = 0;
        let rawPayloadReads = 0;
        const message = new Proxy(
            createDisneyMessage({
                url: `${DISNEY_SUBTITLE_URL}?marker=RAW_MARKER`,
            }),
            {
                getOwnPropertyDescriptor(target, key) {
                    const descriptor = Reflect.getOwnPropertyDescriptor(
                        target,
                        key
                    );
                    if (key !== 'action') return descriptor;
                    actionDescriptorReads += 1;
                    return {
                        ...descriptor,
                        value:
                            actionDescriptorReads === 1
                                ? MessageActions.PING
                                : MessageActions.FETCH_VTT,
                    };
                },
                get(target, key, receiver) {
                    if (key === 'action' || key === 'url' || key === 'data') {
                        rawPayloadReads += 1;
                        throw new Error('RAW_MARKER');
                    }
                    return Reflect.get(target, key, receiver);
                },
            }
        );
        const sendResponse = jest.fn();

        const keepsOpen = listeners[0](
            message,
            createDisneySender(),
            sendResponse
        );

        expect(actionDescriptorReads).toBe(1);
        expect(rawPayloadReads).toBe(0);
        expect(keepsOpen).toBe(false);
        expect(ingress).not.toHaveBeenCalled();
        expect(waitUntilReady).not.toHaveBeenCalled();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Invalid message',
        });

        readiness.markReady();
        await flushAsyncHandling();

        expect(actionDescriptorReads).toBe(1);
        expect(rawPayloadReads).toBe(0);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expectNoRawMarker(handler.logger.debug.mock.calls);
        expectNoRawMarker(handler.logger.warn.mock.calls);
        expectNoRawMarker(handler.logger.error.mock.calls);
    });

    test('keeps an initial listener FETCH action on policy ingress when a proxy later reports non-FETCH', () => {
        const listeners = createChromeHarness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const ingress = jest.spyOn(handler, 'handleSubtitleRequestIngress');
        const genericDispatch = jest.spyOn(handler, 'handleMessage');
        let actionDescriptorReads = 0;
        let rawPayloadReads = 0;
        const message = new Proxy(createDisneyMessage(), {
            getOwnPropertyDescriptor(target, key) {
                const descriptor = Reflect.getOwnPropertyDescriptor(
                    target,
                    key
                );
                if (key !== 'action') return descriptor;
                actionDescriptorReads += 1;
                return {
                    ...descriptor,
                    value:
                        actionDescriptorReads === 1
                            ? MessageActions.FETCH_VTT
                            : MessageActions.PING,
                };
            },
            get(target, key, receiver) {
                if (key === 'action' || key === 'url' || key === 'data') {
                    rawPayloadReads += 1;
                    throw new Error('RAW_MARKER');
                }
                return Reflect.get(target, key, receiver);
            },
        });
        const sendResponse = jest.fn();

        const keepsOpen = listeners[0](
            message,
            createDisneySender(),
            sendResponse
        );

        expect(actionDescriptorReads).toBe(3);
        expect(rawPayloadReads).toBe(0);
        expect(keepsOpen).toBe(false);
        expect(ingress).toHaveBeenCalledTimes(1);
        expect(genericDispatch).not.toHaveBeenCalled();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expectNoRawMarker(handler.logger.debug.mock.calls);
        expectNoRawMarker(handler.logger.warn.mock.calls);
        expectNoRawMarker(handler.logger.error.mock.calls);
    });

    test.each([
        [MessageActions.PING, MessageActions.FETCH_VTT],
        [MessageActions.FETCH_VTT, MessageActions.PING],
    ])(
        'direct handleMessage pins %s when a proxy later reports %s',
        (firstAction, laterAction) => {
            createChromeHarness();
            const subtitleService = {
                processDisneyPlusSubtitles: jest.fn(),
            };
            const handler = new MessageHandler();
            handler.initialize();
            handler.setServices({ subtitleService });
            handler.logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };
            const ingress = jest.spyOn(handler, 'handleSubtitleRequestIngress');
            let actionDescriptorReads = 0;
            let rawPayloadReads = 0;
            const message = new Proxy(createDisneyMessage(), {
                getOwnPropertyDescriptor(target, key) {
                    const descriptor = Reflect.getOwnPropertyDescriptor(
                        target,
                        key
                    );
                    if (key !== 'action') return descriptor;
                    actionDescriptorReads += 1;
                    return {
                        ...descriptor,
                        value:
                            actionDescriptorReads === 1
                                ? firstAction
                                : laterAction,
                    };
                },
                get(target, key, receiver) {
                    if (key === 'action' || key === 'url' || key === 'data') {
                        rawPayloadReads += 1;
                        throw new Error('RAW_MARKER');
                    }
                    return Reflect.get(target, key, receiver);
                },
            });
            const sendResponse = jest.fn();

            const keepsOpen = handler.handleMessage(
                message,
                createDisneySender(),
                sendResponse
            );

            expect(actionDescriptorReads).toBe(1);
            expect(rawPayloadReads).toBe(0);
            expect(ingress).not.toHaveBeenCalled();
            expect(
                subtitleService.processDisneyPlusSubtitles
            ).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(keepsOpen).toBe(false);
            expect(sendResponse).toHaveBeenCalledWith(
                firstAction === MessageActions.PING
                    ? { success: false, error: 'Invalid message' }
                    : {
                          success: false,
                          error: 'Subtitle request rejected',
                      }
            );
            expectNoRawMarker(handler.logger.debug.mock.calls);
            expectNoRawMarker(handler.logger.warn.mock.calls);
            expectNoRawMarker(handler.logger.error.mock.calls);
        }
    );

    test('allows an exact duplicate at global capacity but reauthorizes an invalid lookalike', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = { processDisneyPlusSubtitles: jest.fn() };
        const handler = new MessageHandler();
        const admission = jest.spyOn(handler, 'admitAuthorizedSubtitleRequest');
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const responders = Array.from({ length: 10 }, () => jest.fn());

        for (let index = 0; index < 8; index += 1) {
            listeners[0](
                createDisneyMessage({
                    url: `https://captions.media.dssott.com/show/held-${index}.m3u8`,
                }),
                createDisneySender({
                    tab: { id: 200 + index, url: DISNEY_PAGE_URL },
                }),
                responders[index]
            );
        }
        const duplicateKeepsOpen = listeners[0](
            createDisneyMessage({
                url: 'https://captions.media.dssott.com/show/held-0.m3u8',
            }),
            createDisneySender({
                tab: { id: 200, url: DISNEY_PAGE_URL },
            }),
            responders[8]
        );
        const invalidKeepsOpen = listeners[0](
            createDisneyMessage({
                url: 'https://captions.media.dssott.com/show/held-0.m3u8',
            }),
            createDisneySender({
                id: 'RAW_MARKER',
                tab: { id: 200, url: DISNEY_PAGE_URL },
            }),
            responders[9]
        );

        expect(duplicateKeepsOpen).toBe(true);
        expect(invalidKeepsOpen).toBe(false);
        expect(admission).toHaveBeenCalledTimes(9);
        expect(waitUntilReady).toHaveBeenCalledTimes(8);
        expect(responders[8]).not.toHaveBeenCalled();
        expect(responders[9]).toHaveBeenCalledTimes(1);
        expect(responders[9]).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(handler.logger.warn).toHaveBeenCalledTimes(1);
        expect(handler.logger.warn).toHaveBeenCalledWith(
            'Subtitle request rejected',
            { stage: 'authorize' }
        );

        handler.destroy();
        for (const responder of responders.slice(0, 9)) {
            expect(responder).toHaveBeenCalledTimes(1);
            expect(responder).toHaveBeenCalledWith({
                success: false,
                error: 'Background services unavailable',
            });
        }
        expect(responders[8].mock.calls[0][0]).toBe(
            responders[0].mock.calls[0][0]
        );
        expect(responders[9]).toHaveBeenCalledTimes(1);

        readiness.markReady();
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        for (const responder of responders) {
            expect(responder).toHaveBeenCalledTimes(1);
        }
    });

    test('bounds eight active flights to eight responders each', async () => {
        const listeners = createChromeHarness();
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.initialize(readiness);
        handler.setServices({ subtitleService });
        handler.logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        const acceptedResponders = [];

        for (let flightIndex = 0; flightIndex < 8; flightIndex += 1) {
            for (
                let responderIndex = 0;
                responderIndex < 8;
                responderIndex += 1
            ) {
                const responder = jest.fn();
                acceptedResponders.push(responder);
                expect(
                    listeners[0](
                        createDisneyMessage({
                            url: `https://captions.media.dssott.com/show/bounded-${flightIndex}.m3u8`,
                        }),
                        createDisneySender({
                            tab: {
                                id: 300 + flightIndex,
                                url: DISNEY_PAGE_URL,
                            },
                        }),
                        responder
                    )
                ).toBe(true);
            }
        }
        const excessResponse = jest.fn();
        const excessKeepsOpen = listeners[0](
            createDisneyMessage({
                url: 'https://captions.media.dssott.com/show/bounded-0.m3u8',
            }),
            createDisneySender({
                tab: { id: 300, url: DISNEY_PAGE_URL },
            }),
            excessResponse
        );

        expect(acceptedResponders).toHaveLength(64);
        expect(waitUntilReady).toHaveBeenCalledTimes(8);
        expect(excessKeepsOpen).toBe(false);
        expect(excessResponse).toHaveBeenCalledTimes(1);
        expect(excessResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(handler.logger.warn).toHaveBeenCalledWith(
            'Subtitle request capacity reached',
            {
                stage: 'admission',
                scope: 'responders',
                tabId: 300,
                source: 'disneyplus',
                count: 8,
            }
        );

        handler.destroy();
        for (const responder of acceptedResponders) {
            expect(responder).toHaveBeenCalledTimes(1);
            expect(responder).toHaveBeenCalledWith({
                success: false,
                error: 'Background services unavailable',
            });
        }
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();

        readiness.markReady();
        await flushAsyncHandling();

        for (const responder of acceptedResponders) {
            expect(responder).toHaveBeenCalledTimes(1);
        }
        expect(excessResponse).toHaveBeenCalledTimes(1);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
    });
});
