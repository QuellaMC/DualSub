import { configService } from '../services/configService.js';
import { Injection } from '../content_scripts/shared/constants/injection.js';
import {
    extractNetflixVideoIdFromPathname,
    extractNetflixVideoIdFromUrl,
    normalizeNetflixVideoId,
    readOwnDataProperty,
    readOwnPrimitiveDataProperty,
} from '../content_scripts/shared/subtitleRequestIdentity.js';
import { BasePlatformAdapter } from './BasePlatformAdapter.js';

const SUBTITLE_SELECTORS = [
    '.player-timedtext',
    '.watch-video--bottom-controls-container .timedtext-text-container',
    '.player-timedtext-text-container',
    '[data-uia="player-timedtext-text-container"]',
];
const STYLE_ID = 'dualsub-netflix-subtitle-hider';
const SUBTITLE_CSS = `
    .player-timedtext[data-dualsub-hidden="true"],
    .player-timedtext-text-container[data-dualsub-hidden="true"],
    [data-uia="player-timedtext-text-container"][data-dualsub-hidden="true"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
    }
`;

function findTrackUrl(tracks) {
    for (const track of tracks) {
        if (track?.isNoneTrack || track?.isForcedNarrative) continue;
        const downloadables =
            track?.ttDownloadables || track?.rawTrack?.ttDownloadables;
        if (!downloadables || typeof downloadables !== 'object') continue;
        for (const format of Object.values(downloadables)) {
            const url = format?.urls?.[0]?.url;
            if (typeof url === 'string' && url) return url;
        }
    }
    return null;
}

export class NetflixPlatform extends BasePlatformAdapter {
    constructor() {
        super('NetflixPlatform');
        this.preloadedSubtitleBuffer = Object.create(null);
    }

    isPlatformActive() {
        return window.location.hostname.includes('netflix.com');
    }

    isPlayerPageActive() {
        return Boolean(
            extractNetflixVideoIdFromPathname(window.location.pathname)
        );
    }

    hasAdoptedPlayerRoute(url) {
        const routeVideoId = extractNetflixVideoIdFromUrl(url);
        return Boolean(routeVideoId && routeVideoId === this.currentVideoId);
    }

    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        this._retirePlatformLifecycle();
        this.preloadedSubtitleBuffer = Object.create(null);
        if (!this.isPlatformActive()) return;

