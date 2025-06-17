// content_scripts/subtitleUtilities.js
// Shared utilities for dual subtitle functionality across all streaming platforms

console.log("Subtitle utilities module loaded");
const localizedErrorMessages = {
    TRANSLATION_API_ERROR: {
        en: "[Translation API Error. Check settings or try another provider.]",
        es: "[Error de API de Traducción. Revisa la configuración o prueba otro proveedor.]",
        'zh-CN': "[翻译API错误。请检查设置或尝试其他翻译源。]"
    },
    TRANSLATION_REQUEST_ERROR: {
        en: "[Translation Request Error. Please try again.]",
        es: "[Error en la Solicitud de Traducción. Por favor, inténtalo de nuevo.]",
        'zh-CN': "[翻译请求错误。请重试。]"
    },
    TRANSLATION_GENERIC_ERROR: {
        en: "[Translation Failed. Please try again or check settings.]",
        es: "[Traducción Fallida. Por favor, inténtalo de nuevo o revisa la configuración.]",
        'zh-CN': "[翻译失败。请重试或检查设置。]"
    }
};

export function getUILanguage() {
    const lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    if (lang.startsWith('zh-cn')) return 'zh-CN';
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('es')) return 'es';
    return 'en';
}

export function getLocalizedErrorMessage(errorTypeKey, details = "") {
    const uiLang = getUILanguage();
    const messagesForType = localizedErrorMessages[errorTypeKey];
    let message = "";

    if (messagesForType) {
        message = messagesForType[uiLang] || messagesForType['en'];
    } else {
        const fallbackMessages = localizedErrorMessages['TRANSLATION_GENERIC_ERROR'];
        message = fallbackMessages[uiLang] || fallbackMessages['en'];
    }
    return message || "[Translation Error]";
}
export let currentVideoId = null;
export let subtitleContainer = null;
export let originalSubtitleElement = null;
export let translatedSubtitleElement = null;
export let subtitlesActive = true;
export let subtitleQueue = [];
export let processingQueue = false;
export let userSubtitleTimeOffset = 0.3;
export let userSubtitleLayoutOrder = 'original_top';
export let userSubtitleOrientation = 'column';
export let userSubtitleFontSize = 1.1;
export let userSubtitleGap = 0.3;
export let userTranslationBatchSize = 3;
export let userTranslationDelay = 150;
export let userUseNativeSubtitles = true;
export let userTargetLanguage = 'zh-CN';
export let userOriginalLanguage = 'en';

export let timeUpdateListener = null;
export let progressBarObserver = null;
export let lastProgressBarTime = -1;
export let findProgressBarIntervalId = null;
export let findProgressBarRetries = 0;
export const MAX_FIND_PROGRESS_BAR_RETRIES = 20;
export let lastLoggedTimeSec = -1;
export let timeUpdateLogCounter = 0;
export const TIME_UPDATE_LOG_INTERVAL = 30;
export function setCurrentVideoId(id) { currentVideoId = id; }
export function setSubtitlesActive(active) { subtitlesActive = active; }
export function setUserTargetLanguage(lang) { userTargetLanguage = lang; }
export function setUserOriginalLanguage(lang) { userOriginalLanguage = lang; }
export function setUserSubtitleTimeOffset(offset) { userSubtitleTimeOffset = offset; }
export function setUserSubtitleLayoutOrder(order) { userSubtitleLayoutOrder = order; }
export function setUserSubtitleOrientation(orientation) { userSubtitleOrientation = orientation; }
export function setUserSubtitleFontSize(size) { userSubtitleFontSize = size; }
export function setUserSubtitleGap(gap) { userSubtitleGap = gap; }
export function setUserTranslationBatchSize(size) { userTranslationBatchSize = size; }
export function setUserTranslationDelay(delay) { userTranslationDelay = delay; }
export function setUserUseNativeSubtitles(use) { userUseNativeSubtitles = use; }
export function formatSubtitleTextForDisplay(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;');
}

