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
import { getDefaultValue } from '@/config/schema';
import { configService } from '@/config/service';
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
import { UiRoot } from '../renderer/domLayer';
import {
    PlayerSession,
    type ContentSettings,
    type LanguageSettings,
} from './PlayerSession';

const LANGUAGES: LanguageSettings = {
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
        document.querySelector<HTMLElement>('.dualsub-original-subtitle')
            ?.textContent ?? '',
        document.querySelector<HTMLElement>('.dualsub-translated-subtitle')
            ?.textContent ?? '',
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

function startSession(
    languageSettings: LanguageSettings = LANGUAGES,
    settings: Partial<ContentSettings> = {}
) {
    const controller = new AbortController();
    const cache = new SubtitleEventCache();
    const sendControl = vi.fn(() => true);
    const video = makeVideo();
    const session = new PlayerSession({
        id: 1,
        videoId: '1',
        descriptor: netflixDescriptor,
        config: configService.forSite('netflix'),
        bridge: { connected: true, sendControl },
        cache,
        uiRoot: new UiRoot(controller.signal),
        handoff: null,
        platformLook: null,
        settings: {
            subtitlesEnabled: true,
            hideOfficialSubtitles: true,
            subtitleStyle: 'custom',
            subtitleCustomLook: getDefaultValue('subtitleCustomLook'),
            subtitleTranslationColor: '#00ffff',
            subtitleFontScale: 1,
            subtitleGap: 0.3,
            subtitleVerticalPosition: 2.8,
            subtitleLayoutOrientation: 'column',
            subtitleLayoutOrder: 'original_top',
            subtitleTimeOffset: 0,
            ...settings,
        },
        languageSettings,
        interaction: {
            aiContextEnabled: false,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        },
        onNavigationMismatch: vi.fn(),
        onContextInvalidated: vi.fn(),
    });
    session.start();
    // The orchestrator hands the session its site's changes.
    const unsubscribe = configService
        .forSite('netflix')
        .onChanged((changes) => session.applySettings(changes));
    controller.signal.addEventListener('abort', unsubscribe, { once: true });
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
        expect(active.sendControl).toHaveBeenCalledWith({
            t: 'request-subtitle-appearance',
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

        active.session.updateLanguageSettings({
            ...LANGUAGES,
            targetLanguage: 'ja',
        });
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

    it('names the language of the track it shows, not the one it asked for', async () => {
        // The platform has no Japanese track and answers with English.
        stubBackground({ 'zh-CN': '你好' });
        active = startSession({ ...LANGUAGES, originalLanguage: 'ja' });
        expect(active.session.originalLanguage).toBeNull();

        active.cache.publish('1', resolution(['ja', 'zh-CN']));
        await settle();
        expect(active.session.originalLanguage).toBe('en');
    });

    it('names no original line language while subtitles for new languages load', async () => {
        stubBackground({ 'zh-CN': '你好', ja: 'こんにちは' });
        active = startSession();
        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();
        expect(active.session.originalLanguage).toBe('en');

        active.session.updateLanguageSettings({
            ...LANGUAGES,
            targetLanguage: 'ja',
        });
        expect(active.session.originalLanguage).toBeNull();

        active.cache.publish('1', resolution(['en', 'ja']));
        await settle();
        expect(active.session.originalLanguage).toBe('en');
    });

    it('ignores a languages update that changes nothing', async () => {
        stubBackground({ 'zh-CN': '你好' });
        active = startSession();
        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();
        active.tick(1.5);
        active.session.updateLanguageSettings({ ...LANGUAGES });
        expect(texts()).toEqual(['Hello', '你好']);
    });

    it("draws the platform style from the viewer's reported appearance", async () => {
        stubBackground({ 'zh-CN': '你好' });
        active = startSession();
        await configService.setMultiple({ subtitleStyle: 'platform' });
        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();
        active.tick(1.5);
        const original = (): HTMLElement =>
            document.querySelector<HTMLElement>('.dualsub-original-subtitle')!;
        expect(original().style.fontWeight).toBe('bold');

        active.session.updatePlatformLook({
            ...netflixDescriptor.look,
            fontWeight: '600',
        });
        expect(original().style.fontWeight).toBe('600');
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

    it("follows changes to its site's own settings, not another site's", async () => {
        stubBackground({ 'zh-CN': '你好' });
        active = startSession();
        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();
        active.tick(1.5);
        expect(texts()).toEqual(['Hello', '你好']);

        const stageHidden = (): boolean =>
            document.querySelector<HTMLElement>('#dualsub-subtitle-stage')
                ?.style.display === 'none';

        await configService.setMultiple(
            { subtitlesEnabled: false },
            { site: 'disneyplus', target: 'own' }
        );
        await settle();
        expect(stageHidden()).toBe(false);

        await configService.setMultiple(
            { subtitlesEnabled: false },
            { site: 'netflix', target: 'own' }
        );
        await settle();
        expect(stageHidden()).toBe(true);
    });

    it("hides the site's own subtitles only while DualSub shows its lines", async () => {
        stubBackground({});
        active = startSession(LANGUAGES, { subtitlesEnabled: false });
        const cue = document.createElement('div');
        cue.className = 'player-timedtext';
        document.querySelector('.watch-video')!.append(cue);
        await settle(150);
        expect(cue.getAttribute('data-dualsub-hidden')).toBeNull();

        await fakeBrowser.storage.sync.set({ subtitlesEnabled: true });
        await settle(150);
        expect(cue.getAttribute('data-dualsub-hidden')).toBe('true');
    });

    it('watches the spoken language for its whole life', () => {
        stubBackground({});
        active = startSession();
        expect(active.sendControl).toHaveBeenCalledWith({
            t: 'watch-spoken-language',
            videoId: '1',
        });
        active.session.end('navigation');
        expect(active.sendControl).toHaveBeenLastCalledWith({
            t: 'cancel-subtitle-tracks',
        });
        expect(active.sendControl).toHaveBeenCalledWith({
            t: 'unwatch-spoken-language',
        });
    });
});

describe('PlayerSession with an automatic original line', () => {
    const AUTO: LanguageSettings = { ...LANGUAGES, originalLanguage: 'auto' };

    function trackRequests(): unknown[] {
        return active!.sendControl.mock.calls
            .map(([message]: unknown[]) => message)
            .filter(
                (message) =>
                    (message as { t: string }).t === 'request-subtitle-tracks'
            );
    }

    it('asks for tracks only once the player reports the spoken language', () => {
        stubBackground({});
        active = startSession(AUTO);
        expect(trackRequests()).toEqual([]);
        expect(texts()).toEqual(['', 'Loading…']);

        active.session.updateSpokenLanguage('ko-KR');
        expect(trackRequests()).toEqual([
            {
                t: 'request-subtitle-tracks',
                videoId: '1',
                languages: ['ko', 'zh-CN'],
            },
        ]);
    });

    it('follows the audio when the viewer switches it', async () => {
        const requests = stubBackground({ 'zh-CN': '你好' });
        active = startSession(AUTO);
        active.session.updateSpokenLanguage('en');
        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();
        expect(requests.map((request) => request.originalLanguage)).toEqual([
            'en',
        ]);

        active.session.updateSpokenLanguage('cmn-TW');
        expect(trackRequests()).toContainEqual({
            t: 'request-subtitle-tracks',
            videoId: '1',
            languages: ['zh-TW', 'zh-CN'],
        });
        active.cache.publish('1', resolution(['zh-TW', 'zh-CN']));
        await settle();
        expect(requests.map((request) => request.originalLanguage)).toEqual([
            'en',
            'zh-TW',
        ]);
    });

    it('shows only the subtitles for the audio playing now', async () => {
        const requests: FetchVttRequest[] = [];
        const answers: ((response: FetchVttResponse) => void)[] = [];
        vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(((
            message: FetchVttRequest
        ) => {
            requests.push(message);
            return new Promise((resolve) => {
                answers.push(resolve);
            });
        }) as never);
        const english: FetchVttResponse = {
            success: true,
            vttText: vtt('Hello'),
            targetVttText: vtt('你好'),
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: true,
            selectedLanguage: { normalizedCode: 'en', displayName: 'English' },
        };
        active = startSession(AUTO);
        active.session.updateSpokenLanguage('en');
        active.cache.publish('1', resolution(['en', 'zh-CN']));
        await settle();

        active.session.updateSpokenLanguage('ja');
        answers[0]!(english);
        await settle();
        active.tick(1.5);
        expect(texts()).toEqual(['', 'Loading…']);

        active.session.updateSpokenLanguage('en');
        await settle();
        expect(requests.map((request) => request.originalLanguage)).toEqual([
            'en',
            'en',
        ]);
        answers[1]!(english);
        await settle();
        active.tick(1.6);
        expect(texts()).toEqual(['Hello', '你好']);
    });

    it('falls back to English when the player cannot tell', () => {
        stubBackground({});
        active = startSession(AUTO);
        active.session.updateSpokenLanguage(null);
        expect(trackRequests()).toEqual([
            {
                t: 'request-subtitle-tracks',
                videoId: '1',
                languages: ['en', 'zh-CN'],
            },
        ]);
    });

    it('asks for one line when the video speaks the target language', async () => {
        const messages: { action: string }[] = [];
        vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(((message: {
            action: string;
        }) => {
            messages.push(message);
            const response: FetchVttResponse = {
                success: true,
                vttText: vtt('你好'),
                targetVttText: null,
                sourceLanguage: 'zh-CN',
                targetLanguage: 'zh-CN',
                useNativeTarget: false,
                selectedLanguage: {
                    normalizedCode: 'zh-CN',
                    displayName: '中文',
                },
            };
            return Promise.resolve(response);
        }) as never);
        active = startSession(AUTO);
        active.session.updateSpokenLanguage('zh-Hans');
        expect(trackRequests()).toEqual([
            {
                t: 'request-subtitle-tracks',
                videoId: '1',
                languages: ['zh-CN'],
            },
        ]);
        active.cache.publish('1', resolution(['zh-CN']));
        await settle(5_000);
        active.tick(1.5);
        expect(texts()).toEqual(['你好', '']);
        expect(messages.map((message) => message.action)).toEqual(['fetchVTT']);
    });
});
