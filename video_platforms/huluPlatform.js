import { VideoPlatform } from './platform_interface.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { MessageActions } from '../content_scripts/shared/constants/messageActions.js';
import { Injection } from '../content_scripts/shared/constants/injection.js';
import { BasePlatformAdapter } from './BasePlatformAdapter.js';

const INJECT_SCRIPT_FILENAME = Injection.hulu.SCRIPT_FILENAME;
const INJECT_SCRIPT_TAG_ID = Injection.hulu.SCRIPT_TAG_ID;
const INJECT_EVENT_ID = Injection.hulu.EVENT_ID; // Must match huluInject.js

export class HuluPlatform extends BasePlatformAdapter {
    constructor() {
        super();
        this.logger = Logger.create('HuluPlatform', configService);
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        this.eventListener = null; // To store the bound event listener for removal
        this.initializeLogger();
    }

    /**
     * Gets the platform name.
     * @returns {string} The platform name, 'hulu'.
     */
    getPlatformName() {
        return 'hulu';
    }

    isPlatformActive() {
        return window.location.hostname.includes('hulu.com');
    }

    isPlayerPageActive() {
        // Hulu player pages typically include "/watch/" in the pathname.
        return window.location.pathname.includes('/watch/');
    }

    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        if (!this.isPlatformActive()) return;

        this.setCallbacks(onSubtitleUrlFound, onVideoIdChange);

