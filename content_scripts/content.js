// disneyplus-dualsub-chrome-extension/content_scripts/content.js

console.log("Disney+ Dual Subtitles content script loaded.");

// --- BEGIN LOCALIZED ERROR MESSAGES ---
const localizedErrorMessages = {
    TRANSLATION_API_ERROR: {
        en: "[Translation API Error. Check settings or try another provider.]",
        es: "[Error de API de Traducción. Revisa la configuración o prueba otro proveedor.]",
        'zh-CN': "[翻译API错误。请检查设置或尝试其他翻译源。]"
        // Collaborators can add more languages here, e.g.:
        // fr: "[Erreur API de traduction. Vérifiez les paramètres ou essayez un autre fournisseur.]"
    },
    TRANSLATION_REQUEST_ERROR: {
        en: "[Translation Request Error. Please try again.]",
        es: "[Error en la Solicitud de Traducción. Por favor, inténtalo de nuevo.]",
        'zh-CN': "[翻译请求错误。请重试。]"
    },
    TRANSLATION_GENERIC_ERROR: { // Fallback
        en: "[Translation Failed. Please try again or check settings.]",
        es: "[Traducción Fallida. Por favor, inténtalo de nuevo o revisa la configuración.]",
        'zh-CN': "[翻译失败。请重试或检查设置。]"
    }
};

function getUILanguage() {
    const lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    if (lang.startsWith('zh-cn')) return 'zh-CN';
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('es')) return 'es';
    // Add more specific language checks here if needed by collaborators
    // e.g., if (lang.startsWith('fr')) return 'fr';
    return 'en'; // Default to English
}

function getLocalizedErrorMessage(errorTypeKey, details = "") {
    const uiLang = getUILanguage();
    const messagesForType = localizedErrorMessages[errorTypeKey];
    let message = "";

    if (messagesForType) {
        message = messagesForType[uiLang] || messagesForType['en']; // Fallback to English if specific lang not found
    } else {
        // Fallback for an unknown errorTypeKey itself
        const fallbackMessages = localizedErrorMessages['TRANSLATION_GENERIC_ERROR'];
        message = fallbackMessages[uiLang] || fallbackMessages['en'];
    }
    return message || "[Translation Error]"; // Absolute fallback
}
// --- END LOCALIZED ERROR MESSAGES ---

// --- BEGIN PLATFORM MANAGEMENT ---
/** @type {import('../video_platforms/platform_interface.js').VideoPlatform | null} */
let activePlatform = null;
/** @type {typeof import('../video_platforms/disneyPlusPlatform.js').DisneyPlusPlatform | null} */
let DisneyPlusPlatformModule = null; // To hold the imported class
const availablePlatforms = [];

async function initializeActivePlatform() {
    if (activePlatform) {
        // If platform exists, check if we are on a player page before re-initializing unnecessarily
        if (activePlatform.isPlayerPageActive()) {
            console.log("Content: Active platform already initialized and on a player page.");
            // Potentially re-ensure subtitle container if it was lost due to SPA navigation
            if (subtitlesActive) {
                ensureSubtitleContainer();
                showSubtitleContainer();
                 const videoElement = activePlatform.getVideoElement();
                 if (videoElement && videoElement.currentTime > 0) {
                    updateSubtitles(videoElement.currentTime);
                 }
            }
        } else {
            console.log("Content: Active platform exists, but not on a player page. UI setup deferred.");
            hideSubtitleContainer(); // At least hide our UI
        }
        return;
    }

    if (!DisneyPlusPlatformModule) {
        console.error("Content: DisneyPlusPlatformModule not loaded. Cannot initialize.");
        return;
    }
    if (availablePlatforms.length === 0 && DisneyPlusPlatformModule) {
         availablePlatforms.push(DisneyPlusPlatformModule);
    }

    for (const PlatformClass of availablePlatforms) {
        const platformInstance = new PlatformClass();
        if (platformInstance.isPlatformActive()) {
            // Now, also check if it's a player page before fully setting activePlatform
            if (platformInstance.isPlayerPageActive()) {
                activePlatform = platformInstance;
                console.log(`Content: Active platform set to: ${platformInstance.constructor.name} on a player page.`);
                try {
                    await activePlatform.initialize(
                        handleSubtitleDataFound,
                        handleVideoIdChange
                    );
                    console.log("Content: Active platform initialized successfully.");
                    activePlatform.handleNativeSubtitles();

                    if (subtitlesActive) {
                        ensureSubtitleContainer(); // This will now also check isPlayerPageActive
                        showSubtitleContainer();
                        const videoElement = activePlatform.getVideoElement();
                        if (videoElement && videoElement.currentTime > 0) {
                            updateSubtitles(videoElement.currentTime);
                        }
                    }
                } catch (error) {
                    console.error("Content: Error initializing active platform:", error);
                    activePlatform = null; // Reset on error
                }
            } else {
                console.log(`Content: Platform ${platformInstance.constructor.name} is active, but not on a player page. Full initialization deferred.`);
            }
            break; // Assuming only one platform can be active at a time
        }
    }

    if (!activePlatform) {
        console.log("Content: No suitable and active video player page detected.");
    }
}

