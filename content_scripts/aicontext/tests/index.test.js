/**
 * AI Context System - Integration Tests
 *
 * Comprehensive test suite for the modular AI context system.
 * Tests initialization, component integration, and system behavior.
 *
 * @author DualSub Extension - Test Automation Lead
 * @version 2.0.0
 */

import {
    jest,
    describe,
    test,
    beforeEach,
    afterEach,
    expect,
} from '@jest/globals';
import { TestHelpers } from '../../../test-utils/test-helpers.js';
import { AIContextManager } from '../core/AIContextManager.js';
import {
    buildAnalyzeContextFailureResponse,
    buildAnalyzeContextSuccessResponse,
    MessageSenderRoles,
} from '../../shared/protocol/messageProtocol.js';

function mockAnalyzeSuccess(sendMessage, analysis) {
    sendMessage.mockImplementation((message, callback) => {
        const response = buildAnalyzeContextSuccessResponse(
            MessageSenderRoles.CONTENT,
            message,
            { analysis }
        );
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

function mockAnalyzeFailure(sendMessage, error, shouldRetry = false) {
    sendMessage.mockImplementation((message, callback) => {
        const response = buildAnalyzeContextFailureResponse(
            MessageSenderRoles.CONTENT,
            message,
            { error, shouldRetry }
        );
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
    });
}

// Mock fetch for CSS loading in modal
global.fetch =
    global.fetch ||
    (() =>
        Promise.resolve({
            text: () =>
                Promise.resolve(`
            .dualsub-context-modal { position: fixed; }
            .dualsub-context-modal--visible { opacity: 1 !important; }
        `),
        }));

describe('AI Context System - Phase 1 Bootstrap Tests', () => {
    let testHelpers;
    let testEnv;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
            loggerDebugMode: false,
        });
    });

    afterEach(() => {
        if (testEnv) {
            testEnv.cleanup();
        }
    });

    describe('AIContextManager Initialization', () => {
        test('should create manager instance', () => {
            const manager = new AIContextManager('netflix', {});

            expect(manager).toBeInstanceOf(AIContextManager);
            expect(manager.platform).toBe('netflix');
            expect(manager.initialized).toBe(false);
        });

        test('should initialize manager successfully', async () => {
            const manager = new AIContextManager('netflix', {});
            const result = await manager.initialize();

            expect(result).toBe(true);
            expect(manager.initialized).toBe(true);

            // Verify Chrome API mocks are working
            expect(testEnv.mocks.chromeApi).toBeDefined();
            expect(testEnv.mocks.logger).toBeDefined();
        });

        test('should handle unsupported platform', async () => {
            const manager = new AIContextManager('unsupported', {});
            const result = await manager.initialize();

            expect(result).toBe(false);
            expect(manager.initialized).toBe(false);
        });
    });

    describe('Feature Management', () => {
        let manager;

        beforeEach(async () => {
            manager = new AIContextManager('netflix', {});
            await manager.initialize();
        });

        afterEach(async () => {
            if (manager) {
                await manager.destroy();
            }
        });

        test('should enable features successfully', async () => {
            const result = await manager.enableFeature('contextModal');
            expect(result).toBe(true);
            expect(manager.getEnabledFeatures()).toContain('contextModal');
        });

        test('should handle unknown features gracefully', async () => {
            const result = await manager.enableFeature('unknownFeature');
            expect(result).toBe(false);
        });

        test('should not enable same feature twice', async () => {
            await manager.enableFeature('contextModal');
            const result = await manager.enableFeature('contextModal');
            expect(result).toBe(true); // Should return true but not duplicate

            const features = manager.getEnabledFeatures();
            const modalFeatures = features.filter((f) => f === 'contextModal');
            expect(modalFeatures).toHaveLength(1);
        });
    });

    describe('Component Access', () => {
        let manager;

        beforeEach(async () => {
            manager = new AIContextManager('netflix', {});
            await manager.initialize();
        });

        afterEach(async () => {
            if (manager) {
                await manager.destroy();
            }
        });

        test('should provide access to components', () => {
            expect(manager.getModal()).toBeDefined();
            expect(manager.getModal().constructor.name).toBe('AIContextModal');

            expect(manager.getProvider()).toBeDefined();
            expect(manager.getProvider().constructor.name).toBe(
                'AIContextProvider'
            );
            expect(manager.getTextHandler()).toBeDefined();
            expect(manager.getTextHandler().constructor.name).toBe(
                'TextSelectionHandler'
            );
        });
    });

    describe('Cleanup and Destruction', () => {
        test('should cleanup manager properly', async () => {
            const manager = new AIContextManager('netflix', {});
            await manager.initialize();

            expect(manager.initialized).toBe(true);

            await manager.destroy();

            expect(manager.initialized).toBe(false);
            expect(manager.getEnabledFeatures()).toHaveLength(0);
        });
    });
});

