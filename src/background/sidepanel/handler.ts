import { browser } from 'wxt/browser';
import type { MessageRouter } from '@/messaging/router';
import {
    sidePanelSelectionSync,
    sidePanelWordSelected,
} from '@/messaging/contracts/selection';
import { SIDEPANEL_PORT_NAME } from '@/messaging/contracts/sidepanelPort';
import { classifyExtensionMessageSender } from '@/messaging/sender';
import type { SidePanelService } from './service';

/**
 * Wire the side panel service to the browser: runtime messages from content
 * scripts, port connections from panels, and tab lifecycle events. Must run
 * synchronously at worker start so no event is lost to a cold start.
 */
export function registerSidePanelHandlers(
    router: MessageRouter,
    service: SidePanelService
): void {
    router.handle(sidePanelSelectionSync, (request, sender) => ({
        success:
            sender.role === 'content' &&
            service.acceptSelectionSnapshot(sender, request.data),
    }));

    router.handle(sidePanelWordSelected, async (request, sender) => {
        if (sender.role !== 'content') {
            return { success: false };
        }
        return {
            success: await service.handleWordIntent(
                sender.tabId,
                request.options
            ),
        };
    });

    browser.runtime.onConnect.addListener((port) => {
        if (
            port.name !== SIDEPANEL_PORT_NAME ||
            classifyExtensionMessageSender(port.sender)?.role !== 'sidepanel'
        ) {
            port.disconnect();
            return;
        }
        service.handleConnect(port);
    });

    browser.tabs.onActivated.addListener((info) => {
        service.handleTabActivated(info);
    });
    browser.tabs.onRemoved.addListener((tabId) => {
        service.handleTabRemoved(tabId);
    });
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'loading') {
            service.handleTabNavigation(tabId);
        }
    });
}
