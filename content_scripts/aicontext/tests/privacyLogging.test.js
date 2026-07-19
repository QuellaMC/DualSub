import { jest } from '@jest/globals';
import { AIContextProvider } from '../providers/AIContextProvider.js';
import {
    buildAnalyzeContextSuccessResponse,
    MessageSenderRoles,
} from '../../shared/protocol/messageProtocol.js';
import {
    formatInteractiveSubtitleText,
    initializeInteractiveSubtitles,
} from '../../shared/interactiveSubtitleFormatter.js';

function loggedOutput() {
    return ['log', 'debug', 'info', 'warn', 'error']
        .flatMap((level) => console[level].mock.calls.flat())
        .join('\n');
}

describe('content-script logging privacy', () => {
    it('does not log interactive subtitle content in debug mode', () => {
        const subtitle = 'PRIVATE_INTERACTIVE_SUBTITLE';
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debugLogging: true,
        });
        jest.clearAllMocks();

        const formatted = formatInteractiveSubtitleText(subtitle, {
            sourceLanguage: 'en',
            targetLanguage: 'es',
            subtitleType: 'original',
        });

        expect(formatted).toContain('dualsub-interactive-word');
        expect(loggedOutput()).not.toContain(subtitle);
    });

    it('routes legacy provider logs through the shared logger without text', async () => {
        const selectedText = 'PRIVATE_LEGACY_SELECTED_TEXT';
        const provider = new AIContextProvider();
        provider.initialized = true;
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            const response = buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.CONTENT,
                message,
                { analysis: { summary: 'Safe analysis' } }
            );
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
        jest.clearAllMocks();

        await expect(
            provider.analyzeContext(selectedText, {
                requestId: 'privacy-test-request',
                contextTypes: ['cultural'],
                language: 'en',
                targetLanguage: 'es',
            })
        ).resolves.toEqual(expect.objectContaining({ success: true }));

        expect(loggedOutput()).not.toContain(selectedText);
        expect(console.info.mock.calls.every((call) => call.length === 1)).toBe(
            true
        );
        expect(provider.analyzeBatch).toBeUndefined();
    });
});
