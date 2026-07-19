/**
 * Side Panel Service
 *
 * Manages Chrome Side Panel API integration for the AI Context feature.
 * Handles opening/closing the side panel, routing messages, and managing state.
 *
 * @author DualSub Extension
 * @version 2.5.0
 */

import Logger from '../../utils/logger.js';
import { configService } from '../../services/configService.js';
import { getDefaultValue } from '../../config/configSchema.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';

const BEHAVIOR_CONFIG_KEYS = [
    'sidePanelUseSidePanel',
    'sidePanelAutoOpen',
    'sidePanelAutoPauseVideo',
];

export class SidePanelService {
    constructor() {
        this.logger = Logger.create('SidePanelService', configService);
        this.initialized = false;
        this.activeConnections = new Map(); // Track connections from side panels
        this.tabStates = new Map(); // Track state per tab
        // New: window-scoped connection tracking
        this.activeConnectionsByWindow = new Map(); // Map<windowId, Map<panelInstanceId, port>>
        this.panelBindingByInstance = new Map(); // Map<panelInstanceId, { tabId, windowId }>
        this.panelPortByInstance = new Map(); // Map<panelInstanceId, port>
        this.serviceReadiness = null;
        this.listenersRegistered = false;
        this.onConnectListener = null;
        this.onTabActivatedListener = null;
        this.onTabRemovedListener = null;
        this.configUnsubscribe = null;
        this.defaultBehaviorConfig = Object.freeze(
            Object.fromEntries(
                BEHAVIOR_CONFIG_KEYS.map((key) => [key, getDefaultValue(key)])
            )
        );
        this.behaviorConfig = { ...this.defaultBehaviorConfig };
    }

    /**
     * Register Chrome event listeners synchronously for Manifest V3 cold starts.
     * Message processing is deferred behind the shared service-readiness gate.
     */
    registerListeners(serviceReadiness = null) {
        if (serviceReadiness) {
            this.serviceReadiness = serviceReadiness;
        }
        if (this.listenersRegistered) return;

        this.onConnectListener = (port) => {
            if (port.name === 'sidepanel') {
                this.handleSidePanelConnection(port);
            }
        };
        this.onTabActivatedListener = (activeInfo) => {
            void this.runAfterReady(
                () => this.handleTabActivated(activeInfo),
                'tab activation'
            );
        };
        this.onTabRemovedListener = (tabId) => {
            void this.runAfterReady(
                () => this.handleTabRemoved(tabId),
                'tab removal'
            );
        };

        chrome.runtime?.onConnect?.addListener(this.onConnectListener);
        chrome.tabs?.onActivated?.addListener(this.onTabActivatedListener);
        chrome.tabs?.onRemoved?.addListener(this.onTabRemovedListener);
        this.listenersRegistered = true;
    }

    removeListeners() {
        if (!this.listenersRegistered) return;
        chrome.runtime?.onConnect?.removeListener?.(this.onConnectListener);
        chrome.tabs?.onActivated?.removeListener?.(this.onTabActivatedListener);
        chrome.tabs?.onRemoved?.removeListener?.(this.onTabRemovedListener);
        this.onConnectListener = null;
        this.onTabActivatedListener = null;
        this.onTabRemovedListener = null;
        this.listenersRegistered = false;
    }

    async runAfterReady(callback, operation) {
        try {
            if (this.serviceReadiness && !this.serviceReadiness.isReady()) {
                await this.serviceReadiness.waitUntilReady();
            }
            return await callback();
        } catch (error) {
            this.logger.error(`Side panel ${operation} failed`, error);
            return undefined;
        }
    }

    applyBehaviorConfig(changes = {}) {
        for (const key of BEHAVIOR_CONFIG_KEYS) {
            if (Object.prototype.hasOwnProperty.call(changes, key)) {
                this.behaviorConfig[key] =
                    changes[key] ?? this.defaultBehaviorConfig[key];
            }
        }
    }

    async refreshBehaviorConfig() {
        const config = await configService.getMultiple(BEHAVIOR_CONFIG_KEYS);
        this.applyBehaviorConfig(config);
        return this.behaviorConfig;
    }

