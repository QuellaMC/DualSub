import { describe, expect, it, vi } from 'vitest';
import type { CapturedEvent } from './protocol';
import { SubtitleEventCache } from './SubtitleEventCache';

function event(movieId: string, marker = 0): CapturedEvent {
    return {
        t: 'subtitle-data',
        platform: 'netflix',
        languages: ['en'],
        movieId,
        tracks: [marker],
    };
}

describe('SubtitleEventCache', () => {
    it('replays retained events synchronously on subscribe, then streams', () => {
        const cache = new SubtitleEventCache();
        cache.publish('v1', event('v1', 1));
        const received: CapturedEvent[] = [];
        cache.subscribe(
            'v1',
            (e) => received.push(e),
            new AbortController().signal
        );
        expect(received).toEqual([event('v1', 1)]);
        cache.publish('v1', event('v1', 2));
        expect(received).toHaveLength(2);
    });

    it('keeps retention after delivery so a successor session can replay', () => {
        const cache = new SubtitleEventCache();
        const first = new AbortController();
        cache.subscribe('v1', () => undefined, first.signal);
        cache.publish('v1', event('v1'));
        first.abort();

        const replayed = vi.fn();
        cache.subscribe('v1', replayed, new AbortController().signal);
        expect(replayed).toHaveBeenCalledOnce();
    });

    it('stops delivering after the subscriber scope ends', () => {
        const cache = new SubtitleEventCache();
        const controller = new AbortController();
        const handler = vi.fn();
        cache.subscribe('v1', handler, controller.signal);
        controller.abort();
        cache.publish('v1', event('v1'));
        expect(handler).not.toHaveBeenCalled();
    });

    it('expires retained events after ten minutes', () => {
        let now = 0;
        const cache = new SubtitleEventCache(() => now);
        cache.publish('v1', event('v1'));
        now = 10 * 60 * 1000 + 1;
        const handler = vi.fn();
        cache.subscribe('v1', handler, new AbortController().signal);
        expect(handler).not.toHaveBeenCalled();
    });

    it('bounds retention to 8 videos and 100 events, oldest first', () => {
        const cache = new SubtitleEventCache();
        for (let i = 0; i < 9; i += 1) {
            cache.publish(`v${i}`, event(`v${i}`));
        }
        const dropped = vi.fn();
        cache.subscribe('v0', dropped, new AbortController().signal);
        expect(dropped).not.toHaveBeenCalled();
        const kept = vi.fn();
        cache.subscribe('v8', kept, new AbortController().signal);
        expect(kept).toHaveBeenCalledOnce();

        const bulk = new SubtitleEventCache();
        for (let i = 0; i < 120; i += 1) {
            bulk.publish('v', event('v', i));
        }
        const received: CapturedEvent[] = [];
        bulk.subscribe(
            'v',
            (e) => received.push(e),
            new AbortController().signal
        );
        expect(received).toHaveLength(100);
        expect(received[0]).toEqual(event('v', 20));
    });
});
