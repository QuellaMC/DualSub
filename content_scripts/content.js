// disneyplus-dualsub-chrome-extension/content_scripts/content.js
console.log("Disney+ Dual Subtitles content script loaded (v7.4.9 - Full Layout & Offset Settings).");

// --- BEGIN INJECTION LOGIC ---
function injectTheInjectorScript() {
    try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('content_scripts/inject.js'); // Path from manifest
        s.id = 'disneyplus-dualsub-injector-script-tag';
        (document.head || document.documentElement).appendChild(s);
        s.onload = function() {
            console.log('Content: Inject.js script tag loaded into page.');
        };
        s.onerror = function() {
            console.error('Content: CRITICAL - Failed to load inject.js into page! Check manifest.json web_accessible_resources and file path.');
        };
        console.log("Content: Attempting to inject inject.js into page from:", s.src);
    } catch (e) {
        console.error("Content: CRITICAL - Error during inject.js injection attempt:", e);
    }
}
injectTheInjectorScript(); // Call this early to ensure inject.js runs as soon as possible
// --- END INJECTION LOGIC ---

const INJECT_SCRIPT_ID = 'disneyplus-dualsub-injector-event'; // Must match inject.js
let currentVideoId = null; 
let activeVideoElement = null; 

let subtitleContainer = null;
let originalSubtitleElement = null;
let translatedSubtitleElement = null;

let subtitlesActive = true;
let subtitleQueue = []; 
let processingQueue = false; 
let userTargetLanguage = 'es'; 
let userSubtitleTimeOffset = 0; 
let userSubtitleLayoutOrder = 'original_top'; 
let userSubtitleOrientation = 'column'; // 'column' (top/bottom) or 'row' (left/right)
let userSubtitleFontSize = 1.7; // Default font size in vw units
let userSubtitleGap = 0; // Gap between subtitles in em units
let userTranslationBatchSize = 1; // Number of translations to process at once
let userTranslationDelay = 100; // Delay between translation requests in ms

let timeUpdateListener = null;
let progressBarObserver = null; 
let lastProgressBarTime = -1; 
let findProgressBarIntervalId = null; 
let findProgressBarRetries = 0;
const MAX_FIND_PROGRESS_BAR_RETRIES = 20; 

let lastLoggedTimeSec = -1; 
let lastKnownVttUrlForVideoId = {}; 

let timeUpdateLogCounter = 0;
const TIME_UPDATE_LOG_INTERVAL = 30; 

function formatSubtitleTextForDisplay(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               // .replace(/\n/g, ' ')  // REMOVED: 将换行符替换为空格
               // .replace(/\s+/g, ' ') // REMOVED: 将多个连续空格替换为单个空格
               // .trim(); // REMOVED: 去除首尾空格
}

function parseVTT(vttString) {
    if (!vttString || !vttString.trim().toUpperCase().startsWith("WEBVTT")) {
        console.warn("Content ParseVTT: Invalid or empty VTT string. Not WEBVTT. Starts with:", vttString ? vttString.substring(0,30) : "null");
        return [];
    }
    const cues = [];
    const lines = vttString.split(/\r?\n/); 
    let i = 0;
    while (i < lines.length && (lines[i].trim().toUpperCase() === "WEBVTT" || lines[i].trim() === "")) {
        i++;
    }
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].includes("-->")) {
        i++;
        while (i < lines.length && lines[i].trim() === "") {
            i++;
        }
    }

    for (; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "") continue; 
        let cueId = null;
        if (!line.includes("-->")) {
            if (i + 1 < lines.length && lines[i+1].trim().includes("-->")) {
                cueId = line;
                i++; 
            } else {
                continue;
            }
        }
        const timestampLine = lines[i] ? lines[i].trim() : "";
        if (!timestampLine.includes("-->")) {
            continue; 
        }
        const timeParts = timestampLine.split(" --> ");
        if (timeParts.length < 2) {
            continue;
        }
        const startTimeStr = timeParts[0].trim();
        const endTimeAndStyle = timeParts[1].split(/ (.*)/s); 
        const endTimeStr = endTimeAndStyle[0].trim();
        let textLines = [];
        i++; 
        while (i < lines.length && lines[i].trim() !== "" && !lines[i].includes("-->")) {
            textLines.push(lines[i].trim());
            i++;
        }
        if (i < lines.length && (lines[i].trim() === "" || lines[i].includes("-->"))) {
            i--; 
        }
        if (textLines.length > 0) {
            cues.push({
                id: cueId, 
                start: parseTimestampToSeconds(startTimeStr),
                end: parseTimestampToSeconds(endTimeStr),
                text: textLines.join(" ").replace(/<[^>]*>/g, "").replace(/\s+/g, ' ').trim()
            });
        }
    }
    return cues;
}

