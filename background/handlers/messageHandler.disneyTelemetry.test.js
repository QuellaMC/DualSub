import { afterEach, beforeAll, expect, jest, test } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
import { subtitleService } from '../services/subtitleService.js';
import { configService } from '../../services/configService.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = globalThis.fetch;

beforeAll(async () => {
    await subtitleService.initialize();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

test('reports a fixed master-fetch diagnostic without retaining the transport failure', async () => {
    const signedUrl =
        'https://captions.media.dssott.com/show/master.m3u8?token=PRIVATE_MASTER_TOKEN';
    const transportSecret = 'PRIVATE_MASTER_TRANSPORT_FAILURE';
    const snapshot = createAuthorizedDisneySubtitleSnapshot({
        subtitleUrl: signedUrl,
    });
    globalThis.fetch = jest.fn(async () => {
        throw new TypeError(transportSecret);
    });
    const handler = new MessageHandler();
    handler.setServices({ subtitleService });
    handler.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    const response = await handler.createGenericVTTResponse(snapshot);

    expect(response).toEqual({
        success: false,
        error: 'Subtitle processing failed',
        videoId: 'episode-123',
    });
    expect(handler.logger.error).toHaveBeenCalledWith(
        'Disney VTT processing failed',
        null,
        {
            stage: 'master-fetch',
            errorCode: 'DISNEY_MASTER_FETCH_FAILED',
            source: 'disneyplus',
            hasVideoId: true,
        }
    );
    const serializedLogs = JSON.stringify(handler.logger.error.mock.calls);
    expect(serializedLogs).not.toContain(transportSecret);
    expect(serializedLogs).not.toContain('PRIVATE_MASTER_TOKEN');
    expect(serializedLogs).not.toContain('/show/master.m3u8');
    expect(serializedLogs).not.toContain('token=');
});

test('reports a fixed master-parse diagnostic for an unrecognized master body', async () => {
    const signedUrl =
        'https://captions.media.dssott.com/show/master.m3u8?token=PRIVATE_PARSE_TOKEN';
    const bodySecret = 'PRIVATE_UNRECOGNIZED_MASTER_BODY';
    const snapshot = createAuthorizedDisneySubtitleSnapshot({
        subtitleUrl: signedUrl,
    });
    globalThis.fetch = jest.fn(async () =>
        createSubtitleFetchResponse(bodySecret, signedUrl)
    );
    const handler = new MessageHandler();
    handler.setServices({ subtitleService });
    handler.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    await expect(handler.createGenericVTTResponse(snapshot)).resolves.toEqual({
        success: false,
        error: 'Subtitle processing failed',
        videoId: 'episode-123',
    });
    expect(handler.logger.error).toHaveBeenCalledWith(
        'Disney VTT processing failed',
        null,
        {
            stage: 'master-parse',
            errorCode: 'DISNEY_MASTER_PARSE_FAILED',
            source: 'disneyplus',
            hasVideoId: true,
        }
    );
    const serializedLogs = JSON.stringify(handler.logger.error.mock.calls);
    expect(serializedLogs).not.toContain(bodySecret);
    expect(serializedLogs).not.toContain('PRIVATE_PARSE_TOKEN');
});

test('reports a fixed media-fetch diagnostic for the mandatory original playlist', async () => {
    const masterUrl =
        'https://captions.media.dssott.com/show/master.m3u8?token=PRIVATE_MEDIA_MASTER_TOKEN';
    const mediaUri = 'tracks/en/index.m3u8?token=PRIVATE_MEDIA_PLAYLIST_TOKEN';
    const mediaUrl = new URL(mediaUri, masterUrl).href;
    const masterPlaylist = [
        '#EXTM3U',
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="${mediaUri}"`,
    ].join('\n');
    const transportSecret = 'PRIVATE_MEDIA_TRANSPORT_FAILURE';
    const snapshot = createAuthorizedDisneySubtitleSnapshot({
        subtitleUrl: masterUrl,
    });
    jest.spyOn(configService, 'get').mockResolvedValue({ disneyplus: [] });
    jest.spyOn(configService, 'getMultiple').mockResolvedValue({
        useNativeSubtitles: false,
        useOfficialTranslations: false,
    });
    globalThis.fetch = jest.fn(async (url) => {
        if (url === masterUrl) {
            return createSubtitleFetchResponse(masterPlaylist, url);
        }
        if (url === mediaUrl) throw new TypeError(transportSecret);
        throw new Error('Unexpected subtitle request');
    });
    const handler = new MessageHandler();
    handler.setServices({ subtitleService });
    handler.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    await expect(handler.createGenericVTTResponse(snapshot)).resolves.toEqual({
        success: false,
        error: 'Subtitle processing failed',
        videoId: 'episode-123',
    });
    expect(handler.logger.error).toHaveBeenCalledWith(
        'Disney VTT processing failed',
        null,
        {
            stage: 'media-fetch',
            errorCode: 'DISNEY_MEDIA_FETCH_FAILED',
            source: 'disneyplus',
            hasVideoId: true,
        }
    );
    const serializedLogs = JSON.stringify(handler.logger.error.mock.calls);
    expect(serializedLogs).not.toContain(transportSecret);
    expect(serializedLogs).not.toContain('PRIVATE_MEDIA_MASTER_TOKEN');
    expect(serializedLogs).not.toContain('PRIVATE_MEDIA_PLAYLIST_TOKEN');
});

test('reports a fixed VTT-fetch diagnostic when every mandatory segment is unavailable', async () => {
    const masterUrl =
        'https://captions.media.dssott.com/show/master.m3u8?token=PRIVATE_VTT_MASTER_TOKEN';
    const mediaUri = 'tracks/en/index.m3u8?token=PRIVATE_VTT_PLAYLIST_TOKEN';
    const mediaUrl = new URL(mediaUri, masterUrl).href;
    const segmentUri = 'cue-1.vtt?token=PRIVATE_VTT_SEGMENT_TOKEN';
    const segmentUrl = new URL(segmentUri, mediaUrl).href;
    const masterPlaylist = [
        '#EXTM3U',
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="${mediaUri}"`,
    ].join('\n');
    const mediaPlaylist = `#EXTM3U\n#EXTINF:2.0,\n${segmentUri}`;
    const transportSecret = 'PRIVATE_VTT_TRANSPORT_FAILURE';
    const snapshot = createAuthorizedDisneySubtitleSnapshot({
        subtitleUrl: masterUrl,
    });
    jest.spyOn(configService, 'get').mockResolvedValue({ disneyplus: [] });
    jest.spyOn(configService, 'getMultiple').mockResolvedValue({
        useNativeSubtitles: false,
        useOfficialTranslations: false,
    });
    globalThis.fetch = jest.fn(async (url) => {
        if (url === masterUrl) {
            return createSubtitleFetchResponse(masterPlaylist, url);
        }
        if (url === mediaUrl) {
            return createSubtitleFetchResponse(mediaPlaylist, url);
        }
        if (url === segmentUrl) throw new TypeError(transportSecret);
        throw new Error('Unexpected subtitle request');
    });
    const handler = new MessageHandler();
    handler.setServices({ subtitleService });
    handler.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    await expect(handler.createGenericVTTResponse(snapshot)).resolves.toEqual({
        success: false,
        error: 'Subtitle processing failed',
        videoId: 'episode-123',
    });
    expect(handler.logger.error).toHaveBeenCalledWith(
        'Disney VTT processing failed',
        null,
        {
            stage: 'vtt-fetch',
            errorCode: 'DISNEY_VTT_FETCH_FAILED',
            source: 'disneyplus',
            hasVideoId: true,
        }
    );
    const serializedLogs = JSON.stringify(handler.logger.error.mock.calls);
    expect(serializedLogs).not.toContain(transportSecret);
    expect(serializedLogs).not.toContain('PRIVATE_VTT_MASTER_TOKEN');
    expect(serializedLogs).not.toContain('PRIVATE_VTT_PLAYLIST_TOKEN');
    expect(serializedLogs).not.toContain('PRIVATE_VTT_SEGMENT_TOKEN');
});

test('collapses an untrusted service exception to the fixed unknown diagnostic', async () => {
    const snapshot = createAuthorizedDisneySubtitleSnapshot();
    const hostileReads = jest.fn(() => {
        throw new Error('PRIVATE_UNKNOWN_ERROR_TRAP');
    });
    const hostileError = new Proxy(
        {},
        {
            get: hostileReads,
            getOwnPropertyDescriptor: hostileReads,
            ownKeys: hostileReads,
        }
    );
    const handler = new MessageHandler();
    handler.setServices({
        subtitleService: {
            processDisneyPlusSubtitles: jest.fn(() => {
                throw hostileError;
            }),
        },
    });
    handler.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    await expect(handler.createGenericVTTResponse(snapshot)).resolves.toEqual({
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
    expect(hostileReads).not.toHaveBeenCalled();
    expect(JSON.stringify(handler.logger.error.mock.calls)).not.toContain(
        'PRIVATE_UNKNOWN_ERROR_TRAP'
    );
});