    bindPort(port, tabId, windowId, panelInstanceId = null) {
        for (const [mappedTabId, mappedPort] of this.activeConnections) {
            if (mappedPort === port && mappedTabId !== tabId) {
                this.activeConnections.delete(mappedTabId);
            }
        }
        if (!panelInstanceId) {
            if (typeof tabId === 'number') {
                this.activeConnections.set(tabId, port);
            }
            return;
        }

        const previousBinding =
            this.panelBindingByInstance.get(panelInstanceId);
        const previousPort = this.panelPortByInstance.get(panelInstanceId);
        if (previousBinding && previousPort) {
            if (
                this.activeConnections.get(previousBinding.tabId) ===
                previousPort
            ) {
                this.activeConnections.delete(previousBinding.tabId);
            }
            const previousWindowMap = this.activeConnectionsByWindow.get(
                previousBinding.windowId
            );
            if (previousWindowMap?.get(panelInstanceId) === previousPort) {
                previousWindowMap.delete(panelInstanceId);
                if (previousWindowMap.size === 0) {
                    this.activeConnectionsByWindow.delete(
                        previousBinding.windowId
                    );
                }
            }
        }

        if (typeof tabId === 'number') {
            this.activeConnections.set(tabId, port);
        }

        this.panelBindingByInstance.set(panelInstanceId, { tabId, windowId });
        this.panelPortByInstance.set(panelInstanceId, port);
        if (typeof windowId === 'number') {
            if (!this.activeConnectionsByWindow.has(windowId)) {
                this.activeConnectionsByWindow.set(windowId, new Map());
            }
            this.activeConnectionsByWindow
                .get(windowId)
                .set(panelInstanceId, port);
        }
    }

    unbindPort(port, panelInstanceId) {
        if (
            !panelInstanceId ||
            this.panelPortByInstance.get(panelInstanceId) !== port
        ) {
            return;
        }

        const binding = this.panelBindingByInstance.get(panelInstanceId);
        const windowMap = this.activeConnectionsByWindow.get(binding?.windowId);
        if (windowMap?.get(panelInstanceId) === port) {
            windowMap.delete(panelInstanceId);
            if (windowMap.size === 0) {
                this.activeConnectionsByWindow.delete(binding.windowId);
            }
        }
        this.panelBindingByInstance.delete(panelInstanceId);
        this.panelPortByInstance.delete(panelInstanceId);
    }

    /**
     * Initialize the side panel service
     */
    async initialize(serviceReadiness = null) {
        this.registerListeners(serviceReadiness);

        if (this.initialized) {
            return;
        }

        try {
            this.logger.info('Initializing Side Panel Service');

            // Check if Side Panel API is available (Chrome 116+ for programmatic open)
            if (typeof chrome.sidePanel === 'undefined') {
                this.logger.warn(
                    'Side Panel API not available (Chrome 116+ required)'
                );
                this.initialized = false;
                return;
            }

            try {
                await this.refreshBehaviorConfig();
            } catch (error) {
                this.logger.warn(
                    'Failed to load side panel behavior; using schema defaults',
                    { error: error.message }
                );
            }
            if (!this.configUnsubscribe) {
                this.configUnsubscribe = configService.onChanged((changes) => {
                    this.applyBehaviorConfig(changes);
                });
            }

            this.initialized = true;
            this.logger.info('Side Panel Service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Side Panel Service', error);
            throw error;
        }
    }

    destroy() {
        this.removeListeners();
        if (this.configUnsubscribe) {
            this.configUnsubscribe();
            this.configUnsubscribe = null;
        }
        this.activeConnections.clear();
        this.activeConnectionsByWindow.clear();
        this.panelBindingByInstance.clear();
        this.panelPortByInstance.clear();
        this.tabStates.clear();
        this.initialized = false;
    }

