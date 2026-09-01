import type { Logger } from '@/shared/logger';
import { normalizeDisneyPlusVideoId } from '@/shared/routeIdentity';
import type { CapturedEvent } from '../../bridge/protocol';
import { readTimelineTime } from './controlsDom';

const TIMELINE_DRIFT_TOLERANCE_SECONDS = 1.5;
const RUNTIME_SAMPLE_STABILITY_MS = 100;

type TimelineUpdate = Extract<CapturedEvent, { t: 'timeline-update' }>;

export interface RuntimeIdentity {
    readonly availId: string | null;
    readonly playbackSessionId: string | null;
}

interface RuntimeAnchor {
    readonly video: HTMLVideoElement;
    readonly videoId: string;
    readonly mediaTime: number;
    readonly programTime: number;
    readonly identity: RuntimeIdentity;
}

interface PendingAnchor extends RuntimeAnchor {
    readonly observedAt: number;
}

function readIdentity(update: TimelineUpdate): RuntimeIdentity | null {
    const { availId, playbackSessionId } = update;
    return availId || playbackSessionId ? { availId, playbackSessionId } : null;
}

export function identitiesMatch(
    left: RuntimeIdentity | null,
    right: RuntimeIdentity | null
): boolean {
    if (!left || !right) {
        return false;
    }
    if (left.playbackSessionId && right.playbackSessionId) {
        return left.playbackSessionId === right.playbackSessionId;
    }
    return Boolean(left.availId && left.availId === right.availId);
}

/**
 * Disney+'s media clock is not program time: ads, bumpers, and
 * interstitials make `video.currentTime` diverge from the playhead the
 * player itself reports. Three tiers resolve cue time:
 *
 * 1. interstitial playing → null (suppress subtitles);
 * 2. a validated runtime anchor from the page-world timeline poller →
 *    anchor.programTime + (mediaTime − anchor.mediaTime);
 * 3. otherwise the media clock, corrected by the controls slider's
 *    aria-valuenow when it proves a distinct clock origin (> 1.5 s).
 *
 * Anchors are accepted only when coherent with the previous one; after a
 * seek a new anchor must stay coherent for ≥ 100 ms before promotion, and
 * a stale identity (the previous title's playback) can never re-anchor.
 */
export class DisneyClock {
    private anchor: RuntimeAnchor | null = null;
    private anchorValid = false;
    private needsCoherentSample = false;
    private pendingAnchor: PendingAnchor | null = null;
    private interstitialActive = false;
    private lastSequence = -1;
    private staleIdentity: RuntimeIdentity | null;

    private clockVideo: HTMLVideoElement | null = null;
    private clockProgramTime: number | null = null;
    private clockTimelineElement: Element | null = null;
    private clockTimelineValue: number | null = null;
    private needsFreshTimeline = false;
    private playbackTimeOffset: number | null = null;

    constructor(
        private readonly deps: {
            videoId: string;
            staleIdentity: RuntimeIdentity | null;
            locateTimeline: () => Element | null;
            requestTimeline: () => void;
            logger: Logger;
        }
    ) {
        this.staleIdentity = deps.staleIdentity;
    }

    /** Identity of the current anchor, handed to the successor as stale. */
    identityForHandoff(): RuntimeIdentity | null {
        return this.anchor?.identity ?? null;
    }

    onTimelineUpdate(update: TimelineUpdate, video: HTMLVideoElement): void {
        if (normalizeDisneyPlusVideoId(update.videoId) !== this.deps.videoId) {
            return;
        }
        const programTime = update.programTimeSeconds;
        if (!Number.isFinite(programTime) || programTime < 0) {
            return;
        }
        const identity = readIdentity(update);
        if (!identity || identitiesMatch(this.staleIdentity, identity)) {
            return;
        }
        const mediaTime = video.currentTime;
        if (!Number.isFinite(mediaTime)) {
            return;
        }
        if (update.sequence <= this.lastSequence) {
            return;
        }

        if (update.isInterstitialPlaying !== null) {
            if (this.interstitialActive !== update.isInterstitialPlaying) {
                this.deps.logger.info('Disney interstitial state changed', {
                    isInterstitialPlaying: update.isInterstitialPlaying,
                });
            }
            this.interstitialActive = update.isInterstitialPlaying;
        }

        const previous = this.anchor;
        const sameRuntime = previous
            ? identitiesMatch(previous.identity, identity)
            : false;
        const now = Date.now();

        if (
            this.needsCoherentSample &&
            previous &&
            sameRuntime &&
            previous.video === video
        ) {
            const mediaDelta = mediaTime - previous.mediaTime;
            const programDelta = programTime - previous.programTime;
            const coherentWithPrevious =
                Math.abs(mediaDelta - programDelta) <=
                TIMELINE_DRIFT_TOLERANCE_SECONDS;
            if (!coherentWithPrevious) {
                const pending = this.pendingAnchor;
                const pendingMatches =
                    pending !== null &&
                    pending.video === video &&
                    identitiesMatch(pending.identity, identity);
                const coherentWithPending =
                    pendingMatches &&
                    Math.abs(
                        mediaTime -
                            pending.mediaTime -
                            (programTime - pending.programTime)
                    ) <= TIMELINE_DRIFT_TOLERANCE_SECONDS;
                const pendingStable =
                    coherentWithPending &&
                    now - pending.observedAt >= RUNTIME_SAMPLE_STABILITY_MS;
                if (!pendingStable) {
                    if (!coherentWithPending) {
                        this.pendingAnchor = {
                            video,
                            videoId: this.deps.videoId,
                            mediaTime,
                            programTime,
                            identity,
                            observedAt: now,
                        };
                    }
                    this.lastSequence = update.sequence;
                    return;
                }
            }
        }

        this.pendingAnchor = null;
        this.anchor = {
            video,
            videoId: this.deps.videoId,
            mediaTime,
            programTime,
            identity,
        };
        this.anchorValid = true;
        this.needsCoherentSample = false;
        this.lastSequence = update.sequence;
        this.staleIdentity = null;
    }

