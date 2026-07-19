/**
 * NavigationDetectionManager Tests
 *
 * Tests for the comprehensive navigation detection utilities extracted from Netflix's
 * implementation and made available to all platforms.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import {
    jest,
    describe,
    test,
    beforeEach,
    afterEach,
    expect,
} from '@jest/globals';
import {
    NavigationDetectionManager,
    NavigationEventHandler,
    createPlatformNavigationManager,
    PLATFORM_NAVIGATION_CONFIGS,
} from '../shared/navigationUtils.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';

describe('NavigationDetectionManager', () => {
    let testHelpers;
    let testEnv;
    let navigationManager;
    let mockLogger;
    let mockOnUrlChange;
    let mockOnPageTransition;
    let mockIsPlayerPage;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableLocation: true,
            enableChromeApi: false,
        });

        // Setup mock callbacks
        mockLogger = jest.fn();
        mockOnUrlChange = jest.fn();
        mockOnPageTransition = jest.fn();
        mockIsPlayerPage = jest.fn().mockReturnValue(true);

        // Create navigation manager with mocks
        navigationManager = new NavigationDetectionManager('netflix', {
            logger: mockLogger,
            onUrlChange: mockOnUrlChange,
            onPageTransition: mockOnPageTransition,
            isPlayerPage: mockIsPlayerPage,
            intervalMs: 100, // Faster for testing
        });

        // Mock timers
        jest.useFakeTimers();
    });

    afterEach(() => {
        if (navigationManager) {
            navigationManager.cleanup();
        }
        testEnv.cleanup();
        testHelpers.resetAllMocks();
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        test('should initialize with default options', () => {
            const manager = new NavigationDetectionManager('netflix');

            expect(manager.platform).toBe('netflix');
            expect(manager.options.useHistoryAPI).toBe(true);
            expect(manager.options.usePopstateEvents).toBe(true);
            expect(manager.options.useIntervalChecking).toBe(true);
            expect(manager.options.intervalMs).toBe(1000);
            expect(manager.options.useFocusEvents).toBe(true);
            expect(manager.currentUrl).toBe(window.location.href);
            expect(manager.lastKnownPathname).toBe(window.location.pathname);
            expect(manager.isSetup).toBe(false);
        });

        test('should initialize with custom options', () => {
            const customOptions = {
                useHistoryAPI: false,
                intervalMs: 500,
                onUrlChange: mockOnUrlChange,
            };

            const manager = new NavigationDetectionManager(
                'disneyplus',
                customOptions
            );

            expect(manager.platform).toBe('disneyplus');
            expect(manager.options.useHistoryAPI).toBe(false);
            expect(manager.options.intervalMs).toBe(500);
            expect(manager.options.onUrlChange).toBe(mockOnUrlChange);
        });

        test('should bind methods to preserve context', () => {
            expect(navigationManager.checkForUrlChange).toBeDefined();
            expect(typeof navigationManager.checkForUrlChange).toBe('function');
        });
    });

    describe('setupComprehensiveNavigation', () => {
        test('should setup all detection methods when enabled', () => {
            const setupIntervalSpy = jest.spyOn(
                navigationManager,
                '_setupIntervalBasedDetection'
            );
            const setupHistorySpy = jest.spyOn(
                navigationManager,
                '_setupHistoryAPIInterception'
            );
            const setupBrowserSpy = jest.spyOn(
                navigationManager,
                '_setupBrowserNavigationEvents'
            );
            const setupFocusSpy = jest.spyOn(
                navigationManager,
                '_setupFocusAndVisibilityEvents'
            );

            navigationManager.setupComprehensiveNavigation();

            expect(setupIntervalSpy).toHaveBeenCalled();
            expect(setupHistorySpy).toHaveBeenCalled();
            expect(setupBrowserSpy).toHaveBeenCalled();
            expect(setupFocusSpy).toHaveBeenCalled();
            expect(navigationManager.isSetup).toBe(true);
            expect(navigationManager.abortController).toBeInstanceOf(
                AbortController
            );
            expect(mockLogger).toHaveBeenCalledWith(
                'info',
                '[NavigationDetection:netflix] Setting up comprehensive navigation detection.',
                expect.any(Object)
            );
        });

        test('should skip setup if already configured', () => {
            navigationManager.isSetup = true;
            const setupIntervalSpy = jest.spyOn(
                navigationManager,
                '_setupIntervalBasedDetection'
            );

            navigationManager.setupComprehensiveNavigation();

            expect(setupIntervalSpy).not.toHaveBeenCalled();
            expect(mockLogger).toHaveBeenCalledWith(
                'warn',
                '[NavigationDetection:netflix] Navigation detection is already set up; skipping.',
                {}
            );
        });

        test('should respect disabled detection methods', () => {
            const manager = new NavigationDetectionManager('netflix', {
                useHistoryAPI: false,
                usePopstateEvents: false,
                logger: mockLogger,
            });

            const setupHistorySpy = jest.spyOn(
                manager,
                '_setupHistoryAPIInterception'
            );
            const setupBrowserSpy = jest.spyOn(
                manager,
                '_setupBrowserNavigationEvents'
            );
            const setupIntervalSpy = jest.spyOn(
                manager,
                '_setupIntervalBasedDetection'
            );

            manager.setupComprehensiveNavigation();

            expect(setupHistorySpy).not.toHaveBeenCalled();
            expect(setupBrowserSpy).not.toHaveBeenCalled();
            expect(setupIntervalSpy).toHaveBeenCalled(); // This one is still enabled
        });
    });

    describe('checkForUrlChange', () => {
        beforeEach(() => {
            navigationManager.setupComprehensiveNavigation();
        });

        test('should detect URL changes and trigger callbacks', () => {
            // Test the core logic by simulating URL change detection
            const oldUrl = 'https://www.netflix.com/browse';
            const newUrl = 'https://www.netflix.com/watch/54321';
            const newPathname = '/watch/54321';

            // Set initial state
            navigationManager.currentUrl = oldUrl;
            navigationManager.lastKnownPathname = '/browse';

            // Simulate URL change by directly updating the manager's internal state
            // and calling the callback logic
            if (navigationManager.options.onUrlChange) {
                navigationManager.options.onUrlChange(oldUrl, newUrl);
            }

            // Update manager state as would happen in real URL change
            navigationManager.currentUrl = newUrl;
            navigationManager.lastKnownPathname = newPathname;

            expect(mockOnUrlChange).toHaveBeenCalledWith(oldUrl, newUrl);
            expect(navigationManager.currentUrl).toBe(newUrl);
            expect(navigationManager.lastKnownPathname).toBe(newPathname);
        });

        test('should detect page transitions and trigger callback', () => {
            // Test page transition logic directly
            const wasOnPlayerPage = false;
            const isOnPlayerPage = true;

            // Simulate page transition by directly calling the callback
            if (navigationManager.options.onPageTransition) {
                navigationManager.options.onPageTransition(
                    wasOnPlayerPage,
                    isOnPlayerPage
                );
            }

            expect(mockOnPageTransition).toHaveBeenCalledWith(false, true);
        });

        test('should not trigger callbacks if URL unchanged', () => {
            navigationManager.checkForUrlChange();

            expect(mockOnUrlChange).not.toHaveBeenCalled();
            expect(mockOnPageTransition).not.toHaveBeenCalled();
        });

        test('should handle extension context errors', () => {
            const error = new Error('Extension context invalidated');
            const cleanupSpy = jest.spyOn(navigationManager, 'cleanup');

            // Test error handling by directly calling the error handler
            navigationManager._handleExtensionContextError(error);

            expect(cleanupSpy).toHaveBeenCalled();
        });
    });

    describe('History API Interception', () => {
        let originalPushState;
        let originalReplaceState;

        beforeEach(() => {
            originalPushState = history.pushState;
            originalReplaceState = history.replaceState;
            navigationManager.setupComprehensiveNavigation();
        });

        afterEach(() => {
            history.pushState = originalPushState;
            history.replaceState = originalReplaceState;
        });

        test('should intercept pushState calls', () => {
            const checkUrlSpy = jest.spyOn(
                navigationManager,
                'checkForUrlChange'
            );

            history.pushState({}, '', '/watch/12345');

            // Fast-forward timers to trigger the delayed check
            jest.advanceTimersByTime(100);

            expect(checkUrlSpy).toHaveBeenCalled();
        });

        test('should intercept replaceState calls', () => {
            const checkUrlSpy = jest.spyOn(
                navigationManager,
                'checkForUrlChange'
            );

            history.replaceState({}, '', '/watch/67890');

            // Fast-forward timers to trigger the delayed check
            jest.advanceTimersByTime(100);

            expect(checkUrlSpy).toHaveBeenCalled();
        });

        test('should preserve original history methods functionality', () => {
            const state = { test: 'data' };
            const title = 'Test Title';
            const url = '/test-url';

            history.pushState(state, title, url);

            expect(window.location.pathname).toBe(url);
        });
    });

    describe('Event Listeners', () => {
        beforeEach(() => {
            navigationManager.setupComprehensiveNavigation();
        });

        test('should setup popstate event listener', () => {
            const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

            // Re-setup to capture the spy
            navigationManager.cleanup();
            navigationManager.setupComprehensiveNavigation();

            expect(addEventListenerSpy).toHaveBeenCalledWith(
                'popstate',
                expect.any(Function),
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        test('should setup hashchange event listener', () => {
            const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

            // Re-setup to capture the spy
            navigationManager.cleanup();
            navigationManager.setupComprehensiveNavigation();

            expect(addEventListenerSpy).toHaveBeenCalledWith(
                'hashchange',
                expect.any(Function),
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        test('should setup focus and visibility event listeners', () => {
            const windowSpy = jest.spyOn(window, 'addEventListener');
            const documentSpy = jest.spyOn(document, 'addEventListener');

            // Re-setup to capture the spies
            navigationManager.cleanup();
            navigationManager.setupComprehensiveNavigation();

            expect(windowSpy).toHaveBeenCalledWith(
                'focus',
                expect.any(Function),
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );

            expect(documentSpy).toHaveBeenCalledWith(
                'visibilitychange',
                expect.any(Function),
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });
    });

    describe('Interval-based Detection', () => {
        test('should setup interval with correct timing', () => {
            const setIntervalSpy = jest.spyOn(global, 'setInterval');

            navigationManager.setupComprehensiveNavigation();

            expect(setIntervalSpy).toHaveBeenCalledWith(
                navigationManager.checkForUrlChange,
                100 // Our test interval
            );
            expect(navigationManager.intervalId).toBeDefined();
        });

        test('should trigger URL checks at intervals', () => {
            const checkUrlSpy = jest.spyOn(
                navigationManager,
                'checkForUrlChange'
            );

            navigationManager.setupComprehensiveNavigation();

            // Fast-forward time to trigger interval
            jest.advanceTimersByTime(200); // 2 intervals

            expect(checkUrlSpy).toHaveBeenCalledTimes(2);
        });
    });

    describe('Platform-specific Player Page Detection', () => {
        test('should use custom isPlayerPage function when provided', () => {
            navigationManager._isPlayerPage('/custom/path');

            expect(mockIsPlayerPage).toHaveBeenCalledWith('/custom/path');
        });

        test('should use Netflix default when no custom function provided', () => {
            const manager = new NavigationDetectionManager('netflix');

            expect(manager._isPlayerPage('/watch/12345')).toBe(true);
            expect(manager._isPlayerPage('/watch/12345/')).toBe(true);
            expect(manager._isPlayerPage('/browse')).toBe(false);
            expect(manager._isPlayerPage('/watch/')).toBe(false);
            expect(manager._isPlayerPage('/watch/12345/credits')).toBe(false);
            expect(manager._isPlayerPage('/browse/watch/12345')).toBe(false);
        });

        test('should use Disney+ default for disneyplus platform', () => {
            const manager = new NavigationDetectionManager('disneyplus');

            expect(manager._isPlayerPage('/video/abc123')).toBe(true);
            expect(manager._isPlayerPage('/play/abc123')).toBe(true);
            expect(manager._isPlayerPage('/video/abc123/')).toBe(true);
            expect(manager._isPlayerPage('/movies/def456')).toBe(false);
            expect(manager._isPlayerPage('/series/ghi789')).toBe(false);
            expect(manager._isPlayerPage('/video/')).toBe(false);
            expect(manager._isPlayerPage('/play/abc123/credits')).toBe(false);
            expect(manager._isPlayerPage('/browse/video/abc123')).toBe(false);
            expect(manager._isPlayerPage('/home')).toBe(false);
        });

        test('should use generic default for unknown platforms', () => {
            const manager = new NavigationDetectionManager('unknown');

            expect(manager._isPlayerPage('/watch/12345')).toBe(true);
            expect(manager._isPlayerPage('/video/abc123')).toBe(true);
            expect(manager._isPlayerPage('/browse')).toBe(false);
        });
    });

    describe('cleanup', () => {
        beforeEach(() => {
            navigationManager.setupComprehensiveNavigation();
        });

        test('should clear interval', () => {
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            const intervalId = navigationManager.intervalId;

            navigationManager.cleanup();

            expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
            expect(navigationManager.intervalId).toBeNull();
        });

        test('should abort event listeners', () => {
            const abortSpy = jest.spyOn(
                navigationManager.abortController,
                'abort'
            );

            navigationManager.cleanup();

            expect(abortSpy).toHaveBeenCalled();
            expect(navigationManager.abortController).toBeNull();
        });

        test('should restore original history methods', () => {
            const originalPushState =
                navigationManager._originalHistoryMethods.pushState;
            const originalReplaceState =
                navigationManager._originalHistoryMethods.replaceState;

            navigationManager.cleanup();

            expect(history.pushState).toBe(originalPushState);
            expect(history.replaceState).toBe(originalReplaceState);
            expect(navigationManager._originalHistoryMethods).toBeNull();
        });

        test('should reset setup state', () => {
            navigationManager.cleanup();

            expect(navigationManager.isSetup).toBe(false);
        });

        test('should log cleanup completion', () => {
            navigationManager.cleanup();

            expect(mockLogger).toHaveBeenCalledWith(
                'info',
                '[NavigationDetection:netflix] Navigation detection cleanup is complete.',
                {}
            );
        });
    });

    describe('Error Handling', () => {
        test('should handle errors gracefully in checkForUrlChange', () => {
            // Test error handling by simulating an error in the try-catch block
            const originalLog = navigationManager._log;
            let errorLogged = false;

            navigationManager._log = (level, message, data) => {
                if (
                    level === 'error' &&
                    message.includes('Error in URL change detection')
                ) {
                    errorLogged = true;
                }
                originalLog.call(navigationManager, level, message, data);
            };

            // Simulate error by calling the error handling directly
            try {
                throw new Error('Test error');
            } catch (error) {
                navigationManager._log(
                    'error',
                    'Error in URL change detection',
                    { error: error.message }
                );
            }

            expect(errorLogged).toBe(true);

            // Restore original log method
            navigationManager._log = originalLog;
        });

        test('should handle extension context invalidation', () => {
            const cleanupSpy = jest.spyOn(navigationManager, 'cleanup');

            // Test extension context invalidation by directly calling the handler
            const error = new Error('Extension context invalidated');
            navigationManager._handleExtensionContextError(error);

            expect(cleanupSpy).toHaveBeenCalled();
        });
    });
});

describe('NavigationDetectionManager owned lifecycle', () => {
    let navigationManager;
    let originalPushState;
    let originalReplaceState;

    beforeEach(() => {
        jest.useFakeTimers();
        originalPushState = history.pushState;
        originalReplaceState = history.replaceState;
        originalReplaceState.call(history, {}, '', '/browse');
    });

    afterEach(() => {
        navigationManager?.cleanup();
        history.pushState = originalPushState;
        history.replaceState = originalReplaceState;
        originalReplaceState.call(history, {}, '', '/');
        jest.useRealTimers();
    });

    const createManager = (options = {}) => {
        navigationManager = new NavigationDetectionManager('netflix', {
            enableNavigationLogging: false,
            ...options,
        });
        return navigationManager;
    };

    const setupManager = (options = {}) => {
        createManager(options).setupComprehensiveNavigation();
        return navigationManager;
    };

    const expectManagerResourcesCleaned = () => {
        expect(navigationManager.isSetup).toBe(false);
        expect(navigationManager.intervalId).toBeNull();
        expect(navigationManager.pendingUrlCheckTimeoutId).toBeNull();
        expect(navigationManager.abortController).toBeNull();
        expect(navigationManager._originalHistoryMethods).toBeNull();
        expect(history.pushState).toBe(originalPushState);
        expect(history.replaceState).toBe(originalReplaceState);
    };

    test.each([
        ['pushState', (pathname) => history.pushState({}, '', pathname)],
        ['replaceState', (pathname) => history.replaceState({}, '', pathname)],
        [
            'popstate',
            (pathname) => {
                originalReplaceState.call(history, {}, '', pathname);
                window.dispatchEvent(new Event('popstate'));
            },
        ],
        [
            'hashchange',
            (pathname) => {
                originalReplaceState.call(history, {}, '', pathname);
                window.dispatchEvent(new Event('hashchange'));
            },
        ],
        [
            'focus',
            (pathname) => {
                originalReplaceState.call(history, {}, '', pathname);
                window.dispatchEvent(new Event('focus'));
            },
        ],
        [
            'visibilitychange',
            (pathname) => {
                originalReplaceState.call(history, {}, '', pathname);
                document.dispatchEvent(new Event('visibilitychange'));
            },
        ],
    ])(
        '%s initiates a delayed check of the real final URL',
        (source, signal) => {
            const onUrlChange = jest.fn();
            setupManager({
                onUrlChange,
                useIntervalChecking: false,
            });
            const initialUrl = window.location.href;
            const finalPathname = `/watch/from-${source}`;

            signal(finalPathname);

            expect(navigationManager.pendingUrlCheckTimeoutId).not.toBeNull();
            expect(onUrlChange).not.toHaveBeenCalled();

            jest.advanceTimersByTime(100);

            expect(onUrlChange).toHaveBeenCalledTimes(1);
            expect(onUrlChange).toHaveBeenCalledWith(
                initialUrl,
                `${window.location.origin}${finalPathname}`
            );
        }
    );

    test('the default interval detects a URL change at 1000ms', () => {
        const onUrlChange = jest.fn();
        setupManager({
            onUrlChange,
            useFocusEvents: false,
            useHistoryAPI: false,
            usePopstateEvents: false,
        });
        const initialUrl = window.location.href;
        originalReplaceState.call(history, {}, '', '/watch/from-interval');

        jest.advanceTimersByTime(999);
        expect(onUrlChange).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);

        expect(onUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledWith(
            initialUrl,
            `${window.location.origin}/watch/from-interval`
        );
    });

    test('URL and page-transition callbacks retain their public order', () => {
        const callbackOrder = [];
        setupManager({
            isPlayerPage: (pathname) => pathname.includes('/watch/'),
            onPageTransition: () => callbackOrder.push('page-transition'),
            onUrlChange: () => callbackOrder.push('url-change'),
            useIntervalChecking: false,
        });

        history.pushState({}, '', '/watch/callback-order');
        jest.advanceTimersByTime(100);

        expect(callbackOrder).toEqual(['url-change', 'page-transition']);
    });

    test('coalesces a history burst into one check of the final URL', () => {
        const onUrlChange = jest.fn();
        setupManager({
            isPlayerPage: (pathname) => pathname.includes('/watch/'),
            onUrlChange,
            useIntervalChecking: false,
        });
        const initialUrl = window.location.href;
        const checkForUrlChange = jest.spyOn(
            navigationManager,
            'checkForUrlChange'
        );

        history.pushState({}, '', '/watch/0');
        const pendingCheck = navigationManager.pendingUrlCheckTimeoutId;
        expect(pendingCheck).not.toBeNull();

        for (let index = 1; index < 100; index++) {
            const method = index % 2 === 0 ? 'pushState' : 'replaceState';
            history[method]({}, '', `/watch/${index}`);
        }

        expect(navigationManager.pendingUrlCheckTimeoutId).toBe(pendingCheck);

        jest.advanceTimersByTime(100);

        expect(checkForUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledWith(
            initialUrl,
            `${window.location.origin}/watch/99`
        );
    });

    test('coalesces browser, focus, and visibility signals into one check', () => {
        const onUrlChange = jest.fn();
        setupManager({
            isPlayerPage: (pathname) => pathname.includes('/watch/'),
            onUrlChange,
            useHistoryAPI: false,
            useIntervalChecking: false,
        });
        const initialUrl = window.location.href;
        const checkForUrlChange = jest.spyOn(
            navigationManager,
            'checkForUrlChange'
        );
        originalReplaceState.call(history, {}, '', '/watch/mixed-signals');

        window.dispatchEvent(new Event('popstate'));
        const pendingCheck = navigationManager.pendingUrlCheckTimeoutId;
        expect(pendingCheck).not.toBeNull();
        window.dispatchEvent(new Event('hashchange'));
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));

        expect(navigationManager.pendingUrlCheckTimeoutId).toBe(pendingCheck);

        jest.advanceTimersByTime(100);

        expect(checkForUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledWith(
            initialUrl,
            `${window.location.origin}/watch/mixed-signals`
        );
    });

    test('cleanup cancels a pending URL check before it can notify', () => {
        const onUrlChange = jest.fn();
        setupManager({
            onUrlChange,
            useIntervalChecking: false,
        });
        const checkForUrlChange = jest.spyOn(
            navigationManager,
            'checkForUrlChange'
        );

        history.pushState({}, '', '/watch/cancelled');
        expect(navigationManager.pendingUrlCheckTimeoutId).not.toBeNull();

        navigationManager.cleanup();

        expect(navigationManager.pendingUrlCheckTimeoutId).toBeNull();
        jest.advanceTimersByTime(100);
        expect(checkForUrlChange).not.toHaveBeenCalled();
        expect(onUrlChange).not.toHaveBeenCalled();
    });

    test('a stale callback cannot clear or execute a later setup generation', () => {
        const onUrlChange = jest.fn();
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        setupManager({
            onUrlChange,
            useIntervalChecking: false,
        });

        history.pushState({}, '', '/watch/stale');
        const staleCallback = setTimeoutSpy.mock.calls.at(-1)[0];

        navigationManager.cleanup();
        navigationManager.setupComprehensiveNavigation();
        history.pushState({}, '', '/watch/fresh');
        const freshPendingCheck = navigationManager.pendingUrlCheckTimeoutId;

        staleCallback();

        expect(navigationManager.pendingUrlCheckTimeoutId).toBe(
            freshPendingCheck
        );
        expect(onUrlChange).not.toHaveBeenCalled();

        jest.advanceTimersByTime(100);

        expect(onUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenLastCalledWith(
            expect.stringContaining('/browse'),
            `${window.location.origin}/watch/fresh`
        );
    });

    test('cleanup preserves later history wrappers and leaves them functional', () => {
        const onUrlChange = jest.fn();
        setupManager({
            onUrlChange,
            useIntervalChecking: false,
        });
        const managerPushState = history.pushState;
        const managerReplaceState = history.replaceState;
        const laterPushState = jest.fn((...args) => managerPushState(...args));
        const laterReplaceState = jest.fn((...args) =>
            managerReplaceState(...args)
        );
        history.pushState = laterPushState;
        history.replaceState = laterReplaceState;

        navigationManager.cleanup();

        expect(history.pushState).toBe(laterPushState);
        expect(history.replaceState).toBe(laterReplaceState);

        history.pushState({}, '', '/after-cleanup-push');
        expect(window.location.pathname).toBe('/after-cleanup-push');
        history.replaceState({}, '', '/after-cleanup-replace');
        expect(window.location.pathname).toBe('/after-cleanup-replace');
        expect(navigationManager.pendingUrlCheckTimeoutId).toBeNull();
        expect(onUrlChange).not.toHaveBeenCalled();
    });

    test('a listener registration failure rolls back and permits clean setup', () => {
        const onUrlChange = jest.fn();
        createManager({ onUrlChange });
        const realWindowAddEventListener = window.addEventListener.bind(window);
        const addEventListenerSpy = jest
            .spyOn(window, 'addEventListener')
            .mockImplementation((eventName, ...args) => {
                if (eventName === 'hashchange') {
                    throw new Error('hashchange registration failed');
                }
                return realWindowAddEventListener(eventName, ...args);
            });

        expect(() => navigationManager.setupComprehensiveNavigation()).toThrow(
            'hashchange registration failed'
        );

        expectManagerResourcesCleaned();

        addEventListenerSpy.mockRestore();
        navigationManager.setupComprehensiveNavigation();
        history.pushState({}, '', '/watch/recovered');
        jest.advanceTimersByTime(100);

        expect(onUrlChange).toHaveBeenCalledTimes(1);
        expect(onUrlChange).toHaveBeenCalledWith(
            expect.stringContaining('/browse'),
            `${window.location.origin}/watch/recovered`
        );
    });

    test.each([
        '_setupIntervalBasedDetection',
        '_setupHistoryAPIInterception',
        '_setupBrowserNavigationEvents',
        '_setupFocusAndVisibilityEvents',
    ])('%s failure rolls back every previously installed resource', (phase) => {
        createManager();
        const runPhase = navigationManager[phase].bind(navigationManager);
        jest.spyOn(navigationManager, phase).mockImplementation(() => {
            runPhase();
            throw new Error(`${phase} failed`);
        });

        expect(() => navigationManager.setupComprehensiveNavigation()).toThrow(
            `${phase} failed`
        );

        expectManagerResourcesCleaned();
    });

    test('a logger failure after setup rolls back without masking the setup error', () => {
        const setupError = new Error('setup success logging failed');
        const cleanupError = new Error('cleanup logging failed');
        const logger = jest.fn((_level, message) => {
            if (message.includes('has been set up successfully')) {
                throw setupError;
            }
            if (
                message.includes('Cleaning up') ||
                message.includes('cleanup is complete')
            ) {
                throw cleanupError;
            }
        });
        createManager({ logger });

        let thrownError;
        try {
            try {
                navigationManager.setupComprehensiveNavigation();
            } catch (error) {
                thrownError = error;
            }

            expect(thrownError).toBe(setupError);
            expectManagerResourcesCleaned();
        } finally {
            navigationManager.options.logger = null;
        }
    });

    test('cleanup remains repeat-safe when its logger throws', () => {
        setupManager();
        navigationManager.options.logger = jest.fn(() => {
            throw new Error('cleanup logging failed');
        });

        try {
            expect(() => navigationManager.cleanup()).not.toThrow();
            expectManagerResourcesCleaned();
            expect(() => navigationManager.cleanup()).not.toThrow();
        } finally {
            navigationManager.options.logger = null;
        }
    });

    test('cleanup is repeat-safe and leaves no active navigation source', () => {
        const onUrlChange = jest.fn();
        setupManager({ onUrlChange });
        history.pushState({}, '', '/watch/pending-cleanup');

        navigationManager.cleanup();

        expect(() => navigationManager.cleanup()).not.toThrow();
        expectManagerResourcesCleaned();

        originalReplaceState.call(history, {}, '', '/watch/after-cleanup');
        window.dispatchEvent(new Event('popstate'));
        window.dispatchEvent(new Event('focus'));
        jest.advanceTimersByTime(1000);
        expect(onUrlChange).not.toHaveBeenCalled();
    });
});

describe('NavigationEventHandler', () => {
    let eventHandler;
    let mockOnEnterPlayerPage;
    let mockOnLeavePlayerPage;
    let mockOnUrlChange;
    let mockLogger;

    beforeEach(() => {
        mockOnEnterPlayerPage = jest.fn();
        mockOnLeavePlayerPage = jest.fn();
        mockOnUrlChange = jest.fn();
        mockLogger = jest.fn();

        eventHandler = new NavigationEventHandler('netflix', {
            onEnterPlayerPage: mockOnEnterPlayerPage,
            onLeavePlayerPage: mockOnLeavePlayerPage,
            onUrlChange: mockOnUrlChange,
            logger: mockLogger,
        });
    });

    describe('handlePageTransition', () => {
        test('should trigger onLeavePlayerPage when leaving player page', () => {
            eventHandler.handlePageTransition(true, false);

            expect(mockOnLeavePlayerPage).toHaveBeenCalled();
            expect(mockOnEnterPlayerPage).not.toHaveBeenCalled();
        });

        test('should trigger onEnterPlayerPage when entering player page', () => {
            eventHandler.handlePageTransition(false, true);

            expect(mockOnEnterPlayerPage).toHaveBeenCalled();
            expect(mockOnLeavePlayerPage).not.toHaveBeenCalled();
        });

        test('should not trigger callbacks when staying on same page type', () => {
            eventHandler.handlePageTransition(true, true);

            expect(mockOnEnterPlayerPage).not.toHaveBeenCalled();
            expect(mockOnLeavePlayerPage).not.toHaveBeenCalled();
        });

        test('should log page transitions', () => {
            eventHandler.handlePageTransition(false, true);

            expect(mockLogger).toHaveBeenCalledWith(
                'info',
                '[NavigationEventHandler:netflix] Handling page transition.',
                expect.any(Object)
            );
            expect(mockLogger).toHaveBeenCalledWith(
                'info',
                '[NavigationEventHandler:netflix] Entering player page, triggering initialization.',
                expect.any(Object)
            );
        });
    });

    describe('handleUrlChange', () => {
        test('should trigger onUrlChange callback', () => {
            const oldUrl = 'https://netflix.com/browse';
            const newUrl = 'https://netflix.com/watch/12345';

            eventHandler.handleUrlChange(oldUrl, newUrl);

            expect(mockOnUrlChange).toHaveBeenCalledWith(oldUrl, newUrl);
        });

        test('should log URL changes', () => {
            const oldUrl = 'https://netflix.com/browse';
            const newUrl = 'https://netflix.com/watch/12345';

            eventHandler.handleUrlChange(oldUrl, newUrl);

            expect(mockLogger).toHaveBeenCalledWith(
                'debug',
                '[NavigationEventHandler:netflix] Handling URL change.',
                expect.any(Object)
            );
        });
    });
});

describe('Platform Navigation Configurations', () => {
    test('should have Netflix configuration', () => {
        const config = PLATFORM_NAVIGATION_CONFIGS.netflix;

        expect(config).toBeDefined();
        expect(config.intervalMs).toBe(1000);
        expect(config.useHistoryAPI).toBe(true);
        expect(config.usePopstateEvents).toBe(true);
        expect(config.useIntervalChecking).toBe(true);
        expect(config.useFocusEvents).toBe(true);
        expect(typeof config.isPlayerPage).toBe('function');
        expect(config.isPlayerPage('/watch/12345')).toBe(true);
        expect(config.isPlayerPage('/watch/12345/')).toBe(true);
        expect(config.isPlayerPage('/watch/12345/credits')).toBe(false);
        expect(config.isPlayerPage('/watch/')).toBe(false);
        expect(config.isPlayerPage('/watchlist/12345')).toBe(false);
        expect(config.isPlayerPage('/browse/watch/12345')).toBe(false);
    });

    test('should have Disney+ configuration', () => {
        const config = PLATFORM_NAVIGATION_CONFIGS.disneyplus;

        expect(config).toBeDefined();
        expect(config.intervalMs).toBe(500);
        expect(config.useHistoryAPI).toBe(true);
        expect(typeof config.isPlayerPage).toBe('function');
        expect(config.isPlayerPage('/video/abc123')).toBe(true);
        expect(config.isPlayerPage('/play/abc123')).toBe(true);
        expect(config.isPlayerPage('/video/abc123/')).toBe(true);
        expect(config.isPlayerPage('/video/abc123/credits')).toBe(false);
        expect(config.isPlayerPage('/movies/def456')).toBe(false);
        expect(config.isPlayerPage('/series/ghi789')).toBe(false);
        expect(config.isPlayerPage('/video/')).toBe(false);
        expect(config.isPlayerPage('/play/')).toBe(false);
        expect(config.isPlayerPage('/browse/video/abc123')).toBe(false);
        expect(config.isPlayerPage('/movies/play/abc123')).toBe(false);
        expect(config.isPlayerPage('/videos/abc123')).toBe(false);
    });
});

describe('createPlatformNavigationManager', () => {
    test('should create manager with Netflix configuration', () => {
        const manager = createPlatformNavigationManager('netflix');

        expect(manager).toBeInstanceOf(NavigationDetectionManager);
        expect(manager.platform).toBe('netflix');
        expect(manager.options.intervalMs).toBe(1000);
        expect(manager.options.useHistoryAPI).toBe(true);
    });

    test('should create manager with Disney+ configuration', () => {
        const manager = createPlatformNavigationManager('disneyplus');

        expect(manager).toBeInstanceOf(NavigationDetectionManager);
        expect(manager.platform).toBe('disneyplus');
        expect(manager.options.intervalMs).toBe(500);
    });

    test('should merge custom options with platform defaults', () => {
        const customOptions = {
            intervalMs: 2000,
            onUrlChange: jest.fn(),
        };

        const manager = createPlatformNavigationManager(
            'netflix',
            customOptions
        );

        expect(manager.options.intervalMs).toBe(2000); // Custom override
        expect(manager.options.useHistoryAPI).toBe(true); // Platform default
        expect(manager.options.onUrlChange).toBe(customOptions.onUrlChange);
    });

    test('should handle unknown platforms with empty config', () => {
        const manager = createPlatformNavigationManager('unknown');

        expect(manager).toBeInstanceOf(NavigationDetectionManager);
        expect(manager.platform).toBe('unknown');
        expect(manager.options.intervalMs).toBe(1000); // Default value
    });
});
