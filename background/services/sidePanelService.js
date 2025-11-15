/**
 * Side Panel Service
 * 
 * Manages Chrome Side Panel API integration for the AI Context feature.
 * Handles opening/closing the side panel, routing messages, and managing state.
 * 
 * @author DualSub Extension
 * @version 2.0.0
 */

import Logger from '../../utils/logger.js';
import { configService } from '../../services/configService.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';

class SidePanelService {
    constructor() {
        this.logger = Logger.create('SidePanelService', configService);
        this.initialized = false;
        this.activeConnections = new Map(); // Track connections from side panels
        this.tabStates = new Map(); // Track state per tab
        // New: window-scoped connection tracking
        this.activeConnectionsByWindow = new Map(); // Map<windowId, Map<panelInstanceId, port>>
        this.panelBindingByInstance = new Map(); // Map<panelInstanceId, { tabId, windowId }>
    }

    /**
     * Initialize the side panel service
     */
    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            this.logger.info('Initializing Side Panel Service');

            // Check if Side Panel API is available (Chrome 114+)
            if (typeof chrome.sidePanel === 'undefined') {
                this.logger.warn('Side Panel API not available (Chrome 114+ required)');
                this.initialized = false;
                return;
            }

            // Listen for connections from side panel
            chrome.runtime.onConnect.addListener((port) => {
                if (port.name === 'sidepanel') {
                    this.handleSidePanelConnection(port);
                }
            });

            // Listen for tab updates to manage state
            chrome.tabs.onActivated.addListener((activeInfo) => {
                this.handleTabActivated(activeInfo);
            });

            chrome.tabs.onRemoved.addListener((tabId) => {
                this.handleTabRemoved(tabId);
            });

