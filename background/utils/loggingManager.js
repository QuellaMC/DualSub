import Logger from '../../utils/logger.js';
import { configService } from '../../services/configService.js';
import {
    buildLoggingLevelChangedRequestMessage,
    parseContentControlResponseMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

class LoggingManager {
    constructor() {
        this.logger = Logger.create('LoggingManager', configService);
        this.currentLoggingLevel = Logger.LEVELS.INFO;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            this.currentLoggingLevel = await configService.get('loggingLevel');
            this.logger.updateLevel(this.currentLoggingLevel);
            configService.onChanged((changes) => {
                if (!Object.hasOwn(changes, 'loggingLevel')) return;
                this.currentLoggingLevel = changes.loggingLevel;
                this.logger.updateLevel(this.currentLoggingLevel);
                void this.broadcastLoggingLevelChange(this.currentLoggingLevel);
            });
            this.isInitialized = true;
        } catch (error) {
            this.currentLoggingLevel = Logger.LEVELS.INFO;
            this.logger.updateLevel(this.currentLoggingLevel);
            this.logger.error('Failed to initialize logging level', error);
        }
    }

    async broadcastLoggingLevelChange(level) {
        try {
            const tabs = await chrome.tabs.query({});
            const request = buildLoggingLevelChangedRequestMessage(level);
            const deliveries = tabs
                .filter((tab) =>
                    /netflix\.com|disneyplus\.com/.test(tab.url ?? '')
                )
                .map(async (tab) => {
                    try {
                        const response = await chrome.tabs.sendMessage(
                            tab.id,
                            request
                        );
                        const parsed = parseContentControlResponseMessage(
                            response,
                            request
                        );
                        if (!parsed?.success) {
                            throw new Error(
                                parsed?.error ??
                                    'Invalid logging-level response'
                            );
                        }
                    } catch (error) {
                        this.logger.debug(
                            'Failed to send logging level to tab',
                            error,
                            { tabId: tab.id }
                        );
                    }
                });
            await Promise.all(deliveries);
        } catch (error) {
            this.logger.error(
                'Error broadcasting logging level change',
                error,
                { level }
            );
        }
    }

    createLogger(component) {
        const logger = Logger.create(component, configService);
        logger.updateLevel(this.currentLoggingLevel);
        return logger;
    }

    getCurrentLevel() {
        return this.currentLoggingLevel;
    }
}

export const loggingManager = new LoggingManager();