    /**
     * Handle new connection from side panel
     */
    handleSidePanelConnection(port) {
        let tabId = port.sender?.tab?.id ?? null;
        let windowId = port.sender?.tab?.windowId ?? null;
        let panelInstanceId = null;
        let disconnected = false;

        if (tabId != null) {
            this.logger.info('Side panel connected', { tabId });
            this.activeConnections.set(tabId, port);
        } else {
            this.logger.warn(
                'Side panel connection without tab ID (awaiting register message)'
            );
        }

        // Handle messages from side panel
        port.onMessage.addListener((message) => {
            void this.runAfterReady(async () => {
                if (disconnected) return;

                // Update tabId once the side panel sends an explicit register payload
                if (message?.action === MessageActions.SIDEPANEL_REGISTER) {
                    const claimedTabId = message?.data?.tabId;
                    const claimedWindowId = message?.data?.windowId ?? null;
                    const claimedInstanceId =
                        message?.data?.panelInstanceId ?? null;
                    if (typeof claimedTabId === 'number') {
                        tabId = claimedTabId;
                    }
                    if (typeof claimedWindowId === 'number') {
                        windowId = claimedWindowId;
                    }
                    if (typeof claimedInstanceId === 'string') {
                        panelInstanceId = claimedInstanceId;
                    }
                    this.bindPort(port, tabId, windowId, panelInstanceId);
                }

                await this.handleSidePanelMessage(message, port, tabId);
            }, 'message handling');
        });

        // Handle disconnection
        port.onDisconnect.addListener(() => {
            disconnected = true;
            try {
                this.unbindPort(port, panelInstanceId);
            } catch (_) {}
            if (tabId != null && this.activeConnections.get(tabId) === port) {
                this.logger.info('Side panel disconnected', { tabId });
                this.activeConnections.delete(tabId);
            } else {
                this.logger.info(
                    'Side panel disconnected without owning the current tab mapping',
                    { tabId }
                );
            }
        });
    }

    /**
     * Handle messages from side panel
     */
    async handleSidePanelMessage(message, port, tabId) {
        const { action, data } = message;

        this.logger.debug('Message from side panel', { action, tabId });

        try {
            switch (action) {
                case MessageActions.SIDEPANEL_PAUSE_VIDEO:
                    await this.pauseVideo(tabId);
                    break;

                case MessageActions.SIDEPANEL_GET_STATE: {
                    const state = this.tabStates.get(tabId) || {};
                    port.postMessage({
                        action: MessageActions.SIDEPANEL_UPDATE_STATE,
                        data: state,
                    });
                    break;
                }

                case MessageActions.SIDEPANEL_UPDATE_STATE:
                    this.updateTabState(tabId, data);
                    break;

                case MessageActions.SIDEPANEL_SELECTION_SYNC:
                    // Accept selection sync from side panel via long-lived port.
                    // tabId is resolved from the registered mapping/connection rather than sender.tab.
                    await this.forwardSelectionSync(tabId, data ?? {});
                    break;

                case MessageActions.SIDEPANEL_REGISTER:
                    this.logger.info('Side panel register request', {
                        tabIdFromMessage: data?.tabId,
                    });
                    try {
                        const claimedTabId = data?.tabId;
                        if (!claimedTabId || typeof claimedTabId !== 'number') {
                            this.logger.warn(
                                'Invalid register payload (missing tabId)'
                            );
                            break;
                        }
                        // Initialize state for this tab if missing
                        let st = this.tabStates.get(claimedTabId);

                        // If no state exists, try to fetch it from the content script to ensure sync
                        if (
                            !st ||
                            (!st.selectedWords && !st.pendingWordSelection)
                        ) {
                            try {
                                this.logger.debug(
                                    'Fetching initial state from content script',
                                    { tabId: claimedTabId }
                                );
                                const response = await chrome.tabs.sendMessage(
                                    claimedTabId,
                                    {
                                        action: MessageActions.SIDEPANEL_GET_STATE,
                                        source: 'background',
                                    }
                                );

                                if (
                                    response &&
                                    response.success &&
                                    Array.isArray(response.selectedWords)
                                ) {
                                    this.updateTabState(claimedTabId, {
                                        selectedWords: response.selectedWords,
                                        sourceLanguage: response.sourceLanguage,
                                    });
                                    st = this.tabStates.get(claimedTabId);
                                }
                            } catch (err) {
                                // Content script might not be ready or supported on this page
                                this.logger.debug(
                                    'Failed to fetch initial state from content script',
                                    { tabId: claimedTabId, error: err.message }
                                );
                            }
                        }

                        // Deliver stored selection state with priority, then any pending single-word fallback.
                        if (st) {
                            const selectedWordsFromState = Array.isArray(
                                st.selectedWords
                            )
                                ? st.selectedWords
                                : [];
                            if (selectedWordsFromState.length > 0) {
                                // Prefer authoritative stored selection
                                port.postMessage({
                                    action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                                    data: {
                                        selectedWords: selectedWordsFromState,
                                        reason: 'state-sync-on-register',
                                        tabId: claimedTabId,
                                    },
                                });

                                // Clear any obsolete pendingWordSelection
                                if (st.pendingWordSelection) {
                                    const newState = { ...st };
                                    delete newState.pendingWordSelection;
                                    this.tabStates.set(claimedTabId, newState);
                                }
                            } else if (st.pendingWordSelection) {
                                // Fallback to pending single-word selection if no stored array is present
                                const pending = st.pendingWordSelection;
                                const selectedWords =
                                    Array.isArray(pending?.selectedWords) &&
                                    pending.selectedWords.length > 0
                                        ? pending.selectedWords
                                        : pending?.word
                                          ? [pending.word]
                                          : [];

                                port.postMessage({
                                    action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                                    data: {
                                        selectedWords,
                                        reason:
                                            pending?.reason ||
                                            'initial-pending-selection',
                                        tabId: claimedTabId,
                                    },
                                });

                                // Persist and clear pending after delivery
                                const newState = { ...st };
                                delete newState.pendingWordSelection;
                                if (selectedWords.length > 0) {
                                    newState.selectedWords = selectedWords;
                                }
                                this.tabStates.set(claimedTabId, newState);
                            } else {
                                // Nothing to sync
                                port.postMessage({
                                    action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                                    data: {
                                        selectedWords: [],
                                        reason: 'empty-state-on-register',
                                        tabId: claimedTabId,
                                    },
                                });
                            }
                        } else {
                            // No state found even after fetch attempt
                            port.postMessage({
                                action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                                data: {
                                    selectedWords: [],
                                    reason: 'no-state-on-register',
                                    tabId: claimedTabId,
                                },
                            });
                        }
                    } catch (err) {
                        this.logger.error(
                            'Failed to handle side panel register',
                            err
                        );
                    }
                    break;

                default:
                    this.logger.warn('Unknown side panel message action', {
                        action,
                    });
            }
        } catch (error) {
            this.logger.error('Error handling side panel message', error, {
                action,
                tabId,
            });
        }
    }

