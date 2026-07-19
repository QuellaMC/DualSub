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
            set: jest.fn(),
        },
        local: {
            get: jest.fn(),
            set: jest.fn(),
        },
        onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn(),
        },
    },
    runtime: {
        lastError: null,
    },
};

// Mock configService
const mockConfigService = {
    getMultiple: jest.fn(),
    set: jest.fn(),
};

describe('Translation Provider Logging Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.chrome.runtime.lastError = null;

        // Reset configService mocks
        mockConfigService.getMultiple.mockReset();
        mockConfigService.set.mockReset();

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
            global.chrome.storage.sync.get.mockImplementation(
                (keys, callback) => {
                    callback({ deeplApiKey: 'test-key', deeplApiPlan: 'free' });
                }
            );

            // Mock successful API response
            global.fetch.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        translations: [
                            {
                                text: 'translated text',
                                detected_source_language: 'EN',
                            },
                        ],
                    }),
            });

            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used (Logger formats messages with timestamps and component names)
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls,
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[DeepLTranslate]')
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
                json: () =>
                    Promise.resolve([
                        [['texto traducido', 'Hello world', null, null, 10]],
                    ]),
            });

            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls,
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[GoogleTranslate]')
            );

            expect(structuredLogs.length).toBeGreaterThan(0);
        });
    });

    describe('Microsoft Translate Provider', () => {
        test('should use structured logging instead of direct console calls', async () => {
            const { translate } = await import(
                './microsoftTranslateEdgeAuth.js'
            );

            // Mock JWT token
            const mockJwtToken =
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.mock_signature';

            // Mock auth token fetch and translation response
            global.fetch
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve(mockJwtToken),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () =>
                        Promise.resolve([
                            {
                                translations: [{ text: 'texto traducido' }],
                                detectedLanguage: { language: 'en' },
                            },
                        ]),
                });

            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls,
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[MicrosoftTranslate]')
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
                json: () =>
                    Promise.resolve({
                        result: {
                            texts: [{ text: 'texto traducido' }],
                        },
                    }),
            });

            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls,
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[DeepLTranslateFree]')
            );

            expect(structuredLogs.length).toBeGreaterThan(0);
        });
    });

    describe('OpenAI Compatible Translation Provider', () => {
        test('should use structured logging instead of direct console calls', async () => {
            // Mock chrome.storage response since configService import will fail and fallback to chrome.storage
            global.chrome.storage.sync.get.mockImplementation(
                (keys, callback) => {
                    callback({
                        openaiCompatibleApiKey: 'test-api-key',
                        openaiCompatibleBaseUrl: 'https://api.test.com/v1',
                        openaiCompatibleModel: 'test-model-1',
                    });
                }
            );

            // Mock successful API response
            global.fetch.mockResolvedValue({
                ok: true,
                headers: new Map([
                    ['content-type', 'application/json'],
                    ['content-length', '150'],
                ]),
                json: () =>
                    Promise.resolve({
                        choices: [
                            {
                                message: {
                                    content: 'texto traducido',
                                },
                            },
                        ],
                        usage: {
                            total_tokens: 25,
                        },
                    }),
            });

            const { translate } = await import(
                './openaiCompatibleTranslate.js'
            );
            await translate('Hello world', 'en', 'es');

            // Verify that structured logging is used
            const logCalls = [
                ...console.debug.mock.calls,
                ...console.info.mock.calls,
                ...console.warn.mock.calls,
                ...console.error.mock.calls,
            ].flat();

            // Check that log messages contain structured format with component name
            const structuredLogs = logCalls.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[OpenAICompatibleTranslate]')
            );

            expect(structuredLogs.length).toBeGreaterThan(0);
        });

        test('should normalize baseUrl and log the normalization', async () => {
            // Mock chrome.storage response with trailing slashes
            global.chrome.storage.sync.get.mockImplementation(
                (keys, callback) => {
                    callback({
                        openaiCompatibleApiKey: 'test-api-key',
                        openaiCompatibleBaseUrl: 'https://api.test.com/v1//\\',
                        openaiCompatibleModel: 'test-model-1',
                    });
                }
            );

            // Mock successful API response
            global.fetch.mockResolvedValue({
                ok: true,
                headers: new Map([
                    ['content-type', 'application/json'],
                    ['content-length', '150'],
                ]),
                json: () =>
                    Promise.resolve({
                        choices: [
                            {
                                message: {
                                    content: 'texto traducido',
                                },
                            },
                        ],
                        usage: {
                            total_tokens: 25,
                        },
                    }),
            });

            const { translate } = await import(
                './openaiCompatibleTranslate.js'
            );
            await translate('Hello world', 'en', 'es');

            // Verify that translation was successful (INFO level logs are recorded)
            const infoLogs = console.info.mock.calls.flat();
            const translationLogs = infoLogs.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[OpenAICompatibleTranslate]') &&
                    call.includes('Translation completed successfully')
            );

            expect(translationLogs.length).toBeGreaterThan(0);

            // Verify fetch was called with normalized URL
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.test.com/v1/chat/completions',
                expect.any(Object)
            );
        });

        test('should log configuration details during API setup', async () => {
            // Mock chrome.storage response
            global.chrome.storage.sync.get.mockImplementation(
                (keys, callback) => {
                    callback({
                        openaiCompatibleApiKey: 'test-api-key',
                        openaiCompatibleBaseUrl: 'https://api.test.com/v1',
                        openaiCompatibleModel: 'test-model-1',
                    });
                }
            );

            // Mock successful API response
            global.fetch.mockResolvedValue({
                ok: true,
                headers: new Map([
                    ['content-type', 'application/json'],
                    ['content-length', '120'],
                ]),
                json: () =>
                    Promise.resolve({
                        choices: [
                            {
                                message: {
                                    content: 'texto traducido',
                                },
                            },
                        ],
                    }),
            });

            const { translate } = await import(
                './openaiCompatibleTranslate.js'
            );
            await translate('Hello world', 'en', 'es');

            // Verify that translation request was logged
            const infoLogs = console.info.mock.calls.flat();
            const requestLogs = infoLogs.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[OpenAICompatibleTranslate]') &&
                    call.includes('Translation request initiated')
            );

            expect(requestLogs.length).toBeGreaterThan(0);
        });

        test('should use chrome.storage fallback when configService fails', async () => {
            // Since configService import already fails, it will directly use chrome.storage fallback
            global.chrome.storage.sync.get.mockImplementation(
                (keys, callback) => {
                    callback({
                        openaiCompatibleApiKey: 'fallback-api-key',
                        openaiCompatibleBaseUrl: 'https://fallback.api.com/v1',
                        openaiCompatibleModel: 'fallback-model',
                    });
                }
            );

            // Mock successful API response
            global.fetch.mockResolvedValue({
                ok: true,
                headers: new Map([
                    ['content-type', 'application/json'],
                    ['content-length', '120'],
                ]),
                json: () =>
                    Promise.resolve({
                        choices: [
                            {
                                message: {
                                    content: 'texto traducido',
                                },
                            },
                        ],
                    }),
            });

            const { translate } = await import(
                './openaiCompatibleTranslate.js'
            );
            await translate('Hello world', 'en', 'es');

            // Verify that translation was completed (INFO level logs are recorded)
            const infoLogs = console.info.mock.calls.flat();
            const completionLogs = infoLogs.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[OpenAICompatibleTranslate]') &&
                    call.includes('Translation completed successfully')
            );

            expect(completionLogs.length).toBeGreaterThan(0);
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

            await expect(
                translate('Hello world', 'en', 'es')
            ).rejects.toThrow();

            // Verify that error logging includes structured format
            const errorLogs = console.error.mock.calls.flat();
            const structuredErrorLogs = errorLogs.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[GoogleTranslate]') &&
                    call.includes('ERROR')
            );

            expect(structuredErrorLogs.length).toBeGreaterThan(0);
        });

        test('should log OpenAI provider errors with structured format', async () => {
            // Mock chrome.storage response
            global.chrome.storage.sync.get.mockImplementation(
                (keys, callback) => {
                    callback({
                        openaiCompatibleApiKey: 'test-api-key',
                        openaiCompatibleBaseUrl: 'https://api.test.com/v1',
                        openaiCompatibleModel: 'test-model-1',
                    });
                }
            );

            // Mock API failure
            global.fetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: () => Promise.resolve('Invalid API key'),
            });

            const { translate } = await import(
                './openaiCompatibleTranslate.js'
            );

            await expect(
                translate('Hello world', 'en', 'es')
            ).rejects.toThrow();

            // Verify that error logging includes structured format
            const errorLogs = console.error.mock.calls.flat();
            const structuredErrorLogs = errorLogs.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[OpenAICompatibleTranslate]') &&
                    call.includes('ERROR')
            );

            expect(structuredErrorLogs.length).toBeGreaterThan(0);
        });

        test('should log missing API key error with structured format', async () => {
            // Mock chrome.storage response with no API key
            global.chrome.storage.sync.get.mockImplementation(
                (keys, callback) => {
                    callback({
                        openaiCompatibleApiKey: '',
                        openaiCompatibleBaseUrl: 'https://api.test.com/v1',
                        openaiCompatibleModel: 'test-model-1',
                    });
                }
            );

            const { translate } = await import(
                './openaiCompatibleTranslate.js'
            );

            await expect(translate('Hello world', 'en', 'es')).rejects.toThrow(
                'OpenAI-compatible API key not configured'
            );

            // Verify that error logging includes structured format
            const errorLogs = console.error.mock.calls.flat();
            const structuredErrorLogs = errorLogs.filter(
                (call) =>
                    typeof call === 'string' &&
                    call.includes('[OpenAICompatibleTranslate]') &&
                    call.includes('ERROR') &&
                    call.includes('API key not configured')
            );

            expect(structuredErrorLogs.length).toBeGreaterThan(0);
        });
    });
});
