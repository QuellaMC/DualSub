// content_scripts/disneyPlusContent.js
// Simplified Disney+ content script using shared utilities

console.log("Disney+ Dual Subtitles content script loaded for Disney+.");

const LOG_PREFIX = "DisneyPlusContent";

// Platform management
let activePlatform = null;

// Shared utilities (loaded dynamically)
let subtitleUtils = null;
let DisneyPlusPlatform = null;

// Load the required modules dynamically
async function loadModules() {
    try {
        // Load the utilities module
        const utilsModule = await import(chrome.runtime.getURL('content_scripts/subtitleUtilities.js'));
        subtitleUtils = utilsModule;
        
        // Load the Disney+ platform module
        const platformModule = await import(chrome.runtime.getURL('video_platforms/disneyPlusPlatform.js'));
        DisneyPlusPlatform = platformModule.DisneyPlusPlatform;
        
        console.log(`${LOG_PREFIX}: Modules loaded successfully.`);
        return true;
    } catch (error) {
        console.error(`${LOG_PREFIX}: Error loading modules:`, error);
        return false;
    }
}

async function initializePlatform() {
    if (!DisneyPlusPlatform || !subtitleUtils) {
        console.log(`${LOG_PREFIX}: Modules not loaded yet. Initializing platform deferred.`);
        return;
    }

    // Instantiate the platform directly as we know we are on Disney+
    activePlatform = new DisneyPlusPlatform();
    
    if (activePlatform.isPlayerPageActive()) {
        console.log(`${LOG_PREFIX}: Initializing Disney+ platform.`);
        try {
            await activePlatform.initialize(
                (subtitleData) => subtitleUtils.handleSubtitleDataFound(subtitleData, activePlatform, LOG_PREFIX),
                (newVideoId) => {
                    subtitleUtils.handleVideoIdChange(newVideoId, LOG_PREFIX);
                    subtitleUtils.setCurrentVideoId(newVideoId);
                }
            );
            console.log(`${LOG_PREFIX}: Disney+ platform initialized successfully.`);
            activePlatform.handleNativeSubtitles();

            if (subtitleUtils.subtitlesActive) {
                subtitleUtils.ensureSubtitleContainer(activePlatform, LOG_PREFIX);
                subtitleUtils.showSubtitleContainer();
                const videoElement = activePlatform.getVideoElement();
                if (videoElement && videoElement.currentTime > 0) {
                    subtitleUtils.updateSubtitles(videoElement.currentTime, activePlatform, LOG_PREFIX);
                }
            }
        } catch (error) {
            console.error(`${LOG_PREFIX}: Error initializing Disney+ platform:`, error);
            activePlatform = null;
        }
    } else {
        console.log(`${LOG_PREFIX}: Not on a Disney+ player page. UI setup deferred.`);
        subtitleUtils.hideSubtitleContainer();
    }
}