function handleSubtitleDataFound(subtitleData) {
    // This function is called by the activePlatform when VTT text is ready
    console.log(`Content: Subtitle data found for videoId '${subtitleData.videoId}'. Current context videoId: '${currentVideoId}'`);

    // Ensure currentVideoId is up-to-date from the platform
    if (!currentVideoId && activePlatform) {
        currentVideoId = activePlatform.getCurrentVideoId();
    }

    if (subtitleData.videoId !== currentVideoId || !subtitlesActive) {
        console.warn(`Content: Subtitle data mismatch or inactive. Data VideoID: ${subtitleData.videoId}, CurrentID: ${currentVideoId}, Active: ${subtitlesActive}`);
        return;
    }

    ensureSubtitleContainer();
    const parsedCues = parseVTT(subtitleData.vttText);

    if (parsedCues.length > 0) {
        // Clear queue for the current video ID and add new cues
        subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== currentVideoId);
        parsedCues.forEach(parsedCue => {
            subtitleQueue.push({
                original: parsedCue.text,
                translated: null,
                start: parsedCue.start,
                end: parsedCue.end,
                videoId: currentVideoId
            });
        });
        console.log(`Content: ${parsedCues.length} new cues added for videoId '${currentVideoId}'.`);
        // lastKnownVttUrlForVideoId is managed by the platform
        if (parsedCues.length > 0) processSubtitleQueue();
    } else {
        console.warn(`Content: VTT parsing yielded no cues for videoId '${currentVideoId}'. VTT URL from platform: ${subtitleData.url}`);
    }
}

function handleVideoIdChange(newVideoId) {
    // This function is called by the activePlatform when the video ID changes
    console.log(`Content: Video context changing from '${currentVideoId || "null"}' to '${newVideoId}'.`);
    if (originalSubtitleElement) originalSubtitleElement.innerHTML = '';
    if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';

    if (currentVideoId && currentVideoId !== newVideoId) {
        subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== currentVideoId);
    }
    currentVideoId = newVideoId;
    // Any other necessary resets when video ID changes
}


// --- END PLATFORM MANAGEMENT ---

// REMOVED: INJECT_SCRIPT_ID, injectTheInjectorScript() as platform handles injection

let currentVideoId = null; // Set by activePlatform via handleVideoIdChange

let subtitleContainer = null;
let originalSubtitleElement = null;
let translatedSubtitleElement = null;

let subtitlesActive = true;
let subtitleQueue = [];
let processingQueue = false;
let userTargetLanguage = 'es';
let userSubtitleTimeOffset = 0;
let userSubtitleLayoutOrder = 'original_top';
let userSubtitleOrientation = 'column';
let userSubtitleFontSize = 1.7;
let userSubtitleGap = 0;
let userTranslationBatchSize = 1;
let userTranslationDelay = 100;

let timeUpdateListener = null;
let progressBarObserver = null;
let lastProgressBarTime = -1;
let findProgressBarIntervalId = null;
let findProgressBarRetries = 0;
const MAX_FIND_PROGRESS_BAR_RETRIES = 20;

let lastLoggedTimeSec = -1;

let timeUpdateLogCounter = 0;
const TIME_UPDATE_LOG_INTERVAL = 30;

function formatSubtitleTextForDisplay(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;');
}

function parseVTT(vttString) {
    if (!vttString || !vttString.trim().toUpperCase().startsWith("WEBVTT")) {
        console.warn("Content: Invalid or empty VTT string provided for parsing.");
        return [];
    }
    const cues = [];
    // Split by double newlines to separate cues, then filter out empty parts.
    const cueBlocks = vttString.split(/\r?\n\r?\n/).filter(block => block.trim() !== '');

    // A valid cue block must contain '-->'.
    for (const block of cueBlocks) {
        if (!block.includes('-->')) {
            continue; // Skip WEBVTT header or other metadata blocks
        }

        const lines = block.split(/\r?\n/);
        let timestampLine = '';
        let textLines = [];

        // The first line could be a cue ID or the timestamp itself.
        if (lines[0].includes('-->')) {
            timestampLine = lines[0];
            textLines = lines.slice(1);
        } else if (lines.length > 1 && lines[1].includes('-->')) {
            // The first line is a cue ID (which we don't use).
            timestampLine = lines[1];
            textLines = lines.slice(2);
        } else {
            continue; // Malformed block.
        }
        
        const timeParts = timestampLine.split(" --> ");
        if (timeParts.length < 2) continue; // Malformed timestamp line.
        
        const startTimeStr = timeParts[0].trim();
        // The end time might have styling info after it, which we strip.
        const endTimeStr = timeParts[1].split(' ')[0].trim();

        const start = parseTimestampToSeconds(startTimeStr);
        const end = parseTimestampToSeconds(endTimeStr);

        // Join text lines, remove VTT tags, and normalize whitespace.
        const text = textLines.join(" ").replace(/<[^>]*>/g, "").replace(/\s+/g, ' ').trim();

        if (text && !isNaN(start) && !isNaN(end)) {
            cues.push({ start, end, text });
        }
    }
    return cues;
}

function parseTimestampToSeconds(timestamp) {
    const parts = timestamp.split(':');
    let seconds = 0;
    try {
        if (parts.length === 3) { // HH:MM:SS.ms
            seconds += parseInt(parts[0], 10) * 3600;
            seconds += parseInt(parts[1], 10) * 60;
            seconds += parseFloat(parts[2].replace(',', '.'));
        } else if (parts.length === 2) { // MM:SS.ms
            seconds += parseInt(parts[0], 10) * 60;
            seconds += parseFloat(parts[1].replace(',', '.'));
        } else if (parts.length === 1) { // SS.ms
             seconds += parseFloat(parts[0].replace(',', '.'));
        } else {
            // Invalid format
            return 0;
        }
        if (isNaN(seconds)) return 0; // Handle parsing errors leading to NaN
    } catch (e) {
        console.error("Content: Error parsing timestamp '" + timestamp + "':", e);
        return 0;
    }
    return seconds;
}

function showSubtitleContainer() {
    if (subtitleContainer) {
        subtitleContainer.style.visibility = 'visible';
        subtitleContainer.style.opacity = '1';

        if (originalSubtitleElement) {
            originalSubtitleElement.style.display = 'inline-block';
        }
        if (translatedSubtitleElement) {
            translatedSubtitleElement.style.display = 'inline-block';
        }
        applySubtitleStyling();
    }
}

