// content_scripts/netflixContent.js
// Netflix content script using shared utilities (based on disneyPlusContent.js pattern)

const LOG_PREFIX = 'NetflixContent';

// Logger instance for content script
let contentLogger = null;

// Initialize fallback console logging until Logger is loaded
function logWithFallback(level, message, data = {}) {
    if (contentLogger) {
        contentLogger[level](message, data);
    } else {
        console.log(`[${LOG_PREFIX}] [${level.toUpperCase()}] ${message}`, data);
    }
}

// Platform management
let activePlatform = null;

// Shared utilities (loaded dynamically)
let subtitleUtils = null;
let NetflixPlatform = null;
let configService = null;

// Configuration management
let currentConfig = {};

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
        logWithFallback('info', 'Inject script is ready');
    } else if (data.type === 'SUBTITLE_DATA_FOUND') {
        eventBuffer.push(data);
    }

    if (platformReady && activePlatform && eventBuffer.length > 0) {
        const bufferedEvents = [...eventBuffer];
        eventBuffer = [];

        bufferedEvents.forEach((eventData) => {
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
            s.onload = () =>
                logWithFallback('info', 'Early inject script loaded successfully');
            s.onerror = (e) =>
                logWithFallback('error', 'Failed to load early inject script!', { error: e });
        } else {
            setTimeout(injectScriptEarly, 10);
        }
    } catch (e) {
        logWithFallback('error', 'Error during early inject script injection', { error: e });
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
        const utilsModule = await import(
            chrome.runtime.getURL('content_scripts/subtitleUtilities.js')
        );
        subtitleUtils = utilsModule;

        // Load the Netflix platform module
        const platformModule = await import(
            chrome.runtime.getURL('video_platforms/netflixPlatform.js')
        );
        NetflixPlatform = platformModule.NetflixPlatform;

        // Load the config service
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
            contentLogger.info('Content script logger initialized', { level: loggingLevel });
        } catch (error) {
            // Fallback to INFO level if config can't be read
            contentLogger.updateLevel(Logger.LEVELS.INFO);
            contentLogger.warn('Failed to load logging level from config, using INFO level', error);
        }

        return true;
    } catch (error) {
        logWithFallback('error', 'Error loading modules', { error });
        return false;
    }
}

async function initializePlatform() {
    if (!NetflixPlatform || !subtitleUtils || !configService) {
        return;
    }

    // Load initial configuration
    currentConfig = await configService.getAll();
    logWithFallback('info', 'Loaded initial config', { config: currentConfig });

    // Sync subtitleUtils state with saved configuration
    if (
        subtitleUtils &&
        typeof subtitleUtils.setSubtitlesActive === 'function'
    ) {
        subtitleUtils.setSubtitlesActive(currentConfig.subtitlesEnabled);
    }

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

    // Instantiate the platform directly as we know we are on Netflix
    activePlatform = new NetflixPlatform();

    if (activePlatform.isPlayerPageActive()) {
        try {
            // Initialize the platform (inject script already loaded early, so this mainly sets up event handlers)
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

            // Mark platform as ready and process any buffered events
            platformReady = true;
            if (eventBuffer.length > 0) {
                const bufferedEvents = [...eventBuffer];
                eventBuffer = [];

                bufferedEvents.forEach((eventData) => {
                    if (eventData.type === 'SUBTITLE_DATA_FOUND') {
                        activePlatform.handleInjectorEvents({
                            detail: eventData,
                        });
                    }
                });
            }

            // Start video element detection with retry mechanism
            startVideoElementDetection();
        } catch (error) {
            logWithFallback('error', 'Error initializing Netflix platform', { error });
            activePlatform = null;
            platformReady = false;
        }
    } else {
        logWithFallback('info', 'Not on a Netflix player page. UI setup deferred');
        if (subtitleUtils) {
            subtitleUtils.hideSubtitleContainer();
        }
    }
}