export function parseVTT(vttString) {
    if (!vttString || !vttString.trim().toUpperCase().startsWith("WEBVTT")) {
        console.warn("SubtitleUtils: Invalid or empty VTT string provided for parsing.");
        return [];
    }
    const cues = [];
    const cueBlocks = vttString.split(/\r?\n\r?\n/).filter(block => block.trim() !== '');

    for (const block of cueBlocks) {
        if (!block.includes('-->')) {
            continue;
        }

        const lines = block.split(/\r?\n/);
        let timestampLine = '';
        let textLines = [];

        if (lines[0].includes('-->')) {
            timestampLine = lines[0];
            textLines = lines.slice(1);
        } else if (lines.length > 1 && lines[1].includes('-->')) {
            timestampLine = lines[1];
            textLines = lines.slice(2);
        } else {
            continue;
        }
        
        const timeParts = timestampLine.split(" --> ");
        if (timeParts.length < 2) continue;
        
        const startTimeStr = timeParts[0].trim();
        const endTimeStr = timeParts[1].split(' ')[0].trim();

        const start = parseTimestampToSeconds(startTimeStr);
        const end = parseTimestampToSeconds(endTimeStr);

        const text = textLines.join(" ").replace(/<[^>]*>/g, "").replace(/\s+/g, ' ').trim();

        if (text && !isNaN(start) && !isNaN(end)) {
            cues.push({ start, end, text });
        }
    }
    return cues;
}

