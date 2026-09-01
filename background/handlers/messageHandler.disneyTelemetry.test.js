import { afterEach, beforeAll, expect, jest, test } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
import { subtitleService } from '../services/subtitleService.js';
import { configService } from '../../services/configService.js';
import { createSubtitleFetchResponse } from '../../test-utils/subtitle-fetch-fixtures.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';

const originalFetch = globalThis.fetch;
const EXTENSION_ID = 'dualsub-subtitle-fetch-fixture';
const DISNEY_PAGE_URL = 'https://www.disneyplus.com/video/episode-123';

beforeAll(async () => {
    await subtitleService.initialize();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

function createHandler(service = subtitleService) {
    const listeners = [];
    globalThis.chrome = {
        ...globalThis.chrome,
        runtime: {
            ...globalThis.chrome?.runtime,
            id: EXTENSION_ID,
            onMessage: {
                addListener: jest.fn((listener) => listeners.push(listener)),
                removeListener: jest.fn(),
            },
        },
    };
    const handler = new MessageHandler();
    handler.setServices({ subtitleService: service });
    handler.initialize();
    handler.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    return { handler, listener: listeners[0] };
}

function createDisneyMessage(subtitleUrl) {
    return {
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.DISNEY_PLUS,
        url: subtitleUrl,
        videoId: 'episode-123',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
    };
}

function createDisneySender() {
    return {
        id: EXTENSION_ID,
        tab: { id: 17, url: DISNEY_PAGE_URL },
        frameId: 0,
        url: DISNEY_PAGE_URL,
        origin: new URL(DISNEY_PAGE_URL).origin,
    };
}

function dispatch(listener, message) {
    let resolveResponse;
    const response = new Promise((resolve) => {
        resolveResponse = resolve;
    });
    const sendResponse = jest.fn(resolveResponse);
    expect(listener(message, createDisneySender(), sendResponse)).toBe(true);
    return response;
}

function arrangeFailure(stage) {
    const masterUrl = `https://captions.media.dssott.com/show/master.m3u8?token=PRIVATE_${stage}_MASTER`;
    const mediaUri = `tracks/en/index.m3u8?token=PRIVATE_${stage}_MEDIA`;
    const mediaUrl = new URL(mediaUri, masterUrl).href;
    const segmentUri = `cue-1.vtt?token=PRIVATE_${stage}_SEGMENT`;
    const segmentUrl = new URL(segmentUri, mediaUrl).href;
    const masterPlaylist = [
        '#EXTM3U',
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="${mediaUri}"`,
    ].join('\n');
    const mediaPlaylist = `#EXTM3U\n#EXTINF:2.0,\n${segmentUri}`;
    const transportSecret = `PRIVATE_${stage}_TRANSPORT`;

    if (stage === 'media-fetch' || stage === 'vtt-fetch') {
        jest.spyOn(configService, 'get').mockResolvedValue({ disneyplus: [] });
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            useNativeSubtitles: false,
            useOfficialTranslations: false,
        });
    }

    globalThis.fetch = jest.fn(async (url) => {
        if (stage === 'master-fetch') throw new TypeError(transportSecret);
        if (url === masterUrl) {
            return createSubtitleFetchResponse(
                stage === 'master-parse'
                    ? `PRIVATE_${stage}_BODY`
                    : masterPlaylist,
                url
            );
        }
        if (url === mediaUrl) {
            if (stage === 'media-fetch') throw new TypeError(transportSecret);
            return createSubtitleFetchResponse(mediaPlaylist, url);
        }
        if (url === segmentUrl && stage === 'vtt-fetch') {
            throw new TypeError(transportSecret);
        }
        throw new Error('Unexpected subtitle request');
    });

    return {
        message: createDisneyMessage(masterUrl),
        forbidden: [
            transportSecret,
            `PRIVATE_${stage}_MASTER`,
            `PRIVATE_${stage}_MEDIA`,
            `PRIVATE_${stage}_SEGMENT`,
            `PRIVATE_${stage}_BODY`,
        ],
    };
}

test.each([
    ['master-fetch', 'DISNEY_MASTER_FETCH_FAILED'],
    ['master-parse', 'DISNEY_MASTER_PARSE_FAILED'],
    ['media-fetch', 'DISNEY_MEDIA_FETCH_FAILED'],
    ['vtt-fetch', 'DISNEY_VTT_FETCH_FAILED'],
])(
    'reports a fixed %s diagnostic without raw transport data',
    async (stage, errorCode) => {
        const { message, forbidden } = arrangeFailure(stage);
        const { handler, listener } = createHandler();

        await expect(dispatch(listener, message)).resolves.toEqual({
            success: false,
            error: 'Subtitle processing failed',
            videoId: 'episode-123',
        });
        expect(handler.logger.error).toHaveBeenCalledWith(
            'Disney VTT processing failed',
            null,
            {
                stage,
                errorCode,
                source: 'disneyplus',
                hasVideoId: true,
            }
        );

        const serializedLogs = JSON.stringify(handler.logger.error.mock.calls);
        for (const value of forbidden) {
            expect(serializedLogs).not.toContain(value);
        }
        expect(serializedLogs).not.toContain('token=');
    }
);

test('collapses an untrusted exception to the fixed unknown diagnostic', async () => {
    const secret = 'PRIVATE_UNKNOWN_ERROR';
    const { handler, listener } = createHandler({
        processDisneyPlusSubtitles: jest.fn(() => {
            throw new Error(secret);
        }),
    });

    await expect(
        dispatch(
            listener,
            createDisneyMessage(
                'https://captions.media.dssott.com/show/master.m3u8'
            )
        )
    ).resolves.toEqual({
        success: false,
        error: 'Subtitle processing failed',
        videoId: 'episode-123',
    });
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
    expect(JSON.stringify(handler.logger.error.mock.calls)).not.toContain(
        secret
    );
});
