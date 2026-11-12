import type { CapturedEvent } from '../../bridge/protocol';
import type {
    AdapterContext,
    MediaScope,
    NativeSubRecipe,
    PlatformAdapter,
    SubtitleSource,
} from '../types';
import { pauseMedia, playMedia } from '../shared/directMedia';
import { PageTrackRequests } from '../shared/pageTracks';
import {
    YOUTUBE_PLAYER_SELECTOR,
    onScreenArea,
    visibleVideoOf,
} from './player';

// YouTube keeps updating its caption window while it is hidden, so hiding
// the container is enough.
const YOUTUBE_NATIVE_SUB_RECIPE: NativeSubRecipe = {
    styleId: 'dualsub-youtube-subtitle-hider',
    selectors: ['.ytp-caption-window-container'],
    css: `
        .ytp-caption-window-container[data-dualsub-hidden="true"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
        }
    `,
    observedRoots(media: MediaScope) {
        return media.root ? [media.root] : [];
    },
};

/** The player the route plays in. */
function routePlayerSelector(): string {
    return location.pathname.startsWith('/shorts/')
        ? '#shorts-player'
        : '#movie_player';
}

export class YouTubeAdapter implements PlatformAdapter {
    readonly nativeSubRecipe = YOUTUBE_NATIVE_SUB_RECIPE;
    private readonly tracks: PageTrackRequests;

    constructor(private readonly context: AdapterContext) {
        this.tracks = new PageTrackRequests(context, 'youtube');
    }

    interpretSubtitleEvent(event: CapturedEvent): SubtitleSource | null {
        return this.tracks.interpret(event);
    }

    onPlatformEvent(): void {}

    /** Signed caption URLs live in the page's player. */
    onBridgeConnected(): void {
        this.tracks.send();
    }

    onLanguagesChanged(): void {
        this.tracks.send();
    }

    /** HTML5 media time is program time on YouTube, except while an ad
     *  plays in the same <video>: the player is marked `ad-showing` then. */
    getPlaybackTime(video: HTMLVideoElement): number | null {
        if (video.closest('.ad-showing')) {
            return null;
        }
        const time = video.currentTime;
        return Number.isFinite(time) ? time : null;
    }

    onClockInvalidated(): void {}

    /** The route's player with a picture, the one most on screen when a
     *  preload player is laid out beside it. A lone player stays bound
     *  while the page scrolls it out of view. */
    discoverVideo(): HTMLVideoElement | null {
        let best: HTMLVideoElement | null = null;
        let bestArea = -1;
        for (const player of document.querySelectorAll(routePlayerSelector())) {
            const video = visibleVideoOf(player);
            const area = video ? onScreenArea(video) : -1;
            if (area > bestArea) {
                best = video;
                bestArea = area;
            }
        }
        return best;
    }

    getPlayerContainer(video: HTMLVideoElement): HTMLElement | null {
        return video.closest<HTMLElement>(YOUTUBE_PLAYER_SELECTOR);
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
        this.context.logger.debug('YouTube adapter disposed');
        return null;
    }
}