export function parseTimestampToSeconds(timestamp) {
    const parts = timestamp.split(':');
    let seconds = 0;
    try {
        if (parts.length === 3) {
            seconds += parseInt(parts[0], 10) * 3600;
            seconds += parseInt(parts[1], 10) * 60;
            seconds += parseFloat(parts[2].replace(',', '.'));
        } else if (parts.length === 2) {
            seconds += parseInt(parts[0], 10) * 60;
            seconds += parseFloat(parts[1].replace(',', '.'));
        } else if (parts.length === 1) {
             seconds += parseFloat(parts[0].replace(',', '.'));
        } else {
            return 0;
        }
        if (isNaN(seconds)) return 0;
    } catch (e) {
        console.error("SubtitleUtils: Error parsing timestamp '" + timestamp + "':", e);
        return 0;
    }
    return seconds;
}
export function showSubtitleContainer() {
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

export function hideSubtitleContainer() {
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

export function applySubtitleStyling() {
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
        el.style.width = 'auto';
        el.style.textAlign = 'center';
        el.style.boxSizing = 'border-box';
    });

    subtitleContainer.appendChild(firstElement);
    subtitleContainer.appendChild(secondElement);

    // Orientation-specific styles
    if (userSubtitleOrientation === 'column') {
        firstElement.style.maxWidth = '100%';
        secondElement.style.maxWidth = '100%';
        firstElement.style.marginBottom = `${userSubtitleGap}em`;
    } else {
        firstElement.style.maxWidth = 'calc(50% - 1%)';
        secondElement.style.maxWidth = 'calc(50% - 1%)';
        firstElement.style.verticalAlign = 'top';
        secondElement.style.verticalAlign = 'top';

        if (userSubtitleLayoutOrder === 'translation_top') {
            translatedSubtitleElement.style.marginRight = '2%';
        } else {
            originalSubtitleElement.style.marginRight = '2%';
        }
    }
}
export function ensureSubtitleContainer(activePlatform, logPrefix = "SubtitleUtils") {
    if (!activePlatform) {
        console.log(`${logPrefix}: No active platform. Aborting.`);
        return;
    }

    if (!activePlatform.isPlayerPageActive()) {
        console.log(`${logPrefix}: Platform active, but not on a player page. Aborting UI setup.`);
        clearSubtitleDOM();
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
        console.log(`${logPrefix}: Video element instance changed or newly detected.`);
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
        attachTimeUpdateListener(videoElement, activePlatform, logPrefix);
        setupProgressBarObserver(videoElement, activePlatform, logPrefix);
    }

    if (subtitleContainer && document.body.contains(subtitleContainer)) {
        const videoPlayerParent = activePlatform.getPlayerContainerElement();
        if (videoPlayerParent && subtitleContainer.parentElement !== videoPlayerParent) {
            if (getComputedStyle(videoPlayerParent).position === 'static') {
                videoPlayerParent.style.position = 'relative';
            }
            videoPlayerParent.appendChild(subtitleContainer);
            console.log(`${logPrefix}: Subtitle container moved to new video player parent.`);
        }
        applySubtitleStyling();
        if (subtitlesActive) showSubtitleContainer(); else hideSubtitleContainer();
        return;
    }

    console.log(`${logPrefix}: Creating subtitle container.`);
    subtitleContainer = document.createElement('div');
    subtitleContainer.id = 'disneyplus-dual-subtitle-container';
    subtitleContainer.className = 'disneyplus-subtitle-viewer-container';
    Object.assign(subtitleContainer.style, {
        position: 'absolute',
        bottom: '12%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        pointerEvents: 'none',
        width: '94%',
        maxWidth: 'none',
        display: 'flex',
        flexDirection: 'column',
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
        color: '#00FFFF',
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
        console.warn(`${logPrefix}: Subtitle container appended to body (platform video parent not found).`);
    }

    applySubtitleStyling();

    if (videoElement && !videoElement.getAttribute('data-listener-attached')) {
        attachTimeUpdateListener(videoElement, activePlatform, logPrefix);
    }
    if (videoElement && !progressBarObserver) {
        setupProgressBarObserver(videoElement, activePlatform, logPrefix);
    }

    if (subtitlesActive) showSubtitleContainer(); else hideSubtitleContainer();
}

export function attachTimeUpdateListener(videoElement, activePlatform, logPrefix = "SubtitleUtils") {
    if (!activePlatform || !videoElement) {
        console.warn(`${logPrefix}: No active platform or video element to attach timeupdate listener.`);
        return;
    }
    
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
                
                if (!progressBarObserver && (timeUpdateLogCounter % TIME_UPDATE_LOG_INTERVAL === 0)) {
                    console.log(`${logPrefix}: [TimeUpdateDebug] HTML5 currentTime: ${currentTime.toFixed(2)}, readyState: ${readyState}, subtitlesActive: ${subtitlesActive}`);
                }
                
                if (!progressBarObserver && subtitlesActive && typeof currentTime === 'number' && readyState >= currentVideoElem.HAVE_CURRENT_DATA) {
                    updateSubtitles(currentTime, activePlatform, logPrefix);
                }
            }
        };
    }

    videoElement.addEventListener('timeupdate', timeUpdateListener);
    videoElement.setAttribute('data-listener-attached', 'true');
    console.log(`${logPrefix}: Attached HTML5 timeupdate listener.`);
}

export function setupProgressBarObserver(videoElement, activePlatform, logPrefix = "SubtitleUtils") {
    if (findProgressBarIntervalId) {
        clearInterval(findProgressBarIntervalId);
        findProgressBarIntervalId = null;
    }
    findProgressBarRetries = 0;

    if (attemptToSetupProgressBarObserver(videoElement, activePlatform, logPrefix)) {
        return;
    }

    console.log(`${logPrefix}: Could not find progress bar slider immediately. Retrying...`);
    findProgressBarIntervalId = setInterval(() => {
        findProgressBarRetries++;
        const currentVideoElem = activePlatform ? activePlatform.getVideoElement() : null;
        if (attemptToSetupProgressBarObserver(currentVideoElem, activePlatform, logPrefix)) {
            console.log(`${logPrefix}: Progress bar observer found and set up after ${findProgressBarRetries} retries.`);
        } else if (findProgressBarRetries >= MAX_FIND_PROGRESS_BAR_RETRIES) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
            console.warn(`${logPrefix}: Could not find the progress bar slider after ${MAX_FIND_PROGRESS_BAR_RETRIES} retries. Subtitle sync will rely on timeupdate only.`);
        }
    }, 500);
}

