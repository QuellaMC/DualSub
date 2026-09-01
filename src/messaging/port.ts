import type { z } from 'zod';
import { createLogger } from '@/shared/logger';
import {
    PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS,
    tryCreatePlainDataSnapshot,
} from './snapshot';

interface PortLike {
    postMessage(message: unknown): void;
    disconnect(): void;
    onMessage: {
        addListener(listener: (message: unknown) => void): void;
    };
    onDisconnect: {
        addListener(listener: () => void): void;
    };
}

export interface FramedPort<Out> {
    /** Parses against the outbound schema before posting (throws on bugs). */
    post(frame: Out): void;
    disconnect(): void;
}

/**
 * Wrap a long-lived Port so both directions honor their frame schemas: every
 * outbound frame is parsed before posting, every inbound frame is
 * snapshotted and parsed, and ONE invalid inbound frame closes the port —
 * a peer that speaks outside the contract loses the connection.
 */
export function framePort<In, Out>(
    port: PortLike,
    config: {
        inbound: z.ZodType<In>;
        outbound: z.ZodType<Out>;
        onFrame: (frame: In) => void;
        onDisconnect?: () => void;
    }
): FramedPort<Out> {
    const logger = createLogger('FramedPort');
    let closed = false;

    port.onMessage.addListener((message: unknown) => {
        if (closed) {
            return;
        }
        const snapshot = tryCreatePlainDataSnapshot(
            message,
            PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS
        );
        const parsed = snapshot.accepted
            ? config.inbound.safeParse(snapshot.value)
            : null;
        if (!parsed?.success) {
            logger.warn('Rejected invalid port frame; closing port');
            closed = true;
            port.disconnect();
            return;
        }
        config.onFrame(parsed.data);
    });

    port.onDisconnect.addListener(() => {
        closed = true;
        config.onDisconnect?.();
    });

    return {
        post(frame: Out): void {
            if (closed) {
                return;
            }
            port.postMessage(config.outbound.parse(frame));
        },
        disconnect(): void {
            closed = true;
            port.disconnect();
        },
    };
}
