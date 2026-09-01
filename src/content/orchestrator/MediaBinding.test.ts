// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/shared/logger';
import { MediaBinding } from './MediaBinding';

function makeVideo(): HTMLVideoElement {
    const root = document.createElement('div');
    root.className = 'watch-video';
    const video = document.createElement('video');
    root.appendChild(video);
    document.body.appendChild(root);
    return video;
}

describe('MediaBinding', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('binds once a video appears inside its container and reports loss', () => {
        let video: HTMLVideoElement | null = null;
        const onBound = vi.fn();
        const onLost = vi.fn();
        const controller = new AbortController();
        new MediaBinding({
            adapter: {
                discoverVideo: () => video,
                getPlayerContainer: (v) => v.closest('div.watch-video'),
            },
            requireReplacementOf: null,
            onBound,
            onLost,
            signal: controller.signal,
            logger: createLogger('test'),
        }).start();

        vi.advanceTimersByTime(1000);
        expect(onBound).not.toHaveBeenCalled();
        video = makeVideo();
        vi.advanceTimersByTime(1000);
        expect(onBound).toHaveBeenCalledOnce();

        video.remove();
        video = null;
        vi.advanceTimersByTime(1000);
        expect(onLost).toHaveBeenCalledOnce();
        controller.abort();
    });

    it('refuses the previous episode element until the replacement window elapses', () => {
        const stale = makeVideo();
        const staleScope = {
            root: stale.closest('div.watch-video') as HTMLElement,
            video: stale,
        };
        const onBound = vi.fn();
        const controller = new AbortController();
        new MediaBinding({
            adapter: {
                discoverVideo: () => stale,
                getPlayerContainer: (v) => v.closest('div.watch-video'),
            },
            requireReplacementOf: staleScope,
            onBound,
            onLost: vi.fn(),
            signal: controller.signal,
            logger: createLogger('test'),
        }).start();

        vi.advanceTimersByTime(5000);
        expect(onBound).not.toHaveBeenCalled();
        vi.advanceTimersByTime(4000);
        expect(onBound).toHaveBeenCalledOnce();
        controller.abort();
    });

    it('accepts a genuinely new element immediately', () => {
        const stale = makeVideo();
        const fresh = makeVideo();
        const onBound = vi.fn();
        const controller = new AbortController();
        new MediaBinding({
            adapter: {
                discoverVideo: () => fresh,
                getPlayerContainer: (v) => v.closest('div.watch-video'),
            },
            requireReplacementOf: {
                root: stale.closest('div.watch-video') as HTMLElement,
                video: stale,
            },
            onBound,
            onLost: vi.fn(),
            signal: controller.signal,
            logger: createLogger('test'),
        }).start();
        expect(onBound).toHaveBeenCalledWith({
            root: fresh.closest('div.watch-video'),
            video: fresh,
        });
        controller.abort();
    });
});
