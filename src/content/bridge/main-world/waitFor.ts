// Page-world natives captured at module evaluation (document_start), before
// any site script can replace them.
const nativeSetTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);

/** One in-flight resolution; cancelling wakes any poll it is sleeping in. */
export interface ResolutionToken {
    cancelled: boolean;
    onCancel?: () => void;
}

/** At most one live resolution of a kind: beginning a new one cancels the
 *  previous, and finishing releases the slot without touching a newer one. */
export class ResolutionSlot {
    private token: ResolutionToken | null = null;

    begin(): ResolutionToken {
        this.cancel();
        const token: ResolutionToken = { cancelled: false };
        this.token = token;
        return token;
    }

    cancel(): void {
        const token = this.token;
        if (token) {
            token.cancelled = true;
            token.onCancel?.();
            this.token = null;
        }
    }

    release(token: ResolutionToken): void {
        if (this.token === token) {
            this.token = null;
        }
    }
}

/** Poll `probe` until it yields a value, the timeout passes, or the token
 *  is cancelled. */
export function waitFor<T>(
    probe: () => T | null,
    intervalMs: number,
    timeoutMs: number,
    token: ResolutionToken
): Promise<T | null> {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        let timer: number | null = null;
        const attempt = (): void => {
            timer = null;
            if (token.cancelled) {
                resolve(null);
                return;
            }
            const value = probe();
            if (value !== null) {
                resolve(value);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(null);
                return;
            }
            timer = nativeSetTimeout(attempt, intervalMs);
        };
        token.onCancel = () => {
            if (timer !== null) {
                nativeClearTimeout(timer);
                timer = null;
                resolve(null);
            }
        };
        attempt();
    });
}

/**
 * Polls `read` until stopped and reports every new value. Once nothing has
 * been readable for `unknownAfterMs`, from the start or since the last value,
 * it reports null, so the listener stops waiting on or trusting a stale
 * value; a shorter gap reports nothing. Starting again replaces the previous
 * watch.
 */
export class ValueWatch {
    private timer: number | null = null;

    start(
        read: () => string | null,
        report: (value: string | null) => void,
        intervalMs: number,
        unknownAfterMs: number
    ): void {
        this.stop();
        let silentSince = Date.now();
        let reported: string | null | undefined;
        const poll = (): void => {
            const value = read();
            if (value !== null) {
                silentSince = Date.now();
                if (value !== reported) {
                    reported = value;
                    report(value);
                }
            } else if (
                reported !== null &&
                Date.now() - silentSince >= unknownAfterMs
            ) {
                reported = null;
                report(null);
            }
            this.timer = nativeSetTimeout(poll, intervalMs);
        };
        poll();
    }

    stop(): void {
        if (this.timer !== null) {
            nativeClearTimeout(this.timer);
            this.timer = null;
        }
    }
}
