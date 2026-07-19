/**
 * Provides shared utilities for dual subtitle functionality across all streaming platforms,
 * including DOM manipulation, subtitle parsing, styling, and state management.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import { COMMON_CONSTANTS } from '../core/constants.js';
import {
    normalizeCueLineEndings,
    normalizeCueText,
} from '../../utils/cueTextNormalizer.js';
import {
    isProvenMessagingNonDelivery,
    sendRuntimeMessageWithRetry,
} from './messaging.js';
import {
    buildTranslationRequestMessage,
    parseTranslationResponseMessage,
} from './protocol/messageProtocol.js';

// Logger instance for subtitle utilities
let utilsLogger = null;

// Interactive subtitle functionality
let interactiveSubtitlesEnabled = false;
let interactiveModulesLoaded = false;
let interactiveModuleApi = null;
let interactiveModuleLoadPromise = null;
let interactiveBindingIntentSequence = 0;
let newestInteractiveBindingIntent = null;
let installedInteractiveBindingIntent = null;
let activeSubtitleStatePublisherLifecycle = null;
let originalSubtitleState = null;
let latestOriginalRenderRevision = 0;

// Debounce mechanism for subtitle content change events
const contentChangeDebounceTimeouts = new Map();
const renderedSubtitleText = new WeakMap();
const CONTENT_CHANGE_DEBOUNCE_DELAY = 50; // 50ms debounce

// Bound each queue pass so future cues do not monopolize the content script.
// Cues are still sent as individual translation requests below.
const MAX_CUES_PER_QUEUE_PASS = 3;
const TRANSLATION_LOOKAHEAD_SECONDS = 30;
const TRANSLATION_LOOKBEHIND_SECONDS = 5;
const QUEUE_CONTINUATION_DELAY_MS = 50;
// The wrapper sends each translation once. The queue owns one later replay only
// when Chrome proves that no receiver accepted the first dispatch.
const MAX_CUE_NON_DELIVERY_ATTEMPTS = 2;
const CUE_NON_DELIVERY_RETRY_DELAY_MS = 500;

const TRANSLATION_REQUEST_ERROR_TYPE = 'TRANSLATION_REQUEST_ERROR';
const TRANSLATION_API_ERROR_TYPE = 'TRANSLATION_API_ERROR';

class CueTranslationError extends Error {
    constructor(message, errorType) {
        super(message);
        this.name = 'CueTranslationError';
        this.errorType = errorType;
    }
}

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
 * Resolve the current subtitle-timeline time through the platform clock, with
 * native HTML video time as a compatibility fallback for lightweight mocks and
 * adapters that predate getPlaybackTime().
 * @param {Object | null} activePlatform
 * @param {HTMLVideoElement | null} videoElement
 * @returns {number | null}
 */
export function resolvePlaybackTime(activePlatform, videoElement = null) {
    try {
        const platformTime = activePlatform?.getPlaybackTime?.(videoElement);
        if (Number.isFinite(platformTime)) return platformTime;
    } catch (_) {}

    let fallbackVideo = videoElement;
    if (!fallbackVideo) {
        try {
            fallbackVideo = activePlatform?.getVideoElement?.() || null;
        } catch (_) {
            fallbackVideo = null;
        }
    }

    const nativeTime = fallbackVideo?.currentTime;
    return Number.isFinite(nativeTime) ? nativeTime : null;
}

/**
 * Phase 2: Compute a normalized text signature to detect effective content changes
 * - Strips HTML
 * - Normalizes whitespace
 * - Normalizes common punctuation
 * @param {string} textOrHtml
 * @returns {string}
 */
export function computeTextSignature(textOrHtml) {
    if (!textOrHtml) return '';
    let s = String(textOrHtml);
    // Remove HTML tags
    s = s.replace(/<[^>]*>/g, ' ');
    // Decode basic entities
    s = s
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
    // Normalize punctuation to spaces
    // Replace punctuation and symbol characters with spaces using Unicode property escapes
    s = s.replace(/[\p{P}\p{S}]/gu, ' ');
    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

function shouldRenderSubtitleText(element, text, signature) {
    return (
        signature !== (element.dataset.textSig || '') ||
        text !== (renderedSubtitleText.get(element) || '') ||
        element.innerHTML === ''
    );
}

function storeRenderedSubtitleText(element, text, formattedText, signature) {
    element.innerHTML = formattedText;
    element.dataset.textSig = signature;
    renderedSubtitleText.set(element, text);
}

function clearRenderedSubtitleText(element) {
    element.innerHTML = '';
    element.dataset.textSig = '';
    renderedSubtitleText.delete(element);
}

/**
 * Begin one lifecycle-scoped subtitle state publisher capability.
 * @param {Object} options
 * @returns {() => void} Idempotent compare-and-swap cleanup.
 */
export function beginSubtitleStatePublisher({
    publishSubtitleState = null,
} = {}) {
    const lifecycle = {
        publishSubtitleState:
            typeof publishSubtitleState === 'function'
                ? publishSubtitleState
                : null,
        lastPublishedRevision: null,
    };
    activeSubtitleStatePublisherLifecycle = lifecycle;

    let cleaned = false;
    return () => {
        if (cleaned) return;
        cleaned = true;
        if (activeSubtitleStatePublisherLifecycle !== lifecycle) return;
        activeSubtitleStatePublisherLifecycle = null;
    };
}

function allocateOriginalRenderRevision() {
    if (latestOriginalRenderRevision >= Number.MAX_SAFE_INTEGER) return null;
    latestOriginalRenderRevision += 1;
    return latestOriginalRenderRevision;
}

function publishOriginalSubtitleState(state) {
    const lifecycle = activeSubtitleStatePublisherLifecycle;
    if (!lifecycle?.publishSubtitleState) return;

    const payload = Object.freeze({
        renderRevision: state.renderRevision,
        reason: state.reason,
        videoId: state.videoId,
        text: state.text,
    });
    lifecycle.lastPublishedRevision = state.renderRevision;
    try {
        lifecycle.publishSubtitleState(payload);
    } catch (_) {}
}

function captureOriginalInteractiveOccurrenceManifest(element, renderRevision) {
    try {
        const occurrences = Array.from(
            element.querySelectorAll(
                '.dualsub-interactive-word[data-subtitle-type="original"]'
            )
        );
        const manifest = [];
        for (let index = 0; index < occurrences.length; index += 1) {
            const wordElement = occurrences[index];
            const word = wordElement.getAttribute('data-word');
            const sourceLanguage = wordElement.getAttribute('data-source-lang');
            const targetLanguage = wordElement.getAttribute('data-target-lang');
            if (
                wordElement.parentElement !== element ||
                wordElement.getAttribute('data-render-revision') !==
                    String(renderRevision) ||
                wordElement.getAttribute('data-word-index') !== String(index) ||
                typeof word !== 'string' ||
                word.length === 0 ||
                word !== word.trim() ||
                wordElement.textContent !== word ||
                typeof sourceLanguage !== 'string' ||
                sourceLanguage.length === 0 ||
                typeof targetLanguage !== 'string' ||
                targetLanguage.length === 0
            ) {
                return null;
            }
            manifest.push(
                Object.freeze({
                    element: wordElement,
                    renderRevision,
                    wordIndex: index,
                    word,
                    sourceLanguage,
                    targetLanguage,
                })
            );
        }
        return Object.freeze(manifest);
    } catch (_) {
        return null;
    }
}

function isOriginalInteractiveOccurrenceCurrent(container, occurrence, index) {
    try {
        return Boolean(
            occurrence?.element?.parentElement === container &&
            occurrence.renderRevision > 0 &&
            occurrence.wordIndex === index &&
            occurrence.element.getAttribute('data-render-revision') ===
                String(occurrence.renderRevision) &&
            occurrence.element.getAttribute('data-word-index') ===
                String(index) &&
            occurrence.element.getAttribute('data-word') === occurrence.word &&
            occurrence.element.textContent === occurrence.word &&
            occurrence.element.getAttribute('data-source-lang') ===
                occurrence.sourceLanguage &&
            occurrence.element.getAttribute('data-target-lang') ===
                occurrence.targetLanguage
        );
    } catch (_) {
        return false;
    }
}

function isOriginalSubtitleDomStampCurrent(element, state) {
    try {
        if (
            !element ||
            !state ||
            element !== document.getElementById('dualsub-original-subtitle') ||
            element.getAttribute('data-render-revision') !==
                String(state.renderRevision)
        ) {
            return false;
        }

        const occurrences = Array.from(
            element.querySelectorAll(
                '.dualsub-interactive-word[data-subtitle-type="original"]'
            )
        );
        if (
            state.formattingMode === 'interactive' &&
            (occurrences.length !== state.interactiveOccurrenceCount ||
                occurrences.some((wordElement, index) => {
                    const occurrence =
                        state.interactiveOccurrenceManifest?.[index];
                    return (
                        wordElement !== occurrence?.element ||
                        !isOriginalInteractiveOccurrenceCurrent(
                            element,
                            occurrence,
                            index
                        )
                    );
                }))
        ) {
            return false;
        }

        return occurrences.every(
            (word) =>
                word.getAttribute('data-render-revision') ===
                String(state.renderRevision)
        );
    } catch (_) {
        return false;
    }
}

function isOriginalSubtitleStampCurrent(element, state) {
    try {
        if (!isOriginalSubtitleDomStampCurrent(element, state)) return false;

        const lifecycle = activeSubtitleStatePublisherLifecycle;
        if (
            lifecycle?.publishSubtitleState &&
            lifecycle.lastPublishedRevision !== state.renderRevision
        ) {
            return false;
        }
        return true;
    } catch (_) {
        return false;
    }
}

function getOriginalSubtitleFormattingMode() {
    return interactiveSubtitlesEnabled &&
        interactiveModulesLoaded &&
        typeof window.dualsub_formatInteractiveSubtitleText === 'function'
        ? 'interactive'
        : 'plain';
}

function shouldCommitOriginalSubtitleState(element, videoId, text) {
    return (
        !originalSubtitleState ||
        originalSubtitleState.videoId !== videoId ||
        originalSubtitleState.text !== text ||
        originalSubtitleState.formattingMode !==
            getOriginalSubtitleFormattingMode() ||
        !isOriginalSubtitleStampCurrent(element, originalSubtitleState)
    );
}

function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x7f) bytes += 1;
        else if (codeUnit <= 0x7ff) bytes += 2;
        else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            bytes += 4;
            index += 1;
        } else bytes += 3;
    }
    return bytes;
}

