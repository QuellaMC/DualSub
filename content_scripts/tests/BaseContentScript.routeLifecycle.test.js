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

function installWord(renderRevision, wordIndex, word) {
    const container = document.createElement('div');
    container.id = 'dualsub-original-subtitle';
    container.setAttribute('data-render-revision', String(renderRevision));
    const element = document.createElement('span');
    element.className = 'dualsub-interactive-word';
    element.setAttribute('data-subtitle-type', 'original');
    element.setAttribute('data-render-revision', String(renderRevision));
    element.setAttribute('data-word-index', String(wordIndex));
    element.setAttribute('data-word', word);
    element.textContent = word;
    container.appendChild(element);
    document.body.appendChild(container);
    return element;
}

async function flushWork() {
    for (let index = 0; index < 12; index += 1) {
        await Promise.resolve();
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
    let sentMessages;

    beforeEach(() => {
        environment = new TestHelpers().setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });
        contentScripts = [];
        originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        sentMessages = [];
        chrome.runtime.getURL.mockImplementation(
            (path) => `chrome-extension://test/${path}`
        );
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            const response = { success: true };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
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

    function installNavigationCollaborators(contentScript) {
        const platform = {
            onUrlChange: jest.fn(),
            setVideoIdAndNotify: jest.fn(),
            resetVttRequestState: jest.fn(),
            cleanup: jest.fn(),
        };
        const subtitleUtils = {
            setInteractiveSubtitlesEnabled: jest.fn(),
            clearSubtitlesDisplayAndQueue: jest.fn(),
            clearSubtitleDOM: jest.fn(),
            hideSubtitleContainer: jest.fn(),
            cleanup: jest.fn(),
        };
        contentScript.activePlatform = platform;
        contentScript.subtitleUtils = subtitleUtils;
        contentScript._rearmVideoElementDetectionForPlayerNavigation =
            jest.fn();
        return { platform, subtitleUtils };
    }

    test('player identity change synchronously revokes old subtitles and selection before rearm', async () => {
        jest.useFakeTimers();
        history.replaceState({}, '', '/watch/111');
        const contentScript = createContentScript();
        const { platform, subtitleUtils } =
            installNavigationCollaborators(contentScript);
        const owner = contentScript.aiContextFeatureOwner;
        contentScript._handlePrivateSubtitleState({
            renderRevision: 1,
            reason: 'render',
            videoId: '111',
            text: 'same',
        });
        installWord(1, 0, 'same');
        contentScript._handlePrivateWordIntent(owner, {
            action: 'toggle',
            renderRevision: 1,
            wordIndex: 0,
            word: 'same',
            sourceLanguage: 'en',
            targetLanguage: 'es',
        });
        await flushWork();
        const selectedRevision = sentMessages
            .filter(
                (message) =>
                    message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            )
            .at(-1).data.selectionRevision;

        contentScript._setupNavigationManager({
            useFocusEvents: false,
            useIntervalChecking: false,
            usePopstateEvents: false,
        });
        history.pushState({}, '', '/watch/222');
        jest.advanceTimersByTime(100);
        await flushWork();

        expect(platform.setVideoIdAndNotify).toHaveBeenCalledWith(null);
        expect(platform.resetVttRequestState).toHaveBeenCalledTimes(1);
        expect(
            subtitleUtils.clearSubtitlesDisplayAndQueue
        ).toHaveBeenCalledWith(platform, true, 'RouteLifecycleTest');
        expect(subtitleUtils.clearSubtitleDOM).toHaveBeenCalledTimes(1);
        expect(
            contentScript._rearmVideoElementDetectionForPlayerNavigation
        ).toHaveBeenCalledTimes(1);
        expect(platform.onUrlChange).toHaveBeenCalledTimes(1);
        expect(
            platform.setVideoIdAndNotify.mock.invocationCallOrder[0]
        ).toBeLessThan(platform.onUrlChange.mock.invocationCallOrder[0]);

        const cleared = sentMessages
            .filter(
                (message) =>
                    message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            )
            .at(-1).data;
        expect(cleared.reason).toBe('clear');
        expect(cleared.entries).toEqual([]);
        expect(cleared.selectionRevision).toBeGreaterThan(selectedRevision);
    });

    test('query and hash changes retain the current player identity', () => {
        jest.useFakeTimers();
        history.replaceState({}, '', '/watch/123?x=1');
        const contentScript = createContentScript();
        const { platform, subtitleUtils } =
            installNavigationCollaborators(contentScript);

        contentScript._setupNavigationManager({
            useFocusEvents: false,
            useIntervalChecking: false,
            usePopstateEvents: false,
        });
        history.pushState({}, '', '/watch/123?x=2#details');
        jest.advanceTimersByTime(100);

        expect(platform.onUrlChange).toHaveBeenCalledTimes(1);
        expect(platform.setVideoIdAndNotify).not.toHaveBeenCalled();
        expect(platform.resetVttRequestState).not.toHaveBeenCalled();
        expect(
            subtitleUtils.clearSubtitlesDisplayAndQueue
        ).not.toHaveBeenCalled();
        expect(subtitleUtils.clearSubtitleDOM).not.toHaveBeenCalled();
        expect(
            contentScript._rearmVideoElementDetectionForPlayerNavigation
        ).not.toHaveBeenCalled();
    });

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

    test('terminal cleanup cancels a pending early injection retry', async () => {
        jest.useFakeTimers();
        const contentScript = createContentScript();
        contentScript.injectScriptEarly();
        const failed = document.getElementById('route-lifecycle-test-script');
        failed.onerror(new Event('error'));
        expect(contentScript.earlyInjectionRetryTask).not.toBeNull();

        await contentScript.cleanup();
        expect(contentScript.earlyInjectionRetryTask).toBeNull();
        expect(
            contentScript
                .getInjectScriptConfig()
                .channel.createEventDetail('SUBTITLE_DATA_FOUND')
        ).toBeNull();
        jest.advanceTimersByTime(100);

        expect(
            document.getElementById('route-lifecycle-test-script')
        ).toBeNull();
        expect(contentScript.injectScriptEarly()).toBe(false);
    });

    test('terminal cleanup revokes external ingress before its first await', async () => {
        const contentScript = createContentScript();
        const cleanupGate = createDeferred();
        const add = jest.spyOn(contentScript.eventBuffer, 'add');
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

    test('event cleanup isolates unsubscribe and buffer failures', async () => {
        const contentScript = createContentScript();
        const laterCleanup = jest.fn();
        contentScript.configUnsubscribe = jest.fn(() => {
            throw new Error('unsubscribe failed');
        });
        contentScript.eventBuffer.clear = jest.fn(() => {
            throw new Error('buffer failed');
        });
        contentScript.eventListenerCleanupFunctions = [
            () => {
                throw new Error('listener cleanup failed');
            },
            laterCleanup,
        ];

        await contentScript._cleanupEventHandling();

        expect(laterCleanup).toHaveBeenCalledTimes(1);
        expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(
            contentScript.chromeMessageListener
        );
        expect(contentScript.chromeMessageListenerAttached).toBe(false);
    });
});
