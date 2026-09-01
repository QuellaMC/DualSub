// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/unbound-method -- history methods are compared by identity here, never invoked */
import { setUrl } from '@/test-utils/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationWatcher } from './NavigationWatcher';

describe('NavigationWatcher', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setUrl('https://www.netflix.com/watch/1');
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports pushState navigations after the debounce', () => {
        const onChange = vi.fn();
        const controller = new AbortController();
        new NavigationWatcher(onChange).start(controller.signal);

        history.pushState({}, '', '/watch/2');
        expect(onChange).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(onChange).toHaveBeenCalledWith(
            'https://www.netflix.com/watch/1',
            'https://www.netflix.com/watch/2'
        );
        controller.abort();
    });

    it('coalesces bursts into one change report', () => {
        const onChange = vi.fn();
        const controller = new AbortController();
        new NavigationWatcher(onChange).start(controller.signal);
        history.replaceState({}, '', '/watch/2');
        history.pushState({}, '', '/watch/3');
        vi.advanceTimersByTime(100);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0]?.[1]).toBe(
            'https://www.netflix.com/watch/3'
        );
        controller.abort();
    });

    it('catches silent URL changes through the poll', () => {
        const onChange = vi.fn();
        const controller = new AbortController();
        new NavigationWatcher(onChange).start(controller.signal);
        setUrl('https://www.netflix.com/watch/9');
        vi.advanceTimersByTime(1000);
        expect(onChange).toHaveBeenCalledOnce();
        controller.abort();
    });

    it('restores history methods only when still owned', () => {
        const originalPush = history.pushState;
        const controller = new AbortController();
        new NavigationWatcher(() => undefined).start(controller.signal);
        expect(history.pushState).not.toBe(originalPush);
        controller.abort();
        expect(history.pushState).toBe(originalPush);

        const second = new AbortController();
        new NavigationWatcher(() => undefined).start(second.signal);
        const siteWrapper = function (
            this: History
        ) {} as typeof history.pushState;
        history.pushState = siteWrapper;
        second.abort();
        expect(history.pushState).toBe(siteWrapper);
        history.pushState = originalPush;
    });
});
