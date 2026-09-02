import type { CapturedEvent } from '../../bridge/protocol';
import type {
    AdapterContext,
    MediaScope,
    NativeSubRecipe,
    PlatformAdapter,
    PlatformHandoff,
    SubtitleLanguages,
    SubtitleSource,
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

/** Languages the page bridge should resolve, original first. The target is
 *  only wanted when official translations may replace API translation. */
export function requestedSubtitleLanguages(
    languages: SubtitleLanguages
): string[] {
    return languages.useOfficialTranslations
        ? [languages.originalLanguage, languages.targetLanguage]
        : [languages.originalLanguage];
}

function sameLanguages(
    left: readonly string[],
    right: readonly string[]
): boolean {
    return (
        left.length === right.length &&
        left.every((language, index) => language === right[index])
    );
}

export class NetflixAdapter implements PlatformAdapter {
    readonly nativeSubRecipe = NETFLIX_NATIVE_SUB_RECIPE;

    constructor(
        private readonly context: AdapterContext,
        _handoff: PlatformHandoff | null
    ) {}

    interpretSubtitleEvent(event: CapturedEvent): SubtitleSource | null {
        if (event.t !== 'subtitle-data') {
            return null;
        }
        // A resolution for other languages answered an earlier request;
        // the one for the current languages is on its way.
        const requested = requestedSubtitleLanguages(this.context.languages());
        if (!sameLanguages(event.languages, requested)) {
            return null;
        }
        if (event.tracks.length === 0) {
            this.context.logger.warn(
                'Netflix resolved no subtitle track for the requested languages',
                { videoId: this.context.videoId }
            );
            return { kind: 'unavailable' };
        }
        return { kind: 'netflix-tracks', tracks: event.tracks };
    }

    onPlatformEvent(): void {}

    /** Track URLs live in the page's player; ask for them once the bridge
     *  is up. A later ask supersedes an earlier one. */
    onBridgeConnected(): void {
        this.requestTracks();
    }

    onLanguagesChanged(): void {
        this.requestTracks();
    }

    private requestTracks(): void {
        this.context.bridge.sendControl({
            t: 'request-subtitle-tracks',
            videoId: this.context.videoId,
            languages: requestedSubtitleLanguages(this.context.languages()),
        });
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

    beforeAbort(): void {
        this.context.bridge.sendControl({ t: 'cancel-subtitle-tracks' });
    }

    dispose(): unknown {
        this.context.logger.debug('Netflix adapter disposed');
        return null;
    }
}
