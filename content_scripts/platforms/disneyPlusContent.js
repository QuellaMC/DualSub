// content_scripts/disneyPlusContent.js
// Simplified Disney+ content script using shared utilities

const LOG_PREFIX = 'DisneyPlusContent';

// Logger instance for content script
let contentLogger = null;

// Initialize fallback console logging until Logger is loaded
function logWithFallback(level, message, data = {}) {
    if (contentLogger) {
        contentLogger[level](message, data);
    } else {
        console.log(
            `[${LOG_PREFIX}] [${level.toUpperCase()}] ${message}`,
            data
        );
    }
}

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
        logWithFallback('debug', 'Intercepted early event', {
            eventType: e.detail.type,
        });
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
            logWithFallback('info', 'Early inject script loaded successfully');
        s.onerror = (e) =>
            logWithFallback('error', 'Failed to load early inject script!', {
                error: e,
            });
    } catch (e) {
        logWithFallback('error', 'Error during early inject script injection', {
            error: e,
        });
    }
}

// --- Module Loading and Platform Initialization ---

async function loadModules() {
    try {
        const utilsModule = await import(
            chrome.runtime.getURL('content_scripts/shared/subtitleUtilities.js')
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

        // Load the Logger
        const loggerModule = await import(
            chrome.runtime.getURL('utils/logger.js')
        );
        const Logger = loggerModule.default;

        // Initialize content script logger with fallback mechanism
        contentLogger = Logger.create(LOG_PREFIX);

        // Initialize logging level from configuration
        try {
            const loggingLevel = await configService.get('loggingLevel');
            contentLogger.updateLevel(loggingLevel);
            contentLogger.info('Content script logger initialized', {
                level: loggingLevel,
            });
        } catch (error) {
            // Fallback to INFO level if config can't be read
            contentLogger.updateLevel(Logger.LEVELS.INFO);
            contentLogger.warn(
                'Failed to load logging level from config, using INFO level',
                error
            );
        }

        return true;
    } catch (error) {
        logWithFallback('error', 'Error loading modules', { error });
        return false;
    }
}

async function initializePlatform() {
    if (!DisneyPlusPlatform || !subtitleUtils || !configService) return;

    // Load initial configuration
    currentConfig = await configService.getAll();
    logWithFallback('info', 'Loaded initial config', { config: currentConfig });

    // Set up configuration change listener
    configService.onChanged(async (changes) => {
        logWithFallback('info', 'Config changed, updating', { changes });
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
        logWithFallback('info', 'Initializing Disney+ platform on player page');
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
                logWithFallback('info', 'Processing buffered events', {
                    eventCount: eventBuffer.length,
                });
                // Have the new activePlatform instance handle each buffered event
                eventBuffer.forEach((e) =>
                    activePlatform._handleInjectorEvents(e)
                );
                // Clear the buffer ONLY AFTER it has been processed.
                eventBuffer = [];
            }

            startVideoElementDetection();
        } catch (error) {
            logWithFallback('error', 'Error initializing Disney+ platform', {
                error,
            });
            activePlatform = null;
            platformReady = false;
        }
    } else {
        logWithFallback('info', 'Not on a player page. Deferring full setup');
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

    logWithFallback('info', 'Video element found. Setting up UI and listeners');
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

    logWithFallback('info', 'URL change detected. Re-evaluating page');
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
    // Handle logging level changes immediately, even if utilities aren't loaded
    if (request.type === 'LOGGING_LEVEL_CHANGED') {
        if (contentLogger) {
            contentLogger.updateLevel(request.level);
            contentLogger.info('Logging level updated from background script', {
                newLevel: request.level,
            });
        } else {
            logWithFallback(
                'info',
                'Logging level change received but logger not initialized yet',
                {
                    level: request.level,
                }
            );
        }
        sendResponse({ success: true });
        return false;
    }

    if (!subtitleUtils || !configService) {
        logWithFallback(
            'error',
            'Utilities not loaded, cannot handle message',
            {
                action: request.action || request.type,
            }
        );
        sendResponse({ success: false, error: 'Utilities not loaded' });
        return;
    }

    switch (request.action) {
        case 'toggleSubtitles': {
            subtitleUtils.setSubtitlesActive(request.enabled);
            logWithFallback('info', 'Subtitle active state changed', {
                enabled: request.enabled,
            });
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
                logWithFallback('info', 'Applied immediate config changes', {
                    changes: request.changes,
                });
            }
            sendResponse({ success: true });
            break;
        }

        default: {
            logWithFallback('debug', 'Message handled by config service', {
                action: request.action,
            });
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