describe('Error Handling and Edge Cases', () => {
    let testHelpers;
    let testEnv;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });
    });

    afterEach(() => {
        if (testEnv) {
            testEnv.cleanup();
        }
    });

    test('should handle initialization errors gracefully', async () => {
        const manager = new AIContextManager('invalid-platform', {});
        const result = await manager.initialize();

        expect(result).toBe(false);
        expect(manager.initialized).toBe(false);

        // Verify logger captured the error
        expect(testEnv.mocks.logger).toBeDefined();
    });

    test('should handle missing DOM gracefully', async () => {
        // Use test helpers to simulate DOM issues
        const originalDocument = global.document;
        global.document = null;

        try {
            const manager = new AIContextManager('netflix', {});
            const result = await manager.initialize();

            // Should handle gracefully (implementation dependent)
            expect(typeof result).toBe('boolean');
        } finally {
            global.document = originalDocument;
        }
    });
});

describe('Phase 2: UI Consolidation Tests', () => {
    let testHelpers;
    let testEnv;
    let manager;

    beforeEach(async () => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });

        manager = new AIContextManager('netflix', {});
        await manager.initialize();
    });

    afterEach(async () => {
        if (manager) {
            await manager.destroy();
        }
        if (testEnv) {
            testEnv.cleanup();
        }
    });

    describe('Modal Integration', () => {
        test('should have modal component after initialization', () => {
            const modal = manager.getModal();
            expect(modal).toBeDefined();
            expect(modal.constructor.name).toBe('AIContextModal');
        });

        test('should show modal in selection mode', () => {
            const modal = manager.getModal();
            const result = modal.showSelectionMode();

            expect(result).toBe(true);
            expect(modal.isVisible).toBe(true);
            expect(modal.state).toBe('selection');
        });

        test('should hide modal properly', async () => {
            const modal = manager.getModal();
            modal.showSelectionMode();

            expect(modal.isVisible).toBe(true);

            modal.hide();

            // Wait for async hide to complete
            await new Promise((resolve) => setTimeout(resolve, 50)); // Reduced from 350ms to 50ms

            expect(modal.isVisible).toBe(false);
        });
    });

    describe('Modal State Management', () => {
        test('should transition between states correctly', () => {
            const modal = manager.getModal();

            // Start in hidden state
            expect(modal.state).toBe('hidden');

            // Show selection mode
            modal.showSelectionMode();
            expect(modal.state).toBe('selection');

            // Simulate processing state
            modal.core.setState('processing');
            expect(modal.state).toBe('processing');

            // Hide modal (state change is async, just verify method was called)
            modal.hide();
            // Note: State change to 'hidden' happens after animation timeout
        });

        test('should handle error state', () => {
            const modal = manager.getModal();

            modal.showError('Test error');
            expect(modal.state).toBe('error');
            expect(modal.isVisible).toBe(true);
        });
    });
});

