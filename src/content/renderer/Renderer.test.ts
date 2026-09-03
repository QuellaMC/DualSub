// @vitest-environment happy-dom
import { setUrl } from '@/test-utils/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createLogger } from '@/shared/logger';
import type { PlatformAdapter } from '../platform/types';
import type { Cue } from '../subtitles/cueModel';
import { UiRoot } from './domLayer';
import { Renderer } from './Renderer';
import { RendererState } from './RendererState';

const display = {
    fontSizeVw: 1.1,
    gap: 0.3,
    verticalPosition: 2.8,
    orientation: 'column' as const,
    order: 'original_top' as const,
    timeOffset: 0,
};

function makeVideo(): HTMLVideoElement & { time: number } {
    const root = document.createElement('div');
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

function cue(
    start: number,
    end: number,
    original: string,
    translated: string | null = null
): Cue {
    return {
        id: `${start}`,
        start,
        end,
        cueType: 'original',
        original,
        translated,
        useNativeTarget: false,
    };
}

function setup(videoId = '1') {
    const controller = new AbortController();
    const video = makeVideo();
    const state = new RendererState(display);
    const onNavigationMismatch = vi.fn();
    const adapter = {
        getPlaybackTime: (v: HTMLVideoElement) => v.currentTime,
        onClockInvalidated: vi.fn(),
    } as unknown as PlatformAdapter;
    const renderer = new Renderer({
        state,
        adapter,
        descriptor: {
            parseVideoIdFromUrl: (url) =>
                /\/watch\/(\d+)/.exec(url)?.[1] ?? null,
        },
        videoId,
        uiRoot: new UiRoot(controller.signal),
        signal: controller.signal,
        logger: createLogger('test'),
        onNavigationMismatch,
    });
    const tick = (time: number): void => {
        video.time = time;
        video.dispatchEvent(new Event('timeupdate'));
    };
    const texts = (): [string, string] => [
        document.getElementById('dualsub-original-subtitle')?.textContent ?? '',
        document.getElementById('dualsub-translated-subtitle')?.textContent ??
            '',
    ];
    const container = (): HTMLElement | null =>
        document.getElementById('dualsub-subtitle-container');
    const slots = (): [string, string] => [
        document.getElementById('dualsub-original-subtitle')?.style.display ??
            '',
        document.getElementById('dualsub-translated-subtitle')?.style.display ??
            '',
    ];
    return {
        controller,
        video,
        state,
        renderer,
        tick,
        texts,
        container,
        slots,
        onNavigationMismatch,
    };
}

describe('Renderer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        document.body.innerHTML = '';
        setUrl('https://www.netflix.com/watch/1');
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('draws only the slots that have text', () => {
        vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
            () => 'Loading…'
        );
        const { renderer, video, state, tick, slots, controller } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        tick(0.5);
        expect(slots()).toEqual(['none', 'none']);

        renderer.setLoading(true);
        tick(0.6);
        expect(slots()).toEqual(['none', 'inline-block']);

        state.loadCues({
            cues: [cue(1, 2, 'Hello', '你好')],
            useNativeTarget: false,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        renderer.setLoading(false);
        tick(1.5);
        expect(slots()).toEqual(['inline-block', 'inline-block']);

        // Past the cue and past the grace that follows a style change.
        vi.setSystemTime(101_000);
        tick(3);
        expect(slots()).toEqual(['none', 'none']);
        // A style change must not bring the empty boxes back.
        renderer.setDisplay({ ...display, gap: 1 });
        expect(slots()).toEqual(['none', 'none']);
        controller.abort();
    });

    it('shows the loading placeholder until cues arrive, then in the translated slot while reloading', () => {
        vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
            () => 'Loading…'
        );
        const { renderer, video, state, tick, texts, container, controller } =
            setup();
        renderer.attachMedia({ root: video.parentElement, video });
        renderer.setLoading(true);
        tick(0.5);
        expect(container()?.style.display).toBe('flex');
        expect(texts()).toEqual(['', 'Loading…']);

        state.loadCues({
            cues: [cue(1, 2, 'Hello', '你好')],
            useNativeTarget: false,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        renderer.setLoading(false);
        tick(1.5);
        expect(texts()).toEqual(['Hello', '你好']);

        renderer.setLoading(true);
        expect(texts()).toEqual(['Hello', 'Loading…']);
        tick(3);
        expect(texts()).toEqual(['', 'Loading…']);
        controller.abort();
    });

    it('paints the active cue pair and clears after the cue plus grace', () => {
        const { renderer, video, state, tick, texts, controller } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        state.loadCues({
            cues: [cue(1, 2, 'Hello', '你好')],
            useNativeTarget: false,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        renderer.cuesChanged();

        tick(1.5);
        expect(texts()).toEqual(['Hello', '你好']);

        // Just past the cue, inside the style grace window: text is kept.
        tick(2.1);
        expect(texts()).toEqual(['Hello', '你好']);

        vi.setSystemTime(100_000 + 1000);
        tick(2.2);
        expect(texts()).toEqual(['', '']);
        controller.abort();
    });

    it('skips redundant frames inside a memoized window', () => {
        const { renderer, video, state, tick, controller } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        state.loadCues({
            cues: [cue(1, 5, 'A')],
            useNativeTarget: false,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        renderer.cuesChanged();
        tick(2);
        const memo = state.frameMemo;
        tick(3);
        expect(state.frameMemo).toBe(memo);
        tick(5.5);
        expect(state.frameMemo).not.toBe(memo);
        controller.abort();
    });

    it('hides and asks for reconciliation when the route no longer matches', () => {
        const {
            renderer,
            video,
            state,
            tick,
            container,
            onNavigationMismatch,
            controller,
        } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        state.loadCues({
            cues: [cue(1, 5, 'A')],
            useNativeTarget: false,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        renderer.cuesChanged();
        tick(2);
        expect(container()?.style.display).toBe('flex');

        setUrl('https://www.netflix.com/watch/2');
        tick(3);
        expect(container()?.style.display).toBe('none');
        expect(onNavigationMismatch).toHaveBeenCalled();
        controller.abort();
    });

    it('respects visibility and rebuilds a container the site removed', () => {
        const { renderer, video, state, tick, container, texts, controller } =
            setup();
        renderer.attachMedia({ root: video.parentElement, video });
        state.loadCues({
            cues: [cue(1, 5, 'A')],
            useNativeTarget: false,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        renderer.setVisible(false);
        tick(2);
        expect(container()?.style.display).toBe('none');
        renderer.setVisible(true);
        expect(texts()[0]).toBe('A');

        container()?.remove();
        expect(document.getElementById('dualsub-ui-root')).not.toBeNull();
        tick(3);
        expect(state.frameMemo?.containerEpoch).toBe(2);
        expect(container()).not.toBeNull();
        expect(texts()[0]).toBe('A');
        controller.abort();
        expect(container()).toBeNull();
    });
});

describe('Renderer.currentTime', () => {
    it('is null without media and offset-adjusted once attached', () => {
        const { renderer, video } = setup();
        expect(renderer.currentTime).toBeNull();
        renderer.setDisplay({ ...display, timeOffset: 0.5 });
        renderer.attachMedia({ root: null, video });
        video.time = 10;
        expect(renderer.currentTime).toBe(10.5);
        renderer.detachMedia();
        expect(renderer.currentTime).toBeNull();
    });
});
