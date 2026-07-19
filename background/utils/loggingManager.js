/**
 * Logging Manager for Background Services
 *
 * Coordinates logging across all background modules and handles
 * cross-context logging level synchronization.
 *
 * Reuses existing Logger.create() from utils/logger.js
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import Logger from '../../utils/logger.js';
import { configService } from '../../services/configService.js';

class LoggingManager {
    constructor() {
        this.logger = Logger.create('LoggingManager', configService);
        this.currentLoggingLevel = Logger.LEVELS.INFO; // Default level
        this.isInitialized = false;
    }

    /**
     * Initialize logging level synchronization system
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        try {
            // Initialize logging level from configuration
            this.currentLoggingLevel = await configService.get('loggingLevel');
            this.logger.updateLevel(this.currentLoggingLevel);
            this.logger.info('Logging manager initialized', {
                level: this.currentLoggingLevel,
            });

            // Listen for logging level changes and broadcast to all contexts
            configService.onChanged((changes) => {
                if ('loggingLevel' in changes) {
                    const newLevel = changes.loggingLevel;
                    this.currentLoggingLevel = newLevel;
                    this.logger.updateLevel(newLevel);
                    this.logger.info(
                        'Logging level changed, broadcasting to all contexts',
                        {
                            newLevel,
                        }
                    );

                    // Broadcast logging level change to all active tabs
                    this.broadcastLoggingLevelChange(newLevel);
                }
            });

            this.isInitialized = true;
        } catch (error) {
            this.logger.error('Failed to initialize logging level', error);
            // Use default level on error
            this.currentLoggingLevel = Logger.LEVELS.INFO;
            this.logger.updateLevel(this.currentLoggingLevel);
        }
    }

    /**
     * Broadcasts logging level changes to all active extension contexts
     * @param {number} newLevel - The new logging level to broadcast
     */
    async broadcastLoggingLevelChange(newLevel) {
        try {
            // Get all tabs to send message to content scripts
            const tabs = await chrome.tabs.query({});
            const messagePromises = [];

            for (const tab of tabs) {
                // Only send to tabs that might have our content scripts
                if (
                    tab.url &&
                    (tab.url.includes('netflix.com') ||
                        tab.url.includes('disneyplus.com'))
                ) {
                    const messagePromise = chrome.tabs
                        .sendMessage(tab.id, {
                            type: 'LOGGING_LEVEL_CHANGED',
                            level: newLevel,
                        })
                        .catch((error) => {
                            // Content script might not be loaded, ignore these errors
                            this.logger.debug(
                                'Failed to send logging level to tab',
                                error,
                                {
                                    tabId: tab.id,
                                    url: tab.url,
                                }
                            );
                        });
                    messagePromises.push(messagePromise);
                }
            }

            // Wait for all messages to be sent (or fail)
            await Promise.allSettled(messagePromises);

            this.logger.debug('Logging level broadcast completed', {
                level: newLevel,
                tabCount: tabs.length,
            });
        } catch (error) {
            this.logger.error(
                'Error broadcasting logging level change',
                error,
                {
                    level: newLevel,
                }
            );
        }
    }

    /**
     * Create a logger instance for a specific component
     * @param {string} component - The component name
     * @returns {Logger} Logger instance
     */
    createLogger(component) {
        const logger = Logger.create(component, configService);
        // Set current logging level
        logger.updateLevel(this.currentLoggingLevel);
        return logger;
    }

    /**
     * Get current logging level
     * @returns {number} Current logging level
     */
    getCurrentLevel() {
        return this.currentLoggingLevel;
    }
}

// Export singleton instance
export const loggingManager = new LoggingManager();
