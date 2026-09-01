import { jest } from '@jest/globals';

import { BaseContentScript } from '../core/BaseContentScript.js';
import {
    buildSidePanelSelectionRemovalCommandMessage,
    buildSidePanelSelectionRepublishRequestMessage,
    parseSidePanelSelectionRemovalCommandResponse,
} from '../shared/protocol/messageProtocol.js';
import { MessageActions } from '../shared/constants/messageActions.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';

class SelectionContentScript extends BaseContentScript {
    constructor() {
        super('SelectionTest');
    }

    getPlatformName() {
        return 'netflix';
    }

    getPlatformClass() {
        return class SelectionPlatform {};
    }

    getInjectScriptConfig() {
        return {
            filename: 'test.js',
            tagId: 'selection-test',
            eventId: 'SELECTION_TEST',
        };
    }

    setupNavigationDetection() {}
}

function installWords(renderRevision, entries) {
    const container = document.createElement('div');
    container.id = 'dualsub-original-subtitle';
    container.dataset.renderRevision = String(renderRevision);
    for (const entry of entries) {
        const word = document.createElement('span');
        word.className = 'dualsub-interactive-word';
        word.dataset.subtitleType = 'original';
        word.dataset.renderRevision = String(renderRevision);
        word.dataset.wordIndex = String(entry.wordIndex);
        word.dataset.word = entry.word;
        word.textContent = entry.word;
        container.appendChild(word);
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

async function flushMessaging() {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('BaseContentScript selection authority', () => {
    let environment;
    let contentScripts;
    let sentMessages;
    let snapshotAccepted;

    beforeEach(() => {
        environment = new TestHelpers().setupTestEnvironment({
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
        chrome.runtime.sendMessage.mockImplementation((message) => {
            sentMessages.push(message);
            return Promise.resolve({
                success:
                    message.action !==
                        MessageActions.SIDEPANEL_SELECTION_SYNC ||
                    snapshotAccepted,
            });
        });
    });

    afterEach(async () => {
        await Promise.all(contentScripts.map((script) => script.cleanup()));
        document.body.replaceChildren();
        environment.cleanup();
    });

    function createContentScript() {
        const contentScript = new SelectionContentScript();
        contentScript.subtitleUtils = {
            resolveInteractiveOriginalWordOccurrence(intent) {
                return (
                    Array.from(
                        document.querySelectorAll(
                            '.dualsub-interactive-word[data-subtitle-type="original"]'
                        )
                    ).find(
                        (element) =>
                            element.dataset.renderRevision ===
                                String(intent.renderRevision) &&
                            element.dataset.wordIndex ===
                                String(intent.wordIndex) &&
                            element.dataset.word === intent.word
                    ) ?? null
                );
            },
        };
        contentScripts.push(contentScript);
        return contentScript;
    }

    function selectionMessages() {
        return sentMessages.filter(
            ({ action }) => action === MessageActions.SIDEPANEL_SELECTION_SYNC
        );
    }

    function latestSelection() {
        return selectionMessages().at(-1).data;
    }

    function removalCommand(current, requestId, wordIndex) {
        return buildSidePanelSelectionRemovalCommandMessage(
            {
                binding: { registrationId: 1, tabId: 2, windowId: 3 },
                requestId,
                selectionOwnerGeneration: 5,
                selectionRevision: current.selectionRevision,
                renderRevision: current.renderRevision,
                wordIndex,
            },
            current.lifecycleGeneration
        );
    }

    test('acknowledges a live snapshot before best-effort republish', async () => {
        const contentScript = createContentScript();
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        await flushMessaging();

        const acceptedCount = selectionMessages().length;
        const accepted = jest.fn();
        expect(
            contentScript.handleSidePanelGetState(
                buildSidePanelSelectionRepublishRequestMessage(7),
                accepted
            )
        ).toBe(false);
        expect(accepted).toHaveBeenCalledWith({ success: true });
        await flushMessaging();
        expect(selectionMessages()).toHaveLength(acceptedCount + 1);

        snapshotAccepted = false;
        const rejectedCount = selectionMessages().length;
        const acknowledged = jest.fn();
        expect(
            contentScript.handleSidePanelGetState(
                buildSidePanelSelectionRepublishRequestMessage(8),
                acknowledged
            )
        ).toBe(false);
        expect(acknowledged).toHaveBeenCalledWith({ success: true });
        await flushMessaging();
        expect(selectionMessages()).toHaveLength(rejectedCount + 1);
    });

    test('applies an accepted exact-occurrence removal after publication', async () => {
        const contentScript = createContentScript();
        const owner = contentScript.aiContextFeatureOwner;
        contentScript._handlePrivateSubtitleState(subtitleState(1));
        const container = installWords(1, [
            { wordIndex: 1, word: 'same' },
            { wordIndex: 3, word: 'same' },
        ]);
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 1));
        contentScript._handlePrivateWordIntent(owner, wordIntent(1, 3));
        await flushMessaging();

        const command = removalCommand(latestSelection(), 9, 3);
        const response = jest.fn();
        expect(
            contentScript.handleSidePanelUpdateState(command, response)
        ).toBe(true);
        expect(container.children[1]).toHaveClass('dualsub-word-selected');
        await flushMessaging();

        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                response.mock.calls[0][0],
                command.data
            )
        ).toEqual({ requestId: 9, status: 'applied' });
        expect(container.children[0]).toHaveClass('dualsub-word-selected');
        expect(container.children[1]).not.toHaveClass('dualsub-word-selected');
    });
});
