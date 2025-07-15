// content_scripts/disneyPlusContent.js
// Simplified Disney+ content script using shared utilities

console.log('Disney+ Dual Subtitles content script loaded for Disney+.');

const LOG_PREFIX = 'DisneyPlusContent';

// Platform management
let activePlatform = null;

// Shared utilities (loaded dynamically)
let subtitleUtils = null;
let DisneyPlusPlatform = null;
let configService = null;

// Video element detection retry mechanism
let videoDetectionIntervalId = null;
let videoDetectionRetries = 0;
const MAX_VIDEO_DETECTION_RETRIES = 30;
const VIDEO_DETECTION_INTERVAL = 1000;

// Configuration management
let currentConfig = {};

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
        s.onload = () =>
            console.log(
                `${LOG_PREFIX}: Early inject script loaded successfully.`
            );
        s.onerror = (e) =>
            console.error(
                `${LOG_PREFIX}: Failed to load early inject script!`,
                e
            );
    } catch (e) {
        console.error(
            `${LOG_PREFIX}: Error during early inject script injection:`,
            e
        );
    }
}

// --- Module Loading and Platform Initialization ---

async function loadModules() {
    try {
        const utilsModule = await import(
            chrome.runtime.getURL('content_scripts/subtitleUtilities.js')
        );
        subtitleUtils = utilsModule;

        const platformModule = await import(
            chrome.runtime.getURL('video_platforms/disneyPlusPlatform.js')
        );
        DisneyPlusPlatform = platformModule.DisneyPlusPlatform;

        const configModule = await import(
            chrome.runtime.getURL('services/configService.js')
        );
        configService = configModule.configService;

        return true;
    } catch (error) {
        console.error(`${LOG_PREFIX}: Error loading modules:`, error);
        return false;
    }
}

async function initializePlatform() {
    if (!DisneyPlusPlatform || !subtitleUtils || !configService) return;

    // Load initial configuration
    currentConfig = await configService.getAll();
    console.log(`${LOG_PREFIX}: Loaded initial config:`, currentConfig);

    // Set up configuration change listener
    configService.onChanged(async (changes) => {
        console.log(`${LOG_PREFIX}: Config changed, updating...`, changes);
        const newConfig = await configService.getAll();

        // Update existing object properties while preserving the reference
        Object.keys(currentConfig).forEach((key) => delete currentConfig[key]);
        Object.assign(currentConfig, newConfig);

        // Check if any changes affect subtitle functionality (exclude UI-only settings)
        const uiOnlySettings = ['appearanceAccordionOpen'];
        const functionalChanges = Object.keys(changes).filter(
            (key) => !uiOnlySettings.includes(key)
        );

        // Re-apply styles and trigger a subtitle re-render only if functional settings changed
        if (
            functionalChanges.length > 0 &&
            activePlatform &&
            subtitleUtils.subtitlesActive
        ) {
            subtitleUtils.applySubtitleStyling(currentConfig);
            const videoElement = activePlatform.getVideoElement();
            if (videoElement) {
                subtitleUtils.updateSubtitles(
                    videoElement.currentTime,
                    activePlatform,
                    currentConfig,
                    LOG_PREFIX
                );
            }
        }
    });

    // The script is now injected early, so the platform doesn't need to do it.
    activePlatform = new DisneyPlusPlatform();

    if (activePlatform.isPlayerPageActive()) {
        console.log(
            `${LOG_PREFIX}: Initializing Disney+ platform on player page.`
        );
        try {
            // The platform now just sets up callbacks and listeners
            await activePlatform.initialize(
                (subtitleData) =>
                    subtitleUtils.handleSubtitleDataFound(
                        subtitleData,
                        activePlatform,
                        currentConfig,
                        LOG_PREFIX
                    ),
                (newVideoId) => {
                    subtitleUtils.handleVideoIdChange(newVideoId, LOG_PREFIX);
                    subtitleUtils.setCurrentVideoId(newVideoId);
                }
            );
            activePlatform.handleNativeSubtitles();

            // Mark platform as ready
            platformReady = true;

            if (eventBuffer.length > 0) {
                console.log(
                    `${LOG_PREFIX}: Processing ${eventBuffer.length} buffered event(s).`
                );
                // Have the new activePlatform instance handle each buffered event
                eventBuffer.forEach((e) =>
                    activePlatform._handleInjectorEvents(e)
                );
                // Clear the buffer ONLY AFTER it has been processed.
                eventBuffer = [];
            }

            startVideoElementDetection();
        } catch (error) {
            console.error(
                `${LOG_PREFIX}: Error initializing Disney+ platform:`,
                error
            );
            activePlatform = null;
            platformReady = false;
        }
    } else {
        console.log(
            `${LOG_PREFIX}: Not on a player page. Deferring full setup.`
        );
    }
}

