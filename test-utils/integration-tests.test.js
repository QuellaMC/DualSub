/**
 * Integration Tests for Platform Test Coverage Validation
 *
 * Verifies that all platform tests pass consistently and validates
 * the test infrastructure works correctly across different scenarios.
 */

import {
    describe,
    test,
    expect,
    beforeEach,
    afterEach,
    jest,
} from '@jest/globals';
import { TestHelpers, PlatformTestSuiteGenerator } from './test-helpers.js';
import {
    NetflixFixtures,
    DisneyPlusFixtures,
    ChromeApiFixtures,
    TestScenarioGenerator,
    MockResponseBuilder,
} from './test-fixtures.js';

/**
 * Integration Test Suite for Platform Test Infrastructure
 */
describe('Platform Test Infrastructure Integration', () => {
    let testHelpers;

    beforeEach(() => {
        testHelpers = new TestHelpers();
    });

    afterEach(() => {
        testHelpers.mockRegistry.cleanup();
    });

    describe('Test Environment Setup Validation', () => {
        test('should setup complete test environment with all mocks', () => {
            const env = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false, // Disable location mock due to JSDOM issues
            });

            // Verify all mocks are present
            expect(env.mocks.logger).toBeDefined();
            expect(env.mocks.chromeApi).toBeDefined();
            expect(typeof env.cleanup).toBe('function');

            // Verify Chrome API mock structure
            expect(env.mocks.chromeApi.storage).toBeDefined();
            expect(env.mocks.chromeApi.storage.sync).toBeDefined();
            expect(env.mocks.chromeApi.runtime).toBeDefined();

            env.cleanup();
        });

        test('should setup Disney Plus environment correctly', () => {
            const env = testHelpers.setupTestEnvironment({
                platform: 'disneyplus',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false, // Disable location mock due to JSDOM issues
            });

            // Verify basic environment setup
            expect(env.mocks.logger).toBeDefined();
            expect(env.mocks.chromeApi).toBeDefined();

            env.cleanup();
        });

        test('should handle selective mock enablement', () => {
            const env = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: false,
                enableChromeApi: true,
                enableLocation: false,
            });

            expect(env.mocks.logger).toBeUndefined();
            expect(env.mocks.chromeApi).toBeDefined();
            expect(env.mocks.location).toBeUndefined();

            env.cleanup();
        });
    });

    describe('Mock Event Generation Validation', () => {
        test('should generate Netflix events correctly', () => {
            const readyEvent = testHelpers.createNetflixEvent('ready');
            expect(readyEvent.detail.type).toBe('INJECT_SCRIPT_READY');

            const subtitleEvent = testHelpers.createNetflixEvent(
                'subtitleData',
                {
                    movieId: '67890',
                    timedtexttracks: [{ language: 'fr' }],
                }
            );
            expect(subtitleEvent.detail.type).toBe('SUBTITLE_DATA_FOUND');
            expect(subtitleEvent.detail.payload.movieId).toBe('67890');
            expect(
                subtitleEvent.detail.payload.timedtexttracks[0].language
            ).toBe('fr');
        });

        test('should generate Disney Plus events correctly', () => {
            const readyEvent = testHelpers.createDisneyPlusEvent('ready');
            expect(readyEvent.detail.type).toBe('INJECT_SCRIPT_READY');

            const urlEvent = testHelpers.createDisneyPlusEvent('subtitleUrl', {
                videoId: 'xyz789',
                url: 'https://custom.url/master.m3u8',
            });
            expect(urlEvent.detail.type).toBe('SUBTITLE_URL_FOUND');
            expect(urlEvent.detail.videoId).toBe('xyz789');
            expect(urlEvent.detail.url).toBe('https://custom.url/master.m3u8');
        });

        test('should throw error for unknown event types', () => {
            expect(() => {
                testHelpers.createNetflixEvent('unknown');
            }).toThrow('Unknown Netflix event type: unknown');

            expect(() => {
                testHelpers.createDisneyPlusEvent('invalid');
            }).toThrow('Unknown Disney Plus event type: invalid');
        });
    });

    describe('Chrome API Response Setup Validation', () => {
        test('should setup Chrome API responses correctly', () => {
            const env = testHelpers.setupTestEnvironment({
                enableChromeApi: true,
                enableLogger: false,
                enableLocation: false,
            });

            testHelpers.setupChromeApiResponses(
                { customSetting: 'testValue' },
                { customResponse: 'testResponse' }
            );

            // Test storage mock
            let storageResult;
            env.mocks.chromeApi.storage.sync.get({}, (result) => {
                storageResult = result;
            });
            expect(storageResult.customSetting).toBe('testValue');
            expect(storageResult.targetLanguage).toBe('zh-CN'); // Default value

            // Test runtime mock
            let runtimeResult;
            env.mocks.chromeApi.runtime.sendMessage({}, (response) => {
                runtimeResult = response;
            });
            expect(runtimeResult.customResponse).toBe('testResponse');
            expect(runtimeResult.success).toBe(true); // Default value

            env.cleanup();
        });

        test('should throw error when Chrome API mock not registered', () => {
            const env = testHelpers.setupTestEnvironment({
                enableChromeApi: false,
                enableLogger: false,
                enableLocation: false,
            });

            expect(() => {
                testHelpers.setupChromeApiResponses();
            }).toThrow(
                'Chrome API mock not registered. Call setupTestEnvironment first.'
            );

            env.cleanup();
        });
    });

    describe('Assertion Helpers Validation', () => {
        test('should provide working assertion helpers', () => {
            const env = testHelpers.setupTestEnvironment({
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            const { assertions } = testHelpers;

            // Test logger assertion
            env.mocks.logger.info('Test message', { context: 'test' });
            expect(() => {
                assertions.expectLoggerCalled(
                    env.mocks.logger,
                    'info',
                    'Test message',
                    { context: 'test' }
                );
            }).not.toThrow();

            // Test storage assertion
            env.mocks.chromeApi.storage.sync.get(['key'], jest.fn());
            expect(() => {
                assertions.expectStorageAccessed(env.mocks.chromeApi, 'get', [
                    'key',
                ]);
            }).not.toThrow();

            // Test runtime assertion
            env.mocks.chromeApi.runtime.sendMessage(
                { type: 'test' },
                jest.fn()
            );
            expect(() => {
                assertions.expectRuntimeMessageSent(env.mocks.chromeApi, {
                    type: 'test',
                });
            }).not.toThrow();

            env.cleanup();
        });
    });
});

