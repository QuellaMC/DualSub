import { jest } from '@jest/globals';
import * as contentScriptUtils from '../core/utils.js';

const { EventBuffer, IntervalManager, injectScript, logWithFallback } =
    contentScriptUtils;

describe('active content-script runtime utilities', () => {
    afterEach(() => {
        document
            .querySelectorAll('script[id^="content-script-utils-test-"]')
            .forEach((script) => script.remove());
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('exports only production-consumed utility seams', () => {
        expect(Object.keys(contentScriptUtils).sort()).toEqual([
            'EventBuffer',
            'IntervalManager',
            'injectScript',
            'logWithFallback',
        ]);
    });

    describe('injectScript', () => {
        test('injects an exact script and reports its load', () => {
            const onLoad = jest.fn();
            const logger = jest.fn();

            expect(
                injectScript(
                    'runtime-test.js',
                    'content-script-utils-test-runtime',
                    onLoad,
                    jest.fn(),
                    logger,
                    true
                )
            ).toBe(true);

            const script = document.getElementById(
                'content-script-utils-test-runtime'
            );
            expect(script?.type).toBe('module');
            expect(script?.src).toContain('runtime-test.js');

            script.onload();
            expect(onLoad).toHaveBeenCalledTimes(1);
        });

        test('does not replace an existing owned script', () => {
            const existing = document.createElement('script');
            existing.id = 'content-script-utils-test-existing';
            document.head.appendChild(existing);

            expect(
                injectScript(
                    'replacement.js',
                    'content-script-utils-test-existing',
                    jest.fn(),
                    jest.fn(),
                    jest.fn()
                )
            ).toBe(false);
            expect(document.getElementById(existing.id)).toBe(existing);
        });

        test('returns false and reports a creation failure', () => {
            const originalCreateElement = document.createElement.bind(document);
            jest.spyOn(document, 'createElement').mockImplementation(
                (tagName) => {
                    if (tagName === 'script') {
                        throw new Error('creation failed');
                    }
                    return originalCreateElement(tagName);
                }
            );
            const onError = jest.fn();

            expect(
                injectScript(
                    'broken.js',
                    'content-script-utils-test-broken',
                    jest.fn(),
                    onError,
                    jest.fn()
                )
            ).toBe(false);
            expect(onError).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('EventBuffer', () => {
        test('buffers and drains current events in insertion order', () => {
            const buffer = new EventBuffer(jest.fn());
            const processor = jest.fn();
            const first = { type: 'first' };
            const second = { type: 'second' };

            buffer.add(first);
            buffer.add(second);
            buffer.processAll(processor);

            expect(processor.mock.calls).toEqual([
                [first, 0],
                [second, 1],
            ]);
            expect(buffer.size()).toBe(0);
        });

        test('drops stale events before processing', () => {
            const buffer = new EventBuffer(jest.fn(), 10, 100);
            const processor = jest.fn();
            buffer.add({ type: 'stale', timestamp: Date.now() - 101 });
            buffer.add({ type: 'current', timestamp: Date.now() });

            buffer.processAll(processor);

            expect(processor).toHaveBeenCalledTimes(1);
            expect(processor).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'current' }),
                0
            );
        });

        test('clears buffered events terminally', () => {
            const buffer = new EventBuffer(jest.fn());
            buffer.add({ type: 'queued' });

            buffer.clear();

            expect(buffer.size()).toBe(0);
        });
    });

    describe('IntervalManager', () => {
        test('owns and clears named intervals', () => {
            jest.useFakeTimers();
            const manager = new IntervalManager();
            const callback = jest.fn();

            expect(manager.set('poll', callback, 100)).toBe(true);
            expect(manager.has('poll')).toBe(true);
            jest.advanceTimersByTime(100);
            expect(callback).toHaveBeenCalledTimes(1);

            manager.clear('poll');
            jest.advanceTimersByTime(100);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(manager.count()).toBe(0);
        });

        test('clears every owned interval', () => {
            jest.useFakeTimers();
            const manager = new IntervalManager();
            manager.set('first', jest.fn(), 100);
            manager.set('second', jest.fn(), 200);

            manager.clearAll();

            expect(manager.count()).toBe(0);
            expect(jest.getTimerCount()).toBe(0);
        });
    });

    test('logWithFallback preserves the startup logger contract', () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});

        logWithFallback('warn', 'startup message', { ready: false }, 'Test');

        expect(log).toHaveBeenCalledWith('[Test] [WARN] startup message', {
            ready: false,
        });
    });
});
