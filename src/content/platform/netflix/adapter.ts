import type { CapturedEvent } from '../../bridge/protocol';
import type {
    AdapterContext,
    MediaScope,
    NativeSubRecipe,
    PlatformAdapter,
    PlatformHandoff,
    SubtitleSource,
} from '../types';
import { pauseMedia, playMedia } from '../shared/directMedia';
import { PageTrackRequests } from '../shared/pageTracks';

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
    private readonly tracks: PageTrackRequests;

    constructor(
        private readonly context: AdapterContext,
        _handoff: PlatformHandoff | null
    ) {
        this.tracks = new PageTrackRequests(context, 'netflix');
    }

    interpretSubtitleEvent(event: CapturedEvent): SubtitleSource | null {
        return this.tracks.interpret(event);
    }

    onPlatformEvent(): void {}

    /** Track URLs and the viewer's subtitle appearance live in the page's
     *  player; ask for them once the bridge is up. */
    onBridgeConnected(): void {
        this.tracks.send();
        this.context.bridge.sendControl({ t: 'request-subtitle-appearance' });
    }

    onLanguagesChanged(): void {
        this.tracks.send();
    }

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
        return pauseMedia(video);
    }

    play(video: HTMLVideoElement): Promise<boolean> {
        return playMedia(video);
    }

    beforeAbort(): void {
        this.tracks.cancel();
    }

    dispose(): unknown {
        this.context.logger.debug('Netflix adapter disposed');
        return null;
    }
}