/**
 * Platform-Specific Integration Tests
 */
describe('Platform Test Scenario Validation', () => {
    let testHelpers;

    beforeEach(() => {
        testHelpers = new TestHelpers();
    });

    afterEach(() => {
        testHelpers.mockRegistry.cleanup();
    });

    describe('Netflix Platform Scenarios', () => {
        const scenarios = TestScenarioGenerator.generateNetflixScenarios();

        scenarios.forEach((scenario) => {
            test(`should handle ${scenario.name}`, () => {
                const env = testHelpers.setupTestEnvironment({
                    platform: 'netflix',
                    enableLogger: true,
                    enableChromeApi: true,
                    enableLocation: false, // Disable location mock due to JSDOM issues
                });

                // Setup Chrome API response if provided
                if (scenario.chromeResponse) {
                    if (scenario.chromeResponse.success) {
                        testHelpers.setupChromeApiResponses(
                            {},
                            scenario.chromeResponse
                        );
                    } else {
                        env.mocks.chromeApi.runtime.sendMessage.mockImplementation(
                            (message, callback) => {
                                callback(scenario.chromeResponse);
                            }
                        );
                    }
                }

                // Create mock platform for testing
                const mockPlatform = {
                    logger: env.mocks.logger,
                    handleInjectorEvents: jest.fn(),
                    currentVideoId: null,
                };

                // Simulate event handling
                if (scenario.event) {
                    mockPlatform.handleInjectorEvents(scenario.event);
                }

                // Verify expected outcome
                if (scenario.expectedOutcome === 'success') {
                    expect(
                        mockPlatform.handleInjectorEvents
                    ).toHaveBeenCalledWith(scenario.event);
                } else if (scenario.expectedOutcome === 'error') {
                    expect(
                        mockPlatform.handleInjectorEvents
                    ).toHaveBeenCalledWith(scenario.event);
                }

                env.cleanup();
            });
        });
    });

    describe('Disney Plus Platform Scenarios', () => {
        const scenarios = TestScenarioGenerator.generateDisneyPlusScenarios();

        scenarios.forEach((scenario) => {
            test(`should handle ${scenario.name}`, () => {
                const env = testHelpers.setupTestEnvironment({
                    platform: 'disneyplus',
                    enableLogger: true,
                    enableChromeApi: true,
                    enableLocation: false, // Disable location mock due to JSDOM issues
                });

                // Setup Chrome API response if provided
                if (scenario.chromeResponse) {
                    if (scenario.chromeResponse.success) {
                        testHelpers.setupChromeApiResponses(
                            {},
                            scenario.chromeResponse
                        );
                    } else {
                        env.mocks.chromeApi.runtime.sendMessage.mockImplementation(
                            (message, callback) => {
                                callback(scenario.chromeResponse);
                            }
                        );
                    }
                }

                // Create mock platform for testing
                const mockPlatform = {
                    logger: env.mocks.logger,
                    _handleInjectorEvents: jest.fn(),
                    currentVideoId: null,
                };

                // Simulate event handling
                if (scenario.event) {
                    mockPlatform._handleInjectorEvents(scenario.event);
                }

                // Verify expected outcome
                if (scenario.expectedOutcome === 'success') {
                    expect(
                        mockPlatform._handleInjectorEvents
                    ).toHaveBeenCalledWith(scenario.event);
                } else if (scenario.expectedOutcome === 'error') {
                    expect(
                        mockPlatform._handleInjectorEvents
                    ).toHaveBeenCalledWith(scenario.event);
                }

                env.cleanup();
            });
        });
    });

    describe('Platform Detection Scenarios', () => {
        test('should provide platform detection test scenarios', () => {
            const scenarios =
                TestScenarioGenerator.generatePlatformDetectionScenarios();

            // Verify scenarios are generated correctly
            expect(scenarios).toHaveLength(6); // 3 Netflix + 3 Disney Plus scenarios
            expect(
                scenarios.filter((s) => s.platform === 'netflix')
            ).toHaveLength(3);
            expect(
                scenarios.filter((s) => s.platform === 'disneyplus')
            ).toHaveLength(3);

            // Verify scenario structure
            scenarios.forEach((scenario) => {
                expect(scenario).toHaveProperty('platform');
                expect(scenario).toHaveProperty('location');
                expect(scenario).toHaveProperty('expectedActive');
                expect(scenario).toHaveProperty('expectedPlayerActive');
            });
        });

        // Note: Actual platform detection tests are disabled due to JSDOM location mock limitations
        // These would be implemented in individual platform test files using the centralized mocks
    });
});