function isWellFormedBoundedString(value, maximumBytes) {
    return (
        typeof value === 'string' &&
        value.isWellFormed() &&
        utf8ByteLength(value) <= maximumBytes
    );
}

function normalizeSubtitleStateVideoId(videoId) {
    return isWellFormedBoundedString(videoId, 256) &&
        videoId.length > 0 &&
        videoId === videoId.trim()
        ? videoId
        : null;
}

function hasOriginalRevisionStamp(element) {
    try {
        return Boolean(
            element?.hasAttribute('data-render-revision') ||
            element?.querySelector(
                '.dualsub-interactive-word[data-subtitle-type="original"][data-render-revision]'
            )
        );
    } catch (_) {
        return true;
    }
}

function removeOriginalRevisionStamps(element) {
    if (!element) return;
    element.removeAttribute('data-render-revision');
    element
        .querySelectorAll(
            '.dualsub-interactive-word[data-subtitle-type="original"][data-render-revision]'
        )
        .forEach((word) => word.removeAttribute('data-render-revision'));
}

function commitOriginalSubtitleState({
    element,
    videoId,
    text,
    formatOptions = null,
    signature = '',
    emptyReason = 'clear',
}) {
    const normalizedVideoId = normalizeSubtitleStateVideoId(videoId);
    const oldContent = element?.innerHTML || '';
    const formattingMode = getOriginalSubtitleFormattingMode();
    const hasPublicText = typeof text === 'string' && text.length > 0;
    const isValidRender =
        hasPublicText &&
        normalizedVideoId !== null &&
        isWellFormedBoundedString(text, 4096);

    if (hasPublicText && !isValidRender) {
        const hasPrivateState =
            originalSubtitleState?.videoId || originalSubtitleState?.text;
        const hadPrivateAuthority =
            Boolean(hasPrivateState) || hasOriginalRevisionStamp(element);
        let accepted = false;
        if (hadPrivateAuthority) {
            const renderRevision = allocateOriginalRenderRevision();
            if (renderRevision !== null) {
                originalSubtitleState = {
                    renderRevision,
                    videoId: null,
                    text: '',
                };
                publishOriginalSubtitleState({
                    renderRevision,
                    reason: 'clear',
                    videoId: null,
                    text: '',
                });
                accepted = true;
            } else {
                originalSubtitleState = null;
            }
        }

        const domChanged =
            element && shouldRenderSubtitleText(element, text, signature);
        let formattedText = oldContent;
        if (domChanged) {
            formattedText = formatSubtitleTextForDisplay(text, {
                ...formatOptions,
                subtitleType: 'original',
            });
            storeRenderedSubtitleText(element, text, formattedText, signature);
        }
        removeOriginalRevisionStamps(element);
        return { accepted, domChanged, formattedText, oldContent };
    }

    if (isValidRender) {
        const isRefresh =
            originalSubtitleState?.videoId === normalizedVideoId &&
            originalSubtitleState.text === text;
        if (
            isRefresh &&
            originalSubtitleState.formattingMode === formattingMode &&
            isOriginalSubtitleStampCurrent(element, originalSubtitleState)
        ) {
            return { accepted: false, domChanged: false };
        }

        const renderRevision = allocateOriginalRenderRevision();
        if (renderRevision === null) {
            originalSubtitleState = null;
            const formattedText = formatSubtitleTextForDisplay(text, {
                ...formatOptions,
                subtitleType: 'original',
            });
            storeRenderedSubtitleText(element, text, formattedText, signature);
            removeOriginalRevisionStamps(element);
            return {
                accepted: false,
                domChanged: true,
                formattedText,
                oldContent,
            };
        }

        const formattedText = formatSubtitleTextForDisplay(text, {
            ...formatOptions,
            subtitleType: 'original',
            renderRevision,
        });
        storeRenderedSubtitleText(element, text, formattedText, signature);
        element.setAttribute('data-render-revision', String(renderRevision));
        const interactiveOccurrences = Array.from(
            element.querySelectorAll(
                '.dualsub-interactive-word[data-subtitle-type="original"]'
            )
        );
        interactiveOccurrences.forEach((word) =>
            word.setAttribute('data-render-revision', String(renderRevision))
        );
        const interactiveOccurrenceManifest =
            captureOriginalInteractiveOccurrenceManifest(
                element,
                renderRevision
            );
        originalSubtitleState = {
            renderRevision,
            videoId: normalizedVideoId,
            text,
            formattingMode,
            formatOptions,
            interactiveOccurrenceCount: interactiveOccurrences.length,
            interactiveOccurrenceManifest,
        };
        publishOriginalSubtitleState({
            renderRevision,
            reason: isRefresh ? 'refresh' : 'render',
            videoId: normalizedVideoId,
            text,
        });
        return {
            accepted: true,
            domChanged: true,
            formattedText,
            oldContent,
        };
    }

    const reason =
        emptyReason === 'expired' && normalizedVideoId !== null
            ? 'expired'
            : 'clear';
    const committedVideoId = reason === 'clear' ? null : normalizedVideoId;
    const privateStampPresent = hasOriginalRevisionStamp(element);
    const accepted = Boolean(
        !originalSubtitleState ||
        originalSubtitleState.videoId !== committedVideoId ||
        originalSubtitleState.text !== '' ||
        privateStampPresent
    );
    const domChanged = Boolean(
        oldContent || element?.dataset.textSig || privateStampPresent
    );

    if (accepted) {
        const renderRevision = allocateOriginalRenderRevision();
        if (renderRevision !== null) {
            originalSubtitleState = {
                renderRevision,
                videoId: committedVideoId,
                text: '',
            };
            publishOriginalSubtitleState({
                renderRevision,
                reason,
                videoId: committedVideoId,
                text: '',
            });
        } else {
            originalSubtitleState = null;
        }
    }
    if (element) clearRenderedSubtitleText(element);
    removeOriginalRevisionStamps(element);
    return { accepted, domChanged, formattedText: '', oldContent };
}

function reconcileCurrentOriginalSubtitleFormatting() {
    const state = originalSubtitleState;
    const element = document.getElementById('dualsub-original-subtitle');
    if (!state?.text || !element) return false;
    if (
        element.getAttribute('data-render-revision') !==
        String(state.renderRevision)
    ) {
        return false;
    }
    if (
        state.formattingMode === getOriginalSubtitleFormattingMode() &&
        isOriginalSubtitleDomStampCurrent(element, state)
    ) {
        return false;
    }

    const commit = commitOriginalSubtitleState({
        element,
        videoId: state.videoId,
        text: state.text,
        formatOptions: state.formatOptions,
        signature: computeTextSignature(state.text),
    });
    return commit.accepted || commit.domChanged;
}

function getCurrentOriginalInteractiveBinding() {
    const state = originalSubtitleState;
    const element = document.getElementById('dualsub-original-subtitle');
    if (
        !state?.text ||
        state.formattingMode !== 'interactive' ||
        element?.style.display === 'none' ||
        !isOriginalSubtitleStampCurrent(element, state)
    ) {
        return null;
    }

    const occurrences = element.querySelectorAll(
        '.dualsub-interactive-word[data-subtitle-type="original"]'
    );
    if (occurrences.length === 0) return null;

    return Object.freeze({
        element,
        renderRevision: state.renderRevision,
        formatOptions: state.formatOptions,
        occurrences: state.interactiveOccurrenceManifest,
    });
}

