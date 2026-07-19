import { jest } from '@jest/globals';

import { BaseContentScript } from '../core/BaseContentScript.js';
import { AI_CONTEXT_SIGNAL_TYPES } from '../aicontext/core/AIContextChannel.js';
import { SelectionModel } from '../aicontext/core/state/SelectionModel.js';
import {
    buildSidePanelSelectionRemovalCommandMessage,
    buildSidePanelSelectionRepublishRequestMessage,
    parseSidePanelSelectionRemovalCommandResponse,
} from '../shared/protocol/messageProtocol.js';
import { MessageActions } from '../shared/constants/messageActions.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';

class SelectionAuthorityContentScript extends BaseContentScript {
    constructor() {
        super('SelectionAuthorityTest');
    }

    getPlatformName() {
        return 'netflix';
    }

    getPlatformClass() {
        return class SelectionAuthorityPlatform {};
    }

    getInjectScriptConfig() {
        return {
            filename: 'test.js',
            tagId: 'selection-authority-test',
            eventId: 'SELECTION_AUTHORITY_TEST',
        };
    }

    setupNavigationDetection() {}

    handlePlatformSpecificMessage(_request, sendResponse) {
        sendResponse({ success: false });
        return false;
    }
}

function installOriginalWords(renderRevision, entries) {
    const container = document.createElement('div');
    container.id = 'dualsub-original-subtitle';
    container.setAttribute('data-render-revision', String(renderRevision));
    for (const entry of entries) {
        const element = document.createElement('span');
        element.className = 'dualsub-interactive-word';
        element.setAttribute('data-subtitle-type', 'original');
        element.setAttribute('data-render-revision', String(renderRevision));
        element.setAttribute('data-word-index', String(entry.wordIndex));
        element.setAttribute('data-word', entry.word);
        element.textContent = entry.word;
        container.appendChild(element);
    }
    document.body.appendChild(container);
    return container;
}

function subtitleState(renderRevision, text = 'same same') {
    return Object.freeze({
        renderRevision,
        reason: 'render',
        videoId: 'video-1',
        text,
    });
}

function wordIntent(renderRevision, wordIndex, word = 'same') {
    return Object.freeze({
        action: 'toggle',
        renderRevision,
        wordIndex,
        word,
        sourceLanguage: 'en',
        targetLanguage: 'es',
    });
}

