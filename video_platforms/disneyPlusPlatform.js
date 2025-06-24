import { VideoPlatform } from './platform_interface.js';

const INJECT_SCRIPT_FILENAME = 'injected_scripts/disneyPlusInject.js';
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


        // Store the bound listener to be able to remove it later
        this.eventListener = this._handleInjectorEvents.bind(this);
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);
        
        // Set up storage listener for subtitle settings
        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window'
        ];
        this.setupNativeSubtitleSettingsListener(disneyPlusSubtitleSelectors);
        
        console.log("DisneyPlusPlatform: Initialized and permanent event listener attached.");
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
        // Disney+ subtitle containers to hide (actual selectors from Disney+ DOM)
        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window'
        ];
        
        // Use the utility method from the base class
        this.handleNativeSubtitlesWithSetting(disneyPlusSubtitleSelectors);
        
        // Also set up monitoring system like Netflix
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
            styleElement = document.createElement('style');
            styleElement.id = cssId;
            document.head.appendChild(styleElement);
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
        
        // Set up mutation observer to catch dynamically created subtitle elements
        this.subtitleObserver = new MutationObserver((mutations) => {
            let foundNewSubtitles = false;
            
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if the added node or its children contain subtitle elements
                            if (node.classList?.contains('TimedTextOverlay') || 
                                node.classList?.contains('hive-subtitle-renderer-wrapper') ||
                                node.querySelector?.('.TimedTextOverlay, .hive-subtitle-renderer-wrapper')) {
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
            subtree: true
        });
    }

    applyCurrentSubtitleSetting() {
        chrome.storage.sync.get(['hideOfficialSubtitles'], (result) => {
            const hideOfficialSubtitles = result.hideOfficialSubtitles || false;
            
            const disneyPlusSubtitleSelectors = [
                '.TimedTextOverlay',
                '.hive-subtitle-renderer-wrapper',
                '.hive-subtitle-renderer-cue-positioning-box',
                '.hive-subtitle-renderer-cue-window'
            ];
            
            if (hideOfficialSubtitles) {
                this.hideOfficialSubtitleContainers(disneyPlusSubtitleSelectors);
            } else {
                this.showOfficialSubtitleContainers();
            }
        });
    }

    cleanup() {
        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            console.log("DisneyPlusPlatform: Event listener removed.");
        }
        
        // Clean up storage listener for subtitle settings
        this.cleanupNativeSubtitleSettingsListener();
        
        // Clean up mutation observer
        if (this.subtitleObserver) {
            this.subtitleObserver.disconnect();
            this.subtitleObserver = null;
        }
        
        // Remove our custom CSS
        const cssElement = document.getElementById('dualsub-disneyplus-subtitle-hider');
        if (cssElement) {
            cssElement.remove();
        }
        
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        console.log("DisneyPlusPlatform: Cleaned up.");
    }
} 