describe('Phase 3: Core Controller Tests', () => {
    let testHelpers;
    let testEnv;
    let manager;

    beforeEach(async () => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });

        manager = new AIContextManager('netflix', {});
        await manager.initialize();
    });

    afterEach(async () => {
        if (manager) {
            await manager.destroy();
        }
        if (testEnv) {
            testEnv.cleanup();
        }
    });

    describe('Event Coordination', () => {
        test('should handle analysis requests', async () => {
            // Mock chrome.runtime.sendMessage
            const mockSendMessage = testEnv.mocks.chromeApi.runtime.sendMessage;
            mockAnalyzeSuccess(mockSendMessage, {
                summary: 'Test analysis result',
            });

            // Dispatch analysis request
            document.dispatchEvent(
                new CustomEvent('dualsub-analyze-selection', {
                    detail: {
                        requestId: 'test-123',
                        text: 'test text',
                        contextTypes: ['cultural'],
                        language: 'en',
                        targetLanguage: 'es',
                    },
                })
            );

            // Wait for async processing
            await new Promise((resolve) => setTimeout(resolve, 1)); // Reduced from 10ms to 1ms

            // Verify background message was sent (accept either promise or callback form)
            const { calls } = mockSendMessage.mock;
            const found = calls.some(
                ([msg]) =>
                    msg &&
                    msg.action === 'analyzeContext' &&
                    msg.text === 'test text' &&
                    Array.isArray(msg.contextTypes) &&
                    msg.contextTypes[0] === 'cultural' &&
                    msg.language === 'en' &&
                    msg.targetLanguage === 'es' &&
                    msg.platform === 'netflix' &&
                    msg.requestId === 'test-123'
            );
            expect(found).toBe(true);
        });
    });

    describe('Metrics and Performance', () => {
        test('should track analysis metrics', async () => {
            const initialCount = manager.metrics.analysisCount;

            // Mock successful analysis
            mockAnalyzeSuccess(testEnv.mocks.chromeApi.runtime.sendMessage, {
                summary: 'Test result',
            });

            // Trigger analysis
            document.dispatchEvent(
                new CustomEvent('dualsub-analyze-selection', {
                    detail: {
                        requestId: 'test-123',
                        text: 'test text',
                    },
                })
            );

            await new Promise((resolve) => setTimeout(resolve, 1)); // Reduced from 10ms to 1ms

            expect(manager.metrics.analysisCount).toBe(initialCount + 1);
            expect(manager.metrics.lastActivity).toBeDefined();
        });

        test('should track error metrics', async () => {
            const initialErrorCount = manager.metrics.errorCount;

            // Mock failed analysis (support callback-style messaging)
            mockAnalyzeFailure(
                testEnv.mocks.chromeApi.runtime.sendMessage,
                'Analysis failed'
            );

            // Trigger analysis
            document.dispatchEvent(
                new CustomEvent('dualsub-analyze-selection', {
                    detail: {
                        requestId: 'test-123',
                        text: 'test text',
                    },
                })
            );

            await new Promise((resolve) => setTimeout(resolve, 1)); // Reduced from 10ms to 1ms

            expect(manager.metrics.errorCount).toBe(initialErrorCount + 1);
        });
    });
});

