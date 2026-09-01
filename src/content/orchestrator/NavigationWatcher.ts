import { scopedInterval } from './scope';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEBOUNCE_MS = 100;

/**
 * SPA navigation detection with belt and braces: history API interception,
 * popstate/hashchange, focus/visibility, and a 1s poll — all funneled into
 * one debounced URL comparison. History methods are restored on stop only
 * if they are still ours (the site may have wrapped them after us).
 */
export class NavigationWatcher {
    private currentHref = location.href;
    private pendingCheck: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly onChange: (from: string, to: string) => void,
        private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
    ) {}

    start(signal: AbortSignal): void {
        if (signal.aborted) {
            return;
        }
        const schedule = (): void => this.scheduleCheck(signal);

        // Originals are re-applied with .apply on `history`; the rule cannot
        // see that.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const originalPushState = history.pushState;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const originalReplaceState = history.replaceState;
        const pushStateWrapper = function (
            this: History,
            ...args: Parameters<History['pushState']>
        ): void {
            originalPushState.apply(this, args);
            schedule();
        };
        const replaceStateWrapper = function (
            this: History,
            ...args: Parameters<History['replaceState']>
        ): void {
            originalReplaceState.apply(this, args);
            schedule();
        };
        history.pushState = pushStateWrapper;
        history.replaceState = replaceStateWrapper;

        for (const type of ['popstate', 'hashchange', 'focus']) {
            window.addEventListener(type, schedule, { signal });
        }
        document.addEventListener('visibilitychange', schedule, { signal });
        scopedInterval(signal, () => this.check(), this.pollIntervalMs);

        signal.addEventListener(
            'abort',
            () => {
                if (this.pendingCheck !== null) {
                    clearTimeout(this.pendingCheck);
                    this.pendingCheck = null;
                }
                if (history.pushState === pushStateWrapper) {
                    history.pushState = originalPushState;
                }
                if (history.replaceState === replaceStateWrapper) {
                    history.replaceState = originalReplaceState;
                }
            },
            { once: true }
        );
    }

    private scheduleCheck(signal: AbortSignal): void {
        if (this.pendingCheck !== null || signal.aborted) {
            return;
        }
        this.pendingCheck = setTimeout(() => {
            this.pendingCheck = null;
            if (!signal.aborted) {
                this.check();
            }
        }, DEBOUNCE_MS);
    }

    private check(): void {
        const href = location.href;
        if (href === this.currentHref) {
            return;
        }
        const from = this.currentHref;
        this.currentHref = href;
        this.onChange(from, href);
    }
}
