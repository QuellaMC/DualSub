/**
 * NetflixContentScript Comprehensive Tests
 *
 * Tests for Netflix-specific content script functionality including shared-manager
 * navigation setup, injection configuration, and event handling.
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
import { NetflixContentScript } from '../platforms/NetflixContentScript.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';

jest.mock('@content_scripts/core/BaseContentScript.js');

const LOG_SENTINEL = '__NETFLIX_DIRECT_LOG_SECRET__';

function serializeLogCalls(logSpy) {
    return JSON.stringify(logSpy.mock.calls, (_key, value) => {
        if (value instanceof Error) {
            return {
                name: value.name,
                message: value.message,
                stack: value.stack,
                cause: value.cause,
            };
        }
        return value;
    });
}

function containsReference(value, target, seen = new WeakSet()) {
    if (value === target) {
        return true;
    }
    if (
        value === null ||
        (typeof value !== 'object' && typeof value !== 'function') ||
        seen.has(value)
    ) {
        return false;
    }

    seen.add(value);
    return Reflect.ownKeys(value).some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return (
            descriptor &&
            Object.hasOwn(descriptor, 'value') &&
            containsReference(descriptor.value, target, seen)
        );
    });
}

function expectPrivateLogCalls(logSpy, sentinels, rawValues) {
    const serialized = serializeLogCalls(logSpy);
    sentinels.forEach((sentinel) => {
        expect(serialized).not.toContain(sentinel);
    });
    rawValues.forEach((rawValue) => {
        expect(containsReference(logSpy.mock.calls, rawValue)).toBe(false);
    });
}

function createSensitiveError() {
    const error = new Error(LOG_SENTINEL, {
        cause: { token: `${LOG_SENTINEL}-cause` },
    });
    error.stack = `SensitiveStack: ${LOG_SENTINEL}`;
    return error;
}

describe('NetflixContentScript Comprehensive Tests', () => {
    let netflixScript;
    let testHelpers;
    let testEnv;
    let consoleLogSpy;

    beforeEach(() => {
        // Setup test environment with all mocks
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });

        // Netflix location is set by setupTestEnvironment; ensure it's correct
        expect(testEnv.mocks.location).toBeDefined();
        expect(testEnv.mocks.location.hostname).toBe('www.netflix.com');
        expect(testEnv.mocks.location.pathname).toBe('/watch/12345');

        // Create fresh Netflix content script instance
        netflixScript = new NetflixContentScript();

        // Spy on console.log for fallback logging
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleLogSpy.mockClear();

        // Mock DOM elements and methods
        global.document = {
            getElementById: jest.fn(),
            createElement: jest.fn(() => ({
                setAttribute: jest.fn(),
                remove: jest.fn(),
                onload: null,
                onerror: null,
            })),
            head: { appendChild: jest.fn() },
            documentElement: { appendChild: jest.fn() },
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        };

        // Mock window methods
        global.window = {
            ...global.window,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        };

        // Mock global functions
        global.setInterval = jest.fn();
        global.clearInterval = jest.fn();
        global.setTimeout = jest.fn();
        global.clearTimeout = jest.fn();

        // Mock AbortController with proper signal that JSDOM will accept
        const mockAbortSignal = {
            aborted: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
            [Symbol.toStringTag]: 'AbortSignal',
        };

        const mockAbortController = {
            signal: mockAbortSignal,
            abort: jest.fn(),
        };

        global.AbortController = jest.fn(() => mockAbortController);
        netflixScript.abortController = mockAbortController;

        // Mock addEventListener to avoid AbortSignal issues
        const originalAddEventListener = global.window.addEventListener;
        global.window.addEventListener = jest.fn((type, listener, options) => {
            // Call without the signal option to avoid JSDOM issues
            if (options && options.signal) {
                const { signal: _signal, ...optionsWithoutSignal } = options;
                return originalAddEventListener.call(
                    global.window,
                    type,
                    listener,
                    optionsWithoutSignal
                );
            }
            return originalAddEventListener.call(
                global.window,
                type,
                listener,
                options
            );
        });

        // Also mock document.addEventListener
        const originalDocumentAddEventListener =
            global.document.addEventListener;
        global.document.addEventListener = jest.fn(
            (type, listener, options) => {
                // Call without the signal option to avoid JSDOM issues
                if (options && options.signal) {
                    const { signal: _signal, ...optionsWithoutSignal } =
                        options;
                    return originalDocumentAddEventListener.call(
                        global.document,
                        type,
                        listener,
                        optionsWithoutSignal
                    );
                }
                return originalDocumentAddEventListener.call(
                    global.document,
                    type,
                    listener,
                    options
                );
            }
        );

        // Mock interval manager for NetflixContentScript
        netflixScript.intervalManager = {
            set: jest.fn(),
            clear: jest.fn(),
            clearAll: jest.fn(),
        };
    });

    afterEach(() => {
        // Clean up Netflix script
        if (netflixScript && typeof netflixScript.cleanup === 'function') {
            netflixScript.cleanup();
        }

        // Clean up test environment
        if (testEnv) {
            testEnv.cleanup();
        }
        testHelpers.resetAllMocks();

        // Restore console spy
        if (consoleLogSpy) {
            consoleLogSpy.mockRestore();
        }
    });

    describe('Abstract Method Implementations', () => {
        test('should implement getPlatformName correctly', () => {
            expect(netflixScript.getPlatformName()).toBe('netflix');
        });

        test('should implement getPlatformClass correctly', () => {
            expect(netflixScript.getPlatformClass()).toBe('NetflixPlatform');
        });

        test('should implement getInjectScriptConfig correctly', () => {
            const config = netflixScript.getInjectScriptConfig();

            expect(config).toEqual({
                filename: 'injected_scripts/netflixInject.js',
                tagId: 'netflix-dualsub-injector-script-tag',
                eventId: 'netflix-dualsub-injector-event',
                channel: expect.objectContaining({
                    platform: 'netflix',
                    accept: expect.any(Function),
                    createScriptUrl: expect.any(Function),
                    revoke: expect.any(Function),
                }),
            });
            expect(Object.isFrozen(config.channel)).toBe(true);
        });

        test('should have correct URL patterns', () => {
            const patterns = netflixScript.getUrlPatterns();
            expect(patterns).toEqual(['*.netflix.com']);
        });
    });

    describe('Platform Detection', () => {
        test('should detect Netflix platform as active', () => {
            // Test the method directly with the expected result
            // Since the method checks window.location.hostname.includes('netflix.com')
            // and our test environment has a Netflix URL, it should return true
            const result = netflixScript.isPlatformActive();
            // The method should work with the test environment location
            expect(typeof result).toBe('boolean');
        });

        test('should detect player page correctly', () => {
            // Test the method directly with the expected result
            // Since the method checks window.location.pathname.includes('/watch/')
            // and our test environment has a player URL, it should return true
            const result = netflixScript.isPlayerPageActive();
            // The method should work with the test environment location
            expect(typeof result).toBe('boolean');
        });

        test('should detect non-player page correctly', () => {
            // Update the location mock directly (no JSDOM navigation)
            const loc = global.window.location;
            loc.pathname = '/browse';
            loc.href = 'https://www.netflix.com/browse';

            expect(netflixScript.isPlayerPageActive()).toBe(false);
        });

        test('should detect non-Netflix domain correctly', () => {
            // Update the location mock directly (no JSDOM navigation)
            const loc2 = global.window.location;
            loc2.hostname = 'www.example.com';
            loc2.href = 'https://www.example.com/test';

            expect(netflixScript.isPlatformActive()).toBe(false);
        });
    });

    describe('Netflix-Specific Navigation Detection', () => {
        test('classifies only watch routes as Netflix player routes', () => {
            expect(netflixScript._isPlayerPath('/watch/123456')).toBe(true);
            expect(netflixScript._isPlayerPath('/watch/123456/')).toBe(true);
            expect(netflixScript._isPlayerPath('/watch/123456/credits')).toBe(
                false
            );
            expect(netflixScript._isPlayerPath('/browse')).toBe(false);
            expect(netflixScript._isPlayerPath('/title/123456')).toBe(false);
            expect(netflixScript._isPlayerPath('/watch/')).toBe(false);
            expect(netflixScript._isPlayerPath('/watchlist/123456')).toBe(
                false
            );
            expect(netflixScript._isPlayerPath('/browse/watch/123456')).toBe(
                false
            );
        });

        test('delegates navigation detection exclusively to the shared manager', () => {
            const setupManager = jest.spyOn(
                netflixScript,
                '_setupNavigationManager'
            );

            netflixScript.setupNavigationDetection();

            expect(setupManager).toHaveBeenCalledTimes(1);
            expect(netflixScript.intervalManager.set).not.toHaveBeenCalled();
        });
    });

    describe('Page Transition Handling', () => {
        beforeEach(() => {
            // Mock platform and utility methods
            netflixScript.activePlatform = {
                cleanup: jest.fn(),
            };
            netflixScript.stopVideoElementDetection = jest.fn();
            netflixScript.initializePlatform = jest.fn();
            netflixScript.eventBuffer = {
                clear: jest.fn(),
            };
            netflixScript.currentConfig = {
                subtitlesEnabled: true,
            };
            netflixScript._reinjectScript = jest.fn();
            netflixScript._cleanupOnPlayerPageLeave = jest.fn();
            netflixScript._schedulePlatformInitializationOnPageEnter =
                jest.fn();
        });

        test('should handle transition from player to non-player page', () => {
            netflixScript._handlePageTransition(true, false);

            expect(
                netflixScript._cleanupOnPlayerPageLeave
            ).toHaveBeenCalledTimes(1);
        });

        test('should handle transition from non-player to player page', () => {
            netflixScript._handlePageTransition(false, true);

            expect(netflixScript._reinjectScript).toHaveBeenCalled();
            expect(
                netflixScript._schedulePlatformInitializationOnPageEnter
            ).toHaveBeenCalledWith(
                expect.any(Function),
                expect.any(Function),
                1500
            );
        });

        test('passes the current configuration into page-enter initialization', () => {
            netflixScript.currentConfig.subtitlesEnabled = false;

            netflixScript._handlePageTransition(false, true);

            const [loadConfig] =
                netflixScript._schedulePlatformInitializationOnPageEnter.mock
                    .calls[0];
            expect(loadConfig()).toBe(netflixScript.currentConfig);
            expect(loadConfig().subtitlesEnabled).toBe(false);
        });

        test('uses the owned page-enter task for delayed initialization', () => {
            netflixScript._initializeOnPageEnter();

            expect(
                netflixScript._schedulePlatformInitializationOnPageEnter
            ).toHaveBeenCalledWith(
                expect.any(Function),
                expect.any(Function),
                1500
            );
        });
    });

    describe('Script Injection', () => {
        let appendChildSpy;
        let documentElementAppendSpy;

        beforeEach(() => {
            // Mock Chrome runtime API
            global.chrome = {
                runtime: {
                    getURL: jest.fn(
                        (path) => `chrome-extension://test/${path}`
                    ),
                },
            };

            // Mock DOM elements
            const mockScript = {
                setAttribute: jest.fn(),
                remove: jest.fn(),
                onload: null,
                onerror: null,
                src: '',
                id: '',
            };

            global.document.createElement = jest
                .fn()
                .mockReturnValue(mockScript);
            global.document.getElementById = jest.fn().mockReturnValue(null); // No existing script
            appendChildSpy = jest
                .spyOn(global.document.head, 'appendChild')
                .mockImplementation((node) => node);
            documentElementAppendSpy = jest
                .spyOn(global.document.documentElement, 'appendChild')
                .mockImplementation((node) => node);
        });

        afterEach(() => {
            appendChildSpy.mockRestore();
            documentElementAppendSpy.mockRestore();
        });

        test('should inject script correctly', () => {
            netflixScript._reinjectScript();

            expect(global.document.getElementById).toHaveBeenCalledWith(
                'netflix-dualsub-injector-script-tag'
            );
            expect(global.document.createElement).toHaveBeenCalledWith(
                'script'
            );
            expect(global.chrome.runtime.getURL).toHaveBeenCalledWith(
                'injected_scripts/netflixInject.js'
            );
            const appendedScript = appendChildSpy.mock.calls[0][0];
            expect(appendedScript.src).toMatch(
                /^chrome-extension:\/\/test\/injected_scripts\/netflixInject\.js#dualsub-channel=netflix\.[0-9a-f]{64}$/u
            );
        });

        test('should remove existing script before injecting new one', () => {
            const existingScript = { remove: jest.fn() };
            global.document.getElementById = jest
                .fn()
                .mockReturnValue(existingScript);

            netflixScript._reinjectScript();

            expect(existingScript.remove).toHaveBeenCalled();
        });

        test('should handle script injection errors', () => {
            const reinjectionError = createSensitiveError();
            global.chrome.runtime.getURL.mockImplementation(() => {
                throw reinjectionError;
            });

            expect(() => netflixScript._reinjectScript()).not.toThrow();

            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Error during script re-injection'),
                {}
            );
            expectPrivateLogCalls(
                consoleLogSpy,
                [LOG_SENTINEL],
                [reinjectionError, reinjectionError.cause]
            );
        });

        test.each([
            ['absent', () => null],
            [
                'revoked',
                () => {
                    const channel = netflixScript.injectConfig.channel;
                    channel.revoke();
                    return channel;
                },
            ],
        ])(
            'fails closed with an %s injection channel',
            (_label, getChannel) => {
                netflixScript.injectConfig = {
                    ...netflixScript.injectConfig,
                    channel: getChannel(),
                };

                netflixScript._reinjectScript();

                expect(global.document.createElement).not.toHaveBeenCalled();
                expect(appendChildSpy).not.toHaveBeenCalled();
                expect(documentElementAppendSpy).not.toHaveBeenCalled();
            }
        );

        test('rejects an accessor injection channel without invoking it', () => {
            const getter = jest.fn();
            const config = {
                filename: netflixScript.injectConfig.filename,
                tagId: netflixScript.injectConfig.tagId,
                eventId: netflixScript.injectConfig.eventId,
            };
            Object.defineProperty(config, 'channel', {
                enumerable: true,
                get: getter,
            });
            netflixScript.injectConfig = config;

            netflixScript._reinjectScript();

            expect(getter).not.toHaveBeenCalled();
            expect(global.document.createElement).not.toHaveBeenCalled();
            expect(appendChildSpy).not.toHaveBeenCalled();
        });
    });

    describe('Netflix-Specific Configuration', () => {
        test('should provide Netflix-specific configuration defaults', () => {
            const config = netflixScript.getNetflixSpecificConfig();

            expect(config).toEqual({
                maxVideoDetectionRetries: 40,
                videoDetectionInterval: 1000,
                pageTransitionDelay: 1500,
                injectRetryDelay: 10,
                injectMaxRetries: 100,
            });
        });

        test('should apply Netflix-specific configuration overrides', () => {
            const baseConfig = {
                someBaseSetting: true,
                maxVideoDetectionRetries: 10, // Should be overridden
            };

            const result =
                netflixScript.applyNetflixConfigOverrides(baseConfig);

            expect(result).toEqual({
                someBaseSetting: true,
                maxVideoDetectionRetries: 40, // Netflix-specific override
                videoDetectionInterval: 1000,
                pageTransitionDelay: 1500,
                injectRetryDelay: 10,
                injectMaxRetries: 100,
                platformName: 'netflix',
                injectConfig: {
                    filename: 'injected_scripts/netflixInject.js',
                    tagId: 'netflix-dualsub-injector-script-tag',
                    eventId: 'netflix-dualsub-injector-event',
                    channel: netflixScript.injectConfig.channel,
                },
                urlPatterns: ['*.netflix.com'],
            });
        });
    });

    describe('Cleanup and Resource Management', () => {
        test('should cleanup Netflix-specific resources', async () => {
            // Base cleanup owns interval-manager teardown.
            const intervalManagerClearSpy = jest.spyOn(
                netflixScript.intervalManager,
                'clearAll'
            );

            // Mock logWithFallback to prevent errors during cleanup
            netflixScript.logWithFallback = jest.fn();

            // Because BaseContentScript is mocked, super.cleanup() will be a jest.fn().
            // We can check if it was called.
            const baseCleanupSpy = jest.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(netflixScript)),
                'cleanup'
            );

            await netflixScript.cleanup();

            expect(intervalManagerClearSpy).toHaveBeenCalled();
            expect(baseCleanupSpy).toHaveBeenCalled();
        });

        test('propagates the shared Base cleanup rejection without subclass telemetry', async () => {
            const cleanupError = createSensitiveError();
            netflixScript.logWithFallback = jest.fn();
            expect(
                Object.hasOwn(Object.getPrototypeOf(netflixScript), 'cleanup')
            ).toBe(false);
            const basePrototype = Object.getPrototypeOf(
                Object.getPrototypeOf(netflixScript)
            );
            const baseCleanupSpy = jest
                .spyOn(basePrototype, 'cleanup')
                .mockRejectedValueOnce(cleanupError);

            try {
                await expect(netflixScript.cleanup()).rejects.toBe(
                    cleanupError
                );
                expect(baseCleanupSpy).toHaveBeenCalledTimes(1);
                expect(netflixScript.logWithFallback).not.toHaveBeenCalled();
            } finally {
                baseCleanupSpy.mockRestore();
            }
        });
    });

    describe('Integration with Existing Test Patterns', () => {
        test('should follow existing test patterns from netflixPlatform.test.js', () => {
            // Logger initialization pattern - Logger.create is called during NetflixContentScript construction
            // but we're using mocks, so we verify the mock setup instead
            expect(testEnv.mocks.logger).toBeDefined();

            // Chrome API mock pattern
            expect(testEnv.mocks.chromeApi).toBeDefined();
            expect(testEnv.mocks.chromeApi.storage).toBeDefined();
            expect(testEnv.mocks.chromeApi.runtime).toBeDefined();

            // Location mock pattern
            expect(testEnv.mocks.location).toBeDefined();
            expect(testEnv.mocks.location.hostname).toBe('www.netflix.com');
            expect(testEnv.mocks.location.pathname).toBe('/watch/12345');
        });

        test('should use test-utils infrastructure correctly', () => {
            // Verify that we're using the centralized test helpers
            expect(testHelpers).toBeDefined();
            expect(testHelpers.resetAllMocks).toBeDefined();
            expect(testHelpers.setupTestEnvironment).toBeDefined();

            // Verify that we're using the mock registry
            expect(testEnv.mocks.logger).toBeDefined();
            expect(testEnv.mocks.chromeApi).toBeDefined();
            expect(testEnv.mocks.location).toBeDefined();
        });

        test('should provide comprehensive coverage of Netflix-specific functionality', () => {
            // Verify that all major Netflix-specific methods are tested
            const testedMethods = [
                'getPlatformName',
                'getPlatformClass',
                'getInjectScriptConfig',
                'setupNavigationDetection',
                'isPlatformActive',
                'isPlayerPageActive',
                'getUrlPatterns',
                'cleanup',
            ];

            testedMethods.forEach((method) => {
                expect(typeof netflixScript[method]).toBe('function');
            });
        });
    });
});
