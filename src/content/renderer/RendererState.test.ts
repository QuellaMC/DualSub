import { describe, expect, it } from 'vitest';
import { RendererState } from './RendererState';

const display = {
    fontSizeVw: 1.1,
    gap: 0.3,
    verticalPosition: 2.8,
    orientation: 'column' as const,
    order: 'original_top' as const,
    timeOffset: 0,
};

describe('RendererState.shouldRender', () => {
    const video = {} as HTMLVideoElement;

    function stateWithMemo(
        overrides: Partial<NonNullable<RendererState['frameMemo']>> = {}
    ) {
        const state = new RendererState(display);
        state.frameMemo = {
            evaluatedTime: 10,
            nextBoundaryTime: 12,
            nextBoundaryInclusive: false,
            wallClockDeadline: null,
            href: 'https://n/watch/1',
            containerEpoch: 1,
            video,
            ...overrides,
        };
        return state;
    }

    it('renders when nothing is memoized', () => {
        expect(
            new RendererState(display).shouldRender(1, 'h', 1, video, 0)
        ).toBe(true);
    });

    it('skips frames inside the memoized window', () => {
        expect(
            stateWithMemo().shouldRender(11, 'https://n/watch/1', 1, video, 0)
        ).toBe(false);
        expect(
            stateWithMemo().shouldRender(12, 'https://n/watch/1', 1, video, 0)
        ).toBe(false);
        expect(
            stateWithMemo().shouldRender(
                12.001,
                'https://n/watch/1',
                1,
                video,
                0
            )
        ).toBe(true);
    });

    it('honors inclusive boundaries, time regression, href, container, and video identity', () => {
        expect(
            stateWithMemo({ nextBoundaryInclusive: true }).shouldRender(
                12,
                'https://n/watch/1',
                1,
                video,
                0
            )
        ).toBe(true);
        expect(
            stateWithMemo().shouldRender(9, 'https://n/watch/1', 1, video, 0)
        ).toBe(true);
        expect(
            stateWithMemo().shouldRender(11, 'https://n/watch/2', 1, video, 0)
        ).toBe(true);
        expect(
            stateWithMemo().shouldRender(11, 'https://n/watch/1', 2, video, 0)
        ).toBe(true);
        expect(
            stateWithMemo().shouldRender(
                11,
                'https://n/watch/1',
                1,
                {} as HTMLVideoElement,
                0
            )
        ).toBe(true);
    });

    it('wakes up when a wall-clock grace deadline passes', () => {
        const state = stateWithMemo({
            wallClockDeadline: 5000,
            nextBoundaryTime: null,
        });
        expect(
            state.shouldRender(11, 'https://n/watch/1', 1, video, 4999)
        ).toBe(false);
        expect(
            state.shouldRender(11, 'https://n/watch/1', 1, video, 5000)
        ).toBe(true);
    });

    it('mutations invalidate the memo', () => {
        const state = stateWithMemo();
        state.setDisplay({ ...display, fontSizeVw: 2 });
        expect(state.frameMemo).toBeNull();
    });
});
