import type { Logger } from '@/shared/logger';
import type { MediaScope, PlatformAdapter } from '../platform/types';
import { scopedInterval, scopedTimeout } from './scope';

const DETECTION_INTERVAL_MS = 1000;
const MAX_DETECTION_ATTEMPTS = 30;
const VISIBILITY_RETRY_DELAY_MS = 500;
const REPLACEMENT_STRICT_WINDOW_MS = 8000;

function sameScope(a: MediaScope | null, b: MediaScope): boolean {
    return a !== null && a.video === b.video && a.root === b.root;
}

/**
 * Finds the <video> for a session and keeps the binding honest: candidates
 * must sit inside their player container, a post-navigation session refuses
 * the previous episode's element until a replacement appears (relaxing after
 * 8s in case the site reused it), and a bound element that disconnects is
 * reported lost and re-detected.
 */
export class MediaBinding {
    private bound: MediaScope | null = null;
    private attempts = 0;
    private requireReplacementOf: MediaScope | null;
    private readonly startedAt = Date.now();

    constructor(
        private readonly options: {
            adapter: Pick<
                PlatformAdapter,
                'discoverVideo' | 'getPlayerContainer'
            >;
            requireReplacementOf: MediaScope | null;
            onBound: (scope: MediaScope) => void;
            onLost: () => void;
            signal: AbortSignal;
            logger: Logger;
        }
    ) {
        this.requireReplacementOf = options.requireReplacementOf;
    }

    get current(): MediaScope | null {
        return this.bound;
    }

    start(): void {
        const { signal } = this.options;
        this.detect();
        scopedInterval(signal, () => this.tick(), DETECTION_INTERVAL_MS);
        document.addEventListener(
            'visibilitychange',
            () => {
                if (document.visibilityState === 'visible' && !this.bound) {
                    this.attempts = 0;
                    scopedTimeout(
                        signal,
                        () => this.detect(),
                        VISIBILITY_RETRY_DELAY_MS
                    );
                }
            },
            { signal }
        );
    }

    private tick(): void {
        if (this.bound) {
            const { video } = this.bound;
            if (
                !video.isConnected ||
                this.options.adapter.discoverVideo() !== video
            ) {
                this.options.logger.info('Bound video element was replaced');
                this.bound = null;
                this.attempts = 0;
                this.options.onLost();
                this.detect();
            }
            return;
        }
        if (this.attempts < MAX_DETECTION_ATTEMPTS) {
            this.detect();
        }
    }

    private detect(): boolean {
        if (this.bound || this.options.signal.aborted) {
            return false;
        }
        this.attempts += 1;
        const video = this.options.adapter.discoverVideo();
        if (!video) {
            return false;
        }
        const root = this.options.adapter.getPlayerContainer(video);
        if (root && !root.contains(video)) {
            return false;
        }
        const candidate: MediaScope = { root, video };

        if (sameScope(this.requireReplacementOf, candidate)) {
            if (Date.now() - this.startedAt < REPLACEMENT_STRICT_WINDOW_MS) {
                return false;
            }
            this.options.logger.info(
                'Accepting the previous video element after the replacement window elapsed'
            );
        }
        this.requireReplacementOf = null;
        this.bound = candidate;
        this.options.onBound(candidate);
        return true;
    }
}
