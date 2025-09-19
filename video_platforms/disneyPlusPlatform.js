import { VideoPlatform } from './platform_interface.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { MessageActions } from '../content_scripts/shared/constants/messageActions.js';

import { Injection } from '../content_scripts/shared/constants/injection.js';

const INJECT_SCRIPT_FILENAME = Injection.disneyplus.SCRIPT_FILENAME;
const INJECT_SCRIPT_TAG_ID = Injection.disneyplus.SCRIPT_TAG_ID;
const INJECT_EVENT_ID = Injection.disneyplus.EVENT_ID; // Must match inject.js

import { BasePlatformAdapter } from './BasePlatformAdapter.js';

export class DisneyPlusPlatform extends BasePlatformAdapter {
    constructor() {
        super();
        this.logger = Logger.create('DisneyPlusPlatform', configService);
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        this.eventListener = null; // To store the bound event listener for removal
        this.initializeLogger();
    }

    /**
     * Initialize logger with logging level detection
     */
    async initializeLogger() {
        try {
            await this.logger.updateLevel();
        } catch (error) {
            console.warn(
                'DisneyPlusPlatform: Failed to initialize logger level:',
                error
            );
        }
    }

    /**
     * Gets the platform name.
     * @returns {string} The platform name, 'disneyplus'.
     */
    getPlatformName() {
        return 'disneyplus';
    }

    isPlatformActive() {
        return window.location.hostname.includes('disneyplus.com');
    }

    isPlayerPageActive() {
        // For Disney+, player pages typically include "/video/" in the pathname.
        return (
            window.location.pathname.includes('/video/') ||
            window.location.pathname.includes('/play/')
        );
    }

    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        if (!this.isPlatformActive()) return;

        this.setCallbacks(onSubtitleUrlFound, onVideoIdChange);