function createDeferred() {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

async function flushMessaging() {
    for (let index = 0; index < 12; index += 1) {
        await Promise.resolve();
    }
}

describe('BaseContentScript canonical selection authority', () => {
    let testEnvironment;
    let contentScripts;
    let sentMessages;
    let snapshotAccepted;

    beforeEach(() => {
        testEnvironment = new TestHelpers().setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });
        contentScripts = [];
        sentMessages = [];
        snapshotAccepted = true;
        chrome.storage.sync.get.mockResolvedValue({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: false,
            sidePanelAutoPauseVideo: false,
        });
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            const response =
                message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
                    ? { success: snapshotAccepted }
                    : { success: true };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
    });

    afterEach(async () => {
        for (const contentScript of contentScripts) {
            await contentScript.cleanup();
        }
        document.body.innerHTML = '';
        testEnvironment.cleanup();
    });

    function createContentScript() {
        const contentScript = new SelectionAuthorityContentScript();
        contentScript.subtitleUtils = {
            resolveInteractiveOriginalWordOccurrence(intent) {
                const container = document.getElementById(
                    'dualsub-original-subtitle'
                );
                if (!container) return null;
                return (
                    Array.from(
                        container.querySelectorAll(
                            '.dualsub-interactive-word[data-subtitle-type="original"]'
                        )
                    ).find(
                        (element) =>
                            element.getAttribute('data-render-revision') ===
                                String(intent.renderRevision) &&
                            element.getAttribute('data-word-index') ===
                                String(intent.wordIndex) &&
                            element.getAttribute('data-word') === intent.word
                    ) || null
                );
            },
        };
        contentScripts.push(contentScript);
        return contentScript;
    }

    test('commits duplicate occurrences before the gesture and emits no selection data in the open message', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const signalOrder = [];
        const snapshots = [];
        owner.channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            (envelope) => {
                signalOrder.push('selection');
                snapshots.push(envelope.payload);
            }
        );
        owner.channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, () => {
            signalOrder.push('intent');
        });
        await contentScript._initializeSidePanelIntegration(owner);

        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installOriginalWords(1, [
            { wordIndex: 1, word: 'same' },
            { wordIndex: 3, word: 'same' },
        ]);
        expect(
            contentScript._handlePrivateWordIntent(owner, wordIntent(1, 3))
        ).toBe(true);
        await flushMessaging();

        const words = container.querySelectorAll('.dualsub-interactive-word');
        expect(words[0]).not.toHaveClass('dualsub-word-selected');
        expect(words[1]).toHaveClass('dualsub-word-selected');
        expect(snapshots.at(-1).entries).toEqual([
            { wordIndex: 3, word: 'same' },
        ]);
        expect(signalOrder.at(-1)).toBe('selection');
        expect(signalOrder).not.toContain('intent');

        const openMessage = sentMessages.find(
            (message) =>
                message.action === MessageActions.SIDEPANEL_WORD_SELECTED
        );
        expect(openMessage).toEqual({
            action: MessageActions.SIDEPANEL_WORD_SELECTED,
            options: { autoOpen: false, pauseVideo: false },
        });
        expect(openMessage).not.toHaveProperty('word');
        expect(openMessage).not.toHaveProperty('selectedWords');

        const revisionBeforeForgery = snapshots.at(-1).selectionRevision;
        document.dispatchEvent(
            new CustomEvent('dualsub-word-selected', {
                detail: { word: 'forged', action: 'add' },
            })
        );
        expect(snapshots.at(-1).selectionRevision).toBe(revisionBeforeForgery);
    });

    test('never falls back to matching page DOM when the private registry rejects an occurrence', () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installOriginalWords(1, [
            { wordIndex: 0, word: 'same' },
        ]);
        contentScript.subtitleUtils.resolveInteractiveOriginalWordOccurrence =
            () => null;

        expect(
            contentScript._handlePrivateWordIntent(owner, wordIntent(1, 0))
        ).toBe(false);
        expect(
            container.querySelector('.dualsub-interactive-word')
        ).not.toHaveClass('dualsub-word-selected');
    });

    test('allocates distinct monotonic content owner generations across Base instances', async () => {
        const first = createContentScript();
        const second = createContentScript();

        first._handlePrivateSubtitleState(subtitleState(1, 'first'));
        second._handlePrivateSubtitleState(subtitleState(2, 'second'));
        await flushMessaging();

        const snapshots = sentMessages.filter(
            (message) =>
                message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
        );
        expect(snapshots).toHaveLength(2);
        expect(snapshots[1].data.lifecycleGeneration).toBeGreaterThan(
            snapshots[0].data.lifecycleGeneration
        );
        expect(snapshots[0].data.selectionRevision).toBe(1);
        expect(snapshots[1].data.selectionRevision).toBe(1);
    });

    test('acknowledges GET_STATE only after the exact replay is accepted', async () => {
        const contentScript = createContentScript();
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        await flushMessaging();
        sentMessages.length = 0;

        const acceptedResponse = jest.fn();
        expect(
            contentScript.handleSidePanelGetState(
                buildSidePanelSelectionRepublishRequestMessage(7),
                acceptedResponse
            )
        ).toBe(true);
        await flushMessaging();
        expect(acceptedResponse).toHaveBeenCalledWith({ requestId: 7 });

        snapshotAccepted = false;
        const rejectedResponse = jest.fn();
        contentScript.handleSidePanelGetState(
            buildSidePanelSelectionRepublishRequestMessage(8),
            rejectedResponse
        );
        await flushMessaging();
        expect(rejectedResponse).toHaveBeenCalledWith(null);
    });

    test('does not acknowledge a replay that completes after terminal cleanup', async () => {
        const contentScript = createContentScript();
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        await flushMessaging();

        const replayGate = createDeferred();
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            if (message.action === MessageActions.SIDEPANEL_SELECTION_SYNC) {
                return replayGate.promise.then((response) => {
                    if (typeof callback === 'function') callback(response);
                    return response;
                });
            }
            const response = { success: true };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });

        const sendResponse = jest.fn();
        contentScript.handleSidePanelGetState(
            buildSidePanelSelectionRepublishRequestMessage(11),
            sendResponse
        );
        await Promise.resolve();
        const cleanupPromise = contentScript.cleanup();
        replayGate.resolve({ success: true });
        await cleanupPromise;
        await flushMessaging();

        expect(sendResponse).toHaveBeenCalledWith(null);
    });

    test('publishes a newer empty snapshot before disabling interactions', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const snapshots = [];
        owner.channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            (envelope) => snapshots.push(envelope.payload)
        );
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installOriginalWords(1, [
            { wordIndex: 1, word: 'same' },
        ]);
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        await flushMessaging();
        const selectedSnapshot = snapshots.at(-1);
        const selectedWire = sentMessages
            .filter(
                (message) =>
                    message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            )
            .at(-1).data;

        await contentScript._disableAIContextInteractions(
            owner,
            Promise.resolve()
        );
        await flushMessaging();

        const clearedSnapshot = snapshots.at(-1);
        expect(clearedSnapshot.reason).toBe('clear');
        expect(clearedSnapshot.entries).toEqual([]);
        expect(clearedSnapshot.selectionRevision).toBeGreaterThan(
            selectedSnapshot.selectionRevision
        );
        expect(
            sentMessages
                .filter(
                    (message) =>
                        message.action ===
                        MessageActions.SIDEPANEL_SELECTION_SYNC
                )
                .at(-1).data
        ).toEqual(
            expect.objectContaining({
                selectionRevision: clearedSnapshot.selectionRevision,
                reason: 'clear',
                entries: [],
            })
        );
        expect(container.querySelector('span')).not.toHaveClass(
            'dualsub-word-selected'
        );

        const staleCommand = buildSidePanelSelectionRemovalCommandMessage(
            {
                binding: { registrationId: 1, tabId: 2, windowId: 3 },
                requestId: 14,
                selectionOwnerGeneration: 5,
                selectionRevision: selectedWire.selectionRevision,
                renderRevision: selectedWire.renderRevision,
                wordIndex: 1,
            },
            selectedWire.lifecycleGeneration
        );
        const staleResponse = jest.fn();
        expect(
            contentScript.handleSidePanelUpdateState(
                staleCommand,
                staleResponse
            )
        ).toBe(false);
        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                staleResponse.mock.calls[0][0],
                staleCommand.data
            )
        ).toEqual({ requestId: 14, status: 'rejected' });
    });

    test('lets the private modal clear the canonical selection through owner authority', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const snapshots = [];
        owner.channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            (envelope) => snapshots.push(envelope.payload)
        );
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installOriginalWords(1, [
            { wordIndex: 1, word: 'same' },
        ]);
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        await flushMessaging();

        const authority = contentScript._createPrivateAnalysisAuthority(owner);
        expect(authority.clearSelection()).toBe(true);
        await flushMessaging();

        expect(snapshots.at(-1)).toEqual(
            expect.objectContaining({ reason: 'clear', entries: [] })
        );
        expect(container.querySelector('span')).not.toHaveClass(
            'dualsub-word-selected'
        );
        expect(
            sentMessages
                .filter(
                    (message) =>
                        message.action ===
                        MessageActions.SIDEPANEL_SELECTION_SYNC
                )
                .at(-1).data
        ).toEqual(expect.objectContaining({ reason: 'clear', entries: [] }));
    });

    test('does not route a modal word intent when the side panel accepted it', () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const modalIntents = [];
        owner.channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, (event) =>
            modalIntents.push(event.payload)
        );
        contentScript.sidePanelIntegration = {
            notifyWordIntent: jest.fn(() => true),
        };
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        installOriginalWords(1, [{ wordIndex: 1, word: 'same' }]);

        expect(
            contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1))
        ).toBe(true);
        expect(
            contentScript.sidePanelIntegration.notifyWordIntent
        ).toHaveBeenCalledTimes(1);
        expect(modalIntents).toEqual([]);
    });

    test('falls back to the modal once after the side panel explicitly rejects the intent', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const modalIntents = [];
        owner.channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, (event) =>
            modalIntents.push(event.payload)
        );
        chrome.storage.sync.get.mockResolvedValue({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        });
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            const response = {
                success:
                    message.action !== MessageActions.SIDEPANEL_WORD_SELECTED,
            };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
        await contentScript._initializeSidePanelIntegration(owner);
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        installOriginalWords(1, [{ wordIndex: 1, word: 'same' }]);

        expect(
            contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1))
        ).toBe(true);
        expect(modalIntents).toEqual([]);
        await flushMessaging();

        expect(modalIntents).toEqual([wordIntent(1, 1)]);
    });

    test('does not fall back after an ambiguous side panel channel closure', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const modalIntents = [];
        owner.channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, (event) =>
            modalIntents.push(event.payload)
        );
        chrome.storage.sync.get.mockResolvedValue({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        });
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            if (message.action === MessageActions.SIDEPANEL_WORD_SELECTED) {
                chrome.runtime.lastError = {
                    message:
                        'The message port closed before a response was received.',
                };
                callback(undefined);
                delete chrome.runtime.lastError;
                return undefined;
            }
            const response = { success: true };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
        await contentScript._initializeSidePanelIntegration(owner);
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        installOriginalWords(1, [{ wordIndex: 1, word: 'same' }]);

        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        await flushMessaging();

        expect(modalIntents).toEqual([]);
    });

    test('falls back once after Chrome proves the side panel intent was never delivered', async () => {
        jest.useFakeTimers();
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const modalIntents = [];
        let wordIntentAttempts = 0;
        owner.channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, (event) =>
            modalIntents.push(event.payload)
        );
        chrome.storage.sync.get.mockResolvedValue({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        });
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            if (message.action === MessageActions.SIDEPANEL_WORD_SELECTED) {
                wordIntentAttempts += 1;
                chrome.runtime.lastError = {
                    message:
                        'Could not establish connection. Receiving end does not exist.',
                };
                callback(undefined);
                delete chrome.runtime.lastError;
                return undefined;
            }
            const response = { success: true };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });

        try {
            await contentScript._initializeSidePanelIntegration(owner);
            contentScript._handlePrivateSubtitleState(subtitleState(1));
            installOriginalWords(1, [{ wordIndex: 1, word: 'same' }]);

            contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
            await jest.advanceTimersByTimeAsync(1000);
            await flushMessaging();

            expect(wordIntentAttempts).toBe(3);
            expect(modalIntents).toEqual([wordIntent(1, 1)]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('ignores a delayed side panel rejection after the canonical cue changed', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const modalIntents = [];
        const sidePanelReceipt = createDeferred();
        owner.channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, (event) =>
            modalIntents.push(event.payload)
        );
        chrome.storage.sync.get.mockResolvedValue({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        });
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            const responsePromise =
                message.action === MessageActions.SIDEPANEL_WORD_SELECTED
                    ? sidePanelReceipt.promise
                    : Promise.resolve({ success: true });
            return responsePromise.then((response) => {
                if (typeof callback === 'function') callback(response);
                return response;
            });
        });
        await contentScript._initializeSidePanelIntegration(owner);
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        installOriginalWords(1, [{ wordIndex: 1, word: 'same' }]);

        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        contentScript._handlePrivateSubtitleState(subtitleState(2, 'next'));
        sidePanelReceipt.resolve({ success: false });
        await flushMessaging();

        expect(modalIntents).toEqual([]);
    });

    test('routes a word intent to the modal when the side panel is disabled', () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        const modalIntents = [];
        owner.channel.subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, (event) =>
            modalIntents.push(event.payload)
        );
        contentScript.sidePanelIntegration = {
            notifyWordIntent: jest.fn(() => false),
        };
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        installOriginalWords(1, [{ wordIndex: 1, word: 'same' }]);

        expect(
            contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1))
        ).toBe(true);
        expect(modalIntents).toEqual([wordIntent(1, 1)]);
    });

    test('removes one exact occurrence only after the successor snapshot is accepted', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installOriginalWords(1, [
            { wordIndex: 1, word: 'same' },
            { wordIndex: 3, word: 'same' },
        ]);
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 3));
        await flushMessaging();

        const currentWire = sentMessages
            .filter(
                (message) =>
                    message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            )
            .at(-1).data;
        const removalRequest = {
            binding: { registrationId: 1, tabId: 2, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 5,
            selectionRevision: currentWire.selectionRevision,
            renderRevision: currentWire.renderRevision,
            wordIndex: 3,
        };
        const command = buildSidePanelSelectionRemovalCommandMessage(
            removalRequest,
            currentWire.lifecycleGeneration
        );
        const sendResponse = jest.fn();

        expect(
            contentScript.handleSidePanelUpdateState(command, sendResponse)
        ).toBe(true);
        expect(container.querySelector('[data-word-index="3"]')).toHaveClass(
            'dualsub-word-selected'
        );
        await flushMessaging();

        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                sendResponse.mock.calls[0][0],
                command.data
            )
        ).toEqual({ requestId: 9, status: 'applied' });
        expect(container.querySelector('[data-word-index="1"]')).toHaveClass(
            'dualsub-word-selected'
        );
        expect(
            container.querySelector('[data-word-index="3"]')
        ).not.toHaveClass('dualsub-word-selected');
    });

    test('keeps the exact occurrence selected when successor publication is rejected', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installOriginalWords(1, [
            { wordIndex: 1, word: 'same' },
        ]);
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        await flushMessaging();

        const currentWire = sentMessages
            .filter(
                (message) =>
                    message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            )
            .at(-1).data;
        snapshotAccepted = false;
        const removalRequest = {
            binding: { registrationId: 1, tabId: 2, windowId: 3 },
            requestId: 10,
            selectionOwnerGeneration: 5,
            selectionRevision: currentWire.selectionRevision,
            renderRevision: currentWire.renderRevision,
            wordIndex: 1,
        };
        const command = buildSidePanelSelectionRemovalCommandMessage(
            removalRequest,
            currentWire.lifecycleGeneration
        );
        const sendResponse = jest.fn();

        contentScript.handleSidePanelUpdateState(command, sendResponse);
        await flushMessaging();

        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                sendResponse.mock.calls[0][0],
                command.data
            )
        ).toEqual({ requestId: 10, status: 'rejected' });
        expect(container.querySelector('[data-word-index="1"]')).toHaveClass(
            'dualsub-word-selected'
        );
    });

    test('commits an accepted successor when the rendered occurrence is replaced in flight', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installOriginalWords(1, [
            { wordIndex: 1, word: 'same' },
        ]);
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        await flushMessaging();

        const currentWire = sentMessages
            .filter(
                (message) =>
                    message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            )
            .at(-1).data;
        const command = buildSidePanelSelectionRemovalCommandMessage(
            {
                binding: { registrationId: 1, tabId: 2, windowId: 3 },
                requestId: 12,
                selectionOwnerGeneration: 5,
                selectionRevision: currentWire.selectionRevision,
                renderRevision: currentWire.renderRevision,
                wordIndex: 1,
            },
            currentWire.lifecycleGeneration
        );
        const successorGate = createDeferred();
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            const responsePromise =
                message.action === MessageActions.SIDEPANEL_SELECTION_SYNC &&
                message.data.reason === 'remove'
                    ? successorGate.promise
                    : Promise.resolve({ success: true });
            return responsePromise.then((response) => {
                if (typeof callback === 'function') callback(response);
                return response;
            });
        });
        const sendResponse = jest.fn();

        contentScript.handleSidePanelUpdateState(command, sendResponse);
        await Promise.resolve();
        const original = container.querySelector('[data-word-index="1"]');
        const replacement = original.cloneNode(true);
        original.replaceWith(replacement);
        contentScript.subtitleUtils.resolveInteractiveOriginalWordOccurrence =
            () => null;
        successorGate.resolve({ success: true });
        await flushMessaging();

        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                sendResponse.mock.calls[0][0],
                command.data
            )
        ).toEqual({ requestId: 12, status: 'applied' });
        expect(replacement).not.toHaveClass('dualsub-word-selected');
    });

    test('publishes a higher-revision repair after ambiguous successor acceptance', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installOriginalWords(1, [
            { wordIndex: 1, word: 'same' },
        ]);
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        await flushMessaging();

        const currentWire = sentMessages
            .filter(
                (message) =>
                    message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            )
            .at(-1).data;
        const command = buildSidePanelSelectionRemovalCommandMessage(
            {
                binding: { registrationId: 1, tabId: 2, windowId: 3 },
                requestId: 15,
                selectionOwnerGeneration: 5,
                selectionRevision: currentWire.selectionRevision,
                renderRevision: currentWire.renderRevision,
                wordIndex: 1,
            },
            currentWire.lifecycleGeneration
        );
        let removeWasDelivered = false;
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentMessages.push(message);
            if (
                !removeWasDelivered &&
                message.action === MessageActions.SIDEPANEL_SELECTION_SYNC &&
                message.data.reason === 'remove'
            ) {
                removeWasDelivered = true;
                chrome.runtime.lastError = {
                    message:
                        'The message port closed before a response was received.',
                };
                callback(undefined);
                delete chrome.runtime.lastError;
                return undefined;
            }
            const response = { success: true };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
        const sendResponse = jest.fn();

        contentScript.handleSidePanelUpdateState(command, sendResponse);
        await flushMessaging();

        const selectionMessages = sentMessages.filter(
            (message) =>
                message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
        );
        const attemptedSuccessor = selectionMessages.at(-2).data;
        const repair = selectionMessages.at(-1).data;
        expect(attemptedSuccessor.reason).toBe('remove');
        expect(repair.reason).toBe('restore');
        expect(repair.selectionRevision).toBeGreaterThan(
            attemptedSuccessor.selectionRevision
        );
        expect(repair.entries).toEqual([{ wordIndex: 1, word: 'same' }]);
        expect(container.querySelector('[data-word-index="1"]')).toHaveClass(
            'dualsub-word-selected'
        );
        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                sendResponse.mock.calls[0][0],
                command.data
            )
        ).toEqual({ requestId: 15, status: 'rejected' });
    });

    test('publishes a higher-revision repair before rejecting a failed local removal', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        installOriginalWords(1, [{ wordIndex: 1, word: 'same' }]);
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        await flushMessaging();
        const currentWire = sentMessages
            .filter(
                (message) =>
                    message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            )
            .at(-1).data;
        const command = buildSidePanelSelectionRemovalCommandMessage(
            {
                binding: { registrationId: 1, tabId: 2, windowId: 3 },
                requestId: 13,
                selectionOwnerGeneration: 5,
                selectionRevision: currentWire.selectionRevision,
                renderRevision: currentWire.renderRevision,
                wordIndex: 1,
            },
            currentWire.lifecycleGeneration
        );
        const remove = jest
            .spyOn(SelectionModel.prototype, 'remove')
            .mockReturnValueOnce(false);
        const sendResponse = jest.fn();

        try {
            contentScript.handleSidePanelUpdateState(command, sendResponse);
            await flushMessaging();
        } finally {
            remove.mockRestore();
        }

        const selectionMessages = sentMessages.filter(
            (message) =>
                message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
        );
        const repair = selectionMessages.at(-1).data;
        const attemptedSuccessor = selectionMessages.at(-2).data;
        expect(repair.reason).toBe('restore');
        expect(repair.entries).toEqual([{ wordIndex: 1, word: 'same' }]);
        expect(repair.selectionRevision).toBeGreaterThan(
            attemptedSuccessor.selectionRevision
        );
        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                sendResponse.mock.calls[0][0],
                command.data
            )
        ).toEqual({ requestId: 13, status: 'rejected' });
    });
});
