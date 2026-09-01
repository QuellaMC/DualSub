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

        test('fails closed when the injection channel has no URL builder', () => {
            netflixScript.injectConfig = {
                ...netflixScript.injectConfig,
                channel: {},
            };

            netflixScript._reinjectScript();

            expect(global.document.createElement).not.toHaveBeenCalled();
            expect(appendChildSpy).not.toHaveBeenCalled();
        });
    });
});
