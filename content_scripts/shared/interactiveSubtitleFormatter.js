/**
 * Interactive Subtitle Formatter
 *
 * Enhances subtitle text with clickable elements for AI context analysis.
 * Provides word/phrase selection, visual feedback, and context interaction.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

// Robust logging function that's always available
const logWithFallback = (() => {
    let currentLogger = (level, message, data) => {
        console.log(
            `[InteractiveFormatter] [${level.toUpperCase()}] ${message}`,
            data || {}
        );
    };

    const logWrapper = (level, message, data) => {
        try {
            currentLogger(level, message, data);
        } catch {
            console.log(
                `[InteractiveFormatter] [${level.toUpperCase()}] ${message}`,
                data || {}
            );
        }
    };

    return logWrapper;
})();

/**
 * Configuration for interactive subtitle formatting
 */
const INTERACTIVE_CONFIG = {
    enabled: false,
    highlightOnHover: true,
    clickableWords: true,
    minWordLength: 1, // Allow single character words for better phrase support
    excludeWords: [], // Include all words for phrase analysis (including function words)
    contextTypes: ['cultural', 'historical', 'linguistic'],
    debounceDelay: 300,
    // Gate verbose debug logs to reduce hot-path noise (Phase 7)
    debugLogging: false,
};

/**
 * State management for interactive subtitles
 */
const interactiveState = {
    isEnabled: false,
    currentSelection: null,
    pendingRequests: new Map(),
    contextModal: null,
    lastClickTime: 0,
};

let activeInteractiveLifecycle = null;

function resetInteractiveLifecycleState() {
    for (const pendingRequest of interactiveState.pendingRequests.values()) {
        try {
            let timeoutId = null;
            if (typeof pendingRequest === 'number') {
                timeoutId = pendingRequest;
            } else if (pendingRequest && typeof pendingRequest === 'object') {
                const timeoutDescriptor = Object.getOwnPropertyDescriptor(
                    pendingRequest,
                    'timeoutId'
                );
                if (
                    timeoutDescriptor &&
                    Object.hasOwn(timeoutDescriptor, 'value') &&
                    typeof timeoutDescriptor.value === 'number'
                ) {
                    timeoutId = timeoutDescriptor.value;
                }
            }
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        } catch (_) {}
    }

    interactiveState.pendingRequests.clear();
    interactiveState.currentSelection = null;
    interactiveState.lastClickTime = 0;
}

/**
 * Begin one formatter lifecycle and reset all lifecycle-scoped interaction
 * state. The returned cleanup only resets the lifecycle it created.
 * @param {Object} options - Lifecycle-private synchronous capabilities.
 * @returns {() => void} Idempotent compare-and-swap cleanup.
 */
export function beginInteractiveLifecycle({
    publishWordIntent = null,
    resolveOriginalWordBindingSnapshot = null,
} = {}) {
    const previousLifecycle = activeInteractiveLifecycle;
    const lifecycle = {
        publishWordIntent:
            typeof publishWordIntent === 'function' ? publishWordIntent : null,
        resolveOriginalWordBindingSnapshot:
            typeof resolveOriginalWordBindingSnapshot === 'function'
                ? resolveOriginalWordBindingSnapshot
                : null,
        boundContainer: null,
        originalWordRegistry: new Map(),
    };
    activeInteractiveLifecycle = lifecycle;
    const previousContainer = previousLifecycle?.boundContainer;
    if (previousLifecycle) {
        previousLifecycle.publishWordIntent = null;
        previousLifecycle.boundContainer = null;
        previousLifecycle.originalWordRegistry.clear();
        previousLifecycle.resolveOriginalWordBindingSnapshot = null;
    }
    if (previousContainer) {
        removeInteractiveEventListeners(previousContainer);
    }
    if (activeInteractiveLifecycle === lifecycle) {
        resetInteractiveLifecycleState();
    }

    let cleaned = false;
    return () => {
        if (cleaned) return;
        cleaned = true;
        if (activeInteractiveLifecycle !== lifecycle) return;

        const boundContainer = lifecycle.boundContainer;
        activeInteractiveLifecycle = null;
        lifecycle.publishWordIntent = null;
        lifecycle.boundContainer = null;
        lifecycle.originalWordRegistry.clear();
        lifecycle.resolveOriginalWordBindingSnapshot = null;
        if (boundContainer) {
            removeInteractiveEventListeners(boundContainer);
        }
        resetInteractiveLifecycleState();
    };
}

