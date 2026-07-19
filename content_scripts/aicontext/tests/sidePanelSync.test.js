import { jest } from '@jest/globals';
import { AIContextManager } from '../core/AIContextManager.js';

describe('AI context legacy runtime ingress cleanup', () => {
    test('does not register the removed runtime listener', async () => {
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

        expect(manager._setupCrossPlatformCommunication).toBeUndefined();
        expect(chrome.runtime.onMessage.addListener).not.toHaveBeenCalled();

        await manager.destroy();
        expect(chrome.runtime.onMessage.removeListener).not.toHaveBeenCalled();
        expect(listeners).toHaveLength(0);
    });
});
