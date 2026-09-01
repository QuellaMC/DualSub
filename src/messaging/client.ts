import { browser } from 'wxt/browser';
import type { MessageContract, RequestOf, ResponseOf } from './registry';
import { checkBackgroundReady, ping } from './contracts/readiness';

export const MessagingFailureClass = {
    /** Chrome proved no receiver accepted the message — safe to resend. */
    PROVEN_NON_DELIVERY: 'proven-non-delivery',
    /** The channel closed; a receiver may already have committed work. */
    AMBIGUOUS_ACCEPTANCE: 'ambiguous-acceptance',
    TERMINAL: 'terminal',
} as const;

export type MessagingFailure =
    (typeof MessagingFailureClass)[keyof typeof MessagingFailureClass];

/** The peer answered with nothing or with a shape outside the contract. */
export class ProtocolError extends Error {
    override readonly name = 'ProtocolError';
    readonly action: string;

    constructor(action: string, message: string) {
        super(`${action}: ${message}`);
        this.action = action;
    }
}

/** Transport-level failure, classified and with the raw message sanitized. */
export class MessagingError extends Error {
    override readonly name = 'MessagingError';
    readonly failureClass: MessagingFailure;

    constructor(
        message: string,
        failureClass: MessagingFailure,
        cause: unknown
    ) {
        super(message, { cause });
        this.failureClass = failureClass;
    }
}

export class DispatchBlockedError extends Error {
    override readonly name = 'DispatchBlockedError';

    constructor() {
        super('Runtime message dispatch blocked');
    }
}

function classifyFailureMessage(message: string): MessagingFailure {
    const normalized = message.toLowerCase();
    if (
        normalized.includes('receiving end does not exist') ||
        normalized.includes('no matching service worker')
    ) {
        return MessagingFailureClass.PROVEN_NON_DELIVERY;
    }
    if (
        normalized.includes('message port closed') ||
        normalized.includes('message channel closed')
    ) {
        return MessagingFailureClass.AMBIGUOUS_ACCEPTANCE;
    }
    return MessagingFailureClass.TERMINAL;
}

/**
 * Wrap a raw transport rejection: read the message string exactly once so a
 * hostile object cannot change its story between classification and logging.
 */
function toMessagingError(cause: unknown): MessagingError {
    let message = 'Unknown runtime messaging error';
    if (cause !== null && typeof cause === 'object') {
        const descriptor = Object.getOwnPropertyDescriptor(cause, 'message');
        if (
            descriptor &&
            Object.hasOwn(descriptor, 'value') &&
            typeof descriptor.value === 'string' &&
            descriptor.value.trim() !== ''
        ) {
            message = descriptor.value;
        }
    }
    return new MessagingError(message, classifyFailureMessage(message), cause);
}

export function isProvenMessagingNonDelivery(error: unknown): boolean {
    return (
        error instanceof MessagingError &&
        error.failureClass === MessagingFailureClass.PROVEN_NON_DELIVERY
    );
}

function parseResponse<C extends MessageContract>(
    contract: C,
    response: unknown
): ResponseOf<C> {
    if (response === undefined) {
        throw new ProtocolError(
            contract.action,
            'the receiver returned no response'
        );
    }
    const parsed = contract.response.safeParse(response);
    if (!parsed.success) {
        throw new ProtocolError(
            contract.action,
            'the response did not match the contract'
        );
    }
    return parsed.data as ResponseOf<C>;
}

/** Typed one-shot request to the background. */
export async function sendMessage<C extends MessageContract>(
    contract: C,
    payload: RequestOf<C>
): Promise<ResponseOf<C>> {
    const request = contract.request.parse(payload);
    let response: unknown;
    try {
        response = await browser.runtime.sendMessage(request);
    } catch (cause) {
        throw toMessagingError(cause);
    }
    return parseResponse(contract, response);
}

/** Typed request to a content tab (background/popup side). */
export async function sendToTab<C extends MessageContract>(
    contract: C,
    tabId: number,
    payload: RequestOf<C>,
    options?: { frameId?: number; documentId?: string }
): Promise<ResponseOf<C>> {
    const request = contract.request.parse(payload);
    let response: unknown;
    try {
        response = await browser.tabs.sendMessage(tabId, request, options);
    } catch (cause) {
        throw toMessagingError(cause);
    }
    return parseResponse(contract, response);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeBackgroundReadiness(): Promise<void> {
    try {
        await sendMessage(checkBackgroundReady, {
            action: checkBackgroundReady.action,
        });
    } catch {
        try {
            await sendMessage(ping, { action: ping.action });
        } catch {
            // Wake-up is best effort; the retry loop decides what happens.
        }
    }
}

export interface RetryOptions {
    retries?: number;
    baseDelayMs?: number;
    backoffFactor?: number;
    pingBeforeRetry?: boolean;
    /** Synchronous exact-true gate checked immediately before each dispatch. */
    canDispatch?: () => boolean;
}

/**
 * Send with retries ONLY after proven non-delivery (dead service worker).
 * Channel closure and unknown errors are terminal because a receiver may
 * already have accepted the request.
 */
export async function sendWithRetry<C extends MessageContract>(
    contract: C,
    payload: RequestOf<C>,
    {
        retries = 3,
        baseDelayMs = 100,
        backoffFactor = 2,
        pingBeforeRetry = true,
        canDispatch,
    }: RetryOptions = {}
): Promise<ResponseOf<C>> {
    let attempt = 0;
    let delay = baseDelayMs;

    for (;;) {
        if (canDispatch !== undefined) {
            let allowed = false;
            try {
                allowed = canDispatch() === true;
            } catch {
                allowed = false;
            }
            if (!allowed) {
                throw new DispatchBlockedError();
            }
        }

        try {
            return await sendMessage(contract, payload);
        } catch (error) {
            attempt += 1;
            if (!isProvenMessagingNonDelivery(error) || attempt > retries) {
                throw error;
            }
            if (pingBeforeRetry) {
                await probeBackgroundReadiness();
            }
            await sleep(delay);
            delay = Math.min(2000, delay * backoffFactor);
        }
    }
}