// Helper: detect if modal is currently in analyzing state
function isAnalyzingActive() {
    try {
        const modalContent = document.getElementById('dualsub-modal-content');
        return !!(
            modalContent &&
            modalContent.classList &&
            modalContent.classList.contains('is-analyzing')
        );
    } catch (_) {
        return false;
    }
}

/**
 * Initialize interactive subtitle functionality
 * @param {Object} config - Configuration options
 */
export function initializeInteractiveSubtitles(config = {}) {
    Object.assign(INTERACTIVE_CONFIG, config);
    interactiveState.isEnabled = INTERACTIVE_CONFIG.enabled;

    logWithFallback('info', 'Interactive subtitles initialized', {
        enabled: interactiveState.isEnabled,
        clickableWords: INTERACTIVE_CONFIG.clickableWords,
        highlightOnHover: INTERACTIVE_CONFIG.highlightOnHover,
        debugLogging: INTERACTIVE_CONFIG.debugLogging,
    });
}

/**
 * Enable or disable interactive subtitle functionality
 * @param {boolean} enabled - Whether to enable interactive features
 */
export function setInteractiveEnabled(enabled) {
    interactiveState.isEnabled = enabled;
    INTERACTIVE_CONFIG.enabled = enabled;

    if (!enabled) {
        const boundContainer = activeInteractiveLifecycle?.boundContainer;
        if (boundContainer) {
            removeInteractiveEventListeners(boundContainer);
        }
    }

    logWithFallback('info', 'Interactive subtitles toggled', { enabled });
}

/**
 * Format subtitle text with interactive elements
 * @param {string} text - Original subtitle text
 * @param {Object} options - Formatting options
 * @returns {string} HTML formatted text with interactive elements
 */
export function formatInteractiveSubtitleText(text, options = {}) {
    if (!text || typeof text !== 'string') {
        if (INTERACTIVE_CONFIG.debugLogging) {
            logWithFallback(
                'debug',
                'formatInteractiveSubtitleText: empty or invalid text',
                {
                    valueType: typeof text,
                    textLength: typeof text === 'string' ? text.length : 0,
                }
            );
        }
        return '';
    }

    // Add interactive elements if enabled
    if (interactiveState.isEnabled && INTERACTIVE_CONFIG.clickableWords) {
        const formattedText = wrapWordsForInteraction(text, options);

        if (INTERACTIVE_CONFIG.debugLogging) {
            logWithFallback('debug', 'Interactive words wrapped', {
                isEnabled: interactiveState.isEnabled,
                clickableWords: INTERACTIVE_CONFIG.clickableWords,
                originalLength: text.length,
                wrappedLength: formattedText.length,
                hasSpans: formattedText.includes('dualsub-interactive-word'),
            });
        }
        return formattedText;
    } else {
        if (INTERACTIVE_CONFIG.debugLogging) {
            logWithFallback('debug', 'Interactive wrapping skipped', {
                isEnabled: interactiveState.isEnabled,
                clickableWords: INTERACTIVE_CONFIG.clickableWords,
                debugLogging: INTERACTIVE_CONFIG.debugLogging,
            });
        }
    }

    return escapeHtml(text);
}

/**
 * Wrap words in interactive spans for context analysis
 * @param {string} text - Text to process
 * @param {Object} options - Processing options
 * @returns {string} Text with interactive word spans
 */