function hideSubtitleContainer() {
    if (subtitleContainer) {
        subtitleContainer.style.visibility = 'hidden';
        subtitleContainer.style.opacity = '0';
        if (originalSubtitleElement) {
            originalSubtitleElement.innerHTML = '';
            originalSubtitleElement.style.display = 'none';
        }
        if (translatedSubtitleElement) {
            translatedSubtitleElement.innerHTML = '';
            translatedSubtitleElement.style.display = 'none';
        }
    }
}

function applySubtitleStyling() {
    if (!subtitleContainer || !originalSubtitleElement || !translatedSubtitleElement) {
        return;
    }

    // Base styles for text fitting and line height
    originalSubtitleElement.style.padding = '0.2em 0.5em';
    translatedSubtitleElement.style.padding = '0.2em 0.5em';
    originalSubtitleElement.style.lineHeight = '1.3';
    translatedSubtitleElement.style.lineHeight = '1.3';

    originalSubtitleElement.style.whiteSpace = 'normal';
    translatedSubtitleElement.style.whiteSpace = 'normal';
    originalSubtitleElement.style.overflow = 'visible';
    translatedSubtitleElement.style.overflow = 'visible';
    originalSubtitleElement.style.textOverflow = 'clip';
    translatedSubtitleElement.style.textOverflow = 'clip';

    // Container layout
    subtitleContainer.style.flexDirection = userSubtitleOrientation;
    subtitleContainer.style.width = '94%';
    subtitleContainer.style.justifyContent = 'center';
    subtitleContainer.style.alignItems = 'center';

    // Reset margins
    originalSubtitleElement.style.marginBottom = '0';
    originalSubtitleElement.style.marginRight = '0';
    translatedSubtitleElement.style.marginBottom = '0';
    translatedSubtitleElement.style.marginRight = '0';

    // Font size
    originalSubtitleElement.style.fontSize = `${userSubtitleFontSize}vw`;
    translatedSubtitleElement.style.fontSize = `${userSubtitleFontSize}vw`;

    // Clear and re-add elements in correct order
    while (subtitleContainer.firstChild) {
        subtitleContainer.removeChild(subtitleContainer.firstChild);
    }

    const firstElement = (userSubtitleLayoutOrder === 'translation_top') ? translatedSubtitleElement : originalSubtitleElement;
    const secondElement = (userSubtitleLayoutOrder === 'translation_top') ? originalSubtitleElement : translatedSubtitleElement;

    // Common styles for subtitle elements
    [firstElement, secondElement].forEach(el => {
        el.style.display = 'inline-block';
        el.style.width = 'auto'; // Fit content
        el.style.textAlign = 'center';
        el.style.boxSizing = 'border-box';
    });

    subtitleContainer.appendChild(firstElement);
    subtitleContainer.appendChild(secondElement);

    // Orientation-specific styles
    if (userSubtitleOrientation === 'column') { // Top/Bottom
        firstElement.style.maxWidth = '100%';
        secondElement.style.maxWidth = '100%';
        firstElement.style.marginBottom = `${userSubtitleGap}em`;
        // secondElement marginBottom is already 0
    } else { // 'row' (Left/Right)
        firstElement.style.maxWidth = 'calc(50% - 1%)'; // Account for gap
        secondElement.style.maxWidth = 'calc(50% - 1%)';
        firstElement.style.verticalAlign = 'top';
        secondElement.style.verticalAlign = 'top';

        if (userSubtitleLayoutOrder === 'translation_top') { // Element on left gets right margin for gap
            translatedSubtitleElement.style.marginRight = '2%';
        } else {
            originalSubtitleElement.style.marginRight = '2%';
        }
    }
}


