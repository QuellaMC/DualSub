/**
 * EventUtils Tests
 * 
 * Tests for the shared event listener management and cleanup utilities.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { 
    EventListenerManager, 
    EventDebouncer, 
    CustomEventDispatcher,
    createPlatformEventManager,
    createEventDebouncer,
    createPlatformEventDispatcher
} from '../shared/eventUtils.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';

describe('EventListenerManager', () => {
    let testHelpers;
    let testEnv;
    let eventManager;
    let mockLogger;
    let testElement;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: false,
            enableLocation: false,
            enableChromeApi: false
        });

        mockLogger = jest.fn();
        eventManager = new EventListenerManager('netflix', {
            logger: mockLogger,
            useAbortController: true
        });

        testElement = document.createElement('div');
        document.body.appendChild(testElement);
    });

    afterEach(() => {
        if (eventManager) {
            eventManager.cleanup();
        }
        if (testElement && testElement.parentNode) {
            document.body.removeChild(testElement);
        }
        testEnv.cleanup();
        testHelpers.resetAllMocks();
    });

    describe('Constructor', () => {
        test('should initialize with default options', () => {
            const defaultManager = new EventListenerManager('netflix');
            
            expect(defaultManager.platform).toBe('netflix');
            expect(defaultManager.options.useAbortController).toBe(true);
            expect(defaultManager.listeners.size).toBe(0);
            expect(defaultManager.abortController).toBeInstanceOf(AbortController);
        });

        test('should initialize without AbortController when disabled', () => {
            const manager = new EventListenerManager('netflix', {
                useAbortController: false
            });
            
            expect(manager.abortController).toBeNull();
        });
    });

    describe('addEventListener', () => {
        test('should add event listener and return listener ID', () => {
            const handler = jest.fn();
            const listenerId = eventManager.addEventListener(testElement, 'click', handler);

            expect(listenerId).toBeTruthy();
            expect(typeof listenerId).toBe('string');
            expect(eventManager.listeners.has(listenerId)).toBe(true);
            expect(eventManager.getListenerCount()).toBe(1);
        });

        test('should trigger event listener when event occurs', () => {
            const handler = jest.fn();
            eventManager.addEventListener(testElement, 'click', handler);

            testElement.click();

            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should handle listener errors gracefully', () => {
            const errorHandler = jest.fn(() => {
                throw new Error('Test error');
            });
            
            eventManager.addEventListener(testElement, 'click', errorHandler);
            testElement.click();

            expect(mockLogger).toHaveBeenCalledWith('error', '[EventListenerManager:netflix] Error in event listener', expect.any(Object));
        });

        test('should return null for invalid parameters', () => {
            const listenerId1 = eventManager.addEventListener(null, 'click', jest.fn());
            const listenerId2 = eventManager.addEventListener(testElement, 'click', null);

            expect(listenerId1).toBeNull();
            expect(listenerId2).toBeNull();
        });

        test('should add AbortController signal to options', () => {
            const handler = jest.fn();
            const listenerId = eventManager.addEventListener(testElement, 'click', handler);
            
            const listenerInfo = eventManager.listeners.get(listenerId);
            expect(listenerInfo.options.signal).toBe(eventManager.abortController.signal);
        });
    });

    describe('removeEventListener', () => {
        test('should remove specific event listener', () => {
            const handler = jest.fn();
            const listenerId = eventManager.addEventListener(testElement, 'click', handler);

            const success = eventManager.removeEventListener(listenerId);

            expect(success).toBe(true);
            expect(eventManager.listeners.has(listenerId)).toBe(false);
            expect(eventManager.getListenerCount()).toBe(0);

            // Event should no longer trigger
            testElement.click();
            expect(handler).not.toHaveBeenCalled();
        });

        test('should return false for non-existent listener', () => {
            const success = eventManager.removeEventListener('non-existent-id');
            
            expect(success).toBe(false);
            expect(mockLogger).toHaveBeenCalledWith('warn', '[EventListenerManager:netflix] Listener not found for removal', { listenerId: 'non-existent-id' });
        });
    });

    describe('removeListenersForTarget', () => {
        test('should remove all listeners for specific target', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const otherElement = document.createElement('div');

            eventManager.addEventListener(testElement, 'click', handler1);
            eventManager.addEventListener(testElement, 'focus', handler2);
            eventManager.addEventListener(otherElement, 'click', jest.fn());

            const removedCount = eventManager.removeListenersForTarget(testElement);

            expect(removedCount).toBe(2);
            expect(eventManager.getListenerCount()).toBe(1);
        });
    });

    describe('removeListenersByType', () => {
        test('should remove all listeners of specific type', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const handler3 = jest.fn();

            eventManager.addEventListener(testElement, 'click', handler1);
            eventManager.addEventListener(testElement, 'click', handler2);
            eventManager.addEventListener(testElement, 'focus', handler3);

            const removedCount = eventManager.removeListenersByType('click');

            expect(removedCount).toBe(2);
            expect(eventManager.getListenerCount()).toBe(1);
        });
    });

    describe('getActiveListeners', () => {
        test('should return information about active listeners', () => {
            const handler = jest.fn();
            eventManager.addEventListener(testElement, 'click', handler);
            eventManager.addEventListener(document, 'keydown', jest.fn());

            const activeListeners = eventManager.getActiveListeners();

            expect(activeListeners).toHaveLength(2);
            expect(activeListeners[0]).toHaveProperty('id');
            expect(activeListeners[0]).toHaveProperty('type');
            expect(activeListeners[0]).toHaveProperty('targetType');
            expect(activeListeners[0]).toHaveProperty('addedAt');
            expect(activeListeners[0]).toHaveProperty('age');
        });
    });

    describe('cleanup', () => {
        test('should clean up all event listeners', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            
            eventManager.addEventListener(testElement, 'click', handler1);
            eventManager.addEventListener(document, 'keydown', handler2);

            const cleanedCount = eventManager.cleanup();

            expect(cleanedCount).toBe(2);
            expect(eventManager.listeners.size).toBe(0);
            expect(eventManager.abortController).toBeNull();

            // Events should no longer trigger
            testElement.click();
            expect(handler1).not.toHaveBeenCalled();
        });
    });
});

describe('EventDebouncer', () => {
    let debouncer;
    let mockLogger;

    beforeEach(() => {
        mockLogger = jest.fn();
        debouncer = new EventDebouncer({
            logger: mockLogger
        });
        jest.useFakeTimers();
    });

    afterEach(() => {
        if (debouncer) {
            debouncer.cleanup();
        }
        jest.useRealTimers();
    });

    describe('debounce', () => {
        test('should debounce function calls', () => {
            const mockFn = jest.fn();
            const debouncedFn = debouncer.debounce(mockFn, 100);

            // Call multiple times rapidly
            debouncedFn();
            debouncedFn();
            debouncedFn();

            // Should not have been called yet
            expect(mockFn).not.toHaveBeenCalled();

            // Fast-forward time
            jest.advanceTimersByTime(100);

            // Should have been called once
            expect(mockFn).toHaveBeenCalledTimes(1);
        });

        test('should support immediate execution', () => {
            const mockFn = jest.fn();
            const debouncedFn = debouncer.debounce(mockFn, 100, { immediate: true });

            debouncedFn();

            // Should be called immediately
            expect(mockFn).toHaveBeenCalledTimes(1);

            // Additional calls should be debounced
            debouncedFn();
            debouncedFn();

            jest.advanceTimersByTime(100);

            // Should still only be called once
            expect(mockFn).toHaveBeenCalledTimes(1);
        });

        test('should provide cancel method', () => {
            const mockFn = jest.fn();
            const debouncedFn = debouncer.debounce(mockFn, 100);

            debouncedFn();
            debouncedFn.cancel();

            jest.advanceTimersByTime(100);

            expect(mockFn).not.toHaveBeenCalled();
        });

        test('should provide flush method', () => {
            const mockFn = jest.fn();
            const debouncedFn = debouncer.debounce(mockFn, 100);

            debouncedFn();
            debouncedFn.flush();

            expect(mockFn).toHaveBeenCalledTimes(1);
        });
    });

    describe('throttle', () => {
        test('should throttle function calls', () => {
            const mockFn = jest.fn();
            const throttledFn = debouncer.throttle(mockFn, 100);

            // First call should execute immediately
            throttledFn();
            expect(mockFn).toHaveBeenCalledTimes(1);

            // Subsequent calls should be throttled
            throttledFn();
            throttledFn();
            expect(mockFn).toHaveBeenCalledTimes(1);

            // After delay, next call should execute
            jest.advanceTimersByTime(100);
            throttledFn();
            expect(mockFn).toHaveBeenCalledTimes(2);
        });

        test('should provide cancel method', () => {
            const mockFn = jest.fn();
            const throttledFn = debouncer.throttle(mockFn, 100);

            throttledFn();
            throttledFn(); // This should be scheduled
            throttledFn.cancel(); // Cancel the scheduled call

            jest.advanceTimersByTime(100);

            expect(mockFn).toHaveBeenCalledTimes(1);
        });
    });

    describe('cleanup', () => {
        test('should clean up all active timeouts', () => {
            const mockFn = jest.fn();
            const debouncedFn1 = debouncer.debounce(mockFn, 100);
            const debouncedFn2 = debouncer.debounce(mockFn, 200);

            debouncedFn1();
            debouncedFn2();

            const clearedCount = debouncer.cleanup();

            expect(clearedCount).toBe(2);
            expect(debouncer.activeTimeouts.size).toBe(0);

            jest.advanceTimersByTime(300);
            expect(mockFn).not.toHaveBeenCalled();
        });
    });
});

describe('CustomEventDispatcher', () => {
    let dispatcher;
    let mockLogger;

    beforeEach(() => {
        mockLogger = jest.fn();
        dispatcher = new CustomEventDispatcher('netflix', {
            logger: mockLogger
        });
    });

    afterEach(() => {
        if (dispatcher) {
            dispatcher.cleanup();
        }
    });

    describe('addEventListener', () => {
        test('should add event listener and return listener ID', () => {
            const handler = jest.fn();
            const listenerId = dispatcher.addEventListener('test-event', handler);

            expect(listenerId).toBeTruthy();
            expect(typeof listenerId).toBe('string');
            expect(dispatcher.eventListeners.has('test-event')).toBe(true);
        });

        test('should support once option', () => {
            const handler = jest.fn();
            dispatcher.addEventListener('test-event', handler, { once: true });

            dispatcher.dispatchEvent('test-event', 'data1');
            dispatcher.dispatchEvent('test-event', 'data2');

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith('data1');
        });

        test('should return null for invalid listener', () => {
            const listenerId = dispatcher.addEventListener('test-event', null);
            
            expect(listenerId).toBeNull();
            expect(mockLogger).toHaveBeenCalledWith('error', '[CustomEventDispatcher:netflix] Event listener must be a function', { eventType: 'test-event' });
        });
    });

    describe('dispatchEvent', () => {
        test('should dispatch event to all listeners', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            
            dispatcher.addEventListener('test-event', handler1);
            dispatcher.addEventListener('test-event', handler2);

            const notifiedCount = dispatcher.dispatchEvent('test-event', 'test-data');

            expect(notifiedCount).toBe(2);
            expect(handler1).toHaveBeenCalledWith('test-data');
            expect(handler2).toHaveBeenCalledWith('test-data');
        });

        test('should return 0 for events with no listeners', () => {
            const notifiedCount = dispatcher.dispatchEvent('non-existent-event', 'data');
            
            expect(notifiedCount).toBe(0);
            expect(mockLogger).toHaveBeenCalledWith('debug', '[CustomEventDispatcher:netflix] No listeners for custom event', { eventType: 'non-existent-event' });
        });

        test('should handle listener errors gracefully', () => {
            const errorHandler = jest.fn(() => {
                throw new Error('Test error');
            });
            const normalHandler = jest.fn();
            
            dispatcher.addEventListener('test-event', errorHandler);
            dispatcher.addEventListener('test-event', normalHandler);

            const notifiedCount = dispatcher.dispatchEvent('test-event', 'data');

            expect(notifiedCount).toBe(2); // Both handlers are attempted, but one fails
            expect(normalHandler).toHaveBeenCalledWith('data');
            expect(mockLogger).toHaveBeenCalledWith('error', '[CustomEventDispatcher:netflix] Error in custom event listener', expect.any(Object));
        });

        test('should support async dispatch', (done) => {
            const handler = jest.fn();
            dispatcher.addEventListener('test-event', handler);

            dispatcher.dispatchEvent('test-event', 'data', { async: true });

            // Handler should not be called immediately
            expect(handler).not.toHaveBeenCalled();

            // Should be called asynchronously
            setTimeout(() => {
                expect(handler).toHaveBeenCalledWith('data');
                done();
            }, 10);
        });
    });

    describe('removeEventListener', () => {
        test('should remove specific event listener', () => {
            const handler = jest.fn();
            const listenerId = dispatcher.addEventListener('test-event', handler);

            const success = dispatcher.removeEventListener('test-event', listenerId);

            expect(success).toBe(true);
            
            dispatcher.dispatchEvent('test-event', 'data');
            expect(handler).not.toHaveBeenCalled();
        });

        test('should return false for non-existent listener', () => {
            const success = dispatcher.removeEventListener('test-event', 'non-existent-id');
            
            expect(success).toBe(false);
            expect(mockLogger).toHaveBeenCalledWith('warn', '[CustomEventDispatcher:netflix] Custom event listener not found', expect.any(Object));
        });
    });

    describe('getListeners', () => {
        test('should return listener information', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            
            dispatcher.addEventListener('test-event', handler1);
            dispatcher.addEventListener('test-event', handler2, { once: true });

            const listeners = dispatcher.getListeners('test-event');

            expect(listeners).toHaveLength(2);
            expect(listeners[0]).toHaveProperty('id');
            expect(listeners[0]).toHaveProperty('eventType', 'test-event');
            expect(listeners[0]).toHaveProperty('once', false);
            expect(listeners[1]).toHaveProperty('once', true);
        });

        test('should return empty array for non-existent event type', () => {
            const listeners = dispatcher.getListeners('non-existent-event');
            expect(listeners).toEqual([]);
        });
    });

    describe('getEventHistory', () => {
        test('should track event history', () => {
            // Add a listener so events are dispatched
            dispatcher.addEventListener('event1', jest.fn());
            dispatcher.addEventListener('event2', jest.fn());
            
            dispatcher.dispatchEvent('event1', 'data1');
            dispatcher.dispatchEvent('event2', 'data2');

            const history = dispatcher.getEventHistory();

            expect(history).toHaveLength(2);
            expect(history[0]).toHaveProperty('type', 'event1');
            expect(history[0]).toHaveProperty('data', 'data1');
            expect(history[1]).toHaveProperty('type', 'event2');
            expect(history[1]).toHaveProperty('data', 'data2');
        });

        test('should filter history by event type', () => {
            // Add listeners so events are dispatched
            dispatcher.addEventListener('event1', jest.fn());
            dispatcher.addEventListener('event2', jest.fn());
            
            dispatcher.dispatchEvent('event1', 'data1');
            dispatcher.dispatchEvent('event2', 'data2');
            dispatcher.dispatchEvent('event1', 'data3');

            const history = dispatcher.getEventHistory('event1');

            expect(history).toHaveLength(2);
            expect(history[0]).toHaveProperty('type', 'event1');
            expect(history[1]).toHaveProperty('type', 'event1');
        });

        test('should limit history results', () => {
            // Add a listener so events are dispatched
            dispatcher.addEventListener('event1', jest.fn());
            
            dispatcher.dispatchEvent('event1', 'data1');
            dispatcher.dispatchEvent('event1', 'data2');
            dispatcher.dispatchEvent('event1', 'data3');

            const history = dispatcher.getEventHistory(null, 2);

            expect(history).toHaveLength(2);
        });
    });

    describe('cleanup', () => {
        test('should clean up all listeners and history', () => {
            const handler = jest.fn();
            dispatcher.addEventListener('test-event', handler);
            dispatcher.dispatchEvent('test-event', 'data');

            const removedCount = dispatcher.cleanup();

            expect(removedCount).toBe(1);
            expect(dispatcher.eventListeners.size).toBe(0);
            expect(dispatcher.eventHistory).toEqual([]);
        });
    });
});

describe('Factory Functions', () => {
    test('should create platform event manager', () => {
        const manager = createPlatformEventManager('netflix', {
            logger: jest.fn()
        });
        
        expect(manager).toBeInstanceOf(EventListenerManager);
        expect(manager.platform).toBe('netflix');
        expect(manager.options.useAbortController).toBe(true);
        
        manager.cleanup();
    });

    test('should create event debouncer', () => {
        const debouncer = createEventDebouncer({
            logger: jest.fn()
        });
        
        expect(debouncer).toBeInstanceOf(EventDebouncer);
        
        debouncer.cleanup();
    });

    test('should create platform event dispatcher', () => {
        const dispatcher = createPlatformEventDispatcher('disneyplus', {
            logger: jest.fn()
        });
        
        expect(dispatcher).toBeInstanceOf(CustomEventDispatcher);
        expect(dispatcher.platform).toBe('disneyplus');
        
        dispatcher.cleanup();
    });
});