function wrapWordsForInteraction(text, options = {}) {
    const {
        sourceLanguage = 'unknown',
        targetLanguage = 'unknown',
        subtitleType = 'original', // Phase 1: require/consume subtitleType
        renderRevision = null,
    } = options;

    // Enhanced word pattern that works with multiple languages including Chinese, Japanese, Korean
    // This pattern matches:
    // - ASCII words with contractions (English, etc.): [a-zA-Z]+(?:'[a-zA-Z]+)*
    // - Chinese characters: [\u4e00-\u9fff]+
    // - Japanese Hiragana: [\u3040-\u309f]+
    // - Japanese Katakana: [\u30a0-\u30ff]+
    // - Korean: [\uac00-\ud7af]+
    // - Numbers: \d+
    const wordPattern =
        /([a-zA-Z]+(?:'[a-zA-Z]+)*|[\u4e00-\u9fff]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[\uac00-\ud7af]+|\d+)/g;

    if (INTERACTIVE_CONFIG.debugLogging) {
        logWithFallback('debug', 'Processing text for interactive words', {
            sourceLanguage,
            targetLanguage,
            textLength: text.length,
        });
    }

    let processedCount = 0;
    let wordIndex = -1;
    let cursor = 0;
    let result = '';

    for (const match of text.matchAll(wordPattern)) {
        const word = match[0];
        // Include all words for phrase analysis - no exclusions
        // This ensures proper spacing and allows selection of function words
        // which are essential for idioms and phrases

        // Only skip empty matches (shouldn't happen with our pattern)
        if (!word || word.length === 0) {
            continue;
        }

        result += escapeHtml(text.slice(cursor, match.index));
        processedCount++;
        wordIndex++;

        result += createInteractiveWordSpan(word, {
            sourceLanguage,
            targetLanguage,
            originalText: text,
            subtitleType,
            wordIndex,
            renderRevision,
        });
        cursor = match.index + word.length;
    }

    result += escapeHtml(text.slice(cursor));

    if (INTERACTIVE_CONFIG.debugLogging) {
        logWithFallback('debug', 'Word wrapping completed', {
            originalLength: text.length,
            resultLength: result.length,
            wordsProcessed: processedCount,
            hasSpans: result.includes('dualsub-interactive-word'),
        });
    }

    return result;
}

/**
 * Create an interactive span element for a word
 * @param {string} word - The word to wrap
 * @param {Object} metadata - Context metadata
 * @returns {string} HTML span element
 */
function createInteractiveWordSpan(word, metadata) {
    const type = metadata.subtitleType || 'original';
    const index = Number.isFinite(metadata.wordIndex) ? metadata.wordIndex : 0;
    const spanId = getStableSpanId(type, index);
    const safeWord = escapeHtml(word);
    const encodedContext = encodeURIComponent(
        String(metadata.originalText).toWellFormed()
    );
    const revisionAttribute =
        type === 'original' &&
        Number.isSafeInteger(metadata.renderRevision) &&
        metadata.renderRevision > 0
            ? ` data-render-revision="${metadata.renderRevision}"`
            : '';

    return `<span class="dualsub-interactive-word" id="${escapeHtml(spanId)}" data-word="${safeWord}" data-source-lang="${escapeHtml(metadata.sourceLanguage)}" data-target-lang="${escapeHtml(metadata.targetLanguage)}" data-context="${escapeHtml(encodedContext)}" data-subtitle-type="${escapeHtml(type)}" data-word-index="${index}"${revisionAttribute} tabindex="0" role="button" aria-label="Click for context analysis of '${safeWord}'" title="Click for cultural, historical, or linguistic context">${safeWord}</span>`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Phase 1: Deterministic span ID helper
 * @param {('original'|'translated'|string)} subtitleType
 * @param {number} wordIndex
 * @returns {string}
 */
export function getStableSpanId(subtitleType, wordIndex) {
    const safeType = String(subtitleType || 'original').toLowerCase();
    const safeIndex = Number.isFinite(wordIndex) ? wordIndex : 0;
    return `dualsub-word-${safeType}-${safeIndex}`;
}

function parseCanonicalSafeInteger(value, { positive = false } = {}) {
    if (typeof value !== 'string') return null;
    const pattern = positive ? /^[1-9]\d*$/ : /^(?:0|[1-9]\d*)$/;
    if (!pattern.test(value)) return null;

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function readOriginalWordMetadata(element) {
    try {
        if (
            !element?.classList?.contains('dualsub-interactive-word') ||
            element.getAttribute('data-subtitle-type') !== 'original'
        ) {
            return null;
        }

        const renderRevision = parseCanonicalSafeInteger(
            element.getAttribute('data-render-revision'),
            { positive: true }
        );
        const wordIndex = parseCanonicalSafeInteger(
            element.getAttribute('data-word-index')
        );
        const word = element.getAttribute('data-word');
        const sourceLanguage = element.getAttribute('data-source-lang');
        const targetLanguage = element.getAttribute('data-target-lang');
        if (
            renderRevision === null ||
            wordIndex === null ||
            typeof word !== 'string' ||
            word.length === 0 ||
            word !== word.trim() ||
            element.textContent !== word ||
            typeof sourceLanguage !== 'string' ||
            sourceLanguage.length === 0 ||
            typeof targetLanguage !== 'string' ||
            targetLanguage.length === 0
        ) {
            return null;
        }

        return Object.freeze({
            renderRevision,
            wordIndex,
            word,
            sourceLanguage,
            targetLanguage,
        });
    } catch (_) {
        return null;
    }
}

function originalWordMetadataEquals(left, right) {
    return Boolean(
        left &&
        right &&
        left.renderRevision === right.renderRevision &&
        left.wordIndex === right.wordIndex &&
        left.word === right.word &&
        left.sourceLanguage === right.sourceLanguage &&
        left.targetLanguage === right.targetLanguage
    );
}

function buildOriginalWordRegistry(lifecycle, container) {
    try {
        if (
            !lifecycle ||
            activeInteractiveLifecycle !== lifecycle ||
            container !==
                document.getElementById('dualsub-original-subtitle') ||
            typeof lifecycle.resolveOriginalWordBindingSnapshot !== 'function'
        ) {
            return null;
        }

        const snapshot =
            lifecycle.resolveOriginalWordBindingSnapshot(container);
        const renderRevision = snapshot?.renderRevision;
        const occurrences = snapshot?.occurrences;
        if (
            snapshot?.element !== container ||
            !Number.isSafeInteger(renderRevision) ||
            renderRevision <= 0 ||
            container.getAttribute('data-render-revision') !==
                String(renderRevision) ||
            !Array.isArray(occurrences) ||
            occurrences.length === 0
        ) {
            return null;
        }

        const liveOccurrences = Array.from(
            container.querySelectorAll(
                '.dualsub-interactive-word[data-subtitle-type="original"]'
            )
        );
        if (liveOccurrences.length !== occurrences.length) return null;

        const registry = new Map();
        for (let index = 0; index < occurrences.length; index += 1) {
            const metadata = occurrences[index];
            const element = metadata?.element;
            const liveMetadata = readOriginalWordMetadata(element);
            if (
                liveOccurrences[index] !== element ||
                !liveMetadata ||
                !originalWordMetadataEquals(liveMetadata, metadata) ||
                element.parentElement !== container ||
                metadata.renderRevision !== renderRevision ||
                metadata.wordIndex !== index ||
                registry.has(element)
            ) {
                return null;
            }
            registry.set(element, metadata);
        }
        return registry;
    } catch (_) {
        return null;
    }
}

function isRegisteredOriginalWordCurrent(lifecycle, element, metadata) {
    try {
        const container = lifecycle?.boundContainer;
        const liveOccurrences = container
            ? container.querySelectorAll(
                  '.dualsub-interactive-word[data-subtitle-type="original"]'
              )
            : [];
        return Boolean(
            lifecycle &&
            interactiveState.isEnabled &&
            activeInteractiveLifecycle === lifecycle &&
            container ===
                document.getElementById('dualsub-original-subtitle') &&
            lifecycle.originalWordRegistry.get(element) === metadata &&
            liveOccurrences.length === lifecycle.originalWordRegistry.size &&
            liveOccurrences[metadata.wordIndex] === element &&
            element.parentElement === container &&
            container.getAttribute('data-render-revision') ===
                String(metadata.renderRevision) &&
            element.classList.contains('dualsub-interactive-word') &&
            element.getAttribute('data-subtitle-type') === 'original' &&
            element.getAttribute('data-render-revision') ===
                String(metadata.renderRevision) &&
            element.getAttribute('data-word-index') ===
                String(metadata.wordIndex) &&
            element.getAttribute('data-word') === metadata.word &&
            element.textContent === metadata.word &&
            element.getAttribute('data-source-lang') ===
                metadata.sourceLanguage &&
            element.getAttribute('data-target-lang') === metadata.targetLanguage
        );
    } catch (_) {
        return false;
    }
}

/**
 * Project a trusted formatter-owned activation into inert intent data.
 * Live DOM attributes are integrity checks only; authority comes from the
 * lifecycle-private immutable registry.
 * @param {Event | Object | null} event
 * @returns {Object | null}
 */
export function projectInteractiveWordIntent(event) {
    try {
        const lifecycle = activeInteractiveLifecycle;
        if (
            !lifecycle ||
            event?.isTrusted !== true ||
            event.currentTarget !== lifecycle.boundContainer ||
            (event.type !== 'click' &&
                !(
                    event.type === 'keydown' &&
                    (event.key === 'Enter' || event.key === ' ')
                ))
        ) {
            return null;
        }

        const metadata = lifecycle.originalWordRegistry.get(event.target);
        if (
            !metadata ||
            !isRegisteredOriginalWordCurrent(lifecycle, event.target, metadata)
        )
            return null;

        return Object.freeze({
            action: 'toggle',
            renderRevision: metadata.renderRevision,
            wordIndex: metadata.wordIndex,
            word: metadata.word,
            sourceLanguage: metadata.sourceLanguage,
            targetLanguage: metadata.targetLanguage,
        });
    } catch (_) {
        return null;
    }
}

/**
 * Resolve an already-authorized selection/removal occurrence without querying
 * mutable page DOM for authority.
 * @param {Object | null} intent
 * @returns {HTMLElement | null}
 */
export function resolveInteractiveOriginalWordOccurrence(intent) {
    try {
        const lifecycle = activeInteractiveLifecycle;
        const renderRevisionDescriptor = Object.getOwnPropertyDescriptor(
            intent || {},
            'renderRevision'
        );
        const wordIndexDescriptor = Object.getOwnPropertyDescriptor(
            intent || {},
            'wordIndex'
        );
        const wordDescriptor = Object.getOwnPropertyDescriptor(
            intent || {},
            'word'
        );
        const renderRevision = renderRevisionDescriptor?.value;
        const wordIndex = wordIndexDescriptor?.value;
        const word = wordDescriptor?.value;
        if (
            !lifecycle ||
            !intent ||
            !Number.isSafeInteger(renderRevision) ||
            renderRevision <= 0 ||
            !Number.isSafeInteger(wordIndex) ||
            wordIndex < 0 ||
            typeof word !== 'string' ||
            word.length === 0
        ) {
            return null;
        }

        let resolvedElement = null;
        for (const [element, metadata] of lifecycle.originalWordRegistry) {
            if (
                metadata.renderRevision === renderRevision &&
                metadata.wordIndex === wordIndex &&
                metadata.word === word &&
                isRegisteredOriginalWordCurrent(lifecycle, element, metadata)
            ) {
                if (resolvedElement !== null) return null;
                resolvedElement = element;
            }
        }
        return resolvedElement;
    } catch (_) {
        return null;
    }
}

/**
 * Attach event listeners to interactive subtitle elements
 * @param {HTMLElement} subtitleElement - The subtitle container element
 * @param {Object} options - Non-authoritative event handling options
 */
export function attachInteractiveEventListeners(subtitleElement, options = {}) {
    const lifecycle = activeInteractiveLifecycle;
    try {
        if (!subtitleElement || !interactiveState.isEnabled) {
            logWithFallback('debug', 'Skipping interactive event listeners', {
                hasElement: !!subtitleElement,
                isEnabled: interactiveState.isEnabled,
            });
            return;
        }

        const isCurrentOriginalContainer = Boolean(
            subtitleElement ===
            document.getElementById('dualsub-original-subtitle')
        );
        const candidateRegistry = isCurrentOriginalContainer
            ? buildOriginalWordRegistry(lifecycle, subtitleElement)
            : null;
        if (isCurrentOriginalContainer && !candidateRegistry) {
            if (activeInteractiveLifecycle === lifecycle) {
                removeInteractiveEventListeners(subtitleElement);
            }
            return false;
        }

        // Validate that handler functions exist
        if (typeof handleInteractiveWordClick !== 'function') {
            throw new Error('handleInteractiveWordClick is not defined');
        }
        if (typeof handleInteractiveWordHover !== 'function') {
            throw new Error('handleInteractiveWordHover is not defined');
        }
        if (typeof handleInteractiveWordLeave !== 'function') {
            throw new Error('handleInteractiveWordLeave is not defined');
        }
        if (typeof handleInteractiveWordKeydown !== 'function') {
            throw new Error('handleInteractiveWordKeydown is not defined');
        }

        // Remove existing listeners to prevent duplicates
        removeInteractiveEventListeners(subtitleElement);

        // Add click event listener for interactive words
        subtitleElement.addEventListener(
            'click',
            handleInteractiveWordClick,
            true
        );

        // Block pointer animations during processing
        const pointerBlocker = (ev) => {
            const t = ev.target;
            if (
                !t ||
                !t.classList ||
                !t.classList.contains('dualsub-interactive-word')
            )
                return;
            if (isAnalyzingActive()) {
                try {
                    t.classList.remove('dualsub-interactive-word--hover');
                } catch (_) {}
                ev.preventDefault();
                ev.stopPropagation();
            }
        };
        subtitleElement.addEventListener('mousedown', pointerBlocker, true);
        subtitleElement.addEventListener('touchstart', pointerBlocker, true);
        subtitleElement._dualsubPointerBlocker = pointerBlocker;

        // Add hover effects if enabled
        if (INTERACTIVE_CONFIG.highlightOnHover) {
            subtitleElement.addEventListener(
                'mouseenter',
                handleInteractiveWordHover,
                true
            );
            subtitleElement.addEventListener(
                'mouseleave',
                handleInteractiveWordLeave,
                true
            );
        }

        // Add keyboard support
        subtitleElement.addEventListener(
            'keydown',
            handleInteractiveWordKeydown,
            true
        );

        // Mark as having interactive listeners
        subtitleElement.setAttribute('data-interactive-listeners', 'true');

        if (isCurrentOriginalContainer) {
            const previousContainer = lifecycle.boundContainer;
            if (previousContainer && previousContainer !== subtitleElement) {
                removeInteractiveEventListeners(previousContainer);
            }
            if (activeInteractiveLifecycle === lifecycle) {
                lifecycle.boundContainer = subtitleElement;
                lifecycle.originalWordRegistry = candidateRegistry;
                if (
                    !Array.from(candidateRegistry).every(
                        ([element, metadata]) =>
                            isRegisteredOriginalWordCurrent(
                                lifecycle,
                                element,
                                metadata
                            )
                    )
                ) {
                    removeInteractiveEventListeners(subtitleElement);
                    return false;
                }
            } else {
                return false;
            }
        }

        logWithFallback('debug', 'Interactive event listeners attached', {
            elementId: subtitleElement.id,
            hasHover: INTERACTIVE_CONFIG.highlightOnHover,
            optionCount:
                options && typeof options === 'object'
                    ? Object.keys(options).length
                    : 0,
        });
        return true;
    } catch (error) {
        if (activeInteractiveLifecycle === lifecycle) {
            removeInteractiveEventListeners(subtitleElement);
        }
        logWithFallback('error', 'Error in attachInteractiveEventListeners', {
            errorType: error?.name || 'UnknownError',
            elementId: subtitleElement?.id,
            isEnabled: interactiveState.isEnabled,
        });
        throw error; // Re-throw to propagate the error
    }
}

/**
 * Remove interactive event listeners from subtitle element
 * @param {HTMLElement} subtitleElement - The subtitle container element
 */
export function removeInteractiveEventListeners(subtitleElement) {
    if (!subtitleElement) {
        return;
    }

    const lifecycle = activeInteractiveLifecycle;
    if (lifecycle?.boundContainer === subtitleElement) {
        lifecycle.boundContainer = null;
        lifecycle.originalWordRegistry.clear();
    }

    subtitleElement.removeEventListener(
        'click',
        handleInteractiveWordClick,
        true
    );
    subtitleElement.removeEventListener(
        'mouseenter',
        handleInteractiveWordHover,
        true
    );
    subtitleElement.removeEventListener(
        'mouseleave',
        handleInteractiveWordLeave,
        true
    );
    subtitleElement.removeEventListener(
        'keydown',
        handleInteractiveWordKeydown,
        true
    );

    // Remove pointer blocker if present
    try {
        if (subtitleElement._dualsubPointerBlocker) {
            subtitleElement.removeEventListener(
                'mousedown',
                subtitleElement._dualsubPointerBlocker,
                true
            );
            subtitleElement.removeEventListener(
                'touchstart',
                subtitleElement._dualsubPointerBlocker,
                true
            );
            delete subtitleElement._dualsubPointerBlocker;
        }
    } catch (_) {}

    subtitleElement.removeAttribute('data-interactive-listeners');

    logWithFallback('debug', 'Interactive event listeners removed', {
        elementId: subtitleElement.id,
    });
}

/**
 * Determine subtitle type from element's container
 * @param {HTMLElement} element - The clicked element
 * @returns {string} 'original' or 'translated'
 */
function getSubtitleTypeFromElement(element) {
    // Walk up the DOM tree to find subtitle container
    let current = element;
    while (current && current !== document.body) {
        // Check for DualSub subtitle container IDs
        if (current.id) {
            if (current.id.includes('original')) {
                return 'original';
            }
            if (current.id.includes('translated')) {
                return 'translated';
            }
        }

        // Check for DualSub subtitle container classes
        if (current.className) {
            if (current.className.includes('original')) {
                return 'original';
            }
            if (current.className.includes('translated')) {
                return 'translated';
            }
        }

        current = current.parentElement;
    }

    // Default to original if we can't determine
    logWithFallback(
        'warn',
        'Could not determine subtitle type, defaulting to original',
        {
            elementId: element.id,
            elementClass: element.className,
        }
    );
    return 'original';
}

/**
 * Handle click events on interactive words
 * @param {Event} event - Click event
 */
function handleInteractiveWordClick(event) {
    const lifecycle = activeInteractiveLifecycle;
    if (!lifecycle) return;

    if (lifecycle.publishWordIntent) {
        const intent = projectInteractiveWordIntent(event);
        if (!intent) return;

        event.preventDefault();
        event.stopPropagation();

        if (isAnalyzingActive()) {
            try {
                event.target.classList.remove(
                    'dualsub-interactive-word--hover'
                );
            } catch (_) {}
            return;
        }

        const now = Date.now();
        if (
            now - interactiveState.lastClickTime <
            INTERACTIVE_CONFIG.debounceDelay
        ) {
            return;
        }
        interactiveState.lastClickTime = now;

        try {
            lifecycle.publishWordIntent(intent);
        } catch (_) {}
        return;
    }

    const target = event.target;

    if (!target.classList.contains('dualsub-interactive-word')) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Block interactions globally while analyzing to prevent de-selections during processing
    if (isAnalyzingActive()) {
        try {
            target.classList.remove('dualsub-interactive-word--hover');
        } catch (_) {}
        return;
    }

    // Debounce rapid clicks
    const now = Date.now();
    if (
        now - interactiveState.lastClickTime <
        INTERACTIVE_CONFIG.debounceDelay
    ) {
        return;
    }
    interactiveState.lastClickTime = now;

    const word = target.getAttribute('data-word');
    const sourceLanguage = target.getAttribute('data-source-lang');
    const targetLanguage = target.getAttribute('data-target-lang');
    const context = decodeURIComponent(
        target.getAttribute('data-context') || ''
    );

    logWithFallback('info', 'Interactive word clicked', {
        wordLength: word?.length || 0,
        sourceLanguage,
        targetLanguage,
    });

    // Enhanced selection mode - dispatch word selection event
    // Determine subtitle type from element's container
    const subtitleType = getSubtitleTypeFromElement(target);

    logWithFallback('info', 'Dispatching word selection event', {
        wordLength: word?.length || 0,
        subtitleType,
    });

    document.dispatchEvent(
        new CustomEvent('dualsub-word-selected', {
            detail: {
                word,
                element: target,
                sourceLanguage,
                targetLanguage,
                context,
                subtitleType,
            },
        })
    );

    logWithFallback('debug', 'Word selection event dispatched (video paused)', {
        wordLength: word?.length || 0,
        subtitleType,
    });
}

/**
 * Handle hover events on interactive words
 * @param {Event} event - Mouse enter event
 */
function handleInteractiveWordHover(event) {
    const target = event.target;

    if (!target.classList.contains('dualsub-interactive-word')) {
        return;
    }

    // Suppress hover visual during processing
    if (isAnalyzingActive()) {
        try {
            target.classList.remove('dualsub-interactive-word--hover');
        } catch (_) {}
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    target.classList.add('dualsub-interactive-word--hover');
}

/**
 * Handle mouse leave events on interactive words
 * @param {Event} event - Mouse leave event
 */
function handleInteractiveWordLeave(event) {
    const target = event.target;

    if (!target.classList.contains('dualsub-interactive-word')) {
        return;
    }

    target.classList.remove('dualsub-interactive-word--hover');
}

/**
 * Handle keyboard events on interactive words
 * @param {Event} event - Keydown event
 */
function handleInteractiveWordKeydown(event) {
    if (!activeInteractiveLifecycle) return;

    const target = event.target;

    if (!target.classList.contains('dualsub-interactive-word')) {
        return;
    }

    // Suppress keyboard activation during processing
    if (isAnalyzingActive()) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    // Handle Enter and Space key presses
    if (event.key === 'Enter' || event.key === ' ') {
        handleInteractiveWordClick(event);
    }
}

/**
 * Get current interactive subtitle configuration
 * @returns {Object} Current configuration
 */
export function getInteractiveConfig() {
    return { ...INTERACTIVE_CONFIG };
}

/**
 * Update interactive subtitle configuration
 * @param {Object} newConfig - New configuration options
 */
export function updateInteractiveConfig(newConfig) {
    Object.assign(INTERACTIVE_CONFIG, newConfig);
    interactiveState.isEnabled = INTERACTIVE_CONFIG.enabled;

    logWithFallback('info', 'Interactive subtitle configuration updated', {
        enabled: interactiveState.isEnabled,
        clickableWords: INTERACTIVE_CONFIG.clickableWords,
        highlightOnHover: INTERACTIVE_CONFIG.highlightOnHover,
        debugLogging: INTERACTIVE_CONFIG.debugLogging,
    });
}