function ensureSubtitleContainer() {
    if (!activePlatform) {
        console.log("Content ensureSubtitleContainer: No active platform. Aborting.");
        return;
    }

    // Added check for player page activity
    if (!activePlatform.isPlayerPageActive()) {
        console.log("Content ensureSubtitleContainer: Platform active, but not on a player page. Aborting UI setup.");
        clearSubtitleDOM(); // Clear any existing DOM if we're not on a player page
        return;
    }

    const videoElement = activePlatform.getVideoElement();

    if (!videoElement) {
        // Clean up if platform reports no video
        const previousVideoElement = document.querySelector('video[data-listener-attached="true"]');
        if (previousVideoElement && timeUpdateListener) {
            previousVideoElement.removeEventListener('timeupdate', timeUpdateListener);
            previousVideoElement.removeAttribute('data-listener-attached');
        }
        if (progressBarObserver) {
            progressBarObserver.disconnect();
            progressBarObserver = null;
        }
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        clearSubtitleDOM();
        return;
    }

    // Check if video element instance has changed
    const attachedVideoElement = document.querySelector('video[data-listener-attached="true"]');
    if (attachedVideoElement !== videoElement) {
        console.log("Content: Video element instance changed or newly detected.");
        if (attachedVideoElement && timeUpdateListener) {
            attachedVideoElement.removeEventListener('timeupdate', timeUpdateListener);
            attachedVideoElement.removeAttribute('data-listener-attached');
        }
        if (progressBarObserver) {
            progressBarObserver.disconnect();
            progressBarObserver = null;
        }
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        // Setup for the new video element
        attachTimeUpdateListener(videoElement);
        setupProgressBarObserver(videoElement);
    }


    if (subtitleContainer && document.body.contains(subtitleContainer)) {
        const videoPlayerParent = activePlatform.getPlayerContainerElement();
        if (videoPlayerParent && subtitleContainer.parentElement !== videoPlayerParent) {
            // Ensure parent has relative positioning for absolute children
            if (getComputedStyle(videoPlayerParent).position === 'static') {
                videoPlayerParent.style.position = 'relative';
            }
            videoPlayerParent.appendChild(subtitleContainer);
            console.log("Content: Subtitle container moved to new video player parent.");
        }
        applySubtitleStyling();
        if (subtitlesActive) showSubtitleContainer(); else hideSubtitleContainer();
        return;
    }

    console.log("Content: Creating subtitle container.");
    subtitleContainer = document.createElement('div');
    subtitleContainer.id = 'disneyplus-dual-subtitle-container';
    subtitleContainer.className = 'disneyplus-subtitle-viewer-container';
    Object.assign(subtitleContainer.style, {
        position: 'absolute',
        bottom: '12%', // May need platform-specific overrides
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        pointerEvents: 'none',
        width: '94%',
        maxWidth: 'none', // Override any external max-width
        display: 'flex',
        flexDirection: 'column', // Default, updated by applySubtitleStyling
        alignItems: 'center',
        justifyContent: 'center'
    });

    originalSubtitleElement = document.createElement('div');
    originalSubtitleElement.id = 'disneyplus-original-subtitle';
    Object.assign(originalSubtitleElement.style, {
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '0.2em 0.5em',
        fontSize: `${userSubtitleFontSize}vw`,
        textShadow: '1px 1px 2px black, 0 0 3px black',
        borderRadius: '4px',
        lineHeight: '1.3',
        display: 'inline-block',
        width: 'auto',
        maxWidth: '100%',
        boxSizing: 'border-box',
        whiteSpace: 'normal',
        overflow: 'visible',
        textOverflow: 'clip',
        textAlign: 'center'
    });

    translatedSubtitleElement = document.createElement('div');
    translatedSubtitleElement.id = 'disneyplus-translated-subtitle';
    Object.assign(translatedSubtitleElement.style, {
        color: '#00FFFF', // Cyan
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '0.2em 0.5em',
        fontSize: `${userSubtitleFontSize}vw`,
        textShadow: '1px 1px 2px black, 0 0 3px black',
        borderRadius: '4px',
        lineHeight: '1.3',
        display: 'inline-block',
        width: 'auto',
        maxWidth: '100%',
        boxSizing: 'border-box',
        whiteSpace: 'normal',
        overflow: 'visible',
        textOverflow: 'clip',
        textAlign: 'center'
    });

    subtitleContainer.appendChild(originalSubtitleElement);
    subtitleContainer.appendChild(translatedSubtitleElement);

    const videoPlayerParent = activePlatform.getPlayerContainerElement();
    if (videoPlayerParent) {
        if (getComputedStyle(videoPlayerParent).position === 'static') {
            videoPlayerParent.style.position = 'relative';
        }
        videoPlayerParent.appendChild(subtitleContainer);
    } else {
        document.body.appendChild(subtitleContainer);
        console.warn("Content: Subtitle container appended to body (platform video parent not found).");
    }

    applySubtitleStyling();

    if (videoElement && !videoElement.getAttribute('data-listener-attached')) attachTimeUpdateListener(videoElement);
    if (videoElement && !progressBarObserver) setupProgressBarObserver(videoElement);

    if (subtitlesActive) showSubtitleContainer(); else hideSubtitleContainer();
}


function attemptToSetupProgressBarObserver(videoElement) {
    if (!activePlatform || !videoElement) {
        console.warn("Content: No active platform or video element for progress bar observer attempt.");
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        return false;
    }
    if (progressBarObserver) { // Already set up
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        return true;
    }

    const sliderElement = activePlatform.getProgressBarElement();

    if (sliderElement) {
        console.log("Content: Found progress bar slider via platform. Setting up observer:", sliderElement);
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        findProgressBarRetries = 0;

        progressBarObserver = new MutationObserver(mutations => {
            for (let mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'aria-valuenow') {
                    const targetElement = mutation.target;
                    const nowStr = targetElement.getAttribute('aria-valuenow');
                    const maxStr = targetElement.getAttribute('aria-valuemax');

                    const currentVideoElem = activePlatform.getVideoElement();
                    if (nowStr && maxStr && currentVideoElem) {
                        const valuenow = parseFloat(nowStr);
                        const valuemax = parseFloat(maxStr);
                        const videoDuration = currentVideoElem.duration;

                        if (!isNaN(valuenow) && !isNaN(valuemax) && valuemax > 0) {
                            let calculatedTime = -1;
                            if (!isNaN(videoDuration) && videoDuration > 0) {
                                calculatedTime = (valuenow / valuemax) * videoDuration;
                            } else {
                                // Fallback if duration is not available, use valuenow if it represents seconds
                                calculatedTime = valuenow;
                            }

                            if (calculatedTime >= 0 && Math.abs(calculatedTime - lastProgressBarTime) > 0.1) { // Threshold to avoid rapid updates
                                if (subtitlesActive) {
                                    updateSubtitles(calculatedTime);
                                }
                                lastProgressBarTime = calculatedTime;
                            }
                        }
                    }
                }
            }
        });

        progressBarObserver.observe(sliderElement, {
            attributes: true,
            attributeFilter: ['aria-valuenow']
        });
        console.log("Content: Progress bar observer started for aria-valuenow.");
        return true;
    }
    return false;
}

function setupProgressBarObserver(videoElement) {
    if (findProgressBarIntervalId) {
        clearInterval(findProgressBarIntervalId);
        findProgressBarIntervalId = null;
    }
    findProgressBarRetries = 0;

    if (attemptToSetupProgressBarObserver(videoElement)) {
        return;
    }

    console.log("Content: Could not find progress bar slider immediately. Retrying...");
    findProgressBarIntervalId = setInterval(() => {
        findProgressBarRetries++;
        const currentVideoElem = activePlatform ? activePlatform.getVideoElement() : null;
        if (attemptToSetupProgressBarObserver(currentVideoElem)) {
            console.log(`Content: Progress bar observer found and set up after ${findProgressBarRetries} retries.`);
        } else if (findProgressBarRetries >= MAX_FIND_PROGRESS_BAR_RETRIES) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
            console.warn(`Content: Could not find the progress bar slider after ${MAX_FIND_PROGRESS_BAR_RETRIES} retries. Subtitle sync will rely on timeupdate only.`);
        }
    }, 500);
}