function startVideoElementDetection() {
    logWithFallback('info', 'Starting video element detection');
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
        logWithFallback('debug', 'Video detection attempt', { 
            attempt: videoDetectionRetries, 
            maxAttempts: MAX_VIDEO_DETECTION_RETRIES 
        });

        if (attemptVideoSetup()) {
            // Success! Clear the interval
            clearInterval(videoDetectionIntervalId);
            videoDetectionIntervalId = null;
            logWithFallback('info', 'Video element found and setup completed', { 
                attempts: videoDetectionRetries 
            });
        } else if (videoDetectionRetries >= MAX_VIDEO_DETECTION_RETRIES) {
            // Give up after max retries
            clearInterval(videoDetectionIntervalId);
            videoDetectionIntervalId = null;
            logWithFallback('warn', 'Could not find video element after max attempts. Giving up', { 
                maxAttempts: MAX_VIDEO_DETECTION_RETRIES 
            });
        }
    }, VIDEO_DETECTION_INTERVAL);
}

function attemptVideoSetup() {
    if (!activePlatform || !subtitleUtils || !currentConfig) {
        return false;
    }

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) {
        return false; // Video not ready yet
    }

    logWithFallback('info', 'Video element found! Setting up subtitle container and listeners');
    logWithFallback('debug', 'Current subtitlesActive state', { 
        subtitlesActive: subtitleUtils.subtitlesActive 
    });

    // Ensure container and timeupdate listener for Netflix
    subtitleUtils.ensureSubtitleContainer(
        activePlatform,
        currentConfig,
        LOG_PREFIX
    );

    if (subtitleUtils.subtitlesActive) {
        logWithFallback('info', 'Subtitles are active, showing container and setting up listeners');
        subtitleUtils.showSubtitleContainer();
        if (videoElement.currentTime > 0) {
            subtitleUtils.updateSubtitles(
                videoElement.currentTime,
                activePlatform,
                currentConfig,
                LOG_PREFIX
            );
        }
    } else {
        logWithFallback('info', 'Subtitles are not active, hiding container');
        subtitleUtils.hideSubtitleContainer();
    }

    return true; // Success
}

function stopVideoElementDetection() {
    if (videoDetectionIntervalId) {
        clearInterval(videoDetectionIntervalId);
        videoDetectionIntervalId = null;
        logWithFallback('info', 'Video element detection stopped');
    }
}

// Simplified Chrome message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle logging level changes immediately, even if utilities aren't loaded
    if (request.type === 'LOGGING_LEVEL_CHANGED') {
        if (contentLogger) {
            contentLogger.updateLevel(request.level);
            contentLogger.info('Logging level updated from background script', { 
                newLevel: request.level 
            });
        } else {
            logWithFallback('info', 'Logging level change received but logger not initialized yet', { 
                level: request.level 
            });
        }
        sendResponse({ success: true });
        return false;
    }

    if (!subtitleUtils || !configService) {
        logWithFallback('error', 'Utilities not loaded, cannot handle message', {
            action: request.action || request.type
        });
        sendResponse({ success: false, error: 'Utilities not loaded' });
        return true;
    }

    switch (request.action) {
        case 'toggleSubtitles':
            subtitleUtils.setSubtitlesActive(request.enabled);
            if (!request.enabled) {
                stopVideoElementDetection();
                subtitleUtils.hideSubtitleContainer();
                subtitleUtils.clearSubtitlesDisplayAndQueue(
                    activePlatform,
                    true,
                    LOG_PREFIX
                );
                if (activePlatform) activePlatform.cleanup();
                activePlatform = null;
                platformReady = false;
                sendResponse({
                    success: true,
                    subtitlesEnabled: request.enabled,
                });
            } else {
                if (!activePlatform) {
                    initializePlatform()
                        .then(() => {
                            sendResponse({
                                success: true,
                                subtitlesEnabled: request.enabled,
                            });
                        })
                        .catch((error) => {
                            logWithFallback('error', 'Error in platform initialization', { error });
                            sendResponse({
                                success: false,
                                error: error.message,
                            });
                        });
                    return true;
                } else if (activePlatform.isPlayerPageActive()) {
                    startVideoElementDetection();
                    sendResponse({
                        success: true,
                        subtitlesEnabled: request.enabled,
                    });
                } else {
                    sendResponse({
                        success: true,
                        subtitlesEnabled: request.enabled,
                    });
                }
            }
            break;

        case 'configChanged':
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
                    changes: request.changes 
                });
            }
            sendResponse({ success: true });
            break;

        default:
            logWithFallback('debug', 'Message handled by config service', { 
                action: request.action 
            });
            sendResponse({ success: true });
            break;
    }

    return false;
});

