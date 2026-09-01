import { jest } from '@jest/globals';
import {
    EventBuffer,
    IntervalManager,
    injectScript,
    logWithFallback,
} from '../core/utils.js';

describe('content-script runtime utilities', () => {
    afterEach(() => {
        document
            .querySelectorAll('script[id^="content-script-utils-test-"]')
            .forEach((script) => script.remove());
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('injects one script and reports its lifecycle', () => {
        const onLoad = jest.fn();
        const onError = jest.fn();
        const logger = jest.fn();

        expect(
            injectScript(
                'runtime-test.js',
                'content-script-utils-test-runtime',
                onLoad,
                onError,
                logger,
                true
            )
        ).toBe(true);

        const script = document.getElementById(
            'content-script-utils-test-runtime'
        );
        expect(script.type).toBe('module');
        expect(script.src).toContain('runtime-test.js');

        script.onload();
        expect(onLoad).toHaveBeenCalledTimes(1);

        const loadError = new Error('load failed');
        script.onerror(loadError);
        expect(logger).toHaveBeenCalledWith(
            'Failed to load script content-script-utils-test-runtime',
            loadError
        );
        expect(onError).toHaveBeenCalledWith(loadError);
    });

    test('does not replace an existing script', () => {
        const existing = document.createElement('script');
        existing.id = 'content-script-utils-test-existing';
        document.head.appendChild(existing);

        expect(
            injectScript(
                'replacement.js',
                existing.id,
                jest.fn(),
                jest.fn(),
                jest.fn()
            )
        ).toBe(false);
        expect(document.getElementById(existing.id)).toBe(existing);
    });

    test('buffers current events in insertion order and then drains them', () => {
        const buffer = new EventBuffer(jest.fn());
        const processor = jest.fn();
        buffer.add({ type: 'first' });
        buffer.add({ type: 'second' });

        buffer.processAll(processor);

        expect(processor.mock.calls.map(([event]) => event.type)).toEqual([
            'first',
            'second',
        ]);
        expect(buffer.size()).toBe(0);
    });

    test('bounds the buffer and discards stale events', () => {
        const now = Date.now();
        const buffer = new EventBuffer(jest.fn(), 2, 100);
        buffer.add({ type: 'stale', timestamp: now - 101 });
        buffer.add({ type: 'first', timestamp: now });
        buffer.add({ type: 'second', timestamp: now });
        buffer.add({ type: 'latest', timestamp: now });
        const processor = jest.fn();

        expect(buffer.size()).toBe(2);
        buffer.processAll(processor);

        expect(processor.mock.calls.map(([event]) => event.type)).toEqual([
            'second',
            'latest',
        ]);
    });

    test('isolates one buffered-event failure and continues draining', () => {
        const logger = jest.fn();
        const buffer = new EventBuffer(logger);
        buffer.add({ type: 'first' });
        buffer.add({ type: 'second' });
        const processed = [];

        buffer.processAll((event) => {
            if (event.type === 'first') throw new Error('bad event');
            processed.push(event.type);
        });

        expect(processed).toEqual(['second']);
        expect(logger).toHaveBeenCalledTimes(1);
        expect(buffer.size()).toBe(0);
    });

    test('clears buffered events', () => {
        const buffer = new EventBuffer(jest.fn());
        buffer.add({ type: 'queued' });

        buffer.clear();

        expect(buffer.size()).toBe(0);
    });

    test('replaces and clears named intervals', () => {
        jest.useFakeTimers();
        const manager = new IntervalManager();
        const first = jest.fn();
        const replacement = jest.fn();

        manager.set('poll', first, 100);
        manager.set('poll', replacement, 100);
        jest.advanceTimersByTime(100);

        expect(first).not.toHaveBeenCalled();
        expect(replacement).toHaveBeenCalledTimes(1);

        manager.clear('poll');
        jest.advanceTimersByTime(100);
        expect(replacement).toHaveBeenCalledTimes(1);
    });

    test('clears all managed intervals', () => {
        jest.useFakeTimers();
        const manager = new IntervalManager();
        manager.set('first', jest.fn(), 100);
        manager.set('second', jest.fn(), 200);

        manager.clearAll();

        expect(jest.getTimerCount()).toBe(0);
    });

    test('uses the startup logging contract', () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});

        logWithFallback('warn', 'startup message', { ready: false }, 'Test');

        expect(log).toHaveBeenCalledWith('[Test] [WARN] startup message', {
            ready: false,
        });
    });
});
