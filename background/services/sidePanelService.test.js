import { jest } from '@jest/globals';
import { SidePanelService } from './sidePanelService.js';
import { BackgroundServiceReadiness } from '../serviceReadiness.js';
import { configService } from '../../services/configService.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';

function createChromeEvent() {
    const listeners = [];
    return {
        addListener: jest.fn((listener) => listeners.push(listener)),
        removeListener: jest.fn((listener) => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
        }),
        emit: (...args) => listeners.forEach((listener) => listener(...args)),
        listeners,
    };
}

function createPort(tabId, windowId = 1) {
    const onMessage = createChromeEvent();
    const onDisconnect = createChromeEvent();
    return {
        name: 'sidepanel',
        sender: { tab: { id: tabId, windowId } },
        onMessage,
        onDisconnect,
        postMessage: jest.fn(),
    };
}

describe('SidePanelService connection ownership', () => {
    test('disconnecting a superseded port preserves the current tab mapping', () => {
        const service = new SidePanelService();
        const oldPort = createPort(7);
        const currentPort = createPort(7);

        service.handleSidePanelConnection(oldPort);
        service.handleSidePanelConnection(currentPort);
        oldPort.onDisconnect.emit();

        expect(service.activeConnections.get(7)).toBe(currentPort);
    });

    test('disconnecting an old instance binding preserves its replacement', async () => {
        const service = new SidePanelService();
        const oldPort = createPort(7, 1);
        const currentPort = createPort(8, 2);

        service.handleSidePanelConnection(oldPort);
        oldPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1, panelInstanceId: 'panel-1' },
        });
        await Promise.resolve();

        service.handleSidePanelConnection(currentPort);
        currentPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 2, panelInstanceId: 'panel-1' },
        });
        await Promise.resolve();

        oldPort.onDisconnect.emit();

        expect(service.panelBindingByInstance.get('panel-1')).toEqual({
            tabId: 8,
            windowId: 2,
        });
        expect(service.activeConnectionsByWindow.get(2)?.get('panel-1')).toBe(
            currentPort
        );
    });

    test('captures a side-panel connection before service readiness settles', () => {
        const onConnect = createChromeEvent();
        global.chrome = {
            runtime: { onConnect },
            tabs: {
                onActivated: createChromeEvent(),
                onRemoved: createChromeEvent(),
            },
            sidePanel: {},
        };

        const service = new SidePanelService();
        const readiness = new BackgroundServiceReadiness();
        service.registerListeners(readiness);

        const port = createPort(11);
        onConnect.emit(port);

        expect(port.onMessage.listeners).toHaveLength(1);
    });

    test('preserves repeated selected-word occurrences in DOM order', async () => {
        const service = new SidePanelService();
        const port = createPort(7);
        service.activeConnections.set(7, port);

        await service.forwardSelectionSync(7, {
            selectedWords: ['very', 'very', 'good'],
            reason: 'word-click',
        });

        expect(service.tabStates.get(7).selectedWords).toEqual([
            'very',
            'very',
            'good',
        ]);
        expect(port.postMessage).toHaveBeenCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                selectedWords: ['very', 'very', 'good'],
                reason: 'word-click',
                tabId: 7,
            },
        });
    });

    test('does not send another window activation to an existing panel', () => {
        const service = new SidePanelService();
        const firstWindowPort = createPort(7, 1);
        service.bindPort(firstWindowPort, 7, 1, 'panel-window-1');

        service.handleTabActivated({ tabId: 22, windowId: 2 });

        expect(firstWindowPort.postMessage).not.toHaveBeenCalled();
        expect(service.panelBindingByInstance.get('panel-window-1')).toEqual({
            tabId: 7,
            windowId: 1,
        });
    });

    test('notifies only panels registered to the activated window', () => {
        const service = new SidePanelService();
        const firstWindowPort = createPort(7, 1);
        const secondWindowPort = createPort(21, 2);
        service.bindPort(firstWindowPort, 7, 1, 'panel-window-1');
        service.bindPort(secondWindowPort, 21, 2, 'panel-window-2');

        service.handleTabActivated({ tabId: 22, windowId: 2 });

        expect(firstWindowPort.postMessage).not.toHaveBeenCalled();
        expect(secondWindowPort.postMessage).toHaveBeenCalledWith({
            action: 'tabActivated',
            data: { tabId: 22, windowId: 2 },
        });
    });

    test('queues an unmapped tab selection without broadcasting across windows', async () => {
        const service = new SidePanelService();
        const firstWindowPort = createPort(7, 1);
        const secondWindowPort = createPort(21, 2);
        service.bindPort(firstWindowPort, 7, 1, 'panel-window-1');
        service.bindPort(secondWindowPort, 21, 2, 'panel-window-2');

        await service.forwardSelectionSync(22, {
            selectedWords: ['private', 'selection'],
            reason: 'word-click',
        });

        expect(firstWindowPort.postMessage).not.toHaveBeenCalled();
        expect(secondWindowPort.postMessage).not.toHaveBeenCalled();
        expect(service.tabStates.get(22)).toMatchObject({
            selectedWords: ['private', 'selection'],
        });
    });
});

describe('SidePanelService word-click behavior', () => {
    test('does not open or pause when automatic opening is disabled', async () => {
        global.chrome = {
            runtime: { onConnect: createChromeEvent() },
            tabs: {
                onActivated: createChromeEvent(),
                onRemoved: createChromeEvent(),
                sendMessage: jest.fn().mockResolvedValue({ success: true }),
                get: jest.fn().mockResolvedValue({ id: 17, windowId: 2 }),
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(),
            },
        };
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: false,
            sidePanelAutoPauseVideo: false,
        });
        jest.spyOn(configService, 'onChanged').mockReturnValue(() => {});

        const service = new SidePanelService();
        await service.initialize();
        await service.forwardWordSelection(17, { word: 'hello' });

        expect(chrome.sidePanel.open).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('uses the visible setting even when a stale legacy flag is false', async () => {
        global.chrome = {
            runtime: { onConnect: createChromeEvent() },
            tabs: {
                onActivated: createChromeEvent(),
                onRemoved: createChromeEvent(),
                sendMessage: jest.fn().mockResolvedValue({ success: true }),
                get: jest.fn().mockResolvedValue({ id: 19, windowId: 2 }),
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(),
            },
        };
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            sidePanelEnabled: false,
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        });
        jest.spyOn(configService, 'onChanged').mockReturnValue(() => {});

        const service = new SidePanelService();
        await service.initialize();
        await service.forwardWordSelection(19, { word: 'hello' });

        expect(chrome.sidePanel.open).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('honors gesture-time auto-open and auto-pause snapshots', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn().mockResolvedValue({ success: true }),
                get: jest.fn().mockResolvedValue({ id: 23, windowId: 2 }),
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(),
            },
        };
        const service = new SidePanelService();

        const suppressed = await service.openSidePanelImmediate(23, {
            autoOpen: false,
            pauseVideo: false,
        });
        expect(suppressed).toEqual({
            success: false,
            reason: 'auto-open-disabled',
        });
        expect(chrome.sidePanel.open).not.toHaveBeenCalled();

        await service.openSidePanelImmediate(23, {
            autoOpen: true,
            pauseVideo: false,
        });
        expect(chrome.sidePanel.open).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
});
