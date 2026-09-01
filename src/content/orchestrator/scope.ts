// One cancellation primitive for the content side: every session-scoped
// object binds to an AbortSignal, and async continuations call ensureLive
// once instead of re-verifying a pile of generation counters.

export class ScopeEndedError extends Error {
    override readonly name = 'ScopeEndedError';

    constructor() {
        super('The owning scope has ended.');
    }
}

/** @throws {ScopeEndedError} when the signal has aborted */
export function ensureLive(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new ScopeEndedError();
    }
}

/** A controller that aborts when the parent aborts (and can abort alone). */
export function childScope(parent: AbortSignal): AbortController {
    const controller = new AbortController();
    if (parent.aborted) {
        controller.abort();
    } else {
        parent.addEventListener('abort', () => controller.abort(), {
            once: true,
            signal: controller.signal,
        });
    }
    return controller;
}

export function scopedTimeout(
    signal: AbortSignal,
    callback: () => void,
    delayMs: number
): void {
    if (signal.aborted) {
        return;
    }
    const id = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        callback();
    }, delayMs);
    const cancel = (): void => clearTimeout(id);
    signal.addEventListener('abort', cancel, { once: true });
}

export function scopedInterval(
    signal: AbortSignal,
    callback: () => void,
    intervalMs: number
): void {
    if (signal.aborted) {
        return;
    }
    const id = setInterval(callback, intervalMs);
    signal.addEventListener('abort', () => clearInterval(id), { once: true });
}

/** Swallows ScopeEndedError from a scoped async task; rethrows anything else. */
export function runScoped(task: Promise<unknown>): void {
    task.catch((error: unknown) => {
        if (!(error instanceof ScopeEndedError)) {
            throw error;
        }
    });
}
