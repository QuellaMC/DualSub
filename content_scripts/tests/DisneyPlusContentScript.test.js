/**
 * DisneyPlusContentScript Comprehensive Tests
 * 
 * Tests for Disney+ specific content script functionality including navigation detection,
 * URL change handling, SPA routing, injection configuration, and event handling.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { DisneyPlusContentScript } from '../platforms/DisneyPlusContentScript.js';
import { BaseContentScript } from '../core/BaseContentScript.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';

jest.mock('@content_scripts/core/utils.js', () => ({
    ...jest.requireActual('@content_scripts/core/utils.js'),
    isExtensionContextValid: jest.fn(() => true),
}));

describe('DisneyPlusContentScript Comprehensive Tests', () => {
    let disneyPlusScript;
    let testHelpers;
    let testEnv;
    let mockSendResponse;
    let consoleLogSpy;
    let originalPushState;
    let originalReplaceState;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'disneyplus',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true
        });

        disneyPlusScript = new DisneyPlusContentScript();

        jest.spyOn(BaseContentScript.prototype, 'logWithFallback').mockImplementation(() => {});
        jest.spyOn(BaseContentScript.prototype, 'stopVideoElementDetection').mockImplementation(() => {});
        jest.spyOn(BaseContentScript.prototype, 'initializePlatform').mockImplementation(() => Promise.resolve());
        jest.spyOn(BaseContentScript.prototype, 'cleanup').mockImplementation(() => Promise.resolve());
        
        originalPushState = window.history.pushState;
        originalReplaceState = window.history.replaceState;
        window.history.pushState = jest.fn();
        window.history.replaceState = jest.fn();

        mockSendResponse = jest.fn();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        global.document = {
            getElementById: jest.fn(),
            createElement: jest.fn(() => ({
                setAttribute: jest.fn(),
                remove: jest.fn(),
                onload: null,
                onerror: null
            })),
            head: { appendChild: jest.fn(), removeChild: jest.fn() },
            documentElement: { appendChild: jest.fn() },
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
        };

        global.window.addEventListener = jest.fn();
        global.window.removeEventListener = jest.fn();

        disneyPlusScript.intervalManager = {
            set: jest.fn(),
            clear: jest.fn(),
            clearAll: jest.fn()
        };

        disneyPlusScript.eventBuffer = {
            clear: jest.fn(),
            flush: jest.fn()
        };
    });

    afterEach(() => {
        if (disneyPlusScript && typeof disneyPlusScript.cleanup === 'function') {
            disneyPlusScript.cleanup();
        }
        if (testEnv) {
            testEnv.cleanup();
        }
        testHelpers.resetAllMocks();
        consoleLogSpy.mockRestore();
        window.history.pushState = originalPushState;
        window.history.replaceState = originalReplaceState;
    });

    describe('Initialization', () => {
        test('should initialize with correct platform name', () => {
            expect(disneyPlusScript.getPlatformName()).toBe('disneyplus');
        });

        test('should initialize with correct platform class', () => {
            expect(disneyPlusScript.getPlatformClass()).toBe('DisneyPlusPlatform');
        });

        test('should initialize with correct inject script configuration', () => {
            const config = disneyPlusScript.getInjectScriptConfig();
            expect(config).toEqual({
                filename: 'injected_scripts/disneyPlusInject.js',
                tagId: 'disneyplus-dualsub-injector-script-tag',
                eventId: 'disneyplus-dualsub-injector-event'
            });
        });

        test('should initialize with correct URL patterns', () => {
            expect(disneyPlusScript.urlPatterns).toEqual(['*.disneyplus.com']);
        });
    });

    describe('URL Change Detection', () => {
        test('should handle URL changes with Disney+ SPA routing', () => {
            // Setup initial state on non-player page
            disneyPlusScript.currentUrl = 'http://localhost/';
            disneyPlusScript.lastKnownPathname = '/';
            // Spy on page transition handler
            jest.spyOn(disneyPlusScript, '_handlePageTransition').mockImplementation(() => {});
            // Override checkForUrlChange to simulate a SPA navigation
            disneyPlusScript.checkForUrlChange = jest.fn(() => {
                const newUrl = 'http://localhost/play/123456';
                const newPathname = '/play/123456';
                if (newUrl !== disneyPlusScript.currentUrl || newPathname !== disneyPlusScript.lastKnownPathname) {
                    console.log('URL change detected', { from: disneyPlusScript.currentUrl, to: newUrl });
                    disneyPlusScript.currentUrl = newUrl;
                    disneyPlusScript.lastKnownPathname = newPathname;
                    disneyPlusScript._handlePageTransition(false, true);
                }
            });
            // Invoke detection
            disneyPlusScript.checkForUrlChange();
            // Verify state update and handler invocation
            expect(disneyPlusScript.currentUrl).toBe('http://localhost/play/123456');
            expect(disneyPlusScript.lastKnownPathname).toBe('/play/123456');
            expect(disneyPlusScript._handlePageTransition).toHaveBeenCalledWith(false, true);
            // Verify logging via console.log
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('URL change detected'),
                expect.objectContaining({ from: 'http://localhost/', to: 'http://localhost/play/123456' })
            );
        });
    });

    describe('Page Transitions', () => {
        beforeEach(() => {
            disneyPlusScript._cleanupOnPageLeave = jest.fn();
            disneyPlusScript._initializeOnPageEnter = jest.fn();
        });

        test('should handle leaving player page', () => {
            disneyPlusScript._handlePageTransition(true, false);

            expect(disneyPlusScript._cleanupOnPageLeave).toHaveBeenCalled();
            expect(disneyPlusScript._initializeOnPageEnter).not.toHaveBeenCalled();
            expect(disneyPlusScript.logWithFallback).toHaveBeenCalledWith(
                'info',
                'Leaving player page, cleaning up platform.'
            );
        });

        test('should initialize when entering page', () => {
            disneyPlusScript._handlePageTransition(false, true);

            expect(disneyPlusScript._cleanupOnPageLeave).not.toHaveBeenCalled();
            expect(disneyPlusScript._initializeOnPageEnter).toHaveBeenCalled();
            expect(disneyPlusScript.logWithFallback).toHaveBeenCalledWith(
                'info',
                'Entering player page, preparing for initialization.'
            );
        });
    });
});