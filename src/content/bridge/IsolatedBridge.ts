import type { Logger } from '@/shared/logger';
import type { BridgeControlSender } from '../platform/types';
import {
    isMainToIsolated,
    mainReadyEventName,
    type BridgePlatform,
    type CapturedEvent,
    type HelloMessage,
    type IsolatedToMain,
} from './protocol';

function mintCapability(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
        ''
    );
}

/**
 * Isolated-world end of the page bridge. Mints a per-handshake capability,
 * hands the MAIN world a private MessagePort, and accepts frames only after
 * the `ready` echo proves the port belongs to this handshake. Structured
 * cloning across the port yields plain data, so a small shape validator is
 * all the trust the frames get — route identity and background policy stay
 * authoritative.
 */
export class IsolatedBridge implements BridgeControlSender {
    private port: MessagePort | null = null;
    private ready = false;
    private capability = '';
    private readonly listeners = new AbortController();

    constructor(
        private readonly platform: BridgePlatform,
        private readonly options: {
            onEvent: (event: CapturedEvent) => void;
            onConnected?: () => void;
            logger: Logger;
        }
    ) {}

    start(): void {
        const { signal } = this.listeners;
        // Order safety net: whichever world runs first, the other catches up.
        document.addEventListener(
            mainReadyEventName(this.platform),
            () => this.handshake(),
            { signal }
        );
        window.addEventListener(
            'pageshow',
            (event) => {
                if (event.persisted) {
                    this.handshake();
                }
            },
            { signal }
        );
        window.addEventListener(
            'pagehide',
            (event) => {
                if (event.persisted) {
                    this.sendControl({ t: 'playback-bridge-pause' });
                }
            },
            { signal }
        );
        this.handshake();
    }

    get connected(): boolean {
        return this.ready;
    }

    sendControl(message: IsolatedToMain): boolean {
        if (!this.port || !this.ready) {
            return false;
        }
        try {
            this.port.postMessage(message);
            return true;
        } catch {
            return false;
        }
    }

    close(): void {
        this.sendControl({ t: 'close' });
        this.port?.close();
        this.port = null;
        this.ready = false;
        this.listeners.abort();
    }

    private handshake(): void {
        if (this.listeners.signal.aborted) {
            return;
        }
        const capability = mintCapability();
        const channel = new MessageChannel();
        this.port?.close();
        this.port = channel.port1;
        this.ready = false;
        this.capability = capability;
        channel.port1.onmessage = (event: MessageEvent<unknown>) =>
            this.onPortMessage(channel.port1, event.data);

        const hello: HelloMessage = {
            dualsub: 'hello',
            platform: this.platform,
            capability,
        };
        window.postMessage(hello, location.origin, [channel.port2]);
    }

    private onPortMessage(port: MessagePort, data: unknown): void {
        if (this.port !== port || !isMainToIsolated(data)) {
            return;
        }
        if (data.t === 'ready') {
            if (data.capability !== this.capability) {
                return;
            }
            this.ready = true;
            this.options.onConnected?.();
            this.options.logger.debug('Page bridge connected', {
                buffered: data.buffered.length,
            });
            for (const event of data.buffered) {
                this.options.onEvent(event);
            }
            return;
        }
        if (!this.ready) {
            return;
        }
        this.options.onEvent(data);
    }
}
