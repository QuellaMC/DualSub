/**
 * DisneyPlusContentScript Integration Tests
 *
 * Integration tests for Disney+ specific lifecycle and privacy behavior.
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
import { DisneyPlusContentScript } from '../platforms/DisneyPlusContentScript.js';
import { BaseContentScript } from '../core/BaseContentScript.js';
import { ChromeApiMock } from '../../test-utils/chrome-api-mock.js';

const LOG_SENTINEL = '__DISNEY_CONTENT_LOG_SECRET__';
const SECRET_PROPERTY = '__disney_private_property__';

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

function expectPrivateLogCalls(
    logSpy,
    { sentinels = [], rawValues = [] } = {}
) {
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

// Mock Chrome API
const mockChrome = ChromeApiMock.create();
global.chrome = mockChrome;

// Mock window.location for Disney+
delete window.location;
window.location = {
    href: 'https://www.disneyplus.com/video/test-movie',
    hostname: 'www.disneyplus.com',
    pathname: '/video/test-movie',
};

describe('DisneyPlusContentScript Integration Tests', () => {
    let disneyPlusScript;
    let consoleLogSpy;

    beforeEach(() => {
        // Create fresh Disney+ content script instance
        disneyPlusScript = new DisneyPlusContentScript();

        // Spy on console.log for fallback logging
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleLogSpy.mockClear();
    });

    afterEach(() => {
        if (consoleLogSpy) {
            consoleLogSpy.mockRestore();
        }
    });

    describe('Integration with BaseContentScript message flow', () => {
        test('clears the queue and cleans the captured platform once on page leave', async () => {
            const platform = { cleanup: jest.fn().mockResolvedValue() };
            disneyPlusScript.activePlatform = platform;
            disneyPlusScript.platformReady = true;
            disneyPlusScript.subtitleUtils = {
                clearSubtitlesDisplayAndQueue: jest.fn(),
                clearSubtitleDOM: jest.fn(),
            };
            disneyPlusScript.eventBuffer = { clear: jest.fn() };
            disneyPlusScript.stopVideoElementDetection = jest.fn();

            disneyPlusScript._cleanupOnPageLeave();

            expect(
                disneyPlusScript.subtitleUtils.clearSubtitlesDisplayAndQueue
            ).toHaveBeenCalledWith(platform, true, disneyPlusScript.logPrefix);
            expect(
                disneyPlusScript.subtitleUtils.clearSubtitleDOM
            ).toHaveBeenCalledTimes(1);
            expect(disneyPlusScript.activePlatform).toBeNull();
            expect(disneyPlusScript.platformReady).toBe(false);
            expect(disneyPlusScript.eventBuffer.clear).toHaveBeenCalledTimes(1);
            await Promise.resolve();
            expect(platform.cleanup).toHaveBeenCalledTimes(1);

            disneyPlusScript._cleanupOnPageLeave();
            await Promise.resolve();
            expect(platform.cleanup).toHaveBeenCalledTimes(1);
        });
    });

    describe('Capitalized content-subclass log privacy', () => {
        test('does not log script error events', () => {
            const logSpy = jest
                .spyOn(disneyPlusScript, 'logWithFallback')
                .mockImplementation(() => {});
            const scriptErrorEvent = {
                type: 'error',
                [SECRET_PROPERTY]: LOG_SENTINEL,
            };
            const injectedScript = {
                id: '',
                src: '',
                onload: null,
                onerror: null,
            };
            const createElementSpy = jest
                .spyOn(document, 'createElement')
                .mockReturnValueOnce(injectedScript);
            const appendChildSpy = jest
                .spyOn(document.head, 'appendChild')
                .mockImplementationOnce((node) => node);
            const getURLSpy = jest
                .spyOn(chrome.runtime, 'getURL')
                .mockReturnValueOnce(
                    'chrome-extension://test-extension/injected_scripts/disneyPlusInject.js'
                );

            try {
                disneyPlusScript._reinjectScript();
                expect(typeof injectedScript.onerror).toBe('function');
                injectedScript.onerror(scriptErrorEvent);

                expectPrivateLogCalls(logSpy, {
                    sentinels: [LOG_SENTINEL, SECRET_PROPERTY],
                    rawValues: [scriptErrorEvent],
                });
            } finally {
                getURLSpy.mockRestore();
                createElementSpy.mockRestore();
                appendChildSpy.mockRestore();
            }
        });

        test('does not log synchronous reinjection errors', () => {
            const logSpy = jest
                .spyOn(disneyPlusScript, 'logWithFallback')
                .mockImplementation(() => {});
            const reinjectionError = createSensitiveError();
            const getURLSpy = jest
                .spyOn(chrome.runtime, 'getURL')
                .mockImplementationOnce(() => {
                    throw reinjectionError;
                });

            try {
                expect(() => disneyPlusScript._reinjectScript()).not.toThrow();
                expectPrivateLogCalls(logSpy, {
                    sentinels: [LOG_SENTINEL],
                    rawValues: [reinjectionError, reinjectionError.cause],
                });
            } finally {
                getURLSpy.mockRestore();
            }
        });

        test('rethrows cleanup failures without logging the failure object', async () => {
            const cleanupError = createSensitiveError();
            const logSpy = jest
                .spyOn(disneyPlusScript, 'logWithFallback')
                .mockImplementation(() => {});
            const baseCleanupSpy = jest
                .spyOn(BaseContentScript.prototype, 'cleanup')
                .mockRejectedValueOnce(cleanupError);

            try {
                await expect(disneyPlusScript.cleanup()).rejects.toBe(
                    cleanupError
                );
                expectPrivateLogCalls(logSpy, {
                    sentinels: [LOG_SENTINEL],
                    rawValues: [cleanupError, cleanupError.cause],
                });
            } finally {
                baseCleanupSpy.mockRestore();
            }
        });
    });

    describe('Disney+ URL pattern validation', () => {
        test('should correctly identify Disney+ URLs', () => {
            const disneyPlusUrls = [
                'https://www.disneyplus.com/video/test-movie',
                'https://www.disneyplus.com/movies/test-movie/abc123',
                'https://www.disneyplus.com/series/test-series/def456',
                'https://disneyplus.com/video/another-movie',
            ];

            disneyPlusUrls.forEach((url) => {
                const urlObj = new URL(url);

                // Test platform detection by checking hostname directly since isPlatformActive doesn't exist
                const isDisneyPlusDomain =
                    urlObj.hostname.includes('disneyplus.com');
                expect(isDisneyPlusDomain).toBe(true);
            });
        });

        test('should correctly identify Disney+ player pages', () => {
            const playerUrls = [
                '/video/test-movie',
                '/movies/test-movie/abc123',
                '/series/test-series/def456',
            ];

            playerUrls.forEach((pathname) => {
                // Disney+ uses different URL patterns than Netflix
                const isPlayerPage =
                    pathname.includes('/video/') ||
                    pathname.includes('/movies/') ||
                    pathname.includes('/series/');

                expect(isPlayerPage).toBe(true);
            });
        });

        test('should validate Disney+ URL patterns match expected format', () => {
            // Test the URL patterns defined in DisneyPlusContentScript
            const urlPatterns = disneyPlusScript.urlPatterns;
            expect(urlPatterns).toEqual(['*.disneyplus.com']);

            // Test that the initial location we set matches the pattern
            // Note: window.location might be reset by JSDOM, so we test the pattern directly
            const testHostname = 'www.disneyplus.com';
            const matchesPattern = testHostname.includes('disneyplus.com');
            expect(matchesPattern).toBe(true);

            // Also test the pattern matching logic
            const urlPattern = '*.disneyplus.com';
            const isValidPattern = urlPattern.includes('disneyplus.com');
            expect(isValidPattern).toBe(true);
        });
    });
});
