/**
 * Provides shared utilities for dual subtitle functionality across all streaming platforms,
 * including DOM manipulation, subtitle parsing, styling, and state management.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

// Logger instance for subtitle utilities
let utilsLogger = null;

// Interactive subtitle functionality
let interactiveSubtitlesEnabled = false;
let interactiveModulesLoaded = false;

// Debounce mechanism for subtitle content change events
let contentChangeDebounceTimeout = null;
const CONTENT_CHANGE_DEBOUNCE_DELAY = 50; // 50ms debounce

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

/**
 * Dispatch subtitle content change event with debouncing to prevent rapid-fire events
 * @param {string} type - Subtitle type ('original' or 'translated')
 * @param {string} oldContent - Previous content
 * @param {string} newContent - New content
 * @param {HTMLElement} element - Subtitle element
 */
function dispatchContentChangeDebounced(type, oldContent, newContent, element) {
    if (contentChangeDebounceTimeout) {
        clearTimeout(contentChangeDebounceTimeout);
    }
    contentChangeDebounceTimeout = setTimeout(() => {
        document.dispatchEvent(new CustomEvent('dualsub-subtitle-content-changing', {
            detail: {
                type,
                oldContent,
                newContent,
                element
            }
        }));

        logWithFallback('debug', 'Debounced subtitle content change event dispatched', {
            type,
            oldContentLength: oldContent.length,
            newContentLength: newContent.length
        });
    }, CONTENT_CHANGE_DEBOUNCE_DELAY);
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

export let dualsubUiRoot = null;

initializeLogger();

/**
 * Creates or retrieves the main root container for all DualSub UI elements.
 * This container will be moved around the DOM to handle fullscreen transitions.
 * @returns {HTMLElement} The UI root container
 */
export function getOrCreateUiRoot() {
    if (dualsubUiRoot && document.body.contains(dualsubUiRoot)) {
        return dualsubUiRoot;
    }
    dualsubUiRoot = document.createElement('div');
    dualsubUiRoot.id = 'dualsub-ui-root';
    dualsubUiRoot.style.pointerEvents = 'none'; // Container should not intercept clicks
    dualsubUiRoot.style.position = 'fixed'; // Fixed positioning for consistent viewport reference
    dualsubUiRoot.style.top = '0';
    dualsubUiRoot.style.left = '0';
    dualsubUiRoot.style.width = '100%';
    dualsubUiRoot.style.height = '100%';
    dualsubUiRoot.style.zIndex = '9999'; // Above modal overlay (9998) but below modal content (10000)

    document.body.appendChild(dualsubUiRoot);
    return dualsubUiRoot;
}

/**
 * Updates subtitle container position based on platform and fullscreen state
 * @param {Object} activePlatform - The active platform instance
 */
export function updateSubtitlePosition(activePlatform) {
    if (!subtitleContainer) return;

    // Recalculate position based on current container parent
    const videoPlayerParent = activePlatform?.getPlayerContainerElement?.();
    if (videoPlayerParent && getComputedStyle(videoPlayerParent).position === 'static') {
        videoPlayerParent.style.position = 'relative';
    }

    logWithFallback('debug', 'Updated subtitle position for container transition');
}

/**
 * Initialize interactive subtitle functionality
 * @param {Object} config - Configuration options
 */
export async function initializeInteractiveSubtitleFeatures(config = {}) {
    if (interactiveModulesLoaded) {
        return;
    }

    try {
        // Get absolute URLs for interactive modules (legacy AI context modals removed)
        const formatterUrl = chrome.runtime.getURL('content_scripts/shared/interactiveSubtitleFormatter.js');
        const loadingUrl = chrome.runtime.getURL('content_scripts/shared/contextLoadingStates.js');

        // Dynamically import interactive modules (legacy AI context system removed)
        const [
            { initializeInteractiveSubtitles, formatInteractiveSubtitleText, attachInteractiveEventListeners, setInteractiveEnabled },
            { initializeLoadingStates }
        ] = await Promise.all([
            import(formatterUrl),
            import(loadingUrl)
        ]);

        // Initialize all interactive components with enabled state
        const interactiveConfig = {
            ...config,
            enabled: true, // Explicitly enable interactive features
            clickableWords: true,
            highlightOnHover: true
        };

        initializeInteractiveSubtitles(interactiveConfig);
        initializeLoadingStates(config.loadingStates || {});

        // Note: AI Context features are now handled by the new modular system
        // in content_scripts/aicontext/ and initialized by platform content scripts

        // Store references for later use
        window.dualsub_formatInteractiveSubtitleText = formatInteractiveSubtitleText;
        window.dualsub_attachInteractiveEventListeners = attachInteractiveEventListeners;
        window.dualsub_setInteractiveEnabled = setInteractiveEnabled;

        interactiveModulesLoaded = true;
        interactiveSubtitlesEnabled = true; // Always enable when modules are loaded

        logWithFallback('info', 'Interactive subtitle features initialized', {
            enabled: interactiveSubtitlesEnabled,
            config
        });

    } catch (error) {
        logWithFallback('error', 'Failed to initialize interactive subtitle features', {
            error: error.message,
            stack: error.stack,
            name: error.name,
            config: config
        });
        throw error; // Re-throw to help with debugging
    }
}

/**
 * Enable or disable interactive subtitle functionality
 * @param {boolean} enabled - Whether to enable interactive features
 */
export function setInteractiveSubtitlesEnabled(enabled) {
    interactiveSubtitlesEnabled = enabled;

    if (interactiveModulesLoaded && window.dualsub_setInteractiveEnabled) {
        window.dualsub_setInteractiveEnabled(enabled);
    }

    logWithFallback('info', 'Interactive subtitles toggled', { enabled });
}

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

export function formatSubtitleTextForDisplay(text, options = {}) {
    if (!text) return '';

    // Basic HTML escaping
    let formattedText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Add interactive elements if enabled and modules are loaded
    if (interactiveSubtitlesEnabled && interactiveModulesLoaded && window.dualsub_formatInteractiveSubtitleText) {
        try {
            const originalLength = formattedText.length;
            formattedText = window.dualsub_formatInteractiveSubtitleText(formattedText, options);
            const hasInteractiveSpans = formattedText.includes('dualsub-interactive-word');

            logWithFallback('debug', 'Interactive text formatting applied', {
                originalLength,
                formattedLength: formattedText.length,
                hasInteractiveSpans,
                subtitleType: options.subtitleType,
                sampleText: text.substring(0, 30),
                formattedSample: formattedText.substring(0, 100)
            });
        } catch (error) {
            logWithFallback('error', 'Failed to format interactive subtitle text', {
                error: error.message,
                stack: error.stack,
                text: text.substring(0, 50)
            });

        }
    } else {
        logWithFallback('debug', 'Interactive formatting skipped', {
            interactiveSubtitlesEnabled,
            interactiveModulesLoaded,
            formatFunctionAvailable: !!window.dualsub_formatInteractiveSubtitleText,
            subtitleType: options.subtitleType,
            text: text.substring(0, 30)
        });
    }

    return formattedText;
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
        // Preserve existing colors and background from platform-specific styling
        const existingColor = el.style.color;
        const existingBackground = el.style.backgroundColor;
        const existingTextShadow = el.style.textShadow;
        const existingBorderRadius = el.style.borderRadius;

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
            // Ensure interactive elements are clickable
            pointerEvents: 'auto',
            userSelect: 'text',
            cursor: 'default',
            zIndex: '10001' // Higher than modal to ensure clickability
        });

        // Force consistent margins with !important to override any external CSS
        el.style.setProperty('margin-bottom', '0', 'important');
        el.style.setProperty('margin-top', '0', 'important');

        // Restore platform-specific styling
        if (existingColor) el.style.color = existingColor;
        if (existingBackground) el.style.backgroundColor = existingBackground;
        if (existingTextShadow) el.style.textShadow = existingTextShadow;
        if (existingBorderRadius) el.style.borderRadius = existingBorderRadius;
    });

    // Inject CSS for interactive elements if not already present
    if (!document.getElementById('dualsub-interactive-css')) {
        const style = document.createElement('style');
        style.id = 'dualsub-interactive-css';
        style.textContent = `
            .dualsub-interactive-word {
                cursor: pointer !important;
                pointer-events: auto !important;
                user-select: none !important; /* Prevent text selection, allow only word clicking */
                display: inline !important;
                position: relative !important;
                z-index: 10001 !important; /* Higher than modal to ensure clickability */
                box-sizing: border-box !important; /* Ensure borders don't affect layout */
                margin: 0 !important; /* Remove any margins that might affect spacing */
                padding: 0 !important; /* Remove any padding that might affect spacing */
            }

            /* Prevent text selection on original subtitle containers */
            [id*="original"]:not([id*="translated"]) {
                user-select: none !important; /* Disable text selection on original subtitles */
                -webkit-user-select: none !important;
                -moz-user-select: none !important;
                -ms-user-select: none !important;
            }

            .dualsub-interactive-word:hover {
                background-color: rgba(255, 255, 0, 0.3) !important;
                border-radius: 2px !important;
            }

            .dualsub-interactive-word:active {
                background-color: rgba(255, 255, 0, 0.5) !important;
            }

            /* Selected word state - use outline instead of border to avoid layout impact */
            .dualsub-interactive-word.dualsub-word-selected {
                background-color: rgba(0, 123, 255, 0.3) !important;
                outline: 1px solid rgba(0, 123, 255, 0.6) !important;
                outline-offset: -1px !important; /* Keep outline inside the element */
                border-radius: 3px !important;
                box-shadow: 0 0 3px rgba(0, 123, 255, 0.4) !important;
            }

            /* Ensure translated subtitles are clearly non-interactive but maintain full brightness */
            [id*="translated"] .dualsub-interactive-word {
                cursor: default !important;
                pointer-events: none !important;
                /* Removed opacity reduction - translated subtitles should maintain full brightness */
            }

            /* Translated subtitles maintain full brightness - no opacity reduction */
            [id*="translated"] {
                /* Removed opacity reduction - translated subtitles should be fully visible */
            }
        `;
        document.head.appendChild(style);

        logWithFallback('debug', 'Interactive CSS injected', {});
    }

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
        // Ensure subtitle container is always in UI root for unified container system
        const uiRoot = getOrCreateUiRoot();
        if (subtitleContainer.parentElement !== uiRoot) {
            uiRoot.appendChild(subtitleContainer);
        }

        applySubtitleStyling(config);
        if (subtitlesActive) showSubtitleContainer();
        else hideSubtitleContainer();
        return true;
    }

    // Create unified subtitle container with universal IDs
    subtitleContainer = document.createElement('div');
    subtitleContainer.id = 'dualsub-subtitle-container';
    subtitleContainer.className = 'dualsub-subtitle-viewer-container';

    // Apply unified container styling
    Object.assign(subtitleContainer.style, {
        position: 'absolute',
        bottom: '10%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '9999',
        pointerEvents: 'none',
        width: '94%',
        maxWidth: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
    });

    // Create subtitle elements with universal IDs
    originalSubtitleElement = document.createElement('div');
    originalSubtitleElement.id = 'dualsub-original-subtitle';

    translatedSubtitleElement = document.createElement('div');
    translatedSubtitleElement.id = 'dualsub-translated-subtitle';

    Object.assign(originalSubtitleElement.style, {
        color: 'white',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        textShadow: '1px 1px 2px black, 0 0 3px black',
        borderRadius: '4px',
    });

    Object.assign(translatedSubtitleElement.style, {
        color: '#00FFFF',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        textShadow: '1px 1px 2px black, 0 0 3px black',
        borderRadius: '4px',
    });

    subtitleContainer.appendChild(originalSubtitleElement);
    subtitleContainer.appendChild(translatedSubtitleElement);

    // Append to UI root container for fullscreen compatibility
    const uiRoot = getOrCreateUiRoot();
    uiRoot.appendChild(subtitleContainer);

    // Update subtitle position based on platform
    updateSubtitlePosition(activePlatform);

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

        // Ensure interactive features are enabled BEFORE formatting text
        if (interactiveSubtitlesEnabled && interactiveModulesLoaded && window.dualsub_setInteractiveEnabled) {
            window.dualsub_setInteractiveEnabled(true);
            logWithFallback('debug', 'Interactive features enabled before text formatting', {
                logPrefix
            });
        }

        const originalTextFormatted =
            formatSubtitleTextForDisplay(originalText, {
                sourceLanguage: config.sourceLanguage || 'unknown',
                targetLanguage: config.targetLanguage || 'unknown',
                subtitleType: 'original'
            });
        const translatedTextFormatted =
            formatSubtitleTextForDisplay(translatedText, {
                sourceLanguage: config.sourceLanguage || 'unknown',
                targetLanguage: config.targetLanguage || 'unknown',
                subtitleType: 'translated'
            });

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
                    // Notify AI Context modal about subtitle content change (debounced)
                    dispatchContentChangeDebounced(
                        'original',
                        originalSubtitleElement.innerHTML,
                        originalTextFormatted,
                        originalSubtitleElement
                    );

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

            // Attach interactive event listeners if enabled
            if (interactiveSubtitlesEnabled && interactiveModulesLoaded && window.dualsub_attachInteractiveEventListeners) {
                try {
                    if (originalText.trim() && originalSubtitleElement.style.display !== 'none') {
                        window.dualsub_attachInteractiveEventListeners(originalSubtitleElement, {
                            sourceLanguage: config.sourceLanguage || 'unknown',
                            targetLanguage: config.targetLanguage || 'unknown',
                            subtitleType: 'original'
                        });

                        logWithFallback('debug', 'Interactive listeners attached to original subtitle only', {
                            originalElementId: originalSubtitleElement.id,
                            logPrefix
                        });
                    }
                } catch (error) {
                    logWithFallback('error', 'Failed to attach interactive event listeners', {
                        error: error.message,
                        stack: error.stack,
                        name: error.name,
                        logPrefix,
                        interactiveEnabled: interactiveSubtitlesEnabled,
                        modulesLoaded: interactiveModulesLoaded,
                        functionAvailable: !!window.dualsub_attachInteractiveEventListeners,
                        originalElementExists: !!originalSubtitleElement,
                        translatedElementExists: !!translatedSubtitleElement,
                        originalText: originalText?.substring(0, 50),
                        translatedText: translatedText?.substring(0, 50)
                    });
                }
            }
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

    if (originalSubtitleElement) originalSubtitleElement.innerHTML = '';
    if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';

    // Force garbage collection of any remaining maps/objects
    // This helps prevent memory leaks from large subtitle datasets
    if (typeof gc === 'function') {
        try {
            gc();
        } catch (e) {
            // Ignore errors
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