        this.eventListener = this._handleInjectorEvents.bind(this);
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);

        const huluSubtitleSelectors = [
            '.closed-caption-renderer',
            '.subtitle-container',
        ];
        this.setupNativeSubtitleSettingsListener(huluSubtitleSelectors);

        this.logger.info('Initialized and event listener added', {
            selectors: huluSubtitleSelectors,
        });
    }

    _handleInjectorEvents(e) {
        const data = e.detail;
        if (!data || !data.type) return;

        if (data.type === 'INJECT_SCRIPT_READY') {
            this.logger.info('Inject script is ready');
            return;
        }

        if (data.type === 'HULU_TRANSCRIPTS_FOUND') {
            const { videoId, transcripts } = data;

            if (!videoId || !transcripts) {
                this.logger.error(
                    'Hulu transcripts event missing videoId or transcripts',
                    null,
                    { hasVideoId: !!videoId, hasTranscripts: !!transcripts }
                );
                return;
            }

            if (this.currentVideoId !== videoId) {
                this.logger.info('Video context changing', {
                    previousVideoId: this.currentVideoId || 'null',
                    newVideoId: videoId,
                });
                if (this.currentVideoId) {
                    delete this.lastKnownVttUrlForVideoId[this.currentVideoId];
                }
                this.setVideoIdAndNotify(videoId);
            }

            this.logger.info('Requesting Hulu subtitle processing from background', {
                videoId: this.currentVideoId,
                ttmlCount: Array.isArray(transcripts.ttml) ? transcripts.ttml.length : 0,
                vttCount: Array.isArray(transcripts.webvtt) ? transcripts.webvtt.length : 0,
            });

            // Get user settings for language preferences
            configService
                .getMultiple(['targetLanguage', 'originalLanguage', 'useNativeSubtitles', 'useOfficialTranslations'])
                .then((settings) => {
                    const {
                        targetLanguage = 'zh-CN',
                        originalLanguage = 'en',
                        useNativeSubtitles = true,
                        useOfficialTranslations,
                    } = settings;

                    // Hulu supports official transcripts; prefer them if enabled
                    const useOfficialSubtitles =
                        useOfficialTranslations !== undefined
                            ? useOfficialTranslations
                            : useNativeSubtitles;

                    const message = {
                        action: MessageActions.FETCH_VTT,
                        source: 'hulu',
                        data: { transcripts },
                        videoId: this.currentVideoId,
                        targetLanguage,
                        originalLanguage,
                        useNativeSubtitles: useOfficialSubtitles,
                        useOfficialTranslations: useOfficialSubtitles,
                    };

                    this._sendMessageResilient(message, { retries: 3, baseDelayMs: 150 })
                        .then((response) => {
                            if (response && response.success && response.videoId === this.currentVideoId) {
                                this.logger.info('Hulu subtitles processed successfully', {
                                    videoId: this.currentVideoId,
                                    sourceLanguage: response.sourceLanguage,
                                    targetLanguage: response.targetLanguage,
                                    useNativeTarget: response.useNativeTarget,
                                });

                                if (this.onSubtitleUrlFoundCallback) {
                                    this.onSubtitleUrlFoundCallback({
                                        vttText: response.vttText,
                                        targetVttText: response.targetVttText,
                                        videoId: response.videoId,
                                        url: response.url,
                                        sourceLanguage: response.sourceLanguage,
                                        targetLanguage: response.targetLanguage,
                                        useNativeTarget: response.useNativeTarget || false,
                                        availableLanguages: response.availableLanguages,
                                        selectedLanguage: response.selectedLanguage,
                                        targetLanguageInfo: response.targetLanguageInfo,
                                    });
                                }
                            } else if (response && !response.success) {
                                this.logger.error('Background failed to process Hulu subtitles', null, {
                                    error: response.error || 'Unknown',
                                    videoId: this.currentVideoId,
                                });
                            } else if (response && response.videoId !== this.currentVideoId) {
                                this.logger.warn('Received Hulu subtitles for different video context - discarding', {
                                    receivedVideoId: response.videoId,
                                    currentVideoId: this.currentVideoId,
                                });
                            } else {
                                this.logger.error('No/invalid response from background for Hulu fetchVTT', null, {
                                    videoId: this.currentVideoId,
                                });
                            }
                        })
                        .catch((_error) => {
                            const lastErr = chrome?.runtime?.lastError;
                            if (lastErr) {
                                this.logger.error('Error for Hulu VTT fetch', lastErr, {
                                    videoId: this.currentVideoId,
                                });
                            } else {
                                this.logger.error('No/invalid response from background for Hulu fetchVTT', null, {
                                    videoId: this.currentVideoId,
                                });
                            }
                        });
                });
        }
    }

    handleInjectorEvents(e) {
        this._handleInjectorEvents(e);
    }

    getVideoElement() {
        try {
            // Prefer the main content video over ad/intro players
            const primary = document.querySelector('#content-video-player');
            if (primary) return primary;

            // Fallback: pick a visible HTML5 video inside the player app
            const candidates = Array.from(
                document.querySelectorAll(
                    '#web-player-app video, .Player__container video, video'
                )
            );
            const visible = candidates.find((v) => {
                const rect = v.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            return visible || candidates[0] || null;
        } catch (_) {
            return document.querySelector('video');
        }
    }

    getCurrentVideoId() {
        return this.currentVideoId;
    }

    getPlayerContainerElement() {
        const videoElement = this.getVideoElement();
        if (!videoElement) return null;

        try {
            // Prefer app root and ContentPlayer host to ensure stable anchoring
            const preferredSelectors = [
                '#web-player-app',
                '.ContentPlayer',
                '.ContentPlayer__contentArea',
                '.Player__player',
                '.Player__flex-wrapper',
                '.Player__container',
                '#__player__',
            ];

            for (const sel of preferredSelectors) {
                try {
                    const host = videoElement.closest(sel);
                    if (host) return host;
                } catch (_) {}
            }
        } catch (_) {}

        // Fallback to the immediate parent of the video element
        return videoElement.parentElement || null;
    }

    getProgressBarElement() {
        try {
            // Prefer the ARIA slider element which exposes current time
            const slider = document.querySelector(
                '.Timeline__slider[aria-valuenow][aria-valuemax], div[role="slider"][aria-valuenow][aria-valuemax]'
            );
            if (slider) return slider;

            // Fallbacks
            const currentTs = document.querySelector('[data-testid="currentTimestamp"], .Timeline__currentTimestamp');
            if (currentTs) return currentTs;
        } catch (_) {}
        return null;
    }

    /**
     * Returns a stable element to observe for timeline mutations (slider might be replaced)
     */
    getProgressBarObserveTarget() {
        try {
            const timeline = document.querySelector('.Timeline, [data-testid="timeline"]');
            if (timeline) return timeline;
            const container = document.querySelector('.Timeline__sliderContainer');
            if (container) return container;
        } catch (_) {}
        // Fallback to the slider itself
        return this.getProgressBarElement();
    }

    supportsProgressBarTracking() {
        // Prefer Hulu's timeline slider updates during playback
        return true;
    }

    handleNativeSubtitles() {
        // Hulu subtitle containers to hide (best-effort selectors)
        const huluSubtitleSelectors = [
            '.closed-caption-renderer',
            '.subtitle-container',
        ];
        this.handleNativeSubtitlesWithSetting(huluSubtitleSelectors);
    }

    cleanup() {
        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            this.logger.debug('Event listener removed');
        }

        this.cleanupNativeSubtitleSettingsListener();

        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        this.logger.info('Hulu platform cleaned up successfully');
    }
}
