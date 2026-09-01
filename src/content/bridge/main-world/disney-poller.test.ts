// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUrl } from '@/test-utils/dom';
import type { CapturedEvent } from '../protocol';

// The recipe captures window timers at module evaluation, so fake timers
// must be installed before the module loads.
vi.useFakeTimers();
const { disneyRecipe } = await import('./disney-recipe');

function mountPlayer(playheadMs: number): {
    setPlayhead: (ms: number) => void;
} {
    document.body.innerHTML = '';
    const api = {
        timeline: { info: { playheadPositionMs: playheadMs } },
        mediaPlaybackCriteria: {
            metadata: { availId: 'avail-1' },
            telemetryParameters: {
                conviva: { metadata: { playbackSessionId: 'ps-1' } },
            },
        },
    };
    const player = document.createElement('disney-web-player-ui') as Element & {
        mediaPlayerApi?: unknown;
    };
    player.mediaPlayerApi = api;
    const overlay = document.createElement(
        'main-app-controls-overlay'
    ) as Element & { store?: unknown };
    overlay.store = { interstitials: { isInterstitialPlaying: false } };
    document.body.append(player, overlay);
    return {
        setPlayhead: (ms) => {
            api.timeline.info.playheadPositionMs = ms;
        },
    };
}

describe('disneyRecipe timeline poller', () => {
    const emitted: CapturedEvent[] = [];
    const emit = (event: CapturedEvent): void => {
        emitted.push(event);
    };

    beforeEach(() => {
        emitted.length = 0;
        setUrl('https://www.disneyplus.com/play/abc-123');
    });
    afterEach(() => {
        disneyRecipe.onControl?.({ t: 'playback-bridge-pause' }, emit);
    });

    it('emits on resume, deduplicates identical samples until the heartbeat, and stops on pause', () => {
        const player = mountPlayer(5000);
        disneyRecipe.onControl?.({ t: 'playback-bridge-resume' }, emit);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({
            t: 'timeline-update',
            platform: 'disneyplus',
            sequence: 1,
            videoId: 'abc-123',
            programTimeSeconds: 5,
            availId: 'avail-1',
            playbackSessionId: 'ps-1',
            isInterstitialPlaying: false,
        });

        vi.advanceTimersByTime(600);
        expect(emitted).toHaveLength(1);
        vi.advanceTimersByTime(900);
        expect(emitted).toHaveLength(2);

        player.setPlayhead(6200);
        vi.advanceTimersByTime(300);
        expect(emitted).toHaveLength(3);
        expect(emitted[2]).toMatchObject({ programTimeSeconds: 6.2 });

        disneyRecipe.onControl?.({ t: 'playback-bridge-pause' }, emit);
        player.setPlayhead(9000);
        vi.advanceTimersByTime(3000);
        expect(emitted).toHaveLength(3);
    });

    it('answers an explicit request even while paused', () => {
        mountPlayer(1000);
        disneyRecipe.onControl?.({ t: 'request-playback-timeline' }, emit);
        expect(emitted).toHaveLength(1);
    });

    it('emits nothing off a player route or without a program clock', () => {
        mountPlayer(1000);
        setUrl('https://www.disneyplus.com/home');
        disneyRecipe.onControl?.({ t: 'request-playback-timeline' }, emit);
        expect(emitted).toHaveLength(0);

        setUrl('https://www.disneyplus.com/play/abc-123');
        document.body.innerHTML = '';
        disneyRecipe.onControl?.({ t: 'request-playback-timeline' }, emit);
        expect(emitted).toHaveLength(0);
    });
});
