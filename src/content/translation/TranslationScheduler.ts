import type { Logger } from '@/shared/logger';
import { MessageActions } from '@/messaging/actions';
import type {
    TranslateRequest,
    TranslateResponse,
} from '@/messaging/contracts/translate';
import type { Cue, CueId } from '../subtitles/cueModel';
import { scopedInterval } from '../orchestrator/scope';
import { translationFailureText } from './errorText';

export const TRANSLATION_LOOKBEHIND_SECONDS = 5;
export const TRANSLATION_LOOKAHEAD_SECONDS = 30;
export const MAX_CUES_PER_PASS = 3;
const CONTINUATION_DELAY_MS = 50;
const CLOCK_POLL_INTERVAL_MS = 1000;
/** Retryable failures are re-queued this many times before the placeholder. */
const MAX_DEFERRALS = 2;
const MIN_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

export type TranslatableCue = Cue & { readonly original: string };

export interface Deferral {
    readonly cue: TranslatableCue;
    readonly count: number;
    readonly retryAt: number;
}

function isTranslatable(cue: Cue): cue is TranslatableCue {
    return (
        cue.cueType === 'original' &&
        !cue.useNativeTarget &&
        cue.original !== null &&
        cue.original.trim() !== '' &&
        cue.translated === null
    );
}

/** On-screen cues first (nearest start), then upcoming, then just-passed. */
function priority(cue: Cue, time: number): readonly [number, number] {
    if (cue.start <= time && cue.end >= time) {
        return [0, Math.abs(time - cue.start)];
    }
    if (cue.start > time) {
        return [1, cue.start - time];
    }
    return [2, time - cue.end];
}

export function selectCuesToTranslate(
    cues: readonly Cue[],
    time: number,
    now: number,
    deferrals: ReadonlyMap<CueId, Deferral>,
    limit: number
): TranslatableCue[] {
    const windowStart = time - TRANSLATION_LOOKBEHIND_SECONDS;
    const windowEnd = time + TRANSLATION_LOOKAHEAD_SECONDS;
    return cues
        .filter(
            (cue): cue is TranslatableCue =>
                isTranslatable(cue) &&
                cue.end >= windowStart &&
                cue.start <= windowEnd &&
                (deferrals.get(cue.id)?.retryAt ?? 0) <= now
        )
        .sort((a, b) => {
            const [aBand, aDistance] = priority(a, time);
            const [bBand, bDistance] = priority(b, time);
            return aBand - bBand || aDistance - bDistance || a.start - b.start;
        })
        .slice(0, limit);
}

export interface TranslationSchedulerDeps {
    readonly cues: readonly Cue[];
    readonly videoId: string;
    readonly targetLanguage: string;
    /** Playback time with the user offset applied; null without a clock. */
    readonly currentTime: () => number | null;
    readonly send: (request: TranslateRequest) => Promise<TranslateResponse>;
    /** A cue's translated text changed; repaint if it is on screen. */
    readonly onTranslated: () => void;
    readonly signal: AbortSignal;
    readonly logger: Logger;
}

/**
 * Fills in translations for the cues around the playhead: one request at a
 * time, a few cues per pass, on-screen cues first. Passes chain every 50 ms
 * while work remains and the playhead is polled once a second so the window
 * follows playback; a seek or new cue set preempts any delayed continuation.
 * Background gating owns all provider pacing — the loop never batches.
 */
export class TranslationScheduler {
    private readonly deferrals = new Map<CueId, Deferral>();
    private active = true;
    private running = false;
    private rerunRequested = false;
    private pending: {
        readonly id: ReturnType<typeof setTimeout>;
        readonly delayMs: number;
    } | null = null;

    constructor(private readonly deps: TranslationSchedulerDeps) {}

    start(): void {
        const { signal } = this.deps;
        if (signal.aborted) {
            return;
        }
        signal.addEventListener('abort', () => this.cancelPending(), {
            once: true,
        });
        scopedInterval(
            signal,
            () => {
                if (!this.pending && !this.running) {
                    this.schedule(0);
                }
            },
            CLOCK_POLL_INTERVAL_MS
        );
        this.schedule(0);
    }

    /** Subtitles off pauses the loop; on resumes it immediately. */
    setActive(active: boolean): void {
        if (this.active === active) {
            return;
        }
        this.active = active;
        if (active) {
            this.schedule(0);
        } else {
            this.cancelPending();
        }
    }

