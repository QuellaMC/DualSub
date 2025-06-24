// content_scripts/disneyPlusContent.js
// Simplified Disney+ content script using shared utilities

console.log("Disney+ Dual Subtitles content script loaded for Disney+.");

const LOG_PREFIX = "DisneyPlusContent";

// Platform management
let activePlatform = null;

// Shared utilities (loaded dynamically)
let subtitleUtils = null;
let DisneyPlusPlatform = null;
let videoDetectionIntervalId = null;
let videoDetectionRetries = 0;
const MAX_VIDEO_DETECTION_RETRIES = 30;
const VIDEO_DETECTION_INTERVAL = 1000;

// Event buffering for early subtitle data
const INJECT_EVENT_ID = 'disneyplus-dualsub-injector-event';
let eventBuffer = [];
let eventListenerAttached = false;
let platformReady = false;

// --- Early Injection and Event Handling ---

// Buffer events until the main platform logic is ready
function handleEarlyInjectorEvents(e) {
    if (e.detail) {
        console.log(`${LOG_PREFIX}: Intercepted early event:`, e.detail.type);
        eventBuffer.push(e);
    }
}

// Attach a listener immediately to catch events from the injected script
function attachEarlyEventListener() {
    if (!eventListenerAttached) {
        document.addEventListener(INJECT_EVENT_ID, handleEarlyInjectorEvents);
        eventListenerAttached = true;
    }
}

// Inject the script as early as possible
function injectScriptEarly() {
    const INJECT_SCRIPT_FILENAME = 'injected_scripts/disneyPlusInject.js';
    const INJECT_SCRIPT_TAG_ID = 'disneyplus-dualsub-injector-script-tag';
    if (document.getElementById(INJECT_SCRIPT_TAG_ID)) {
        return;
    }
    try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL(INJECT_SCRIPT_FILENAME);
        s.id = INJECT_SCRIPT_TAG_ID;
        (document.head || document.documentElement).appendChild(s);
        s.onload = () => console.log(`${LOG_PREFIX}: Early inject script loaded successfully.`);
        s.onerror = (e) => console.error(`${LOG_PREFIX}: Failed to load early inject script!`, e);
    } catch (e) {
        console.error(`${LOG_PREFIX}: Error during early inject script injection:`, e);
    }
}

// --- Module Loading and Platform Initialization ---

async function loadModules() {
    try {
        const utilsModule = await import(chrome.runtime.getURL('content_scripts/subtitleUtilities.js'));
        subtitleUtils = utilsModule;
        const platformModule = await import(chrome.runtime.getURL('video_platforms/disneyPlusPlatform.js'));
        DisneyPlusPlatform = platformModule.DisneyPlusPlatform;
        return true;
    } catch (error) {
        console.error(`${LOG_PREFIX}: Error loading modules:`, error);
        return false;
    }
}

async function initializePlatform() {
    if (!DisneyPlusPlatform || !subtitleUtils) return;

    // The script is now injected early, so the platform doesn't need to do it.
    activePlatform = new DisneyPlusPlatform();
    
    if (activePlatform.isPlayerPageActive()) {
        console.log(`${LOG_PREFIX}: Initializing Disney+ platform on player page.`);
        try {
            // The platform now just sets up callbacks and listeners
            await activePlatform.initialize(
                (subtitleData) => subtitleUtils.handleSubtitleDataFound(subtitleData, activePlatform, LOG_PREFIX),
                (newVideoId) => {
                    subtitleUtils.handleVideoIdChange(newVideoId, LOG_PREFIX);
                    subtitleUtils.setCurrentVideoId(newVideoId);
                }
            );
            activePlatform.handleNativeSubtitles();

            // Mark platform as ready 
            platformReady = true;

            if (eventBuffer.length > 0) {
                 console.log(`${LOG_PREFIX}: Processing ${eventBuffer.length} buffered event(s).`);
                // Have the new activePlatform instance handle each buffered event
                eventBuffer.forEach(e => activePlatform._handleInjectorEvents(e));
                // Clear the buffer ONLY AFTER it has been processed.
                eventBuffer = [];
            }
            // -----------------------------------------------------------------------

            startVideoElementDetection();
        } catch (error) {
            console.error(`${LOG_PREFIX}: Error initializing Disney+ platform:`, error);
            activePlatform = null;
            platformReady = false;
        }
    } else {
        console.log(`${LOG_PREFIX}: Not on a player page. Deferring full setup.`);
    }
}

// --- Video Element Detection ---

function startVideoElementDetection() {
    if (videoDetectionIntervalId) clearInterval(videoDetectionIntervalId);
    videoDetectionRetries = 0;
    
    if (attemptVideoSetup()) return;
    
    videoDetectionIntervalId = setInterval(() => {
        videoDetectionRetries++;
        if (attemptVideoSetup() || videoDetectionRetries >= MAX_VIDEO_DETECTION_RETRIES) {
            clearInterval(videoDetectionIntervalId);
            videoDetectionIntervalId = null;
        }
    }, VIDEO_DETECTION_INTERVAL);
}

function attemptVideoSetup() {
    if (!activePlatform || !subtitleUtils) return false;
    
    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) return false;
    
    console.log(`${LOG_PREFIX}: Video element found. Setting up UI and listeners.`);
    subtitleUtils.ensureSubtitleContainer(activePlatform, LOG_PREFIX);
    
    if (subtitleUtils.subtitlesActive) {
        subtitleUtils.showSubtitleContainer();
    } else {
        subtitleUtils.hideSubtitleContainer();
    }
    
    return true;
}

// --- Navigation Handling ---

let currentUrl = window.location.href;

const checkForUrlChange = () => {
    if (window.location.href === currentUrl) return;

    console.log(`${LOG_PREFIX}: URL change detected. Re-evaluating page.`);
    currentUrl = window.location.href;

    // Clean up old platform if it exists
    if (activePlatform) {
        activePlatform.cleanup();
        activePlatform = null;
        platformReady = false;
    }
    
    // Always re-inject script on navigation and re-initialize
    injectScriptEarly();
    chrome.storage.sync.get('subtitlesEnabled', (settings) => {
        if (settings.subtitlesEnabled) {
            initializePlatform();
        }
    });
};

function setupNavigationDetection() {
    // Listen to history changes for SPA navigation
    const originalPushState = history.pushState;
    history.pushState = function() {
        originalPushState.apply(history, arguments);
        checkForUrlChange();
    };
    window.addEventListener('popstate', checkForUrlChange);
    
    // Fallback interval
    setInterval(checkForUrlChange, 2000);
}

// --- Chrome Message Handler ---

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

// --- Main Execution Logic ---

(async () => {
    attachEarlyEventListener();
    injectScriptEarly();
    
    const modulesLoaded = await loadModules();
    if (!modulesLoaded) return;
    
    const settings = await subtitleUtils.loadInitialSettings();
    if (settings.active) {
        await initializePlatform();
    }
    
    setupNavigationDetection();
})(); 