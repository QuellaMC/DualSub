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
import { batchTranslationQueue } from './services/batchTranslationQueue.js';
import { aiContextService } from './services/aiContextService.js';
import { sidePanelService } from './services/sidePanelService.js';
import { loggingManager } from './utils/loggingManager.js';
import { messageHandler } from './handlers/messageHandler.js';
import { configService } from '../services/configService.js';
import { serviceRegistry } from './services/serviceInterfaces.js';
import { performanceMonitor } from './utils/performanceMonitor.js';
import Logger from '../utils/logger.js';

// Initialize background logger with ConfigService integration
const backgroundLogger = Logger.create('Background', configService);

backgroundLogger.info(
    'Dual Subtitles background script loaded (modular version)'
);

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

        // Initialize batch translation queue
        await batchTranslationQueue.initialize();
        backgroundLogger.info('Batch translation queue initialized');

        // Initialize AI context service
        await aiContextService.initialize();
        backgroundLogger.info('AI context service initialized');

        // Initialize side panel service
        await sidePanelService.initialize();
        backgroundLogger.info('Side panel service initialized');

        // Initialize message handler
        messageHandler.initialize();
        backgroundLogger.info('Message handler initialized');

        // Register services in service registry
        serviceRegistry.register('translation', translationProviders, [
            'config',
            'logging',
        ]);
        serviceRegistry.register('subtitle', subtitleService, [
            'translation',
            'logging',
        ]);
        serviceRegistry.register('batchQueue', batchTranslationQueue, [
            'translation',
            'config',
        ]);
        serviceRegistry.register('aiContext', aiContextService, [
            'config',
            'logging',
        ]);
        serviceRegistry.register('sidePanel', sidePanelService, [
            'config',
            'logging',
        ]);
        serviceRegistry.register('logging', loggingManager, ['config']);
        serviceRegistry.register('config', configService, []);
        serviceRegistry.register('messageHandler', messageHandler, [
            'translation',
            'subtitle',
            'aiContext',
            'sidePanel',
        ]);
        backgroundLogger.info('Services registered in service registry');

        // Inject services into message handler
        messageHandler.setServices({
            translationService: translationProviders,
            subtitleService,
            aiContextService,
            sidePanelService,
        });
        backgroundLogger.info('Services injected into message handler');

        // Initialize default settings using the configuration service
        configService.initializeDefaults();
        backgroundLogger.info('Configuration defaults initialized');

        // Validate service dependencies
        const serviceNames = serviceRegistry.getServiceNames();
        const dependencyValidation = serviceNames.map((name) => ({
            service: name,
            valid: serviceRegistry.validateDependencies(name),
        }));
        backgroundLogger.info('Service dependency validation completed', {
            services: dependencyValidation,
        });

        // Start performance monitoring
        performanceMonitor.startMonitoring();
        backgroundLogger.info('Performance monitoring started');

        backgroundLogger.info(
            'All background services initialized successfully'
        );
    } catch (error) {
        backgroundLogger.error(
            'Failed to initialize background services',
            error
        );
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
        console.error(
            'Critical error during background script initialization:',
            error
        );
    }
})();

// Export services for backward compatibility and testing
export {
    translationProviders,
    subtitleService,
    loggingManager,
    messageHandler,
    sidePanelService,
    backgroundLogger,
};