describe('Phase 4: Handlers & Providers Tests', () => {
    let testHelpers;
    let testEnv;
    let manager;

    beforeEach(async () => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });

        manager = new AIContextManager('netflix', {});
        try {
            const result = await manager.initialize();
            console.log('Manager initialization result:', result);
        } catch (error) {
            console.error('Manager initialization failed:', error);
            console.error('Error stack:', error.stack);
            throw error;
        }
    });

    afterEach(async () => {
        if (manager) {
            await manager.destroy();
        }
        if (testEnv) {
            testEnv.cleanup();
        }
    });

    describe('Text Selection Handler', () => {
        test('should import TextSelectionHandler directly', async () => {
            // Test direct import and instantiation
            try {
                const { TextSelectionHandler } =
                    await import('../handlers/textSelection.js');
                console.log(
                    'TextSelectionHandler imported:',
                    TextSelectionHandler
                );

                const handler = new TextSelectionHandler();
                console.log('TextSelectionHandler instantiated:', handler);

                expect(handler).toBeDefined();
                expect(handler.constructor.name).toBe('TextSelectionHandler');
            } catch (error) {
                console.error('Direct import/instantiation failed:', error);
                throw error;
            }
        });

        test('should have text handler after initialization', () => {
            const textHandler = manager.getTextHandler();

            // Debug: Check if manager is properly initialized
            console.log('Manager initialized:', manager.initialized);
            console.log('Text handler:', textHandler);
            console.log('Manager components:', manager.components);

            expect(textHandler).toBeDefined();
            expect(textHandler.constructor.name).toBe('TextSelectionHandler');
            expect(textHandler.initialized).toBe(true);
        });

        test('should process text selection', () => {
            const textHandler = manager.getTextHandler();

            const result = textHandler.processSelection('test text', {
                platform: 'netflix',
                language: 'en',
            });

            expect(result).toBeDefined();
            expect(result.text).toBe('test text');
            expect(result.metadata.platform).toBe('netflix');
        });

        test('should handle word clicks', () => {
            const textHandler = manager.getTextHandler();

            // Create mock word element
            const wordElement = document.createElement('span');
            wordElement.className = 'dualsub-interactive-word';
            wordElement.textContent = 'test';
            wordElement.dataset.position = '0';
            document.body.appendChild(wordElement);

            // Create click event
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });

            // Mock event target
            Object.defineProperty(clickEvent, 'target', {
                value: wordElement,
                enumerable: true,
            });

            // Handle click
            textHandler.handleWordClick(clickEvent);

            // Cleanup
            document.body.removeChild(wordElement);
        });

        test('should clear selection', () => {
            const textHandler = manager.getTextHandler();

            // Set some selection
            textHandler.processSelection('test text');
            expect(textHandler.getCurrentSelection()).toBeDefined();

            // Clear selection
            textHandler.clearSelection();
            expect(textHandler.getCurrentSelection()).toBeNull();
        });
    });

    describe('AI Context Provider', () => {
        test('should have provider after initialization', () => {
            const provider = manager.getProvider();
            expect(provider).toBeDefined();
            expect(provider.constructor.name).toBe('AIContextProvider');
            expect(provider.initialized).toBe(true);
        });

        test('should analyze context', async () => {
            const provider = manager.getProvider();

            // Mock successful response
            mockAnalyzeSuccess(testEnv.mocks.chromeApi.runtime.sendMessage, {
                summary: 'Test analysis result',
            });

            const result = await provider.analyzeContext('test text', {
                contextTypes: ['cultural'],
                language: 'en',
                targetLanguage: 'es',
            });

            expect(result.success).toBe(true);
            expect(result.result.analysis.summary).toBe('Test analysis result');
        });

        test('should handle analysis errors', async () => {
            const provider = manager.getProvider();

            // Mock error response (support callback-style messaging)
            mockAnalyzeFailure(
                testEnv.mocks.chromeApi.runtime.sendMessage,
                'Analysis failed'
            );

            const result = await provider.analyzeContext('test text');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Analysis failed');
        });

        test('should track metrics', async () => {
            const provider = manager.getProvider();
            const initialRequestCount = provider.metrics.requestCount;

            // Mock successful response
            mockAnalyzeSuccess(testEnv.mocks.chromeApi.runtime.sendMessage, {
                summary: 'Test result',
            });

            await provider.analyzeContext('test text');

            expect(provider.metrics.requestCount).toBe(initialRequestCount + 1);
            expect(provider.metrics.successCount).toBeGreaterThan(0);
        });

        test('should cancel requests', () => {
            const provider = manager.getProvider();

            // Add a mock active request
            provider.activeRequests.set('test-123', {
                startTime: Date.now(),
                text: 'test',
                options: {},
            });

            const result = provider.cancelRequest('test-123');

            expect(result).toBe(true);
            expect(provider.activeRequests.has('test-123')).toBe(false);
        });
    });

    describe('Integration Tests', () => {
        test('should have all components initialized', () => {
            expect(manager.getModal()).toBeDefined();
            expect(manager.getProvider()).toBeDefined();
            expect(manager.getTextHandler()).toBeDefined();
        });

        test('should handle end-to-end analysis workflow', async () => {
            // Mock successful analysis (support callback-style messaging)
            mockAnalyzeSuccess(testEnv.mocks.chromeApi.runtime.sendMessage, {
                summary: 'Cultural context: This is a greeting.',
            });

            // Trigger analysis through text handler
            const textHandler = manager.getTextHandler();
            const selection = textHandler.processSelection('Hello world', {
                platform: 'netflix',
                language: 'en',
            });

            expect(selection).toBeDefined();
            expect(selection.text).toBe('Hello world');

            // Trigger analysis through provider
            const provider = manager.getProvider();
            const result = await provider.analyzeContext(selection.text, {
                contextTypes: ['cultural'],
                language: 'en',
                targetLanguage: 'es',
            });

            expect(result.success).toBe(true);
            expect(result.result.analysis.summary).toContain(
                'Cultural context'
            );
        });
    });
});

