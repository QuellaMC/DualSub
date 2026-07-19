/**
 * NetflixContentScript Integration Tests
 *
 * Integration tests for Netflix-specific lifecycle and privacy behavior.
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
import { BaseContentScript } from '../core/BaseContentScript.js';
import { ChromeApiMock } from '../../test-utils/chrome-api-mock.js';
import {
    LocationMock,
    mockWindowLocation,
} from '../../test-utils/location-mock.js';

const LOG_SENTINEL = '__NETFLIX_CONTENT_LOG_SECRET__';
const SECRET_PROPERTY = '__netflix_private_property__';

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

// Mock window.location using property-level mocking to avoid redefining window.location
const netflixLocation = LocationMock.createNetflixMock('123456');
mockWindowLocation(netflixLocation);

describe('NetflixContentScript Integration Tests', () => {
    let netflixScript;
    let consoleLogSpy;

    beforeEach(() => {
        // Create fresh Netflix content script instance
        netflixScript = new NetflixContentScript();

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
            netflixScript.activePlatform = platform;
            netflixScript.platformReady = true;
            netflixScript.subtitleUtils = {
                clearSubtitlesDisplayAndQueue: jest.fn(),
                clearSubtitleDOM: jest.fn(),
            };
            netflixScript.eventBuffer = { clear: jest.fn() };
            netflixScript.stopVideoElementDetection = jest.fn();

            netflixScript._cleanupOnPageLeave();

            expect(
                netflixScript.subtitleUtils.clearSubtitlesDisplayAndQueue
            ).toHaveBeenCalledWith(platform, true, netflixScript.logPrefix);
            expect(
                netflixScript.subtitleUtils.clearSubtitleDOM
            ).toHaveBeenCalledTimes(1);
            expect(netflixScript.activePlatform).toBeNull();
            expect(netflixScript.platformReady).toBe(false);
            expect(netflixScript.eventBuffer.clear).toHaveBeenCalledTimes(1);
            await Promise.resolve();
            expect(platform.cleanup).toHaveBeenCalledTimes(1);

            netflixScript._cleanupOnPageLeave();
            await Promise.resolve();
            expect(platform.cleanup).toHaveBeenCalledTimes(1);
        });
    });

    describe('Capitalized content-subclass log privacy', () => {
        test('does not log script error events', () => {
            const logSpy = jest
                .spyOn(netflixScript, 'logWithFallback')
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
                    'chrome-extension://dualsub-test/injected_scripts/netflixInject.js'
                );

            try {
                netflixScript._reinjectScript();
                expect(typeof injectedScript.onerror).toBe('function');
                injectedScript.onerror(scriptErrorEvent);

                expectPrivateLogCalls(logSpy, {
                    sentinels: [LOG_SENTINEL, SECRET_PROPERTY],
                    rawValues: [scriptErrorEvent],
                });
            } finally {
                createElementSpy.mockRestore();
                appendChildSpy.mockRestore();
                getURLSpy.mockRestore();
            }
        });

        test('does not log synchronous reinjection errors', () => {
            const logSpy = jest
                .spyOn(netflixScript, 'logWithFallback')
                .mockImplementation(() => {});
            const reinjectionError = createSensitiveError();
            const getURLSpy = jest
                .spyOn(chrome.runtime, 'getURL')
                .mockImplementationOnce(() => {
                    throw reinjectionError;
                });

            try {
                expect(() => netflixScript._reinjectScript()).not.toThrow();
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
                .spyOn(netflixScript, 'logWithFallback')
                .mockImplementation(() => {});
            const baseCleanupSpy = jest
                .spyOn(BaseContentScript.prototype, 'cleanup')
                .mockRejectedValueOnce(cleanupError);

            try {
                await expect(netflixScript.cleanup()).rejects.toBe(
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
});
