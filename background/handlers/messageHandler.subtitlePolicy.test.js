import { jest } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
import { BackgroundServiceReadiness } from '../serviceReadiness.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import { isAuthorizedSubtitleRequestSnapshot } from '../utils/subtitleRequestPolicy.js';

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

function createDisneyServiceResult(overrides = {}) {
    return {
        vttText: 'WEBVTT',
        targetVttText: null,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeTarget: false,
        availableLanguages: [],
        selectedLanguage: 'en',
        targetLanguageInfo: null,
        ...overrides,
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

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function createHandler({ subtitleService, readiness } = {}) {
    const listeners = createChromeHarness();
    const handler = new MessageHandler();
    if (subtitleService) handler.setServices({ subtitleService });
    handler.initialize(readiness);
    handler.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    return { handler, listener: listeners[0] };
}

function dispatchSubtitle(listener, message, sender) {
    const sendResponse = jest.fn();
    const response = new Promise((resolve) => {
        sendResponse.mockImplementation(resolve);
    });
    const keepsChannelOpen = listener(message, sender, sendResponse);
    return { keepsChannelOpen, response, sendResponse };
}

function createDisneyRoute(index, tabId = 17) {
    const videoId = `episode-${index}`;
    const pageUrl = `https://www.disneyplus.com/video/${videoId}`;
    return {
        message: createDisneyMessage({
            url: `https://captions.media.dssott.com/show/${index}.m3u8`,
            videoId,
        }),
        sender: createDisneySender({
            tab: { id: tabId, url: pageUrl },
            url: pageUrl,
            origin: new URL(pageUrl).origin,
        }),
    };
}

async function flushAsyncHandling() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('MessageHandler subtitle request policy ingress', () => {
    test('authorizes and detaches a cold Disney request before readiness', async () => {
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(createDisneyServiceResult()),
        };
        const { listener } = createHandler({ subtitleService, readiness });
        const message = createDisneyMessage();
        const sender = createDisneySender();
        const sendResponse = jest.fn();

        expect(listener(message, sender, sendResponse)).toBe(true);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        message.url = `${DISNEY_SUBTITLE_URL}?mutated=true`;
        message.targetLanguage = 'fr';
        sender.tab.url = 'https://attacker.example/';

        readiness.markReady();
        await readiness.waitUntilReady();
        await flushAsyncHandling();

        const [snapshot, options] =
            subtitleService.processDisneyPlusSubtitles.mock.calls[0];
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
        expect(snapshot).toMatchObject({
            url: DISNEY_SUBTITLE_URL,
            targetLanguage: 'zh-CN',
            tabId: 17,
        });
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ success: true, videoId: 'episode-123' })
        );
    });

    test('rejects unauthorized ingress before readiness or service work', () => {
        const readiness = new BackgroundServiceReadiness();
        const waitUntilReady = jest.spyOn(readiness, 'waitUntilReady');
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const { listener } = createHandler({ subtitleService, readiness });
        const sendResponse = jest.fn();

        expect(
            listener(
                createDisneyMessage(),
                createDisneySender({ id: 'wrong-extension' }),
                sendResponse
            )
        ).toBe(false);
        expect(waitUntilReady).not.toHaveBeenCalled();
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
    });

    test('returns one redacted readiness failure', async () => {
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const { handler, listener } = createHandler({
            subtitleService,
            readiness,
        });
        const message = createDisneyMessage();
        const sender = createDisneySender();
        const sendResponse = jest.fn();

        expect(listener(message, sender, sendResponse)).toBe(true);
        message.url = `${DISNEY_SUBTITLE_URL}?token=RAW_MARKER`;
        sender.url = 'https://attacker.example/RAW_MARKER';
        readiness.markFailed(new Error('RAW_MARKER'));
        await readiness.waitUntilReady().catch(() => {});
        await flushAsyncHandling();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Background services unavailable',
        });
        expect(
            JSON.stringify([
                sendResponse.mock.calls,
                handler.logger.error.mock.calls,
            ])
        ).not.toContain('RAW_MARKER');
    });

    test.each([
        {
            platform: 'Disney+',
            createMessage: createDisneyMessage,
            createSender: createDisneySender,
            serviceMethod: 'processDisneyPlusSubtitles',
            createResult: createDisneyServiceResult,
            videoId: 'episode-123',
        },
        {
            platform: 'Netflix',
            createMessage: createNetflixMessage,
            createSender: createNetflixSender,
            serviceMethod: 'processNetflixSubtitles',
            createResult: createNetflixServiceResult,
            videoId: '80123456',
        },
    ])(
        'coalesces exact $platform arrivals and detaches responses',
        async (scenario) => {
            const operation = createDeferred();
            const subtitleService = {
                [scenario.serviceMethod]: jest.fn(() => operation.promise),
            };
            const { listener } = createHandler({ subtitleService });
            const firstResponse = jest.fn((response) => {
                response.extraSecret = 'MUTATED';
                response.selectedLanguage.displayName = 'MUTATED';
            });
            const secondResponse = jest.fn();

            expect(
                listener(
                    scenario.createMessage(),
                    scenario.createSender(),
                    firstResponse
                )
            ).toBe(true);
            expect(
                listener(
                    scenario.createMessage(),
                    scenario.createSender(),
                    secondResponse
                )
            ).toBe(true);
            await Promise.resolve();
            expect(
                subtitleService[scenario.serviceMethod]
            ).toHaveBeenCalledTimes(1);

            operation.resolve(scenario.createResult());
            await flushAsyncHandling();

            expect(firstResponse).toHaveBeenCalledTimes(1);
            expect(secondResponse).toHaveBeenCalledTimes(1);
            expect(firstResponse.mock.calls[0][0]).not.toBe(
                secondResponse.mock.calls[0][0]
            );
            expect(secondResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    videoId: scenario.videoId,
                })
            );
            expect(secondResponse.mock.calls[0][0]).not.toHaveProperty(
                'extraSecret'
            );
            expect(
                secondResponse.mock.calls[0][0].selectedLanguage.displayName
            ).not.toBe('MUTATED');
        }
    );

    test('supersedes and aborts started same-video work', async () => {
        const operations = [createDeferred(), createDeferred()];
        const signals = [];
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn((_snapshot, { signal }) => {
                signals.push(signal);
                return operations[signals.length - 1].promise;
            }),
        };
        const { listener } = createHandler({ subtitleService });
        const firstResponse = jest.fn();
        const latestResponse = jest.fn();

        listener(
            createDisneyMessage({ url: `${DISNEY_SUBTITLE_URL}?lease=old` }),
            createDisneySender(),
            firstResponse
        );
        await Promise.resolve();
        listener(
            createDisneyMessage({ url: `${DISNEY_SUBTITLE_URL}?lease=new` }),
            createDisneySender(),
            latestResponse
        );

        expect(signals[0].aborted).toBe(true);
        expect(firstResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        await Promise.resolve();
        expect(signals[1].aborted).toBe(false);

        operations[0].resolve(createDisneyServiceResult({ vttText: 'STALE' }));
        operations[1].resolve(createDisneyServiceResult({ vttText: 'LATEST' }));
        await flushAsyncHandling();

        expect(firstResponse).toHaveBeenCalledTimes(1);
        expect(latestResponse).toHaveBeenCalledWith(
            expect.objectContaining({ success: true, vttText: 'LATEST' })
        );
    });

    test('partitions in-flight work by source', async () => {
        const subtitleService = {
            processDisneyPlusSubtitles: jest
                .fn()
                .mockResolvedValue(createDisneyServiceResult()),
            processNetflixSubtitles: jest
                .fn()
                .mockResolvedValue(createNetflixServiceResult()),
        };
        const { listener } = createHandler({ subtitleService });
        const disneyResponse = jest.fn();
        const netflixResponse = jest.fn();

        listener(createDisneyMessage(), createDisneySender(), disneyResponse);
        listener(
            createNetflixMessage(),
            createNetflixSender({
                tab: { id: 17, url: NETFLIX_PAGE_URL },
            }),
            netflixResponse
        );
        await flushAsyncHandling();

        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        expect(subtitleService.processNetflixSubtitles).toHaveBeenCalledTimes(
            1
        );
        expect(disneyResponse).toHaveBeenCalledWith(
            expect.objectContaining({ success: true })
        );
        expect(netflixResponse).toHaveBeenCalledWith(
            expect.objectContaining({ success: true })
        );
    });

    test('caps one flight at eight responders', async () => {
        const operation = createDeferred();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(() => operation.promise),
        };
        const { listener } = createHandler({ subtitleService });
        const responders = Array.from({ length: 9 }, () => jest.fn());

        const keepsOpen = responders.map((responder) =>
            listener(createDisneyMessage(), createDisneySender(), responder)
        );
        await Promise.resolve();

        expect(keepsOpen).toEqual([
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            false,
        ]);
        expect(responders[8]).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);

        operation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();
        for (const responder of responders.slice(0, 8)) {
            expect(responder).toHaveBeenCalledTimes(1);
        }
    });

    test('caps one tab/source partition at two distinct flights', () => {
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = { processDisneyPlusSubtitles: jest.fn() };
        const { handler, listener } = createHandler({
            subtitleService,
            readiness,
        });
        const responders = Array.from({ length: 3 }, () => jest.fn());
        const keepsOpen = ['one', 'two', 'three'].map((index, position) => {
            const route = createDisneyRoute(index);
            return listener(route.message, route.sender, responders[position]);
        });

        expect(keepsOpen).toEqual([true, true, false]);
        expect(responders[2]).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        handler.destroy();
    });

    test('caps globally at eight distinct flights', () => {
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = { processDisneyPlusSubtitles: jest.fn() };
        const { handler, listener } = createHandler({
            subtitleService,
            readiness,
        });
        const responders = Array.from({ length: 9 }, () => jest.fn());
        const keepsOpen = responders.map((responder, index) =>
            listener(
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
        expect(responders[8]).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
        handler.destroy();
    });

    test('destroy settles a cold flight and prevents late service work', async () => {
        const readiness = new BackgroundServiceReadiness();
        const subtitleService = { processDisneyPlusSubtitles: jest.fn() };
        const { handler, listener } = createHandler({
            subtitleService,
            readiness,
        });
        const sendResponse = jest.fn();

        listener(createDisneyMessage(), createDisneySender(), sendResponse);
        handler.destroy();

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

    test('destroy aborts a started flight and prevents a late success', async () => {
        const operation = createDeferred();
        let signal;
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn((_snapshot, options) => {
                signal = options.signal;
                return operation.promise;
            }),
        };
        const { handler, listener } = createHandler({ subtitleService });
        const sendResponse = jest.fn();

        expect(
            listener(createDisneyMessage(), createDisneySender(), sendResponse)
        ).toBe(true);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).toHaveBeenCalledTimes(1);
        expect(signal.aborted).toBe(false);

        handler.destroy();

        expect(signal.aborted).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Background services unavailable',
        });

        operation.resolve(createDisneyServiceResult());
        await flushAsyncHandling();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('returns a fixed response when the subtitle service is missing', async () => {
        const { listener } = createHandler();
        const sendResponse = jest.fn();

        expect(
            listener(
                createNetflixMessage(),
                createNetflixSender(),
                sendResponse
            )
        ).toBe(true);
        await flushAsyncHandling();
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle service not initialized',
            videoId: '80123456',
        });
    });

    test.each([
        {
            platform: 'Disney+',
            createMessage: createDisneyMessage,
            createSender: createDisneySender,
            serviceMethod: 'processDisneyPlusSubtitles',
            videoId: 'episode-123',
        },
        {
            platform: 'Netflix',
            createMessage: createNetflixMessage,
            createSender: createNetflixSender,
            serviceMethod: 'processNetflixSubtitles',
            videoId: '80123456',
        },
    ])(
        'projects a $platform result into the canonical envelope',
        async (scenario) => {
            const secret = `${scenario.platform}-SECRET`;
            const serviceResult = createNetflixServiceResult({
                availableLanguages: [
                    {
                        normalizedCode: 'en',
                        displayName: 'English',
                        uri: secret,
                    },
                ],
                futureOwnField: secret,
            });
            const subtitleService = {
                [scenario.serviceMethod]: jest
                    .fn()
                    .mockResolvedValue(serviceResult),
            };
            const { listener } = createHandler({ subtitleService });
            const operation = dispatchSubtitle(
                listener,
                scenario.createMessage(),
                scenario.createSender()
            );

            expect(operation.keepsChannelOpen).toBe(true);
            await expect(operation.response).resolves.toEqual({
                success: true,
                vttText: 'WEBVTT',
                targetVttText: null,
                videoId: scenario.videoId,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                useNativeTarget: false,
                selectedLanguage: {
                    normalizedCode: 'en',
                    displayName: 'English',
                },
            });
            expect(
                JSON.stringify(operation.sendResponse.mock.calls)
            ).not.toContain(secret);
        }
    );

    test.each([
        [
            'object-valued VTT',
            createNetflixServiceResult({
                vttText: { secret: 'SERVICE_SECRET' },
            }),
        ],
        [
            'non-array language metadata',
            createNetflixServiceResult({
                availableLanguages: {
                    normalizedCode: 'en',
                    displayName: 'English',
                },
            }),
        ],
    ])('fails closed for %s', async (_name, result) => {
        const subtitleService = {
            processNetflixSubtitles: jest.fn().mockResolvedValue(result),
        };
        const { listener } = createHandler({ subtitleService });
        const operation = dispatchSubtitle(
            listener,
            createNetflixMessage(),
            createNetflixSender()
        );

        await expect(operation.response).resolves.toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: '80123456',
        });
        expect(JSON.stringify(operation.sendResponse.mock.calls)).not.toContain(
            'SERVICE_SECRET'
        );
    });

    test.each([
        {
            platform: 'Disney+',
            createMessage: createDisneyMessage,
            createSender: createDisneySender,
            serviceMethod: 'processDisneyPlusSubtitles',
            videoId: 'episode-123',
            synchronous: true,
        },
        {
            platform: 'Netflix',
            createMessage: createNetflixMessage,
            createSender: createNetflixSender,
            serviceMethod: 'processNetflixSubtitles',
            videoId: '80123456',
            synchronous: false,
        },
    ])('redacts a $platform processing failure', async (scenario) => {
        const secret = `${scenario.platform}-ERROR-SECRET`;
        const error = new Error(secret);
        const serviceMethod = scenario.synchronous
            ? jest.fn(() => {
                  throw error;
              })
            : jest.fn().mockRejectedValue(error);
        const { handler, listener } = createHandler({
            subtitleService: { [scenario.serviceMethod]: serviceMethod },
        });
        const operation = dispatchSubtitle(
            listener,
            scenario.createMessage(),
            scenario.createSender()
        );

        await expect(operation.response).resolves.toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: scenario.videoId,
        });
        expect(
            JSON.stringify([
                operation.sendResponse.mock.calls,
                handler.logger.error.mock.calls,
            ])
        ).not.toContain(secret);
    });
});