    /** A seek or a clock (re)binding: run a pass now. */
    kick(): void {
        this.schedule(0);
    }

    private schedule(delayMs: number): void {
        if (this.deps.signal.aborted || !this.active) {
            return;
        }
        if (this.running) {
            if (delayMs === 0) {
                this.rerunRequested = true;
            }
            return;
        }
        if (this.pending) {
            // Only an immediate request replaces a delayed one; an already
            // immediate timer stands.
            if (delayMs !== 0 || this.pending.delayMs === 0) {
                return;
            }
            this.cancelPending();
        }
        const id = setTimeout(() => {
            this.pending = null;
            void this.pass();
        }, delayMs);
        this.pending = { id, delayMs };
    }

    private cancelPending(): void {
        if (this.pending) {
            clearTimeout(this.pending.id);
            this.pending = null;
        }
    }

    private async pass(): Promise<void> {
        const { deps } = this;
        if (deps.signal.aborted || !this.active) {
            return;
        }
        const time = deps.currentTime();
        if (time === null) {
            return;
        }
        const batch = selectCuesToTranslate(
            deps.cues,
            time,
            Date.now(),
            this.deferrals,
            MAX_CUES_PER_PASS
        );
        if (batch.length === 0) {
            this.scheduleDeferredWakeup(time);
            return;
        }

        this.running = true;
        this.rerunRequested = false;
        try {
            for (const cue of batch) {
                if (
                    deps.signal.aborted ||
                    !this.active ||
                    this.rerunRequested
                ) {
                    break;
                }
                await this.translateCue(cue);
            }
        } finally {
            this.running = false;
        }

        if (deps.signal.aborted || !this.active) {
            return;
        }
        if (this.rerunRequested) {
            this.rerunRequested = false;
            this.schedule(0);
            return;
        }
        const latest = deps.currentTime() ?? time;
        const more = selectCuesToTranslate(
            deps.cues,
            latest,
            Date.now(),
            this.deferrals,
            1
        );
        if (more.length > 0) {
            this.schedule(CONTINUATION_DELAY_MS);
            return;
        }
        this.scheduleDeferredWakeup(latest);
    }

    private scheduleDeferredWakeup(time: number): void {
        const now = Date.now();
        const windowStart = time - TRANSLATION_LOOKBEHIND_SECONDS;
        const windowEnd = time + TRANSLATION_LOOKAHEAD_SECONDS;
        let earliest: number | null = null;
        for (const { cue, retryAt } of this.deferrals.values()) {
            if (
                retryAt > now &&
                cue.translated === null &&
                cue.end >= windowStart &&
                cue.start <= windowEnd &&
                (earliest === null || retryAt < earliest)
            ) {
                earliest = retryAt;
            }
        }
        if (earliest !== null) {
            this.schedule(Math.max(1, earliest - now));
        }
    }

    private async translateCue(cue: TranslatableCue): Promise<void> {
        const { deps } = this;
        let response: TranslateResponse;
        try {
            response = await deps.send({
                action: MessageActions.TRANSLATE,
                text: cue.original,
                targetLang: deps.targetLanguage,
                cueStart: cue.start,
                cueVideoId: deps.videoId,
            });
        } catch (error) {
            if (deps.signal.aborted) {
                return;
            }
            deps.logger.error('Translation request failed', error, {
                cueStart: cue.start,
            });
            this.settle(cue, translationFailureText('request'));
            return;
        }
        if (deps.signal.aborted) {
            return;
        }
        if (response.success) {
            this.settle(cue, response.translatedText);
            return;
        }
        const count = this.deferrals.get(cue.id)?.count ?? 0;
        if (response.retryable && count < MAX_DEFERRALS) {
            const delayMs = Math.min(
                MAX_RETRY_DELAY_MS,
                Math.max(MIN_RETRY_DELAY_MS, response.retryAfter ?? 0)
            );
            this.deferrals.set(cue.id, {
                cue,
                count: count + 1,
                retryAt: Date.now() + delayMs,
            });
            deps.logger.info('Translation deferred', {
                cueStart: cue.start,
                delayMs,
                deferrals: count + 1,
            });
            return;
        }
        deps.logger.warn('Translation failed', {
            cueStart: cue.start,
            retryable: response.retryable,
        });
        this.settle(cue, translationFailureText('api'));
    }

    private settle(cue: TranslatableCue, translated: string): void {
        cue.translated = translated;
        this.deferrals.delete(cue.id);
        this.deps.onTranslated();
    }
}
