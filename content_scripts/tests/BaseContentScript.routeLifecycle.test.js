import { jest } from '@jest/globals';

import { BaseContentScript } from '../core/BaseContentScript.js';
import { MessageActions } from '../shared/constants/messageActions.js';
import { createInjectionChannel } from '../shared/injectionChannel.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';

class RouteLifecycleContentScript extends BaseContentScript {
    constructor() {
        super('RouteLifecycleTest');
        this.injectConfig = {
            filename: 'route-lifecycle-test.js',
            tagId: 'route-lifecycle-test-script',
            eventId: 'ROUTE_LIFECYCLE_TEST',
            channel: createInjectionChannel('netflix'),
        };
    }

    getPlatformName() {
        return 'netflix';
    }

    getPlatformClass() {
        return class RouteLifecyclePlatform {};
    }

    getInjectScriptConfig() {
        return this.injectConfig;
    }

    _isPlayerPath(pathname) {
        return pathname.startsWith('/watch/');
    }

    setupNavigationDetection() {}

    handlePlatformSpecificMessage(_request, sendResponse) {
        sendResponse({ success: false });
        return false;
    }
}

function createDeferred() {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

describe('BaseContentScript route and injection lifecycle', () => {
    let environment;
    let contentScripts;
    let originalPath;

    beforeEach(() => {
        environment = new TestHelpers().setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });
        contentScripts = [];
        originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        chrome.runtime.getURL.mockImplementation(
            (path) => `chrome-extension://test/${path}`
        );
    });

    afterEach(async () => {
        jest.useRealTimers();
        for (const contentScript of contentScripts) {
            await contentScript.cleanup();
        }
        history.replaceState({}, '', originalPath || '/');
        document.body.innerHTML = '';
        document.head
            .querySelectorAll('#route-lifecycle-test-script')
            .forEach((element) => element.remove());
        environment.cleanup();
    });

    function createContentScript() {
        const contentScript = new RouteLifecycleContentScript();
        contentScripts.push(contentScript);
        return contentScript;
    }

    test('failed early injection removes the failed node and retries once', () => {
        jest.useFakeTimers();
        const contentScript = createContentScript();

        expect(contentScript.injectScriptEarly()).toBe(true);
        const failed = document.getElementById('route-lifecycle-test-script');
        expect(failed).not.toBeNull();
        expect(failed).not.toHaveAttribute('type');
        expect(failed.src).toMatch(/#dualsub-channel=netflix\.[0-9a-f]{64}$/u);
        failed.onerror(new Event('error'));
        expect(failed.isConnected).toBe(false);

        jest.advanceTimersByTime(100);
        const replacement = document.getElementById(
            'route-lifecycle-test-script'
        );
        expect(replacement).not.toBeNull();
        expect(replacement).not.toBe(failed);
        expect(contentScript.earlyInjectionRetryTask).toBeNull();
    });

    test('terminal cleanup revokes external ingress before its first await', async () => {
        const contentScript = createContentScript();
        const cleanupGate = createDeferred();
        const add = jest.spyOn(contentScript.eventBuffer, 'add');
        const prepareForInjectionChannelRevocation = jest.fn(() => {
            expect(
                contentScript
                    .getInjectScriptConfig()
                    .channel.createEventDetail('PLAYBACK_BRIDGE_PAUSE')
            ).not.toBeNull();
        });
        contentScript.activePlatform = {
            cleanup: jest.fn(),
            prepareForInjectionChannelRevocation,
        };
        const authorizedEvent = new CustomEvent(
            contentScript.getInjectScriptConfig().eventId,
            {
                detail: contentScript
                    .getInjectScriptConfig()
                    .channel.createEventDetail('SUBTITLE_DATA_FOUND', {
                        payload: { url: 'https://example.test/sub.vtt' },
                    }),
            }
        );
        contentScript._stopAllDetectionActivities = jest
            .fn()
            .mockReturnValue(cleanupGate.promise);

        const cleanupPromise = contentScript.cleanup();

        expect(prepareForInjectionChannelRevocation).toHaveBeenCalledTimes(1);
        expect(
            contentScript
                .getInjectScriptConfig()
                .channel.createEventDetail('SUBTITLE_DATA_FOUND')
        ).toBeNull();
        expect(contentScript.handleEarlyInjectorEvents(authorizedEvent)).toBe(
            false
        );
        expect(add).not.toHaveBeenCalled();
        const sendResponse = jest.fn();
        expect(
            contentScript.handleChromeMessage(
                { action: MessageActions.SIDEPANEL_GET_STATE },
                {},
                sendResponse
            )
        ).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Content script lifecycle is terminal',
        });

        cleanupGate.resolve();
        await cleanupPromise;
    });

    test('accepts a page event once and delivers plain data to the active platform', () => {
        const contentScript = createContentScript();
        const platform = {
            cleanup: jest.fn(),
            handleInjectorEvents: jest.fn(),
        };
        contentScript.activePlatform = platform;
        contentScript.platformReady = true;
        const pageEvent = new CustomEvent(
            contentScript.getInjectScriptConfig().eventId,
            {
                detail: contentScript
                    .getInjectScriptConfig()
                    .channel.createEventDetail('PLAYBACK_TIMELINE_UPDATE', {
                        programTimeSeconds: 12.5,
                        videoId: '123',
                    }),
            }
        );

        contentScript.handleEarlyInjectorEvents(pageEvent);

        expect(platform.handleInjectorEvents).toHaveBeenCalledTimes(1);
        expect(platform.handleInjectorEvents).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'PLAYBACK_TIMELINE_UPDATE',
                programTimeSeconds: 12.5,
                videoId: '123',
                pageUrl: window.location.href,
                timestamp: expect.any(Number),
            })
        );
        expect(
            platform.handleInjectorEvents.mock.calls[0][0]
        ).not.toHaveProperty('dualsubChannel');
        expect(contentScript.eventBuffer.size()).toBe(0);
    });
});
