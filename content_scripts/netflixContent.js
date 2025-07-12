// content_scripts/netflixContent.js
// Netflix content script using shared utilities (based on disneyPlusContent.js pattern)

console.log(
    'Netflix Dual Subtitles content script loaded for Netflix at document_start.'
);

const LOG_PREFIX = 'NetflixContent';

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
        console.log(`${LOG_PREFIX}: Inject script is ready.`);
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
                console.log(
                    `${LOG_PREFIX}: Early inject script loaded successfully.`
                );
            s.onerror = (e) =>
                console.error(
                    `${LOG_PREFIX}: Failed to load early inject script!`,
                    e
                );
        } else {
            setTimeout(injectScriptEarly, 10);
        }
    } catch (e) {
        console.error(
            `${LOG_PREFIX}: Error during early inject script injection:`,
            e
        );
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

        return true;
    } catch (error) {
        console.error(`${LOG_PREFIX}: Error loading modules:`, error);
        return false;
    }
}

async function initializePlatform() {
    if (!NetflixPlatform || !subtitleUtils || !configService) {
        return;
    }

    // Load initial configuration
    currentConfig = await configService.getAll();
    console.log(`${LOG_PREFIX}: Loaded initial config:`, currentConfig);

    // Set up configuration change listener
    configService.onChanged(async (changes) => {
        console.log(`${LOG_PREFIX}: Config changed, updating...`, changes);
        currentConfig = await configService.getAll();

        // Re-apply styles and trigger a subtitle re-render
        if (activePlatform && subtitleUtils.subtitlesActive) {
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
            console.error(
                `${LOG_PREFIX}: Error initializing Netflix platform:`,
                error
            );
            activePlatform = null;
            platformReady = false;
        }
    } else {
        console.log(
            `${LOG_PREFIX}: Not on a Netflix player page. UI setup deferred.`
        );
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
        console.log(
            `${LOG_PREFIX}: Video detection attempt ${videoDetectionRetries}/${MAX_VIDEO_DETECTION_RETRIES}`
        );

        if (attemptVideoSetup()) {
            // Success! Clear the interval
            clearInterval(videoDetectionIntervalId);
            videoDetectionIntervalId = null;
            console.log(
                `${LOG_PREFIX}: Video element found and setup completed after ${videoDetectionRetries} attempts.`
            );
        } else if (videoDetectionRetries >= MAX_VIDEO_DETECTION_RETRIES) {
            // Give up after max retries
            clearInterval(videoDetectionIntervalId);
            videoDetectionIntervalId = null;
            console.warn(
                `${LOG_PREFIX}: Could not find video element after ${MAX_VIDEO_DETECTION_RETRIES} attempts. Giving up.`
            );
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

    console.log(
        `${LOG_PREFIX}: Video element found! Setting up subtitle container and listeners.`
    );
    console.log(
        `${LOG_PREFIX}: Current subtitlesActive state:`,
        subtitleUtils.subtitlesActive
    );

    // Ensure container and timeupdate listener for Netflix
    subtitleUtils.ensureSubtitleContainer(activePlatform, currentConfig, LOG_PREFIX);

    if (subtitleUtils.subtitlesActive) {
        console.log(
            `${LOG_PREFIX}: Subtitles are active, showing container and setting up listeners`
        );
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
        console.log(
            `${LOG_PREFIX}: Subtitles are not active, hiding container`
        );
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

// Simplified Chrome message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!subtitleUtils || !configService) {
        console.error(
            `${LOG_PREFIX}: Utilities not loaded, cannot handle message:`,
            request.action
        );
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
                            console.error(
                                `${LOG_PREFIX}: Error in platform initialization:`,
                                error
                            );
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

        default:
            console.log(
                `${LOG_PREFIX}: Message '${request.action}' handled by config service`
            );
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
                console.error(
                    `${LOG_PREFIX}: Failed to load required modules.`
                );
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
            console.error(`${LOG_PREFIX}: Error during initialization:`, e);
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
            console.log(
                `${LOG_PREFIX}: URL change detected from '${currentUrl}' to '${newUrl}'`
            );

            const wasOnPlayerPage = lastKnownPathname.includes('/watch/');
            const isOnPlayerPage = newPathname.includes('/watch/');

            currentUrl = newUrl;
            lastKnownPathname = newPathname;

            // Clean up existing platform if we're leaving a player page
            if (wasOnPlayerPage && activePlatform) {
                console.log(
                    `${LOG_PREFIX}: Leaving player page, cleaning up platform`
                );
                stopVideoElementDetection();
                activePlatform.cleanup();
                activePlatform = null;
                platformReady = false;
                eventBuffer = [];
            }

            // Initialize platform if we're entering a player page and subtitles are enabled
            if (isOnPlayerPage && !wasOnPlayerPage) {
                console.log(
                    `${LOG_PREFIX}: Entering player page, re-injecting script immediately`
                );

                // Re-inject script immediately to catch subtitle data
                injectScriptEarly();

                // Then check settings and initialize platform
                setTimeout(async () => {
                    try {
                        if (currentConfig.subtitlesEnabled) {
                            console.log(
                                `${LOG_PREFIX}: Subtitles enabled, initializing platform`
                            );
                            await initializePlatform();
                        }
                    } catch (error) {
                        console.error(
                            `${LOG_PREFIX}: Error during URL change initialization:`,
                            error
                        );
                    }
                }, 1500);
            }
        }
    } catch (error) {
        console.error(`${LOG_PREFIX}: Error in URL change detection:`, error);
        // If we get an extension context error, stop the interval to prevent spam
        if (
            error.message &&
            error.message.includes('Extension context invalidated')
        ) {
            if (urlChangeCheckInterval) {
                clearInterval(urlChangeCheckInterval);
                urlChangeCheckInterval = null;
                console.log(
                    `${LOG_PREFIX}: Stopped URL change detection due to extension context invalidation`
                );
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

    console.log(`${LOG_PREFIX}: Enhanced navigation detection set up`);
}

// Page observer for dynamic content changes
const pageObserver = new MutationObserver((mutationsList, observerInstance) => {
    if (!subtitleUtils) return; // Utilities not loaded yet

    // Check for URL changes in case other detection methods missed it
    setTimeout(checkForUrlChange, 100);

    if (!activePlatform && subtitleUtils.subtitlesActive) {
        console.log(
            `${LOG_PREFIX}: PageObserver detected DOM changes. Attempting to initialize platform.`
        );
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
                console.log(
                    `${LOG_PREFIX}: PageObserver detected video element appearance or change.`
                );
                if (
                    subtitleUtils.subtitlesActive &&
                    platformReady &&
                    activePlatform
                ) {
                    console.log(
                        `${LOG_PREFIX}: Platform is ready, re-ensuring container/listeners.`
                    );
                    subtitleUtils.ensureSubtitleContainer(
                        activePlatform,
                        currentConfig,
                        LOG_PREFIX
                    );
                }
            } else if (currentDOMVideoElement && !videoElementNow) {
                console.log(
                    `${LOG_PREFIX}: PageObserver detected video element removal.`
                );
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
            console.log(
                `${LOG_PREFIX}: Page observer started after body became available`
            );
        } else {
            setTimeout(waitForBody, 100);
        }
    };
    waitForBody();
}

// Setup navigation detection
setupNavigationDetection();

console.log(
    `${LOG_PREFIX}: Content script fully initialized with enhanced navigation detection.`
);

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

        console.log(`${LOG_PREFIX}: All cleanup completed`);
    } catch (error) {
        console.error(`${LOG_PREFIX}: Error during cleanup:`, error);
    }
}

// Listen for extension context invalidation
chrome.runtime.onConnect.addListener((port) => {
    port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
            console.log(
                `${LOG_PREFIX}: Extension context invalidated, cleaning up`
            );
            cleanupAll();
        }
    });
});

// Handle page unload
window.addEventListener('beforeunload', cleanupAll);
