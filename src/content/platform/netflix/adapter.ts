import type { CapturedEvent } from '../../bridge/protocol';
import type {
    AdapterContext,
    MediaScope,
    NativeSubRecipe,
    PlatformAdapter,
    PlatformHandoff,
    SubtitleFetchSpec,
} from '../types';

const NETFLIX_NATIVE_SUB_RECIPE: NativeSubRecipe = {
    styleId: 'dualsub-netflix-subtitle-hider',
    selectors: [
        '.player-timedtext',
        '.player-timedtext-text-container',
        '[data-uia="player-timedtext-text-container"]',
        '.watch-video--bottom-controls-container .timedtext-text-container',
    ],
    css: `
        .player-timedtext[data-dualsub-hidden="true"],
        .player-timedtext-text-container[data-dualsub-hidden="true"],
        [data-uia="player-timedtext-text-container"][data-dualsub-hidden="true"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
        }
    `,
    observedRoots(media: MediaScope) {
        return media.root ? [media.root] : [];
    },
};

export class NetflixAdapter implements PlatformAdapter {
    readonly nativeSubRecipe = NETFLIX_NATIVE_SUB_RECIPE;

    constructor(
        private readonly context: AdapterContext,
        _handoff: PlatformHandoff | null
    ) {}

    interpretSubtitleEvent(event: CapturedEvent): SubtitleFetchSpec | null {
        if (event.t !== 'subtitle-data' || event.tracks.length === 0) {
            return null;
        }
        return { kind: 'netflix-tracks', tracks: event.tracks };
    }

    onPlatformEvent(): void {}

    /** HTML5 media time is program time on Netflix. */
    getPlaybackTime(video: HTMLVideoElement): number | null {
        const time = video.currentTime;
        return Number.isFinite(time) ? time : null;
    }

    onClockInvalidated(): void {}

    discoverVideo(): HTMLVideoElement | null {
        return document.querySelector('video');
    }

    getPlayerContainer(video: HTMLVideoElement): HTMLElement | null {
        return video.closest('div.watch-video');
    }

    pause(video: HTMLVideoElement): Promise<boolean> {
        if (!video.paused && !video.ended) {
            video.pause();
        }
        return Promise.resolve(video.paused || video.ended);
    }

    async play(video: HTMLVideoElement): Promise<boolean> {
        if (!video.paused) {
            return true;
        }
        try {
            await video.play();
        } catch {
            return false;
        }
        return !video.paused;
    }

    beforeAbort(): void {}

    dispose(): unknown {
        this.context.logger.debug('Netflix adapter disposed');
        return null;
    }
}
