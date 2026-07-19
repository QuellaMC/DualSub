import { jest } from '@jest/globals';
import {
    TextDecoder as NodeTextDecoder,
    TextEncoder as NodeTextEncoder,
} from 'node:util';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../content_scripts/shared/constants/messageActions.js';
import { authorizeSubtitleRequest } from '../background/utils/subtitleRequestPolicy.js';

const FIXTURE_EXTENSION_ID = 'dualsub-subtitle-fetch-fixture';
const DEFAULT_DISNEY_PAGE_URL = 'https://www.disneyplus.com/video/episode-123';
const DEFAULT_DISNEY_SUBTITLE_URL =
    'https://captions.media.dssott.com/show/master.m3u8';
const DEFAULT_NETFLIX_PAGE_URL = 'https://www.netflix.com/watch/80123456';
const DEFAULT_NETFLIX_SUBTITLE_URL =
    'https://captions.nflxvideo.net/show/en.ttml';

function setFixtureExtensionId() {
    Object.defineProperty(globalThis.chrome.runtime, 'id', {
        configurable: true,
        enumerable: true,
        value: FIXTURE_EXTENSION_ID,
        writable: true,
    });
}

function createFixtureSender(pageUrl, tabId) {
    return {
        id: FIXTURE_EXTENSION_ID,
        tab: { id: tabId, url: pageUrl },
        frameId: 0,
        url: pageUrl,
        origin: new URL(pageUrl).origin,
    };
}

export function createAuthorizedDisneySubtitleSnapshot({
    pageUrl = DEFAULT_DISNEY_PAGE_URL,
    subtitleUrl = DEFAULT_DISNEY_SUBTITLE_URL,
    videoId = 'episode-123',
} = {}) {
    setFixtureExtensionId();

    return authorizeSubtitleRequest(
        {
            action: MessageActions.FETCH_VTT,
            source: SubtitleRequestSources.DISNEY_PLUS,
            url: subtitleUrl,
            videoId,
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        },
        createFixtureSender(pageUrl, 17)
    );
}

export function createAuthorizedNetflixSubtitleSnapshot({
    pageUrl = DEFAULT_NETFLIX_PAGE_URL,
    subtitleUrl = DEFAULT_NETFLIX_SUBTITLE_URL,
    videoId = '80123456',
    tracks,
    targetLanguage = 'zh-CN',
    originalLanguage = 'en',
    useNativeSubtitles = true,
    useOfficialTranslations = false,
} = {}) {
    setFixtureExtensionId();

    const requestTracks =
        tracks === undefined
            ? [
                  {
                      language: 'en',
                      displayName: 'English',
                      trackType: 'PRIMARY',
                      isNoneTrack: false,
                      isForcedNarrative: false,
                      ttDownloadables: {
                          dfxp: { urls: [{ url: subtitleUrl }] },
                      },
                  },
              ]
            : tracks;

    return authorizeSubtitleRequest(
        {
            action: MessageActions.FETCH_VTT,
            source: SubtitleRequestSources.NETFLIX,
            data: {
                tracks: requestTracks,
            },
            videoId,
            targetLanguage,
            originalLanguage,
            useNativeSubtitles,
            useOfficialTranslations,
        },
        createFixtureSender(pageUrl, 23)
    );
}

export function createSubtitleFetchResponse(text, url, overrides = {}) {
    if (typeof globalThis.TextDecoder !== 'function') {
        Object.defineProperty(globalThis, 'TextDecoder', {
            configurable: true,
            value: NodeTextDecoder,
            writable: true,
        });
    }
    const bytes = new NodeTextEncoder().encode(text);
    let delivered = false;
    const reader = {
        read: jest.fn(async () => {
            if (delivered) return { done: true, value: undefined };
            delivered = true;
            return { done: false, value: bytes };
        }),
        cancel: jest.fn(async () => {
            delivered = true;
        }),
        releaseLock: jest.fn(),
    };

    return {
        ok: true,
        url,
        redirected: false,
        headers: { get: jest.fn(() => null) },
        body: {
            getReader: jest.fn(() => reader),
            cancel: jest.fn(async () => {
                delivered = true;
            }),
        },
        ...overrides,
    };
}
