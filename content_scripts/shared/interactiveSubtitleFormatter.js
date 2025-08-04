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
        console.log(`[InteractiveFormatter] [${level.toUpperCase()}] ${message}`, data || {});
    };

    const logWrapper = (level, message, data) => {
        try {
            currentLogger(level, message, data);
        } catch (error) {
            console.log(`[InteractiveFormatter] [${level.toUpperCase()}] ${message}`, data || {});
        }
    };

    console.log('[InteractiveFormatter] Using fallback logging (enhanced logging not available)');

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
    debounceDelay: 300
};

/**
 * State management for interactive subtitles
 */
const interactiveState = {
    isEnabled: false,
    currentSelection: null,
    pendingRequests: new Map(),
    contextModal: null,
    lastClickTime: 0
};

/**
 * Initialize interactive subtitle functionality
 * @param {Object} config - Configuration options
 */
export function initializeInteractiveSubtitles(config = {}) {
    Object.assign(INTERACTIVE_CONFIG, config);
    interactiveState.isEnabled = INTERACTIVE_CONFIG.enabled;
    
    logWithFallback('info', 'Interactive subtitles initialized', {
        enabled: interactiveState.isEnabled,
        config: INTERACTIVE_CONFIG
    });
}

/**
 * Enable or disable interactive subtitle functionality
 * @param {boolean} enabled - Whether to enable interactive features
 */
export function setInteractiveEnabled(enabled) {
    interactiveState.isEnabled = enabled;
    INTERACTIVE_CONFIG.enabled = enabled;
    
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
        logWithFallback('debug', 'formatInteractiveSubtitleText: empty or invalid text', { text });
        return '';
    }

    // Basic HTML escaping
    let formattedText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Add interactive elements if enabled
    if (interactiveState.isEnabled && INTERACTIVE_CONFIG.clickableWords) {
        const originalText = formattedText;
        formattedText = wrapWordsForInteraction(formattedText, options);

        logWithFallback('debug', 'Interactive words wrapped', {
            isEnabled: interactiveState.isEnabled,
            clickableWords: INTERACTIVE_CONFIG.clickableWords,
            originalLength: originalText.length,
            wrappedLength: formattedText.length,
            hasSpans: formattedText.includes('dualsub-interactive-word'),
            sampleOriginal: originalText.substring(0, 30),
            sampleWrapped: formattedText.substring(0, 100)
        });
    } else {
        logWithFallback('debug', 'Interactive wrapping skipped', {
            isEnabled: interactiveState.isEnabled,
            clickableWords: INTERACTIVE_CONFIG.clickableWords,
            config: INTERACTIVE_CONFIG
        });
    }

    return formattedText;
}

/**
 * Wrap words in interactive spans for context analysis
 * @param {string} text - Text to process
 * @param {Object} options - Processing options
 * @returns {string} Text with interactive word spans
 */
