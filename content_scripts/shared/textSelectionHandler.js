/**
 * Text Selection Handler for Interactive Subtitles
 * 
 * Handles intelligent text selection for context analysis, including
 * word/phrase detection, context boundary analysis, and selection optimization.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

// Robust logging function that's always available
const logWithFallback = (() => {
    // Default fallback implementation
    let currentLogger = (level, message, data) => {
        console.log(`[TextSelection] [${level.toUpperCase()}] ${message}`, data || {});
    };

    // Return a wrapper function that always calls the current logger
    const logWrapper = (level, message, data) => {
        try {
            currentLogger(level, message, data);
        } catch (error) {
            // Ultimate fallback if even the logger fails
            console.log(`[TextSelection] [${level.toUpperCase()}] ${message}`, data || {});
        }
    };

    console.log('[TextSelection] Using fallback logging (enhanced logging not available)');

    return logWrapper;
})();

/**
 * Selection configuration
 */
const SELECTION_CONFIG = {
    maxSelectionLength: 100,
    minSelectionLength: 1,
    contextWindowSize: 50,
    phraseDelimiters: ['.', '!', '?', ';', ':', ','],
    wordBoundaries: [' ', '\t', '\n', '\r'],
    expandSelection: true,
    smartBoundaries: true
};

/**
 * Selection state management
 */
const selectionState = {
    isSelecting: false,
    currentSelection: null,
    selectionStart: null,
    selectionEnd: null,
    lastSelection: null
};

/**
 * Initialize text selection functionality
 * @param {Object} config - Configuration options
 */
export function initializeTextSelection(config = {}) {
    Object.assign(SELECTION_CONFIG, config);



    logWithFallback('info', 'Text selection handler initialized (automatic analysis disabled)', {
        config: SELECTION_CONFIG,
        note: 'Automatic text selection analysis disabled - modal-only workflow'
    });
}

/**
 * Handle mouse up events for text selection
 * @param {MouseEvent} event - Mouse up event
 */
function handleMouseUp(event) {
    // Only handle selections within subtitle elements
    if (!isSubtitleElement(event.target)) {
        return;
    }

    setTimeout(() => {
        const selection = window.getSelection();
        if (selection && selection.toString().trim()) {
            processTextSelection(selection, event);
        }
    }, 10); // Small delay to ensure selection is complete
}

/**
 * Handle keyboard events for text selection
 * @param {KeyboardEvent} event - Key up event
 */
function handleKeyUp(event) {
    // Handle selection via keyboard (Shift + Arrow keys, etc.)
    if (event.shiftKey || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const selection = window.getSelection();
        if (selection && selection.toString().trim()) {
            processTextSelection(selection, event);
        }
    }
}

/**
 * Handle selection change events
 * @param {Event} event - Selection change event
 */
function handleSelectionChange(event) {
    const selection = window.getSelection();
    
    if (!selection || !selection.toString().trim()) {
        clearSelectionState();
        return;
    }

    // Check if selection is within subtitle elements
    const range = selection.getRangeAt(0);
    if (!isSelectionInSubtitles(range)) {
        return;
    }

    updateSelectionState(selection);
}

/**
 * Process text selection for context analysis
 * @param {Selection} selection - Browser selection object
 * @param {Event} event - Triggering event
 */
function processTextSelection(selection, event) {
    if (!selection || !selection.toString().trim()) {
        return;
    }

    const selectedText = selection.toString().trim();
    
    // Validate selection length
    if (selectedText.length < SELECTION_CONFIG.minSelectionLength ||
        selectedText.length > SELECTION_CONFIG.maxSelectionLength) {
        logWithFallback('debug', 'Selection length out of bounds', {
            length: selectedText.length,
            min: SELECTION_CONFIG.minSelectionLength,
            max: SELECTION_CONFIG.maxSelectionLength
        });
        return;
    }

    // Get enhanced selection with context
    const enhancedSelection = enhanceSelection(selection);
    
    if (enhancedSelection) {
        selectionState.currentSelection = enhancedSelection;
        selectionState.lastSelection = enhancedSelection;
        
        logWithFallback('info', 'Text selection processed', {
            selectedText: enhancedSelection.text,
            hasContext: !!enhancedSelection.context,
            source: event.type
        });

        // Trigger context analysis
        requestContextForSelection(enhancedSelection, event);
    }
}

/**
 * Enhance selection with context and metadata
 * @param {Selection} selection - Browser selection object
 * @returns {Object|null} Enhanced selection object
 */