        this.setCallbacks(onSubtitleUrlFound, onVideoIdChange);
        this._beginPlatformLifecycle();
        this.setupNativeSubtitleSettingsListener(SUBTITLE_SELECTORS);
    }

    handleInjectorEvents(data, generation = this._lifecycleGeneration) {
        if (!data || !this._isPlatformLifecycleCurrent(generation)) return;
        const type = readOwnPrimitiveDataProperty(data, 'type');
        if (type === 'INJECT_SCRIPT_READY') {
            this._logBestEffort('info', 'Inject script is ready');
            return;
        }
        if (type !== 'SUBTITLE_DATA_FOUND') return;
        return this._handleSubtitleData(
            readOwnDataProperty(data, 'payload'),
            generation
        );
    }

    async _handleSubtitleData(payload, generation) {
        const isLifecycleCurrent = () =>
            this._isPlatformLifecycleCurrent(generation);
        const movieId = normalizeNetflixVideoId(
            readOwnPrimitiveDataProperty(payload, 'movieId')
        );
        const tracks = readOwnDataProperty(payload, 'timedtexttracks');
        if (!movieId || !Array.isArray(tracks) || tracks.length === 0) return;

        const routeVideoId = this.extractMovieIdFromUrl();
        if (!routeVideoId) return;
        if (movieId !== routeVideoId) {
            if (isLifecycleCurrent()) {
                this.preloadedSubtitleBuffer[movieId] = tracks;
            }
            return;
        }

        if (this.currentVideoId !== routeVideoId) {
            this.setVideoIdAndNotify(routeVideoId);
        }
        if (!isLifecycleCurrent()) return;

        const url = findTrackUrl(tracks);
        if (!url) return;
        const { request } = this.beginVttRequest(url, routeVideoId);
        if (!request) return;

        const requestIsCurrent = () =>
            isLifecycleCurrent() &&
            this.extractMovieIdFromUrl() === routeVideoId &&
            this.isVttRequestCurrent(request);

        try {
            const settings = await configService.getMultiple([
                'targetLanguage',
                'originalLanguage',
                'useNativeSubtitles',
                'useOfficialTranslations',
            ]);
            if (!requestIsCurrent()) return;

            const useOfficialSubtitles =
                settings.useOfficialTranslations ??
                settings.useNativeSubtitles ??
                true;
            const response = await this.requestNetflixVttWithTracks(
                tracks,
                settings.targetLanguage || 'zh-CN',
                settings.originalLanguage || 'en',
                useOfficialSubtitles,
                routeVideoId,
                requestIsCurrent
            );
            this.deliverVttResponse(request, response, requestIsCurrent);
        } catch {
            this._logBestEffort('error', 'Netflix subtitle request failed');
        } finally {
            this.finishVttRequest(request);
        }
    }

    onUrlChange() {
        const generation = this._lifecycleGeneration;
        if (!this._isPlatformLifecycleCurrent(generation)) return;
        const movieId = this.extractMovieIdFromUrl();
        const tracks = this.preloadedSubtitleBuffer[movieId];
        if (!Array.isArray(tracks) || tracks.length === 0) return;

        delete this.preloadedSubtitleBuffer[movieId];
        return this.handleInjectorEvents(
            {
                type: 'SUBTITLE_DATA_FOUND',
                payload: { movieId, timedtexttracks: tracks },
            },
            generation
        );
    }

    getVideoElement() {
        return document.querySelector('video');
    }

    getCurrentVideoId() {
        return this.currentVideoId;
    }

    extractMovieIdFromUrl() {
        return extractNetflixVideoIdFromUrl(window.location.href);
    }

    getPlayerContainerElement() {
        return this.getVideoElement()?.closest('div.watch-video') || null;
    }

    isPlaying() {
        return this._getMediaPlayingState();
    }

    async pausePlayback() {
        try {
            const video = this.getVideoElement();
            const state = this._getMediaPlayingState(video);
            if (state === null) return false;
            if (!state) return true;
            video.pause();
            return this._getMediaPlayingState(this.getVideoElement()) === false;
        } catch {
            return false;
        }
    }

    async resumePlayback() {
        try {
            const video = this.getVideoElement();
            const state = this._getMediaPlayingState(video);
            if (state === null) return false;
            if (state) return true;
            await video.play();
            return this._getMediaPlayingState(this.getVideoElement()) === true;
        } catch {
            return false;
        }
    }

    supportsProgressBarTracking() {
        return false;
    }

    handleNativeSubtitles() {
        void this.handleNativeSubtitlesWithSetting(SUBTITLE_SELECTORS);
        this.installSubtitleHidingStyle(STYLE_ID, SUBTITLE_CSS);
        this.setupSubtitleObserver({
            getRoots: () => [this.getPlayerContainerElement()],
            matches: (node) =>
                node?.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.(
                    '.player-timedtext, .player-timedtext-text-container'
                ) ||
                    node.querySelector?.(
                        '.player-timedtext, .player-timedtext-text-container'
                    )),
            reapply: (generation) =>
                this.handleNativeSubtitlesWithSetting(
                    SUBTITLE_SELECTORS,
                    () => generation === this.ownedTimeoutGeneration
                ),
        });
    }

    _retirePlatformLifecycle() {
        this._retireAdapterLifecycle();
        this.preloadedSubtitleBuffer = Object.create(null);
    }

    cleanup() {
        this._retirePlatformLifecycle();
        document.getElementById(STYLE_ID)?.remove();
        document.getElementById(Injection.netflix.SCRIPT_TAG_ID)?.remove();
    }
}
