/**
 * Provides shared utilities for dual subtitle functionality across all streaming platforms,
 * including DOM manipulation, subtitle parsing, styling, and state management.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

// Logger instance for subtitle utilities
let utilsLogger = null;

// Initialize fallback console logging until Logger is loaded
function logWithFallback(level, message, data = {}) {
    if (utilsLogger) {
        utilsLogger[level](message, data);
    } else {
        console.log(
            `[SubtitleUtils] [${level.toUpperCase()}] ${message}`,
            data
        );
    }
}

// Initialize logger when available
export async function initializeLogger() {
    try {
        const loggerModule = await import(
            chrome.runtime.getURL('utils/logger.js')
        );
        const Logger = loggerModule.default;
        utilsLogger = Logger.create('SubtitleUtils');

        // Try to get logging level from config if available
        try {
            const configModule = await import(
                chrome.runtime.getURL('services/configService.js')
            );
            const configService = configModule.configService;
            const loggingLevel = await configService.get('loggingLevel');
            utilsLogger.updateLevel(loggingLevel);
            utilsLogger.info('Subtitle utilities logger initialized', {
                level: loggingLevel,
            });
        } catch (error) {
            // Fallback to INFO level if config can't be read
            utilsLogger.updateLevel(Logger.LEVELS.INFO);
            utilsLogger.warn(
                'Failed to load logging level from config, using INFO level',
                error
            );
        }
    } catch (error) {
        logWithFallback('error', 'Failed to initialize logger', { error });
    }
}

// Auto-initialize logger
initializeLogger();

logWithFallback('info', 'Subtitle utilities module loaded');
const localizedErrorMessages = {
    TRANSLATION_API_ERROR: {
        en: '[Translation API Error. Check settings or try another provider.]',
        es: '[Error de API de Traducción. Revisa la configuración o prueba otro proveedor.]',
        ja: '[翻訳API エラー。設定を確認するか、他のプロバイダーを試してください。]',
        ko: '[번역 API 오류. 설정을 확인하거나 다른 제공업체를 시도해보세요.]',
        'zh-CN': '[翻译API错误。请检查设置或尝试其他翻译源。]',
        'zh-TW': '[翻譯API錯誤。請檢查設定或嘗試其他翻譯源。]',
    },
    TRANSLATION_REQUEST_ERROR: {
        en: '[Translation Request Error. Please try again.]',
        es: '[Error en la Solicitud de Traducción. Por favor, inténtalo de nuevo.]',
        ja: '[翻訳リクエスト エラー。もう一度お試しください。]',
        ko: '[번역 요청 오류. 다시 시도해주세요.]',
        'zh-CN': '[翻译请求错误。请重试。]',
        'zh-TW': '[翻譯請求錯誤。請重試。]',
    },
    TRANSLATION_GENERIC_ERROR: {
        en: '[Translation Failed. Please try again or check settings.]',
        es: '[Traducción Fallida. Por favor, inténtalo de nuevo o revisa la configuración.]',
        ja: '[翻訳に失敗しました。もう一度試すか、設定を確認してください。]',
        ko: '[번역에 실패했습니다. 다시 시도하거나 설정을 확인해주세요.]',
        'zh-CN': '[翻译失败。请重试或检查设置。]',
        'zh-TW': '[翻譯失敗。請重試或檢查設定。]',
    },
};

export function getUILanguage() {
    const lang = (
        navigator.language ||
        navigator.userLanguage ||
        'en'
    ).toLowerCase();
    if (lang.startsWith('zh-cn')) return 'zh-CN';
    if (lang.startsWith('zh-tw')) return 'zh-TW';
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('es')) return 'es';
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('ko')) return 'ko';
    return 'en';
}

export function getLocalizedErrorMessage(errorTypeKey, details = '') {
    const uiLang = getUILanguage();
    const messagesForType = localizedErrorMessages[errorTypeKey];
    if (messagesForType) {
        return messagesForType[uiLang] || messagesForType['en'];
    }
    const fallbackMessages =
        localizedErrorMessages['TRANSLATION_GENERIC_ERROR'];
    return (
        fallbackMessages[uiLang] ||
        fallbackMessages['en'] ||
        '[Translation Error]'
    );
}

// Core state variables (these are NOT user preferences)
export let currentVideoId = null;
export let subtitleContainer = null;
export let originalSubtitleElement = null;
export let translatedSubtitleElement = null;
export let subtitlesActive = true;
export let subtitleQueue = [];
export let processingQueue = false;

// Video tracking state
export let timeUpdateListener = null;
export let progressBarObserver = null;
export let lastProgressBarTime = -1;
export let findProgressBarIntervalId = null;
export let findProgressBarRetries = 0;
export const MAX_FIND_PROGRESS_BAR_RETRIES = 20;
export let lastLoggedTimeSec = -1;
export let timeUpdateLogCounter = 0;
export const TIME_UPDATE_LOG_INTERVAL = 30;

// State setters (only for core state, not user preferences)
export function setCurrentVideoId(id) {
    currentVideoId = id;
}

export function setSubtitlesActive(active) {
    subtitlesActive = active;
}

export function formatSubtitleTextForDisplay(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function parseVTT(vttString) {
    if (!vttString || !vttString.trim().toUpperCase().startsWith('WEBVTT')) {
        logWithFallback(
            'warn',
            'Invalid or empty VTT string provided for parsing.'
        );
        return [];
    }
    const cues = [];
    const cueBlocks = vttString
        .split(/\r?\n\r?\n/)
        .filter((block) => block.trim() !== '');

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

        const timeParts = timestampLine.split(' --> ');
        if (timeParts.length < 2) continue;

        const startTimeStr = timeParts[0].trim();
        const endTimeStr = timeParts[1].split(' ')[0].trim();

        const start = parseTimestampToSeconds(startTimeStr);
        const end = parseTimestampToSeconds(endTimeStr);

        const text = textLines
            .join(' ')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (text && !Number.isNaN(start) && !Number.isNaN(end)) {
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
        if (Number.isNaN(seconds)) return 0;
    } catch (e) {
        logWithFallback('error', 'Error parsing timestamp.', {
            timestamp,
            error: e,
        });
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

export function applySubtitleStyling(config) {
    if (
        !subtitleContainer ||
        !originalSubtitleElement ||
        !translatedSubtitleElement
    ) {
        return;
    }

    const elements = [originalSubtitleElement, translatedSubtitleElement];
    elements.forEach((el) => {
        Object.assign(el.style, {
            padding: '0.2em 0.5em',
            lineHeight: '1.3',
            whiteSpace: 'normal',
            overflow: 'visible',
            textOverflow: 'clip',
            marginBottom: '0',
            marginRight: '0',
            fontSize: `${config.subtitleFontSize}vw`,
            display: 'inline-block',
            width: 'auto',
            textAlign: 'center',
            boxSizing: 'border-box',
        });
    });

    Object.assign(subtitleContainer.style, {
        flexDirection: config.subtitleLayoutOrientation,
        width: '94%',
        justifyContent: 'center',
        alignItems: 'center',
    });

    while (subtitleContainer.firstChild) {
        subtitleContainer.removeChild(subtitleContainer.firstChild);
    }

    const firstElement =
        config.subtitleLayoutOrder === 'translation_top'
            ? translatedSubtitleElement
            : originalSubtitleElement;
    const secondElement =
        config.subtitleLayoutOrder === 'translation_top'
            ? originalSubtitleElement
            : translatedSubtitleElement;

    subtitleContainer.appendChild(firstElement);
    subtitleContainer.appendChild(secondElement);

    if (config.subtitleLayoutOrientation === 'column') {
        firstElement.style.maxWidth = '100%';
        secondElement.style.maxWidth = '100%';
        firstElement.style.marginBottom = `${config.subtitleGap}em`;
    } else {
        firstElement.style.maxWidth = 'calc(50% - 1%)';
        secondElement.style.maxWidth = 'calc(50% - 1%)';
        firstElement.style.verticalAlign = 'top';
        secondElement.style.verticalAlign = 'top';
        (config.subtitleLayoutOrder === 'translation_top'
            ? translatedSubtitleElement
            : originalSubtitleElement
        ).style.marginRight = '2%';
    }
}

export function isVideoSetupComplete(activePlatform) {
    if (!activePlatform) return false;

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) return false;

    return (
        videoElement.getAttribute('data-listener-attached') === 'true' &&
        subtitleContainer &&
        document.body.contains(subtitleContainer)
    );
}

export function ensureSubtitleContainer(
    activePlatform,
    config,
    logPrefix = 'SubtitleUtils'
) {
    if (!activePlatform) {
        return false;
    }

    if (!activePlatform.isPlayerPageActive()) {
        clearSubtitleDOM();
        return false;
    }

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) {
        const previousVideoElement = document.querySelector(
            'video[data-listener-attached="true"]'
        );
        if (previousVideoElement && timeUpdateListener) {
            previousVideoElement.removeEventListener(
                'timeupdate',
                timeUpdateListener
            );
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
        return false;
    }

    const attachedVideoElement = document.querySelector(
        'video[data-listener-attached="true"]'
    );
    if (attachedVideoElement !== videoElement) {
        if (attachedVideoElement && timeUpdateListener) {
            attachedVideoElement.removeEventListener(
                'timeupdate',
                timeUpdateListener
            );
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
        attachTimeUpdateListener(
            videoElement,
            activePlatform,
            config,
            logPrefix
        );
        if (activePlatform.supportsProgressBarTracking?.() !== false) {
            setupProgressBarObserver(
                videoElement,
                activePlatform,
                config,
                logPrefix
            );
        }
    }

    if (subtitleContainer && document.body.contains(subtitleContainer)) {
        const videoPlayerParent = activePlatform.getPlayerContainerElement();
        if (
            videoPlayerParent &&
            subtitleContainer.parentElement !== videoPlayerParent
        ) {
            if (getComputedStyle(videoPlayerParent).position === 'static') {
                videoPlayerParent.style.position = 'relative';
            }
            videoPlayerParent.appendChild(subtitleContainer);
        }
        applySubtitleStyling(config);
        if (subtitlesActive) showSubtitleContainer();
        else hideSubtitleContainer();
        return true;
    }

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
        justifyContent: 'center',
    });

    originalSubtitleElement = document.createElement('div');
    originalSubtitleElement.id = 'disneyplus-original-subtitle';
    Object.assign(originalSubtitleElement.style, {
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '0.2em 0.5em',
        fontSize: `${config.subtitleFontSize}vw`,
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
        textAlign: 'center',
    });

    translatedSubtitleElement = document.createElement('div');
    translatedSubtitleElement.id = 'disneyplus-translated-subtitle';
    Object.assign(translatedSubtitleElement.style, {
        color: '#00FFFF',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '0.2em 0.5em',
        fontSize: `${config.subtitleFontSize}vw`,
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
        textAlign: 'center',
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
        logWithFallback(
            'warn',
            'Subtitle container appended to body (platform video parent not found).',
            { logPrefix }
        );
    }

    applySubtitleStyling(config);

    if (videoElement && !videoElement.getAttribute('data-listener-attached')) {
        attachTimeUpdateListener(
            videoElement,
            activePlatform,
            config,
            logPrefix
        );
    }
    if (
        videoElement &&
        !progressBarObserver &&
        activePlatform.supportsProgressBarTracking?.() !== false
    ) {
        setupProgressBarObserver(
            videoElement,
            activePlatform,
            config,
            logPrefix
        );
    }

    if (subtitlesActive) showSubtitleContainer();
    else hideSubtitleContainer();
    return true;
}

export function attachTimeUpdateListener(
    videoElement,
    activePlatform,
    config,
    logPrefix = 'SubtitleUtils'
) {
    if (!activePlatform || !videoElement) {
        logWithFallback(
            'warn',
            'No active platform or video element to attach timeupdate listener.',
            { logPrefix }
        );
        return;
    }

    if (videoElement.getAttribute('data-listener-attached') === 'true') {
        return;
    }

    if (!timeUpdateListener) {
        timeUpdateListener = () => {
            timeUpdateLogCounter++;
            const currentVideoElem = activePlatform?.getVideoElement();
            if (currentVideoElem) {
                const { currentTime, readyState, HAVE_CURRENT_DATA } =
                    currentVideoElem;
                const useProgressBar =
                    activePlatform.supportsProgressBarTracking?.() !== false;

                if (
                    (!progressBarObserver || !useProgressBar) &&
                    subtitlesActive &&
                    typeof currentTime === 'number' &&
                    readyState >= HAVE_CURRENT_DATA
                ) {
                    updateSubtitles(
                        currentTime,
                        activePlatform,
                        config,
                        logPrefix
                    );
                }
            }
        };
    }

    videoElement.addEventListener('timeupdate', timeUpdateListener);
    videoElement.setAttribute('data-listener-attached', 'true');
    logWithFallback('info', 'Attached HTML5 timeupdate listener.', {
        logPrefix,
    });
}

export function setupProgressBarObserver(
    videoElement,
    activePlatform,
    config,
    logPrefix = 'SubtitleUtils'
) {
    if (findProgressBarIntervalId) {
        clearInterval(findProgressBarIntervalId);
        findProgressBarIntervalId = null;
    }
    findProgressBarRetries = 0;

    if (
        attemptToSetupProgressBarObserver(
            videoElement,
            activePlatform,
            config,
            logPrefix
        )
    ) {
        return;
    }

    logWithFallback(
        'info',
        'Could not find progress bar slider immediately. Retrying.',
        { logPrefix }
    );
    findProgressBarIntervalId = setInterval(() => {
        findProgressBarRetries++;
        const currentVideoElem = activePlatform?.getVideoElement();
        if (
            attemptToSetupProgressBarObserver(
                currentVideoElem,
                activePlatform,
                config,
                logPrefix
            )
        ) {
            logWithFallback('info', 'Progress bar observer found and set up.', {
                logPrefix,
                retries: findProgressBarRetries,
            });
        } else if (findProgressBarRetries >= MAX_FIND_PROGRESS_BAR_RETRIES) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
            logWithFallback(
                'warn',
                'Could not find the progress bar slider after max retries. Subtitle sync will rely on timeupdate only.',
                {
                    logPrefix,
                    maxRetries: MAX_FIND_PROGRESS_BAR_RETRIES,
                }
            );
        }
    }, 500);
}

function attemptToSetupProgressBarObserver(
    videoElement,
    activePlatform,
    config,
    logPrefix = 'SubtitleUtils'
) {
    if (!activePlatform || !videoElement) {
        logWithFallback(
            'warn',
            'No active platform or video element for progress bar observer attempt.',
            { logPrefix }
        );
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
        logWithFallback(
            'info',
            'Found progress bar slider via platform. Setting up observer.',
            {
                logPrefix,
                sliderElement: sliderElement.tagName,
            }
        );
        if (findProgressBarIntervalId) {
            clearInterval(findProgressBarIntervalId);
            findProgressBarIntervalId = null;
        }
        findProgressBarRetries = 0;

        progressBarObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (
                    mutation.type === 'attributes' &&
                    mutation.attributeName === 'aria-valuenow'
                ) {
                    const targetElement = mutation.target;
                    const nowStr = targetElement.getAttribute('aria-valuenow');
                    const maxStr = targetElement.getAttribute('aria-valuemax');

                    const currentVideoElem = activePlatform.getVideoElement();
                    if (nowStr && maxStr && currentVideoElem) {
                        const valuenow = parseFloat(nowStr);
                        const valuemax = parseFloat(maxStr);
                        const { duration: videoDuration } = currentVideoElem;

                        if (
                            !Number.isNaN(valuenow) &&
                            !Number.isNaN(valuemax) &&
                            valuemax > 0
                        ) {
                            const calculatedTime =
                                !Number.isNaN(videoDuration) &&
                                videoDuration > 0
                                    ? (valuenow / valuemax) * videoDuration
                                    : valuenow;

                            if (
                                calculatedTime >= 0 &&
                                Math.abs(calculatedTime - lastProgressBarTime) >
                                    0.1
                            ) {
                                if (subtitlesActive) {
                                    updateSubtitles(
                                        calculatedTime,
                                        activePlatform,
                                        config,
                                        logPrefix
                                    );
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
            attributeFilter: ['aria-valuenow'],
        });
        logWithFallback(
            'info',
            'Progress bar observer started for aria-valuenow.',
            { logPrefix }
        );
        return true;
    }
    return false;
}

export function updateSubtitles(
    rawCurrentTime,
    activePlatform,
    config,
    logPrefix = 'SubtitleUtils'
) {
    if (typeof rawCurrentTime !== 'number' || Number.isNaN(rawCurrentTime)) {
        return;
    }

    const currentTime = rawCurrentTime + config.subtitleTimeOffset;

    if (
        !originalSubtitleElement ||
        !translatedSubtitleElement ||
        !subtitleContainer ||
        !document.body.contains(subtitleContainer)
    ) {
        if (subtitlesActive) {
            ensureSubtitleContainer(activePlatform, config, logPrefix);
            if (
                !originalSubtitleElement ||
                !translatedSubtitleElement ||
                !subtitleContainer
            ) {
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
    let originalActiveCue = null;
    let translatedActiveCue = null;

    const platformVideoId = activePlatform
        ? activePlatform.getCurrentVideoId()
        : null;

    // Find all active cues at current time
    const activeCues = [];
    for (const cue of subtitleQueue) {
        if (
            typeof cue.start !== 'number' ||
            typeof cue.end !== 'number' ||
            Number.isNaN(cue.start) ||
            Number.isNaN(cue.end)
        ) {
            continue;
        }
        if (
            cue.videoId === platformVideoId &&
            currentTime >= cue.start &&
            currentTime <= cue.end
        ) {
            activeCues.push(cue);
        }
    }

    if (activeCues.length > 0) {
        foundCue = true;

        // Log multiple cues if detected (for debugging timing issues)
        if (activeCues.length > 1 && currentWholeSecond !== lastLoggedTimeSec) {
            logWithFallback('debug', 'Multiple active cues detected', {
                logPrefix,
                time: currentTime.toFixed(2),
                cueCount: activeCues.length,
                cues: activeCues.map((c) => ({
                    start: c.start.toFixed(2),
                    end: c.end.toFixed(2),
                    text: (c.original || c.translated || 'empty').substring(
                        0,
                        30
                    ),
                })),
            });
        }

        // For native mode: find the best matching original and target cues
        if (activeCues.some((c) => c.useNativeTarget)) {
            // Find original language cue (cueType === 'original' or has original text but no translated)
            originalActiveCue = activeCues.find(
                (c) => c.cueType === 'original' || (c.original && !c.translated)
            );

            // Find target language cue (cueType === 'target' or has translated text but no original)
            translatedActiveCue = activeCues.find(
                (c) => c.cueType === 'target' || (c.translated && !c.original)
            );

            // Alternative strategy if no cueType available (fallback compatibility)
            if (!originalActiveCue && !translatedActiveCue) {
                originalActiveCue =
                    activeCues.find((c) => c.original && !c.translated) ||
                    activeCues[0];

                // Look for target cue that overlaps most with original cue
                if (originalActiveCue) {
                    let bestTargetCue = null;
                    let maxOverlap = 0;

                    for (const cue of activeCues) {
                        if (cue !== originalActiveCue && cue.translated) {
                            // Calculate overlap between this cue and original cue
                            const overlapStart = Math.max(
                                originalActiveCue.start,
                                cue.start
                            );
                            const overlapEnd = Math.min(
                                originalActiveCue.end,
                                cue.end
                            );
                            const overlap = Math.max(
                                0,
                                overlapEnd - overlapStart
                            );

                            if (overlap > maxOverlap) {
                                maxOverlap = overlap;
                                bestTargetCue = cue;
                            }
                        }
                    }

                    translatedActiveCue = bestTargetCue;

                    if (
                        bestTargetCue &&
                        currentWholeSecond !== lastLoggedTimeSec
                    ) {
                        logWithFallback('debug', 'Native mode overlap search', {
                            logPrefix,
                            original: {
                                start: originalActiveCue.start.toFixed(2),
                                end: originalActiveCue.end.toFixed(2),
                            },
                            target: {
                                start: bestTargetCue.start.toFixed(2),
                                end: bestTargetCue.end.toFixed(2),
                            },
                            overlap: maxOverlap.toFixed(2),
                        });
                    }
                }
            } else if (
                originalActiveCue &&
                translatedActiveCue &&
                currentWholeSecond !== lastLoggedTimeSec
            ) {
                logWithFallback('debug', 'Native mode direct match', {
                    logPrefix,
                    original: {
                        start: originalActiveCue.start.toFixed(2),
                        end: originalActiveCue.end.toFixed(2),
                    },
                    target: {
                        start: translatedActiveCue.start.toFixed(2),
                        end: translatedActiveCue.end.toFixed(2),
                    },
                });
            }
        } else {
            // For translation mode: use the first/best active cue
            originalActiveCue = activeCues[0];
        }
    }

    if (foundCue) {
        const originalText = originalActiveCue
            ? originalActiveCue.original || ''
            : '';
        const translatedText = translatedActiveCue
            ? translatedActiveCue.translated || ''
            : originalActiveCue
              ? originalActiveCue.translated || ''
              : '';
        const useNativeTarget =
            originalActiveCue?.useNativeTarget ||
            translatedActiveCue?.useNativeTarget ||
            false;

        const originalTextFormatted =
            formatSubtitleTextForDisplay(originalText);
        const translatedTextFormatted =
            formatSubtitleTextForDisplay(translatedText);

        let contentChanged = false;

        if (currentWholeSecond !== lastLoggedTimeSec) {
            logWithFallback('debug', 'Display subtitle update.', {
                logPrefix,
                time: currentTime.toFixed(2),
                useNativeTarget,
                activeCueCount: activeCues.length,
                originalText:
                    originalText.substring(0, 30) +
                    (originalText.length > 30 ? '...' : ''),
                translatedText:
                    translatedText.substring(0, 30) +
                    (translatedText.length > 30 ? '...' : ''),
            });
        }

        if (useNativeTarget) {
            if (originalText.trim()) {
                if (
                    originalSubtitleElement.innerHTML !== originalTextFormatted
                ) {
                    originalSubtitleElement.innerHTML = originalTextFormatted;
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Setting original subtitle (native mode).',
                            { logPrefix, text: originalText }
                        );
                    }
                }
                originalSubtitleElement.style.display = 'inline-block';
            } else {
                if (originalSubtitleElement.innerHTML) {
                    originalSubtitleElement.innerHTML = '';
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Clearing original subtitle (native mode, empty text).',
                            { logPrefix }
                        );
                    }
                }
                originalSubtitleElement.style.display = 'none';
            }

            if (translatedText.trim()) {
                if (
                    translatedSubtitleElement.innerHTML !==
                    translatedTextFormatted
                ) {
                    translatedSubtitleElement.innerHTML =
                        translatedTextFormatted;
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Setting native target subtitle.',
                            { logPrefix, text: translatedText }
                        );
                    }
                }
                translatedSubtitleElement.style.display = 'inline-block';
            } else {
                if (translatedSubtitleElement.innerHTML) {
                    translatedSubtitleElement.innerHTML = '';
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Clearing native target subtitle (no match found).',
                            { logPrefix }
                        );
                    }
                }
                translatedSubtitleElement.style.display = 'none';
            }
        } else {
            if (originalText.trim()) {
                if (
                    originalSubtitleElement.innerHTML !== originalTextFormatted
                ) {
                    originalSubtitleElement.innerHTML = originalTextFormatted;
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback('debug', 'Setting original subtitle.', {
                            logPrefix,
                            text: originalText,
                        });
                    }
                }
                originalSubtitleElement.style.display = 'inline-block';
            } else {
                if (originalSubtitleElement.innerHTML) {
                    originalSubtitleElement.innerHTML = '';
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Clearing original subtitle (empty text).',
                            { logPrefix }
                        );
                    }
                }
                originalSubtitleElement.style.display = 'none';
            }

            if (translatedText.trim()) {
                if (
                    translatedSubtitleElement.innerHTML !==
                    translatedTextFormatted
                ) {
                    translatedSubtitleElement.innerHTML =
                        translatedTextFormatted;
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Setting translated subtitle.',
                            { logPrefix, text: translatedText }
                        );
                    }
                }
                translatedSubtitleElement.style.display = 'inline-block';
            } else {
                if (translatedSubtitleElement.innerHTML) {
                    translatedSubtitleElement.innerHTML = '';
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Clearing translated subtitle (no translation yet).',
                            { logPrefix }
                        );
                    }
                }
                translatedSubtitleElement.style.display = 'none';
            }
        }

        if (contentChanged) {
            applySubtitleStyling(config);
        }
    } else {
        if (originalSubtitleElement.innerHTML)
            originalSubtitleElement.innerHTML = '';
        originalSubtitleElement.style.display = 'none';

        if (translatedSubtitleElement.innerHTML)
            translatedSubtitleElement.innerHTML = '';
        translatedSubtitleElement.style.display = 'none';
    }
}

export function clearSubtitlesDisplayAndQueue(
    activePlatform,
    clearAllQueue = true,
    logPrefix = 'SubtitleUtils'
) {
    const platformVideoId = activePlatform?.getCurrentVideoId();

    if (clearAllQueue) {
        subtitleQueue = [];
        logWithFallback('info', 'Full subtitleQueue cleared.', { logPrefix });
    } else if (platformVideoId) {
        subtitleQueue = subtitleQueue.filter(
            (cue) => cue.videoId !== platformVideoId
        );
        logWithFallback('info', 'Subtitle queue cleared for videoId.', {
            logPrefix,
            videoId: platformVideoId,
        });
    }

    // Clear subtitle display elements
    if (originalSubtitleElement) originalSubtitleElement.innerHTML = '';
    if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';

    // Force garbage collection of any remaining maps/objects
    // This helps prevent memory leaks from large subtitle datasets
    if (typeof gc === 'function') {
        try {
            gc();
        } catch (e) {
            // gc() not available, ignore
        }
    }
}

export function clearSubtitleDOM() {
    if (subtitleContainer && subtitleContainer.parentElement) {
        subtitleContainer.parentElement.removeChild(subtitleContainer);
    }
    subtitleContainer = null;
    originalSubtitleElement = null;
    translatedSubtitleElement = null;

    const videoElement = document.querySelector(
        'video[data-listener-attached="true"]'
    );
    if (videoElement && timeUpdateListener) {
        videoElement.removeEventListener('timeupdate', timeUpdateListener);
        videoElement.removeAttribute('data-listener-attached');
    }

    timeUpdateListener = null;

    if (progressBarObserver) {
        progressBarObserver.disconnect();
        progressBarObserver = null;
    }
    if (findProgressBarIntervalId) {
        clearInterval(findProgressBarIntervalId);
        findProgressBarIntervalId = null;
    }
}

export function handleSubtitleDataFound(
    subtitleData,
    activePlatform,
    config,
    logPrefix = 'SubtitleUtils'
) {
    if (!currentVideoId && activePlatform) {
        currentVideoId = activePlatform.getCurrentVideoId();
    }

    if (subtitleData.videoId !== currentVideoId || !subtitlesActive) {
        logWithFallback('warn', 'Subtitle data mismatch or inactive.', {
            logPrefix,
            dataVideoId: subtitleData.videoId,
            currentVideoId,
            subtitlesActive,
        });
        return;
    }

    if (
        subtitleData.selectedLanguage?.normalizedCode !==
        config.originalLanguage
    ) {
        logWithFallback('info', 'Language fallback occurred.', {
            logPrefix,
            requested: config.originalLanguage,
            using: subtitleData.selectedLanguage.normalizedCode,
            displayName: subtitleData.selectedLanguage.displayName,
        });
    }

    ensureSubtitleContainer(activePlatform, config, logPrefix);
    const parsedOriginalCues = parseVTT(subtitleData.vttText);

    const parsedTargetCues = subtitleData.targetVttText
        ? parseVTT(subtitleData.targetVttText)
        : [];

    if (parsedOriginalCues.length > 0) {
        subtitleQueue = subtitleQueue.filter(
            (cue) => cue.videoId !== currentVideoId
        );

        const useNativeTarget = subtitleData.useNativeTarget || false;

        logWithFallback('info', 'Processing subtitles.', {
            logPrefix,
            useNativeTarget,
            originalCueCount: parsedOriginalCues.length,
            targetCueCount: parsedTargetCues.length,
        });

        if (useNativeTarget && parsedTargetCues.length > 0) {
            logWithFallback(
                'debug',
                'Native mode - Adding original cues with timing.',
                {
                    logPrefix,
                    cueCount: parsedOriginalCues.length,
                    firstThreeCues: parsedOriginalCues
                        .slice(0, 3)
                        .map(
                            (c) =>
                                `[${c.start.toFixed(2)}-${c.end.toFixed(2)}s]`
                        ),
                }
            );

            parsedOriginalCues.forEach((originalCue) => {
                subtitleQueue.push({
                    original: originalCue.text,
                    translated: null,
                    start: originalCue.start,
                    end: originalCue.end,
                    videoId: currentVideoId,
                    useNativeTarget: useNativeTarget,
                    sourceLanguage: subtitleData.sourceLanguage || 'unknown',
                    targetLanguage: subtitleData.targetLanguage || null,
                    cueType: 'original',
                });
            });

            logWithFallback(
                'debug',
                'Native mode - Adding target cues with timing.',
                {
                    logPrefix,
                    cueCount: parsedTargetCues.length,
                    firstThreeCues: parsedTargetCues
                        .slice(0, 3)
                        .map(
                            (c) =>
                                `[${c.start.toFixed(2)}-${c.end.toFixed(2)}s]`
                        ),
                }
            );

            parsedTargetCues.forEach((targetCue) => {
                subtitleQueue.push({
                    original: null,
                    translated: targetCue.text,
                    start: targetCue.start,
                    end: targetCue.end,
                    videoId: currentVideoId,
                    useNativeTarget: useNativeTarget,
                    sourceLanguage: subtitleData.sourceLanguage || 'unknown',
                    targetLanguage: subtitleData.targetLanguage || null,
                    cueType: 'target',
                });
            });

            const originalTimings = parsedOriginalCues.map((c) => ({
                start: c.start,
                end: c.end,
            }));
            const targetTimings = parsedTargetCues.map((c) => ({
                start: c.start,
                end: c.end,
            }));

            const timingMismatches = originalTimings.filter(
                (orig) =>
                    !targetTimings.some(
                        (target) =>
                            Math.abs(target.start - orig.start) < 0.1 &&
                            Math.abs(target.end - orig.end) < 0.1
                    )
            );

            if (timingMismatches.length > 0) {
                logWithFallback(
                    'warn',
                    'Detected timing mismatches between original and target subtitles.',
                    {
                        logPrefix,
                        mismatchCount: timingMismatches.length,
                        firstFewMismatches: timingMismatches.slice(0, 3),
                    }
                );
            } else {
                logWithFallback(
                    'info',
                    'Original and target subtitle timings align perfectly.',
                    { logPrefix }
                );
            }

            // Trigger immediate subtitle display update for native target mode
            logWithFallback(
                'debug',
                'Triggering subtitle display update for native mode',
                {
                    logPrefix,
                    queueLength: subtitleQueue.length,
                }
            );

            // Get current video time and update display
            const videoElement = activePlatform?.getVideoElement?.();
            if (videoElement && !Number.isNaN(videoElement.currentTime)) {
                updateSubtitles(
                    videoElement.currentTime,
                    activePlatform,
                    config,
                    logPrefix
                );
            }
        } else {
            parsedOriginalCues.forEach((originalCue) => {
                subtitleQueue.push({
                    original: originalCue.text,
                    translated: null,
                    start: originalCue.start,
                    end: originalCue.end,
                    videoId: currentVideoId,
                    useNativeTarget: useNativeTarget,
                    sourceLanguage: subtitleData.sourceLanguage || 'unknown',
                    targetLanguage: subtitleData.targetLanguage || null,
                    cueType: 'original',
                });
            });
        }

        if (subtitleData.availableLanguages) {
            logWithFallback('info', 'Available subtitle languages.', {
                logPrefix,
                languages: subtitleData.availableLanguages.map(
                    (lang) => `${lang.normalizedCode} (${lang.displayName})`
                ),
            });
        }

        if (!useNativeTarget && parsedOriginalCues.length > 0) {
            processSubtitleQueue(activePlatform, config, logPrefix);
        }

        // Ensure subtitle display is updated regardless of mode
        logWithFallback('debug', 'Ensuring subtitle display is updated', {
            logPrefix,
            useNativeTarget,
            queueLength: subtitleQueue.length,
            subtitlesActive,
        });

        // Trigger immediate display update
        const videoElement = activePlatform?.getVideoElement?.();
        if (
            videoElement &&
            !Number.isNaN(videoElement.currentTime) &&
            subtitlesActive
        ) {
            updateSubtitles(
                videoElement.currentTime,
                activePlatform,
                config,
                logPrefix
            );
        }
    } else {
        logWithFallback('warn', 'VTT parsing yielded no cues for videoId.', {
            logPrefix,
            videoId: currentVideoId,
            vttUrl: subtitleData.url,
        });
    }
}

export function handleVideoIdChange(newVideoId, logPrefix = 'SubtitleUtils') {
    logWithFallback('info', 'Video context changing.', {
        logPrefix,
        from: currentVideoId || 'null',
        to: newVideoId,
    });
    if (originalSubtitleElement) originalSubtitleElement.innerHTML = '';
    if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';

    if (currentVideoId && currentVideoId !== newVideoId) {
        subtitleQueue = subtitleQueue.filter(
            (cue) => cue.videoId !== currentVideoId
        );
    }
    currentVideoId = newVideoId;
}

export async function processSubtitleQueue(
    activePlatform,
    config,
    logPrefix = 'SubtitleUtils'
) {
    if (processingQueue) return;
    if (!activePlatform || !subtitlesActive) return;

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) {
        // If video element is not ready, retry after a short delay
        setTimeout(
            () => processSubtitleQueue(activePlatform, config, logPrefix),
            200
        );
        return;
    }

    const platformVideoId = activePlatform.getCurrentVideoId();
    if (!platformVideoId) return;

    if (!progressBarObserver && findProgressBarIntervalId) {
        logWithFallback(
            'info',
            'Progress bar observer setup in progress. Deferring queue processing slightly.',
            { logPrefix }
        );
        setTimeout(
            () => processSubtitleQueue(activePlatform, config, logPrefix),
            200
        );
        return;
    }

    let timeSource = videoElement.currentTime;

    // Only use progress bar for platforms that support it
    if (activePlatform.supportsProgressBarTracking?.() !== false) {
        const sliderElement = activePlatform.getProgressBarElement();

        if (sliderElement && progressBarObserver) {
            const nowStr = sliderElement.getAttribute('aria-valuenow');
            const maxStr = sliderElement.getAttribute('aria-valuemax');

            if (nowStr && maxStr) {
                const valuenow = parseFloat(nowStr);
                const valuemax = parseFloat(maxStr);
                const { duration: videoDuration } = videoElement;

                if (
                    !Number.isNaN(valuenow) &&
                    !Number.isNaN(valuemax) &&
                    valuemax > 0
                ) {
                    timeSource =
                        !Number.isNaN(videoDuration) && videoDuration > 0
                            ? (valuenow / valuemax) * videoDuration
                            : valuenow;
                }
            }
        }
    }

    const currentTime = timeSource + config.subtitleTimeOffset;

    const cuesToProcess = subtitleQueue
        .filter(
            (cue) =>
                cue.videoId === platformVideoId &&
                cue.original &&
                !cue.translated &&
                !cue.useNativeTarget &&
                cue.end >= currentTime
        )
        .sort((a, b) => a.start - b.start)
        .slice(0, config.translationBatchSize);

    if (cuesToProcess.length === 0) return;

    processingQueue = true;

    try {
        for (const cueToProcess of cuesToProcess) {
            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        {
                            action: 'translate',
                            text: cueToProcess.original,
                            targetLang: config.targetLanguage,
                            cueStart: cueToProcess.start,
                            cueVideoId: cueToProcess.videoId,
                        },
                        (res) => {
                            if (chrome.runtime.lastError) {
                                const err = new Error(
                                    chrome.runtime.lastError.message
                                );
                                err.errorType = 'TRANSLATION_REQUEST_ERROR';
                                reject(err);
                            } else if (res?.error) {
                                const err = new Error(res.details || res.error);
                                err.errorType =
                                    res.errorType || 'TRANSLATION_API_ERROR';
                                reject(err);
                            } else if (
                                res?.translatedText !== undefined &&
                                res.cueStart !== undefined &&
                                res.cueVideoId !== undefined
                            ) {
                                resolve(res);
                            } else {
                                const err = new Error(
                                    `Malformed response from background for translation. Response: ${JSON.stringify(res)}`
                                );
                                err.errorType = 'TRANSLATION_REQUEST_ERROR';
                                reject(err);
                            }
                        }
                    );
                });

                const cueInMainQueue = subtitleQueue.find(
                    (c) =>
                        c.videoId === response.cueVideoId &&
                        c.start === response.cueStart &&
                        c.original === response.originalText
                );

                const currentContextVideoId =
                    activePlatform?.getCurrentVideoId();
                if (
                    cueInMainQueue &&
                    cueInMainQueue.videoId === currentContextVideoId
                ) {
                    cueInMainQueue.translated = response.translatedText;
                } else {
                    logWithFallback(
                        'warn',
                        'Could not find/match cue post-translation or context changed.',
                        {
                            logPrefix,
                            responseVideoId: response.cueVideoId,
                            cueStart: response.cueStart,
                            currentContextVideoId,
                        }
                    );
                }

                if (config.translationDelay > 0) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, config.translationDelay)
                    );
                }
            } catch (error) {
                logWithFallback('error', 'Translation failed for cue.', {
                    logPrefix,
                    videoId: cueToProcess.videoId,
                    start: cueToProcess.start.toFixed(2),
                    originalText: cueToProcess.original.substring(0, 30),
                    errorMessage: error.message,
                    errorType: error.errorType,
                });
                const cueInQueueOnError = subtitleQueue.find(
                    (c) =>
                        c.start === cueToProcess.start &&
                        c.original === cueToProcess.original &&
                        c.videoId === cueToProcess.videoId
                );
                if (cueInQueueOnError) {
                    const errorType =
                        error.errorType || 'TRANSLATION_GENERIC_ERROR';
                    cueInQueueOnError.translated = getLocalizedErrorMessage(
                        errorType,
                        error.message
                    );
                }
            }
        }
    } finally {
        processingQueue = false;
    }

    const currentContextVideoIdForNextCheck =
        activePlatform?.getCurrentVideoId();
    const moreRelevantCuesExist = subtitleQueue.some(
        (cue) =>
            cue.videoId === currentContextVideoIdForNextCheck &&
            cue.original &&
            !cue.translated &&
            cue.end >= currentTime
    );

    if (
        subtitlesActive &&
        currentContextVideoIdForNextCheck &&
        moreRelevantCuesExist
    ) {
        setTimeout(
            () => processSubtitleQueue(activePlatform, config, logPrefix),
            50
        );
    }
}
