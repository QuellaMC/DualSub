import { jest } from '@jest/globals';
import { AIContextManager } from '../core/AIContextManager.js';
import { MessageActions } from '../../shared/constants/messageActions.js';

describe('AI context side-panel synchronization', () => {
    test('represents selection clearing as an empty authoritative sync', () => {
        global.chrome = {
            runtime: {
                sendMessage: jest.fn().mockResolvedValue({ success: true }),
            },
        };
        const manager = new AIContextManager('netflix');

        manager._handleSelectionCleared();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            selectedWords: [],
            reason: 'selection-cleared',
            source: 'content_script',
            timestamp: expect.any(Number),
        });
    });

    test('registers one runtime listener and removes it on destroy', async () => {
        const listeners = [];
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: jest.fn((listener) =>
                        listeners.push(listener)
                    ),
                    removeListener: jest.fn((listener) => {
                        const index = listeners.indexOf(listener);
                        if (index >= 0) listeners.splice(index, 1);
                    }),
                },
            },
        };
        const manager = new AIContextManager('netflix');

        manager._setupCrossPlatformCommunication();
        manager._setupCrossPlatformCommunication();
        expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);

        await manager.destroy();
        expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledTimes(
            1
        );
        expect(listeners).toHaveLength(0);
    });
});