    getPlaybackTime(video: HTMLVideoElement): number | null {
        const mediaTime = video.currentTime;
        if (!Number.isFinite(mediaTime)) {
            return null;
        }
        if (this.interstitialActive) {
            return null;
        }

        const anchor = this.anchor;
        const anchorMatchesVideo = anchor?.video === video;
        if (anchor && !anchorMatchesVideo) {
            this.anchorValid = false;
            this.needsCoherentSample = false;
        }
        if (this.anchorValid && anchor && anchorMatchesVideo) {
            return anchor.programTime + (mediaTime - anchor.mediaTime);
        }
        // A seek can move the media clock before Disney publishes its matching
        // program playhead; suppress cues during that short disagreement
        // rather than briefly rendering the wrong scene.
        if (anchorMatchesVideo && this.needsCoherentSample) {
            return null;
        }
        return this.sliderCorrectedTime(video, mediaTime);
    }

    private sliderCorrectedTime(
        video: HTMLVideoElement,
        programTime: number
    ): number {
        const previousVideo = this.clockVideo;
        const previousProgramTime = this.clockProgramTime;
        const previousTimelineElement = this.clockTimelineElement;
        const previousTimelineValue = this.clockTimelineValue;
        const videoChanged = video !== previousVideo;

        if (videoChanged) {
            this.clockVideo = video;
            this.playbackTimeOffset = null;
            this.needsFreshTimeline =
                this.needsFreshTimeline || previousVideo !== null;
        }

        const timelineElement = this.deps.locateTimeline();
        const timelineTime = readTimelineTime(timelineElement);

        const programTimeChanged =
            !videoChanged &&
            previousProgramTime !== null &&
            Math.abs(programTime - previousProgramTime) >
                TIMELINE_DRIFT_TOLERANCE_SECONDS;
        const timelineTimeChanged =
            !videoChanged &&
            timelineTime !== null &&
            previousTimelineValue !== null &&
            Math.abs(timelineTime - previousTimelineValue) >
                TIMELINE_DRIFT_TOLERANCE_SECONDS;
        const coherentClockJump =
            programTimeChanged &&
            timelineTimeChanged &&
            Math.abs(
                programTime -
                    previousProgramTime -
                    (timelineTime - previousTimelineValue)
            ) <= TIMELINE_DRIFT_TOLERANCE_SECONDS;

        // During a seek the slider and media clock update on different
        // frames; never turn that disagreement into a persistent offset.
        if (
            (programTimeChanged || timelineTimeChanged) &&
            !coherentClockJump &&
            (timelineTime !== null || this.needsFreshTimeline)
        ) {
            this.playbackTimeOffset = null;
            this.needsFreshTimeline = true;
            this.clockProgramTime = programTime;
            if (timelineElement && timelineTime !== null) {
                this.clockTimelineElement = timelineElement;
                this.clockTimelineValue = timelineTime;
            }
            return programTime;
        }

        if (this.needsFreshTimeline) {
            const hasFreshSample =
                timelineElement !== null &&
                timelineTime !== null &&
                previousTimelineValue !== null &&
                Math.abs(timelineTime - previousTimelineValue) > 0.01;
            this.clockProgramTime = programTime;
            if (!hasFreshSample) {
                if (timelineElement && timelineTime !== null) {
                    this.clockTimelineElement = timelineElement;
                    this.clockTimelineValue = timelineTime;
                }
                return programTime;
            }
            this.needsFreshTimeline = false;
            this.playbackTimeOffset = meaningfulOffset(
                timelineTime,
                programTime
            );
        }

        if (timelineElement && timelineTime !== null) {
            const elementChanged = timelineElement !== previousTimelineElement;
            const valueChanged =
                previousTimelineValue === null ||
                Math.abs(timelineTime - previousTimelineValue) > 0.01;
            const predicted = programTime + (this.playbackTimeOffset ?? 0);
            const drift = Math.abs(timelineTime - predicted);
            const measured = meaningfulOffset(timelineTime, programTime);
            if (this.playbackTimeOffset === null) {
                this.playbackTimeOffset = measured;
            } else if (
                (elementChanged || valueChanged) &&
                drift > TIMELINE_DRIFT_TOLERANCE_SECONDS
            ) {
                this.playbackTimeOffset = measured;
            }
            this.clockTimelineElement = timelineElement;
            this.clockTimelineValue = timelineTime;
        } else {
            // Keep the calibrated offset while Disney+ unmounts idle controls.
            this.clockTimelineElement = null;
            this.clockTimelineValue = null;
        }

        this.clockProgramTime = programTime;
        return programTime + (this.playbackTimeOffset ?? 0);
    }

    /** Seek or media re-bind: drop calibration and demand a coherent sample. */
    invalidate(): void {
        this.playbackTimeOffset = null;
        this.needsFreshTimeline = true;
        if (this.anchor) {
            this.anchorValid = false;
            this.needsCoherentSample = true;
            this.pendingAnchor = null;
        }
        this.deps.requestTimeline();
    }
}

/** Small differences are UI sampling lag; only a > 1.5 s gap proves a
 *  distinct clock origin worth correcting. */
function meaningfulOffset(timelineTime: number, programTime: number): number {
    const measured = timelineTime - programTime;
    return Math.abs(measured) > TIMELINE_DRIFT_TOLERANCE_SECONDS ? measured : 0;
}