function parseTimestampToSeconds(timestamp) {
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
        console.error("Content ParseTS: Error parsing timestamp '" + timestamp + "':", e);
        return 0;
    }
    return seconds;
}

function showSubtitleContainer() {
    if (subtitleContainer) {
        subtitleContainer.style.visibility = 'visible';
        subtitleContainer.style.opacity = '1';
        
        // Make sure both subtitle elements are properly initialized
        if (originalSubtitleElement) {
            originalSubtitleElement.style.display = 'inline-block';
        }
        if (translatedSubtitleElement) {
            translatedSubtitleElement.style.display = 'inline-block';
        }
        
        // Reapply styling to ensure proper layout
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

    // 应用相同的基础样式，确保字幕背景贴合文本
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

    subtitleContainer.style.flexDirection = userSubtitleOrientation;
    subtitleContainer.style.width = '94%'; // 父容器固定宽度
    subtitleContainer.style.justifyContent = 'center';
    subtitleContainer.style.alignItems = 'center';

    originalSubtitleElement.style.marginBottom = '0';
    originalSubtitleElement.style.marginRight = '0';
    translatedSubtitleElement.style.marginBottom = '0';
    translatedSubtitleElement.style.marginRight = '0';

    originalSubtitleElement.style.fontSize = `${userSubtitleFontSize}vw`;
    translatedSubtitleElement.style.fontSize = `${userSubtitleFontSize}vw`;

    while (subtitleContainer.firstChild) {
        subtitleContainer.removeChild(subtitleContainer.firstChild);
    }

    const firstElement = (userSubtitleLayoutOrder === 'translation_top') ? translatedSubtitleElement : originalSubtitleElement;
    const secondElement = (userSubtitleLayoutOrder === 'translation_top') ? originalSubtitleElement : translatedSubtitleElement;

    // Common styles for subtitle elements for tight background and controlled wrapping
    [firstElement, secondElement].forEach(el => {
        el.style.display = 'inline-block';
        el.style.width = 'auto';
        el.style.textAlign = 'center';
        el.style.boxSizing = 'border-box'; // Ensure padding doesn't expand beyond maxWidth
    });

    subtitleContainer.appendChild(firstElement);
    subtitleContainer.appendChild(secondElement);

    if (userSubtitleOrientation === 'column') { // Top/Bottom
        firstElement.style.maxWidth = '100%'; 
        secondElement.style.maxWidth = '100%';
        firstElement.style.marginBottom = `${userSubtitleGap}em`;
        secondElement.style.marginBottom = '0';
    } else { // 'row' (Left/Right)
        firstElement.style.maxWidth = 'calc(50% - 1%)'; // 50% minus half of the desired gap
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


function ensureSubtitleContainer() {
    const videoElement = document.querySelector('video'); 
    if (!videoElement) {
        if (activeVideoElement && timeUpdateListener) {
            activeVideoElement.removeEventListener('timeupdate', timeUpdateListener);
            activeVideoElement.removeAttribute('data-listener-attached'); 
        }
        if (progressBarObserver) {
            progressBarObserver.disconnect();
            progressBarObserver = null;
        }
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        activeVideoElement = null;
        clearSubtitleDOM(); 
        return;
    }

    if (activeVideoElement !== videoElement) {
        console.log("Content EnsureContainer: Video element changed or newly detected.");
        if (activeVideoElement && timeUpdateListener) {
            activeVideoElement.removeEventListener('timeupdate', timeUpdateListener);
            activeVideoElement.removeAttribute('data-listener-attached');
        }
        if (progressBarObserver) {
            progressBarObserver.disconnect();
            progressBarObserver = null;
        }
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        activeVideoElement = videoElement;
        attachTimeUpdateListener(); 
        setupProgressBarObserver(); 
    }

    if (subtitleContainer && document.body.contains(subtitleContainer)) {
        const videoPlayerParent = activeVideoElement ? activeVideoElement.parentElement : null;
        if (videoPlayerParent && subtitleContainer.parentElement !== videoPlayerParent) {
            if (getComputedStyle(videoPlayerParent).position === 'static') {
                videoPlayerParent.style.position = 'relative';
            }
            videoPlayerParent.appendChild(subtitleContainer);
        }
        applySubtitleStyling(); // Apply layout when ensuring container
        if (subtitlesActive) showSubtitleContainer(); else hideSubtitleContainer();
        return; 
    }

    console.log("Content EnsureContainer: Creating subtitle container.");
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
    
    // Initial append, order will be corrected by applySubtitleStyling
    subtitleContainer.appendChild(originalSubtitleElement);
    subtitleContainer.appendChild(translatedSubtitleElement);

    const videoPlayerParent = activeVideoElement ? activeVideoElement.parentElement : null; 
    if (videoPlayerParent) {
        if (getComputedStyle(videoPlayerParent).position === 'static') {
            videoPlayerParent.style.position = 'relative';
        }
        videoPlayerParent.appendChild(subtitleContainer);
    } else {
        document.body.appendChild(subtitleContainer); 
        console.warn("Content EnsureContainer: Subtitle container appended to body (video parent not found).");
    }
    
    applySubtitleStyling(); // Apply initial layout and styling

    if (activeVideoElement && !timeUpdateListener) attachTimeUpdateListener();
    if (activeVideoElement && !progressBarObserver) setupProgressBarObserver();

    if (subtitlesActive) showSubtitleContainer(); else hideSubtitleContainer();
}

function attemptToSetupProgressBarObserver() {
    if (!activeVideoElement) {
        console.warn("ProgressBarObserver: No active video element for attempt.");
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

    const playerParent = activeVideoElement.closest('div[data-testid="webAppRootView"], body'); 
    const sliderSelector = 'div.slider-container[role="slider"]';
    const sliderElement = playerParent 
        ? playerParent.querySelector(sliderSelector) 
        : document.querySelector(`div.progress-bar ${sliderSelector}`); 

    if (sliderElement) {
        console.log("ProgressBarObserver: Found slider element on attempt. Setting up observer:", sliderElement);
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
                    
                    if (nowStr && maxStr && activeVideoElement) {
                        const valuenow = parseFloat(nowStr);
                        const valuemax = parseFloat(maxStr);
                        const videoDuration = activeVideoElement.duration;

                        if (!isNaN(valuenow) && !isNaN(valuemax) && valuemax > 0) {
                            let calculatedTime = -1;
                            if (!isNaN(videoDuration) && videoDuration > 0) {
                                calculatedTime = (valuenow / valuemax) * videoDuration;
                            } else {
                                calculatedTime = valuenow; 
                            }
                            
                            if (calculatedTime >= 0 && Math.abs(calculatedTime - lastProgressBarTime) > 0.1) {
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
        console.log("ProgressBarObserver: Observer started for aria-valuenow on slider.");
        return true; 
    }
    return false; 
}

function setupProgressBarObserver() {
    if (findProgressBarIntervalId) { 
        clearInterval(findProgressBarIntervalId);
        findProgressBarIntervalId = null;
    }
    findProgressBarRetries = 0; 

    if (attemptToSetupProgressBarObserver()) {
        return; 
    }

    console.log("ProgressBarObserver: Could not find slider element immediately. Will retry...");
    findProgressBarIntervalId = setInterval(() => {
        findProgressBarRetries++;
        if (attemptToSetupProgressBarObserver()) {
            console.log(`ProgressBarObserver: Found and set up after ${findProgressBarRetries} retries.`);
        } else if (findProgressBarRetries >= MAX_FIND_PROGRESS_BAR_RETRIES) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
            console.warn(`ProgressBarObserver: Could not find the progress bar slider element after ${MAX_FIND_PROGRESS_BAR_RETRIES} retries. Subtitle sync might rely on timeupdate only.`);
        }
    }, 500); 
}


function attachTimeUpdateListener() {
     if (!activeVideoElement) {
        console.warn("Content AttachListener: No active video element to attach listener.");
        return;
    }
    if (activeVideoElement.getAttribute('data-listener-attached') === 'true') {
        return;
    }
    
    if (!timeUpdateListener) {
        timeUpdateListener = () => { 
            timeUpdateLogCounter++;
            if (activeVideoElement) { 
                const currentTime = activeVideoElement.currentTime;
                const readyState = activeVideoElement.readyState;
                if (!progressBarObserver && (timeUpdateLogCounter % TIME_UPDATE_LOG_INTERVAL === 0)) {
                    console.log(`[TimeUpdateDebug #${timeUpdateLogCounter}] HTML5 currentTime: ${currentTime}, readyState: ${readyState}, subtitlesActive: ${subtitlesActive}`);
                }
                if (!progressBarObserver && subtitlesActive && typeof currentTime === 'number' && readyState >= activeVideoElement.HAVE_CURRENT_DATA) {
                    updateSubtitles(currentTime);
                }
            }
        };
    }

    activeVideoElement.addEventListener('timeupdate', timeUpdateListener);
    activeVideoElement.setAttribute('data-listener-attached', 'true'); 
    console.log("Content AttachListener: Attached HTML5 timeupdate listener.");
}

function updateSubtitles(rawCurrentTime) {
    if (typeof rawCurrentTime !== 'number' || isNaN(rawCurrentTime)) {
        return;
    }
    
    const currentTime = rawCurrentTime + userSubtitleTimeOffset; // Apply time offset

    if (!originalSubtitleElement || !translatedSubtitleElement || !subtitleContainer || !document.body.contains(subtitleContainer)) {
        if (subtitlesActive) {
            ensureSubtitleContainer(); 
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

    for (const cue of subtitleQueue) {
        if (typeof cue.start !== 'number' || typeof cue.end !== 'number' || isNaN(cue.start) || isNaN(cue.end)) {
            continue;
        }
        if (cue.videoId === currentVideoId && currentTime >= cue.start && currentTime <= cue.end) {
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
            originalSubtitleElement.innerHTML = '';
            originalSubtitleElement.style.display = 'none';
        }

        if (translatedText.trim() !== "" && !translatedText.startsWith("[Translation")) {
            if (translatedSubtitleElement.innerHTML !== translatedTextFormatted) {
                translatedSubtitleElement.innerHTML = translatedTextFormatted;
                contentChanged = true;
            }
            translatedSubtitleElement.style.display = 'inline-block';
            if (translatedSubtitleElement.innerHTML === translatedTextFormatted && 
                translatedTextFormatted !== "" && contentChanged) { 
                console.log(`%cContent UpdateSubs: DISPLAYING TRANSLATED for VideoID '${currentVideoId}' at Time ${currentTime.toFixed(3)} (Offset: ${userSubtitleTimeOffset}s): "${translatedText.substring(0, 50)}..."`, "color: green; font-weight: bold;");
            }
        } else {
            translatedSubtitleElement.innerHTML = '';
            translatedSubtitleElement.style.display = 'none';
        }

        // 如果内容变化了，重新应用样式以确保背景贴合文本
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


async function processSubtitleQueue() {
    if (processingQueue) return; 
    if (!currentVideoId || !subtitlesActive || !activeVideoElement) return;

    // If progress bar observer setup is still running, defer this execution
    if (!progressBarObserver && findProgressBarIntervalId) {
        console.log("Content ProcessQ: Progress bar observer setup is still in progress. Deferring queue processing for 200ms.");
        setTimeout(processSubtitleQueue, 200); // Defer and let a future call handle it
        return; 
    }

    let timeSource = activeVideoElement.currentTime; // Default to video element's time
    let usingProgressBarTime = false;

    const sliderElement = document.querySelector('div.progress-bar div.slider-container[role="slider"]');
    // Updated Pre-check log - REMOVED
    // console.log(`Content ProcessQ - Pre-check: sliderElement: ${!!sliderElement}, progressBarObserver: ${!!progressBarObserver}, duration: ${activeVideoElement ? activeVideoElement.duration : 'N/A'}, setupIntervalActive: ${!!findProgressBarIntervalId}`);

    if (sliderElement && progressBarObserver) {
        const nowStr = sliderElement.getAttribute('aria-valuenow');
        const maxStr = sliderElement.getAttribute('aria-valuemax');

        if (nowStr && maxStr) {
            const valuenow = parseFloat(nowStr);
            const valuemax = parseFloat(maxStr);
            const videoDuration = activeVideoElement.duration; // Will be NaN based on logs

            if (!isNaN(valuenow) && !isNaN(valuemax) && valuemax > 0) {
                if (!isNaN(videoDuration) && videoDuration > 0) {
                    // Ideal case: video duration is known and positive
                    timeSource = (valuenow / valuemax) * videoDuration;
                    usingProgressBarTime = true;
                    // REMOVED: console.log(`Content ProcessQ: Using progress bar time (ratio). VDuration=${videoDuration.toFixed(2)}, VNow=${valuenow}, VMax=${valuemax}. Calculated time: ${timeSource.toFixed(3)}s`);
                } else {
                    // Fallback: video duration is not available (e.g., NaN, 0, or negative)
                    // Assume aria-valuenow might be current time in seconds.
                    timeSource = valuenow;
                    usingProgressBarTime = true;
                    // REMOVED: console.log(`Content ProcessQ: Using progress bar time (aria-valuenow fallback as video.duration is ${videoDuration}). VNow=${valuenow}, VMax=${valuemax}. Assumed time: ${timeSource.toFixed(3)}s`);
                }
            } else {
                console.warn(`Content ProcessQ: Progress bar aria values (now: '${nowStr}', max: '${maxStr}') are invalid or valuemax is not positive. Not using progress bar.`);
            }
        } else {
            console.warn("Content ProcessQ: Progress bar found, but aria-valuenow or aria-valuemax attributes are missing. Not using progress bar.");
        }
    }

    if (!usingProgressBarTime) {
        console.log(`Content ProcessQ: Not using progress bar time for queue. Defaulting to video.currentTime (${activeVideoElement.currentTime.toFixed(3)}s).`);
    }

    const currentTime = timeSource + userSubtitleTimeOffset;

    // Find untranslated cues for the current video that are currently relevant or upcoming
    const relevantCues = subtitleQueue.filter(cue => 
        cue.videoId === currentVideoId && 
        cue.original && 
        !cue.translated &&
        cue.end >= currentTime // Only consider cues that haven't ended yet
    );

    // Sort relevant cues by their start time to process them in order
    relevantCues.sort((a, b) => a.start - b.start);

    const cuesToProcess = relevantCues.slice(0, userTranslationBatchSize); // Limit to batch size

    if (cuesToProcess.length === 0) return;
    
    processingQueue = true;
    console.log(`Content ProcessQ: Processing ${cuesToProcess.length} untranslated cues starting around current time ${currentTime.toFixed(2)}s`);

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
                        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                        else if (res && res.error) reject(new Error(res.details || res.error));
                        else if (res && res.translatedText !== undefined && res.cueStart !== undefined && res.cueVideoId !== undefined) resolve(res);
                        else reject(new Error("Malformed response from background for translation. Response: " + JSON.stringify(res)));
                    });
                });
                
                // Find the specific cue in the main subtitleQueue to update its translated property
                const cueInMainQueue = subtitleQueue.find(c => 
                    c.videoId === response.cueVideoId && 
                    c.start === response.cueStart && 
                    c.original === response.originalText // Assuming originalText is sent back by background for matching
                );
                
                if (cueInMainQueue && cueInMainQueue.videoId === currentVideoId) {
                    cueInMainQueue.translated = response.translatedText;
                } else {
                    // This could happen if the video context changed rapidly or if the cue was somehow altered.
                    console.warn("Content ProcessQ: Could not find or match cue in main queue after translation. VideoID:", response.cueVideoId, "Start:", response.cueStart);
                }
                
                if (i < cuesToProcess.length - 1 && userTranslationDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, userTranslationDelay));
                }
                
            } catch (error) {
                console.error(`Content ProcessQ: Translation failed for (VideoID '${cueToProcess.videoId}', Start ${cueToProcess.start.toFixed(2)}): "${cueToProcess.original.substring(0,30)}..."`, error.message);
                const cueInQueueOnError = subtitleQueue.find(c => 
                    c.start === cueToProcess.start && 
                    c.original === cueToProcess.original && 
                    c.videoId === cueToProcess.videoId
                );
                if (cueInQueueOnError) cueInQueueOnError.translated = "[Translation Request Error]";
            }
        }
    } finally {
        processingQueue = false;
    }

    // Check if there are more cues to process that are relevant to the current time
    const moreRelevantCuesExist = subtitleQueue.some(cue => 
        cue.videoId === currentVideoId && 
        cue.original && 
        !cue.translated &&
        cue.end >= currentTime
    );

    if (subtitlesActive && currentVideoId && moreRelevantCuesExist) {
        setTimeout(processSubtitleQueue, 50); // Schedule next batch if more relevant cues exist
    }
}

function processFetchedVttText(vttText, videoIdFromFetch, vttUrl) {
    console.log(`Content VTTProcess: Processing fetched VTT for videoId '${videoIdFromFetch}'. Current active context videoId: '${currentVideoId}'`);
    if (videoIdFromFetch !== currentVideoId || !subtitlesActive) return;
    ensureSubtitleContainer(); 
    const parsedCues = parseVTT(vttText);
    if (parsedCues.length > 0) {
        subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== currentVideoId);
        parsedCues.forEach(parsedCue => {
            subtitleQueue.push({
                original: parsedCue.text, translated: null, 
                start: parsedCue.start, end: parsedCue.end, videoId: currentVideoId 
            });
        });
        console.log(`Content VTTProcess: ${parsedCues.length} new cues added for videoId '${currentVideoId}'.`);
        lastKnownVttUrlForVideoId[currentVideoId] = vttUrl; 
        if (parsedCues.length > 0) processSubtitleQueue(); 
    } else {
        console.warn("Content VTTProcess: VTT parsing yielded no cues for videoId '", currentVideoId, "'. VTT URL:", vttUrl);
    }
}