// Chrome message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!subtitleUtils) {
        console.error(`${LOG_PREFIX}: Utilities not loaded, cannot handle message:`, request.action);
        sendResponse({ success: false, error: "Utilities not loaded" });
        return;
    }

    let needsDisplayUpdate = false;
    let actionHandled = true;

    switch (request.action) {
        case "toggleSubtitles":
            subtitleUtils.setSubtitlesActive(request.enabled);
            console.log(`${LOG_PREFIX}: Subtitle active state changed to ${request.enabled}`);
            if (!request.enabled) {
                subtitleUtils.hideSubtitleContainer();
                subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, true, LOG_PREFIX);
                if (activePlatform) activePlatform.cleanup();
                activePlatform = null;
            } else {
                if (!activePlatform) {
                    initializePlatform().then(() => {
                        if (activePlatform && activePlatform.isPlayerPageActive()) {
                            subtitleUtils.ensureSubtitleContainer(activePlatform, LOG_PREFIX);
                            subtitleUtils.showSubtitleContainer();
                            needsDisplayUpdate = true;
                        } else if (activePlatform) {
                            console.log(`${LOG_PREFIX}: Platform initialized, but not on player page. UI setup deferred.`);
                        } else {
                            console.log(`${LOG_PREFIX}: Platform could not be initialized.`);
                        }
                    });
                } else if (activePlatform.isPlayerPageActive()) {
                    subtitleUtils.ensureSubtitleContainer(activePlatform, LOG_PREFIX);
                    subtitleUtils.showSubtitleContainer();
                    needsDisplayUpdate = true;
                } else {
                    console.log(`${LOG_PREFIX}: Platform active, but not on player page. UI setup deferred.`);
                }
            }
            sendResponse({ success: true, subtitlesEnabled: request.enabled });
            break;
            
        case "changeLanguage":
            subtitleUtils.setUserTargetLanguage(request.targetLanguage);
            console.log(`${LOG_PREFIX}: Target language changed to:`, request.targetLanguage);
            const currentContextVideoIdLang = activePlatform ? activePlatform.getCurrentVideoId() : null;
            
            // Clear existing translations and restart
            if (subtitleUtils.subtitlesActive && currentContextVideoIdLang) {
                subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, false, LOG_PREFIX);
                subtitleUtils.showSubtitleContainer();
                subtitleUtils.processSubtitleQueue(activePlatform, LOG_PREFIX);
            }
            sendResponse({ success: true, newLanguage: request.targetLanguage });
            break;
            
        case "changeTimeOffset":
            subtitleUtils.setUserSubtitleTimeOffset(request.timeOffset);
            console.log(`${LOG_PREFIX}: Time offset changed to:`, request.timeOffset, "s");
            needsDisplayUpdate = true;
            sendResponse({ success: true, newTimeOffset: request.timeOffset });
            break;
            
        case "changeLayoutOrder":
            subtitleUtils.setUserSubtitleLayoutOrder(request.layoutOrder);
            console.log(`${LOG_PREFIX}: Layout order changed to:`, request.layoutOrder);
            subtitleUtils.applySubtitleStyling();
            needsDisplayUpdate = true;
            sendResponse({ success: true, newLayoutOrder: request.layoutOrder });
            break;
            
        case "changeLayoutOrientation":
            subtitleUtils.setUserSubtitleOrientation(request.layoutOrientation);
            console.log(`${LOG_PREFIX}: Layout orientation changed to:`, request.layoutOrientation);
            subtitleUtils.applySubtitleStyling();
            needsDisplayUpdate = true;
            sendResponse({ success: true, newLayoutOrientation: request.layoutOrientation });
            break;
            
        case "changeFontSize":
            subtitleUtils.setUserSubtitleFontSize(request.fontSize);
            console.log(`${LOG_PREFIX}: Font size changed to:`, request.fontSize, "vw");
            needsDisplayUpdate = true;
            sendResponse({ success: true, newFontSize: request.fontSize });
            break;
            
        case "changeGap":
            subtitleUtils.setUserSubtitleGap(request.gap);
            console.log(`${LOG_PREFIX}: Subtitle gap changed to:`, request.gap, "em");
            subtitleUtils.applySubtitleStyling();
            needsDisplayUpdate = true;
            sendResponse({ success: true, newGap: request.gap });
            break;
            
        case "changeBatchSize":
            subtitleUtils.setUserTranslationBatchSize(request.batchSize);
            console.log(`${LOG_PREFIX}: Translation batch size changed to:`, request.batchSize);
            sendResponse({ success: true, newBatchSize: request.batchSize });
            break;
            
        case "changeDelay":
            subtitleUtils.setUserTranslationDelay(request.delay);
            console.log(`${LOG_PREFIX}: Translation delay changed to:`, request.delay, "ms");
            sendResponse({ success: true, newDelay: request.delay });
            break;
            
        case "changeOriginalLanguage":
            subtitleUtils.setUserOriginalLanguage(request.originalLanguage);
            console.log(`${LOG_PREFIX}: Original language changed to:`, request.originalLanguage);
            const currentContextVideoIdOrig = activePlatform ? activePlatform.getCurrentVideoId() : null;
            
            // Clear existing data and re-initialize with new original language
            if (subtitleUtils.subtitlesActive && currentContextVideoIdOrig && activePlatform) {
                console.log(`${LOG_PREFIX}: Re-initializing platform due to original language change`);
                subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, false, LOG_PREFIX);
                activePlatform.cleanup();
                activePlatform = null;
                initializePlatform();
            }
            sendResponse({ success: true, newOriginalLanguage: request.originalLanguage });
            break;
            
        case "changeUseNativeSubtitles":
            subtitleUtils.setUserUseNativeSubtitles(request.useNativeSubtitles);
            console.log(`${LOG_PREFIX}: Use native subtitles changed to:`, request.useNativeSubtitles);
            const currentContextVideoIdNative = activePlatform ? activePlatform.getCurrentVideoId() : null;
            
            // Clear existing data and re-initialize with new native subtitle preference
            if (subtitleUtils.subtitlesActive && currentContextVideoIdNative && activePlatform) {
                console.log(`${LOG_PREFIX}: Re-initializing platform due to native subtitle preference change`);
                subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, false, LOG_PREFIX);
                activePlatform.cleanup();
                activePlatform = null;
                initializePlatform();
            }
            sendResponse({ success: true, newUseNativeSubtitles: request.useNativeSubtitles });
            break;
            
        default:
            actionHandled = false;
            break;
    }

    // Update display if needed
    if (needsDisplayUpdate && subtitleUtils.subtitlesActive && activePlatform?.isPlayerPageActive()) {
        const videoElement = activePlatform.getVideoElement();
        if (videoElement) {
            let timeToUpdate = videoElement.currentTime;
            
            // Try to get more accurate time from progress bar if available
            const sliderElement = activePlatform.getProgressBarElement();
            if (sliderElement) {
                const nowStr = sliderElement.getAttribute('aria-valuenow');
                const maxStr = sliderElement.getAttribute('aria-valuemax');
                if (nowStr && maxStr) {
                    const valuenow = parseFloat(nowStr);
                    const valuemax = parseFloat(maxStr);
                    const videoDuration = videoElement.duration;
                    if (!isNaN(valuenow) && !isNaN(valuemax) && valuemax > 0 && !isNaN(videoDuration) && videoDuration > 0) {
                        timeToUpdate = (valuenow / valuemax) * videoDuration;
                    }
                }
            }
            subtitleUtils.updateSubtitles(timeToUpdate, activePlatform, LOG_PREFIX);
        }
    }

    return actionHandled;
});

