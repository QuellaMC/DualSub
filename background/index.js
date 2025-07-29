/**
 * Background Script Main Entry Point
 * 
 * Coordinates all background services and maintains backward compatibility
 * with existing background.js functionality.
 * 
 * @author DualSub Extension
 * @version 2.0.0
 */

import { translationProviders } from './services/translationService.js';
import { subtitleService } from './services/subtitleService.js';
import { loggingManager } from './utils/loggingManager.js';
import { messageHandler } from './handlers/messageHandler.js';
import { configService } from '../services/configService.js';
import Logger from '../utils/logger.js';

// Initialize background logger with ConfigService integration
const backgroundLogger = Logger.create('Background', configService);

backgroundLogger.info('Dual Subtitles background script loaded (modular version)');

/**
 * Initialize all background services
 */
async function initializeServices() {
    try {
        backgroundLogger.info('Initializing background services...');
        
        // Initialize logging manager first
        await loggingManager.initialize();
        backgroundLogger.info('Logging manager initialized');
        
        // Initialize translation service
        await translationProviders.initialize();
        backgroundLogger.info('Translation service initialized');
        
        // Initialize subtitle service
        await subtitleService.initialize();
        backgroundLogger.info('Subtitle service initialized');
        
        // Initialize message handler
        messageHandler.initialize();
        backgroundLogger.info('Message handler initialized');

        // Inject services into message handler
        messageHandler.setServices(translationProviders, subtitleService);
        backgroundLogger.info('Services injected into message handler');

        // Initialize default settings using the configuration service
        configService.initializeDefaults();
        backgroundLogger.info('Configuration defaults initialized');

        backgroundLogger.info('All background services initialized successfully');
        
    } catch (error) {
        backgroundLogger.error('Failed to initialize background services', error);
        throw error;
    }
}

/**
 * Main initialization
 */
(async () => {
    try {
        await initializeServices();
    } catch (error) {
        console.error('Critical error during background script initialization:', error);
    }
})();

// Export services for backward compatibility and testing
export {
    translationProviders,
    subtitleService,
    loggingManager,
    messageHandler,
    backgroundLogger
};
