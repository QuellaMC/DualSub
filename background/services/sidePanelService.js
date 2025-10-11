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
        const tabId = port.sender?.tab?.id;
        if (!tabId) {
            this.logger.warn('Side panel connection without tab ID');
            return;
        }

        this.logger.info('Side panel connected', { tabId });
        this.activeConnections.set(tabId, port);

        // Handle messages from side panel
        port.onMessage.addListener((message) => {
            this.handleSidePanelMessage(message, port, tabId);
        });

        // Handle disconnection
        port.onDisconnect.addListener(() => {
            this.logger.info('Side panel disconnected', { tabId });
            this.activeConnections.delete(tabId);
        });

        // Send current state to newly connected side panel
        const state = this.tabStates.get(tabId);
        if (state) {
            // If there's a pending selection, request AI tab first then forward selection after a short delay
            if (state.pendingWordSelection) {
                // Request tab switch
                port.postMessage({
                    action: MessageActions.SIDEPANEL_UPDATE_STATE,
                    data: { activeTab: 'ai-analysis' },
                });

                // Forward selection after a small delay so the AI tab can mount its listeners
                setTimeout(() => {
                    try {
                        port.postMessage({
                            action: MessageActions.SIDEPANEL_WORD_SELECTED,
                            data: state.pendingWordSelection,
                        });

                        // Clear pending selection
                        const newState = { ...state };
                        delete newState.pendingWordSelection;
                        newState.activeTab = 'ai-analysis';
                        this.tabStates.set(tabId, newState);
                    } catch (err) {
                        this.logger.error('Failed to deliver pending selection to side panel', err, { tabId });
                    }
                }, 60);
            } else {
                port.postMessage({
                    action: MessageActions.SIDEPANEL_UPDATE_STATE,
                    data: state,
                });
            }
        }
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

                case MessageActions.SIDEPANEL_REGISTER:
                    this.logger.info('Side panel register request', { tabIdFromMessage: data?.tabId });
                    try {
                        const claimedTabId = data?.tabId;
                        if (!claimedTabId || typeof claimedTabId !== 'number') {
                            this.logger.warn('Invalid register payload (missing tabId)');
                            break;
                        }
                        // Map this port to the provided tabId
                        this.activeConnections.set(claimedTabId, port);

                        // Deliver any pending state/selection and request AI tab
                        const st = this.tabStates.get(claimedTabId);
                        if (st) {
                            // Send state update first (active tab if present)
                            port.postMessage({
                                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                                data: { ...(st.activeTab ? { activeTab: st.activeTab } : {}) },
                            });

                            if (st.pendingWordSelection) {
                                const pending = st.pendingWordSelection;
                                setTimeout(() => {
                                    try {
                                        port.postMessage({
                                            action: MessageActions.SIDEPANEL_WORD_SELECTED,
                                            data: pending,
                                        });
                                        // Clear pending selection after delivery
                                        const newState = { ...st };
                                        delete newState.pendingWordSelection;
                                        this.tabStates.set(claimedTabId, newState);
                                    } catch (err) {
                                        this.logger.error('Failed to deliver pending selection on register', err, { tabId: claimedTabId });
                                    }
                                }, 60);
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
        const port = this.activeConnections.get(tabId);
        if (port) {
            // Ensure AI Analysis tab is active if selection comes while open
            port.postMessage({
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                data: { activeTab: 'ai-analysis' },
            });

            port.postMessage({
                action: MessageActions.SIDEPANEL_WORD_SELECTED,
                data: wordData,
            });

            this.logger.debug('Word selection forwarded to side panel', {
                tabId,
                word: wordData.word,
            });
        } else {
            this.logger.debug('No active side panel connection', { tabId });
            
            // Store word selection for when side panel opens
            const state = this.tabStates.get(tabId) || {};
            state.pendingWordSelection = wordData;
            // Ensure we request AI Analysis tab on open
            state.activeTab = 'ai-analysis';
            this.tabStates.set(tabId, state);

            // Open side panel immediately to preserve user gesture
            await this.openSidePanelImmediate(tabId, { pauseVideo: true });
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
        const { tabId } = activeInfo;
        this.logger.debug('Tab activated', { tabId });

        // Notify side panel of tab change if connected
        const port = this.activeConnections.get(tabId);
        if (port) {
            const state = this.tabStates.get(tabId) || {};
            port.postMessage({
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                data: state,
            });
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