function dispatchContentChange(
    type,
    oldContent,
    newContent,
    element,
    { immediate = false } = {}
) {
    try {
        const oldSig = computeTextSignature(oldContent || '');
        const newSig = computeTextSignature(newContent || '');
        if (!immediate && oldSig === newSig) {
            return;
        }

        const existingTimeout = contentChangeDebounceTimeouts.get(element);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            contentChangeDebounceTimeouts.delete(element);
        }

        const dispatch = () => {
            document.dispatchEvent(
                new CustomEvent('dualsub-subtitle-content-changing', {
                    detail: {
                        type,
                        oldContent,
                        newContent,
                        element,
                    },
                })
            );

            logWithFallback(
                'debug',
                `${immediate ? 'Immediate' : 'Debounced'} subtitle content change dispatched`,
                {
                    type,
                    oldContentLength: oldContent.length,
                    newContentLength: newContent.length,
                }
            );
        };

        if (immediate) {
            dispatch();
            return;
        }

        const timeoutId = setTimeout(() => {
            dispatch();
            contentChangeDebounceTimeouts.delete(element);
        }, CONTENT_CHANGE_DEBOUNCE_DELAY);

        contentChangeDebounceTimeouts.set(element, timeoutId);
    } catch (_) {}
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
                { errorType: error?.name || 'UnknownError' }
            );
        }
    } catch (error) {
        logWithFallback('error', 'Failed to initialize logger', {
            errorType: error?.name || 'UnknownError',
        });
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
    // If it already exists and is in the DOM (either body or documentElement), reuse it
    if (
        dualsubUiRoot &&
        ((document.body && document.body.contains(dualsubUiRoot)) ||
            document.documentElement.contains(dualsubUiRoot))
    ) {
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

    // Fallback parent if body is not yet available (document_start timing)
    const parentNode = document.body || document.documentElement;
    parentNode.appendChild(dualsubUiRoot);

    // If we appended to <html> because <body> didn't exist yet, move to body when available
    if (!document.body) {
        const moveToBody = () => {
            if (
                document.body &&
                dualsubUiRoot.parentElement !== document.body
            ) {
                document.body.appendChild(dualsubUiRoot);
            }
            document.removeEventListener('DOMContentLoaded', moveToBody);
        };
        document.addEventListener('DOMContentLoaded', moveToBody);
    }

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
    if (
        videoPlayerParent &&
        getComputedStyle(videoPlayerParent).position === 'static'
    ) {
        videoPlayerParent.style.position = 'relative';
    }

    logWithFallback(
        'debug',
        'Updated subtitle position for container transition'
    );
}

async function loadInteractiveModuleApi() {
    if (interactiveModuleApi) return interactiveModuleApi;

    if (!interactiveModuleLoadPromise) {
        const formatterUrl = chrome.runtime.getURL(
            'content_scripts/shared/interactiveSubtitleFormatter.js'
        );
        interactiveModuleLoadPromise = import(formatterUrl).then(
            (moduleApi) => {
                interactiveModuleApi = moduleApi;
                return moduleApi;
            },
            (error) => {
                interactiveModuleLoadPromise = null;
                throw error;
            }
        );
    }

    return interactiveModuleLoadPromise;
}

function isInteractiveBindingIntentCurrent(intent) {
    if (newestInteractiveBindingIntent !== intent) return false;
    try {
        return intent.isCurrent();
    } catch {
        return false;
    }
}

function releaseInteractiveBindingIntent(intent) {
    if (newestInteractiveBindingIntent === intent) {
        newestInteractiveBindingIntent = null;
    }
    if (installedInteractiveBindingIntent === intent) {
        installedInteractiveBindingIntent = null;
    }
}

/**
 * Resolve one current formatter-registered original occurrence for an
 * already-authorized selection/removal command.
 * @param {Object | null} intent
 * @returns {HTMLElement | null}
 */
export function resolveInteractiveOriginalWordOccurrence(intent) {
    if (
        !newestInteractiveBindingIntent ||
        installedInteractiveBindingIntent !== newestInteractiveBindingIntent ||
        !isInteractiveBindingIntentCurrent(newestInteractiveBindingIntent)
    ) {
        return null;
    }
    const resolver =
        interactiveModuleApi?.resolveInteractiveOriginalWordOccurrence;
    if (typeof resolver !== 'function') return null;
    try {
        return resolver(intent);
    } catch (_) {
        return null;
    }
}

/**
 * Initialize interactive subtitle functionality
 * @param {Object} config - Configuration options
 * @param {Function} isCurrent - Whether the captured owner is still current.
 * @param {Function | null} publishWordIntent - Private word-intent capability.
 * @returns {Promise<() => void>} Lifecycle-scoped binding cleanup.
 */
export async function initializeInteractiveSubtitleFeatures(
    config = {},
    isCurrent = () => true,
    publishWordIntent = null
) {
    const intent = Object.freeze({
        sequence: ++interactiveBindingIntentSequence,
        isCurrent: typeof isCurrent === 'function' ? isCurrent : () => false,
    });
    newestInteractiveBindingIntent = intent;

    let lifecycleCleanup = () => {};
    try {
        const moduleApi = await loadInteractiveModuleApi();
        if (!isInteractiveBindingIntentCurrent(intent)) {
            releaseInteractiveBindingIntent(intent);
            return () => {};
        }

        const {
            initializeInteractiveSubtitles,
            formatInteractiveSubtitleText,
            attachInteractiveEventListeners,
            setInteractiveEnabled,
            beginInteractiveLifecycle,
        } = moduleApi;

        // Initialize all interactive components with enabled state
        const interactiveConfig = {
            ...config,
            enabled: true, // Explicitly enable interactive features
            clickableWords: true,
            highlightOnHover: true,
        };

        initializeInteractiveSubtitles(interactiveConfig);

        // Note: AI Context features are now handled by the new modular system
        // in content_scripts/aicontext/ and initialized by platform content scripts

        // Store references for later use
        window.dualsub_formatInteractiveSubtitleText =
            formatInteractiveSubtitleText;
        window.dualsub_attachInteractiveEventListeners =
            attachInteractiveEventListeners;
        window.dualsub_setInteractiveEnabled = setInteractiveEnabled;

        const resolveOriginalWordBindingSnapshot = (element) => {
            if (!isInteractiveBindingIntentCurrent(intent)) return null;
            const binding = getCurrentOriginalInteractiveBinding();
            return binding?.element === element ? binding : null;
        };
        const lifecyclePublisher =
            typeof publishWordIntent === 'function'
                ? (wordIntent) => {
                      if (
                          installedInteractiveBindingIntent !== intent ||
                          !isInteractiveBindingIntentCurrent(intent)
                      ) {
                          return;
                      }
                      publishWordIntent(wordIntent);
                  }
                : null;

        installedInteractiveBindingIntent = null;
        lifecycleCleanup =
            typeof beginInteractiveLifecycle === 'function'
                ? beginInteractiveLifecycle({
                      publishWordIntent: lifecyclePublisher,
                      resolveOriginalWordBindingSnapshot,
                  })
                : () => {};
        if (!isInteractiveBindingIntentCurrent(intent)) {
            lifecycleCleanup();
            releaseInteractiveBindingIntent(intent);
            return () => {};
        }

        interactiveModulesLoaded = true;
        interactiveSubtitlesEnabled = true; // Always enable when modules are loaded
        reconcileCurrentOriginalSubtitleFormatting();
        if (!isInteractiveBindingIntentCurrent(intent)) {
            lifecycleCleanup();
            releaseInteractiveBindingIntent(intent);
            return () => {};
        }

        const currentBinding = getCurrentOriginalInteractiveBinding();
        if (currentBinding) {
            const attached = attachInteractiveEventListeners(
                currentBinding.element,
                currentBinding.formatOptions || {}
            );
            const attachedBinding = getCurrentOriginalInteractiveBinding();
            if (
                attached !== true ||
                !isInteractiveBindingIntentCurrent(intent) ||
                attachedBinding?.element !== currentBinding.element ||
                attachedBinding.renderRevision !==
                    currentBinding.renderRevision ||
                currentBinding.element.getAttribute(
                    'data-interactive-listeners'
                ) !== 'true'
            ) {
                lifecycleCleanup();
                releaseInteractiveBindingIntent(intent);
                return () => {};
            }
        }
        installedInteractiveBindingIntent = intent;

        logWithFallback('info', 'Interactive subtitle features initialized', {
            enabled: interactiveSubtitlesEnabled,
            aiContextEnabled: !!config.aiContextEnabled,
            sourceLanguage: config.sourceLanguage || 'unknown',
            targetLanguage: config.targetLanguage || 'unknown',
        });

        let cleaned = false;
        return () => {
            if (cleaned) return;
            cleaned = true;
            lifecycleCleanup();
            releaseInteractiveBindingIntent(intent);
        };
    } catch (error) {
        lifecycleCleanup();
        releaseInteractiveBindingIntent(intent);
        logWithFallback(
            'error',
            'Failed to initialize interactive subtitle features',
            {
                errorType: error?.name || 'UnknownError',
                aiContextEnabled: !!config.aiContextEnabled,
            }
        );
        throw error; // Re-throw to help with debugging
    }
}

/**
 * Enable or disable interactive subtitle functionality
 * @param {boolean} enabled - Whether to enable interactive features
 */
export function setInteractiveSubtitlesEnabled(enabled) {
    interactiveSubtitlesEnabled = enabled;

    if (
        !enabled &&
        newestInteractiveBindingIntent !== installedInteractiveBindingIntent
    ) {
        newestInteractiveBindingIntent = null;
    } else if (
        enabled &&
        !newestInteractiveBindingIntent &&
        installedInteractiveBindingIntent
    ) {
        try {
            if (installedInteractiveBindingIntent.isCurrent()) {
                newestInteractiveBindingIntent =
                    installedInteractiveBindingIntent;
            }
        } catch (_) {}
    }

    if (interactiveModulesLoaded && window.dualsub_setInteractiveEnabled) {
        window.dualsub_setInteractiveEnabled(enabled);
    }

    if (
        enabled &&
        newestInteractiveBindingIntent &&
        installedInteractiveBindingIntent === newestInteractiveBindingIntent &&
        isInteractiveBindingIntentCurrent(newestInteractiveBindingIntent)
    ) {
        reconcileCurrentOriginalSubtitleFormatting();
        const currentBinding = getCurrentOriginalInteractiveBinding();
        if (
            currentBinding &&
            currentBinding.element.getAttribute(
                'data-interactive-listeners'
            ) !== 'true'
        ) {
            window.dualsub_attachInteractiveEventListeners?.(
                currentBinding.element,
                currentBinding.formatOptions || {}
            );
        }
    }

    logWithFallback('info', 'Interactive subtitles toggled', { enabled });
}

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

export function getLocalizedErrorMessage(errorTypeKey) {
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
let queueRerunRequested = false;
let queueRerunContext = null;
let queueProcessingTimeoutId = null;
let queueProcessingTimeoutDelay = null;
let subtitleContextGeneration = 0;

function cancelScheduledQueueProcessing() {
    if (queueProcessingTimeoutId !== null) {
        clearTimeout(queueProcessingTimeoutId);
        queueProcessingTimeoutId = null;
        queueProcessingTimeoutDelay = null;
    }
}

function clearCueTranslationRetryState() {
    for (const cue of subtitleQueue) {
        delete cue.translationAttempts;
        delete cue.translationRetryAt;
    }
}

function invalidateSubtitleContext() {
    subtitleContextGeneration++;
    invalidateFramePresentationScan();
    queueRerunRequested = false;
    queueRerunContext = null;
    cancelScheduledQueueProcessing();
    clearCueTranslationRetryState();
}

// Guard against transient blanks during style changes and platform ID timing
let lastStyleApplicationTs = 0;
let lastDisplayedCueWindow = { start: null, end: null, videoId: null };

// Video tracking state
export let timeUpdateListener = null;
let timeUpdateVideoElement = null;
let timeUpdatePlatform = null;
let timeUpdateConfig = null;
let videoFrameCallbackId = null;
let videoFrameCallbackOwner = null;
let framePresentationScan = null;
export let progressBarObserver = null;
export let lastProgressBarTime = -1;
export let lastProgressBarUpdateTs = 0;
export let findProgressBarIntervalId = null;
export let findProgressBarRetries = 0;
export const { MAX_FIND_PROGRESS_BAR_RETRIES } = COMMON_CONSTANTS;

export let lastLoggedTimeSec = -1;
export let timeUpdateLogCounter = 0;
export const TIME_UPDATE_LOG_INTERVAL = 30;

const FRAME_PRESENTATION_STYLE_GRACE_MS = 800;

function invalidateFramePresentationScan() {
    framePresentationScan = null;
}

function shouldUpdateSubtitlesForFrame(owner, rawCurrentTime) {
    const scan = framePresentationScan;
    const subtitleTimeOffset = owner.config.subtitleTimeOffset;
    const currentTime = rawCurrentTime + subtitleTimeOffset;
    const platformVideoId = owner.activePlatform.getCurrentVideoId();
    const currentHref =
        typeof window !== 'undefined' && window.location
            ? window.location.href
            : lastKnownLocationHref;

    if (
        !scan ||
        scan.activePlatform !== owner.activePlatform ||
        scan.config !== owner.config ||
        scan.videoElement !== owner.videoElement ||
        scan.platformVideoId !== platformVideoId ||
        scan.subtitleTimeOffset !== subtitleTimeOffset ||
        scan.subtitleContextGeneration !== subtitleContextGeneration ||
        scan.subtitleQueue !== subtitleQueue ||
        scan.subtitleQueueLength !== subtitleQueue.length ||
        scan.firstCue !== (subtitleQueue[0] || null) ||
        scan.lastCue !== (subtitleQueue[subtitleQueue.length - 1] || null) ||
        scan.subtitleContainer !== subtitleContainer ||
        !subtitleContainer ||
        !document.body.contains(subtitleContainer) ||
        scan.locationHref !== currentHref ||
        currentTime < scan.evaluatedTime
    ) {
        return true;
    }

    if (
        scan.nextWallClockEvaluation !== null &&
        Date.now() >= scan.nextWallClockEvaluation
    ) {
        return true;
    }

    if (scan.nextBoundaryTime === null) return false;
    return scan.nextBoundaryInclusive
        ? currentTime >= scan.nextBoundaryTime
        : currentTime > scan.nextBoundaryTime;
}

function scheduleSubtitleQueueProcessing(
    activePlatform,
    config,
    logPrefix,
    delay = 0
) {
    if (!activePlatform || !config || !subtitlesActive) return;

    const scheduledGeneration = subtitleContextGeneration;
    let scheduledVideoId;
    try {
        scheduledVideoId = activePlatform.getCurrentVideoId?.();
    } catch (_) {
        return;
    }
    const scheduledCues = subtitleQueue.filter(
        (cue) => cue.videoId === scheduledVideoId
    );
    if (!scheduledVideoId || scheduledCues.length === 0) return;

    if (processingQueue) {
        queueRerunRequested = true;
        queueRerunContext = {
            activePlatform,
            config,
            logPrefix,
            generation: subtitleContextGeneration,
        };
        return;
    }

    if (queueProcessingTimeoutId !== null) {
        // A seek should preempt a lower-priority continuation delay.
        if (delay !== 0 || queueProcessingTimeoutDelay === 0) return;
        clearTimeout(queueProcessingTimeoutId);
    }

    queueProcessingTimeoutDelay = delay;
    queueProcessingTimeoutId = setTimeout(() => {
        queueProcessingTimeoutId = null;
        queueProcessingTimeoutDelay = null;

        let activeVideoId;
        try {
            activeVideoId = activePlatform.getCurrentVideoId?.();
        } catch (_) {
            return;
        }
        const scheduledContextIsCurrent =
            subtitlesActive &&
            scheduledGeneration === subtitleContextGeneration &&
            activeVideoId === scheduledVideoId &&
            scheduledCues.some(
                (cue) =>
                    cue.videoId === scheduledVideoId &&
                    subtitleQueue.includes(cue)
            );
        if (!scheduledContextIsCurrent) return;

        void processSubtitleQueue(activePlatform, config, logPrefix);
    }, delay);
}

// Navigation guarding to prevent stale subtitles during soft navigations
let lastKnownLocationHref =
    typeof window !== 'undefined' && window.location
        ? window.location.href
        : '';
let navigationGuardActive = false;
let navigationGuardFromVideoId = null;
let lastRenderedVideoId = null;

// State setters (only for core state, not user preferences)
export function setCurrentVideoId(id) {
    if (currentVideoId !== id) invalidateFramePresentationScan();
    currentVideoId = id;
}

export function setSubtitlesActive(active) {
    if (subtitlesActive !== active) invalidateSubtitleContext();
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
    if (
        interactiveSubtitlesEnabled &&
        interactiveModulesLoaded &&
        window.dualsub_formatInteractiveSubtitleText
    ) {
        try {
            const originalLength = text.length;
            formattedText = window.dualsub_formatInteractiveSubtitleText(
                text,
                options
            );
            const hasInteractiveSpans = formattedText.includes(
                'dualsub-interactive-word'
            );

            logWithFallback('debug', 'Interactive text formatting applied', {
                originalLength,
                formattedLength: formattedText.length,
                hasInteractiveSpans,
                subtitleType: options.subtitleType,
            });
        } catch (error) {
            logWithFallback(
                'error',
                'Failed to format interactive subtitle text',
                {
                    errorType: error?.name || 'UnknownError',
                    textLength: text.length,
                }
            );
        }
    } else {
        logWithFallback('debug', 'Interactive formatting skipped', {
            interactiveSubtitlesEnabled,
            interactiveModulesLoaded,
            formatFunctionAvailable:
                !!window.dualsub_formatInteractiveSubtitleText,
            subtitleType: options.subtitleType,
            textLength: text.length,
        });
    }

    return formattedText;
}

export function parseVTT(vttString) {
    const normalizedVtt =
        typeof vttString === 'string' ? normalizeCueLineEndings(vttString) : '';
    if (
        !normalizedVtt ||
        !normalizedVtt.trim().toUpperCase().startsWith('WEBVTT')
    ) {
        logWithFallback(
            'warn',
            'Invalid or empty VTT string provided for parsing.'
        );
        return [];
    }
    const cues = [];
    const cueBlocks = normalizedVtt
        .split(/\n{2,}/)
        .filter((block) => block.trim() !== '');

    for (const block of cueBlocks) {
        if (!block.includes('-->')) {
            continue;
        }

        const lines = block.split('\n');
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

        const timeParts = timestampLine.trim().split(/[ \t]+-->[ \t]+/);
        if (timeParts.length !== 2) continue;

        const startTimeStr = timeParts[0];
        const [endTimeStr] = timeParts[1].split(/[ \t]+/);

        const start = parseTimestampToSeconds(startTimeStr);
        const end = parseTimestampToSeconds(endTimeStr);

        const decodedText = normalizeCueText(textLines.join('\n'), 'webvtt');

        if (
            decodedText &&
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            end > start
        ) {
            cues.push({ start, end, text: decodedText });
        }
    }
    return cues;
}

/**
 * Parse the WebVTT timestamp forms accepted at the cue boundary.
 * @param {string} timestamp
 * @returns {number | null} Seconds, or null when the timestamp is invalid.
 */
export function parseTimestampToSeconds(timestamp) {
    if (typeof timestamp !== 'string') return null;
    const match = timestamp.match(/^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/);
    if (!match) return null;

    const hours = match[1] === undefined ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number(match[4]);
    if (minutes >= 60 || seconds >= 60) return null;

    const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    return Number.isFinite(total) ? total : null;
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
            commitOriginalSubtitleState({
                element: originalSubtitleElement,
                videoId: null,
                text: '',
                emptyReason: 'clear',
            });
            originalSubtitleElement.style.display = 'none';
        }
        if (translatedSubtitleElement) {
            translatedSubtitleElement.innerHTML = '';
            translatedSubtitleElement.style.display = 'none';
        }
    }
}

