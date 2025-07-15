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
            expect(logger.debugEnabled).toBe(false);
        });

        it('should create logger without config service', () => {
            const loggerWithoutConfig = new Logger('TestComponent');
            expect(loggerWithoutConfig.component).toBe('TestComponent');
            expect(loggerWithoutConfig.configService).toBe(null);
            expect(loggerWithoutConfig.debugEnabled).toBe(false);
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

    describe('updateDebugMode', () => {
        it('should enable debug mode when config returns true', async () => {
            mockConfigService.get.mockResolvedValue(true);

            await logger.updateDebugMode();

            expect(mockConfigService.get).toHaveBeenCalledWith('debugMode');
            expect(logger.debugEnabled).toBe(true);
        });

        it('should disable debug mode when config returns false', async () => {
            mockConfigService.get.mockResolvedValue(false);

            await logger.updateDebugMode();

            expect(mockConfigService.get).toHaveBeenCalledWith('debugMode');
            expect(logger.debugEnabled).toBe(false);
        });

        it('should default to false when config service throws error', async () => {
            mockConfigService.get.mockRejectedValue(new Error('Config error'));

            await logger.updateDebugMode();

            expect(logger.debugEnabled).toBe(false);
        });

        it('should handle null config service gracefully', async () => {
            const loggerWithoutConfig = new Logger('TestComponent');

            await loggerWithoutConfig.updateDebugMode();

            expect(loggerWithoutConfig.debugEnabled).toBe(false);
        });
    });

    describe('debug logging', () => {
        it('should log debug message when debug is enabled', () => {
            logger.debugEnabled = true;

            logger.debug('Test debug message', { key: 'value' });

            expect(console.debug).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[DEBUG] [TestComponent] Test debug message | Data: {"key":"value"}'
                )
            );
        });

        it('should not log debug message when debug is disabled', () => {
            logger.debugEnabled = false;

            logger.debug('Test debug message', { key: 'value' });

            expect(console.debug).not.toHaveBeenCalled();
        });

        it('should handle empty data object', () => {
            logger.debugEnabled = true;

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

    describe('integration tests', () => {
        it('should work with real config service flow', async () => {
            mockConfigService.get.mockResolvedValue(true);

            await logger.updateDebugMode();
            logger.debug('Debug after enabling');
            logger.info('Info message');
            logger.warn('Warning message');
            logger.error('Error message', new Error('Test error'));

            expect(console.debug).toHaveBeenCalledTimes(1);
            expect(console.info).toHaveBeenCalledTimes(1);
            expect(console.warn).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledTimes(1);
        });

        it('should handle debug mode toggle', async () => {
            // Start with debug disabled
            mockConfigService.get.mockResolvedValue(false);
            await logger.updateDebugMode();

            logger.debug('Should not log');
            expect(console.debug).not.toHaveBeenCalled();

            // Enable debug mode
            mockConfigService.get.mockResolvedValue(true);
            await logger.updateDebugMode();

            logger.debug('Should log now');
            expect(console.debug).toHaveBeenCalledTimes(1);
        });
    });
});