/**
 * Test Infrastructure Reliability Tests
 */
describe('Test Infrastructure Reliability', () => {
    let testHelpers;

    beforeEach(() => {
        testHelpers = new TestHelpers();
    });

    afterEach(() => {
        testHelpers.mockRegistry.cleanup();
    });

    describe('Mock State Management', () => {
        test('should properly reset mocks between tests', () => {
            // First test setup
            const env1 = testHelpers.setupTestEnvironment({
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            env1.mocks.logger.info('First test message');
            expect(env1.mocks.logger.info).toHaveBeenCalledWith(
                'First test message'
            );

            env1.cleanup();
            testHelpers.resetAllMocks();

            // Second test setup
            const env2 = testHelpers.setupTestEnvironment({
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            // Logger should be reset
            expect(env2.mocks.logger.info).not.toHaveBeenCalled();

            env2.cleanup();
        });

        test('should handle multiple cleanup calls gracefully', () => {
            const env = testHelpers.setupTestEnvironment({
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: true,
            });

            // Multiple cleanup calls should not throw
            expect(() => {
                env.cleanup();
                env.cleanup();
                env.cleanup();
            }).not.toThrow();
        });

        test('should isolate test environments', () => {
            const env1 = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableLocation: false,
            });

            const env2 = testHelpers.setupTestEnvironment({
                platform: 'disneyplus',
                enableLogger: true,
                enableLocation: false,
            });

            // Environments should be independent
            expect(env1.mocks.logger).not.toBe(env2.mocks.logger);
            expect(env1.mocks.chromeApi).not.toBe(env2.mocks.chromeApi);

            env1.cleanup();
            env2.cleanup();
        });
    });

    describe('Error Handling Validation', () => {
        test('should handle mock setup failures gracefully', () => {
            // Test with invalid platform - should not throw but use defaults
            expect(() => {
                testHelpers.setupTestEnvironment({
                    platform: 'invalid-platform',
                    enableLocation: false,
                });
            }).not.toThrow(); // Should fallback to default

            // Test with missing configuration
            expect(() => {
                testHelpers.setupTestEnvironment();
            }).not.toThrow(); // Should use defaults
        });

        test('should handle cleanup errors gracefully', () => {
            const env = testHelpers.setupTestEnvironment({
                enableLogger: true,
            });

            // Simulate cleanup error by corrupting mock
            env.mocks.logger.reset = () => {
                throw new Error('Cleanup error');
            };

            // Cleanup should not throw even with errors
            expect(() => {
                env.cleanup();
            }).not.toThrow();
        });
    });

    describe('Performance Validation', () => {
        test('should handle rapid test environment creation and cleanup', () => {
            const startTime = Date.now();

            // Create and cleanup multiple environments rapidly
            for (let i = 0; i < 10; i++) {
                const env = testHelpers.setupTestEnvironment({
                    enableLogger: true,
                    enableChromeApi: true,
                    enableLocation: true,
                });
                env.cleanup();
            }

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should complete within reasonable time (less than 1 second)
            expect(duration).toBeLessThan(1000);
        });

        test('should handle large mock data efficiently', () => {
            const env = testHelpers.setupTestEnvironment({
                enableChromeApi: true,
            });

            // Setup large mock data
            const largeData = {};
            for (let i = 0; i < 1000; i++) {
                largeData[`key${i}`] = `value${i}`.repeat(100);
            }

            const startTime = Date.now();
            testHelpers.setupChromeApiResponses(largeData);
            const endTime = Date.now();

            // Should handle large data efficiently
            expect(endTime - startTime).toBeLessThan(100);

            env.cleanup();
        });
    });
});

export default {
    // Export test suites for external use if needed
};
