// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/shared/logger';
import type { CapturedEvent } from '../../bridge/protocol';
import { DisneyClock, type RuntimeIdentity } from './clock';

type TimelineUpdate = Extract<CapturedEvent, { t: 'timeline-update' }>;

function video(
    currentTime: number
): HTMLVideoElement & { currentTime: number } {
    return { currentTime } as HTMLVideoElement & { currentTime: number };
}

function update(overrides: Partial<TimelineUpdate> = {}): TimelineUpdate {
    return {
        t: 'timeline-update',
        platform: 'disneyplus',
        sequence: 1,
        videoId: 'abc',
        programTimeSeconds: 100,
        availId: 'avail-1',
        playbackSessionId: 'session-1',
        isInterstitialPlaying: false,
        ...overrides,
    };
}

function makeClock(
    options: {
        staleIdentity?: RuntimeIdentity | null;
        timeline?: () => Element | null;
    } = {}
) {
    const requestTimeline = vi.fn();
    const clock = new DisneyClock({
        videoId: 'abc',
        staleIdentity: options.staleIdentity ?? null,
        locateTimeline: options.timeline ?? (() => null),
        requestTimeline,
        logger: createLogger('test'),
    });
    return { clock, requestTimeline };
}

describe('DisneyClock runtime anchor tier', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses the media clock until an anchor arrives, then projects program time', () => {
        const { clock } = makeClock();
        const v = video(10);
        expect(clock.getPlaybackTime(v)).toBe(10);

        clock.onTimelineUpdate(update({ programTimeSeconds: 100 }), v);
        v.currentTime = 12.5;
        expect(clock.getPlaybackTime(v)).toBeCloseTo(102.5);
    });

    it('suppresses subtitles during interstitials', () => {
        const { clock } = makeClock();
        const v = video(10);
        clock.onTimelineUpdate(update({ isInterstitialPlaying: true }), v);
        expect(clock.getPlaybackTime(v)).toBeNull();
        clock.onTimelineUpdate(
            update({ sequence: 2, isInterstitialPlaying: false }),
            v
        );
        expect(clock.getPlaybackTime(v)).toBe(100);
    });

    it('ignores other videos, stale identities, and out-of-order sequences', () => {
        const { clock } = makeClock({
            staleIdentity: { availId: 'old', playbackSessionId: 'old-session' },
        });
        const v = video(10);
        clock.onTimelineUpdate(update({ videoId: 'other' }), v);
        expect(clock.getPlaybackTime(v)).toBe(10);
        clock.onTimelineUpdate(
            update({ availId: 'old', playbackSessionId: 'old-session' }),
            v
        );
        expect(clock.getPlaybackTime(v)).toBe(10);

        clock.onTimelineUpdate(
            update({ sequence: 5, programTimeSeconds: 100 }),
            v
        );
        clock.onTimelineUpdate(
            update({ sequence: 4, programTimeSeconds: 500 }),
            v
        );
        expect(clock.getPlaybackTime(v)).toBe(100);
    });

    it('after a seek, requires a coherent sample before re-anchoring', () => {
        const { clock, requestTimeline } = makeClock();
        const v = video(10);
        clock.onTimelineUpdate(
            update({ sequence: 1, programTimeSeconds: 100 }),
            v
        );

        v.currentTime = 50;
        clock.invalidate();
        expect(requestTimeline).toHaveBeenCalledOnce();
        expect(clock.getPlaybackTime(v)).toBeNull();

        // Program clock has not caught up (incoherent with previous anchor):
        // becomes pending, still suppressed.
        clock.onTimelineUpdate(
            update({ sequence: 2, programTimeSeconds: 100 }),
            v
        );
        expect(clock.getPlaybackTime(v)).toBeNull();

        // A second sample coherent with the pending one, 100ms later, promotes.
        vi.setSystemTime(1_000_150);
        v.currentTime = 50.15;
        clock.onTimelineUpdate(
            update({ sequence: 3, programTimeSeconds: 100.15 }),
            v
        );
        expect(clock.getPlaybackTime(v)).toBeCloseTo(100.15);
    });

    it('a directly coherent post-seek sample re-anchors immediately', () => {
        const { clock } = makeClock();
        const v = video(10);
        clock.onTimelineUpdate(
            update({ sequence: 1, programTimeSeconds: 100 }),
            v
        );
        v.currentTime = 40;
        clock.invalidate();
        clock.onTimelineUpdate(
            update({ sequence: 2, programTimeSeconds: 130 }),
            v
        );
        v.currentTime = 41;
        expect(clock.getPlaybackTime(v)).toBeCloseTo(131);
    });

    it('hands its identity to the successor, which treats it as stale', () => {
        const { clock } = makeClock();
        const v = video(10);
        clock.onTimelineUpdate(update(), v);
        const identity = clock.identityForHandoff();
        expect(identity).toEqual({
            availId: 'avail-1',
            playbackSessionId: 'session-1',
        });

        const { clock: successor } = makeClock({ staleIdentity: identity });
        successor.onTimelineUpdate(update({ programTimeSeconds: 999 }), v);
        expect(successor.getPlaybackTime(v)).toBe(10);
    });
});

describe('DisneyClock slider tier', () => {
    function slider(valueNow: number): Element {
        const element = document.createElement('div');
        element.setAttribute('aria-valuenow', String(valueNow));
        return element;
    }

    it('applies the slider offset only when it proves a distinct clock origin', () => {
        const far = makeClock({ timeline: () => slider(20) });
        expect(far.clock.getPlaybackTime(video(10))).toBe(20);

        const near = makeClock({ timeline: () => slider(11) });
        expect(near.clock.getPlaybackTime(video(10))).toBe(10);
    });

    it('keeps the calibrated offset while controls are unmounted', () => {
        let mounted: Element | null = slider(20);
        const { clock } = makeClock({ timeline: () => mounted });
        const v = video(10);
        expect(clock.getPlaybackTime(v)).toBe(20);
        mounted = null;
        v.currentTime = 11;
        expect(clock.getPlaybackTime(v)).toBe(21);
    });
});