function enhanceSelection(selection) {
    try {
        const range = selection.getRangeAt(0);
        const selectedText = selection.toString().trim();
        
        // Get surrounding context
        const context = extractSurroundingContext(range);
        
        // Detect language and subtitle type
        const metadata = extractSelectionMetadata(range);
        
        // Optimize selection boundaries if enabled
        const optimizedText = SELECTION_CONFIG.smartBoundaries 
            ? optimizeSelectionBoundaries(selectedText, context.full)
            : selectedText;

        return {
            text: optimizedText,
            originalText: selectedText,
            context: context,
            metadata: metadata,
            range: range,
            timestamp: Date.now()
        };

    } catch (error) {
        logWithFallback('error', 'Failed to enhance selection', {
            error: error.message
        });
        return null;
    }
}

/**
 * Extract surrounding context from selection range
 * @param {Range} range - Selection range
 * @returns {Object} Context object with before, after, and full text
 */
function extractSurroundingContext(range) {
    const container = range.commonAncestorContainer;
    const containerText = getContainerText(container);
    
    if (!containerText) {
        return { before: '', after: '', full: '' };
    }

    // Find selection position in container text
    const selectedText = range.toString();
    const selectionStart = containerText.indexOf(selectedText);
    
    if (selectionStart === -1) {
        return { before: '', after: '', full: containerText };
    }

    const selectionEnd = selectionStart + selectedText.length;
    
    // Extract context windows
    const contextStart = Math.max(0, selectionStart - SELECTION_CONFIG.contextWindowSize);
    const contextEnd = Math.min(containerText.length, selectionEnd + SELECTION_CONFIG.contextWindowSize);
    
    return {
        before: containerText.substring(contextStart, selectionStart).trim(),
        after: containerText.substring(selectionEnd, contextEnd).trim(),
        full: containerText.substring(contextStart, contextEnd).trim()
    };
}

/**
 * Extract metadata from selection range
 * @param {Range} range - Selection range
 * @returns {Object} Metadata object
 */
function extractSelectionMetadata(range) {
    const container = findSubtitleContainer(range.commonAncestorContainer);
    
    if (!container) {
        return {
            subtitleType: 'unknown',
            sourceLanguage: 'unknown',
            targetLanguage: 'unknown'
        };
    }

    // Determine subtitle type from container ID
    const subtitleType = getSubtitleType(container);
    
    // Extract language information from data attributes or container
    const sourceLanguage = container.getAttribute('data-source-lang') || 'unknown';
    const targetLanguage = container.getAttribute('data-target-lang') || 'unknown';

    return {
        subtitleType,
        sourceLanguage,
        targetLanguage,
        containerId: container.id,
        containerClass: container.className
    };
}

/**
 * Optimize selection boundaries for better context analysis
 * @param {string} selectedText - Originally selected text
 * @param {string} fullContext - Full context text
 * @returns {string} Optimized selection text
 */
function optimizeSelectionBoundaries(selectedText, fullContext) {
    if (!SELECTION_CONFIG.expandSelection) {
        return selectedText;
    }

    // Find the selection in context
    const selectionIndex = fullContext.indexOf(selectedText);
    if (selectionIndex === -1) {
        return selectedText;
    }

    let start = selectionIndex;
    let end = selectionIndex + selectedText.length;

    // Expand to word boundaries
    while (start > 0 && !isWordBoundary(fullContext[start - 1])) {
        start--;
    }

    while (end < fullContext.length && !isWordBoundary(fullContext[end])) {
        end++;
    }

    // Don't expand beyond phrase boundaries
    const phraseStart = findPhraseStart(fullContext, start);
    const phraseEnd = findPhraseEnd(fullContext, end);

    start = Math.max(start, phraseStart);
    end = Math.min(end, phraseEnd);

    const optimizedText = fullContext.substring(start, end).trim();
    
    // Ensure optimized text isn't too long
    if (optimizedText.length > SELECTION_CONFIG.maxSelectionLength) {
        return selectedText;
    }

    logWithFallback('debug', 'Selection boundaries optimized', {
        original: selectedText,
        optimized: optimizedText,
        expanded: optimizedText !== selectedText
    });

    return optimizedText;
}

/**
 * Check if character is a word boundary
 * @param {string} char - Character to check
 * @returns {boolean} True if word boundary
 */
function isWordBoundary(char) {
    return SELECTION_CONFIG.wordBoundaries.includes(char);
}