function initializeWhenReady() {
    (async () => {
        try {
            const modulesLoaded = await loadModules();
            if (!modulesLoaded) {
                logWithFallback('error', 'Failed to load required modules');
                return;
            }

            // Load initial configuration
            currentConfig = await configService.getAll();

            if (currentConfig.subtitlesEnabled) {
                setTimeout(() => {
                    initializePlatform();
                }, 1000);
            }
        } catch (e) {
            logWithFallback('error', 'Error during initialization', { error: e });
        }
    })();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWhenReady);
} else {
    initializeWhenReady();
}

// Netflix-specific navigation handling
let currentUrl = window.location.href;
let lastKnownPathname = window.location.pathname;
let urlChangeCheckInterval = null;

// More robust URL change detection that prevents extension context errors
const checkForUrlChange = () => {
    try {
        const newUrl = window.location.href;
        const newPathname = window.location.pathname;

        if (newUrl !== currentUrl || newPathname !== lastKnownPathname) {
            logWithFallback('info', 'URL change detected', { 
                from: currentUrl, 
                to: newUrl 
            });

            const wasOnPlayerPage = lastKnownPathname.includes('/watch/');
            const isOnPlayerPage = newPathname.includes('/watch/');

            currentUrl = newUrl;
            lastKnownPathname = newPathname;

            // Clean up existing platform if we're leaving a player page
            if (wasOnPlayerPage && activePlatform) {
                logWithFallback('info', 'Leaving player page, cleaning up platform');
                stopVideoElementDetection();
                activePlatform.cleanup();
                activePlatform = null;
                platformReady = false;
                eventBuffer = [];
            }

            // Initialize platform if we're entering a player page and subtitles are enabled
            if (isOnPlayerPage && !wasOnPlayerPage) {
                logWithFallback('info', 'Entering player page, re-injecting script immediately');

                // Re-inject script immediately to catch subtitle data
                injectScriptEarly();

                // Then check settings and initialize platform
                setTimeout(async () => {
                    try {
                        if (currentConfig.subtitlesEnabled) {
                            logWithFallback('info', 'Subtitles enabled, initializing platform');
                            await initializePlatform();
                        }
                    } catch (error) {
                        logWithFallback('error', 'Error during URL change initialization', { error });
                    }
                }, 1500);
            }
        }
    } catch (error) {
        logWithFallback('error', 'Error in URL change detection', { error });
        // If we get an extension context error, stop the interval to prevent spam
        if (
            error.message &&
            error.message.includes('Extension context invalidated')
        ) {
            if (urlChangeCheckInterval) {
                clearInterval(urlChangeCheckInterval);
                urlChangeCheckInterval = null;
                logWithFallback('info', 'Stopped URL change detection due to extension context invalidation');
            }
        }
    }
};

