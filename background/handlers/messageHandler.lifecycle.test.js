import { jest } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
import { BackgroundServiceReadiness } from '../serviceReadiness.js';
import { SidePanelService } from '../services/sidePanelService.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';

describe('MessageHandler service-worker lifecycle', () => {
    test('captures a cold-start message before services finish initializing', async () => {
        const listeners = [];
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: jest.fn((listener) =>
                        listeners.push(listener)
                    ),
                    removeListener: jest.fn(),
                },
            },
        };

        const readiness = new BackgroundServiceReadiness();
        const handler = new MessageHandler();
        handler.initialize(readiness);

        expect(listeners).toHaveLength(1);

        const sendResponse = jest.fn();
        const keepsChannelOpen = listeners[0](
            { action: MessageActions.PING, timestamp: 123 },
            {},
            sendResponse
        );

        expect(keepsChannelOpen).toBe(true);
        expect(sendResponse).not.toHaveBeenCalled();

        readiness.markReady();
        await readiness.waitUntilReady();
        await Promise.resolve();

        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ success: true, message: 'pong' })
        );
    });

    test.each([
        [
            'open request',
            { action: MessageActions.SIDEPANEL_OPEN, options: { force: true } },
        ],
        [
            'word selection',
            {
                action: MessageActions.SIDEPANEL_WORD_SELECTED,
                word: 'hello',
            },
        ],
    ])(
        'opens synchronously for a cold-start side-panel %s',
        async (_label, message) => {
            const listeners = [];
            let originalGestureActive = true;
            global.chrome = {
                runtime: {
                    onMessage: {
                        addListener: jest.fn((listener) =>
                            listeners.push(listener)
                        ),
                        removeListener: jest.fn(),
                    },
                },
                sidePanel: {
                    open: jest.fn(() => {
                        expect(originalGestureActive).toBe(true);
                        return Promise.resolve();
                    }),
                },
            };

            const sidePanelService = {
                openSidePanelImmediate: jest.fn((tabId) => {
                    const operation = chrome.sidePanel.open({ tabId });
                    return operation.then(() => ({ success: true }));
                }),
                forwardWordSelection: jest.fn(
                    async (_tabId, _message, openOperation) => {
                        await openOperation;
                    }
                ),
            };
            const readiness = new BackgroundServiceReadiness();
            const handler = new MessageHandler();
            handler.setServices({ sidePanelService });
            handler.initialize(readiness);
            const sendResponse = jest.fn();

            listeners[0](message, { tab: { id: 42 } }, sendResponse);
            originalGestureActive = false;

            expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });
            expect(
                sidePanelService.openSidePanelImmediate
            ).toHaveBeenCalledTimes(1);
            expect(sendResponse).not.toHaveBeenCalled();

            readiness.markReady();
            await readiness.waitUntilReady();
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(
                sidePanelService.openSidePanelImmediate
            ).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        }
    );

    test('suppresses a cold-start word open when persisted auto-open is false', async () => {
        const listeners = [];
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: jest.fn((listener) =>
                        listeners.push(listener)
                    ),
                    removeListener: jest.fn(),
                },
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(),
            },
            tabs: {
                get: jest.fn().mockResolvedValue({ id: 42, windowId: 1 }),
                sendMessage: jest.fn().mockResolvedValue({ success: true }),
            },
        };
        const readiness = new BackgroundServiceReadiness();
        const sidePanelService = new SidePanelService();
        const handler = new MessageHandler();
        handler.setServices({ sidePanelService });
        handler.initialize(readiness);
        const sendResponse = jest.fn();

        listeners[0](
            {
                action: MessageActions.SIDEPANEL_WORD_SELECTED,
                word: 'hello',
                options: { autoOpen: false, pauseVideo: false },
            },
            { tab: { id: 42 } },
            sendResponse
        );

        expect(chrome.sidePanel.open).not.toHaveBeenCalled();
        readiness.markReady();
        await readiness.waitUntilReady();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(chrome.sidePanel.open).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('preserves an exact context-type subset with single-type provider calls', async () => {
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: jest.fn(),
                    removeListener: jest.fn(),
                },
            },
        };
        const analyzeContext = jest.fn(async (_text, contextType) => ({
            success: true,
            analysis: {
                definition: `${contextType} definition`,
                detail: `${contextType} detail`,
            },
            contextType,
        }));
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({
            translationService: {},
            subtitleService: {},
            aiContextService: {
                isInitialized: true,
                analyzeContext,
            },
        });

        const response = await new Promise((resolve) => {
            handler.handleMessage(
                {
                    action: MessageActions.ANALYZE_CONTEXT,
                    text: 'hello',
                    contextTypes: ['linguistic'],
                },
                {},
                resolve
            );
        });

        expect(response.result.analysis.definition).toBe(
            'linguistic definition'
        );
        expect(analyzeContext).toHaveBeenLastCalledWith(
            'hello',
            'linguistic',
            expect.objectContaining({ requestedContextTypes: ['linguistic'] })
        );

        analyzeContext.mockClear();

        const combinedResponse = await new Promise((resolve) => {
            handler.handleMessage(
                {
                    action: MessageActions.ANALYZE_CONTEXT,
                    text: 'hello',
                    contextTypes: ['cultural', 'historical'],
                },
                {},
                resolve
            );
        });
        expect(
            analyzeContext.mock.calls.map(([, contextType]) => contextType)
        ).toEqual(['cultural', 'historical']);
        expect(combinedResponse).toEqual(
            expect.objectContaining({
                success: true,
                result: expect.objectContaining({
                    contextTypes: ['cultural', 'historical'],
                    analysis: {
                        definition: 'cultural definition',
                        cultural_analysis: { detail: 'cultural detail' },
                        historical_analysis: { detail: 'historical detail' },
                    },
                }),
            })
        );
    });

    test('rejects an explicitly empty context-type selection', async () => {
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: jest.fn(),
                    removeListener: jest.fn(),
                },
            },
        };
        const analyzeContext = jest.fn();
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({
            translationService: {},
            subtitleService: {},
            aiContextService: {
                isInitialized: true,
                analyzeContext,
            },
        });

        const response = await new Promise((resolve) => {
            handler.handleMessage(
                {
                    action: MessageActions.ANALYZE_CONTEXT,
                    text: 'hello',
                    contextTypes: [],
                },
                {},
                resolve
            );
        });

        expect(response).toEqual(
            expect.objectContaining({
                success: false,
                error: expect.stringMatching(/at least one context type/i),
            })
        );
        expect(analyzeContext).not.toHaveBeenCalled();
    });

    test('uses the existing all contract once for the canonical full set', async () => {
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: jest.fn(),
                    removeListener: jest.fn(),
                },
            },
        };
        const analyzeContext = jest.fn(async (_text, contextType) => ({
            success: true,
            contextType,
            analysis: { definition: 'full analysis' },
        }));
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({
            translationService: {},
            subtitleService: {},
            aiContextService: {
                isInitialized: true,
                analyzeContext,
            },
        });

        const response = await new Promise((resolve) => {
            handler.handleMessage(
                {
                    action: MessageActions.ANALYZE_CONTEXT,
                    text: 'hello',
                    contextTypes: ['cultural', 'historical', 'linguistic'],
                },
                {},
                resolve
            );
        });

        expect(analyzeContext).toHaveBeenCalledTimes(1);
        expect(analyzeContext).toHaveBeenCalledWith(
            'hello',
            'all',
            expect.objectContaining({
                requestedContextTypes: ['cultural', 'historical', 'linguistic'],
            })
        );
        expect(response.result).toEqual(
            expect.objectContaining({
                contextType: 'all',
                contextTypes: ['cultural', 'historical', 'linguistic'],
                analysis: { definition: 'full analysis' },
            })
        );
    });
});
