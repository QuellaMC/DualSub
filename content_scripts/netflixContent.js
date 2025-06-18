// content_scripts/netflixContent.js
// Netflix content script using shared utilities (based on disneyPlusContent.js pattern)

console.log("Netflix Dual Subtitles content script loaded for Netflix at document_start.");

const LOG_PREFIX = "NetflixContent";

// Platform management
let activePlatform = null;

// Shared utilities (loaded dynamically)
let subtitleUtils = null;
let NetflixPlatform = null;

// Video element detection retry mechanism
let videoDetectionRetries = 0;
const MAX_VIDEO_DETECTION_RETRIES = 30; // 30 seconds max
const VIDEO_DETECTION_INTERVAL = 1000; // Check every 1 second
let videoDetectionIntervalId = null;

// Early inject script constants (must match netflixPlatform.js)
const INJECT_SCRIPT_FILENAME = 'injected_scripts/netflixInject.js';
const INJECT_SCRIPT_TAG_ID = 'netflix-dualsub-injector-script-tag';
const INJECT_EVENT_ID = 'netflix-dualsub-injector-event';

// Event buffering for early subtitle data events
let eventBuffer = [];
let eventListenerAttached = false;
let platformReady = false;

// Early event handler to buffer events until platform is ready
function handleEarlyInjectorEvents(e) {
    const data = e.detail;
    if (!data || !data.type) return;

    if (data.type === 'INJECT_SCRIPT_READY') {
        console.log(`${LOG_PREFIX}: Inject script is ready.`);
    } else if (data.type === 'SUBTITLE_DATA_FOUND') {
        eventBuffer.push(data);
    }

    if (platformReady && activePlatform && eventBuffer.length > 0) {
        const bufferedEvents = [...eventBuffer];
        eventBuffer = [];
        
        bufferedEvents.forEach(eventData => {
            if (eventData.type === 'SUBTITLE_DATA_FOUND') {
                activePlatform.handleInjectorEvents({ detail: eventData });
            }
        });
    }
}

// Attach event listener immediately to catch early events
function attachEarlyEventListener() {
    if (!eventListenerAttached) {
        document.addEventListener(INJECT_EVENT_ID, handleEarlyInjectorEvents);
        eventListenerAttached = true;
    }
}

// Inject script as early as possible to catch subtitle data
function injectScriptEarly() {
    if (!window.location.hostname.includes('netflix.com')) {
        return;
    }
    
    if (document.getElementById(INJECT_SCRIPT_TAG_ID)) {
        return;
    }
    
    try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL(INJECT_SCRIPT_FILENAME);
        s.id = INJECT_SCRIPT_TAG_ID;
        
        const target = document.head || document.documentElement;
        if (target) {
            target.appendChild(s);
            s.onload = () => console.log(`${LOG_PREFIX}: Early inject script loaded successfully.`);
            s.onerror = (e) => console.error(`${LOG_PREFIX}: Failed to load early inject script!`, e);
        } else {
            setTimeout(injectScriptEarly, 10);
        }
    } catch (e) {
        console.error(`${LOG_PREFIX}: Error during early inject script injection:`, e);
        setTimeout(injectScriptEarly, 10);
    }
}

// Wait for DOM to be ready enough for script injection
function waitForDOMAndInject() {
    if (document.readyState === 'loading') {
        injectScriptEarly();
        document.addEventListener('DOMContentLoaded', () => {
            injectScriptEarly();
        });
    } else {
        injectScriptEarly();
    }
}

// Attach event listener immediately and inject script
attachEarlyEventListener();
waitForDOMAndInject();

// Load the required modules dynamically
async function loadModules() {
    try {
        // Load the utilities module
        const utilsModule = await import(chrome.runtime.getURL('content_scripts/subtitleUtilities.js'));
        subtitleUtils = utilsModule;
        
        // Load the Netflix platform module
        const platformModule = await import(chrome.runtime.getURL('video_platforms/netflixPlatform.js'));
        NetflixPlatform = platformModule.NetflixPlatform;
        
        return true;
    } catch (error) {
        console.error(`${LOG_PREFIX}: Error loading modules:`, error);
        return false;
    }
}

async function initializePlatform() {
    if (!NetflixPlatform || !subtitleUtils) {
        return;
    }

    // Instantiate the platform directly as we know we are on Netflix
    activePlatform = new NetflixPlatform();
    
    if (activePlatform.isPlayerPageActive()) {
        try {
            // Initialize the platform (inject script already loaded early, so this mainly sets up event handlers)
            await activePlatform.initialize(
                (subtitleData) => subtitleUtils.handleSubtitleDataFound(subtitleData, activePlatform, LOG_PREFIX),
                (newVideoId) => {
                    subtitleUtils.handleVideoIdChange(newVideoId, LOG_PREFIX);
                    subtitleUtils.setCurrentVideoId(newVideoId);
                }
            );
            activePlatform.handleNativeSubtitles();

            // Mark platform as ready and process any buffered events
            platformReady = true;
            if (eventBuffer.length > 0) {
                const bufferedEvents = [...eventBuffer];
                eventBuffer = [];
                
                bufferedEvents.forEach(eventData => {
                    if (eventData.type === 'SUBTITLE_DATA_FOUND') {
                        activePlatform.handleInjectorEvents({ detail: eventData });
                    }
                });
            }

            // Start video element detection with retry mechanism
            startVideoElementDetection();
            
        } catch (error) {
            console.error(`${LOG_PREFIX}: Error initializing Netflix platform:`, error);
            activePlatform = null;
            platformReady = false;
        }
    } else {
        console.log(`${LOG_PREFIX}: Not on a Netflix player page. UI setup deferred.`);
        if (subtitleUtils) {
            subtitleUtils.hideSubtitleContainer();
        }
    }
}