            this.initialized = true;
            this.logger.info('Side Panel Service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Side Panel Service', error);
            throw error;
        }
    }

    /**
     * Handle new connection from side panel
     */
    handleSidePanelConnection(port) {
        let tabId = port.sender?.tab?.id ?? null;
        let windowId = port.sender?.tab?.windowId ?? null;
        let panelInstanceId = null;

        if (tabId != null) {
            this.logger.info('Side panel connected', { tabId });
            this.activeConnections.set(tabId, port);
        } else {
            this.logger.warn('Side panel connection without tab ID (awaiting register message)');
        }

        const postToTab = (tid, message) => {
            try {
                const p = this.activeConnections.get(tid);
                if (!p) return;
                p.postMessage(message);
            } catch (err) {
                this.logger.error('Failed to post to side panel', err, { tabId: tid, action: message?.action });
            }
        };

        // Handle messages from side panel
        port.onMessage.addListener((message) => {
            // Update tabId once the side panel sends an explicit register payload
            if (message?.action === MessageActions.SIDEPANEL_REGISTER) {
                const claimedTabId = message?.data?.tabId;
                const claimedWindowId = message?.data?.windowId ?? null;
                const claimedInstanceId = message?.data?.panelInstanceId ?? null;
                if (typeof claimedTabId === 'number') {
                    tabId = claimedTabId;
                }
                if (typeof claimedWindowId === 'number') {
                    windowId = claimedWindowId;
                }
                if (typeof claimedInstanceId === 'string') {
                    panelInstanceId = claimedInstanceId;
                }
                // Remove any previous mappings that point to this same port
                try {
                    for (const [tid, p] of this.activeConnections.entries()) {
                        if (p === port && tid !== tabId) {
                            this.activeConnections.delete(tid);
                        }
                    }
                } catch (_) {}
                if (typeof tabId === 'number') {
                    this.activeConnections.set(tabId, port);
                }
                // Track window-scoped connection
                if (panelInstanceId) {
                    this.panelBindingByInstance.set(panelInstanceId, { tabId, windowId });
                    if (typeof windowId === 'number') {
                        if (!this.activeConnectionsByWindow.has(windowId)) {
                            this.activeConnectionsByWindow.set(windowId, new Map());
                        }
                        const winMap = this.activeConnectionsByWindow.get(windowId);
                        winMap.set(panelInstanceId, port);
                    }
                }
            }

            this.handleSidePanelMessage(message, port, tabId);
        });

        // Handle disconnection
        port.onDisconnect.addListener(() => {
            try {
                if (panelInstanceId && typeof windowId === 'number') {
                    const winMap = this.activeConnectionsByWindow.get(windowId);
                    if (winMap) {
                        winMap.delete(panelInstanceId);
                        if (winMap.size === 0) {
                            this.activeConnectionsByWindow.delete(windowId);
                        }
                    }
                    this.panelBindingByInstance.delete(panelInstanceId);
                }
            } catch (_) {}
            if (tabId != null) {
                this.logger.info('Side panel disconnected', { tabId });
                this.activeConnections.delete(tabId);
            } else {
                this.logger.info('Side panel disconnected before registration');
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

                case MessageActions.SIDEPANEL_RESUME_VIDEO:
                    await this.resumeVideo(tabId);
                    break;

                case MessageActions.SIDEPANEL_GET_STATE:
                    const state = this.tabStates.get(tabId) || {};
                    port.postMessage({
                        action: MessageActions.SIDEPANEL_UPDATE_STATE,
                        data: state,
                    });
                    break;

                case MessageActions.SIDEPANEL_UPDATE_STATE:
                    this.updateTabState(tabId, data);
                    break;

                case MessageActions.SIDEPANEL_SELECTION_SYNC:
                    // Accept selection sync from side panel via long-lived port.
                    // tabId is resolved from the registered mapping/connection rather than sender.tab.
                    await this.forwardSelectionSync(tabId, data ?? {});
                    break;
                case MessageActions.SIDEPANEL_SCOPE_CHANGED:
                    // Advisory: scope policy changed in the panel; currently no-op at service layer
                    this.logger.debug('Scope policy changed (advisory)', { tabId, details: data });
                    break;
                case MessageActions.SIDEPANEL_APPLY_SCOPE_BUCKET:
                    // Apply a stored bucket to the bound tab by updating content highlights
                    try {
                        const words = Array.isArray(data?.selectedWords) ? data.selectedWords : [];
                        if (typeof tabId === 'number') {
                            await chrome.tabs.sendMessage(tabId, {
                                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                                data: { selectedWords: words, clearSelection: true },
                                source: 'background',
                            });
                            // Update authoritative selection state
                            await this.forwardSelectionSync(tabId, { selectedWords: words, reason: 'apply-scope-bucket' });
                        }
                    } catch (err) {
                        this.logger.warn('Failed to apply scope bucket', { error: err?.message, tabId });
                    }
                    break;

                case MessageActions.SIDEPANEL_REGISTER:
                    this.logger.info('Side panel register request', { tabIdFromMessage: data?.tabId });
                    try {
                        const claimedTabId = data?.tabId;
                        if (!claimedTabId || typeof claimedTabId !== 'number') {
                            this.logger.warn('Invalid register payload (missing tabId)');
                            break;
                        }
                        // Map this port to the provided tabId, removing prior mappings for this port
                        try {
                            for (const [tid, p] of this.activeConnections.entries()) {
                                if (p === port && tid !== claimedTabId) {
                                    this.activeConnections.delete(tid);
                                }
                            }
                        } catch (_) {}
                        this.activeConnections.set(claimedTabId, port);

                        // Deliver stored selection state with priority, then any pending single-word fallback.
                        const st = this.tabStates.get(claimedTabId);
                        if (st) {
                            const selectedWordsFromState = Array.isArray(st.selectedWords) ? st.selectedWords : [];
                            if (selectedWordsFromState.length > 0) {
                                // Prefer authoritative stored selection
                                setTimeout(() => {
                                    const p = this.activeConnections.get(claimedTabId);
                                    if (!p) return; // connection dropped
                                    try {
                                        p.postMessage({
                                            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                                            data: {
                                                selectedWords: selectedWordsFromState,
                                                reason: 'state-sync-on-register',
                                                tabId: claimedTabId,
                                            },
                                        });
                                    } catch (err) {
                                        this.logger.error('Failed to deliver stored selection on register', err, { tabId: claimedTabId, errorMessage: err.message });
                                    }
                                }, 40);
                                // Clear any obsolete pendingWordSelection
                                if (st.pendingWordSelection) {
                                    const newState = { ...st };
                                    delete newState.pendingWordSelection;
                                    this.tabStates.set(claimedTabId, newState);
                                }
                            } else if (st.pendingWordSelection) {
                                // Fallback to pending single-word selection if no stored array is present
                                const pending = st.pendingWordSelection;
                                setTimeout(() => {
                                    const p = this.activeConnections.get(claimedTabId);
                                    if (!p) return;
                                    try {
                                        const selectedWords = Array.isArray(pending?.selectedWords) && pending.selectedWords.length > 0
                                            ? pending.selectedWords
                                            : pending?.word
                                                ? [pending.word]
                                                : [];
                                        p.postMessage({
                                            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                                            data: {
                                                selectedWords,
                                                reason: pending?.reason || 'initial-pending-selection',
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
                                    } catch (err) {
                                        this.logger.error('Failed to deliver pending selection on register', err, { tabId: claimedTabId, errorMessage: err.message });
                                    }
                                }, 60);
                            } else {
                                // Nothing to sync
                                setTimeout(() => {
                                    const p = this.activeConnections.get(claimedTabId);
                                    if (!p) return;
                                    try {
                                        p.postMessage({
                                            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                                            data: { selectedWords: [], reason: 'empty-state-on-register', tabId: claimedTabId },
                                        });
                                    } catch (err) {
                                        this.logger.error('Failed to deliver empty selection on register', err, { tabId: claimedTabId, errorMessage: err.message });
                                    }
                                }, 40);
                            }
                        }
                    } catch (err) {
                        this.logger.error('Failed to handle side panel register', err);
                    }
                    break;

                default:
                    this.logger.warn('Unknown side panel message action', { action });
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
            const config = await configService.getMultiple([
                'sidePanelUseSidePanel',
                'sidePanelEnabled',
                'sidePanelAutoOpen',
                'sidePanelAutoPauseVideo',
            ]);

            // Check if side panel is enabled
            if (!config.sidePanelEnabled || !config.sidePanelUseSidePanel) {
                this.logger.debug('Side panel disabled in settings');
                return { success: false, reason: 'disabled' };
            }

            if (!config.sidePanelAutoOpen && !options.force) {
                this.logger.debug('Auto-open disabled');
                return { success: false, reason: 'auto-open-disabled' };
            }

            // Check API availability
            if (typeof chrome.sidePanel === 'undefined') {
                this.logger.warn('Side Panel API not available');
                return { success: false, reason: 'api-unavailable' };
            }

            // Open side panel
            await chrome.sidePanel.open({ tabId });

            this.logger.info('Side panel opened', { tabId });

            // Auto-pause video if enabled
            if (config.sidePanelAutoPauseVideo || options.pauseVideo) {
                await this.pauseVideo(tabId);
            }

            return { success: true };
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
            // Check API availability
            if (typeof chrome.sidePanel === 'undefined') {
                this.logger.warn('Side Panel API not available');
                return { success: false, reason: 'api-unavailable' };
            }

            // Attempt to open immediately without awaiting settings to preserve user gesture
            await chrome.sidePanel.open({ tabId });
            this.logger.info('Side panel opened (immediate)', { tabId });

            // Apply requested options without config wait
            if (options.pauseVideo) {
                await this.pauseVideo(tabId);
            }

            return { success: true };
        } catch (error) {
            this.logger.error('Failed to open side panel (immediate)', error, { tabId });
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
     * Resume video in the tab
     */
    async resumeVideo(tabId) {
        try {
            const autoResume = await configService.get('sidePanelAutoResumeVideo');

            if (autoResume) {
                await chrome.tabs.sendMessage(tabId, {
                    action: MessageActions.SIDEPANEL_RESUME_VIDEO,
                    source: 'background',
                });

                this.logger.debug('Video resume command sent', { tabId });
            }
        } catch (error) {
            this.logger.error('Failed to resume video', error, { tabId });
        }
    }

    /**
     * Forward word selection to side panel
     */
    async forwardWordSelection(tabId, wordData) {
        // Ensure the side panel is open for this tab
        await this.openSidePanelImmediate(tabId, { pauseVideo: true });

        // Update the state for the specific tab
        const st = this.tabStates.get(tabId) || {};
        // Only set pending selection when we don't yet have a full authoritative selection
        // This avoids overriding multi-word state with a single last-click word during tab switches
        if (!Array.isArray(st.selectedWords) || st.selectedWords.length === 0) {
            this.updateTabState(tabId, {
                pendingWordSelection: wordData,
            });
        } else {
            // Do not alter activeTab; selectionSync is authoritative and UI chooses the tab
            this.updateTabState(tabId, {});
        }

        // No longer broadcasting per-word toggle updates to side panel; selectionSync is the source of truth

        this.logger.debug('Word selection forwarded to side panels', {
            tabId,
            word: wordData.word,
        });
    }

    /**
     * Forward selection synchronization (e.g., subtitle change clears selection)
     */
    async forwardSelectionSync(tabId, payload = {}) {
        const port = this.activeConnections.get(tabId);
        const incomingWords = (Array.isArray(payload?.selectedWords) ? payload.selectedWords : [])
            .map((w) => (typeof w === 'string' ? w.trim() : ''))
            .filter((w) => w.length > 0);

        // Deduplicate while preserving order
        const normalizedWords = incomingWords.reduce((acc, word) => {
            if (!acc.includes(word)) acc.push(word);
            return acc;
        }, []);

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
            // Broadcast fallback with tabId so the side panel can self-filter
            try {
                for (const [tid, p] of this.activeConnections.entries()) {
                    try {
                        p.postMessage({
                            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                            data: {
                                selectedWords: normalizedWords,
                                reason: payload.reason || 'unknown',
                                tabId,
                            },
                        });
                    } catch (_) {}
                }
                this.logger.debug('Selection sync broadcast to all ports (no direct mapping)', {
                    tabId,
                    count: normalizedWords.length,
                });
            } catch (err) {
                this.logger.error('Failed broadcast fallback for selection sync', err, { tabId });
            }
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

        // Notify only active side panel connections in the same window when possible
        if (typeof windowId === 'number' && this.activeConnectionsByWindow.has(windowId)) {
            const winMap = this.activeConnectionsByWindow.get(windowId);
            for (const port of winMap.values()) {
                try {
                    port.postMessage({
                        action: 'tabActivated',
                        data: { tabId, windowId },
                    });
                } catch (error) {
                    this.logger.warn('Failed to notify a side panel of tab activation', {
                        error: error.message,
                    });
                }
            }
        } else {
            // Fallback legacy behavior
            for (const port of this.activeConnections.values()) {
                try {
                    port.postMessage({
                        action: 'tabActivated',
                        data: { tabId, windowId },
                    });
                } catch (error) {
                    this.logger.warn('Failed to notify a side panel of tab activation', {
                        error: error.message,
                    });
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