document.addEventListener(INJECT_SCRIPT_ID, function(e) {
    const data = e.detail;
    if (!data || !data.type) return;

    if (data.type === 'INJECT_SCRIPT_READY') {
        console.log("Content EventListener: Inject script is ready. (v7.4.9)");
    } else if (data.type === 'SUBTITLE_URL_FOUND') {
        if (!subtitlesActive) return;
        const injectedVideoId = data.videoId;
        const vttMasterUrl = data.url;
        if (!injectedVideoId) {
            console.error("Content EventListener: SUBTITLE_URL_FOUND event without a videoId. URL:", vttMasterUrl);
            return;
        }
        console.log(`Content EventListener: SUBTITLE_URL_FOUND for injectedVideoId: '${injectedVideoId}'. Current context: '${currentVideoId}'. URL: ${vttMasterUrl}`);
        if (currentVideoId !== injectedVideoId) {
            console.log(`Content EventListener: Video context changing from '${currentVideoId || "null"}' to '${injectedVideoId}'.`);
            if (originalSubtitleElement) originalSubtitleElement.innerHTML = '';
            if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';
            if (currentVideoId) {
                subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== currentVideoId);
                delete lastKnownVttUrlForVideoId[currentVideoId]; 
            }
            currentVideoId = injectedVideoId; 
        } else if (lastKnownVttUrlForVideoId[currentVideoId] === vttMasterUrl) {
            console.log(`Content EventListener: VTT URL ${vttMasterUrl} for videoId ${currentVideoId} already fetched. Skipping.`);
            if (activeVideoElement && subtitlesActive) { 
                 let timeToUpdate = activeVideoElement.currentTime;
                 const sliderElement = document.querySelector('div.progress-bar div.slider-container[role="slider"]');
                 if (sliderElement && progressBarObserver && activeVideoElement.duration > 0) {
                     const nowStr = sliderElement.getAttribute('aria-valuenow');
                     const maxStr = sliderElement.getAttribute('aria-valuemax');
                     if (nowStr && maxStr) {
                         const valuenow = parseFloat(nowStr);
                         const valuemax = parseFloat(maxStr);
                         if (!isNaN(valuenow) && !isNaN(valuemax) && valuemax > 0) {
                             timeToUpdate = (valuenow / valuemax) * activeVideoElement.duration;
                         }
                     }
                 }
                 updateSubtitles(timeToUpdate); 
            }
            return;
        }
        ensureSubtitleContainer(); 
        console.log("Content EventListener: Requesting VTT from background. URL:", vttMasterUrl, "Video ID:", currentVideoId);
        chrome.runtime.sendMessage({ action: "fetchVTT", url: vttMasterUrl, videoId: currentVideoId }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Content EventListener: Error for VTT fetch:", chrome.runtime.lastError.message, "URL:", vttMasterUrl);
                return;
            }
            if (response && response.success && response.videoId === currentVideoId) { 
                processFetchedVttText(response.vttText, response.videoId, response.url);
            } else if (response && !response.success) {
                console.error("Content EventListener: Background failed to fetch VTT:", response.error || "Unknown", "URL:", response.url);
            } else if (response && response.videoId !== currentVideoId) {
                console.warn(`Content EventListener: Received VTT for '${response.videoId}', but current context is '${currentVideoId}'. Discarding.`);
            } else {
                 console.error("Content EventListener: No/invalid response from background for fetchVTT. URL:", vttMasterUrl);
            }
        });
    }
});

