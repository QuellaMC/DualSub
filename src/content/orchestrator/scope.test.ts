import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ScopeEndedError,
    childScope,
    ensureLive,
    runScoped,
    scopedInterval,
    scopedTimeout,
} from './scope';

describe('scope helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('ensureLive throws only after abort', () => {
        const controller = new AbortController();
        expect(() => ensureLive(controller.signal)).not.toThrow();
        controller.abort();
        expect(() => ensureLive(controller.signal)).toThrow(ScopeEndedError);
    });

    it('child scopes follow the parent but can end alone', () => {
        const parent = new AbortController();
        const child = childScope(parent.signal);
        const sibling = childScope(parent.signal);
        child.abort();
        expect(child.signal.aborted).toBe(true);
        expect(sibling.signal.aborted).toBe(false);
        parent.abort();
        expect(sibling.signal.aborted).toBe(true);
        expect(childScope(parent.signal).signal.aborted).toBe(true);
    });

    it('scoped timers stop firing once the scope ends', () => {
        const controller = new AbortController();
        const timeout = vi.fn();
        const interval = vi.fn();
        scopedTimeout(controller.signal, timeout, 100);
        scopedInterval(controller.signal, interval, 50);
        vi.advanceTimersByTime(60);
        expect(interval).toHaveBeenCalledTimes(1);
        controller.abort();
        vi.advanceTimersByTime(500);
        expect(timeout).not.toHaveBeenCalled();
        expect(interval).toHaveBeenCalledTimes(1);
    });

    it('runScoped swallows ScopeEndedError (an unhandled rejection would fail this test)', async () => {
        runScoped(Promise.reject(new ScopeEndedError()));
        await Promise.resolve();
        await Promise.resolve();
    });
});