        this.eventListener = this._handleInjectorEvents.bind(this);
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);

        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window',
        ];
        this.setupNativeSubtitleSettingsListener(disneyPlusSubtitleSelectors);

        this.logger.info('Initialized and event listener added', {
            selectors: disneyPlusSubtitleSelectors,
        });
    }

    _handleInjectorEvents(e) {
        const data = e.detail;
        if (!data || !data.type) return;

        if (data.type === 'INJECT_SCRIPT_READY') {
            this.logger.info('Inject script is ready');
        } else if (data.type === 'SUBTITLE_URL_FOUND') {
            const injectedVideoId = data.videoId;
            const vttMasterUrl = data.url;

            if (!injectedVideoId) {
                this.logger.error(
                    'SUBTITLE_URL_FOUND event without a videoId',
                    null,
                    {
                        url: vttMasterUrl,
                    }
                );
                return;
            }
            this.logger.info('SUBTITLE_URL_FOUND for injectedVideoId', {
                injectedVideoId: injectedVideoId,
                url: vttMasterUrl,
            });

            if (this.currentVideoId !== injectedVideoId) {
                this.logger.info('Video context changing', {
                    previousVideoId: this.currentVideoId || 'null',
                    newVideoId: injectedVideoId,
                });
                if (this.currentVideoId) {
                    delete this.lastKnownVttUrlForVideoId[this.currentVideoId];
                }
                this.setVideoIdAndNotify(injectedVideoId);
            } else if (
                this.lastKnownVttUrlForVideoId[this.currentVideoId] ===
                vttMasterUrl
            ) {
                this.logger.debug('VTT URL already processed or known', {
                    url: vttMasterUrl,
                    videoId: this.currentVideoId,
                });
                // If content.js needs to re-evaluate subtitles with existing data, it can do so.
                // For now, we assume if the URL is the same, no new fetch is needed unless forced by content.js logic
                // Potentially, we could resend the last known VTT text here if onSubtitleUrlFoundCallback expects it every time.
                return; // Or decide if re-sending old data is needed.
            }

            this.logger.info('Requesting VTT from background', {
                url: vttMasterUrl,
                videoId: this.currentVideoId,
            });

            // Get user settings for language preferences
            configService
                .getMultiple(['targetLanguage', 'originalLanguage'])
                .then((settings) => {
                    const targetLanguage = settings.targetLanguage || 'zh-CN';
                    const originalLanguage = settings.originalLanguage || 'en';

                    this.requestVttViaMessaging(
                        vttMasterUrl,
                        targetLanguage,
                        originalLanguage
                    )
                        .then((response) => {
                            if (
                                response &&
                                response.success &&
                                response.videoId === this.currentVideoId
                            ) {
                                this.logger.info('VTT fetched successfully', {
                                    videoId: this.currentVideoId,
                                    sourceLanguage: response.sourceLanguage,
                                    targetLanguage: response.targetLanguage,
                                });
                                this.lastKnownVttUrlForVideoId[
                                    this.currentVideoId
                                ] = response.url;
                                if (this.onSubtitleUrlFoundCallback) {
                                    this.onSubtitleUrlFoundCallback({
                                        vttText: response.vttText,
                                        targetVttText: response.targetVttText,
                                        videoId: response.videoId,
                                        url: response.url,
                                        sourceLanguage: response.sourceLanguage,
                                        targetLanguage: response.targetLanguage,
                                        useNativeTarget:
                                            response.useNativeTarget,
                                        availableLanguages:
                                            response.availableLanguages,
                                        selectedLanguage:
                                            response.selectedLanguage,
                                        targetLanguageInfo:
                                            response.targetLanguageInfo,
                                    });
                                }
                            } else if (response && !response.success) {
                                this.logger.error(
                                    'Background failed to fetch VTT',
                                    null,
                                    {
                                        error: response.error || 'Unknown',
                                        url: response.url,
                                        videoId: this.currentVideoId,
                                    }
                                );
                            } else if (
                                response &&
                                response.videoId !== this.currentVideoId
                            ) {
                                this.logger.warn(
                                    'Received VTT for different video context - discarding',
                                    {
                                        receivedVideoId: response.videoId,
                                        currentVideoId: this.currentVideoId,
                                    }
                                );
                            } else {
                                this.logger.error(
                                    'No/invalid response from background for fetchVTT',
                                    null,
                                    {
                                        url: vttMasterUrl,
                                        videoId: this.currentVideoId,
                                    }
                                );
                            }
                        })
                        .catch((_error) => {
                            // Log chrome lastError if present for detailed diagnostics (test expectations)
                            const lastErr = chrome?.runtime?.lastError;
                            if (lastErr) {
                                this.logger.error('Error for VTT fetch', lastErr, {
                                    url: vttMasterUrl,
                                    videoId: this.currentVideoId,
                                });
                            } else {
                                this.logger.error(
                                    'No/invalid response from background for fetchVTT',
                                    null,
                                    {
                                        url: vttMasterUrl,
                                        videoId: this.currentVideoId,
                                    }
                                );
                            }
                        });
                });
        }
    }

    handleInjectorEvents(e) {
        this._handleInjectorEvents(e);
    }

    getVideoElement() {
        return document.querySelector('video');
    }

    getCurrentVideoId() {
        return this.currentVideoId;
    }

    getPlayerContainerElement() {
        const videoElement = this.getVideoElement();
        return videoElement ? videoElement.parentElement : null;
    }

    getProgressBarElement() {
        // Disney+ specific: read from progress-bar web component's shadow DOM
        try {
            // Prefer the controls footer progress bar
            const preferredHosts = Array.from(
                document.querySelectorAll(
                    '.controls__footer__progressWrapper progress-bar'
                )
            );
            const allHosts = preferredHosts.length
                ? preferredHosts
                : Array.from(document.querySelectorAll('progress-bar'));

            let bestThumb = null;
            let bestMax = -1;
            for (const host of allHosts) {
                if (!host || !host.shadowRoot) continue;
                const thumb = host.shadowRoot.querySelector(
                    '.progress-bar__seekable-range .progress-bar__thumb[aria-valuenow][aria-valuemax]'
                );
                if (!thumb) continue;
                const vmax = parseFloat(
                    thumb.getAttribute('aria-valuemax') || 'NaN'
                );
                if (!Number.isNaN(vmax) && vmax > bestMax) {
                    bestMax = vmax;
                    bestThumb = thumb;
                }
            }
            return bestThumb || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Deep querySelector that traverses shadow DOM trees to find the first match
     * @param {string[]|string} selectors - One or more selectors to try
     * @returns {Element|null}
     * @private
     */
    _querySelectorDeep(selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        const visited = new Set();
        const queue = [document];

        while (queue.length) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);

            for (const sel of selectorList) {
                try {
                    const el = root.querySelector(sel);
                    if (el) return el;
                } catch (_) {}
            }

            let nodes = [];
            try {
                nodes = root.querySelectorAll('*');
            } catch (_) {
                nodes = [];
            }
            for (const node of nodes) {
                if (node && node.shadowRoot) {
                    queue.push(node.shadowRoot);
                }
            }
        }
        return null;
    }

    handleNativeSubtitles() {
        // Disney+ subtitle containers to hide (actual selectors from Disney+ DOM)
        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window',
        ];

        this.handleNativeSubtitlesWithSetting(disneyPlusSubtitleSelectors);
        this.setupDisneyPlusSubtitleMonitoring();
    }

    setupDisneyPlusSubtitleMonitoring() {
        // Add CSS to force hide Disney+ subtitles when needed
        this.addDisneyPlusSubtitleCSS();

        // Monitor for dynamically created subtitle elements
        this.setupSubtitleMutationObserver();
    }

    addDisneyPlusSubtitleCSS() {
        // Add CSS rules that are more specific and use !important
        const cssId = 'dualsub-disneyplus-subtitle-hider';
        let styleElement = document.getElementById(cssId);

        if (!styleElement) {
            // Validate that document.head exists before appending
            if (!document.head || !(document.head instanceof Node)) {
                console.warn(
                    '[DisneyPlusPlatform] document.head not available, cannot inject CSS'
                );
                return;
            }

            try {
                styleElement = document.createElement('style');
                styleElement.id = cssId;
                document.head.appendChild(styleElement);
            } catch (error) {
                console.error(
                    '[DisneyPlusPlatform] Failed to inject CSS:',
                    error
                );
                return;
            }
        }

        // CSS rules that will be applied when hiding is enabled
        const hidingCSS = `
            .TimedTextOverlay[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .hive-subtitle-renderer-wrapper[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .hive-subtitle-renderer-cue-positioning-box[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .hive-subtitle-renderer-cue-window[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
        `;

        styleElement.textContent = hidingCSS;
    }

    setupSubtitleMutationObserver() {
        // Disconnect any existing observer
        if (this.subtitleObserver) {
            this.subtitleObserver.disconnect();
        }

        // Validate that document.body exists before setting up observer
        if (!document.body || !(document.body instanceof Node)) {
            console.warn(
                '[DisneyPlusPlatform] document.body not available, retrying in 100ms'
            );
            setTimeout(() => {
                this.setupSubtitleMutationObserver();
            }, 100);
            return;
        }

        try {
            // Set up mutation observer to catch dynamically created subtitle elements
            this.subtitleObserver = new MutationObserver((mutations) => {
                let foundNewSubtitles = false;

                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check if the added node or its children contain subtitle elements
                                if (
                                    node.classList?.contains(
                                        'TimedTextOverlay'
                                    ) ||
                                    node.classList?.contains(
                                        'hive-subtitle-renderer-wrapper'
                                    ) ||
                                    node.querySelector?.(
                                        '.TimedTextOverlay, .hive-subtitle-renderer-wrapper'
                                    )
                                ) {
                                    foundNewSubtitles = true;
                                }
                            }
                        });
                    }
                });

                if (foundNewSubtitles) {
                    // Reapply hiding rules after a short delay
                    setTimeout(() => {
                        this.applyCurrentSubtitleSetting();
                    }, 100);
                }
            });

            // Start observing the document body for changes
            this.subtitleObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });

            console.log(
                '[DisneyPlusPlatform] Subtitle mutation observer set up successfully'
            );
        } catch (error) {
            console.error(
                '[DisneyPlusPlatform] Failed to set up subtitle mutation observer:',
                error
            );
            // Retry after a delay
            setTimeout(() => {
                this.setupSubtitleMutationObserver();
            }, 500);
        }
    }

    async applyCurrentSubtitleSetting() {
        // Reuse base class cache when possible to avoid frequent storage calls
        let hideOfficialSubtitles = this._hideOfficialSubtitles;
        if (hideOfficialSubtitles === undefined) {
            try {
                hideOfficialSubtitles = await configService.get(
                    'hideOfficialSubtitles'
                );
                this._hideOfficialSubtitles = !!hideOfficialSubtitles;
            } catch (_) {
                hideOfficialSubtitles = false;
            }
        }

        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window',
        ];

        if (hideOfficialSubtitles) {
            this.hideOfficialSubtitleContainers(disneyPlusSubtitleSelectors);
        } else {
            this.showOfficialSubtitleContainers();
        }
    }

    cleanup() {
        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            this.logger.debug('Event listener removed');
        }

        this.cleanupNativeSubtitleSettingsListener();

        if (this.subtitleObserver) {
            this.subtitleObserver.disconnect();
            this.subtitleObserver = null;
            this.logger.debug('Subtitle mutation observer cleaned up');
        }

        // Remove our custom CSS
        const cssElement = document.getElementById(
            'dualsub-disneyplus-subtitle-hider'
        );
        if (cssElement) {
            cssElement.remove();
        }

        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        this.logger.info('Platform cleaned up successfully');
    }
}