function attemptToSetupProgressBarObserver(videoElement, activePlatform, logPrefix = "SubtitleUtils") {
    if (!activePlatform || !videoElement) {
        console.warn(`${logPrefix}: No active platform or video element for progress bar observer attempt.`);
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        return false;
    }
    if (progressBarObserver) {
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        return true;
    }

    const sliderElement = activePlatform.getProgressBarElement();

    if (sliderElement) {
        console.log(`${logPrefix}: Found progress bar slider via platform. Setting up observer:`, sliderElement);
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
                                calculatedTime = valuenow;
                            }

                            if (calculatedTime >= 0 && Math.abs(calculatedTime - lastProgressBarTime) > 0.1) {
                                if (subtitlesActive) {
                                    updateSubtitles(calculatedTime, activePlatform, logPrefix);
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
        console.log(`${logPrefix}: Progress bar observer started for aria-valuenow.`);
        return true;
    }
    return false;
}
export function updateSubtitles(rawCurrentTime, activePlatform, logPrefix = "SubtitleUtils") {
    if (typeof rawCurrentTime !== 'number' || isNaN(rawCurrentTime)) {
        return;
    }

    const currentTime = rawCurrentTime + userSubtitleTimeOffset;

    if (!originalSubtitleElement || !translatedSubtitleElement || !subtitleContainer || !document.body.contains(subtitleContainer)) {
        if (subtitlesActive) {
            ensureSubtitleContainer(activePlatform, logPrefix);
            if (!originalSubtitleElement || !translatedSubtitleElement || !subtitleContainer) {
                hideSubtitleContainer();
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

    showSubtitleContainer();

    const currentWholeSecond = Math.floor(currentTime);
    if (currentWholeSecond !== lastLoggedTimeSec) {
        lastLoggedTimeSec = currentWholeSecond;
    }

    let foundCue = false;
    let activeCueToDisplay = null;

    const platformVideoId = activePlatform ? activePlatform.getCurrentVideoId() : null;

    for (const cue of subtitleQueue) {
        if (typeof cue.start !== 'number' || typeof cue.end !== 'number' || isNaN(cue.start) || isNaN(cue.end)) {
            continue;
        }
        if (cue.videoId === platformVideoId && currentTime >= cue.start && currentTime <= cue.end) {
            activeCueToDisplay = cue;
            foundCue = true;
            break;
        }
    }

    if (foundCue && activeCueToDisplay) {
        const originalText = activeCueToDisplay.original || "";
        const translatedText = activeCueToDisplay.translated || "";
        const useNativeTarget = activeCueToDisplay.useNativeTarget || false;

        const originalTextFormatted = formatSubtitleTextForDisplay(originalText);
        const translatedTextFormatted = formatSubtitleTextForDisplay(translatedText);

        let contentChanged = false;

        if (currentWholeSecond !== lastLoggedTimeSec) {
            console.log(`${logPrefix}: [Display] Time ${currentTime.toFixed(2)}s - Native: ${useNativeTarget}, Original: "${originalText.substring(0, 30)}${originalText.length > 30 ? '...' : ''}", Translated: "${translatedText.substring(0, 30)}${translatedText.length > 30 ? '...' : ''}"`);
        }

        if (useNativeTarget) {
            if (originalText.trim() !== "") {
                if (originalSubtitleElement.innerHTML !== originalTextFormatted) {
                    originalSubtitleElement.innerHTML = originalTextFormatted;
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        console.log(`${logPrefix}: [Display] Setting original subtitle (native mode): "${originalText}"`);
                    }
                }
                originalSubtitleElement.style.display = 'inline-block';
            } else {
                if (originalSubtitleElement.innerHTML !== '') {
                    originalSubtitleElement.innerHTML = '';
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        console.log(`${logPrefix}: [Display] Clearing original subtitle (native mode, empty text)`);
                    }
                }
                originalSubtitleElement.style.display = 'none';
            }

            if (translatedText.trim() !== "") {
                if (translatedSubtitleElement.innerHTML !== translatedTextFormatted) {
                    translatedSubtitleElement.innerHTML = translatedTextFormatted;
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        console.log(`${logPrefix}: [Display] Setting native target subtitle: "${translatedText}"`);
                    }
                }
                translatedSubtitleElement.style.display = 'inline-block';
            } else {
                if (translatedSubtitleElement.innerHTML !== '') {
                    translatedSubtitleElement.innerHTML = '';
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        console.log(`${logPrefix}: [Display] Clearing native target subtitle (no match found)`);
                    }
                }
                translatedSubtitleElement.style.display = 'none';
            }
        } else {
            if (originalText.trim() !== "") {
                if (originalSubtitleElement.innerHTML !== originalTextFormatted) {
                    originalSubtitleElement.innerHTML = originalTextFormatted;
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        console.log(`${logPrefix}: [Display] Setting original subtitle: "${originalText}"`);
                    }
                }
                originalSubtitleElement.style.display = 'inline-block';
            } else {
                if (originalSubtitleElement.innerHTML !== '') {
                    originalSubtitleElement.innerHTML = '';
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        console.log(`${logPrefix}: [Display] Clearing original subtitle (empty text)`);
                    }
                }
                originalSubtitleElement.style.display = 'none';
            }

            if (translatedText.trim() !== "") {
                if (translatedSubtitleElement.innerHTML !== translatedTextFormatted) {
                    translatedSubtitleElement.innerHTML = translatedTextFormatted;
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        console.log(`${logPrefix}: [Display] Setting translated subtitle: "${translatedText}"`);
                    }
                }
                translatedSubtitleElement.style.display = 'inline-block';
            } else {
                if (translatedSubtitleElement.innerHTML !== '') {
                    translatedSubtitleElement.innerHTML = '';
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        console.log(`${logPrefix}: [Display] Clearing translated subtitle (no translation yet)`);
                    }
                }
                translatedSubtitleElement.style.display = 'none';
            }
        }

        if (contentChanged) {
            applySubtitleStyling();
        }
    } else {
        if (originalSubtitleElement.innerHTML !== '') originalSubtitleElement.innerHTML = '';
        originalSubtitleElement.style.display = 'none';

        if (translatedSubtitleElement.innerHTML !== '') translatedSubtitleElement.innerHTML = '';
        translatedSubtitleElement.style.display = 'none';
    }
}
export function clearSubtitlesDisplayAndQueue(activePlatform, clearAllQueue = true, logPrefix = "SubtitleUtils") {
    const platformVideoId = activePlatform ? activePlatform.getCurrentVideoId() : null;

    if (clearAllQueue) {
        subtitleQueue = [];
        console.log(`${logPrefix}: Full subtitleQueue cleared.`);
    } else if (platformVideoId) {
        subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== platformVideoId);
        console.log(`${logPrefix}: Subtitle queue cleared for videoId ${platformVideoId}.`);
    }

    // Clear subtitle display elements
    if (originalSubtitleElement) originalSubtitleElement.innerHTML = '';
    if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';
    
    // Force garbage collection of any remaining maps/objects
    // This helps prevent memory leaks from large subtitle datasets
    if (typeof gc === 'function') {
        try { gc(); } catch (e) { /* gc() not available, ignore */ }
    }
}

