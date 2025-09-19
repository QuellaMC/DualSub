import { VideoPlatform } from './platform_interface.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { MessageActions } from '../content_scripts/shared/constants/messageActions.js';

/**
 * BasePlatformAdapter - shared wiring for platform adapters
 * Provides common logger initialization, videoId tracking, and VTT request helpers.
 */
export class BasePlatformAdapter extends VideoPlatform {
    constructor(adapterName = 'BasePlatformAdapter') {
        super();
        try {
            this.logger = Logger.create(adapterName, configService);
        } catch (error) {
            // Fallback logger to avoid hard failures in non-extension contexts
            this.logger = {
                debug: (...args) => console.debug(`[${adapterName}]`, ...args),
                info: (...args) => console.info(`[${adapterName}]`, ...args),
                warn: (...args) => console.warn(`[${adapterName}]`, ...args),
                error: (...args) => console.error(`[${adapterName}]`, ...args),
                updateLevel: () => Promise.resolve(),
            };
        }

        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = Object.create(null);
        this.eventListener = null;
    }

    async initializeLogger() {
        try {
            if (this.logger && this.logger.updateLevel) {
                await this.logger.updateLevel();
            }
        } catch (error) {
            this.logger?.warn(
                'Failed to initialize logger level, continuing with defaults',
                { error: error?.message }
            );
        }
    }

    setCallbacks(onSubtitleUrlFound, onVideoIdChange) {
        this.onSubtitleUrlFoundCallback = onSubtitleUrlFound;
        this.onVideoIdChangeCallback = onVideoIdChange;
    }

    setVideoIdAndNotify(newVideoId) {
        if (this.currentVideoId !== newVideoId) {
            this.logger.info('Video context changing', {
                previousVideoId: this.currentVideoId || 'null',
                newVideoId,
            });
            if (this.currentVideoId) {
                delete this.lastKnownVttUrlForVideoId[this.currentVideoId];
            }
            this.currentVideoId = newVideoId;
            this.onVideoIdChangeCallback?.(this.currentVideoId);
        }
    }

    isDuplicateVttUrl(url) {
        return this.lastKnownVttUrlForVideoId[this.currentVideoId] === url;
    }

    markVttUrlProcessed(url) {
        this.lastKnownVttUrlForVideoId[this.currentVideoId] = url;
    }

    async _sendMessageResilient(
        message,
        { retries = 3, baseDelayMs = 150 } = {}
    ) {
        // Delegate to shared resilient messaging wrapper which handles callback vs. promise paths and retries.
        const { sendRuntimeMessageWithRetry } = await import(
            chrome.runtime.getURL('content_scripts/shared/messaging.js')
        );
        return await sendRuntimeMessageWithRetry(message, {
            retries,
            baseDelayMs,
        });
    }

    async requestVttViaMessaging(vttUrl, targetLanguage, originalLanguage) {
        const message = {
            action: MessageActions.FETCH_VTT,
            url: vttUrl,
            videoId: this.currentVideoId,
            targetLanguage,
            originalLanguage,
        };
        return await this._sendMessageResilient(message, {
            retries: 3,
            baseDelayMs: 150,
        });
    }

    async requestNetflixVttWithTracks(
        timedtexttracks,
        targetLanguage,
        originalLanguage,
        useOfficialSubtitles
    ) {
        const message = {
            action: MessageActions.FETCH_VTT,
            data: { tracks: timedtexttracks },
            videoId: this.currentVideoId,
            targetLanguage,
            originalLanguage,
            useNativeSubtitles: useOfficialSubtitles,
            useOfficialTranslations: useOfficialSubtitles,
            source: 'netflix',
        };
        return await this._sendMessageResilient(message, {
            retries: 3,
            baseDelayMs: 150,
        });
    }
}
