// @vitest-environment happy-dom
import { setUrl } from '@/test-utils/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { AUTO_PLACEMENT, type CuePlacement } from '@/shared/cuePlacement';
import { createLogger } from '@/shared/logger';
import type { PlatformAdapter } from '../platform/types';
import type { Cue } from '../subtitles/cueModel';
import { UiRoot } from './domLayer';
import { DUALSUB_LOOK, type SubtitleLook } from './looks';
import { Renderer } from './Renderer';
import { RendererState } from './RendererState';

const PLATFORM_PRESET: SubtitleLook = {
    ...DUALSUB_LOOK,
    fontWeight: 'bold',
    background: 'transparent',
};

const display = {
    style: 'dualsub' as const,
    fontScale: 1,
    gap: 0.3,
    verticalPosition: 2.8,
    orientation: 'column' as const,
    order: 'original_top' as const,
    timeOffset: 0,
};

const TOP: CuePlacement = { line: 0.15, lineAlign: 'start' };

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
    translated: string | null = null,
    placement: CuePlacement = AUTO_PLACEMENT
): Cue {
    return {
        id: `${start}-${original}`,
        start,
        end,
        cueType: 'original',
        original,
        translated,
        useNativeTarget: false,
        placement,
    };
}

function setup(videoId = '1') {
    const controller = new AbortController();
    const video = makeVideo();
    const state = new RendererState(display);
    const onNavigationMismatch = vi.fn();
    const onOriginalPainted = vi.fn();
    const adapter = {
        getPlaybackTime: (v: HTMLVideoElement) => v.currentTime,
        onClockInvalidated: vi.fn(),
    } as unknown as PlatformAdapter;
    const renderer = new Renderer({
        state,
        adapter,
        descriptor: {
            look: PLATFORM_PRESET,
            parseVideoIdFromUrl: (url) =>
                /\/watch\/(\d+)/.exec(url)?.[1] ?? null,
        },
        platformLook: null,
        videoId,
        uiRoot: new UiRoot(controller.signal),
        signal: controller.signal,
        logger: createLogger('test'),
        onNavigationMismatch,
        onOriginalPainted,
    });
    const tick = (time: number): void => {
        video.time = time;
        video.dispatchEvent(new Event('timeupdate'));
    };
    const stage = (): HTMLElement | null =>
        document.getElementById('dualsub-subtitle-stage');
    const block = (key = 'standard'): HTMLElement | null =>
        document.querySelector<HTMLElement>(`[data-block="${key}"]`);
    const blockKeys = (): (string | undefined)[] =>
        [...document.querySelectorAll<HTMLElement>('[data-block]')].map(
            (element) => element.dataset.block
        );
    const slot = (key: string, name: string): HTMLElement | null =>
        block(key)?.querySelector<HTMLElement>(`.dualsub-${name}-subtitle`) ??
        null;
    const texts = (key = 'standard'): [string, string] => [
        slot(key, 'original')?.textContent ?? '',
        slot(key, 'translated')?.textContent ?? '',
    ];
    const slots = (key = 'standard'): [string, string] => [
        slot(key, 'original')?.style.display ?? '',
        slot(key, 'translated')?.style.display ?? '',
    ];
    const wordsIn = (key: string): number =>
        block(key)?.querySelectorAll('[data-word-index]').length ?? 0;
    const loadCues = (cues: Cue[]): void => {
        state.loadCues({
            cues,
            useNativeTarget: false,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        renderer.cuesChanged();
    };
    return {
        controller,
        video,
        state,
        renderer,
        tick,
        stage,
        block,
        blockKeys,
        texts,
        slots,
        wordsIn,
        loadCues,
        onNavigationMismatch,
        onOriginalPainted,
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
        vi.unstubAllGlobals();
    });

    it('draws only the slots that have text', () => {
        vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
            () => 'Loading…'
        );
        const { renderer, video, tick, slots, loadCues, controller } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        tick(0.5);
        expect(slots()).toEqual(['', '']);

        renderer.setLoading(true);
        tick(0.6);
        expect(slots()).toEqual(['none', 'inline-block']);

        loadCues([cue(1, 2, 'Hello', '你好')]);
        renderer.setLoading(false);
        tick(1.5);
        expect(slots()).toEqual(['inline-block', 'inline-block']);

        // Past the cue and past the grace that follows a style change.
        vi.setSystemTime(101_000);
        tick(3);
        expect(slots()).toEqual(['', '']);
        // A style change must not bring the empty boxes back.
        renderer.setDisplay({ ...display, gap: 1 });
        expect(slots()).toEqual(['', '']);
        controller.abort();
    });

    it('shows the loading placeholder until cues arrive, then in the translated slot while reloading', () => {
        vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
            () => 'Loading…'
        );
        const { renderer, video, tick, texts, stage, loadCues, controller } =
            setup();
        renderer.attachMedia({ root: video.parentElement, video });
        renderer.setLoading(true);
        tick(0.5);
        expect(stage()?.style.display).toBe('block');
        expect(texts()).toEqual(['', 'Loading…']);

        loadCues([cue(1, 2, 'Hello', '你好')]);
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
        const {
            renderer,
            video,
            tick,
            texts,
            blockKeys,
            loadCues,
            controller,
        } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        loadCues([cue(1, 2, 'Hello', '你好')]);

        tick(1.5);
        expect(texts()).toEqual(['Hello', '你好']);

        // Just past the cue, inside the style grace window: text is kept.
        tick(2.1);
        expect(texts()).toEqual(['Hello', '你好']);

        vi.setSystemTime(100_000 + 1000);
        tick(2.2);
        expect(blockKeys()).toEqual([]);
        controller.abort();
    });

    it('draws a cue the platform raised at its line, above the standard block', () => {
        const { renderer, video, tick, texts, block, blockKeys, loadCues } =
            setup();
        renderer.attachMedia({ root: video.parentElement, video });
        loadCues([
            cue(1, 5, 'Dialogue', '对白'),
            cue(1, 5, 'SIGN', '标志', TOP),
            cue(2, 5, 'Raised', '抬高', { line: 0.85, lineAlign: 'end' }),
        ]);

        tick(1.5);
        expect(blockKeys()).toEqual(['standard', 'start:0.15']);
        expect(texts()).toEqual(['Dialogue', '对白']);
        expect(texts('start:0.15')).toEqual(['SIGN', '标志']);
        expect(block('start:0.15')?.style.top).toBe('15%');
        expect(block()?.style.top).toBe('auto');

        tick(3);
        expect(texts()).toEqual(['Dialogue\nRaised', '对白\n抬高']);

        vi.setSystemTime(101_000);
        tick(6);
        expect(blockKeys()).toEqual([]);
    });

    it('moves the clickable words to the line that remains when the standard block ends', () => {
        const {
            renderer,
            video,
            tick,
            block,
            wordsIn,
            loadCues,
            onOriginalPainted,
        } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        renderer.setInteractive(true);
        loadCues([
            cue(1, 3, 'Hello there', '你好'),
            cue(1, 5, 'SIGN TEXT', '标志', TOP),
        ]);

        tick(2);
        expect(wordsIn('standard')).toBe(2);
        expect(wordsIn('start:0.15')).toBe(0);
        expect(onOriginalPainted).toHaveBeenLastCalledWith(1);

        vi.setSystemTime(101_000);
        tick(4);
        expect(block('standard')).toBeNull();
        expect(wordsIn('start:0.15')).toBe(2);
        expect(onOriginalPainted).toHaveBeenLastCalledWith(2);
    });

    it('drops a finished block at once when another placement stays active', () => {
        const { renderer, video, tick, blockKeys, wordsIn, loadCues } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        renderer.setInteractive(true);
        loadCues([cue(1, 3, 'Dialogue'), cue(1, 5, 'SIGN', null, TOP)]);
        tick(2);
        expect(blockKeys()).toEqual(['standard', 'start:0.15']);
        expect(wordsIn('standard')).toBe(1);

        // The standard cue ends now, inside the restyle grace.
        tick(3);
        expect(blockKeys()).toEqual(['start:0.15']);
        expect(wordsIn('start:0.15')).toBe(1);
    });

    it('draws cues at nearby lines as separate blocks, each at its own line', () => {
        const { renderer, video, tick, block, blockKeys, loadCues } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        loadCues([
            cue(1, 3, 'A', null, { line: 0.1, lineAlign: 'start' }),
            cue(1, 3, 'B', null, { line: 0.12, lineAlign: 'start' }),
        ]);
        tick(2);
        expect(blockKeys()).toEqual(['start:0.1', 'start:0.12']);
        expect(block('start:0.1')?.style.top).toBe('10%');
        expect(block('start:0.12')?.style.top).toBe('12%');
    });

    it('advances the revision when the clickable line moves to another block with the same text', () => {
        const { renderer, video, tick, wordsIn, loadCues, onOriginalPainted } =
            setup();
        renderer.attachMedia({ root: video.parentElement, video });
        renderer.setInteractive(true);
        loadCues([cue(1, 3, 'Hello'), cue(1, 5, 'Hello', null, TOP)]);
        tick(2);
        expect(onOriginalPainted).toHaveBeenLastCalledWith(1);
        tick(4);
        expect(wordsIn('start:0.15')).toBe(1);
        expect(onOriginalPainted).toHaveBeenLastCalledWith(2);
    });

    it('replaces a dropped block at once when the new cue set draws elsewhere', () => {
        const { renderer, video, tick, blockKeys, texts, loadCues } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        loadCues([cue(1, 5, 'Old')]);
        tick(2);
        loadCues([cue(1, 5, 'New', null, TOP)]);
        expect(blockKeys()).toEqual(['start:0.15']);
        expect(texts('start:0.15')).toEqual(['New', '']);
    });

    it('skips redundant frames inside a memoized window', () => {
        const { renderer, video, state, tick, loadCues, controller } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        loadCues([cue(1, 5, 'A')]);
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
            tick,
            stage,
            loadCues,
            onNavigationMismatch,
            controller,
        } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        loadCues([cue(1, 5, 'A')]);
        tick(2);
        expect(stage()?.style.display).toBe('block');

        setUrl('https://www.netflix.com/watch/2');
        tick(3);
        expect(stage()?.style.display).toBe('none');
        expect(onNavigationMismatch).toHaveBeenCalled();
        controller.abort();
    });

    it('respects visibility and rebuilds a stage the site removed', () => {
        const {
            renderer,
            video,
            state,
            tick,
            stage,
            texts,
            loadCues,
            controller,
        } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        loadCues([cue(1, 5, 'A')]);
        renderer.setVisible(false);
        tick(2);
        expect(stage()?.style.display).toBe('none');
        renderer.setVisible(true);
        expect(texts()[0]).toBe('A');

        stage()?.remove();
        expect(document.getElementById('dualsub-ui-root')).not.toBeNull();
        tick(3);
        expect(state.frameMemo?.containerEpoch).toBe(2);
        expect(stage()).not.toBeNull();
        expect(texts()[0]).toBe('A');
        controller.abort();
        expect(stage()).toBeNull();
    });
});