// --- Video Element Detection ---

function startVideoElementDetection() {
    if (videoDetectionIntervalId) clearInterval(videoDetectionIntervalId);
    videoDetectionRetries = 0;

    if (attemptVideoSetup()) return;

    videoDetectionIntervalId = setInterval(() => {
        videoDetectionRetries++;
        if (
            attemptVideoSetup() ||
            videoDetectionRetries >= MAX_VIDEO_DETECTION_RETRIES
        ) {
            clearInterval(videoDetectionIntervalId);
            videoDetectionIntervalId = null;
        }
    }, VIDEO_DETECTION_INTERVAL);
}

function attemptVideoSetup() {
    if (!activePlatform || !subtitleUtils || !currentConfig) return false;

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) return false;

    console.log(
        `${LOG_PREFIX}: Video element found. Setting up UI and listeners.`
    );
    subtitleUtils.ensureSubtitleContainer(
        activePlatform,
        currentConfig,
        LOG_PREFIX
    );

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
    if (currentConfig.subtitlesEnabled) {
        initializePlatform();
    }
};

function setupNavigationDetection() {
    // Listen to history changes for SPA navigation
    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(history, arguments);
        checkForUrlChange();
    };
    window.addEventListener('popstate', checkForUrlChange);

    // Fallback interval
    setInterval(checkForUrlChange, 2000);
}

// --- Simplified Chrome Message Handler ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!subtitleUtils || !configService) {
        console.error(
            `${LOG_PREFIX}: Utilities not loaded, cannot handle message:`,
            request.action
        );
        sendResponse({ success: false, error: 'Utilities not loaded' });
        return;
    }

    switch (request.action) {
        case 'toggleSubtitles': {
            subtitleUtils.setSubtitlesActive(request.enabled);
            console.log(
                `${LOG_PREFIX}: Subtitle active state changed to ${request.enabled}`
            );
            if (!request.enabled) {
                subtitleUtils.hideSubtitleContainer();
                subtitleUtils.clearSubtitlesDisplayAndQueue(
                    activePlatform,
                    true,
                    LOG_PREFIX
                );
                if (activePlatform) activePlatform.cleanup();
                activePlatform = null;
                platformReady = false;
            } else {
                if (!activePlatform) {
                    initializePlatform().then(() => {
                        sendResponse({
                            success: true,
                            subtitlesEnabled: request.enabled,
                        });
                    });
                    return true;
                } else if (activePlatform.isPlayerPageActive()) {
                    subtitleUtils.ensureSubtitleContainer(
                        activePlatform,
                        currentConfig,
                        LOG_PREFIX
                    );
                    subtitleUtils.showSubtitleContainer();
                    const videoElement = activePlatform.getVideoElement();
                    if (videoElement) {
                        subtitleUtils.updateSubtitles(
                            videoElement.currentTime,
                            activePlatform,
                            currentConfig,
                            LOG_PREFIX
                        );
                    }
                }
            }
            sendResponse({ success: true, subtitlesEnabled: request.enabled });
            break;
        }

        case 'configChanged': {
            if (
                request.changes &&
                activePlatform &&
                subtitleUtils.subtitlesActive
            ) {
                // Update local config with the changes for immediate effect
                Object.assign(currentConfig, request.changes);

                // Apply the changes immediately for instant visual feedback
                subtitleUtils.applySubtitleStyling(currentConfig);
                const videoElement = activePlatform.getVideoElement();
                if (videoElement) {
                    subtitleUtils.updateSubtitles(
                        videoElement.currentTime,
                        activePlatform,
                        currentConfig,
                        LOG_PREFIX
                    );
                }
                console.log(
                    `${LOG_PREFIX}: Applied immediate config changes:`,
                    request.changes
                );
            }
            sendResponse({ success: true });
            break;
        }

        default: {
            console.log(
                `${LOG_PREFIX}: Message '${request.action}' handled by config service`
            );
            sendResponse({ success: true });
            break;
        }
    }

    return false;
});

// --- Main Execution Logic ---

(async () => {
    attachEarlyEventListener();
    injectScriptEarly();

    const modulesLoaded = await loadModules();
    if (!modulesLoaded) return;

    // Load initial configuration
    currentConfig = await configService.getAll();

    if (currentConfig.subtitlesEnabled) {
        await initializePlatform();
    }

    setupNavigationDetection();
})();
