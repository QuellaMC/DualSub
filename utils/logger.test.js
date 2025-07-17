import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import Logger from './logger.js';

describe('Logger', () => {
    let logger;
    let mockConfigService;

    beforeEach(() => {
        // Reset console mocks
        jest.clearAllMocks();

        // Create mock config service
        mockConfigService = {
            get: jest.fn(),
        };

        logger = new Logger('TestComponent', mockConfigService);
    });

    describe('constructor', () => {
        it('should create logger with component name', () => {
            expect(logger.component).toBe('TestComponent');
            expect(logger.configService).toBe(mockConfigService);
            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO);
        });

        it('should create logger without config service', () => {
            const loggerWithoutConfig = new Logger('TestComponent');
            expect(loggerWithoutConfig.component).toBe('TestComponent');
            expect(loggerWithoutConfig.configService).toBe(null);
            expect(loggerWithoutConfig.currentLevel).toBe(Logger.LEVELS.INFO);
        });
    });

    describe('LEVELS constants', () => {
        it('should have correct level values', () => {
            expect(Logger.LEVELS.OFF).toBe(0);
            expect(Logger.LEVELS.ERROR).toBe(1);
            expect(Logger.LEVELS.WARN).toBe(2);
            expect(Logger.LEVELS.INFO).toBe(3);
            expect(Logger.LEVELS.DEBUG).toBe(4);
        });
    });

    describe('create factory method', () => {
        it('should create new Logger instance', () => {
            const newLogger = Logger.create(
                'FactoryComponent',
                mockConfigService
            );
            expect(newLogger).toBeInstanceOf(Logger);
            expect(newLogger.component).toBe('FactoryComponent');
            expect(newLogger.configService).toBe(mockConfigService);
        });

        it('should create logger without config service', () => {
            const newLogger = Logger.create('FactoryComponent');
            expect(newLogger).toBeInstanceOf(Logger);
            expect(newLogger.component).toBe('FactoryComponent');
            expect(newLogger.configService).toBe(null);
        });
    });

    describe('debug logging', () => {
        it('should log debug message when debug level is enabled', () => {
            logger.currentLevel = Logger.LEVELS.DEBUG;

            logger.debug('Test debug message', { key: 'value' });

            expect(console.debug).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[DEBUG] [TestComponent] Test debug message | Data: {"key":"value"}'
                )
            );
        });

        it('should not log debug message when debug level is disabled', () => {
            logger.currentLevel = Logger.LEVELS.INFO;

            logger.debug('Test debug message', { key: 'value' });

            expect(console.debug).not.toHaveBeenCalled();
        });

        it('should handle empty data object', () => {
            logger.currentLevel = Logger.LEVELS.DEBUG;

            logger.debug('Test debug message');

            expect(console.debug).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[DEBUG] [TestComponent] Test debug message'
                )
            );
            expect(console.debug).toHaveBeenCalledWith(
                expect.not.stringContaining('Data:')
            );
        });
    });

    describe('info logging', () => {
        it('should always log info messages', () => {
            logger.info('Test info message', { key: 'value' });

            expect(console.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[INFO] [TestComponent] Test info message | Data: {"key":"value"}'
                )
            );
        });

        it('should handle empty data object', () => {
            logger.info('Test info message');

            expect(console.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[INFO] [TestComponent] Test info message'
                )
            );
            expect(console.info).toHaveBeenCalledWith(
                expect.not.stringContaining('Data:')
            );
        });
    });

    describe('warn logging', () => {
        it('should always log warning messages', () => {
            logger.warn('Test warning message', { key: 'value' });

            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[WARN] [TestComponent] Test warning message | Data: {"key":"value"}'
                )
            );
        });

        it('should handle empty data object', () => {
            logger.warn('Test warning message');

            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[WARN] [TestComponent] Test warning message'
                )
            );
            expect(console.warn).toHaveBeenCalledWith(
                expect.not.stringContaining('Data:')
            );
        });
    });

    describe('error logging', () => {
        it('should always log error messages with error object', () => {
            const testError = new Error('Test error');
            testError.stack = 'Error stack trace';

            logger.error('Test error message', testError, { context: 'test' });

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[ERROR] [TestComponent] Test error message'
                )
            );
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('"context":"test"')
            );
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('"errorMessage":"Test error"')
            );
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('"errorStack":"Error stack trace"')
            );
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('"errorName":"Error"')
            );
        });

        it('should log error messages without error object', () => {
            logger.error('Test error message', null, { context: 'test' });

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[ERROR] [TestComponent] Test error message | Data: {"context":"test"}'
                )
            );
        });

        it('should handle empty context', () => {
            logger.error('Test error message');

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[ERROR] [TestComponent] Test error message'
                )
            );
            expect(console.error).toHaveBeenCalledWith(
                expect.not.stringContaining('Data:')
            );
        });
    });

    describe('formatMessage', () => {
        it('should format message with timestamp, level, component, and data', () => {
            const message = logger.formatMessage('TEST', 'Test message', {
                key: 'value',
            });

            expect(message).toMatch(
                /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[TEST\] \[TestComponent\] Test message \| Data: {"key":"value"}$/
            );
        });

        it('should format message without data', () => {
            const message = logger.formatMessage('TEST', 'Test message', {});

            expect(message).toMatch(
                /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[TEST\] \[TestComponent\] Test message$/
            );
        });

        it('should include ISO timestamp', () => {
            const message = logger.formatMessage('TEST', 'Test message', {});
            const timestampMatch = message.match(
                /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/
            );

            expect(timestampMatch).toBeTruthy();
            expect(new Date(timestampMatch[1]).toISOString()).toBe(
                timestampMatch[1]
            );
        });
    });

    describe('updateLevel', () => {
        it('should update level from config service', async () => {
            mockConfigService.get.mockResolvedValue(Logger.LEVELS.DEBUG);

            await logger.updateLevel();

            expect(mockConfigService.get).toHaveBeenCalledWith('loggingLevel');
            expect(logger.currentLevel).toBe(Logger.LEVELS.DEBUG);
        });

        it('should set level directly when provided', async () => {
            await logger.updateLevel(Logger.LEVELS.ERROR);

            expect(logger.currentLevel).toBe(Logger.LEVELS.ERROR);
            expect(mockConfigService.get).not.toHaveBeenCalled();
        });

        it('should default to INFO when config is undefined', async () => {
            mockConfigService.get.mockResolvedValue(undefined);

            await logger.updateLevel();

            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO);
        });

        it('should default to INFO when config service throws error', async () => {
            mockConfigService.get.mockRejectedValue(new Error('Config error'));

            await logger.updateLevel();

            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO);
        });

        it('should handle null config service gracefully', async () => {
            const loggerWithoutConfig = new Logger('TestComponent');

            await loggerWithoutConfig.updateLevel();

            expect(loggerWithoutConfig.currentLevel).toBe(Logger.LEVELS.INFO);
        });
    });

    describe('shouldLog', () => {
        it('should return true when current level is higher than message level', () => {
            logger.currentLevel = Logger.LEVELS.DEBUG;
            expect(logger.shouldLog(Logger.LEVELS.INFO)).toBe(true);
            expect(logger.shouldLog(Logger.LEVELS.WARN)).toBe(true);
            expect(logger.shouldLog(Logger.LEVELS.ERROR)).toBe(true);
            expect(logger.shouldLog(Logger.LEVELS.DEBUG)).toBe(true);
        });

        it('should return true when current level equals message level', () => {
            logger.currentLevel = Logger.LEVELS.WARN;
            expect(logger.shouldLog(Logger.LEVELS.WARN)).toBe(true);
        });

        it('should return false when current level is lower than message level', () => {
            logger.currentLevel = Logger.LEVELS.ERROR;
            expect(logger.shouldLog(Logger.LEVELS.WARN)).toBe(false);
            expect(logger.shouldLog(Logger.LEVELS.INFO)).toBe(false);
            expect(logger.shouldLog(Logger.LEVELS.DEBUG)).toBe(false);
        });

        it('should return false when logging is OFF', () => {
            logger.currentLevel = Logger.LEVELS.OFF;
            expect(logger.shouldLog(Logger.LEVELS.ERROR)).toBe(false);
            expect(logger.shouldLog(Logger.LEVELS.WARN)).toBe(false);
            expect(logger.shouldLog(Logger.LEVELS.INFO)).toBe(false);
            expect(logger.shouldLog(Logger.LEVELS.DEBUG)).toBe(false);
        });
    });

    describe('level-based filtering', () => {
        describe('OFF level', () => {
            beforeEach(() => {
                logger.currentLevel = Logger.LEVELS.OFF;
            });

            it('should not log any messages when level is OFF', () => {
                logger.debug('Debug message');
                logger.info('Info message');
                logger.warn('Warn message');
                logger.error('Error message');

                expect(console.debug).not.toHaveBeenCalled();
                expect(console.info).not.toHaveBeenCalled();
                expect(console.warn).not.toHaveBeenCalled();
                expect(console.error).not.toHaveBeenCalled();
            });
        });

        describe('ERROR level', () => {
            beforeEach(() => {
                logger.currentLevel = Logger.LEVELS.ERROR;
            });

            it('should only log ERROR messages', () => {
                logger.debug('Debug message');
                logger.info('Info message');
                logger.warn('Warn message');
                logger.error('Error message');

                expect(console.debug).not.toHaveBeenCalled();
                expect(console.info).not.toHaveBeenCalled();
                expect(console.warn).not.toHaveBeenCalled();
                expect(console.error).toHaveBeenCalledTimes(1);
            });
        });

        describe('WARN level', () => {
            beforeEach(() => {
                logger.currentLevel = Logger.LEVELS.WARN;
            });

            it('should log WARN and ERROR messages', () => {
                logger.debug('Debug message');
                logger.info('Info message');
                logger.warn('Warn message');
                logger.error('Error message');

                expect(console.debug).not.toHaveBeenCalled();
                expect(console.info).not.toHaveBeenCalled();
                expect(console.warn).toHaveBeenCalledTimes(1);
                expect(console.error).toHaveBeenCalledTimes(1);
            });
        });

        describe('INFO level', () => {
            beforeEach(() => {
                logger.currentLevel = Logger.LEVELS.INFO;
            });

            it('should log INFO, WARN, and ERROR messages', () => {
                logger.debug('Debug message');
                logger.info('Info message');
                logger.warn('Warn message');
                logger.error('Error message');

                expect(console.debug).not.toHaveBeenCalled();
                expect(console.info).toHaveBeenCalledTimes(1);
                expect(console.warn).toHaveBeenCalledTimes(1);
                expect(console.error).toHaveBeenCalledTimes(1);
            });
        });

        describe('DEBUG level', () => {
            beforeEach(() => {
                logger.currentLevel = Logger.LEVELS.DEBUG;
            });

            it('should log all messages', () => {
                logger.debug('Debug message');
                logger.info('Info message');
                logger.warn('Warn message');
                logger.error('Error message');

                expect(console.debug).toHaveBeenCalledTimes(1);
                expect(console.info).toHaveBeenCalledTimes(1);
                expect(console.warn).toHaveBeenCalledTimes(1);
                expect(console.error).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe('integration tests', () => {
        it('should work with real config service flow', async () => {
            // Set DEBUG level to enable all logging
            mockConfigService.get.mockResolvedValue(Logger.LEVELS.DEBUG);
            await logger.updateLevel();

            logger.debug('Debug message');
            logger.info('Info message');
            logger.warn('Warning message');
            logger.error('Error message', new Error('Test error'));

            expect(console.debug).toHaveBeenCalledTimes(1);
            expect(console.info).toHaveBeenCalledTimes(1);
            expect(console.warn).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledTimes(1);
        });

        it('should handle level changes from config service', async () => {
            // Start with ERROR level
            mockConfigService.get.mockResolvedValue(Logger.LEVELS.ERROR);
            await logger.updateLevel();

            logger.info('Should not log');
            logger.error('Should log');

            expect(console.info).not.toHaveBeenCalled();
            expect(console.error).toHaveBeenCalledTimes(1);

            // Change to DEBUG level
            mockConfigService.get.mockResolvedValue(Logger.LEVELS.DEBUG);
            await logger.updateLevel();

            logger.debug('Should log now');
            logger.info('Should also log');

            expect(console.debug).toHaveBeenCalledTimes(1);
            expect(console.info).toHaveBeenCalledTimes(1);
        });

        it('should handle runtime level updates', async () => {
            // Start with INFO level
            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO);

            logger.debug('Should not log');
            logger.info('Should log');

            expect(console.debug).not.toHaveBeenCalled();
            expect(console.info).toHaveBeenCalledTimes(1);

            // Update to DEBUG level at runtime
            await logger.updateLevel(Logger.LEVELS.DEBUG);

            logger.debug('Should log now');

            expect(console.debug).toHaveBeenCalledTimes(1);
        });
    });
});