function wrapWordsForInteraction(text, options = {}) {
    const { sourceLanguage = 'unknown', targetLanguage = 'unknown' } = options;

    // Enhanced word pattern that works with multiple languages including Chinese, Japanese, Korean
    // This pattern matches:
    // - ASCII words with contractions (English, etc.): [a-zA-Z]+(?:'[a-zA-Z]+)*
    // - Chinese characters: [\u4e00-\u9fff]+
    // - Japanese Hiragana: [\u3040-\u309f]+
    // - Japanese Katakana: [\u30a0-\u30ff]+
    // - Korean: [\uac00-\ud7af]+
    // - Numbers: \d+
    const wordPattern = /([a-zA-Z]+(?:'[a-zA-Z]+)*|[\u4e00-\u9fff]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[\uac00-\ud7af]+|\d+)/g;

    logWithFallback('debug', 'Processing text for interactive words', {
        originalText: text,
        sourceLanguage,
        targetLanguage,
        textLength: text.length
    });

    let processedCount = 0;
    const result = text.replace(wordPattern, (match, word) => {
        // Include all words for phrase analysis - no exclusions
        // This ensures proper spacing and allows selection of function words
        // which are essential for idioms and phrases

        // Only skip empty matches (shouldn't happen with our pattern)
        if (!word || word.length === 0) {
            return word;
        }

        // Define isAsciiWord for debugging purposes (includes contractions)
        const isAsciiWord = /^[a-zA-Z]+(?:'[a-zA-Z]+)*$/.test(word);

        processedCount++;

        return createInteractiveWordSpan(word, {
            sourceLanguage,
            targetLanguage,
            originalText: text
        });
    });

    logWithFallback('debug', 'Word wrapping completed', {
        originalLength: text.length,
        resultLength: result.length,
        wordsProcessed: processedCount,
        hasSpans: result.includes('dualsub-interactive-word')
    });

    return result;
}

/**
 * Create an interactive span element for a word
 * @param {string} word - The word to wrap
 * @param {Object} metadata - Context metadata
 * @returns {string} HTML span element
 */
function createInteractiveWordSpan(word, metadata) {
    const spanId = `interactive-word-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    return `<span class="dualsub-interactive-word" id="${spanId}" data-word="${word}" data-source-lang="${metadata.sourceLanguage}" data-target-lang="${metadata.targetLanguage}" data-context="${encodeURIComponent(metadata.originalText)}" tabindex="0" role="button" aria-label="Click for context analysis of '${word}'" title="Click for cultural, historical, or linguistic context">${word}</span>`;
}

/**
 * Attach event listeners to interactive subtitle elements
 * @param {HTMLElement} subtitleElement - The subtitle container element
 * @param {Object} options - Event handling options
 */
export function attachInteractiveEventListeners(subtitleElement, options = {}) {
    try {
        if (!subtitleElement || !interactiveState.isEnabled) {
            logWithFallback('debug', 'Skipping interactive event listeners', {
                hasElement: !!subtitleElement,
                isEnabled: interactiveState.isEnabled
            });
            return;
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
        subtitleElement.addEventListener('click', handleInteractiveWordClick, true);

        // Add hover effects if enabled
        if (INTERACTIVE_CONFIG.highlightOnHover) {
            subtitleElement.addEventListener('mouseenter', handleInteractiveWordHover, true);
            subtitleElement.addEventListener('mouseleave', handleInteractiveWordLeave, true);
        }

        // Add keyboard support
        subtitleElement.addEventListener('keydown', handleInteractiveWordKeydown, true);

        // Mark as having interactive listeners
        subtitleElement.setAttribute('data-interactive-listeners', 'true');

        logWithFallback('debug', 'Interactive event listeners attached', {
            elementId: subtitleElement.id,
            hasHover: INTERACTIVE_CONFIG.highlightOnHover,
            options
        });
    } catch (error) {
        logWithFallback('error', 'Error in attachInteractiveEventListeners', {
            error: error.message,
            stack: error.stack,
            name: error.name,
            elementId: subtitleElement?.id,
            isEnabled: interactiveState.isEnabled,
            config: INTERACTIVE_CONFIG
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

    subtitleElement.removeEventListener('click', handleInteractiveWordClick, true);
    subtitleElement.removeEventListener('mouseenter', handleInteractiveWordHover, true);
    subtitleElement.removeEventListener('mouseleave', handleInteractiveWordLeave, true);
    subtitleElement.removeEventListener('keydown', handleInteractiveWordKeydown, true);

    subtitleElement.removeAttribute('data-interactive-listeners');

    logWithFallback('debug', 'Interactive event listeners removed', {
        elementId: subtitleElement.id
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
    logWithFallback('warn', 'Could not determine subtitle type, defaulting to original', {
        elementId: element.id,
        elementClass: element.className
    });
    return 'original';
}

/**
 * Handle click events on interactive words
 * @param {Event} event - Click event
 */
function handleInteractiveWordClick(event) {
    const target = event.target;

    if (!target.classList.contains('dualsub-interactive-word')) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Debounce rapid clicks
    const now = Date.now();
    if (now - interactiveState.lastClickTime < INTERACTIVE_CONFIG.debounceDelay) {
        return;
    }
    interactiveState.lastClickTime = now;

    const word = target.getAttribute('data-word');
    const sourceLanguage = target.getAttribute('data-source-lang');
    const targetLanguage = target.getAttribute('data-target-lang');
    const context = decodeURIComponent(target.getAttribute('data-context') || '');

    logWithFallback('info', 'Interactive word clicked', {
        word,
        sourceLanguage,
        targetLanguage
    });

    // Check if video is paused for enhanced selection mode
    const videoElement = document.querySelector('video');
    const isVideoPaused = videoElement ? videoElement.paused : false;

    logWithFallback('info', 'Interactive word clicked', {
        word,
        isVideoPaused,
        hasVideoElement: !!videoElement,
        targetElement: target.tagName,
        targetClass: target.className
    });

    if (isVideoPaused) {
        // Enhanced selection mode - dispatch word selection event
        // Determine subtitle type from element's container
        const subtitleType = getSubtitleTypeFromElement(target);

        logWithFallback('info', 'Dispatching word selection event', {
            word,
            subtitleType,
            isVideoPaused
        });

        document.dispatchEvent(new CustomEvent('dualsub-word-selected', {
            detail: {
                word,
                element: target,
                sourceLanguage,
                targetLanguage,
                context,
                subtitleType
            }
        }));

        logWithFallback('debug', 'Word selection event dispatched (video paused)', {
            word,
            subtitleType
        });
    } else {
        // Video is playing - no action taken
        // Context analysis can only be initiated through the modal when video is paused
        logWithFallback('debug', 'Word click ignored - video is playing. Pause video to select words for analysis.', {
            word,
            sourceLanguage,
            targetLanguage
        });
    }
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
    const target = event.target;
    
    if (!target.classList.contains('dualsub-interactive-word')) {
        return;
    }

    // Handle Enter and Space key presses
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleInteractiveWordClick(event);
    }
}

/**
 * Request context analysis for a word or phrase
 * @param {string} text - Text to analyze
 * @param {Object} metadata - Context metadata
 */
async function requestContextAnalysis(text, metadata = {}) {
    const requestId = `context-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    try {
        // Add visual feedback
        if (metadata.clickedElement) {
            metadata.clickedElement.classList.add('dualsub-interactive-word--loading');
        }

        logWithFallback('debug', 'Requesting context analysis', {
            requestId,
            text,
            metadata
        });

        // Send message to background script for context analysis
        const response = await chrome.runtime.sendMessage({
            action: 'analyzeContext',
            text: text,
            contextType: 'all',
            metadata: {
                sourceLanguage: metadata.sourceLanguage,
                targetLanguage: metadata.targetLanguage,
                surroundingContext: metadata.surroundingContext
            }
        });

        if (response && response.success) {
            showContextModal(response, metadata);
        } else {
            showContextError(response?.error || 'Context analysis failed', metadata);
        }

    } catch (error) {
        logWithFallback('error', 'Context analysis request failed', {
            requestId,
            error: error.message
        });
        showContextError(error.message, metadata);
    } finally {
        // Remove loading state
        if (metadata.clickedElement) {
            metadata.clickedElement.classList.remove('dualsub-interactive-word--loading');
        }
    }
}

/**
 * Show context analysis modal
 * @param {Object} contextResult - Context analysis result
 * @param {Object} metadata - Request metadata
 */
function showContextModal(contextResult, metadata) {
    // This will be implemented in the context modal component
    logWithFallback('info', 'Showing context modal', {
        contextType: contextResult.contextType,
        hasAnalysis: !!contextResult.analysis
    });

    // Dispatch custom event for modal display
    document.dispatchEvent(new CustomEvent('dualsub-show-context', {
        detail: {
            contextResult,
            metadata
        }
    }));
}

/**
 * Show context analysis error
 * @param {string} error - Error message
 * @param {Object} metadata - Request metadata
 */
function showContextError(error, metadata) {
    logWithFallback('warn', 'Context analysis error', { error });

    // Dispatch custom event for error display
    document.dispatchEvent(new CustomEvent('dualsub-context-error', {
        detail: {
            error,
            metadata
        }
    }));
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
        config: INTERACTIVE_CONFIG
    });
}