    /**
     * Open side panel for a specific tab
     */
    async openSidePanel(tabId, options = {}) {
        try {
            await this.refreshBehaviorConfig();
            return await this.openSidePanelImmediate(tabId, options);
        } catch (error) {
            this.logger.error('Failed to open side panel', error, { tabId });
            return { success: false, error: error.message };
        }
    }

    /**
     * Open side panel immediately (attempt to preserve user gesture)
     */
    async openSidePanelImmediate(tabId, options = {}) {
        try {
            const config = this.behaviorConfig;
            if (!config.sidePanelUseSidePanel) {
                this.logger.debug('Side panel disabled in settings');
                return { success: false, reason: 'disabled' };
            }

            const shouldAutoOpen = options.autoOpen ?? config.sidePanelAutoOpen;
            if (!shouldAutoOpen && !options.force) {
                this.logger.debug('Auto-open disabled');
                return { success: false, reason: 'auto-open-disabled' };
            }

            // Check API availability
            if (typeof chrome.sidePanel?.open !== 'function') {
                this.logger.warn('Side Panel API not available');
                return { success: false, reason: 'api-unavailable' };
            }

            // Attempt to open immediately without awaiting settings to preserve user gesture
            await chrome.sidePanel.open({ tabId });
            this.logger.info('Side panel opened (immediate)', { tabId });

            // Notify any existing side panel in the same window to switch binding
            // This ensures the UI updates to the target tab even if 'follow active tab' is disabled
            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab && typeof tab.windowId === 'number') {
                    const winMap = this.activeConnectionsByWindow.get(
                        tab.windowId
                    );
                    if (winMap) {
                        for (const port of winMap.values()) {
                            try {
                                port.postMessage({
                                    action: 'sidePanelForceBindTab',
                                    data: { tabId, windowId: tab.windowId },
                                });
                            } catch (_) {}
                        }
                    }
                }
            } catch (bindingError) {
                this.logger.warn('Failed to force bind side panel', {
                    error: bindingError.message,
                    tabId,
                });
            }

            // Apply requested options without config wait
            const shouldPause =
                options.pauseVideo ?? config.sidePanelAutoPauseVideo;
            if (shouldPause) {
                await this.pauseVideo(tabId);
            }