/**
 * Find phrase start boundary
 * @param {string} text - Text to search
 * @param {number} position - Starting position
 * @returns {number} Phrase start position
 */
function findPhraseStart(text, position) {
    for (let i = position - 1; i >= 0; i--) {
        if (SELECTION_CONFIG.phraseDelimiters.includes(text[i])) {
            return i + 1;
        }
    }
    return 0;
}

/**
 * Find phrase end boundary
 * @param {string} text - Text to search
 * @param {number} position - Starting position
 * @returns {number} Phrase end position
 */
function findPhraseEnd(text, position) {
    for (let i = position; i < text.length; i++) {
        if (SELECTION_CONFIG.phraseDelimiters.includes(text[i])) {
            return i;
        }
    }
    return text.length;
}

/**
 * Check if element is a subtitle element
 * @param {Element} element - Element to check
 * @returns {boolean} True if subtitle element
 */
function isSubtitleElement(element) {
    if (!element) return false;
    
    // Check if element or its parents are subtitle containers
    let current = element;
    while (current && current !== document.body) {
        if (current.id && (
            current.id.includes('subtitle') ||
            current.id.includes('dualsub') ||
            current.id.includes('disneyplus')
        )) {
            return true;
        }
        
        if (current.className && (
            current.className.includes('subtitle') ||
            current.className.includes('dualsub')
        )) {
            return true;
        }
        
        current = current.parentElement;
    }
    
    return false;
}

/**
 * Check if selection is within subtitle elements
 * @param {Range} range - Selection range
 * @returns {boolean} True if selection is in subtitles
 */
function isSelectionInSubtitles(range) {
    return isSubtitleElement(range.startContainer) || 
           isSubtitleElement(range.endContainer) ||
           isSubtitleElement(range.commonAncestorContainer);
}

/**
 * Find subtitle container for an element
 * @param {Node} node - Node to search from
 * @returns {Element|null} Subtitle container element
 */
function findSubtitleContainer(node) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    
    while (current && current !== document.body) {
        if (current.id && (
            current.id.includes('subtitle') ||
            current.id.includes('dualsub')
        )) {
            return current;
        }
        current = current.parentElement;
    }
    
    return null;
}

/**
 * Get subtitle type from container
 * @param {Element} container - Subtitle container
 * @returns {string} Subtitle type
 */
function getSubtitleType(container) {
    if (!container || !container.id) {
        return 'unknown';
    }
    
    if (container.id.includes('original')) {
        return 'original';
    } else if (container.id.includes('translated')) {
        return 'translated';
    }
    
    return 'unknown';
}

/**
 * Get text content from container
 * @param {Node} container - Container node
 * @returns {string} Text content
 */
function getContainerText(container) {
    const subtitleContainer = findSubtitleContainer(container);
    return subtitleContainer ? subtitleContainer.textContent || '' : '';
}

/**
 * Request context analysis for selection
 * @param {Object} selection - Enhanced selection object
 * @param {Event} event - Triggering event
 */
function requestContextForSelection(selection, event) {
    // Dispatch custom event for context analysis
    document.dispatchEvent(new CustomEvent('dualsub-analyze-selection', {
        detail: {
            selection,
            event: {
                type: event.type,
                clientX: event.clientX,
                clientY: event.clientY
            }
        }
    }));
}

/**
 * Update selection state
 * @param {Selection} selection - Browser selection
 */
function updateSelectionState(selection) {
    selectionState.isSelecting = true;
    selectionState.selectionStart = selection.anchorOffset;
    selectionState.selectionEnd = selection.focusOffset;
}

/**
 * Clear selection state
 */
function clearSelectionState() {
    selectionState.isSelecting = false;
    selectionState.currentSelection = null;
    selectionState.selectionStart = null;
    selectionState.selectionEnd = null;
}

/**
 * Get current selection state
 * @returns {Object} Current selection state
 */
export function getSelectionState() {
    return { ...selectionState };
}

/**
 * Get last processed selection
 * @returns {Object|null} Last selection object
 */
export function getLastSelection() {
    return selectionState.lastSelection;
}

/**
 * Clear last selection
 */
export function clearLastSelection() {
    selectionState.lastSelection = null;
}

/**
 * Update selection configuration
 * @param {Object} newConfig - New configuration options
 */
export function updateSelectionConfig(newConfig) {
    Object.assign(SELECTION_CONFIG, newConfig);
    
    logWithFallback('info', 'Text selection configuration updated', {
        config: SELECTION_CONFIG
    });
}