function attachTimeUpdateListener(videoElement) {
     if (!activePlatform || !videoElement) {
        console.warn("Content: No active platform or video element to attach timeupdate listener.");
        return;
    }
    // Prevent multiple listeners on the same element
    if (videoElement.getAttribute('data-listener-attached') === 'true') {
        return;
    }

    if (!timeUpdateListener) {
        timeUpdateListener = () => {
            timeUpdateLogCounter++;
            const currentVideoElem = activePlatform ? activePlatform.getVideoElement() : null;
            if (currentVideoElem) {
                const currentTime = currentVideoElem.currentTime;
                const readyState = currentVideoElem.readyState;
                // Log periodically if progress bar observer is not active
                if (!progressBarObserver && (timeUpdateLogCounter % TIME_UPDATE_LOG_INTERVAL === 0)) {
                    console.log(`Content: [TimeUpdateDebug] HTML5 currentTime: ${currentTime.toFixed(2)}, readyState: ${readyState}, subtitlesActive: ${subtitlesActive}`);
                }
                // Update subtitles if progress bar observer isn't working and video is ready
                if (!progressBarObserver && subtitlesActive && typeof currentTime === 'number' && readyState >= currentVideoElem.HAVE_CURRENT_DATA) {
                    updateSubtitles(currentTime);
                }
            }
        };
    }

    videoElement.addEventListener('timeupdate', timeUpdateListener);
    videoElement.setAttribute('data-listener-attached', 'true');
    console.log("Content: Attached HTML5 timeupdate listener.");
}

function updateSubtitles(rawCurrentTime) {
    if (typeof rawCurrentTime !== 'number' || isNaN(rawCurrentTime)) {
        return;
    }

    const currentTime = rawCurrentTime + userSubtitleTimeOffset;

    if (!originalSubtitleElement || !translatedSubtitleElement || !subtitleContainer || !document.body.contains(subtitleContainer)) {
        if (subtitlesActive) {
            ensureSubtitleContainer();
            if (!originalSubtitleElement || !translatedSubtitleElement || !subtitleContainer) {
                 hideSubtitleContainer(); // Hide if ensure couldn't create them
                 return;
            }
        } else {
            hideSubtitleContainer();
            return;
        }
    }

    if (!subtitlesActive) {
        hideSubtitleContainer();
        return;
    }

    showSubtitleContainer(); // Ensure visibility if active

    const currentWholeSecond = Math.floor(currentTime);
    if (currentWholeSecond !== lastLoggedTimeSec) {
        // console.log(`Content: Updating subtitles for time: ${currentTime.toFixed(2)}s`); // Potentially noisy
        lastLoggedTimeSec = currentWholeSecond;
    }

    let foundCue = false;
    let activeCueToDisplay = null;

    const platformVideoId = activePlatform ? activePlatform.getCurrentVideoId() : null;

    for (const cue of subtitleQueue) {
        if (typeof cue.start !== 'number' || typeof cue.end !== 'number' || isNaN(cue.start) || isNaN(cue.end)) {
            continue; // Skip malformed cues
        }
        // Match against the platform's current video ID
        if (cue.videoId === platformVideoId && currentTime >= cue.start && currentTime <= cue.end) {
            activeCueToDisplay = cue;
            foundCue = true;
            break;
        }
    }

    if (foundCue && activeCueToDisplay) {
        const originalText = activeCueToDisplay.original || "";
        const translatedText = activeCueToDisplay.translated || "";

        const originalTextFormatted = formatSubtitleTextForDisplay(originalText);
        const translatedTextFormatted = formatSubtitleTextForDisplay(translatedText);

        let contentChanged = false;

        if (originalText.trim() !== "") {
            if (originalSubtitleElement.innerHTML !== originalTextFormatted) {
                originalSubtitleElement.innerHTML = originalTextFormatted;
                contentChanged = true;
            }
            originalSubtitleElement.style.display = 'inline-block';
        } else {
            if (originalSubtitleElement.innerHTML !== '') originalSubtitleElement.innerHTML = '';
            originalSubtitleElement.style.display = 'none';
        }

        // Display translated text or error message
        if (translatedText.trim() !== "") { // If there's any translated text (or error message)
            if (translatedSubtitleElement.innerHTML !== translatedTextFormatted) {
                translatedSubtitleElement.innerHTML = translatedTextFormatted;
                contentChanged = true;
            }
            translatedSubtitleElement.style.display = 'inline-block';
        } else { // If translatedText is empty or only whitespace
            if (translatedSubtitleElement.innerHTML !== '') translatedSubtitleElement.innerHTML = '';
            translatedSubtitleElement.style.display = 'none';
        }

        if (contentChanged) {
            applySubtitleStyling(); // Re-apply styles if content changed, e.g., for text wrapping
        }
    } else {
        // No active cue, clear both subtitle elements
        if (originalSubtitleElement.innerHTML !== '') originalSubtitleElement.innerHTML = '';
        originalSubtitleElement.style.display = 'none';

        if (translatedSubtitleElement.innerHTML !== '') translatedSubtitleElement.innerHTML = '';
        translatedSubtitleElement.style.display = 'none';
    }
}