describe('Renderer styling', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        setUrl('https://www.netflix.com/watch/1');
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function original(): HTMLElement {
        return document.querySelector<HTMLElement>(
            '.dualsub-original-subtitle'
        )!;
    }

    function showCue(
        loadCues: (cues: Cue[]) => void,
        tick: (time: number) => void
    ): void {
        loadCues([cue(1, 5, 'A', 'B')]);
        tick(2);
    }

    it('sizes text from the picture height, the scale, and every resize', () => {
        let notify: (() => void) | null = null;
        let disconnected = false;
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: () => void) {
                    notify = callback;
                }
                observe(): void {}
                disconnect(): void {
                    disconnected = true;
                }
            }
        );
        const { renderer, video, tick, loadCues, controller } = setup();
        let height = 500;
        video.getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 800, height }) as DOMRect;
        renderer.attachMedia({ root: video.parentElement, video });
        showCue(loadCues, tick);
        expect(original().style.fontSize).toBe('10px');

        renderer.setDisplay({ ...display, fontScale: 2 });
        expect(original().style.fontSize).toBe('20px');

        height = 1000;
        notify!();
        expect(original().style.fontSize).toBe('40px');

        renderer.detachMedia();
        expect(disconnected).toBe(true);
        controller.abort();
    });

    it('switches between the DualSub and platform looks', () => {
        const { renderer, video, tick, loadCues, controller } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        showCue(loadCues, tick);
        expect(original().style.fontWeight).toBe('normal');

        renderer.setDisplay({ ...display, style: 'platform' });
        expect(original().style.fontWeight).toBe('bold');
        expect(original().style.backgroundColor).toBe('transparent');
        expect(original().textContent).toBe('A');

        renderer.setDisplay(display);
        expect(original().style.fontWeight).toBe('normal');
        controller.abort();
    });

    it("applies the viewer's reported platform look over the preset", () => {
        const { renderer, video, tick, loadCues, controller } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        showCue(loadCues, tick);
        renderer.setDisplay({ ...display, style: 'platform' });
        expect(original().style.fontWeight).toBe('bold');

        renderer.setPlatformLook({ ...DUALSUB_LOOK, fontWeight: '600' });
        expect(original().style.fontWeight).toBe('600');
        renderer.setPlatformLook(null);
        expect(original().style.fontWeight).toBe('bold');
        controller.abort();
    });

    it('lays the stage over the picture inside the box, not the letterbox bars', () => {
        const { renderer, video, tick, stage, loadCues, controller } = setup();
        video.getBoundingClientRect = () =>
            ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect;
        Object.defineProperty(video, 'videoWidth', { value: 2390 });
        Object.defineProperty(video, 'videoHeight', { value: 1000 });
        renderer.attachMedia({ root: video.parentElement, video });
        showCue(loadCues, tick);
        expect(original().style.fontSize).toBe('8.37px');
        expect(stage()?.style.width).toBe('1000px');
        expect(parseFloat(stage()?.style.height ?? '')).toBeCloseTo(418.41, 1);
        expect(parseFloat(stage()?.style.top ?? '')).toBeCloseTo(290.79, 1);
        controller.abort();
    });

    it('follows the picture when the video moves without resizing', () => {
        const { renderer, video, tick, stage, controller } = setup();
        let left = 0;
        video.getBoundingClientRect = () =>
            ({ left, top: 0, width: 800, height: 450 }) as DOMRect;
        renderer.attachMedia({ root: video.parentElement, video });
        expect(stage()?.style.left).toBe('0px');

        left = 120;
        tick(1);
        expect(stage()?.style.left).toBe('120px');
        controller.abort();
    });

    it('styles a re-bound video for the display chosen while detached', () => {
        const { renderer, video, tick, loadCues, controller } = setup();
        renderer.attachMedia({ root: video.parentElement, video });
        renderer.detachMedia();
        expect(document.getElementById('dualsub-subtitle-stage')).toBeNull();

        renderer.setDisplay({ ...display, style: 'platform' });
        renderer.attachMedia({ root: video.parentElement, video });
        showCue(loadCues, tick);
        expect(original().style.fontWeight).toBe('bold');
        controller.abort();
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
