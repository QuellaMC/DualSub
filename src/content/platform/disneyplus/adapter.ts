import type { CapturedEvent } from '../../bridge/protocol';
import type {
    AdapterContext,
    MediaScope,
    NativeSubRecipe,
    PlatformAdapter,
    PlatformHandoff,
    SubtitleFetchSpec,
} from '../types';
import { DisneyClock, type RuntimeIdentity } from './clock';
import { TimelineLocator, findPlayPauseButton } from './controlsDom';

const PLAYBACK_TRANSITION_DELAY_MS = 160;

const DISNEY_NATIVE_SUB_RECIPE: NativeSubRecipe = {
    styleId: 'dualsub-disneyplus-subtitle-hider',
    selectors: [
        '.TimedTextOverlay',
        '.hive-subtitle-renderer-wrapper',
        '.hive-subtitle-renderer-cue-positioning-box',
        '.hive-subtitle-renderer-cue-window',
    ],
    css: `
        .TimedTextOverlay[data-dualsub-hidden="true"],
        .hive-subtitle-renderer-wrapper[data-dualsub-hidden="true"],
        .hive-subtitle-renderer-cue-positioning-box[data-dualsub-hidden="true"],
        .hive-subtitle-renderer-cue-window[data-dualsub-hidden="true"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
        }
    `,
    observedRoots(media: MediaScope) {
        const roots: Element[] = [];
        if (media.root && media.root !== document.body) {
            roots.push(media.root);
        }
        for (const overlay of document.querySelectorAll(
            'main-app-controls-overlay'
        )) {
            if (overlay.shadowRoot) {
                roots.push(overlay.shadowRoot as unknown as Element);
            }
        }
        return roots;
    },
};

export interface DisneyHandoffScratch {
    readonly staleIdentity: RuntimeIdentity | null;
}

/** Score candidate <video> elements: Disney+ mounts several (previews,
 *  bumpers); the visible, playing, loaded one wins. */
export function selectBestVideo(
    videos: readonly HTMLVideoElement[]
): HTMLVideoElement | null {
    if (videos.length <= 1) {
        return videos[0] ?? null;
    }
    let best = videos[0]!;
    let bestScore = -Infinity;
    for (const video of videos) {
        let score = 0;
        const rect = video.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            score += 100 + Math.min((rect.width * rect.height) / 20000, 50);
        }
        if (video.readyState >= 2) score += 40;
        if (video.readyState >= 4) score += 10;
        if (
            video.currentSrc ||
            video.getAttribute('src') ||
            video.querySelector('source[src]')
        ) {
            score += 25;
        }
        if (!video.paused && !video.ended) score += 30;
        if (Number.isFinite(video.currentTime) && video.currentTime > 0)
            score += 15;
        if (score > bestScore) {
            bestScore = score;
            best = video;
        }
    }
    return best;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DisneyPlusAdapter implements PlatformAdapter {
    readonly nativeSubRecipe = DISNEY_NATIVE_SUB_RECIPE;
    private readonly clock: DisneyClock;
    private readonly timelineLocator = new TimelineLocator();

    constructor(
        private readonly context: AdapterContext,
        handoff: PlatformHandoff | null
    ) {
        const scratch = handoff?.platformScratch as
            DisneyHandoffScratch | null | undefined;
        this.clock = new DisneyClock({
            videoId: context.videoId,
            staleIdentity: scratch?.staleIdentity ?? null,
            locateTimeline: () => this.timelineLocator.locate(),
            requestTimeline: () => {
                context.bridge.sendControl({ t: 'request-playback-timeline' });
            },
            logger: context.logger,
        });
    }

    /** Page-world setup: start the program-clock poller for this session. */
    onBridgeConnected(): void {
        this.context.bridge.sendControl({ t: 'playback-bridge-resume' });
        this.context.bridge.sendControl({ t: 'request-playback-timeline' });
    }

    interpretSubtitleEvent(event: CapturedEvent): SubtitleFetchSpec | null {
        return event.t === 'subtitle-url'
            ? { kind: 'm3u8-master', url: event.url }
            : null;
    }

    onPlatformEvent(event: CapturedEvent): void {
        if (event.t !== 'timeline-update') {
            return;
        }
        const video = this.discoverVideo();
        if (video) {
            this.clock.onTimelineUpdate(event, video);
        }
    }

    getPlaybackTime(video: HTMLVideoElement): number | null {
        return this.clock.getPlaybackTime(video);
    }

    onClockInvalidated(): void {
        this.timelineLocator.reset();
        this.clock.invalidate();
    }

    discoverVideo(): HTMLVideoElement | null {
        return selectBestVideo([...document.querySelectorAll('video')]);
    }

    getPlayerContainer(video: HTMLVideoElement): HTMLElement | null {
        return video.parentElement;
    }

    // Playback control goes through Disney's own toggle: calling
    // video.pause() directly desynchronizes their player state.
    async pause(video: HTMLVideoElement): Promise<boolean> {
        if (video.paused || video.ended) {
            return true;
        }
        return this.toggleAndVerify(video, false);
    }

    async play(video: HTMLVideoElement): Promise<boolean> {
        if (!video.paused) {
            return true;
        }
        return this.toggleAndVerify(video, true);
    }

    private async toggleAndVerify(
        video: HTMLVideoElement,
        expectPlaying: boolean
    ): Promise<boolean> {
        const button = findPlayPauseButton();
        if (!button) {
            return false;
        }
        button.click();
        await sleep(PLAYBACK_TRANSITION_DELAY_MS);
        if (!video.isConnected) {
            return false;
        }
        const playing = !video.paused && !video.ended;
        return playing === expectPlaying;
    }

    beforeAbort(): void {
        this.context.bridge.sendControl({ t: 'playback-bridge-pause' });
    }

    dispose(): DisneyHandoffScratch {
        return { staleIdentity: this.clock.identityForHandoff() };
    }
}
