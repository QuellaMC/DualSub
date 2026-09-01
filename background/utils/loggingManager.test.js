import { jest } from '@jest/globals';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';

const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    updateLevel: jest.fn(),
};
const createLogger = jest.fn(() => logger);

jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: {
        LEVELS: { INFO: 2 },
        create: createLogger,
    },
}));
jest.unstable_mockModule('../../services/configService.js', () => ({
    configService: {
        get: jest.fn(),
        onChanged: jest.fn(),
    },
}));

const { loggingManager } = await import('./loggingManager.js');

describe('loggingManager message protocol', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome = {
            tabs: {
                query: jest.fn().mockResolvedValue([
                    { id: 7, url: 'https://www.netflix.com/watch/1' },
                    { id: 8, url: 'https://www.disneyplus.com/video/2' },
                    { id: 9, url: 'https://example.com/' },
                ]),
                sendMessage: jest.fn().mockResolvedValue({ success: true }),
            },
        };
    });

    test('broadcasts the exact logging control and accepts only correlated responses', async () => {
        await loggingManager.broadcastLoggingLevelChange(3);

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
        expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(1, 7, {
            action: MessageActions.LOGGING_LEVEL_CHANGED,
            level: 3,
        });
        expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(2, 8, {
            action: MessageActions.LOGGING_LEVEL_CHANGED,
            level: 3,
        });
        expect(logger.debug).not.toHaveBeenCalled();
    });

    test('contains an uncorrelated content response as a failed tab delivery', async () => {
        chrome.tabs.sendMessage.mockResolvedValue({
            action: MessageActions.CONFIG_CHANGED,
            success: true,
        });
        await loggingManager.broadcastLoggingLevelChange(2);

        expect(logger.debug).toHaveBeenCalledWith(
            'Failed to send logging level to tab',
            expect.objectContaining({
                message: 'Invalid logging-level response',
            }),
            expect.objectContaining({ tabId: 7 })
        );
    });
});
