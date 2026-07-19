/**
 * DisneyPlusContentScript Comprehensive Tests
 *
 * Tests for Disney+ specific content script functionality including shared-manager
 * navigation setup, player-route classification, injection, and event handling.
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
import { TestHelpers } from '../../test-utils/test-helpers.js';

jest.mock('@content_scripts/core/utils.js', () => ({
    ...jest.requireActual('@content_scripts/core/utils.js'),
    isExtensionContextValid: jest.fn(() => true),
}));

describe('DisneyPlusContentScript Comprehensive Tests', () => {
    let disneyPlusScript;
    let testHelpers;
    let testEnv;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'disneyplus',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });

        disneyPlusScript = new DisneyPlusContentScript();

        jest.spyOn(
            BaseContentScript.prototype,
            'logWithFallback'
        ).mockImplementation(() => {});
        jest.spyOn(
            BaseContentScript.prototype,
            'stopVideoElementDetection'
        ).mockImplementation(() => {});
        jest.spyOn(
            BaseContentScript.prototype,
            'initializePlatform'
        ).mockImplementation(() => Promise.resolve());
        jest.spyOn(BaseContentScript.prototype, 'cleanup').mockImplementation(
            () => Promise.resolve()
        );

        global.document = {
            getElementById: jest.fn(),
            createElement: jest.fn(() => ({
                setAttribute: jest.fn(),
                remove: jest.fn(),
                onload: null,
                onerror: null,
            })),
            head: { appendChild: jest.fn(), removeChild: jest.fn() },
            documentElement: { appendChild: jest.fn() },
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        };

        global.window.addEventListener = jest.fn();
        global.window.removeEventListener = jest.fn();

        disneyPlusScript.intervalManager = {
            set: jest.fn(),
            clear: jest.fn(),
            clearAll: jest.fn(),
        };

        disneyPlusScript.eventBuffer = {
            clear: jest.fn(),
            flush: jest.fn(),
        };
    });

    afterEach(() => {
        if (
            disneyPlusScript &&
            typeof disneyPlusScript.cleanup === 'function'
        ) {
            disneyPlusScript.cleanup();
        }
        if (testEnv) {
            testEnv.cleanup();
        }
        testHelpers.resetAllMocks();
    });

    describe('Initialization', () => {
        test('should initialize with correct platform name', () => {
            expect(disneyPlusScript.getPlatformName()).toBe('disneyplus');
        });

        test('should initialize with correct platform class', () => {
            expect(disneyPlusScript.getPlatformClass()).toBe(
                'DisneyPlusPlatform'
            );
        });

        test('should initialize with correct inject script configuration', () => {
            const config = disneyPlusScript.getInjectScriptConfig();
            expect(config).toEqual(
                expect.objectContaining({
                    filename: 'injected_scripts/disneyPlusInject.js',
                    tagId: 'disneyplus-dualsub-injector-script-tag',
                    eventId: 'disneyplus-dualsub-injector-event',
                    channel: expect.objectContaining({
                        platform: 'disneyplus',
                        accept: expect.any(Function),
                        createEventDetail: expect.any(Function),
                        createScriptUrl: expect.any(Function),
                        revoke: expect.any(Function),
                    }),
                })
            );
            expect(Object.hasOwn(config, 'channel')).toBe(true);
        });

        test('should initialize with correct URL patterns', () => {
            expect(disneyPlusScript.urlPatterns).toEqual(['*.disneyplus.com']);
        });
    });

    describe('Shared Navigation Setup and Player Routes', () => {
        test('distinguishes active player routes from browse and detail routes', () => {
            expect(disneyPlusScript._isPlayerPath('/video/video-id')).toBe(
                true
            );
            expect(disneyPlusScript._isPlayerPath('/play/video-id')).toBe(true);
            expect(disneyPlusScript._isPlayerPath('/video/video-id/')).toBe(
                true
            );
            expect(
                disneyPlusScript._isPlayerPath('/video/video-id/credits')
            ).toBe(false);
            expect(
                disneyPlusScript._isPlayerPath('/movies/title/video-id')
            ).toBe(false);
            expect(
                disneyPlusScript._isPlayerPath('/series/title/series-id')
            ).toBe(false);
            expect(disneyPlusScript._isPlayerPath('/video/')).toBe(false);
            expect(disneyPlusScript._isPlayerPath('/play/')).toBe(false);
            expect(
                disneyPlusScript._isPlayerPath('/browse/video/video-id')
            ).toBe(false);
            expect(
                disneyPlusScript._isPlayerPath('/movies/play/video-id')
            ).toBe(false);
            expect(disneyPlusScript._isPlayerPath('/videos/video-id')).toBe(
                false
            );
        });

        test('delegates navigation detection exclusively to the shared manager', () => {
            const setupManager = jest
                .spyOn(disneyPlusScript, '_setupNavigationManager')
                .mockImplementation(() => {});

            disneyPlusScript.setupNavigationDetection();

            expect(setupManager).toHaveBeenCalledTimes(1);
            expect(disneyPlusScript.intervalManager.set).not.toHaveBeenCalled();
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
            expect(
                disneyPlusScript._initializeOnPageEnter
            ).not.toHaveBeenCalled();
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

    test('delegates player-page cleanup to the shared lifecycle boundary', () => {
        const cleanupLifecycle = jest
            .spyOn(disneyPlusScript, '_cleanupOnPlayerPageLeave')
            .mockImplementation(() => {});

        disneyPlusScript._cleanupOnPageLeave();

        expect(cleanupLifecycle).toHaveBeenCalledTimes(1);
    });

    test('uses the shared page-enter initialization lifecycle', () => {
        const scheduleInitialization = jest
            .spyOn(
                disneyPlusScript,
                '_schedulePlatformInitializationOnPageEnter'
            )
            .mockImplementation(() => {});
        disneyPlusScript._reinjectScript = jest.fn();

        disneyPlusScript._initializeOnPageEnter();

        expect(disneyPlusScript._reinjectScript).toHaveBeenCalledTimes(1);
        expect(scheduleInitialization).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            1500
        );
    });

    test('uses the non-sensitive configuration projection on page entry', async () => {
        jest.useFakeTimers();
        try {
            disneyPlusScript._reinjectScript = jest.fn();
            disneyPlusScript.configService = {
                getAll: jest.fn().mockResolvedValue({
                    subtitlesEnabled: false,
                }),
            };
            disneyPlusScript._isPlayerPage = jest.fn().mockReturnValue(true);

            disneyPlusScript._initializeOnPageEnter();
            await jest.advanceTimersByTimeAsync(1500);

            expect(disneyPlusScript.configService.getAll).toHaveBeenCalledWith({
                includeSensitive: false,
            });
        } finally {
            jest.useRealTimers();
        }
    });

    test('reinjects with the exact stable Disney channel fragment', () => {
        const firstScript = {
            id: '',
            src: '',
            onload: null,
            onerror: null,
        };
        const secondScript = {
            id: '',
            src: '',
            onload: null,
            onerror: null,
        };
        const createElementSpy = jest
            .spyOn(document, 'createElement')
            .mockReturnValueOnce(firstScript)
            .mockReturnValueOnce(secondScript);
        const appendChildSpy = jest
            .spyOn(document.head, 'appendChild')
            .mockImplementation((node) => node);
        const getUrlSpy = jest
            .spyOn(chrome.runtime, 'getURL')
            .mockReturnValue(
                'chrome-extension://test-extension/injected_scripts/disneyPlusInject.js'
            );
        try {
            expect(disneyPlusScript._reinjectScript()).toBe(true);
            expect(disneyPlusScript._reinjectScript()).toBe(true);

            const expectedFragment =
                /^#dualsub-channel=disneyplus\.[0-9a-f]{64}$/u;
            expect(new URL(firstScript.src).hash).toMatch(expectedFragment);
            expect(new URL(secondScript.src).hash).toBe(
                new URL(firstScript.src).hash
            );
            expect(appendChildSpy).toHaveBeenCalledTimes(2);
        } finally {
            getUrlSpy.mockRestore();
            appendChildSpy.mockRestore();
            createElementSpy.mockRestore();
        }
    });

    test('fails closed without appending when its injection channel is absent', () => {
        const createElementSpy = jest.spyOn(document, 'createElement');
        const appendChildSpy = jest.spyOn(document.head, 'appendChild');
        disneyPlusScript.injectConfig.channel = null;

        expect(disneyPlusScript._reinjectScript()).toBe(false);

        expect(createElementSpy).not.toHaveBeenCalled();
        expect(appendChildSpy).not.toHaveBeenCalled();
        appendChildSpy.mockRestore();
        createElementSpy.mockRestore();
    });
});
