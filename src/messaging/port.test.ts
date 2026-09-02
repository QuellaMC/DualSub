import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { framePort } from './port';

const frameSchema = z.strictObject({
    action: z.literal('hello'),
    value: z.number().int(),
});

function createFakePort() {
    const messageListeners = new Set<(message: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    const posted: unknown[] = [];
    return {
        posted,
        emit(message: unknown) {
            for (const listener of messageListeners) {
                listener(message);
            }
        },
        emitDisconnect() {
            for (const listener of disconnectListeners) {
                listener();
            }
        },
        port: {
            postMessage: (message: unknown) => {
                posted.push(message);
            },
            disconnect: vi.fn(),
            onMessage: {
                addListener: (listener: (message: unknown) => void) => {
                    messageListeners.add(listener);
                },
            },
            onDisconnect: {
                addListener: (listener: () => void) => {
                    disconnectListeners.add(listener);
                },
            },
        },
    };
}

describe('framePort', () => {
    it('delivers valid frames and parses outbound frames', () => {
        const fake = createFakePort();
        const received: unknown[] = [];
        const framed = framePort(fake.port, {
            inbound: frameSchema,
            outbound: frameSchema,
            onFrame: (frame) => received.push(frame),
        });

        fake.emit({ action: 'hello', value: 7 });
        expect(received).toEqual([{ action: 'hello', value: 7 }]);

        framed.post({ action: 'hello', value: 3 });
        expect(fake.posted).toEqual([{ action: 'hello', value: 3 }]);

        expect(() =>
            framed.post({ action: 'hello', value: 1.5 } as never)
        ).toThrow();
    });

    it('closes the port on one invalid inbound frame and tells the owner', () => {
        const fake = createFakePort();
        const received: unknown[] = [];
        const onDisconnect = vi.fn();
        const framed = framePort(fake.port, {
            inbound: frameSchema,
            outbound: frameSchema,
            onFrame: (frame) => received.push(frame),
            onDisconnect,
        });

        fake.emit({ action: 'hello', value: 7, extra: true });
        expect(fake.port.disconnect).toHaveBeenCalledOnce();
        expect(onDisconnect).toHaveBeenCalledOnce();

        // After closing, nothing is delivered or posted.
        fake.emit({ action: 'hello', value: 9 });
        framed.post({ action: 'hello', value: 2 });
        expect(received).toEqual([]);
        expect(fake.posted).toEqual([]);
    });

    it('rejects prototype-poisoned frames at the snapshot layer', () => {
        const fake = createFakePort();
        framePort(fake.port, {
            inbound: frameSchema,
            outbound: frameSchema,
            onFrame: () => undefined,
        });
        fake.emit(JSON.parse('{"action":"hello","value":1,"__proto__":{}}'));
        expect(fake.port.disconnect).toHaveBeenCalledOnce();
    });

    it('notifies onDisconnect and stops posting afterwards', () => {
        const fake = createFakePort();
        const onDisconnect = vi.fn();
        const framed = framePort(fake.port, {
            inbound: frameSchema,
            outbound: frameSchema,
            onFrame: () => undefined,
            onDisconnect,
        });
        fake.emitDisconnect();
        expect(onDisconnect).toHaveBeenCalledOnce();
        framed.post({ action: 'hello', value: 4 });
        expect(fake.posted).toEqual([]);
    });
});