export function clearSubtitleDOM() {
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

    if (progressBarObserver) {
        progressBarObserver.disconnect();
        progressBarObserver = null;
    }
    if (findProgressBarIntervalId) {
        clearInterval(findProgressBarIntervalId);
        findProgressBarIntervalId = null;
    }
}
export function handleSubtitleDataFound(subtitleData, activePlatform, logPrefix = "SubtitleUtils") {
    console.log(`${logPrefix}: Subtitle data found for videoId '${subtitleData.videoId}'. Current context videoId: '${currentVideoId}'`);
    console.log(`${logPrefix}: Subtitle data details - sourceLanguage: '${subtitleData.sourceLanguage}', targetLanguage: '${subtitleData.targetLanguage}', useNativeTarget: ${subtitleData.useNativeTarget}`);

    // Ensure currentVideoId is up-to-date from the platform
    if (!currentVideoId && activePlatform) {
        currentVideoId = activePlatform.getCurrentVideoId();
    }

    if (subtitleData.videoId !== currentVideoId || !subtitlesActive) {
        console.warn(`${logPrefix}: Subtitle data mismatch or inactive. Data VideoID: ${subtitleData.videoId}, CurrentID: ${currentVideoId}, Active: ${subtitlesActive}`);
        return;
    }

    // Check if the source language is different from user's original language setting
    if (subtitleData.selectedLanguage && subtitleData.selectedLanguage.normalizedCode !== userOriginalLanguage) {
        console.log(`${logPrefix}: ⚠️ Language fallback occurred: User requested '${userOriginalLanguage}' but using '${subtitleData.selectedLanguage.normalizedCode}' (${subtitleData.selectedLanguage.displayName})`);
    }

    ensureSubtitleContainer(activePlatform, logPrefix);
    const parsedOriginalCues = parseVTT(subtitleData.vttText);
    
    // Parse target VTT if available (for native target mode)
    let parsedTargetCues = [];
    if (subtitleData.targetVttText) {
        parsedTargetCues = parseVTT(subtitleData.targetVttText);
        console.log(`${logPrefix}: Parsed ${parsedTargetCues.length} target language cues from native subtitles`);
    }

    if (parsedOriginalCues.length > 0) {
        // Clear queue for the current video ID and add new cues
        subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== currentVideoId);
        
        // Check if we're using native target language (no translation needed)
        const useNativeTarget = subtitleData.useNativeTarget || false;
        
        console.log(`${logPrefix}: Processing ${parsedOriginalCues.length} original cues. Native target mode: ${useNativeTarget}`);
        if (useNativeTarget && subtitleData.targetLanguage) {
            console.log(`${logPrefix}: Using native ${subtitleData.targetLanguage} subtitles with ${subtitleData.sourceLanguage} originals (dual mode)`);
        } else {
            console.log(`${logPrefix}: Will translate from ${subtitleData.sourceLanguage} to ${userTargetLanguage}`);
        }
        
        // Create optimized target cue lookup structures
        const targetCueMap = new Map();
        const targetCuesByStartTime = new Map(); // For efficient range searching
        
        if (useNativeTarget && parsedTargetCues.length > 0) {
            parsedTargetCues.forEach(targetCue => {
                // Exact timing match
                const exactKey = `${targetCue.start.toFixed(2)}-${targetCue.end.toFixed(2)}`;
                targetCueMap.set(exactKey, targetCue.text);
                
                // Group by start time (rounded to 0.1s) for range searching
                const timeKey = Math.round(targetCue.start * 10) / 10;
                if (!targetCuesByStartTime.has(timeKey)) {
                    targetCuesByStartTime.set(timeKey, []);
                }
                targetCuesByStartTime.get(timeKey).push(targetCue);
            });
        }
        
        parsedOriginalCues.forEach(originalCue => {
            let translatedText = null;
            
            if (useNativeTarget) {
                // Look for exact timing match first
                const exactKey = `${originalCue.start.toFixed(2)}-${originalCue.end.toFixed(2)}`;
                translatedText = targetCueMap.get(exactKey) || null;
                
                // If no exact match, use optimized range search
                if (!translatedText) {
                    const searchRadius = 1.0; // 1 second tolerance
                    const startTime = Math.round((originalCue.start - searchRadius) * 10) / 10;
                    const endTime = Math.round((originalCue.start + searchRadius) * 10) / 10;
                    
                    // Check time buckets within range
                    for (let t = startTime; t <= endTime; t = Math.round((t + 0.1) * 10) / 10) {
                        const candidates = targetCuesByStartTime.get(t);
                        if (candidates) {
                            // Find closest match within candidates
                            let bestMatch = null;
                            let minTimeDiff = Infinity;
                            
                            for (const candidate of candidates) {
                                const timeDiff = Math.abs(originalCue.start - candidate.start);
                                if (timeDiff <= searchRadius && timeDiff < minTimeDiff) {
                                    bestMatch = candidate;
                                    minTimeDiff = timeDiff;
                                }
                            }
                            
                            if (bestMatch) {
                                translatedText = bestMatch.text;
                                break;
                            }
                        }
                    }
                }
            }
            
            subtitleQueue.push({
                original: originalCue.text,
                translated: translatedText, // Pre-filled for native target, null for translation mode
                start: originalCue.start,
                end: originalCue.end,
                videoId: currentVideoId,
                useNativeTarget: useNativeTarget,
                sourceLanguage: subtitleData.sourceLanguage || 'unknown',
                targetLanguage: subtitleData.targetLanguage || null
            });
        });
        
        console.log(`${logPrefix}: ${parsedOriginalCues.length} new cues added for videoId '${currentVideoId}'.`);
        console.log(`${logPrefix}: Using native target language: ${useNativeTarget}, Source language: ${subtitleData.sourceLanguage}, Target language: ${subtitleData.targetLanguage}`);
        
        if (subtitleData.availableLanguages) {
            console.log(`${logPrefix}: Available subtitle languages:`, subtitleData.availableLanguages.map(lang => `${lang.normalizedCode} (${lang.displayName})`));
        }
        
        // For native target, we have both originals and targets - display immediately
        // For translation needed, start the translation process
        if (!useNativeTarget && parsedOriginalCues.length > 0) {
            console.log(`${logPrefix}: Starting translation process for ${parsedOriginalCues.length} cues`);
            processSubtitleQueue(activePlatform, logPrefix);
        } else if (useNativeTarget) {
            console.log(`${logPrefix}: Native target mode - both languages ready, displaying dual subtitles`);
        }
    } else {
        console.warn(`${logPrefix}: VTT parsing yielded no cues for videoId '${currentVideoId}'. VTT URL from platform: ${subtitleData.url}`);
    }
}