async function processSubtitleQueue() {
    if (processingQueue) return;
    if (!activePlatform || !subtitlesActive) return;

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) return;

    const platformVideoId = activePlatform.getCurrentVideoId();
    if (!platformVideoId) return;


    if (!progressBarObserver && findProgressBarIntervalId) { // If progress bar setup is ongoing
        console.log("Content: Progress bar observer setup in progress. Deferring queue processing slightly.");
        setTimeout(processSubtitleQueue, 200); // Defer and retry
        return;
    }

    let timeSource = videoElement.currentTime;
    let usingProgressBarTime = false;

    const sliderElement = activePlatform.getProgressBarElement();

    if (sliderElement && progressBarObserver) { // Use progress bar if available and observer is set
        const nowStr = sliderElement.getAttribute('aria-valuenow');
        const maxStr = sliderElement.getAttribute('aria-valuemax');

        if (nowStr && maxStr) {
            const valuenow = parseFloat(nowStr);
            const valuemax = parseFloat(maxStr);
            const videoDuration = videoElement.duration;

            if (!isNaN(valuenow) && !isNaN(valuemax) && valuemax > 0) {
                if (!isNaN(videoDuration) && videoDuration > 0) {
                    timeSource = (valuenow / valuemax) * videoDuration;
                    usingProgressBarTime = true;
                } else {
                    timeSource = valuenow; // Fallback if duration is not available
                    usingProgressBarTime = true;
                }
            }
        }
    }

    const currentTime = timeSource + userSubtitleTimeOffset;

    const relevantCues = subtitleQueue.filter(cue =>
        cue.videoId === platformVideoId &&
        cue.original && // Has original text
        !cue.translated && // Not yet translated
        cue.end >= currentTime // Cue is still relevant or upcoming
    );

    relevantCues.sort((a, b) => a.start - b.start); // Process earlier cues first
    const cuesToProcess = relevantCues.slice(0, userTranslationBatchSize);

    if (cuesToProcess.length === 0) return;

    processingQueue = true;

    try {
        for (let i = 0; i < cuesToProcess.length; i++) {
            const cueToProcess = cuesToProcess[i];

            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({
                        action: "translate",
                        text: cueToProcess.original,
                        targetLang: userTargetLanguage,
                        cueStart: cueToProcess.start,
                        cueVideoId: cueToProcess.videoId
                    }, res => {
                        if (chrome.runtime.lastError) {
                            const err = new Error(chrome.runtime.lastError.message);
                            err.errorType = "TRANSLATION_REQUEST_ERROR"; // Assign type for runtime errors
                            reject(err);
                        } else if (res && res.error) { // Error response from background
                            const err = new Error(res.details || res.error);
                            err.errorType = res.errorType || "TRANSLATION_API_ERROR"; // Use errorType from background, fallback
                            reject(err);
                        } else if (res && res.translatedText !== undefined && res.cueStart !== undefined && res.cueVideoId !== undefined) {
                            resolve(res);
                        } else {
                            const err = new Error("Malformed response from background for translation. Response: " + JSON.stringify(res));
                            err.errorType = "TRANSLATION_REQUEST_ERROR";
                            reject(err);
                        }
                    });
                });

                // Find the cue in the main queue again to ensure context hasn't changed dramatically
                const cueInMainQueue = subtitleQueue.find(c =>
                    c.videoId === response.cueVideoId &&
                    c.start === response.cueStart &&
                    c.original === response.originalText // Ensure it's the exact same original cue
                );

                const currentContextVideoId = activePlatform ? activePlatform.getCurrentVideoId() : null;
                if (cueInMainQueue && cueInMainQueue.videoId === currentContextVideoId) { // Double check context
                    cueInMainQueue.translated = response.translatedText;
                } else {
                    console.warn(`Content: Could not find/match cue post-translation or context changed. VideoID: ${response.cueVideoId}, Start: ${response.cueStart}, Current Context ID: ${currentContextVideoId}`);
                }

                if (i < cuesToProcess.length - 1 && userTranslationDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, userTranslationDelay));
                }

            } catch (error) {
                console.error(`Content: Translation failed for (VideoID '${cueToProcess.videoId}', Start ${cueToProcess.start.toFixed(2)}): "${cueToProcess.original.substring(0,30)}..."`, error.message, error.errorType);
                // Mark error in queue if translation fails
                const cueInQueueOnError = subtitleQueue.find(c =>
                    c.start === cueToProcess.start &&
                    c.original === cueToProcess.original &&
                    c.videoId === cueToProcess.videoId
                );
                if (cueInQueueOnError) {
                    const errorType = error.errorType || "TRANSLATION_GENERIC_ERROR";
                    cueInQueueOnError.translated = getLocalizedErrorMessage(errorType, error.message);
                }
            }
        }
    } finally {
        processingQueue = false;
    }

    // Check if more cues need processing for the current video context
    const currentContextVideoIdForNextCheck = activePlatform ? activePlatform.getCurrentVideoId() : null;
    const moreRelevantCuesExist = subtitleQueue.some(cue =>
        cue.videoId === currentContextVideoIdForNextCheck &&
        cue.original &&
        !cue.translated &&
        cue.end >= currentTime // Use the same `currentTime` as this processing cycle
    );

    if (subtitlesActive && currentContextVideoIdForNextCheck && moreRelevantCuesExist) {
        setTimeout(processSubtitleQueue, 50); // Schedule next batch quickly if needed
    }
}

// REMOVED: processFetchedVttText, logic merged into handleSubtitleDataFound
// REMOVED: document.addEventListener(INJECT_SCRIPT_ID, ...), handled by platform

function clearSubtitlesDisplayAndQueue(clearAllQueue = true) {
    const platformVideoId = activePlatform ? activePlatform.getCurrentVideoId() : null;

    if (clearAllQueue) {
        subtitleQueue = [];
        console.log("Content: Full subtitleQueue cleared.");
    } else if (platformVideoId) {
        subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== platformVideoId);
        console.log(`Content: Subtitle queue cleared for videoId ${platformVideoId}.`);
    }

    if (originalSubtitleElement) originalSubtitleElement.innerHTML = '';
    if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';
}