export function applySubtitleStyling(config) {
    // Mark time to provide a short grace period where we avoid clearing text
    lastStyleApplicationTs = Date.now();
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
            whiteSpace: 'pre-line',
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
            zIndex: '10001', // Higher than modal to ensure clickability
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
                z-index: 10002 !important; /* Above modal content and overlay to ensure clickability */
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
                pointer-events: auto !important; /* Ensure container remains interactive */
                z-index: 10002 !important; /* Keep above modal overlay */
                position: relative !important; /* Create stacking context for z-index */
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

    // This calculation correctly handles the intended config range of 0.1 to 9.9.
    const rawPosition = config.subtitleVerticalPosition || 2.8;

    // Clamp the input to the expected 0.1 to 9.9 range for safety.
    const verticalPosition = Math.max(0.1, Math.min(9.9, rawPosition));

    // Normalize the 0.1-9.9 range to a 0.0-1.0 scale using the formula:
    // (value - min) / (max - min)
    const normalizedPosition = (verticalPosition - 0.1) / (9.9 - 0.1);

    // Map the normalized 0.0-1.0 scale to the desired 5%-50% CSS 'bottom' range.
    const bottomPercentage = 5 + normalizedPosition * 45;

    Object.assign(subtitleContainer.style, {
        flexDirection: config.subtitleLayoutOrientation,
        width: '94%',
        justifyContent: 'center',
        alignItems: 'center',
        bottom: `${bottomPercentage}%`,
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
        // Add base margin (0.5em) plus the gap setting for more noticeable effect
        const verticalGap = 0.1 + (config.subtitleGap || 0);
        firstElement.style.setProperty(
            'margin-bottom',
            `${verticalGap}em`,
            'important'
        );
        // Clear any horizontal margins for vertical layout
        firstElement.style.setProperty('margin-right', '0', 'important');
        secondElement.style.setProperty('margin-right', '0', 'important');
    } else {
        firstElement.style.maxWidth = 'calc(50% - 1%)';
        secondElement.style.maxWidth = 'calc(50% - 1%)';
        firstElement.style.verticalAlign = 'top';
        secondElement.style.verticalAlign = 'top';
        // Clear any vertical margins for horizontal layout
        firstElement.style.setProperty('margin-bottom', '0', 'important');
        secondElement.style.setProperty('margin-bottom', '0', 'important');
        // Add base margin (0.5em) plus the gap setting for horizontal spacing
        const horizontalGap = 0.5 + (config.subtitleGap || 0);
        (config.subtitleLayoutOrder === 'translation_top'
            ? translatedSubtitleElement
            : originalSubtitleElement
        ).style.setProperty('margin-right', `${horizontalGap}em`, 'important');
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
        detachTimeUpdateListener();
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
    if (
        attachedVideoElement !== videoElement ||
        timeUpdateVideoElement !== videoElement ||
        timeUpdatePlatform !== activePlatform ||
        timeUpdateConfig !== config
    ) {
        detachTimeUpdateListener();
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

function cancelVideoFrameUpdate() {
    invalidateFramePresentationScan();
    const owner = videoFrameCallbackOwner;
    const callbackId = videoFrameCallbackId;
    videoFrameCallbackOwner = null;
    videoFrameCallbackId = null;

    if (
        owner &&
        callbackId !== null &&
        typeof owner.videoElement.cancelVideoFrameCallback === 'function'
    ) {
        try {
            owner.videoElement.cancelVideoFrameCallback(callbackId);
        } catch (_) {}
    }
}

function isVideoFrameCallbackOwnerCurrent(owner) {
    return (
        videoFrameCallbackOwner === owner &&
        timeUpdateVideoElement === owner.videoElement &&
        timeUpdatePlatform === owner.activePlatform &&
        timeUpdateConfig === owner.config &&
        timeUpdateListener === owner.listener
    );
}

function requestOwnedVideoFrameUpdate(owner) {
    if (!isVideoFrameCallbackOwnerCurrent(owner)) return;

    try {
        let callbackId = null;
        callbackId = owner.videoElement.requestVideoFrameCallback(() => {
            if (
                !isVideoFrameCallbackOwnerCurrent(owner) ||
                videoFrameCallbackId !== callbackId
            ) {
                return;
            }

            videoFrameCallbackId = null;
            const currentTime = resolvePlaybackTime(
                owner.activePlatform,
                owner.videoElement
            );
            const { readyState, HAVE_CURRENT_DATA } = owner.videoElement;
            if (
                subtitlesActive &&
                typeof currentTime === 'number' &&
                readyState >= HAVE_CURRENT_DATA &&
                shouldUpdateSubtitlesForFrame(owner, currentTime)
            ) {
                updateSubtitles(
                    currentTime,
                    owner.activePlatform,
                    owner.config,
                    owner.logPrefix
                );
            }

            requestOwnedVideoFrameUpdate(owner);
        });
        videoFrameCallbackId = callbackId;
    } catch (_) {
        if (videoFrameCallbackOwner === owner) {
            videoFrameCallbackId = null;
        }
    }
}

function scheduleVideoFrameUpdate(
    videoElement,
    activePlatform,
    config,
    logPrefix,
    listener
) {
    if (
        activePlatform.supportsProgressBarTracking?.() !== false ||
        typeof videoElement.requestVideoFrameCallback !== 'function'
    ) {
        return;
    }

    const owner = {
        videoElement,
        activePlatform,
        config,
        logPrefix,
        listener,
    };
    invalidateFramePresentationScan();
    videoFrameCallbackOwner = owner;
    requestOwnedVideoFrameUpdate(owner);
}

function detachTimeUpdateListener() {
    cancelVideoFrameUpdate();
    const listenerToRemove = timeUpdateListener;
    const attachedVideos = new Set();
    if (timeUpdateVideoElement) attachedVideos.add(timeUpdateVideoElement);
    document
        .querySelectorAll('video[data-listener-attached="true"]')
        .forEach((video) => attachedVideos.add(video));

    for (const video of attachedVideos) {
        if (listenerToRemove) {
            video.removeEventListener('timeupdate', listenerToRemove);
            video.removeEventListener('seeking', listenerToRemove);
            video.removeEventListener('seeked', listenerToRemove);
        }
        video.removeAttribute('data-listener-attached');
    }

    timeUpdateListener = null;
    timeUpdateVideoElement = null;
    timeUpdatePlatform = null;
    timeUpdateConfig = null;
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

    if (
        timeUpdateVideoElement === videoElement &&
        timeUpdatePlatform === activePlatform &&
        timeUpdateConfig === config &&
        timeUpdateListener &&
        videoElement.getAttribute('data-listener-attached') === 'true'
    ) {
        return;
    }

    detachTimeUpdateListener();
    timeUpdateVideoElement = videoElement;
    timeUpdatePlatform = activePlatform;
    timeUpdateConfig = config;
    timeUpdateListener = (event) => {
        timeUpdateLogCounter++;
        const currentVideoElem = videoElement;
        if (!currentVideoElem) return;

        if (event?.type === 'seeking' || event?.type === 'seeked') {
            invalidateFramePresentationScan();
            activePlatform.invalidatePlaybackClockCalibration?.();
        }

        scheduleSubtitleQueueProcessing(activePlatform, config, logPrefix);
        const { readyState, HAVE_CURRENT_DATA } = currentVideoElem;
        const currentTime = resolvePlaybackTime(
            activePlatform,
            currentVideoElem
        );
        const useProgressBar =
            activePlatform.supportsProgressBarTracking?.() !== false;

        // Platforms that explicitly opt into a primary progress clock
        // continue to use the generic observer path.
        if (useProgressBar && progressBarObserver) {
            if (
                subtitlesActive &&
                typeof lastProgressBarTime === 'number' &&
                lastProgressBarTime >= 0
            ) {
                updateSubtitles(
                    lastProgressBarTime,
                    activePlatform,
                    config,
                    logPrefix
                );
            }
            return;
        }

        if (
            subtitlesActive &&
            typeof currentTime === 'number' &&
            readyState >= HAVE_CURRENT_DATA
        ) {
            updateSubtitles(currentTime, activePlatform, config, logPrefix);
        }
    };

    videoElement.addEventListener('timeupdate', timeUpdateListener);
    videoElement.addEventListener('seeking', timeUpdateListener);
    videoElement.addEventListener('seeked', timeUpdateListener);
    videoElement.setAttribute('data-listener-attached', 'true');
    scheduleVideoFrameUpdate(
        videoElement,
        activePlatform,
        config,
        logPrefix,
        timeUpdateListener
    );
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
    logWithFallback('debug', 'setupProgressBarObserver called', {
        logPrefix,
        haveVideo: !!videoElement,
        havePlatform: !!activePlatform,
    });
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
    }, COMMON_CONSTANTS.FIND_PROGRESS_BAR_INTERVAL);
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

    logWithFallback(
        'debug',
        'Attempting to locate progress bar via platform getter',
        {
            logPrefix,
        }
    );
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

        // Observe a stable container: prefer the shadowRoot so node replacements don't break observation
        const rootNode = sliderElement.getRootNode?.();
        const progressBarHost =
            rootNode && rootNode.host
                ? rootNode.host
                : sliderElement.closest?.('progress-bar');
        const observeTarget =
            (rootNode && rootNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE
                ? rootNode
                : null) || sliderElement;
        const rootType =
            observeTarget?.constructor?.name ||
            observeTarget?.getRootNode?.()?.constructor?.name ||
            'Document';
        logWithFallback('debug', 'Observe target prepared', {
            logPrefix,
            tagName: observeTarget?.tagName || 'unknown',
            className: observeTarget?.className || '',
            rootType,
        });

        progressBarObserver = new MutationObserver((mutations) => {
            const selectActiveThumb = () => {
                if (progressBarHost && progressBarHost.shadowRoot) {
                    // Original, more specific selector
                    let thumb = progressBarHost.shadowRoot.querySelector(
                        '.progress-bar__seekable-range .progress-bar__thumb[aria-valuenow][aria-valuemax]'
                    );
                    if (thumb) return thumb;

                    // Fallback to any element with aria-valuenow in the shadow root, which is common
                    thumb =
                        progressBarHost.shadowRoot.querySelector(
                            '[aria-valuenow]'
                        );
                    if (thumb) return thumb;
                }
                return null;
            };
            for (const mutation of mutations) {
                if (
                    (mutation.type === 'attributes' &&
                        (mutation.attributeName === 'aria-valuenow' ||
                            mutation.attributeName === 'aria-valuetext' ||
                            mutation.attributeName === 'aria-valuemax')) ||
                    mutation.type === 'childList'
                ) {
                    // Only use the official Disney+ thumb under the progress-bar shadow root
                    let targetElement = selectActiveThumb() || mutation.target;
                    // Some UIs move aria attributes to child or sibling nodes; search nearby if missing
                    let nowStr = targetElement.getAttribute('aria-valuenow');
                    let maxStr = targetElement.getAttribute('aria-valuemax');
                    let textStr = targetElement.getAttribute('aria-valuetext');

                    logWithFallback('debug', 'Progress bar mutation observed', {
                        logPrefix,
                        attributeName: mutation.attributeName || 'childList',
                        targetTag: targetElement.tagName,
                        targetClass: targetElement.className,
                        nowStr,
                        maxStr,
                        textStr,
                    });
                    if (!nowStr || !maxStr) {
                        const neighbor =
                            targetElement.closest('[aria-valuenow]') ||
                            targetElement.querySelector?.('[aria-valuenow]') ||
                            targetElement.parentElement?.querySelector?.(
                                '[aria-valuenow]'
                            ) ||
                            null;
                        if (neighbor) {
                            nowStr =
                                nowStr ||
                                neighbor.getAttribute('aria-valuenow');
                            maxStr =
                                maxStr ||
                                neighbor.getAttribute('aria-valuemax');
                            textStr =
                                textStr ||
                                neighbor.getAttribute('aria-valuetext');
                        }
                        logWithFallback(
                            'debug',
                            'Progress bar neighbor search values',
                            {
                                logPrefix,
                                nowStr,
                                maxStr,
                                textStr,
                            }
                        );
                    }

                    const currentVideoElem = activePlatform.getVideoElement();
                    if ((nowStr || textStr) && currentVideoElem) {
                        // Prefer numeric aria values; fallback to extracting from valuetext like "135 of 1502"
                        let valuenow = nowStr ? parseFloat(nowStr) : NaN;
                        let valuemax = maxStr ? parseFloat(maxStr) : NaN;
                        if (
                            (Number.isNaN(valuenow) ||
                                Number.isNaN(valuemax)) &&
                            textStr
                        ) {
                            const m = textStr.match(
                                /(\d+(?:\.\d+)?)\s*[^\d]+\s*(\d+(?:\.\d+)?)/
                            );
                            if (m) {
                                if (Number.isNaN(valuenow))
                                    valuenow = parseFloat(m[1]);
                                if (Number.isNaN(valuemax))
                                    valuemax = parseFloat(m[2]);
                            }
                        }
                        let { duration: videoDuration } = currentVideoElem;
                        // Some players report 0/null/Infinity until metadata is ready. Fallback to valuemax when it looks like seconds.
                        if (
                            (!isFinite(videoDuration) || videoDuration <= 0) &&
                            !Number.isNaN(valuemax) &&
                            valuemax > 0
                        ) {
                            videoDuration = valuemax;
                        }

                        logWithFallback(
                            'debug',
                            'Progress bar time calculation values',
                            {
                                logPrefix,
                                valuenow,
                                valuemax,
                                videoDuration,
                            }
                        );

                        if (!Number.isNaN(valuenow)) {
                            // Directly use valuenow as seconds when valuemax matches duration
                            let calculatedTime = valuenow;
                            if (
                                isFinite(videoDuration) &&
                                videoDuration > 0 &&
                                !Number.isNaN(valuemax) &&
                                valuemax > 0
                            ) {
                                // If valuemax does not match duration yet, scale valuenow by valuemax
                                // Also, if videoDuration was Infinity and we fell back to valuemax, this should be false.
                                if (Math.abs(valuemax - videoDuration) > 1.5) {
                                    calculatedTime =
                                        (valuenow / valuemax) * videoDuration;
                                }
                            }

                            if (
                                calculatedTime >= 0 &&
                                Number.isFinite(calculatedTime)
                            ) {
                                const previous = lastProgressBarTime;
                                lastProgressBarTime = calculatedTime;
                                lastProgressBarUpdateTs = Date.now();
                                logWithFallback(
                                    'debug',
                                    'Computed progress-bar time',
                                    {
                                        logPrefix,
                                        valuenow,
                                        valuemax,
                                        videoDuration,
                                        calculatedTime,
                                        delta: Math.abs(
                                            calculatedTime - previous
                                        ),
                                    }
                                );
                                if (
                                    subtitlesActive &&
                                    Math.abs(calculatedTime - previous) > 0.1
                                ) {
                                    logWithFallback(
                                        'debug',
                                        'Updating subtitles using progress bar time',
                                        {
                                            logPrefix,
                                            time: calculatedTime,
                                        }
                                    );
                                    updateSubtitles(
                                        calculatedTime,
                                        activePlatform,
                                        config,
                                        logPrefix
                                    );
                                } else {
                                    logWithFallback(
                                        'debug',
                                        'Skip update - delta too small or subtitles inactive',
                                        {
                                            logPrefix,
                                        }
                                    );
                                }
                            }
                        }
                    }
                }
            }
        });

        progressBarObserver.observe(observeTarget, {
            attributes: true,
            attributeFilter: [
                'aria-valuenow',
                'aria-valuetext',
                'aria-valuemax',
                'style',
            ],
            subtree: true,
            childList: true,
        });
        logWithFallback(
            'info',
            'Progress bar observer started for aria-valuenow.',
            { logPrefix }
        );

        // Removed extra polling; rely solely on attribute mutations for Disney+
        return true;
    }
    logWithFallback('debug', 'Platform getter returned null for progress bar', {
        logPrefix,
    });
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

    // Detect SPA navigation via URL change and temporarily suppress rendering
    const currentHref =
        typeof window !== 'undefined' && window.location
            ? window.location.href
            : lastKnownLocationHref;
    if (currentHref !== lastKnownLocationHref) {
        navigationGuardActive = true;
        navigationGuardFromVideoId = lastRenderedVideoId;
        lastKnownLocationHref = currentHref;
    }

    // Do not render subtitles if the platform video context is unknown.
    // This prevents stale subtitles from a previous video/episode from being shown
    // during soft navigations before the new videoId is established.
    if (platformVideoId == null) {
        invalidateFramePresentationScan();
        hideSubtitleContainer();
        return;
    }

    // If we detect navigation and the platform switched to a different videoId,
    // clear display once and disable the guard.
    if (
        navigationGuardActive &&
        navigationGuardFromVideoId !== platformVideoId
    ) {
        if (originalSubtitleElement) {
            commitOriginalSubtitleState({
                element: originalSubtitleElement,
                videoId: null,
                text: '',
                emptyReason: 'clear',
            });
        }
        if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';
        lastDisplayedCueWindow = { start: null, end: null, videoId: null };
        navigationGuardActive = false;
        navigationGuardFromVideoId = null;
    }

    // If the video context changed since we last displayed a cue, clear any lingering text
    // to ensure we don't keep showing previous episode/video subtitles during transitions.
    if (
        lastDisplayedCueWindow.videoId != null &&
        lastDisplayedCueWindow.videoId !== platformVideoId
    ) {
        if (originalSubtitleElement) {
            commitOriginalSubtitleState({
                element: originalSubtitleElement,
                videoId: null,
                text: '',
                emptyReason: 'clear',
            });
        }
        if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';
        lastDisplayedCueWindow = { start: null, end: null, videoId: null };
    }

    // Find all active cues and the next point where the active set can change.
    // The frame callback uses this boundary to avoid rescanning the episode
    // queue while playback remains inside the same presentation window.
    const activeCues = [];
    let nextBoundaryTime = null;
    let nextBoundaryInclusive = false;
    const considerNextBoundary = (boundaryTime, inclusive) => {
        if (
            nextBoundaryTime === null ||
            boundaryTime < nextBoundaryTime ||
            (boundaryTime === nextBoundaryTime && inclusive)
        ) {
            nextBoundaryTime = boundaryTime;
            nextBoundaryInclusive = inclusive;
        }
    };
    for (const cue of subtitleQueue) {
        if (
            typeof cue.start !== 'number' ||
            typeof cue.end !== 'number' ||
            Number.isNaN(cue.start) ||
            Number.isNaN(cue.end)
        ) {
            continue;
        }
        if (cue.videoId !== platformVideoId) continue;

        if (currentTime < cue.start) {
            considerNextBoundary(cue.start, true);
        } else if (currentTime <= cue.end) {
            activeCues.push(cue);
            considerNextBoundary(cue.end, false);
        }
    }

    if (
        activeCues.length === 0 &&
        lastDisplayedCueWindow.start != null &&
        lastDisplayedCueWindow.end != null &&
        (lastDisplayedCueWindow.videoId == null ||
            lastDisplayedCueWindow.videoId === platformVideoId) &&
        currentTime >= lastDisplayedCueWindow.start &&
        currentTime <= lastDisplayedCueWindow.end
    ) {
        considerNextBoundary(lastDisplayedCueWindow.end, false);
    }

    const styleGraceDeadline =
        lastStyleApplicationTs + FRAME_PRESENTATION_STYLE_GRACE_MS;
    const nextWallClockEvaluation =
        activeCues.length === 0 &&
        (originalSubtitleElement.innerHTML ||
            translatedSubtitleElement.innerHTML) &&
        Date.now() < styleGraceDeadline
            ? styleGraceDeadline
            : null;
    framePresentationScan = {
        activePlatform,
        config,
        videoElement: timeUpdateVideoElement,
        platformVideoId,
        subtitleTimeOffset: config.subtitleTimeOffset,
        subtitleContextGeneration,
        subtitleQueue,
        subtitleQueueLength: subtitleQueue.length,
        firstCue: subtitleQueue[0] || null,
        lastCue: subtitleQueue[subtitleQueue.length - 1] || null,
        subtitleContainer,
        locationHref: currentHref,
        evaluatedTime: currentTime,
        nextBoundaryTime,
        nextBoundaryInclusive,
        nextWallClockEvaluation,
    };

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
                    textLength: (c.original || c.translated || '').length,
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
        if (
            interactiveSubtitlesEnabled &&
            interactiveModulesLoaded &&
            window.dualsub_setInteractiveEnabled
        ) {
            window.dualsub_setInteractiveEnabled(true);
            logWithFallback(
                'debug',
                'Interactive features enabled before text formatting',
                {
                    logPrefix,
                }
            );
        }

        const originalFormatOptions = {
            sourceLanguage: config.sourceLanguage || 'unknown',
            targetLanguage: config.targetLanguage || 'unknown',
        };
        const translatedTextFormatted = formatSubtitleTextForDisplay(
            translatedText,
            {
                sourceLanguage: config.sourceLanguage || 'unknown',
                targetLanguage: config.targetLanguage || 'unknown',
                subtitleType: 'translated',
            }
        );

        let contentChanged = false;

        if (currentWholeSecond !== lastLoggedTimeSec) {
            logWithFallback('debug', 'Display subtitle update.', {
                logPrefix,
                time: currentTime.toFixed(2),
                useNativeTarget,
                activeCueCount: activeCues.length,
                originalLength: originalText.length,
                translatedLength: translatedText.length,
            });
        }

        // Track the last displayed cue window to avoid clearing during brief mismatches
        const displayedCue = originalActiveCue || translatedActiveCue;
        if (displayedCue) {
            lastDisplayedCueWindow = {
                start: displayedCue.start,
                end: displayedCue.end,
                videoId:
                    (typeof displayedCue.videoId !== 'undefined'
                        ? displayedCue.videoId
                        : platformVideoId) || null,
            };
            lastRenderedVideoId =
                lastDisplayedCueWindow.videoId || platformVideoId;
        }

        if (originalText.trim()) {
            const newSig = computeTextSignature(originalText);
            if (
                shouldCommitOriginalSubtitleState(
                    originalSubtitleElement,
                    platformVideoId,
                    originalText
                )
            ) {
                const commit = commitOriginalSubtitleState({
                    element: originalSubtitleElement,
                    videoId: platformVideoId,
                    text: originalText,
                    formatOptions: originalFormatOptions,
                    signature: newSig,
                });
                contentChanged = commit.accepted || commit.domChanged;
                if (commit.domChanged) {
                    dispatchContentChange(
                        'original',
                        commit.oldContent,
                        commit.formattedText,
                        originalSubtitleElement
                    );
                }
                if (currentWholeSecond !== lastLoggedTimeSec) {
                    logWithFallback(
                        'debug',
                        useNativeTarget
                            ? 'Setting original subtitle (native mode).'
                            : 'Setting original subtitle.',
                        { logPrefix, textLength: originalText.length }
                    );
                }
            }
            originalSubtitleElement.style.display = 'inline-block';
        } else {
            if (originalSubtitleElement.innerHTML) {
                dispatchContentChange(
                    'original',
                    originalSubtitleElement.innerHTML,
                    '',
                    originalSubtitleElement,
                    { immediate: true }
                );
                const commit = commitOriginalSubtitleState({
                    element: originalSubtitleElement,
                    videoId: platformVideoId,
                    text: '',
                    emptyReason: 'expired',
                });
                contentChanged = commit.accepted || commit.domChanged;
                lastDisplayedCueWindow = {
                    start: null,
                    end: null,
                    videoId: null,
                };
                if (currentWholeSecond !== lastLoggedTimeSec) {
                    logWithFallback(
                        'debug',
                        useNativeTarget
                            ? 'Clearing original subtitle (native mode, empty text).'
                            : 'Clearing original subtitle (empty text).',
                        { logPrefix }
                    );
                }
            }
            originalSubtitleElement.style.display = 'none';
        }

        if (useNativeTarget) {
            if (translatedText.trim()) {
                const newSig = computeTextSignature(translatedText);
                if (
                    shouldRenderSubtitleText(
                        translatedSubtitleElement,
                        translatedText,
                        newSig
                    )
                ) {
                    storeRenderedSubtitleText(
                        translatedSubtitleElement,
                        translatedText,
                        translatedTextFormatted,
                        newSig
                    );
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Setting native target subtitle.',
                            { logPrefix, textLength: translatedText.length }
                        );
                    }
                }
                translatedSubtitleElement.style.display = 'inline-block';
            } else {
                if (translatedSubtitleElement.innerHTML) {
                    dispatchContentChange(
                        'translated',
                        translatedSubtitleElement.innerHTML,
                        '',
                        translatedSubtitleElement,
                        { immediate: true }
                    );
                    clearRenderedSubtitleText(translatedSubtitleElement);
                    contentChanged = true;
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
            if (translatedText.trim()) {
                const newSig = computeTextSignature(translatedText);
                if (
                    shouldRenderSubtitleText(
                        translatedSubtitleElement,
                        translatedText,
                        newSig
                    )
                ) {
                    storeRenderedSubtitleText(
                        translatedSubtitleElement,
                        translatedText,
                        translatedTextFormatted,
                        newSig
                    );
                    contentChanged = true;
                    if (currentWholeSecond !== lastLoggedTimeSec) {
                        logWithFallback(
                            'debug',
                            'Setting translated subtitle.',
                            { logPrefix, textLength: translatedText.length }
                        );
                    }
                }
                translatedSubtitleElement.style.display = 'inline-block';
            } else {
                if (translatedSubtitleElement.innerHTML) {
                    dispatchContentChange(
                        'translated',
                        translatedSubtitleElement.innerHTML,
                        '',
                        translatedSubtitleElement,
                        { immediate: true }
                    );
                    clearRenderedSubtitleText(translatedSubtitleElement);
                    contentChanged = true;
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
            if (
                interactiveSubtitlesEnabled &&
                interactiveModulesLoaded &&
                window.dualsub_attachInteractiveEventListeners
            ) {
                try {
                    if (
                        originalText.trim() &&
                        originalSubtitleElement.style.display !== 'none'
                    ) {
                        const currentBinding =
                            getCurrentOriginalInteractiveBinding();
                        if (
                            currentBinding?.element === originalSubtitleElement
                        ) {
                            window.dualsub_attachInteractiveEventListeners(
                                originalSubtitleElement,
                                currentBinding.formatOptions || {}
                            );
                        }

                        logWithFallback(
                            'debug',
                            'Interactive listeners attached to original subtitle only',
                            {
                                originalElementId: originalSubtitleElement.id,
                                logPrefix,
                            }
                        );
                    }
                } catch (error) {
                    logWithFallback(
                        'error',
                        'Failed to attach interactive event listeners',
                        {
                            errorType: error?.name || 'UnknownError',
                            logPrefix,
                            interactiveEnabled: interactiveSubtitlesEnabled,
                            modulesLoaded: interactiveModulesLoaded,
                            functionAvailable:
                                !!window.dualsub_attachInteractiveEventListeners,
                            originalElementExists: !!originalSubtitleElement,
                            translatedElementExists:
                                !!translatedSubtitleElement,
                            originalLength: originalText?.length || 0,
                            translatedLength: translatedText?.length || 0,
                        }
                    );
                }
            }
        }
    } else {
        // When no cue is found, avoid clearing during brief style/ID transitions
        const withinStyleGrace =
            Date.now() - lastStyleApplicationTs <
            FRAME_PRESENTATION_STYLE_GRACE_MS;
        const withinLastWindow =
            lastDisplayedCueWindow.start != null &&
            lastDisplayedCueWindow.end != null &&
            (lastDisplayedCueWindow.videoId == null ||
                platformVideoId === lastDisplayedCueWindow.videoId) &&
            currentTime >= lastDisplayedCueWindow.start &&
            currentTime <= lastDisplayedCueWindow.end;

        if (withinStyleGrace || withinLastWindow) {
            if (originalSubtitleElement.innerHTML)
                originalSubtitleElement.style.display = 'inline-block';
            if (translatedSubtitleElement.innerHTML)
                translatedSubtitleElement.style.display = 'inline-block';
            return;
        }

        // Dispatch content change before clearing subtitles
        if (originalSubtitleElement.innerHTML) {
            dispatchContentChange(
                'original',
                originalSubtitleElement.innerHTML,
                '',
                originalSubtitleElement,
                { immediate: true }
            );
        }

        commitOriginalSubtitleState({
            element: originalSubtitleElement,
            videoId: platformVideoId,
            text: '',
            emptyReason: 'expired',
        });
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
    invalidateSubtitleContext();
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

    if (originalSubtitleElement) {
        commitOriginalSubtitleState({
            element: originalSubtitleElement,
            videoId: null,
            text: '',
            emptyReason: 'clear',
        });
    }
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

export function finalizeExpiredSubtitleIfNeeded(
    thresholdSeconds = 0.1,
    activePlatform = null
) {
    try {
        if (!lastDisplayedCueWindow || lastDisplayedCueWindow.end == null) {
            return false;
        }

        const video =
            document.querySelector('video[data-listener-attached="true"]') ||
            document.querySelector('video');
        const currentTime = resolvePlaybackTime(activePlatform, video);

        if (
            currentTime == null ||
            currentTime <= (lastDisplayedCueWindow.end ?? 0) + thresholdSeconds
        ) {
            return false;
        }

        let cleared = false;

        if (originalSubtitleElement && originalSubtitleElement.innerHTML) {
            dispatchContentChange(
                'original',
                originalSubtitleElement.innerHTML,
                '',
                originalSubtitleElement,
                { immediate: true }
            );
            commitOriginalSubtitleState({
                element: originalSubtitleElement,
                videoId: activePlatform?.getCurrentVideoId?.() || null,
                text: '',
                emptyReason: 'expired',
            });
            originalSubtitleElement.style.display = 'none';
            cleared = true;
        }

        if (translatedSubtitleElement && translatedSubtitleElement.innerHTML) {
            dispatchContentChange(
                'translated',
                translatedSubtitleElement.innerHTML,
                '',
                translatedSubtitleElement,
                { immediate: true }
            );
            translatedSubtitleElement.innerHTML = '';
            translatedSubtitleElement.dataset.textSig = '';
            translatedSubtitleElement.style.display = 'none';
            cleared = true;
        }

        if (cleared) {
            document
                .querySelectorAll(
                    '.dualsub-interactive-word.dualsub-word-selected'
                )
                .forEach((el) => el.classList.remove('dualsub-word-selected'));

            lastDisplayedCueWindow = { start: null, end: null, videoId: null };
        }

        return cleared;
    } catch (error) {
        logWithFallback('warn', 'Failed to finalize expired subtitle', {
            errorType: error?.name || 'UnknownError',
        });
        return false;
    }
}

export function clearSubtitleDOM() {
    invalidateSubtitleContext();
    if (originalSubtitleElement) {
        commitOriginalSubtitleState({
            element: originalSubtitleElement,
            videoId: null,
            text: '',
            emptyReason: 'clear',
        });
    }
    if (subtitleContainer && subtitleContainer.parentElement) {
        subtitleContainer.parentElement.removeChild(subtitleContainer);
    }
    subtitleContainer = null;
    originalSubtitleElement = null;
    translatedSubtitleElement = null;

    detachTimeUpdateListener();

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
        invalidateFramePresentationScan();
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
            const playbackTime = resolvePlaybackTime(
                activePlatform,
                videoElement
            );
            if (playbackTime !== null) {
                updateSubtitles(
                    playbackTime,
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
        const playbackTime = resolvePlaybackTime(activePlatform, videoElement);
        if (videoElement && playbackTime !== null && subtitlesActive) {
            updateSubtitles(playbackTime, activePlatform, config, logPrefix);
        }
    } else {
        logWithFallback('warn', 'VTT parsing yielded no cues for videoId.', {
            logPrefix,
            videoId: currentVideoId,
            hasVttUrl: !!subtitleData.url,
        });
    }
}

export function handleVideoIdChange(newVideoId, logPrefix = 'SubtitleUtils') {
    if (currentVideoId === newVideoId) {
        logWithFallback('debug', 'Video context unchanged.', {
            logPrefix,
            videoId: newVideoId,
        });
        return;
    }

    invalidateSubtitleContext();

    logWithFallback('info', 'Video context changing.', {
        logPrefix,
        from: currentVideoId || 'null',
        to: newVideoId,
    });
    if (originalSubtitleElement) {
        commitOriginalSubtitleState({
            element: originalSubtitleElement,
            videoId: null,
            text: '',
            emptyReason: 'clear',
        });
    }
    if (translatedSubtitleElement) translatedSubtitleElement.innerHTML = '';

    if (currentVideoId && currentVideoId !== newVideoId) {
        if (processingQueue) queueRerunRequested = true;
        subtitleQueue = subtitleQueue.filter(
            (cue) => cue.videoId !== currentVideoId
        );
    }
    currentVideoId = newVideoId;
    // Reset last displayed window to avoid stale carryover between videos
    lastDisplayedCueWindow = { start: null, end: null, videoId: null };
}

function getTranslationPriority(cue, currentTime) {
    if (cue.start <= currentTime && cue.end >= currentTime) {
        return [0, Math.abs(currentTime - cue.start)];
    }
    if (cue.start > currentTime) {
        return [1, cue.start - currentTime];
    }
    return [2, currentTime - cue.end];
}

function isCueInTranslationWindow(
    cue,
    platformVideoId,
    windowStart,
    windowEnd
) {
    return (
        cue.videoId === platformVideoId &&
        cue.original &&
        !cue.translated &&
        !cue.useNativeTarget &&
        Number.isFinite(cue.start) &&
        Number.isFinite(cue.end) &&
        cue.end >= windowStart &&
        cue.start <= windowEnd
    );
}

function getCuesToTranslate(platformVideoId, currentTime, limit) {
    const windowStart = currentTime - TRANSLATION_LOOKBEHIND_SECONDS;
    const windowEnd = currentTime + TRANSLATION_LOOKAHEAD_SECONDS;
    const now = Date.now();

    return subtitleQueue
        .filter(
            (cue) =>
                isCueInTranslationWindow(
                    cue,
                    platformVideoId,
                    windowStart,
                    windowEnd
                ) &&
                (!Number.isFinite(cue.translationRetryAt) ||
                    cue.translationRetryAt <= now)
        )
        .sort((a, b) => {
            const [aBand, aDistance] = getTranslationPriority(a, currentTime);
            const [bBand, bDistance] = getTranslationPriority(b, currentTime);
            return aBand - bBand || aDistance - bDistance || a.start - b.start;
        })
        .slice(0, limit);
}

function getNextCueRetryDelay(platformVideoId, currentTime) {
    const windowStart = currentTime - TRANSLATION_LOOKBEHIND_SECONDS;
    const windowEnd = currentTime + TRANSLATION_LOOKAHEAD_SECONDS;
    const now = Date.now();
    let earliestRetryAt = null;

    for (const cue of subtitleQueue) {
        if (
            isCueInTranslationWindow(
                cue,
                platformVideoId,
                windowStart,
                windowEnd
            ) &&
            Number.isFinite(cue.translationRetryAt) &&
            cue.translationRetryAt > now &&
            (earliestRetryAt === null ||
                cue.translationRetryAt < earliestRetryAt)
        ) {
            earliestRetryAt = cue.translationRetryAt;
        }
    }

    return earliestRetryAt === null ? null : Math.max(1, earliestRetryAt - now);
}

function isTranslationBatchItemValid(
    activePlatform,
    platformVideoId,
    cue,
    processingGeneration
) {
    let activeVideoId = null;
    try {
        activeVideoId = activePlatform?.getCurrentVideoId?.();
    } catch (_) {
        return false;
    }

    return (
        subtitlesActive &&
        processingGeneration === subtitleContextGeneration &&
        activeVideoId === platformVideoId &&
        subtitleQueue.includes(cue)
    );
}

export async function processSubtitleQueue(
    activePlatform,
    config,
    logPrefix = 'SubtitleUtils'
) {
    if (!activePlatform || !subtitlesActive) return;
    if (processingQueue) {
        queueRerunRequested = true;
        queueRerunContext = {
            activePlatform,
            config,
            logPrefix,
            generation: subtitleContextGeneration,
        };
        return;
    }

    cancelScheduledQueueProcessing();

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) {
        scheduleSubtitleQueueProcessing(activePlatform, config, logPrefix, 200);
        return;
    }

    const platformVideoId = activePlatform.getCurrentVideoId();
    if (!platformVideoId) return;
    const processingGeneration = subtitleContextGeneration;

    if (
        activePlatform.supportsProgressBarTracking?.() !== false &&
        !progressBarObserver &&
        findProgressBarIntervalId
    ) {
        logWithFallback(
            'info',
            'Progress bar observer setup in progress. Deferring queue processing slightly.',
            { logPrefix }
        );
        scheduleSubtitleQueueProcessing(activePlatform, config, logPrefix, 200);
        return;
    }

    let timeSource = resolvePlaybackTime(activePlatform, videoElement);
    if (timeSource === null) return;

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

    const cuesToProcess = getCuesToTranslate(
        platformVideoId,
        currentTime,
        MAX_CUES_PER_QUEUE_PASS
    );

    if (cuesToProcess.length === 0) {
        const retryDelay = getNextCueRetryDelay(platformVideoId, currentTime);
        if (retryDelay !== null) {
            scheduleSubtitleQueueProcessing(
                activePlatform,
                config,
                logPrefix,
                retryDelay
            );
        }
        return;
    }

    queueRerunRequested = false;
    queueRerunContext = null;
    processingQueue = true;

    try {
        for (const cueToProcess of cuesToProcess) {
            if (
                queueRerunRequested ||
                !isTranslationBatchItemValid(
                    activePlatform,
                    platformVideoId,
                    cueToProcess,
                    processingGeneration
                )
            ) {
                break;
            }

            try {
                // The content queue dispatches once per attempt. Background
                // gating owns translationDelay and all request rate pacing.
                const request = buildTranslationRequestMessage({
                    text: cueToProcess.original,
                    targetLang: config.targetLanguage,
                    cueStart: cueToProcess.start,
                    cueVideoId: cueToProcess.videoId,
                });
                const response = await sendRuntimeMessageWithRetry(request, {
                    retries: 0,
                    pingBeforeRetry: false,
                });
                const parsedResponse = parseTranslationResponseMessage(
                    response,
                    request
                );

                if (parsedResponse?.status === 'failure') {
                    throw new CueTranslationError(
                        'Translation service reported an error.',
                        TRANSLATION_API_ERROR_TYPE
                    );
                }

                if (parsedResponse?.status !== 'success') {
                    throw new CueTranslationError(
                        'Malformed response from background for translation.',
                        TRANSLATION_REQUEST_ERROR_TYPE
                    );
                }

                const currentContextVideoId =
                    activePlatform?.getCurrentVideoId();
                if (
                    isTranslationBatchItemValid(
                        activePlatform,
                        platformVideoId,
                        cueToProcess,
                        processingGeneration
                    )
                ) {
                    cueToProcess.translated = parsedResponse.translatedText;
                    delete cueToProcess.translationAttempts;
                    delete cueToProcess.translationRetryAt;
                } else {
                    logWithFallback(
                        'warn',
                        'Could not find/match cue post-translation or context changed.',
                        {
                            logPrefix,
                            responseVideoId: parsedResponse.cueVideoId,
                            cueStart: parsedResponse.cueStart,
                            currentContextVideoId,
                        }
                    );
                }

                if (
                    queueRerunRequested ||
                    !isTranslationBatchItemValid(
                        activePlatform,
                        platformVideoId,
                        cueToProcess,
                        processingGeneration
                    )
                ) {
                    break;
                }
            } catch (error) {
                const provenNonDelivery = isProvenMessagingNonDelivery(error);
                const errorType =
                    error instanceof CueTranslationError
                        ? error.errorType
                        : TRANSLATION_REQUEST_ERROR_TYPE;
                logWithFallback('error', 'Translation failed for cue.', {
                    logPrefix,
                    videoId: cueToProcess.videoId,
                    start: cueToProcess.start.toFixed(2),
                    originalLength: cueToProcess.original.length,
                    errorType,
                    provenNonDelivery,
                });
                if (
                    isTranslationBatchItemValid(
                        activePlatform,
                        platformVideoId,
                        cueToProcess,
                        processingGeneration
                    )
                ) {
                    if (provenNonDelivery) {
                        const attempts =
                            (cueToProcess.translationAttempts || 0) + 1;
                        cueToProcess.translationAttempts = attempts;

                        if (attempts < MAX_CUE_NON_DELIVERY_ATTEMPTS) {
                            cueToProcess.translationRetryAt =
                                Date.now() + CUE_NON_DELIVERY_RETRY_DELAY_MS;
                        } else {
                            cueToProcess.translated =
                                getLocalizedErrorMessage(errorType);
                            delete cueToProcess.translationRetryAt;
                        }
                    } else {
                        cueToProcess.translated =
                            getLocalizedErrorMessage(errorType);
                        delete cueToProcess.translationAttempts;
                        delete cueToProcess.translationRetryAt;
                    }
                }
            }
            invalidateFramePresentationScan();
        }
    } finally {
        processingQueue = false;
    }

    const rerunWasRequested = queueRerunRequested;
    const rerunContext = queueRerunContext;
    queueRerunRequested = false;
    queueRerunContext = null;

    let activeContextVideoId = null;
    try {
        activeContextVideoId = activePlatform?.getCurrentVideoId?.();
    } catch (_) {}
    const processingContextIsCurrent =
        subtitlesActive &&
        processingGeneration === subtitleContextGeneration &&
        activeContextVideoId === platformVideoId;

    if (!processingContextIsCurrent) {
        if (
            rerunContext &&
            rerunContext.generation === subtitleContextGeneration &&
            subtitlesActive
        ) {
            scheduleSubtitleQueueProcessing(
                rerunContext.activePlatform,
                rerunContext.config,
                rerunContext.logPrefix
            );
        }
        return;
    }

    // After processing this queue pass, refresh the subtitles on screen.
    // This ensures newly available translations are rendered without waiting for the next timeupdate event.
    const videoElementForUpdate = activePlatform?.getVideoElement();
    if (videoElementForUpdate) {
        let currentTimeForUpdate = resolvePlaybackTime(
            activePlatform,
            videoElementForUpdate
        );

        // Preserve the primary progress-clock path for adapters that opt in.
        if (
            activePlatform.supportsProgressBarTracking?.() !== false &&
            lastProgressBarTime >= 0
        ) {
            currentTimeForUpdate = lastProgressBarTime;
        }

        if (currentTimeForUpdate !== null) {
            updateSubtitles(
                currentTimeForUpdate,
                activePlatform,
                config,
                logPrefix
            );
        }
    }

    const currentContextVideoIdForNextCheck =
        activePlatform?.getCurrentVideoId();
    const latestVideoElement = activePlatform?.getVideoElement?.();
    const latestTimeSource = resolvePlaybackTime(
        activePlatform,
        latestVideoElement
    );
    const latestCurrentTime =
        latestTimeSource === null
            ? null
            : latestTimeSource + config.subtitleTimeOffset;
    const moreRelevantCuesExist =
        currentContextVideoIdForNextCheck &&
        latestCurrentTime !== null &&
        getCuesToTranslate(
            currentContextVideoIdForNextCheck,
            latestCurrentTime,
            1
        ).length > 0;
    const nextRetryDelay =
        currentContextVideoIdForNextCheck && latestCurrentTime !== null
            ? getNextCueRetryDelay(
                  currentContextVideoIdForNextCheck,
                  latestCurrentTime
              )
            : null;
    const nextRunDelay = rerunWasRequested
        ? 0
        : moreRelevantCuesExist
          ? QUEUE_CONTINUATION_DELAY_MS
          : nextRetryDelay;

    if (
        subtitlesActive &&
        currentContextVideoIdForNextCheck &&
        nextRunDelay !== null
    ) {
        const nextContext =
            rerunContext &&
            rerunContext.generation === subtitleContextGeneration
                ? rerunContext
                : { activePlatform, config, logPrefix };
        scheduleSubtitleQueueProcessing(
            nextContext.activePlatform,
            nextContext.config,
            nextContext.logPrefix,
            nextRunDelay
        );
    }
}
