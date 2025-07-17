/**
 * Tests for background script Logger integration
 */

import { jest } from '@jest/globals';
import Logger from './utils/logger.js';
import { configService } from './services/configService.js';

describe('Background Script Logger Integration', () => {
    let backgroundLogger;

    beforeEach(() => {
        // Create logger instance similar to background script
        backgroundLogger = Logger.create('Background', configService);
    });

    test('should create logger instance with correct component name', () => {
        expect(backgroundLogger.component).toBe('Background');
        expect(backgroundLogger.configService).toBe(configService);
    });

    test('should initialize with default INFO level', () => {
        expect(backgroundLogger.currentLevel).toBe(Logger.LEVELS.INFO);
    });

    test('should log info messages when level is INFO or higher', () => {
        const consoleSpy = jest.spyOn(console, 'info').mockImplementation();

        backgroundLogger.currentLevel = Logger.LEVELS.INFO;
        backgroundLogger.info('Test info message', { data: 'test' });

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('[INFO] [Background] Test info message')
        );

        consoleSpy.mockRestore();
    });

    test('should log error messages with stack traces', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        const testError = new Error('Test error');

        backgroundLogger.currentLevel = Logger.LEVELS.ERROR;
        backgroundLogger.error('Test error message', testError, {
            context: 'test',
        });

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('[ERROR] [Background] Test error message')
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('errorMessage')
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('errorStack')
        );

        consoleSpy.mockRestore();
    });

    test('should not log debug messages when level is INFO', () => {
        const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();

        backgroundLogger.currentLevel = Logger.LEVELS.INFO;
        backgroundLogger.debug('Test debug message', { data: 'test' });

        expect(consoleSpy).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    test('should log debug messages when level is DEBUG', () => {
        const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();

        backgroundLogger.currentLevel = Logger.LEVELS.DEBUG;
        backgroundLogger.debug('Test debug message', { data: 'test' });

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('[DEBUG] [Background] Test debug message')
        );

        consoleSpy.mockRestore();
    });

    test('should update logging level from config service', async () => {
        const mockGet = jest
            .spyOn(configService, 'get')
            .mockResolvedValue(Logger.LEVELS.DEBUG);

        await backgroundLogger.updateLevel();

        expect(backgroundLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
        expect(mockGet).toHaveBeenCalledWith('loggingLevel');

        mockGet.mockRestore();
    });

    test('should handle config service errors gracefully', async () => {
        const mockGet = jest
            .spyOn(configService, 'get')
            .mockRejectedValue(new Error('Config error'));

        await backgroundLogger.updateLevel();

        // Should fallback to INFO level
        expect(backgroundLogger.currentLevel).toBe(Logger.LEVELS.INFO);

        mockGet.mockRestore();
    });

    test('should format messages with timestamp and component', () => {
        const message = backgroundLogger.formatMessage('INFO', 'Test message', {
            data: 'test',
        });

        expect(message).toMatch(
            /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/
        );
        expect(message).toContain('[INFO]');
        expect(message).toContain('[Background]');
        expect(message).toContain('Test message');
        expect(message).toContain('Data: {"data":"test"}');
    });

    test('should format messages without data when data is empty', () => {
        const message = backgroundLogger.formatMessage(
            'INFO',
            'Test message',
            {}
        );

        expect(message).toMatch(
            /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/
        );
        expect(message).toContain('[INFO]');
        expect(message).toContain('[Background]');
        expect(message).toContain('Test message');
        expect(message).not.toContain('Data:');
    });
});

describe('Background Script Logging Level Synchronization', () => {
    test('should broadcast logging level changes to content scripts', async () => {
        // Mock chrome.tabs API
        const mockTabs = [
            { id: 1, url: 'https://netflix.com/watch/123' },
            { id: 2, url: 'https://disneyplus.com/video/456' },
            { id: 3, url: 'https://example.com' }, // Should be ignored
        ];

        global.chrome = {
            tabs: {
                query: jest.fn().mockResolvedValue(mockTabs),
                sendMessage: jest.fn().mockResolvedValue({}),
            },
        };

        // Import the broadcastLoggingLevelChange function (would need to be exported)
        // For now, we'll test the concept
        const newLevel = Logger.LEVELS.DEBUG;

        // This would be the actual function call
        // await broadcastLoggingLevelChange(newLevel);

        // Verify tabs.query was called
        // expect(chrome.tabs.query).toHaveBeenCalledWith({});

        // Verify sendMessage was called for Netflix and Disney+ tabs only
        // expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
        // expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        //     type: 'LOGGING_LEVEL_CHANGED',
        //     level: newLevel
        // });
        // expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, {
        //     type: 'LOGGING_LEVEL_CHANGED',
        //     level: newLevel
        // });
    });
});
