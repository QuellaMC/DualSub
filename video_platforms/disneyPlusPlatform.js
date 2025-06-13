import { VideoPlatform } from './platform_interface.js';

const INJECT_SCRIPT_FILENAME = 'content_scripts/inject.js';
const INJECT_SCRIPT_TAG_ID = 'disneyplus-dualsub-injector-script-tag';
const INJECT_EVENT_ID = 'disneyplus-dualsub-injector-event'; // Must match inject.js

export class DisneyPlusPlatform extends VideoPlatform {
    constructor() {
        super();
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        this.eventListener = null; // To store the bound event listener for removal
    }

    isPlatformActive() {
        return window.location.hostname.includes('disneyplus.com');
    }

    isPlayerPageActive() {
        // For Disney+, player pages typically include "/video/" in the pathname.
        return window.location.pathname.includes('/video/') || window.location.pathname.includes('/play/');
    }

    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        if (!this.isPlatformActive()) return;

        this.onSubtitleUrlFoundCallback = onSubtitleUrlFound;
        this.onVideoIdChangeCallback = onVideoIdChange;

        this._injectScript();

        // Store the bound listener to be able to remove it later
        this.eventListener = this._handleInjectorEvents.bind(this);
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);
        console.log("DisneyPlusPlatform: Initialized and event listener added.");
    }

    _injectScript() {
        if (document.getElementById(INJECT_SCRIPT_TAG_ID)) {
            console.log("DisneyPlusPlatform: Inject script tag already exists.");
            return;
        }
        try {
            const s = document.createElement('script');
            s.src = chrome.runtime.getURL(INJECT_SCRIPT_FILENAME);
            s.id = INJECT_SCRIPT_TAG_ID;
            (document.head || document.documentElement).appendChild(s);
            s.onload = () => console.log('DisneyPlusPlatform: Inject.js script tag loaded into page.');
            s.onerror = () => console.error('DisneyPlusPlatform: CRITICAL - Failed to load inject.js into page!');
            console.log("DisneyPlusPlatform: Attempting to inject inject.js into page from:", s.src);
        } catch (e) {
            console.error("DisneyPlusPlatform: CRITICAL - Error during inject.js injection attempt:", e);
        }
    }

    _handleInjectorEvents(e) {
        const data = e.detail;
        if (!data || !data.type) return;

        if (data.type === 'INJECT_SCRIPT_READY') {
            console.log("DisneyPlusPlatform: Inject script is ready.");
        } else if (data.type === 'SUBTITLE_URL_FOUND') {
            const injectedVideoId = data.videoId;
            const vttMasterUrl = data.url;

            if (!injectedVideoId) {
                console.error("DisneyPlusPlatform: SUBTITLE_URL_FOUND event without a videoId. URL:", vttMasterUrl);
                return;
            }
            console.log(`DisneyPlusPlatform: SUBTITLE_URL_FOUND for injectedVideoId: '${injectedVideoId}'. URL: ${vttMasterUrl}`);

            if (this.currentVideoId !== injectedVideoId) {
                console.log(`DisneyPlusPlatform: Video context changing from '${this.currentVideoId || "null"}' to '${injectedVideoId}'.`);
                if (this.currentVideoId) {
                    delete this.lastKnownVttUrlForVideoId[this.currentVideoId];
                }
                this.currentVideoId = injectedVideoId;
                if (this.onVideoIdChangeCallback) {
                    this.onVideoIdChangeCallback(this.currentVideoId);
                }
            } else if (this.lastKnownVttUrlForVideoId[this.currentVideoId] === vttMasterUrl) {
                console.log(`DisneyPlusPlatform: VTT URL ${vttMasterUrl} for videoId ${this.currentVideoId} already processed or known. Triggering re-evaluation if callback exists.`);
                // If content.js needs to re-evaluate subtitles with existing data, it can do so.
                // For now, we assume if the URL is the same, no new fetch is needed unless forced by content.js logic
                // Potentially, we could resend the last known VTT text here if onSubtitleUrlFoundCallback expects it every time.
                return; // Or decide if re-sending old data is needed.
            }

            console.log("DisneyPlusPlatform: Requesting VTT from background. URL:", vttMasterUrl, "Video ID:", this.currentVideoId);
            
            // Get user settings for language preferences
            chrome.storage.sync.get(['targetLanguage', 'originalLanguage'], (settings) => {
                const targetLanguage = settings.targetLanguage || 'zh-CN';
                const originalLanguage = settings.originalLanguage || 'en';
                
                chrome.runtime.sendMessage({ 
                    action: "fetchVTT", 
                    url: vttMasterUrl, 
                    videoId: this.currentVideoId,
                    targetLanguage: targetLanguage,
                    originalLanguage: originalLanguage
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("DisneyPlusPlatform: Error for VTT fetch:", chrome.runtime.lastError.message, "URL:", vttMasterUrl);
                        return;
                    }
                    if (response && response.success && response.videoId === this.currentVideoId) {
                        console.log(`DisneyPlusPlatform: VTT fetched successfully for ${this.currentVideoId}.`);
                        this.lastKnownVttUrlForVideoId[this.currentVideoId] = response.url; 
                        if (this.onSubtitleUrlFoundCallback) {
                            this.onSubtitleUrlFoundCallback({ 
                                vttText: response.vttText, 
                                targetVttText: response.targetVttText,
                                videoId: response.videoId, 
                                url: response.url,
                                sourceLanguage: response.sourceLanguage,
                                targetLanguage: response.targetLanguage,
                                useNativeTarget: response.useNativeTarget,
                                availableLanguages: response.availableLanguages,
                                selectedLanguage: response.selectedLanguage,
                                targetLanguageInfo: response.targetLanguageInfo
                            });
                        }
                    } else if (response && !response.success) {
                        console.error("DisneyPlusPlatform: Background failed to fetch VTT:", response.error || "Unknown", "URL:", response.url);
                    } else if (response && response.videoId !== this.currentVideoId) {
                        console.warn(`DisneyPlusPlatform: Received VTT for '${response.videoId}', but current context is '${this.currentVideoId}'. Discarding.`);
                    } else {
                        console.error("DisneyPlusPlatform: No/invalid response from background for fetchVTT. URL:", vttMasterUrl);
                    }
                });
            });
        }
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
        // This selector is based on the current content.js
        const videoElement = this.getVideoElement();
        if (!videoElement) return null;

        const playerParent = videoElement.closest('div[data-testid="webAppRootView"], body');
        const sliderSelector = 'div.slider-container[role="slider"]'; 
        return playerParent ? playerParent.querySelector(sliderSelector) : document.querySelector(`div.progress-bar ${sliderSelector}`);
    }
    
    handleNativeSubtitles() {
        // Disney+ native subtitles are typically handled by the player itself.
        // If we needed to hide them, we would add selectors here.
        // For now, no specific action is taken as dual subs are overlaid.
        console.log("DisneyPlusPlatform: handleNativeSubtitles called. No specific action taken.");
    }

    cleanup() {
        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            console.log("DisneyPlusPlatform: Event listener removed.");
        }
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        console.log("DisneyPlusPlatform: Cleaned up.");
    }
} 