// Initialize on load
(async () => {
    try {
        // First load the modules
        const modulesLoaded = await loadModules();
        if (!modulesLoaded) {
            console.error(`${LOG_PREFIX}: Failed to load required modules. Extension cannot function.`);
            return;
        }

        const settings = await subtitleUtils.loadInitialSettings();
        console.log(`${LOG_PREFIX}: Initial settings loaded:`, settings);

        if (settings.active) {
            await initializePlatform();
        } else {
            console.log(`${LOG_PREFIX}: Subtitles are disabled by default. Platform not initialized.`);
        }
    } catch (e) {
        console.error(`${LOG_PREFIX}: Error during initialization:`, e);
        
        // Attempt initialization with defaults if modules are loaded
        if (subtitleUtils && subtitleUtils.subtitlesActive) {
            await initializePlatform();
        }
    }
})();

// Page observer for dynamic content changes
const pageObserver = new MutationObserver((mutationsList, observerInstance) => {
    if (!subtitleUtils) return; // Utilities not loaded yet

    if (!activePlatform && subtitleUtils.subtitlesActive) {
        console.log(`${LOG_PREFIX}: PageObserver detected DOM changes. Attempting to initialize platform.`);
        initializePlatform();
        return;
    }

    if (!activePlatform) return;

    for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {
            const videoElementNow = activePlatform.getVideoElement();
            const currentDOMVideoElement = document.querySelector('video[data-listener-attached="true"]');

            if (videoElementNow && (!currentDOMVideoElement || currentDOMVideoElement !== videoElementNow)) {
                console.log(`${LOG_PREFIX}: PageObserver detected video element appearance or change. Re-ensuring container/listeners.`);
                if (subtitleUtils.subtitlesActive) {
                    subtitleUtils.ensureSubtitleContainer(activePlatform, LOG_PREFIX);
                }
            } else if (currentDOMVideoElement && !videoElementNow) {
                console.log(`${LOG_PREFIX}: PageObserver detected video element removal.`);
                subtitleUtils.hideSubtitleContainer();
                subtitleUtils.clearSubtitleDOM();
            }
        }
    }
});

pageObserver.observe(document.body, { childList: true, subtree: true });

console.log(`${LOG_PREFIX}: Content script fully initialized.`); 