// Enhanced navigation detection using multiple approaches
function setupNavigationDetection() {
    // Method 1: Interval-based URL checking (fallback)
    if (urlChangeCheckInterval) {
        clearInterval(urlChangeCheckInterval);
    }
    urlChangeCheckInterval = setInterval(checkForUrlChange, 2000);

    // Method 2: History API interception (for programmatic navigation)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
        originalPushState.apply(history, arguments);
        setTimeout(checkForUrlChange, 100);
    };

    history.replaceState = function () {
        originalReplaceState.apply(history, arguments);
        setTimeout(checkForUrlChange, 100);
    };

    // Method 3: Popstate event (for browser back/forward navigation)
    window.addEventListener('popstate', () => {
        setTimeout(checkForUrlChange, 100);
    });

    // Method 4: Hash change event
    window.addEventListener('hashchange', () => {
        setTimeout(checkForUrlChange, 100);
    });

    // Method 5: Focus event (when user returns to tab, check if URL changed)
    window.addEventListener('focus', () => {
        setTimeout(checkForUrlChange, 100);
    });

    logWithFallback('info', 'Enhanced navigation detection set up');
}

// Page observer for dynamic content changes
const pageObserver = new MutationObserver((mutationsList, observerInstance) => {
    if (!subtitleUtils) return; // Utilities not loaded yet

    // Check for URL changes in case other detection methods missed it
    setTimeout(checkForUrlChange, 100);

    if (!activePlatform && subtitleUtils.subtitlesActive) {
        logWithFallback('info', 'PageObserver detected DOM changes. Attempting to initialize platform');
        initializePlatform();
        return;
    }

    if (!activePlatform) return;

    for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {
            const videoElementNow = activePlatform.getVideoElement();
            const currentDOMVideoElement = document.querySelector(
                'video[data-listener-attached="true"]'
            );

            if (
                videoElementNow &&
                (!currentDOMVideoElement ||
                    currentDOMVideoElement !== videoElementNow)
            ) {
                logWithFallback('debug', 'PageObserver detected video element appearance or change');
                if (
                    subtitleUtils.subtitlesActive &&
                    platformReady &&
                    activePlatform
                ) {
                    logWithFallback('debug', 'Platform is ready, re-ensuring container/listeners');
                    subtitleUtils.ensureSubtitleContainer(
                        activePlatform,
                        currentConfig,
                        LOG_PREFIX
                    );
                }
            } else if (currentDOMVideoElement && !videoElementNow) {
                logWithFallback('debug', 'PageObserver detected video element removal');
                subtitleUtils.hideSubtitleContainer();
                if (subtitleUtils.clearSubtitleDOM) {
                    subtitleUtils.clearSubtitleDOM();
                }
            }
        }
    }
});

// Ensure document.body exists before observing
if (document.body) {
    pageObserver.observe(document.body, { childList: true, subtree: true });
} else {
    // Wait for body to be available
    const waitForBody = () => {
        if (document.body) {
            pageObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
            logWithFallback('info', 'Page observer started after body became available');
        } else {
            setTimeout(waitForBody, 100);
        }
    };
    waitForBody();
}

// Setup navigation detection
setupNavigationDetection();

logWithFallback('info', 'Content script fully initialized with enhanced navigation detection');

// Cleanup function to prevent memory leaks and handle extension reloading
function cleanupAll() {
    try {
        // Stop URL change detection
        if (urlChangeCheckInterval) {
            clearInterval(urlChangeCheckInterval);
            urlChangeCheckInterval = null;
        }

        // Stop video element detection
        stopVideoElementDetection();

        // Cleanup platform
        if (activePlatform) {
            activePlatform.cleanup();
            activePlatform = null;
        }

        // Disconnect observers
        if (pageObserver) {
            pageObserver.disconnect();
        }

        // Remove event listeners
        if (eventListenerAttached) {
            document.removeEventListener(
                INJECT_EVENT_ID,
                handleEarlyInjectorEvents
            );
            eventListenerAttached = false;
        }

        // Clear state
        platformReady = false;
        eventBuffer = [];

        logWithFallback('info', 'All cleanup completed');
    } catch (error) {
        logWithFallback('error', 'Error during cleanup', { error });
    }
}

// Listen for extension context invalidation
chrome.runtime.onConnect.addListener((port) => {
    port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
            logWithFallback('info', 'Extension context invalidated, cleaning up');
            cleanupAll();
        }
    });
});

// Handle page unload
window.addEventListener('beforeunload', cleanupAll);