function clearSubtitlesDisplayAndQueue(clearAllQueue = true) {
    if (clearAllQueue) {
        subtitleQueue = [];
        lastKnownVttUrlForVideoId = {}; 
        console.log("Content Clear: Full subtitleQueue and URL cache cleared.");
    } else if (currentVideoId) {
        subtitleQueue = subtitleQueue.filter(cue => cue.videoId !== currentVideoId);
        delete lastKnownVttUrlForVideoId[currentVideoId];
        console.log(`Content Clear: Subtitle queue and URL cache cleared for videoId ${currentVideoId}.`);
    }
}

function clearSubtitleDOM() {
     if (subtitleContainer && subtitleContainer.parentElement) {
        subtitleContainer.parentElement.removeChild(subtitleContainer);
    }
    subtitleContainer = null;
    originalSubtitleElement = null;
    translatedSubtitleElement = null;
    if (activeVideoElement && timeUpdateListener) {
        activeVideoElement.removeEventListener('timeupdate', timeUpdateListener);
        if (activeVideoElement) activeVideoElement.removeAttribute('data-listener-attached');
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let needsDisplayUpdate = false;
    let actionHandled = false;

    if (request.action === "toggleSubtitles") {
        actionHandled = true;
        subtitlesActive = request.enabled;
        console.log(`Content Settings: Subtitle active state changed to ${subtitlesActive}`);
        if (!subtitlesActive) {
            hideSubtitleContainer(); 
            clearSubtitlesDisplayAndQueue(true); 
        } else {
            ensureSubtitleContainer(); 
            showSubtitleContainer();
            needsDisplayUpdate = true;
        }
        sendResponse({ success: true, subtitlesEnabled: subtitlesActive });
    } else if (request.action === "changeLanguage") {
        actionHandled = true;
        userTargetLanguage = request.targetLanguage;
        console.log("Content Settings: Target language changed to:", userTargetLanguage);
        subtitleQueue.forEach(cue => { 
            if(cue.videoId === currentVideoId) cue.translated = null; 
        });
        if (subtitlesActive && currentVideoId && subtitleQueue.some(c => c.videoId === currentVideoId && c.original)) {
            if (subtitleContainer) showSubtitleContainer(); 
            processSubtitleQueue(); 
        }
        sendResponse({ success: true, newLanguage: userTargetLanguage });
    } else if (request.action === "changeTimeOffset") {
        actionHandled = true;
        userSubtitleTimeOffset = request.timeOffset;
        console.log("Content Settings: Time offset changed to:", userSubtitleTimeOffset, "s");
        needsDisplayUpdate = true;
        sendResponse({ success: true, newTimeOffset: userSubtitleTimeOffset });
    } else if (request.action === "changeLayoutOrder") {
        actionHandled = true;
        userSubtitleLayoutOrder = request.layoutOrder;
        console.log("Content Settings: Layout order changed to:", userSubtitleLayoutOrder);
        if (subtitleContainer) { 
            applySubtitleStyling();
        }
        needsDisplayUpdate = true; 
        sendResponse({ success: true, newLayoutOrder: userSubtitleLayoutOrder });
    } else if (request.action === "changeLayoutOrientation") {
        actionHandled = true;
        userSubtitleOrientation = request.layoutOrientation;
        console.log("Content Settings: Layout orientation changed to:", userSubtitleOrientation);
        if (subtitleContainer) {
            applySubtitleStyling();
        }
        needsDisplayUpdate = true;
        sendResponse({ success: true, newLayoutOrientation: userSubtitleOrientation });
    } else if (request.action === "changeFontSize") {
        actionHandled = true;
        userSubtitleFontSize = request.fontSize;
        console.log("Content Settings: Font size changed to:", userSubtitleFontSize, "vw");
        if (subtitleContainer) {
            originalSubtitleElement.style.fontSize = `${userSubtitleFontSize}vw`;
            translatedSubtitleElement.style.fontSize = `${userSubtitleFontSize}vw`;
        }
        needsDisplayUpdate = true;
        sendResponse({ success: true, newFontSize: userSubtitleFontSize });
    } else if (request.action === "changeGap") {
        actionHandled = true;
        userSubtitleGap = request.gap;
        console.log("Content Settings: Subtitle gap changed to:", userSubtitleGap, "em");
        if (subtitleContainer) {
            applySubtitleStyling(); // Reapply styling to update the gap
        }
        needsDisplayUpdate = true;
        sendResponse({ success: true, newGap: userSubtitleGap });
    } else if (request.action === "changeBatchSize") {
        actionHandled = true;
        userTranslationBatchSize = request.batchSize;
        console.log("Content Settings: Translation batch size changed to:", userTranslationBatchSize);
        sendResponse({ success: true, newBatchSize: userTranslationBatchSize });
    } else if (request.action === "changeDelay") {
        actionHandled = true;
        userTranslationDelay = request.delay;
        console.log("Content Settings: Translation delay changed to:", userTranslationDelay, "ms");
        sendResponse({ success: true, newDelay: userTranslationDelay });
    }

    if (needsDisplayUpdate && subtitlesActive && currentVideoId && activeVideoElement) {
        const sliderElement = document.querySelector('div.progress-bar div.slider-container[role="slider"]');
        let timeToUpdate = activeVideoElement.currentTime; 
        if (sliderElement && progressBarObserver) { 
            const nowStr = sliderElement.getAttribute('aria-valuenow');
            const maxStr = sliderElement.getAttribute('aria-valuemax');
            if (nowStr && maxStr) {
                const valuenow = parseFloat(nowStr);
                const valuemax = parseFloat(maxStr);
                const videoDuration = activeVideoElement.duration;
                if (!isNaN(valuenow) && !isNaN(valuemax) && valuemax > 0 && !isNaN(videoDuration) && videoDuration > 0) {
                    timeToUpdate = (valuenow / valuemax) * videoDuration;
                }
            }
        }
        updateSubtitles(timeToUpdate); 
    }
    
    return actionHandled; // Return true if the message was handled (async or not)
});

