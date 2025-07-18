/**
 * Content Script Utilities Tests
 * 
 * Tests for shared utility functions including video detection,
 * event handling, configuration processing, and navigation helpers.
 */

import { jest } from '@jest/globals';
import {
    startVideoDetection,
    detectUrlChange,
    injectScript,
    EventBuffer,
    analyzeConfigChanges,
    onDOMReady,
    waitForElement,
    debounce,
    throttle,
    detectPlatform,
    isExtensionContextValid,
    safeChromeApiCall,
    IntervalManager,
    DEFAULT_PLATFORM_CONFIGS
} from './contentScriptUtils.js';
import { TestHelpers } from '../test-utils/test-helpers.js';

describe('Content Script Utilities', () => {
    let testHelpers;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testHelpers.setupTestEnvironment();
        jest.clearAllMocks();
    });

    afterEach(() => {
        testHelpers.mockRegistry.cleanup();
    });

    describe('startVideoDetection', () => {
        test('should call onSuccess immediately if video element found', () => {
            const mockVideo = document.createElement('video');
            const getVideoElement = jest.fn().mockReturnValue(mockVideo);
            const onSuccess = jest.fn();
            const onFailure = jest.fn();

            const result = startVideoDetection(getVideoElement, 5, 100, onSuccess, onFailure);

            expect(result).toBeNull();
            expect(onSuccess).toHaveBeenCalledWith(mockVideo);
            expect(onFailure).not.toHaveBeenCalled();
        });

        test('should retry and call onSuccess when video element found', (done) => {
            let callCount = 0;
            const mockVideo = document.createElement('video');
            const getVideoElement = jest.fn(() => {
                callCount++;
                return callCount >= 3 ? mockVideo : null;
            });
            const onSuccess = jest.fn((video) => {
                expect(video).toBe(mockVideo);
                expect(callCount).toBe(3);
                done();
            });

            startVideoDetection(getVideoElement, 5, 50, onSuccess);
        });

        test('should call onFailure after max retries', (done) => {
            const getVideoElement = jest.fn().mockReturnValue(null);
            const onFailure = jest.fn(() => {
                expect(getVideoElement).toHaveBeenCalledTimes(3); // Initial + 2 retries
                done();
            });

            startVideoDetection(getVideoElement, 2, 50, () => {}, onFailure);
        });
    });

    describe('detectUrlChange', () => {
        test('should detect URL change', () => {
            const originalUrl = 'https://example.com/page1';
            const onUrlChange = jest.fn();

            // Mock location change
            Object.defineProperty(window, 'location', {
                value: {
                    href: 'https://example.com/page2',
                    pathname: '/page2'
                },
                writable: true
            });

            const result = detectUrlChange(originalUrl, onUrlChange);

            expect(result).toBe('https://example.com/page2');
            expect(onUrlChange).toHaveBeenCalledWith('https://example.com/page2', '/page2');
        });

        test('should return null when URL unchanged', () => {
            const currentUrl = 'https://example.com/page1';
            const onUrlChange = jest.fn();

            Object.defineProperty(window, 'location', {
                value: {
                    href: currentUrl,
                    pathname: '/page1'
                },
                writable: true
            });

            const result = detectUrlChange(currentUrl, onUrlChange);

            expect(result).toBeNull();
            expect(onUrlChange).not.toHaveBeenCalled();
        });
    });

    describe('injectScript', () => {
        test('should inject script successfully', () => {
            const onLoad = jest.fn();
            const onError = jest.fn();

            const result = injectScript('test-script.js', 'test-script', onLoad, onError);

            expect(result).toBe(true);
            const script = document.getElementById('test-script');
            expect(script).toBeTruthy();
            expect(script.src).toBe('test-script.js');

            // Simulate load event
            script.onload();
            expect(onLoad).toHaveBeenCalled();
        });

        test('should not inject script if already exists', () => {
            // Create existing script
            const existingScript = document.createElement('script');
            existingScript.id = 'test-script';
            document.head.appendChild(existingScript);

            const result = injectScript('test-script.js', 'test-script');

            expect(result).toBe(false);
        });

        test('should handle injection errors', () => {
            const onError = jest.fn();
            
            // Mock createElement to throw error
            const originalCreateElement = document.createElement;
            document.createElement = jest.fn().mockImplementation(() => {
                throw new Error('Test error');
            });

            const result = injectScript('test-script.js', 'test-script', () => {}, onError);

            expect(result).toBe(false);
            expect(onError).toHaveBeenCalled();

            // Restore
            document.createElement = originalCreateElement;
        });
    });

    describe('EventBuffer', () => {
        let eventBuffer;

        beforeEach(() => {
            eventBuffer = new EventBuffer();
        });

        test('should add and process events', () => {
            const processor = jest.fn();
            const event1 = { type: 'test', data: 'data1' };
            const event2 = { type: 'test', data: 'data2' };

            eventBuffer.add(event1);
            eventBuffer.add(event2);

            expect(eventBuffer.size()).toBe(2);

            eventBuffer.processAll(processor);

            expect(processor).toHaveBeenCalledTimes(2);
            expect(processor).toHaveBeenCalledWith(event1, 0);
            expect(processor).toHaveBeenCalledWith(event2, 1);
            expect(eventBuffer.size()).toBe(0);
        });

        test('should handle processing errors gracefully', () => {
            const processor = jest.fn().mockImplementation(() => {
                throw new Error('Processing error');
            });
            const event = { type: 'test', data: 'data' };

            eventBuffer.add(event);
            
            expect(() => eventBuffer.processAll(processor)).not.toThrow();
            expect(eventBuffer.size()).toBe(0);
        });

        test('should clear all events', () => {
            eventBuffer.add({ type: 'test1' });
            eventBuffer.add({ type: 'test2' });

            expect(eventBuffer.size()).toBe(2);

            eventBuffer.clear();

            expect(eventBuffer.size()).toBe(0);
        });
    });

    describe('analyzeConfigChanges', () => {
        test('should identify functional and UI-only changes', () => {
            const oldConfig = {
                subtitleFontSize: '2.0',
                translationProvider: 'google',
                appearanceAccordionOpen: false,
                debugMode: false
            };

            const newConfig = {
                subtitleFontSize: '2.5',
                translationProvider: 'google',
                appearanceAccordionOpen: true,
                debugMode: true
            };

            const uiOnlySettings = ['appearanceAccordionOpen'];

            const analysis = analyzeConfigChanges(oldConfig, newConfig, uiOnlySettings);

            expect(analysis.hasChanges).toBe(true);
            expect(analysis.hasFunctionalChanges).toBe(true);
            expect(analysis.hasUiOnlyChanges).toBe(true);
            expect(Object.keys(analysis.functionalChanges)).toEqual(['subtitleFontSize', 'debugMode']);
            expect(Object.keys(analysis.uiOnlyChanges)).toEqual(['appearanceAccordionOpen']);
        });

        test('should handle no changes', () => {
            const config = { setting1: 'value1', setting2: 'value2' };
            const analysis = analyzeConfigChanges(config, config);

            expect(analysis.hasChanges).toBe(false);
            expect(analysis.hasFunctionalChanges).toBe(false);
            expect(analysis.hasUiOnlyChanges).toBe(false);
        });
    });

    describe('onDOMReady', () => {
        test('should execute callback immediately if DOM ready', () => {
            const callback = jest.fn();
            
            // Mock DOM ready state
            Object.defineProperty(document, 'readyState', {
                value: 'complete',
                writable: true
            });

            onDOMReady(callback);

            expect(callback).toHaveBeenCalled();
        });

        test('should wait for DOM ready event if loading', () => {
            const callback = jest.fn();
            
            // Mock DOM loading state
            Object.defineProperty(document, 'readyState', {
                value: 'loading',
                writable: true
            });

            const addEventListenerSpy = jest.spyOn(document, 'addEventListener');

            onDOMReady(callback);

            expect(callback).not.toHaveBeenCalled();
            expect(addEventListenerSpy).toHaveBeenCalledWith('DOMContentLoaded', callback);
        });
    });

    describe('waitForElement', () => {
        test('should find element immediately if exists', async () => {
            const testElement = document.createElement('div');
            testElement.id = 'test-element';
            document.body.appendChild(testElement);

            const result = await waitForElement('#test-element', 3, 100);

            expect(result).toBe(testElement);
        });

        test('should return null if element not found after retries', async () => {
            const result = await waitForElement('#non-existent', 2, 50);

            expect(result).toBeNull();
        });

        test('should find element after retry', async () => {
            const testElement = document.createElement('div');
            testElement.id = 'delayed-element';

            // Add element after delay
            setTimeout(() => {
                document.body.appendChild(testElement);
            }, 100);

            const result = await waitForElement('#delayed-element', 5, 150);

            expect(result).toBe(testElement);
        });
    });

    describe('debounce', () => {
        test('should debounce function calls', (done) => {
            const mockFn = jest.fn();
            const debouncedFn = debounce(mockFn, 100);

            debouncedFn('call1');
            debouncedFn('call2');
            debouncedFn('call3');

            // Should not be called immediately
            expect(mockFn).not.toHaveBeenCalled();

            setTimeout(() => {
                expect(mockFn).toHaveBeenCalledTimes(1);
                expect(mockFn).toHaveBeenCalledWith('call3');
                done();
            }, 150);
        });
    });

    describe('throttle', () => {
        test('should throttle function calls', (done) => {
            const mockFn = jest.fn();
            const throttledFn = throttle(mockFn, 100);

            throttledFn('call1');
            throttledFn('call2');
            throttledFn('call3');

            // Should be called immediately for first call
            expect(mockFn).toHaveBeenCalledTimes(1);
            expect(mockFn).toHaveBeenCalledWith('call1');

            setTimeout(() => {
                throttledFn('call4');
                expect(mockFn).toHaveBeenCalledTimes(2);
                expect(mockFn).toHaveBeenCalledWith('call4');
                done();
            }, 150);
        });
    });

    describe('detectPlatform', () => {
        test('should detect platform from URL', () => {
            const platformPatterns = {
                netflix: ['.*\\.netflix\\.com.*'],
                disneyplus: ['.*\\.disneyplus\\.com.*']
            };

            expect(detectPlatform('https://www.netflix.com/watch/123', platformPatterns)).toBe('netflix');
            expect(detectPlatform('https://www.disneyplus.com/video/456', platformPatterns)).toBe('disneyplus');
            expect(detectPlatform('https://www.youtube.com/watch?v=789', platformPatterns)).toBeNull();
        });
    });

    describe('isExtensionContextValid', () => {
        test('should return true when chrome runtime is available', () => {
            global.chrome = {
                runtime: {
                    id: 'test-extension-id'
                }
            };

            expect(isExtensionContextValid()).toBe(true);
        });

        test('should return false when chrome runtime is not available', () => {
            global.chrome = undefined;

            expect(isExtensionContextValid()).toBe(false);
        });
    });

    describe('safeChromeApiCall', () => {
        test('should call API successfully', () => {
            global.chrome = {
                runtime: { id: 'test' }
            };

            const mockApiCall = jest.fn().mockReturnValue('success');
            const onSuccess = jest.fn();
            const onError = jest.fn();

            safeChromeApiCall(mockApiCall, ['arg1', 'arg2'], onSuccess, onError);

            expect(mockApiCall).toHaveBeenCalledWith('arg1', 'arg2');
            expect(onSuccess).toHaveBeenCalledWith('success');
            expect(onError).not.toHaveBeenCalled();
        });

        test('should handle invalid extension context', () => {
            global.chrome = undefined;

            const mockApiCall = jest.fn();
            const onSuccess = jest.fn();
            const onError = jest.fn();

            safeChromeApiCall(mockApiCall, [], onSuccess, onError);

            expect(mockApiCall).not.toHaveBeenCalled();
            expect(onSuccess).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('IntervalManager', () => {
        let intervalManager;

        beforeEach(() => {
            intervalManager = new IntervalManager();
        });

        afterEach(() => {
            intervalManager.clearAll();
        });

        test('should set and clear intervals', () => {
            const callback = jest.fn();
            const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue(123);
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

            const result = intervalManager.set('test', callback, 1000);

            expect(result).toBe(true);
            expect(setIntervalSpy).toHaveBeenCalledWith(callback, 1000);
            expect(intervalManager.count()).toBe(1);

            intervalManager.clear('test');

            expect(clearIntervalSpy).toHaveBeenCalledWith(123);
            expect(intervalManager.count()).toBe(0);

            setIntervalSpy.mockRestore();
            clearIntervalSpy.mockRestore();
        });

        test('should clear all intervals', () => {
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            
            intervalManager.set('test1', () => {}, 1000);
            intervalManager.set('test2', () => {}, 2000);

            expect(intervalManager.count()).toBe(2);

            intervalManager.clearAll();

            expect(intervalManager.count()).toBe(0);
            expect(clearIntervalSpy).toHaveBeenCalledTimes(2);

            clearIntervalSpy.mockRestore();
        });
    });

    describe('DEFAULT_PLATFORM_CONFIGS', () => {
        test('should have correct platform configurations', () => {
            expect(DEFAULT_PLATFORM_CONFIGS.netflix).toBeDefined();
            expect(DEFAULT_PLATFORM_CONFIGS.disneyplus).toBeDefined();

            expect(DEFAULT_PLATFORM_CONFIGS.netflix.name).toBe('netflix');
            expect(DEFAULT_PLATFORM_CONFIGS.netflix.injectScript.filename).toBe('injected_scripts/netflixInject.js');
            expect(DEFAULT_PLATFORM_CONFIGS.netflix.navigation.spaHandling).toBe(true);

            expect(DEFAULT_PLATFORM_CONFIGS.disneyplus.name).toBe('disneyplus');
            expect(DEFAULT_PLATFORM_CONFIGS.disneyplus.injectScript.filename).toBe('injected_scripts/disneyPlusInject.js');
            expect(DEFAULT_PLATFORM_CONFIGS.disneyplus.navigation.spaHandling).toBe(false);
        });
    });
});