function clearSubtitleDOM() {
     if (subtitleContainer && subtitleContainer.parentElement) {
        subtitleContainer.parentElement.removeChild(subtitleContainer);
    }
    subtitleContainer = null;
    originalSubtitleElement = null;
    translatedSubtitleElement = null;

    const videoElement = document.querySelector('video[data-listener-attached="true"]');
    if (videoElement && timeUpdateListener) {
        videoElement.removeEventListener('timeupdate', timeUpdateListener);
        videoElement.removeAttribute('data-listener-attached');
    }
    // timeUpdateListener itself is not nulled, so it can be reattached

    if (progressBarObserver) {
        progressBarObserver.disconnect();
        progressBarObserver = null;
    }
    if (findProgressBarIntervalId) {
        clearInterval(findProgressBarIntervalId);
        findProgressBarIntervalId = null;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let needsDisplayUpdate = false;
    let actionHandled = true;

    switch (request.action) {
        case "toggleSubtitles":
            subtitlesActive = request.enabled;
            console.log(`Content: Subtitle active state changed to ${subtitlesActive}`);
            if (!subtitlesActive) {
                hideSubtitleContainer();
                clearSubtitlesDisplayAndQueue(true);
                if (activePlatform) activePlatform.cleanup();
                activePlatform = null;
            } else {
                if (!activePlatform) {
                    initializeActivePlatform().then(() => {
                        if (activePlatform && activePlatform.isPlayerPageActive()) { // Double check after async init
                            ensureSubtitleContainer();
                            showSubtitleContainer();
                            needsDisplayUpdate = true;
                        } else if (activePlatform) {
                            console.log("Content toggleSubtitles: Platform initialized, but not on player page. UI setup deferred.");
                        } else {
                             console.log("Content toggleSubtitles: Platform could not be initialized.");
                        }
                    });
                } else if (activePlatform.isPlayerPageActive()) { // If platform already exists, check if on player page
                     ensureSubtitleContainer();
                     showSubtitleContainer();
                     needsDisplayUpdate = true;
                } else {
                    console.log("Content toggleSubtitles: Platform active, but not on player page. UI setup deferred.");
                }
            }
            sendResponse({ success: true, subtitlesEnabled: subtitlesActive });
            break;
        case "changeLanguage":
            userTargetLanguage = request.targetLanguage;
            console.log("Content: Target language changed to:", userTargetLanguage);
            const currentContextVideoIdLang = activePlatform ? activePlatform.getCurrentVideoId() : null;
            // Clear existing translations for the current video
            subtitleQueue.forEach(cue => {
                if(cue.videoId === currentContextVideoIdLang) cue.translated = null;
            });
            if (subtitlesActive && currentContextVideoIdLang && subtitleQueue.some(c => c.videoId === currentContextVideoIdLang && c.original)) {
                if (subtitleContainer) showSubtitleContainer(); // Ensure visible
                processSubtitleQueue(); // Start translating with new language
            }
            sendResponse({ success: true, newLanguage: userTargetLanguage });
            break;
        case "changeTimeOffset":
            userSubtitleTimeOffset = request.timeOffset;
            console.log("Content: Time offset changed to:", userSubtitleTimeOffset, "s");
            needsDisplayUpdate = true;
            sendResponse({ success: true, newTimeOffset: userSubtitleTimeOffset });
            break;
        case "changeLayoutOrder":
            userSubtitleLayoutOrder = request.layoutOrder;
            console.log("Content: Layout order changed to:", userSubtitleLayoutOrder);
            if (subtitleContainer) applySubtitleStyling();
            needsDisplayUpdate = true; // Update display with new order
            sendResponse({ success: true, newLayoutOrder: userSubtitleLayoutOrder });
            break;
        case "changeLayoutOrientation":
            userSubtitleOrientation = request.layoutOrientation;
            console.log("Content: Layout orientation changed to:", userSubtitleOrientation);
            if (subtitleContainer) applySubtitleStyling();
            needsDisplayUpdate = true; // Update display with new orientation
            sendResponse({ success: true, newLayoutOrientation: userSubtitleOrientation });
            break;
        case "changeFontSize":
            userSubtitleFontSize = request.fontSize;
            console.log("Content: Font size changed to:", userSubtitleFontSize, "vw");
            // Apply directly, applySubtitleStyling will also pick it up if needed
            if (originalSubtitleElement) originalSubtitleElement.style.fontSize = `${userSubtitleFontSize}vw`;
            if (translatedSubtitleElement) translatedSubtitleElement.style.fontSize = `${userSubtitleFontSize}vw`;
            // No need for full applySubtitleStyling here unless other layout aspects depend on font size in a complex way
            needsDisplayUpdate = true;
            sendResponse({ success: true, newFontSize: userSubtitleFontSize });
            break;
        case "changeGap":
            userSubtitleGap = request.gap;
            console.log("Content: Subtitle gap changed to:", userSubtitleGap, "em");
            if (subtitleContainer) applySubtitleStyling(); // Gap change requires full style reapplication
            needsDisplayUpdate = true;
            sendResponse({ success: true, newGap: userSubtitleGap });
            break;
        case "changeBatchSize":
            userTranslationBatchSize = request.batchSize;
            console.log("Content: Translation batch size changed to:", userTranslationBatchSize);
            sendResponse({ success: true, newBatchSize: userTranslationBatchSize });
            break;
        case "changeDelay":
            userTranslationDelay = request.delay;
            console.log("Content: Translation delay changed to:", userTranslationDelay, "ms");
            sendResponse({ success: true, newDelay: userTranslationDelay });
            break;
        default:
            actionHandled = false; // Not for us
            break;
    }

    // If a display update is needed, subtitles are active, and the platform is ready.
    if (needsDisplayUpdate && subtitlesActive && activePlatform?.isPlayerPageActive()) {
        const videoElement = activePlatform.getVideoElement();
        if (videoElement) {
            let timeToUpdate = videoElement.currentTime;
            // Try to get a more accurate time from progress bar if available and reliable.
            const sliderElement = progressBarObserver ? activePlatform.getProgressBarElement() : null;
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
            updateSubtitles(timeToUpdate);
        }
    }

    return actionHandled;
});