function startVideoElementDetection() {
    console.log(`${LOG_PREFIX}: Starting video element detection...`);
    videoDetectionRetries = 0;
    
    // Clear any existing detection interval
    if (videoDetectionIntervalId) {
        clearInterval(videoDetectionIntervalId);
        videoDetectionIntervalId = null;
    }
    
    // Try immediately first
    if (attemptVideoSetup()) {
        return; // Success, no need for interval
    }
    
    // Start retry mechanism
    videoDetectionIntervalId = setInterval(() => {
        videoDetectionRetries++;
        console.log(`${LOG_PREFIX}: Video detection attempt ${videoDetectionRetries}/${MAX_VIDEO_DETECTION_RETRIES}`);
        
        if (attemptVideoSetup()) {
            // Success! Clear the interval
            clearInterval(videoDetectionIntervalId);
            videoDetectionIntervalId = null;
            console.log(`${LOG_PREFIX}: Video element found and setup completed after ${videoDetectionRetries} attempts.`);
        } else if (videoDetectionRetries >= MAX_VIDEO_DETECTION_RETRIES) {
            // Give up after max retries
            clearInterval(videoDetectionIntervalId);
            videoDetectionIntervalId = null;
            console.warn(`${LOG_PREFIX}: Could not find video element after ${MAX_VIDEO_DETECTION_RETRIES} attempts. Giving up.`);
        }
    }, VIDEO_DETECTION_INTERVAL);
}

function attemptVideoSetup() {
    if (!activePlatform || !subtitleUtils) {
        return false;
    }
    
    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) {
        return false; // Video not ready yet
    }
    
    console.log(`${LOG_PREFIX}: Video element found! Setting up subtitle container and listeners.`);
    
    // Ensure container and timeupdate listener for Netflix
    subtitleUtils.ensureSubtitleContainer(activePlatform, LOG_PREFIX);
    
    if (subtitleUtils.subtitlesActive) {
        subtitleUtils.showSubtitleContainer();
        if (videoElement.currentTime > 0) {
            subtitleUtils.updateSubtitles(videoElement.currentTime, activePlatform, LOG_PREFIX);
        }
    } else {
        subtitleUtils.hideSubtitleContainer();
    }
    
    return true; // Success
}

function stopVideoElementDetection() {
    if (videoDetectionIntervalId) {
        clearInterval(videoDetectionIntervalId);
        videoDetectionIntervalId = null;
        console.log(`${LOG_PREFIX}: Video element detection stopped.`);
    }
}