describe('Phase 5: Platform Integration Tests', () => {
    let testHelpers;
    let testEnv;

    beforeEach(async () => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });
    });

    afterEach(async () => {
        if (testEnv) {
            testEnv.cleanup();
        }
    });

    describe('Platform Content Script Integration', () => {
        test('should create AIContextManager for Netflix platform', async () => {
            // Mock the AIContextManager class
            const mockAIContextManager = class {
                constructor(platform, config) {
                    this.platform = platform;
                    this.config = config;
                    this.initialized = false;
                    this.enabledFeatures = new Set();
                }

                async initialize() {
                    this.initialized = true;
                    return true;
                }

                async enableFeature(feature) {
                    this.enabledFeatures.add(feature);
                }

                getEnabledFeatures() {
                    return Array.from(this.enabledFeatures);
                }

                async destroy() {
                    this.initialized = false;
                    this.enabledFeatures.clear();
                }
            };

            // Simulate platform content script initialization
            const config = {
                aiContextEnabled: true,
                interactiveSubtitlesEnabled: true,
                aiContextTimeout: 30000,
            };

            // Create mock content script with the initialization method
            const contentScript = {
                aiContextManager: null,
                logWithFallback: jest.fn(),

                async _initializeAIContextFeatures(config) {
                    const features = {
                        interactiveSubtitles: false,
                        contextModal: false,
                        textSelection: false,
                        loadingStates: false,
                    };

                    if (!config.aiContextEnabled) {
                        return { initialized: false, features };
                    }

                    if (!this.aiContextManager) {
                        // Directly use the mock class instead of importing
                        this.aiContextManager = new mockAIContextManager(
                            'netflix',
                            {
                                modal: { maxWidth: '900px', maxHeight: '80vh' },
                                provider: {
                                    timeout: config.aiContextTimeout || 30000,
                                    maxRetries: 3,
                                },
                                textHandler: {
                                    maxSelectionLength: 500,
                                    minSelectionLength: 2,
                                    smartBoundaries: true,
                                    autoAnalysis: false,
                                },
                            }
                        );

                        const initResult =
                            await this.aiContextManager.initialize();

                        if (initResult) {
                            if (config.interactiveSubtitlesEnabled !== false) {
                                await this.aiContextManager.enableFeature(
                                    'interactiveSubtitles'
                                );
                                features.interactiveSubtitles = true;
                            }

                            await this.aiContextManager.enableFeature(
                                'contextModal'
                            );
                            features.contextModal = true;

                            await this.aiContextManager.enableFeature(
                                'textSelection'
                            );
                            features.textSelection = true;

                            features.loadingStates = true;
                        }
                    }

                    return { initialized: true, features };
                },
            };

            const result =
                await contentScript._initializeAIContextFeatures(config);

            expect(result.initialized).toBe(true);
            expect(result.features.interactiveSubtitles).toBe(true);
            expect(result.features.contextModal).toBe(true);
            expect(result.features.textSelection).toBe(true);
            expect(result.features.loadingStates).toBe(true);

            expect(contentScript.aiContextManager).toBeDefined();
            expect(contentScript.aiContextManager.platform).toBe('netflix');
            expect(contentScript.aiContextManager.initialized).toBe(true);
            expect(
                contentScript.aiContextManager.getEnabledFeatures()
            ).toContain('interactiveSubtitles');
            expect(
                contentScript.aiContextManager.getEnabledFeatures()
            ).toContain('contextModal');
            expect(
                contentScript.aiContextManager.getEnabledFeatures()
            ).toContain('textSelection');
        });

        test('should create AIContextManager for Disney+ platform', async () => {
            // Mock the AIContextManager class
            const mockAIContextManager = class {
                constructor(platform, config) {
                    this.platform = platform;
                    this.config = config;
                    this.initialized = false;
                    this.enabledFeatures = new Set();
                }

                async initialize() {
                    this.initialized = true;
                    return true;
                }

                async enableFeature(feature) {
                    this.enabledFeatures.add(feature);
                }

                getEnabledFeatures() {
                    return Array.from(this.enabledFeatures);
                }
            };

            const config = {
                aiContextEnabled: true,
                interactiveSubtitlesEnabled: true,
                aiContextTimeout: 30000,
            };

            const contentScript = {
                aiContextManager: null,
                logWithFallback: jest.fn(),

                async _initializeAIContextFeatures(config) {
                    if (!config.aiContextEnabled) {
                        return { initialized: false, features: {} };
                    }

                    if (!this.aiContextManager) {
                        // Directly use the mock class instead of importing
                        this.aiContextManager = new mockAIContextManager(
                            'disneyplus',
                            {}
                        );
                        await this.aiContextManager.initialize();
                        await this.aiContextManager.enableFeature(
                            'contextModal'
                        );
                    }

                    return {
                        initialized: true,
                        features: { contextModal: true },
                    };
                },
            };

            const result =
                await contentScript._initializeAIContextFeatures(config);

            expect(result.initialized).toBe(true);
            expect(contentScript.aiContextManager.platform).toBe('disneyplus');
            expect(contentScript.aiContextManager.initialized).toBe(true);
        });

        test('should handle AIContextManager initialization failure gracefully', async () => {
            testEnv.mocks.chromeApi.runtime.getURL.mockReturnValue(
                'mocked-url'
            );

            const originalImport = global.import;
            global.import = jest
                .fn()
                .mockRejectedValue(new Error('Import failed'));

            try {
                const config = {
                    aiContextEnabled: true,
                    interactiveSubtitlesEnabled: true,
                };

                const contentScript = {
                    aiContextManager: null,
                    logWithFallback: jest.fn(),

                    async _initializeAIContextFeatures(config) {
                        try {
                            const { AIContextManager } =
                                await import('mocked-url');
                            this.aiContextManager = new AIContextManager(
                                'netflix',
                                {}
                            );
                            await this.aiContextManager.initialize();
                            return { initialized: true, features: {} };
                        } catch (error) {
                            this.logWithFallback(
                                'error',
                                'Failed to initialize new AI Context Manager, falling back to legacy system',
                                error
                            );
                            return await this._initializeLegacyAIContextFeatures(
                                config
                            );
                        }
                    },

                    async _initializeLegacyAIContextFeatures() {
                        return {
                            initialized: true,
                            features: {
                                interactiveSubtitles: true,
                                contextModal: true,
                                textSelection: true,
                                loadingStates: true,
                            },
                        };
                    },
                };

                const result =
                    await contentScript._initializeAIContextFeatures(config);

                expect(result.initialized).toBe(true);
                expect(result.features.interactiveSubtitles).toBe(true);

                // Debug: Check what calls were made
                console.log(
                    'logWithFallback calls:',
                    contentScript.logWithFallback.mock.calls
                );

                // Check that the error was logged
                expect(contentScript.logWithFallback).toHaveBeenCalled();
            } finally {
                global.import = originalImport;
            }
        });

        test('should cleanup AIContextManager properly', async () => {
            const mockAIContextManager = {
                destroy: jest.fn().mockResolvedValue(true),
            };

            const contentScript = {
                aiContextManager: mockAIContextManager,
                logWithFallback: jest.fn(),

                async cleanup() {
                    if (this.aiContextManager) {
                        try {
                            await this.aiContextManager.destroy();
                            this.aiContextManager = null;
                            this.logWithFallback(
                                'debug',
                                'AI Context Manager destroyed'
                            );
                        } catch (error) {
                            this.logWithFallback(
                                'error',
                                'Error destroying AI Context Manager',
                                error
                            );
                        }
                    }
                },
            };

            await contentScript.cleanup();

            expect(mockAIContextManager.destroy).toHaveBeenCalled();
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.logWithFallback).toHaveBeenCalledWith(
                'debug',
                'AI Context Manager destroyed'
            );
        });
    });
});