export function handleVideoIdChange(newVideoId, logPrefix = "SubtitleUtils") {
    console.log(`${logPrefix}: Video context changing from '${currentVideoId || "null"}' to '${newVideoId}'.`);
    if (originalSubtitleElement) originalSubtitleElement.innerHTML = '';
    if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';

    if (currentVideoId && currentVideoId !== newVideoId) {
        subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== currentVideoId);
    }
    currentVideoId = newVideoId;
}

export async function processSubtitleQueue(activePlatform, logPrefix = "SubtitleUtils") {
    if (processingQueue) return;
    if (!activePlatform || !subtitlesActive) return;

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) return;

    const platformVideoId = activePlatform.getCurrentVideoId();
    if (!platformVideoId) return;

    if (!progressBarObserver && findProgressBarIntervalId) {
        console.log(`${logPrefix}: Progress bar observer setup in progress. Deferring queue processing slightly.`);
        setTimeout(() => processSubtitleQueue(activePlatform, logPrefix), 200);
        return;
    }

    let timeSource = videoElement.currentTime;

    const sliderElement = activePlatform.getProgressBarElement();

    if (sliderElement && progressBarObserver) {
        const nowStr = sliderElement.getAttribute('aria-valuenow');
        const maxStr = sliderElement.getAttribute('aria-valuemax');

        if (nowStr && maxStr) {
            const valuenow = parseFloat(nowStr);
            const valuemax = parseFloat(maxStr);
            const videoDuration = videoElement.duration;

            if (!isNaN(valuenow) && !isNaN(valuemax) && valuemax > 0) {
                if (!isNaN(videoDuration) && videoDuration > 0) {
                    timeSource = (valuenow / valuemax) * videoDuration;
                } else {
                    timeSource = valuenow;
                }
            }
        }
    }

    const currentTime = timeSource + userSubtitleTimeOffset;

    const relevantCues = subtitleQueue.filter(cue =>
        cue.videoId === platformVideoId &&
        cue.original && // Has original text
        !cue.translated && // Not yet translated
        !cue.useNativeTarget && // Don't translate if using native target
        cue.end >= currentTime // Cue is still relevant or upcoming
    );

    relevantCues.sort((a, b) => a.start - b.start);
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
                            err.errorType = "TRANSLATION_REQUEST_ERROR";
                            reject(err);
                        } else if (res && res.error) {
                            const err = new Error(res.details || res.error);
                            err.errorType = res.errorType || "TRANSLATION_API_ERROR";
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
                    c.original === response.originalText
                );

                const currentContextVideoId = activePlatform ? activePlatform.getCurrentVideoId() : null;
                if (cueInMainQueue && cueInMainQueue.videoId === currentContextVideoId) {
                    cueInMainQueue.translated = response.translatedText;
                } else {
                    console.warn(`${logPrefix}: Could not find/match cue post-translation or context changed. VideoID: ${response.cueVideoId}, Start: ${response.cueStart}, Current Context ID: ${currentContextVideoId}`);
                }

                if (i < cuesToProcess.length - 1 && userTranslationDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, userTranslationDelay));
                }

            } catch (error) {
                console.error(`${logPrefix}: Translation failed for (VideoID '${cueToProcess.videoId}', Start ${cueToProcess.start.toFixed(2)}): "${cueToProcess.original.substring(0,30)}..."`, error.message, error.errorType);
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
        cue.end >= currentTime
    );

    if (subtitlesActive && currentContextVideoIdForNextCheck && moreRelevantCuesExist) {
        setTimeout(() => processSubtitleQueue(activePlatform, logPrefix), 50);
    }
}

