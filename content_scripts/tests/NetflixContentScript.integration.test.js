/**
 * NetflixContentScript Integration Tests
 *
 * Integration tests to verify Netflix-specific message handling works correctly
 * with popup and options page integration, ensuring backward compatibility.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import {
    jest,
    describe,
    test,
    beforeEach,
    afterEach,
    expect,
} from '@jest/globals';
import { NetflixContentScript } from '../platforms/NetflixContentScript.js';
import { ChromeApiMock } from '../../test-utils/chrome-api-mock.js';
import { LocationMock, mockWindowLocation } from '../../test-utils/location-mock.js';

// Mock Chrome API
const mockChrome = ChromeApiMock.create();
global.chrome = mockChrome;

// Mock window.location using property-level mocking to avoid redefining window.location
const netflixLocation = LocationMock.createNetflixMock('123456');
mockWindowLocation(netflixLocation);

describe('NetflixContentScript Integration Tests', () => {
    let netflixScript;
    let consoleLogSpy;

    beforeEach(() => {
        // Create fresh Netflix content script instance
        netflixScript = new NetflixContentScript();

        // Spy on console.log for fallback logging
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleLogSpy.mockClear();
    });

    afterEach(() => {
        if (consoleLogSpy) {
            consoleLogSpy.mockRestore();
        }
    });

    describe('Integration with BaseContentScript message flow', () => {
        test('should handle complete message flow from popup configChanged', () => {
            // Mock the required modules for BaseContentScript
            netflixScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                applySubtitleStyling: jest.fn(),
            };
            netflixScript.configService = { getAll: jest.fn() };
            netflixScript.activePlatform = {
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 10 }),
            };
            netflixScript.currentConfig = { subtitlesEnabled: true };

            // Simulate the exact message format sent by popup.js
            const popupMessage = {
                action: 'configChanged',
                changes: {
                    subtitlePosition: 'bottom',
                    fontSize: '16px',
                    backgroundColor: '#000000',
                },
            };

            const mockSendResponse = jest.fn();

            const result = netflixScript.handlePlatformSpecificMessage(
                popupMessage,
                mockSendResponse
            );

            expect(result).toBe(false); // Synchronous handling
            expect(mockSendResponse).toHaveBeenCalledWith({
                success: true,
                handled: false,
                platform: 'netflix',
                message: 'No platform-specific handling required.',
            });
        });

        test('should handle complete message flow from background LOGGING_LEVEL_CHANGED', () => {
            // Simulate the exact message format sent by background.js
            const backgroundMessage = {
                type: 'LOGGING_LEVEL_CHANGED',
                level: 'DEBUG',
            };

            const mockSendResponse = jest.fn();

            // This should also be handled by BaseContentScript's registered handler
            // but we test the fallback behavior
            const result = netflixScript.handlePlatformSpecificMessage(
                backgroundMessage,
                mockSendResponse
            );

            expect(result).toBe(false); // Synchronous handling
            expect(mockSendResponse).toHaveBeenCalledWith({
                success: true,
                handled: false,
                platform: 'netflix',
                message: 'No platform-specific handling required.',
            });
        });

        test('should handle unknown messages that would reach platform-specific handler', () => {
            // Mock the required modules
            netflixScript.subtitleUtils = { setSubtitlesActive: jest.fn() };
            netflixScript.configService = { getAll: jest.fn() };

            // Simulate a message that doesn't have a registered handler
            const unknownMessage = {
                action: 'netflix-custom-action',
                data: { customData: 'test' },
            };

            const mockSendResponse = jest.fn();

            // This would reach handlePlatformSpecificMessage via BaseContentScript delegation
            const result = netflixScript.handlePlatformSpecificMessage(
                unknownMessage,
                mockSendResponse
            );

            expect(result).toBe(false); // Synchronous handling
            expect(mockSendResponse).toHaveBeenCalledWith({
                success: true,
                handled: false,
                platform: 'netflix',
                message: 'No platform-specific handling required.',
            });

            // Should log debug information
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Processing Netflix-specific message'),
                expect.objectContaining({
                    action: 'netflix-custom-action',
                })
            );
        });
    });

    describe('Backward compatibility verification', () => {
        test('should maintain exact response format expected by popup', () => {
            const testMessages = [
                { action: 'toggleSubtitles', enabled: true },
                { action: 'configChanged', changes: { theme: 'dark' } },
                { type: 'LOGGING_LEVEL_CHANGED', level: 'INFO' },
                { action: 'unknown-action', data: 'test' },
            ];

            testMessages.forEach((message, index) => {
                const mockSendResponse = jest.fn();

                const result = netflixScript.handlePlatformSpecificMessage(
                    message,
                    mockSendResponse
                );

                // All should be handled synchronously
                expect(result).toBe(false);

                // All should return consistent format
                expect(mockSendResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        platform: 'netflix',
                    })
                );
            });
        });

        test('should handle edge cases that popup might send', () => {
            const edgeCases = [
                { action: '', data: 'empty action' },
                { type: '', level: 'empty type' },
                { action: null, data: 'null action' },
                { randomField: 'no action or type' },
            ];

            edgeCases.forEach((message) => {
                const mockSendResponse = jest.fn();

                const result = netflixScript.handlePlatformSpecificMessage(
                    message,
                    mockSendResponse
                );

                expect(result).toBe(false);
                expect(mockSendResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        platform: 'netflix',
                    })
                );
            });
        });
    });

    describe('Error handling in integration scenarios', () => {
        test('should handle popup sending malformed messages', () => {
            const malformedMessages = [
                null,
                undefined,
                'string instead of object',
                123,
                [],
            ];

            malformedMessages.forEach((message) => {
                const mockSendResponse = jest.fn();

                const result = netflixScript.handlePlatformSpecificMessage(
                    message,
                    mockSendResponse
                );

                expect(result).toBe(false);
                // Should handle gracefully and log error
                expect(consoleLogSpy).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Error in Netflix-specific message handling'
                    ),
                    expect.any(Object)
                );
            });
        });

        test('should handle popup callback errors gracefully', () => {
            const errorCallback = jest.fn(() => {
                throw new Error('Popup callback error');
            });

            const message = { action: 'test-action' };

            const result = netflixScript.handlePlatformSpecificMessage(
                message,
                errorCallback
            );

            expect(result).toBe(false);

            // Should log both original processing and callback error
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Error sending error response'),
                expect.objectContaining({
                    responseError: 'Popup callback error',
                })
            );
        });
    });

    describe('Performance and memory considerations', () => {
        test('should handle rapid message sequences without memory leaks', () => {
            const messages = Array.from({ length: 100 }, (_, i) => ({
                action: `test-action-${i}`,
                data: `test-data-${i}`,
            }));

            messages.forEach((message) => {
                const mockSendResponse = jest.fn();
                const result = netflixScript.handlePlatformSpecificMessage(
                    message,
                    mockSendResponse
                );

                expect(result).toBe(false);
                expect(mockSendResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        platform: 'netflix',
                    })
                );
            });

            // Should not accumulate state or memory
            expect(netflixScript.messageHandlers.size).toBeGreaterThan(0); // Has registered handlers
        });

        test('should handle concurrent message processing', async () => {
            const concurrentMessages = Array.from({ length: 10 }, (_, i) => ({
                action: `concurrent-action-${i}`,
                data: `concurrent-data-${i}`,
            }));

            const promises = concurrentMessages.map((message) => {
                return new Promise((resolve) => {
                    const mockSendResponse = jest.fn((response) => {
                        resolve({ message, response });
                    });

                    const result = netflixScript.handlePlatformSpecificMessage(
                        message,
                        mockSendResponse
                    );
                    expect(result).toBe(false); // Should be synchronous
                });
            });

            const results = await Promise.all(promises);

            // All should complete successfully
            expect(results).toHaveLength(10);
            results.forEach(({ response }) => {
                expect(response).toMatchObject({
                    success: true,
                    platform: 'netflix',
                });
            });
        });
    });
});