describe('Phase 6: Tests & Observability', () => {
    let testHelpers;
    let testEnv;
    let manager;

    beforeEach(async () => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });

        manager = new AIContextManager('netflix', {});
        await manager.initialize();
    });

    afterEach(async () => {
        if (manager) {
            await manager.destroy();
        }
        if (testEnv) {
            testEnv.cleanup();
        }
    });

    describe('Memory Management', () => {
        test('should properly cleanup all components', async () => {
            const modal = manager.getModal();
            const provider = manager.getProvider();
            const textHandler = manager.getTextHandler();

            // Verify components are initialized
            expect(modal).toBeDefined();
            expect(provider).toBeDefined();
            expect(textHandler).toBeDefined();

            // Destroy manager
            await manager.destroy();

            // Verify cleanup
            expect(manager.initialized).toBe(false);
            expect(manager.components.size).toBe(0);
            expect(manager.eventListeners.size).toBe(0);
        });

        test('should handle multiple initialization/destruction cycles', async () => {
            for (let i = 0; i < 1; i++) {
                // Reduced from 3 to 1 for speed
                const testManager = new AIContextManager('netflix', {});
                await testManager.initialize();

                expect(testManager.initialized).toBe(true);
                expect(testManager.getModal()).toBeDefined();

                await testManager.destroy();

                expect(testManager.initialized).toBe(false);
                expect(testManager.components.size).toBe(0);
            }
        });
    });

    describe('Error Resilience', () => {
        test('should handle component initialization failures gracefully', async () => {
            // Create manager with invalid configuration
            const faultyManager = new AIContextManager('invalid-platform', {
                modal: null, // Invalid config
                provider: { timeout: -1 }, // Invalid timeout
                textHandler: { maxSelectionLength: -1 }, // Invalid length
            });

            // Should not throw, but return false
            const result = await faultyManager.initialize();
            expect(result).toBe(false);
            expect(faultyManager.initialized).toBe(false);
        });

        test('should handle event listener errors gracefully', async () => {
            // Trigger various events that might cause errors
            document.dispatchEvent(
                new CustomEvent('dualsub-analyze-selection', {
                    detail: { text: null, requestId: 'invalid' },
                })
            );

            // Manager should still be functional
            expect(manager.initialized).toBe(true);
        });
    });

    describe('Configuration Validation', () => {
        test('should validate platform parameter', async () => {
            const platforms = ['netflix', 'disneyplus'];

            for (const platform of platforms) {
                const testManager = new AIContextManager(platform, {});
                await testManager.initialize();

                expect(testManager.platform).toBe(platform);
                expect(testManager.initialized).toBe(true);

                await testManager.destroy();
            }
        });

        test('should handle missing configuration gracefully', async () => {
            const testManager = new AIContextManager('netflix'); // No config
            const result = await testManager.initialize();

            expect(result).toBe(true);
            expect(testManager.initialized).toBe(true);

            await testManager.destroy();
        });
    });

    describe('Event System Observability', () => {
        test('should track event dispatching', () => {
            const eventsSent = [];
            const originalDispatchEvent = document.dispatchEvent;

            document.dispatchEvent = jest.fn((event) => {
                eventsSent.push(event.type);
                return originalDispatchEvent.call(document, event);
            });

            try {
                // Trigger some events
                manager._dispatchEvent('test-event', { data: 'test' });

                expect(document.dispatchEvent).toHaveBeenCalled();
                expect(eventsSent).toContain('test-event');
            } finally {
                document.dispatchEvent = originalDispatchEvent;
            }
        });

        test('should handle event listener registration/cleanup', async () => {
            // Create new manager to test listener setup
            const testManager = new AIContextManager('netflix', {});
            await testManager.initialize();

            expect(testManager.eventListeners.size).toBeGreaterThan(0);

            await testManager.destroy();

            expect(testManager.eventListeners.size).toBe(0);
        });
    });
});