            return { success: true };
        } catch (error) {
            this.logger.error('Failed to open side panel (immediate)', error, {
                tabId,
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Pause video in the tab
     */
    async pauseVideo(tabId) {
        try {
            await chrome.tabs.sendMessage(tabId, {
                action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
                source: 'background',
            });

            this.logger.debug('Video pause command sent', { tabId });
        } catch (error) {
            this.logger.error('Failed to pause video', error, { tabId });
        }
    }

    /**
     * Forward word selection to side panel
     */
    async forwardWordSelection(tabId, wordData, openOperation = null) {
        // Ensure the side panel is open for this tab
        await (openOperation || this.openSidePanelImmediate(tabId));

        // NOTE: We do NOT update the selectedWords state here.
        // The content script is the source of truth and sends a separate
        // SIDEPANEL_SELECTION_SYNC message with the authoritative list.
        // Updating state here based on a single word toggle causes race conditions
        // and "deselection jump" bugs where words are re-added.

        this.logger.debug(
            'Word selection event received (state update deferred to sync)',
            {
                tabId,
                wordLength:
                    typeof wordData?.word === 'string'
                        ? wordData.word.length
                        : 0,
            }
        );
    }

    /**
     * Forward selection synchronization (e.g., subtitle change clears selection)
     */
    async forwardSelectionSync(tabId, payload = {}) {
        const port = this.activeConnections.get(tabId);
        const incomingWords = (
            Array.isArray(payload?.selectedWords) ? payload.selectedWords : []
        )
            .map((w) => (typeof w === 'string' ? w.trim() : ''))
            .filter((w) => w.length > 0);

        // Each array entry represents one selected DOM occurrence. Equal words
        // must remain distinct and in subtitle order.
        const normalizedWords = incomingWords;

        const state = this.tabStates.get(tabId) || {};
        state.selectedWords = normalizedWords;
        delete state.pendingWordSelection;
        this.tabStates.set(tabId, state);

        if (port) {
            try {
                port.postMessage({
                    action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                    data: {
                        selectedWords: normalizedWords,
                        reason: payload.reason || 'unknown',
                        tabId,
                    },
                });
                this.logger.debug('Selection sync forwarded to side panel', {
                    tabId,
                    count: normalizedWords.length,
                });
            } catch (err) {
                this.logger.error('Failed to forward selection sync', err, {
                    tabId,
                });
            }
        } else {
            // Keep state for a later window-scoped registration. Broadcasting
            // here can leak one window's selection into another window's panel.
            this.logger.debug('Selection sync queued for panel registration', {
                tabId,
                count: normalizedWords.length,
            });
        }
    }

    /**
     * Update tab state
     */
    updateTabState(tabId, state) {
        const existingState = this.tabStates.get(tabId) || {};
        this.tabStates.set(tabId, { ...existingState, ...state });

        this.logger.debug('Tab state updated', { tabId });
    }

    /**
     * Handle tab activation
     */
    handleTabActivated(activeInfo) {
        const { tabId, windowId } = activeInfo;
        this.logger.debug('Tab activated', { tabId, windowId });

        // Side panels are window-scoped. A tab activation must never rebind a
        // panel that belongs to another browser window.
        if (
            typeof windowId === 'number' &&
            this.activeConnectionsByWindow.has(windowId)
        ) {
            const winMap = this.activeConnectionsByWindow.get(windowId);
            for (const port of winMap.values()) {
                try {
                    port.postMessage({
                        action: 'tabActivated',
                        data: { tabId, windowId },
                    });
                } catch (error) {
                    this.logger.warn(
                        'Failed to notify a side panel of tab activation',
                        {
                            error: error.message,
                        }
                    );
                }
            }
        }
    }

    /**
     * Handle tab removal
     */
    handleTabRemoved(tabId) {
        this.logger.debug('Tab removed', { tabId });
        this.activeConnections.delete(tabId);
        this.tabStates.delete(tabId);
    }

    /**
     * Check if side panel is supported
     */
    isSidePanelSupported() {
        return typeof chrome.sidePanel !== 'undefined';
    }

    /**
     * Get tab state
     */
    getTabState(tabId) {
        return this.tabStates.get(tabId) || {};
    }
}

// Create and export singleton instance
export const sidePanelService = new SidePanelService();
