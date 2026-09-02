// @vitest-environment happy-dom
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setUrl } from '@/test-utils/dom';
import { installExtensionRuntimeIdentity } from '@/test-utils/extensionRuntime';
import type {
    FetchVttRequest,
    FetchVttResponse,
} from '@/messaging/contracts/fetchVtt';
import { SubtitleEventCache } from '../bridge/SubtitleEventCache';
import { netflixDescriptor } from '../platform/netflix/descriptor';
import type { SubtitleLanguages } from '../platform/types';
import { UiRoot } from '../renderer/domLayer';
import { PlayerSession } from './PlayerSession';

const LANGUAGES: SubtitleLanguages = {
    originalLanguage: 'en',
    targetLanguage: 'zh-CN',
    useOfficialTranslations: true,
};

function vtt(text: string): string {
    return `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${text}\n`;
}

/** Background stub: every fetch succeeds with an official target track. */
function stubBackground(targets: Record<string, string>): FetchVttRequest[] {
    const requests: FetchVttRequest[] = [];
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(((
        message: FetchVttRequest
    ) => {
        requests.push(message);
        const response: FetchVttResponse = {
            success: true,
            vttText: vtt('Hello'),
            targetVttText: vtt(targets[message.targetLanguage] ?? '??'),
            sourceLanguage: 'en',
            targetLanguage: message.targetLanguage,
            useNativeTarget: true,
            selectedLanguage: { normalizedCode: 'en', displayName: 'English' },
        };
        return Promise.resolve(response);
    }) as never);
    return requests;
}

function makeVideo(): HTMLVideoElement & { time: number } {
    const root = document.createElement('div');
    root.className = 'watch-video';
    const video = document.createElement('video') as HTMLVideoElement & {
        time: number;
    };
    video.time = 0;
    Object.defineProperty(video, 'currentTime', { get: () => video.time });
    Object.defineProperty(video, 'readyState', { get: () => 2 });
    Object.defineProperty(video, 'HAVE_CURRENT_DATA', { value: 2 });
    root.appendChild(video);
    document.body.appendChild(root);
    return video;
}

function texts(): [string, string] {
    return [
        document.getElementById('dualsub-original-subtitle')?.textContent ?? '',
        document.getElementById('dualsub-translated-subtitle')?.textContent ??
            '',
    ];
}

function resolution(
    languages: string[],
    tracks: unknown[] = [
        { language: 'en', url: 'https://sub.nflxvideo.net/en' },
    ]
) {
    return {
        t: 'subtitle-data' as const,
        platform: 'netflix' as const,
        movieId: '1',
        languages,
        tracks,
    };
}

function startSession() {
    const controller = new AbortController();
    const cache = new SubtitleEventCache();
    const sendControl = vi.fn(() => true);
    const video = makeVideo();
    const session = new PlayerSession({
        id: 1,
        videoId: '1',
        descriptor: netflixDescriptor,
        bridge: { connected: true, sendControl },
        cache,
        uiRoot: new UiRoot(controller.signal),
        handoff: null,
        settings: {
            subtitlesEnabled: true,
            subtitleFontSize: 1.1,
            subtitleGap: 0.3,
            subtitleVerticalPosition: 2.8,
            subtitleLayoutOrientation: 'column',
            subtitleLayoutOrder: 'original_top',
            subtitleTimeOffset: 0,
        },
        languages: LANGUAGES,
        interaction: {
            aiContextEnabled: false,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        },
        onNavigationMismatch: vi.fn(),
        onContextInvalidated: vi.fn(),
    });
    session.start();
    const tick = (time: number): void => {
        video.time = time;
        video.dispatchEvent(new Event('timeupdate'));
    };
    return { session, cache, sendControl, tick, controller };
}

async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
    }
}

let active: ReturnType<typeof startSession> | null = null;

beforeAll(() => {
    installExtensionRuntimeIdentity();
});

beforeEach(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    setUrl('https://www.netflix.com/watch/1');
    await fakeBrowser.storage.sync.clear();
    await fakeBrowser.storage.local.clear();
    vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
        (key: string) => (key === 'subtitleLoading' ? 'Loading…' : '')
    );
});

afterEach(() => {
    active?.session.end('document-teardown');
    active?.controller.abort();
    active = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('PlayerSession', () => {
    it('shows the loading placeholder until the first cue set arrives', async () => {
        const requests = stubBackground({ 'zh-CN': '你好' });
        active = startSession();
        expect(texts()).toEqual(['', 'Loading…']);
        expect(active.sendControl).toHaveBeenCalledWith({
            t: 'request-subtitle-tracks',
            videoId: '1',
            languages: ['en', 'zh-CN'],
        });

        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();
        expect(requests.map((request) => request.targetLanguage)).toEqual([
            'zh-CN',
        ]);
        active.tick(1.5);
        expect(texts()).toEqual(['Hello', '你好']);
    });

    it('keeps the current cues up behind a placeholder while new languages load', async () => {
        const requests = stubBackground({ 'zh-CN': '你好', ja: 'こんにちは' });
        active = startSession();
        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();
        active.tick(1.5);
        expect(texts()).toEqual(['Hello', '你好']);

        active.session.updateLanguages({ ...LANGUAGES, targetLanguage: 'ja' });
        expect(active.sendControl).toHaveBeenLastCalledWith({
            t: 'request-subtitle-tracks',
            videoId: '1',
            languages: ['en', 'ja'],
        });
        expect(texts()).toEqual(['Hello', 'Loading…']);
        await settle();
        expect(requests).toHaveLength(1);

        active.cache.publish('1', resolution(['en', 'ja']));
        await settle();
        expect(requests[1]?.targetLanguage).toBe('ja');
        active.tick(1.6);
        expect(texts()).toEqual(['Hello', 'こんにちは']);
    });

    it('ignores a languages update that changes nothing', async () => {
        stubBackground({ 'zh-CN': '你好' });
        active = startSession();
        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();
        active.tick(1.5);
        active.session.updateLanguages({ ...LANGUAGES });
        expect(texts()).toEqual(['Hello', '你好']);
    });

    it('drops the placeholder when the platform has nothing for the languages', () => {
        stubBackground({});
        active = startSession();
        active.cache.publish('1', resolution(['en', 'zh-CN'], []));
        expect(texts()).toEqual(['', '']);
    });

    it('drops the placeholder when nothing arrives within the wait budget', async () => {
        stubBackground({});
        active = startSession();
        await settle(19_000);
        expect(texts()).toEqual(['', 'Loading…']);
        await settle(1_000);
        expect(texts()).toEqual(['', '']);
    });
});