(async () => {
    try {
        const settingsToGet = {
            subtitlesEnabled: true, 
            targetLanguage: 'zh-CN',   
            subtitleTimeOffset: 0.3,  
            subtitleLayoutOrder: 'original_top', 
            subtitleOrientation: 'column',
            subtitleFontSize: 1.1,
            subtitleGap: 0.3,
            translationBatchSize: 3,
            translationDelay: 150
        };
        const items = await chrome.storage.sync.get(settingsToGet);
        
        subtitlesActive = items.subtitlesEnabled;
        userTargetLanguage = items.targetLanguage;
        userSubtitleTimeOffset = items.subtitleTimeOffset;
        userSubtitleLayoutOrder = items.subtitleLayoutOrder;
        userSubtitleOrientation = items.subtitleOrientation;
        userSubtitleFontSize = items.subtitleFontSize || settingsToGet.subtitleFontSize;
        userSubtitleGap = items.subtitleGap || settingsToGet.subtitleGap;
        userTranslationBatchSize = items.translationBatchSize || settingsToGet.translationBatchSize;
        userTranslationDelay = items.translationDelay || settingsToGet.translationDelay;

        console.log("Content Init: Initial settings loaded:", {
            active: subtitlesActive, 
            lang: userTargetLanguage,
            offset: userSubtitleTimeOffset,
            order: userSubtitleLayoutOrder,
            orientation: userSubtitleOrientation,
            fontSize: userSubtitleFontSize,
            gap: userSubtitleGap,
            batchSize: userTranslationBatchSize,
            delay: userTranslationDelay
        });
        ensureSubtitleContainer(); 
    } catch (e) {
        console.error("Content Init: Error loading initial settings:", e);
         subtitlesActive = true; 
         userTargetLanguage = 'zh-CN'; 
         userSubtitleTimeOffset = 0.3;
         userSubtitleLayoutOrder = 'original_top';
         userSubtitleOrientation = 'column';
         userSubtitleFontSize = 1.1;
         userSubtitleGap = 0.3;
         userTranslationBatchSize = 3;
         userTranslationDelay = 150;
         ensureSubtitleContainer();
    }
})();

const pageObserver = new MutationObserver((mutationsList, observerInstance) => {
    for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {
            const videoElementNow = document.querySelector('video');
            if (videoElementNow && (!activeVideoElement || activeVideoElement !== videoElementNow)) {
                 if (subtitlesActive) ensureSubtitleContainer(); 
            } else if (activeVideoElement && !videoElementNow) {
                 console.log("Content PageObs: Active video element REMOVED.");
                 hideSubtitleContainer();
                 if (timeUpdateListener && activeVideoElement) {
                    activeVideoElement.removeEventListener('timeupdate', timeUpdateListener);
                    activeVideoElement.removeAttribute('data-listener-attached');
                 }
                 if (progressBarObserver) {
                    progressBarObserver.disconnect();
                    progressBarObserver = null;
                 }
                 if (findProgressBarIntervalId) { 
                    clearInterval(findProgressBarIntervalId);
                    findProgressBarIntervalId = null;
                 }
                 activeVideoElement = null; 
            }
        }
    }
});
pageObserver.observe(document.body, { childList: true, subtree: true });

console.log("Disney+ Dual Subtitles content script fully initialized (v7.4.9).");
