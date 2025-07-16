/**
 * Integration tests for translation provider logging
 * Tests that logging calls are made without mocking the Logger class
 */

import { jest } from '@jest/globals';

// Mock fetch globally
global.fetch = jest.fn();

// Mock chrome storage API
global.chrome = {
    storage: {
        sync: {
            get: jest.fn(),
        },
    },
    runtime: {
        lastError: null,
    },
};

describe('Translation Provider Logging Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome.runtime.lastError = null;
        
        // Mock console methods to capture logging calls
        jest.spyOn(console, 'debug').mockImplementation(() => {});
        jest.spyOn(console, 'info').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('DeepL Translation Provider', () => {
        test('should use structured logging instead of direct console calls', async () => {
            const { translate } = await import('./deeplTranslate.js');
            
            // Mock successful storage response
            global.chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ deeplApiKey: 'test-key', deeplApiPlan: 'free' });
            });

            // Mock successful API response
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    translations: [{ text: 'translated text', detected_source_language: 'EN' }]
                }),
            });

            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used (Logger formats messages with timestamps and component names)
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(call => 
                typeof call === 'string' && call.includes('[DeepLTranslate]')
            );

            expect(structuredLogs.length).toBeGreaterThan(0);
        });
    });

    describe('Google Translate Provider', () => {
        test('should use structured logging instead of direct console calls', async () => {
            const { translate } = await import('./googleTranslate.js');

            // Mock successful API response
            global.fetch.mockResolvedValue({
                ok: true,
                headers: {
                    get: () => 'application/json',
                },
                json: () => Promise.resolve([
                    [['texto traducido', 'Hello world', null, null, 10]]
                ]),
            });

            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(call => 
                typeof call === 'string' && call.includes('[GoogleTranslate]')
            );

            expect(structuredLogs.length).toBeGreaterThan(0);
        });
    });

    describe('Microsoft Translate Provider', () => {
        test('should use structured logging instead of direct console calls', async () => {
            const { translate } = await import('./microsoftTranslateEdgeAuth.js');

            // Mock JWT token
            const mockJwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.mock_signature';

            // Mock auth token fetch and translation response
            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve(mockJwtToken),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve([
                        {
                            translations: [
                                { text: 'texto traducido' }
                            ],
                            detectedLanguage: { language: 'en' }
                        }
                    ]),
                });

            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(call => 
                typeof call === 'string' && call.includes('[MicrosoftTranslate]')
            );

            expect(structuredLogs.length).toBeGreaterThan(0);
        });
    });

    describe('DeepL Free Translation Provider', () => {
        test('should use structured logging instead of direct console calls', async () => {
            const { translate } = await import('./deeplTranslateFree.js');

            // Mock successful web API response
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    result: {
                        texts: [{ text: 'texto traducido' }]
                    }
                }),
            });

            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(call => 
                typeof call === 'string' && call.includes('[DeepLTranslateFree]')
            );

            expect(structuredLogs.length).toBeGreaterThan(0);
        });
    });

    describe('Error Logging Verification', () => {
        test('should log errors with structured format when translation fails', async () => {
            const { translate } = await import('./googleTranslate.js');

            // Mock API failure
            global.fetch.mockResolvedValue({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                text: () => Promise.resolve('Rate limit exceeded'),
            });

            await expect(translate('Hello world', 'en', 'es')).rejects.toThrow();

            // Verify that error logging includes structured format
            const errorLogs = console.error.mock.calls.flat();
            const structuredErrorLogs = errorLogs.filter(call => 
                typeof call === 'string' && call.includes('[GoogleTranslate]') && call.includes('ERROR')
            );

            expect(structuredErrorLogs.length).toBeGreaterThan(0);
        });
    });
});