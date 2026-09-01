import { browser } from 'wxt/browser';
import { createLogger } from '@/shared/logger';
import { MessageActions } from './actions';
import {
    classifyExtensionMessageSender,
    type ClassifiedSender,
} from './sender';
import {
    PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS,
    tryCreatePlainDataSnapshot,
} from './snapshot';
import type { MessageContract, RequestOf, ResponseOf } from './registry';

const MESSAGE_ACTION_CATALOG = new Set<string>(Object.values(MessageActions));
const MAX_PROTOCOL_ENVELOPE_KEYS = 32;

/**
 * Cheap pre-parse gate: a plain record with 1–32 own string keys whose
 * `action` is an own enumerable string from the closed catalog. Everything
 * else is silently dropped before any budget is spent on it.
 */
export function readEnvelopeAction(message: unknown): string | null {
    try {
        if (
            message === null ||
            typeof message !== 'object' ||
            Array.isArray(message)
        ) {
            return null;
        }
        const prototype: unknown = Object.getPrototypeOf(message);
        if (prototype !== Object.prototype && prototype !== null) {
            return null;
        }
        const keys = Reflect.ownKeys(message);
        if (
            keys.length < 1 ||
            keys.length > MAX_PROTOCOL_ENVELOPE_KEYS ||
            keys.some((key) => typeof key !== 'string')
        ) {
            return null;
        }
        const descriptor = Object.getOwnPropertyDescriptor(message, 'action');
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true
        ) {
            return null;
        }
        const action: unknown = descriptor.value;
        return typeof action === 'string' && MESSAGE_ACTION_CATALOG.has(action)
            ? action
            : null;
    } catch {
        return null;
    }
}

export type ContractHandler<C extends MessageContract> = (
    request: RequestOf<C>,
    sender: ClassifiedSender
) => Promise<ResponseOf<C>> | ResponseOf<C>;

interface HandlerEntry {
    contract: MessageContract;
    handler: ContractHandler<MessageContract>;
}

/**
 * The receiving half of the contract table. One pipeline for every inbound
 * message: envelope gate → budgeted snapshot → sender authentication → role
 * gate → strict schema parse → typed handler → response parse. Any rejection
 * yields no response, which the typed client surfaces as a ProtocolError.
 */
export class MessageRouter {
    private readonly handlers = new Map<string, HandlerEntry>();
    private readonly logger = createLogger('MessageRouter');
    private listening = false;

    handle<C extends MessageContract>(
        contract: C,
        handler: ContractHandler<C>
    ): void {
        if (this.handlers.has(contract.action)) {
            throw new Error(
                `A handler for "${contract.action}" is already registered`
            );
        }
        this.handlers.set(contract.action, { contract, handler });
    }

    /**
     * Register the runtime.onMessage listener (synchronously, once). Native
     * Chrome ignores promise-returning listeners, so an accepted request
     * answers through sendResponse with `return true` holding the channel.
     */
    listen(): void {
        if (this.listening) {
            return;
        }
        this.listening = true;
        browser.runtime.onMessage.addListener(
            (
                message: unknown,
                sender: unknown,
                sendResponse: (response?: unknown) => void
            ): true | undefined => {
                const result = this.dispatch(message, sender);
                if (result === undefined) {
                    return undefined;
                }
                void result.then(sendResponse);
                return true;
            }
        );
    }

    /**
     * Returns a response promise when the message is a valid, authorized
     * request for a registered contract; undefined otherwise (no response).
     */
    dispatch(message: unknown, sender: unknown): Promise<unknown> | undefined {
        const action = readEnvelopeAction(message);
        if (!action) {
            return undefined;
        }
        const entry = this.handlers.get(action);
        if (!entry) {
            return undefined;
        }

        const snapshot = tryCreatePlainDataSnapshot(
            message,
            entry.contract.budget ?? PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS
        );
        if (!snapshot.accepted) {
            return undefined;
        }

        const classified = classifyExtensionMessageSender(sender);
        if (!classified || !entry.contract.senders.includes(classified.role)) {
            return undefined;
        }

        const schema =
            entry.contract.requestByRole?.[classified.role] ??
            entry.contract.request;
        const parsed = schema.safeParse(snapshot.value);
        if (!parsed.success) {
            return undefined;
        }

        return (async () => {
            const response: unknown = await entry.handler(
                parsed.data,
                classified
            );
            // Always parse outbound too: a handler bug must not cross a
            // trust boundary as a malformed reply.
            return entry.contract.response.parse(response);
        })().catch((error: unknown) => {
            this.logger.error('Message handler failed', error, { action });
            return undefined;
        });
    }
}
