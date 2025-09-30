import { useEffect, useState } from 'react';
import Logger from '../../utils/logger.js';
import { configService } from '../../services/configService.js';

/**
 * Hook for managing logger with dynamic level updates
 * @param {string} loggerName - Name for the logger instance
 * @returns {Object} Logger instance
 */
export function useLogger(loggerName) {
    const [logger, setLogger] = useState(null);

    useEffect(() => {
        // Initialize logger
        const loggerInstance = Logger.create(loggerName, configService);

        // Initialize logging level from configuration
        (async () => {
            try {
                const loggingLevel = await configService.get('loggingLevel');
                loggerInstance.updateLevel(loggingLevel);
                loggerInstance.info(`${loggerName} logger initialized`, {
                    level: loggingLevel,
                });
            } catch (error) {
                // Fallback to INFO level if config can't be read
                loggerInstance.updateLevel(Logger.LEVELS.INFO);
                loggerInstance.warn(
                    'Failed to load logging level from config, using INFO level',
                    error
                );
            }
        })();

        // Listen for logging level changes
        const handleConfigChange = (changes) => {
            if ('loggingLevel' in changes) {
                loggerInstance.updateLevel(changes.loggingLevel);
                loggerInstance.info(
                    'Logging level updated from configuration change',
                    {
                        newLevel: changes.loggingLevel,
                    }
                );
            }
        };

        configService.onChanged(handleConfigChange);

        setLogger(loggerInstance);

        // Cleanup
        return () => {
            // Note: configService.onChanged doesn't return a cleanup function
            // but we should implement this in the future
        };
    }, [loggerName]);

    return logger;
}
