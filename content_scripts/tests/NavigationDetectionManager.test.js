import { jest } from '@jest/globals';

import {
    NavigationDetectionManager,
    isDisneyPlusPlayerPath,
    isNetflixPlayerPath,
} from '../shared/navigationUtils.js';

describe('player route classification', () => {
    test.each([
        [isNetflixPlayerPath, '/watch/123', true],
        [isNetflixPlayerPath, '/watch/123/', true],
        [isNetflixPlayerPath, '/watch', false],
        [isNetflixPlayerPath, '/watch/123/details', false],
        [isDisneyPlusPlayerPath, '/play/abc', true],
        [isDisneyPlusPlayerPath, '/video/abc/', true],
        [isDisneyPlusPlayerPath, '/browse', false],
        [isDisneyPlusPlayerPath, null, false],
    ])('%p classifies %p', (classify, pathname, expected) => {
        expect(classify(pathname)).toBe(expected);
    });
});

describe('NavigationDetectionManager', () => {
    let manager;
    let originalPushState;
    let originalReplaceState;

    beforeEach(() => {
        jest.useFakeTimers();
        originalPushState = history.pushState;
        originalReplaceState = history.replaceState;
        originalReplaceState.call(history, {}, '', '/browse');
    });

    afterEach(() => {
        manager?.cleanup();
        history.pushState = originalPushState;
        history.replaceState = originalReplaceState;
        originalReplaceState.call(history, {}, '', '/');
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    function setup(options = {}) {
        manager = new NavigationDetectionManager('netflix', {
            logger: jest.fn(),
            ...options,
        });
        manager.setupComprehensiveNavigation();
        return manager;
    }

    test('reports a history navigation and player transition in public order', () => {
        const calls = [];
        setup({
            useIntervalChecking: false,
            onUrlChange: (oldUrl, newUrl) =>
                calls.push(['url', oldUrl, newUrl]),
            onPageTransition: (wasPlayer, isPlayer) =>
                calls.push(['transition', wasPlayer, isPlayer]),
        });

        history.pushState({}, '', '/watch/123');
        jest.advanceTimersByTime(100);

        expect(calls).toEqual([
            [
                'url',
                expect.stringContaining('/browse'),
                `${window.location.origin}/watch/123`,
            ],
            ['transition', false, true],
        ]);
    });

    test('coalesces a history burst into one check of the final URL', () => {
        const onUrlChange = jest.fn();
        setup({ useIntervalChecking: false, onUrlChange });

        history.pushState({}, '', '/watch/1');
        history.replaceState({}, '', '/watch/2');
        history.pushState({}, '', '/watch/3');
        jest.advanceTimersByTime(100);

        expect(onUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledWith(
            expect.stringContaining('/browse'),
            `${window.location.origin}/watch/3`
        );
    });

    test('coalesces browser, focus, and visibility signals', () => {
        const onUrlChange = jest.fn();
        setup({ useIntervalChecking: false, onUrlChange });
        originalReplaceState.call(history, {}, '', '/watch/events');

        window.dispatchEvent(new Event('popstate'));
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        jest.advanceTimersByTime(100);

        expect(onUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledWith(
            expect.stringContaining('/browse'),
            `${window.location.origin}/watch/events`
        );
    });

    test('uses the configured interval as a fallback detector', () => {
        const onUrlChange = jest.fn();
        setup({
            useHistoryAPI: false,
            usePopstateEvents: false,
            useFocusEvents: false,
            intervalMs: 250,
            onUrlChange,
        });
        originalReplaceState.call(history, {}, '', '/watch/interval');

        jest.advanceTimersByTime(249);
        expect(onUrlChange).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(onUrlChange).toHaveBeenCalledTimes(1);
    });

    test('uses a custom player-page classifier', () => {
        const onPageTransition = jest.fn();
        const isPlayerPage = jest.fn((pathname) => pathname === '/custom');
        setup({
            useIntervalChecking: false,
            isPlayerPage,
            onPageTransition,
        });

        history.pushState({}, '', '/custom');
        jest.advanceTimersByTime(100);

        expect(isPlayerPage).toHaveBeenCalledWith('/browse');
        expect(isPlayerPage).toHaveBeenCalledWith('/custom');
        expect(onPageTransition).toHaveBeenCalledWith(false, true);
    });

    test('cleanup restores history and cancels every pending source', () => {
        const onUrlChange = jest.fn();
        setup({ onUrlChange });
        history.pushState({}, '', '/watch/pending');

        manager.cleanup();

        expect(history.pushState).toBe(originalPushState);
        expect(history.replaceState).toBe(originalReplaceState);
        expect(manager.intervalId).toBeNull();
        expect(manager.pendingUrlCheckTimeoutId).toBeNull();
        expect(manager.abortController).toBeNull();
        expect(manager.isSetup).toBe(false);
        window.dispatchEvent(new Event('popstate'));
        window.dispatchEvent(new Event('focus'));
        jest.advanceTimersByTime(1000);
        expect(onUrlChange).not.toHaveBeenCalled();
        expect(() => manager.cleanup()).not.toThrow();
    });

    test('a stale scheduled check cannot run in a later setup generation', () => {
        const onUrlChange = jest.fn();
        const timeoutSpy = jest.spyOn(global, 'setTimeout');
        setup({ useIntervalChecking: false, onUrlChange });
        history.pushState({}, '', '/watch/stale');
        const staleCallback = timeoutSpy.mock.calls.at(-1)[0];

        manager.cleanup();
        manager.setupComprehensiveNavigation();
        history.pushState({}, '', '/watch/fresh');
        const freshTimeout = manager.pendingUrlCheckTimeoutId;
        staleCallback();

        expect(manager.pendingUrlCheckTimeoutId).toBe(freshTimeout);
        expect(onUrlChange).not.toHaveBeenCalled();
        jest.advanceTimersByTime(100);
        expect(onUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledWith(
            expect.stringContaining('/browse'),
            `${window.location.origin}/watch/fresh`
        );
    });

    test('setup failure rolls back and permits a clean retry', () => {
        manager = new NavigationDetectionManager('netflix', {
            logger: jest.fn(),
        });
        const realAddEventListener = window.addEventListener.bind(window);
        const addListener = jest
            .spyOn(window, 'addEventListener')
            .mockImplementation((eventName, ...args) => {
                if (eventName === 'hashchange') {
                    throw new Error('registration failed');
                }
                return realAddEventListener(eventName, ...args);
            });

        expect(() => manager.setupComprehensiveNavigation()).toThrow(
            'registration failed'
        );
        expect(history.pushState).toBe(originalPushState);
        expect(manager.isSetup).toBe(false);
        expect(manager.intervalId).toBeNull();

        addListener.mockRestore();
        manager.setupComprehensiveNavigation();
        expect(manager.isSetup).toBe(true);
    });

    test('cleanup does not overwrite a later history wrapper', () => {
        setup({ useIntervalChecking: false });
        const ownedPushState = history.pushState;
        const laterPushState = jest.fn((...args) => ownedPushState(...args));
        history.pushState = laterPushState;

        manager.cleanup();

        expect(history.pushState).toBe(laterPushState);
        history.pushState({}, '', '/after-cleanup');
        expect(window.location.pathname).toBe('/after-cleanup');
        expect(manager.pendingUrlCheckTimeoutId).toBeNull();
    });

    test('an invalidated extension context stops detection', () => {
        setup({
            useIntervalChecking: false,
            isPlayerPage: () => {
                throw new Error('Extension context invalidated');
            },
        });
        history.pushState({}, '', '/watch/invalidated');
        jest.advanceTimersByTime(100);

        expect(manager.isSetup).toBe(false);
        expect(history.replaceState).toBe(originalReplaceState);
    });
});