(async () => {
    try {
        // Dynamically import the platform module
        const platformModulePath = 'video_platforms/disneyPlusPlatform.js';
        const platformModule = await import(chrome.runtime.getURL(platformModulePath));
        DisneyPlusPlatformModule = platformModule.DisneyPlusPlatform;

        const settingsToGet = {
            subtitlesEnabled: true,
            targetLanguage: 'zh-CN', // Default target language
            subtitleTimeOffset: 0.3,
            subtitleLayoutOrder: 'original_top',
            subtitleOrientation: 'column',
            subtitleFontSize: 1.1,
            subtitleGap: 0.3,
            translationBatchSize: 3,
            translationDelay: 150
        };
        const items = await chrome.storage.sync.get(settingsToGet);

        // Assign settings, using defaults if not found in storage
        subtitlesActive = items.subtitlesEnabled !== undefined ? items.subtitlesEnabled : settingsToGet.subtitlesEnabled;
        userTargetLanguage = items.targetLanguage || settingsToGet.targetLanguage;
        userSubtitleTimeOffset = items.subtitleTimeOffset !== undefined ? items.subtitleTimeOffset : settingsToGet.subtitleTimeOffset;
        userSubtitleLayoutOrder = items.subtitleLayoutOrder || settingsToGet.subtitleLayoutOrder;
        userSubtitleOrientation = items.subtitleOrientation || settingsToGet.subtitleOrientation;
        userSubtitleFontSize = items.subtitleFontSize || settingsToGet.subtitleFontSize;
        userSubtitleGap = items.subtitleGap || settingsToGet.subtitleGap;
        userTranslationBatchSize = items.translationBatchSize || settingsToGet.translationBatchSize;
        userTranslationDelay = items.translationDelay || settingsToGet.translationDelay;

        console.log("Content: Initial settings loaded:", {
            active: subtitlesActive, lang: userTargetLanguage, offset: userSubtitleTimeOffset,
            order: userSubtitleLayoutOrder, orientation: userSubtitleOrientation,
            fontSize: userSubtitleFontSize, gap: userSubtitleGap,
            batchSize: userTranslationBatchSize, delay: userTranslationDelay
        });

        if (subtitlesActive) {
            await initializeActivePlatform();
        } else {
            console.log("Content: Subtitles are disabled by default. Platform not initialized.");
        }

    } catch (e) {
        console.error("Content: Error loading initial settings or platform module:", e);
         // Fallback defaults if storage/import fails
         subtitlesActive = true;
         userTargetLanguage = 'zh-CN';
         userSubtitleTimeOffset = 0.3;
         userSubtitleLayoutOrder = 'original_top';
         userSubtitleOrientation = 'column';
         userSubtitleFontSize = 1.1;
         userSubtitleGap = 0.3;
         userTranslationBatchSize = 3;
         userTranslationDelay = 150;

         if (subtitlesActive && DisneyPlusPlatformModule) { // Only init if module loaded
            await initializeActivePlatform();
         } else if (!DisneyPlusPlatformModule) {
            console.error("Content: Fallback settings applied, but platform module failed to load. Cannot initialize.");
         }
    }
})();

const pageObserver = new MutationObserver((mutationsList, observerInstance) => {
    // Attempt to initialize if platform not active, subtitles enabled, and module is loaded
    if (!activePlatform && subtitlesActive && DisneyPlusPlatformModule) {
        console.log("Content: PageObserver detected DOM changes. Attempting to initialize platform.");
        initializeActivePlatform();
        return; // Initialization will handle further checks
    }

    if (!activePlatform) return; // Do nothing if platform is not active

    for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {
            const videoElementNow = activePlatform.getVideoElement();
            const currentDOMVideoElement = document.querySelector('video[data-listener-attached="true"]');

            // If a video element is now present (or changed) and wasn't what we were tracking
            if (videoElementNow && (!currentDOMVideoElement || currentDOMVideoElement !== videoElementNow)) {
                console.log("Content: PageObserver detected video element appearance or change. Re-ensuring container/listeners.");
                if (subtitlesActive) {
                    ensureSubtitleContainer(); // This will handle attaching listeners to the new video element
                }
            } else if (currentDOMVideoElement && !videoElementNow) {
                 // Video element was present but is now gone according to the platform
                 console.log("Content: PageObserver detected video element removal (platform reports null).");
                 hideSubtitleContainer(); // Hide our subtitles

                 // Cleanup listeners from the old video element
                 if (timeUpdateListener && currentDOMVideoElement) {
                    currentDOMVideoElement.removeEventListener('timeupdate', timeUpdateListener);
                    currentDOMVideoElement.removeAttribute('data-listener-attached');
                 }
                 if (progressBarObserver) {
                    progressBarObserver.disconnect();
                    progressBarObserver = null;
                 }
                 if (findProgressBarIntervalId) {
                    clearInterval(findProgressBarIntervalId);
                    findProgressBarIntervalId = null;
                 }
            }
        }
    }
});
pageObserver.observe(document.body, { childList: true, subtree: true });

console.log("Disney+ Dual Subtitles content script fully initialized.");