export async function loadInitialSettings() {
    const settingsToGet = {
        subtitlesEnabled: true,
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        subtitleTimeOffset: 0.3,
        subtitleLayoutOrder: 'original_top',
        subtitleOrientation: 'column',
        subtitleFontSize: 1.1,
        subtitleGap: 0.3,
        translationBatchSize: 3,
        translationDelay: 150,
        useNativeSubtitles: true
    };

    try {
        const items = await chrome.storage.sync.get(settingsToGet);
        subtitlesActive = items.subtitlesEnabled !== undefined ? items.subtitlesEnabled : settingsToGet.subtitlesEnabled;
        userTargetLanguage = items.targetLanguage || settingsToGet.targetLanguage;
        userOriginalLanguage = items.originalLanguage || settingsToGet.originalLanguage;
        userSubtitleTimeOffset = items.subtitleTimeOffset !== undefined ? items.subtitleTimeOffset : settingsToGet.subtitleTimeOffset;
        userSubtitleLayoutOrder = items.subtitleLayoutOrder || settingsToGet.subtitleLayoutOrder;
        userSubtitleOrientation = items.subtitleOrientation || settingsToGet.subtitleOrientation;
        userSubtitleFontSize = items.subtitleFontSize || settingsToGet.subtitleFontSize;
        userSubtitleGap = items.subtitleGap || settingsToGet.subtitleGap;
        userTranslationBatchSize = items.translationBatchSize || settingsToGet.translationBatchSize;
        userTranslationDelay = items.translationDelay || settingsToGet.translationDelay;
        userUseNativeSubtitles = items.useNativeSubtitles !== undefined ? items.useNativeSubtitles : settingsToGet.useNativeSubtitles;

        return {
            active: subtitlesActive, lang: userTargetLanguage, originalLang: userOriginalLanguage, 
            offset: userSubtitleTimeOffset, order: userSubtitleLayoutOrder, orientation: userSubtitleOrientation,
            fontSize: userSubtitleFontSize, gap: userSubtitleGap,
            batchSize: userTranslationBatchSize, delay: userTranslationDelay,
            useNative: userUseNativeSubtitles
        };
    } catch (e) {
        console.error("SubtitleUtils: Error loading initial settings:", e);
        return {
            active: true, lang: 'zh-CN', originalLang: 'en', 
            offset: 0.3, order: 'original_top', orientation: 'column',
            fontSize: 1.1, gap: 0.3, batchSize: 3, delay: 150, useNative: true
        };
    }
} 