// Chrome message handler (same as Disney+ but with Netflix-specific logging)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!subtitleUtils) {
        console.error(`${LOG_PREFIX}: Utilities not loaded, cannot handle message:`, request.action);
        sendResponse({ success: false, error: "Utilities not loaded" });
        return true;
    }

    let needsDisplayUpdate = false;
    let actionHandled = true;

    switch (request.action) {
        case "toggleSubtitles":
            subtitleUtils.setSubtitlesActive(request.enabled);
            if (!request.enabled) {
                stopVideoElementDetection();
                subtitleUtils.hideSubtitleContainer();
                subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, true, LOG_PREFIX);
                if (activePlatform) activePlatform.cleanup();
                activePlatform = null;
                platformReady = false;
                sendResponse({ success: true, subtitlesEnabled: request.enabled });
            } else {
                if (!activePlatform) {
                    initializePlatform().then(() => {
                        sendResponse({ success: true, subtitlesEnabled: request.enabled });
                    }).catch(error => {
                        console.error(`${LOG_PREFIX}: Error in platform initialization:`, error);
                        sendResponse({ success: false, error: error.message });
                    });
                    return true;
                } else if (activePlatform.isPlayerPageActive()) {
                    startVideoElementDetection();
                    sendResponse({ success: true, subtitlesEnabled: request.enabled });
                } else {
                    sendResponse({ success: true, subtitlesEnabled: request.enabled });
                }
            }
            break;
            
        case "changeLanguage":
            subtitleUtils.setUserTargetLanguage(request.targetLanguage);
            const currentContextVideoIdLang = activePlatform ? activePlatform.getCurrentVideoId() : null;
            
            if (subtitleUtils.subtitlesActive && currentContextVideoIdLang) {
                subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, false, LOG_PREFIX);
                subtitleUtils.showSubtitleContainer();
                subtitleUtils.processSubtitleQueue(activePlatform, LOG_PREFIX);
            }
            sendResponse({ success: true, newLanguage: request.targetLanguage });
            break;
            
        case "changeTimeOffset":
            subtitleUtils.setUserSubtitleTimeOffset(request.timeOffset);
            needsDisplayUpdate = true;
            sendResponse({ success: true, newTimeOffset: request.timeOffset });
            break;
            
        case "changeLayoutOrder":
            subtitleUtils.setUserSubtitleLayoutOrder(request.layoutOrder);
            subtitleUtils.applySubtitleStyling();
            needsDisplayUpdate = true;
            sendResponse({ success: true, newLayoutOrder: request.layoutOrder });
            break;
            
        case "changeLayoutOrientation":
            subtitleUtils.setUserSubtitleOrientation(request.layoutOrientation);
            subtitleUtils.applySubtitleStyling();
            needsDisplayUpdate = true;
            sendResponse({ success: true, newLayoutOrientation: request.layoutOrientation });
            break;
            
        case "changeFontSize":
            subtitleUtils.setUserSubtitleFontSize(request.fontSize);
            needsDisplayUpdate = true;
            sendResponse({ success: true, newFontSize: request.fontSize });
            break;
            
        case "changeGap":
            subtitleUtils.setUserSubtitleGap(request.gap);
            subtitleUtils.applySubtitleStyling();
            needsDisplayUpdate = true;
            sendResponse({ success: true, newGap: request.gap });
            break;
            
        case "changeBatchSize":
            subtitleUtils.setUserTranslationBatchSize(request.batchSize);
            sendResponse({ success: true, newBatchSize: request.batchSize });
            break;
            
        case "changeDelay":
            subtitleUtils.setUserTranslationDelay(request.delay);
            sendResponse({ success: true, newDelay: request.delay });
            break;
            
        case "changeOriginalLanguage":
            subtitleUtils.setUserOriginalLanguage(request.originalLanguage);
            const currentContextVideoIdOrig = activePlatform ? activePlatform.getCurrentVideoId() : null;
            
            if (subtitleUtils.subtitlesActive && currentContextVideoIdOrig && activePlatform) {
                stopVideoElementDetection();
                subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, false, LOG_PREFIX);
                activePlatform.cleanup();
                activePlatform = null;
                platformReady = false;
                initializePlatform().then(() => {
                    sendResponse({ success: true, newOriginalLanguage: request.originalLanguage });
                }).catch(error => {
                    sendResponse({ success: false, error: error.message });
                });
                return true;
            }
            sendResponse({ success: true, newOriginalLanguage: request.originalLanguage });
            break;
            
        case "changeUseNativeSubtitles":
            subtitleUtils.setUserUseNativeSubtitles(request.useNativeSubtitles);
            const currentContextVideoIdNative = activePlatform ? activePlatform.getCurrentVideoId() : null;
            
            if (subtitleUtils.subtitlesActive && currentContextVideoIdNative && activePlatform) {
                stopVideoElementDetection();
                subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, false, LOG_PREFIX);
                activePlatform.cleanup();
                activePlatform = null;
                platformReady = false;
                initializePlatform().then(() => {
                    sendResponse({ success: true, newUseNativeSubtitles: request.useNativeSubtitles });
                }).catch(error => {
                    sendResponse({ success: false, error: error.message });
                });
                return true;
            }
            sendResponse({ success: true, newUseNativeSubtitles: request.useNativeSubtitles });
            break;
            
        case "changeTranslationProvider":
            sendResponse({ success: true });
            break;
            
        default:
            actionHandled = false;
            console.warn(`${LOG_PREFIX}: Unknown action received:`, request.action);
            sendResponse({ success: false, error: `Unknown action: ${request.action}` });
            break;
    }

    if (actionHandled && needsDisplayUpdate && subtitleUtils.subtitlesActive && activePlatform) {
        const videoElement = activePlatform.getVideoElement();
        if (videoElement) {
            subtitleUtils.updateSubtitles(videoElement.currentTime, activePlatform, LOG_PREFIX);
        }
    }

    return false;
});

function initializeWhenReady() {
    (async () => {
        try {
            const modulesLoaded = await loadModules();
            if (!modulesLoaded) {
                console.error(`${LOG_PREFIX}: Failed to load required modules.`);
                return;
            }
            
            chrome.storage.sync.get('subtitlesEnabled', (data) => {
                if (data.subtitlesEnabled) {
                    setTimeout(() => {
                        initializePlatform();
                    }, 1000);
                }
            });
        } catch (e) {
            console.error(`${LOG_PREFIX}: Error during initialization:`, e);
        }
    })();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWhenReady);
} else {
    initializeWhenReady();
}

let currentUrl = window.location.href;
const checkForUrlChange = () => {
    if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        
        if (activePlatform) {
            stopVideoElementDetection();
            activePlatform.cleanup();
            activePlatform = null;
            platformReady = false;
            eventBuffer = [];
        }
        
        chrome.storage.sync.get('subtitlesEnabled', (data) => {
            if (data.subtitlesEnabled) {
                setTimeout(() => {
                    initializePlatform();
                }, 1500);
            }
        });
    }
};

setInterval(checkForUrlChange, 2000);