/**
 * Context Loading States and Error Handling
 * 
 * Provides loading indicators, error states, and graceful fallbacks
 * for AI context analysis requests with user-friendly feedback.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

// Robust logging function that's always available
const logWithFallback = (() => {
    // Default fallback implementation
    let currentLogger = (level, message, data) => {
        console.log(`[LoadingStates] [${level.toUpperCase()}] ${message}`, data || {});
    };

    // Return a wrapper function that always calls the current logger
    const logWrapper = (level, message, data) => {
        try {
            currentLogger(level, message, data);
        } catch (error) {
            // Ultimate fallback if even the logger fails
            console.log(`[LoadingStates] [${level.toUpperCase()}] ${message}`, data || {});
        }
    };

    console.log('[LoadingStates] Using fallback logging (enhanced logging not available)');

    return logWrapper;
})();

/**
 * Loading state configuration
 */
const LOADING_CONFIG = {
    showLoadingAfter: 500, // Show loading indicator after 500ms
    hideLoadingAfter: 30000, // Hide loading after 30 seconds (timeout)
    retryDelay: 2000, // Delay between retry attempts
    maxRetries: 3, // Maximum number of retries
    animationDuration: 200 // Animation duration in ms
};

/**
 * Loading state management
 */
const loadingState = {
    activeRequests: new Map(),
    loadingElements: new Map(),
    errorElements: new Map(),
    retryAttempts: new Map()
};

/**
 * Initialize loading states functionality
 * @param {Object} config - Configuration options
 */
export function initializeLoadingStates(config = {}) {
    Object.assign(LOADING_CONFIG, config);



    logWithFallback('info', 'Context loading states initialized (full-screen overlays disabled)', {
        config: LOADING_CONFIG,
        note: 'Full-screen loading overlays disabled - modal-only processing UI'
    });
}

/**
 * Handle analysis start event
 * @param {CustomEvent} event - Analysis start event
 */
function handleAnalysisStart(event) {
    const { selection } = event.detail;
    const requestId = generateRequestId(selection);
    
    // Start loading state
    startLoading(requestId, selection);
    
    logWithFallback('debug', 'Context analysis started', {
        requestId,
        text: selection.text
    });
}

/**
 * Handle analysis success event
 * @param {CustomEvent} event - Analysis success event
 */
function handleAnalysisSuccess(event) {
    const { contextResult } = event.detail;
    const requestId = generateRequestId({ text: contextResult.originalText });
    
    // Stop loading state
    stopLoading(requestId, true);
    
    logWithFallback('debug', 'Context analysis succeeded', {
        requestId,
        contextType: contextResult.contextType
    });
}

/**
 * Handle analysis error event
 * @param {CustomEvent} event - Analysis error event
 */
function handleAnalysisError(event) {
    const { error, metadata } = event.detail;
    const requestId = generateRequestId({ text: metadata?.selectedText || 'unknown' });
    
    // Stop loading and show error
    stopLoading(requestId, false);
    showError(requestId, error, metadata);
    
    logWithFallback('warn', 'Context analysis failed', {
        requestId,
        error
    });
}

/**
 * Start loading state for a request
 * @param {string} requestId - Unique request identifier
 * @param {Object} selection - Selection object
 */
function startLoading(requestId, selection) {
    // Clear any existing error state
    clearError(requestId);
    
    // Set up loading timeout
    const loadingTimeout = setTimeout(() => {
        showLoadingIndicator(requestId, selection);
    }, LOADING_CONFIG.showLoadingAfter);
    
    // Set up request timeout
    const requestTimeout = setTimeout(() => {
        handleRequestTimeout(requestId, selection);
    }, LOADING_CONFIG.hideLoadingAfter);
    
    loadingState.activeRequests.set(requestId, {
        selection,
        loadingTimeout,
        requestTimeout,
        startTime: Date.now()
    });
    
    logWithFallback('debug', 'Loading state started', {
        requestId,
        text: selection.text
    });
}

/**
 * Stop loading state for a request
 * @param {string} requestId - Request identifier
 * @param {boolean} success - Whether the request was successful
 */
function stopLoading(requestId, success) {
    const request = loadingState.activeRequests.get(requestId);
    
    if (request) {
        // Clear timeouts
        clearTimeout(request.loadingTimeout);
        clearTimeout(request.requestTimeout);
        
        // Remove from active requests
        loadingState.activeRequests.delete(requestId);
        
        // Hide loading indicator
        hideLoadingIndicator(requestId);
        
        // Clear retry attempts on success
        if (success) {
            loadingState.retryAttempts.delete(requestId);
        }
        
        const duration = Date.now() - request.startTime;
        logWithFallback('debug', 'Loading state stopped', {
            requestId,
            success,
            duration
        });
    }
}

/**
 * Show loading indicator
 * @param {string} requestId - Request identifier
 * @param {Object} selection - Selection object
 */
function showLoadingIndicator(requestId, selection) {
    // Create loading element
    const loadingElement = createLoadingElement(requestId, selection);
    
    if (loadingElement) {
        document.body.appendChild(loadingElement);
        loadingState.loadingElements.set(requestId, loadingElement);
        
        // Animate in
        requestAnimationFrame(() => {
            loadingElement.classList.add('dualsub-loading--visible');
        });
        
        logWithFallback('debug', 'Loading indicator shown', { requestId });
    }
}

/**
 * Hide loading indicator
 * @param {string} requestId - Request identifier
 */
function hideLoadingIndicator(requestId) {
    const loadingElement = loadingState.loadingElements.get(requestId);
    
    if (loadingElement) {
        loadingElement.classList.remove('dualsub-loading--visible');
        
        setTimeout(() => {
            if (loadingElement.parentNode) {
                loadingElement.parentNode.removeChild(loadingElement);
            }
            loadingState.loadingElements.delete(requestId);
        }, LOADING_CONFIG.animationDuration);
        
        logWithFallback('debug', 'Loading indicator hidden', { requestId });
    }
}

/**
 * Show error state
 * @param {string} requestId - Request identifier
 * @param {string} error - Error message
 * @param {Object} metadata - Error metadata
 */
function showError(requestId, error, metadata = {}) {
    // Clear any existing error
    clearError(requestId);
    
    // Create error element
    const errorElement = createErrorElement(requestId, error, metadata);
    
    if (errorElement) {
        document.body.appendChild(errorElement);
        loadingState.errorElements.set(requestId, errorElement);
        
        // Animate in
        requestAnimationFrame(() => {
            errorElement.classList.add('dualsub-error--visible');
        });
        
        // Auto-hide after delay
        setTimeout(() => {
            hideError(requestId);
        }, 5000);
        
        logWithFallback('debug', 'Error state shown', { requestId, error });
    }
}

/**
 * Hide error state
 * @param {string} requestId - Request identifier
 */
function hideError(requestId) {
    const errorElement = loadingState.errorElements.get(requestId);
    
    if (errorElement) {
        errorElement.classList.remove('dualsub-error--visible');
        
        setTimeout(() => {
            if (errorElement.parentNode) {
                errorElement.parentNode.removeChild(errorElement);
            }
            loadingState.errorElements.delete(requestId);
        }, LOADING_CONFIG.animationDuration);
        
        logWithFallback('debug', 'Error state hidden', { requestId });
    }
}

/**
 * Clear error state
 * @param {string} requestId - Request identifier
 */
function clearError(requestId) {
    hideError(requestId);
}

/**
 * Handle request timeout
 * @param {string} requestId - Request identifier
 * @param {Object} selection - Selection object
 */
function handleRequestTimeout(requestId, selection) {
    const retryCount = loadingState.retryAttempts.get(requestId) || 0;
    
    if (retryCount < LOADING_CONFIG.maxRetries) {
        // Attempt retry
        loadingState.retryAttempts.set(requestId, retryCount + 1);
        
        logWithFallback('info', 'Retrying context analysis', {
            requestId,
            attempt: retryCount + 1,
            maxRetries: LOADING_CONFIG.maxRetries
        });
        
        // Stop current loading
        stopLoading(requestId, false);
        
        // Retry after delay
        setTimeout(() => {
            retryAnalysis(selection);
        }, LOADING_CONFIG.retryDelay);
        
    } else {
        // Max retries reached
        stopLoading(requestId, false);
        showError(requestId, 'Request timed out. Please try again.', {
            selectedText: selection.text,
            retryCount
        });
        
        logWithFallback('warn', 'Context analysis timeout after retries', {
            requestId,
            retryCount
        });
    }
}

/**
 * Retry context analysis
 * @param {Object} selection - Selection object
 */
function retryAnalysis(selection) {
    // Dispatch retry event
    document.dispatchEvent(new CustomEvent('dualsub-analyze-selection', {
        detail: { selection }
    }));
}

/**
 * Create loading element
 * @param {string} requestId - Request identifier
 * @param {Object} selection - Selection object
 * @returns {HTMLElement|null} Loading element
 */
function createLoadingElement(requestId, selection) {
    const element = document.createElement('div');
    element.className = 'dualsub-loading';
    element.id = `dualsub-loading-${requestId}`;
    element.style.cssText = getLoadingStyles();
    
    element.innerHTML = `
        <div class="dualsub-loading__backdrop"></div>
        <div class="dualsub-loading__content">
            <div class="dualsub-loading__spinner"></div>
            <div class="dualsub-loading__text">
                <div class="dualsub-loading__title">Analyzing Context</div>
                <div class="dualsub-loading__subtitle">"${escapeHtml(selection.text)}"</div>
            </div>
        </div>
    `;
    
    return element;
}

/**
 * Create error element
 * @param {string} requestId - Request identifier
 * @param {string} error - Error message
 * @param {Object} metadata - Error metadata
 * @returns {HTMLElement|null} Error element
 */
function createErrorElement(requestId, error, metadata) {
    const element = document.createElement('div');
    element.className = 'dualsub-error';
    element.id = `dualsub-error-${requestId}`;
    element.style.cssText = getErrorStyles();
    
    const retryCount = loadingState.retryAttempts.get(requestId) || 0;
    const canRetry = retryCount < LOADING_CONFIG.maxRetries;
    
    element.innerHTML = `
        <div class="dualsub-error__content">
            <div class="dualsub-error__icon">⚠️</div>
            <div class="dualsub-error__text">
                <div class="dualsub-error__title">Context Analysis Failed</div>
                <div class="dualsub-error__message">${escapeHtml(error)}</div>
                ${canRetry ? '<div class="dualsub-error__retry">Click to retry</div>' : ''}
            </div>
            <button class="dualsub-error__close" aria-label="Close">×</button>
        </div>
    `;
    
    // Add event listeners
    const closeButton = element.querySelector('.dualsub-error__close');
    closeButton.addEventListener('click', () => hideError(requestId));
    
    if (canRetry) {
        const retryButton = element.querySelector('.dualsub-error__retry');
        retryButton.addEventListener('click', () => {
            hideError(requestId);
            if (metadata.selection) {
                retryAnalysis(metadata.selection);
            }
        });
    }
    
    return element;
}

/**
 * Generate request ID from selection
 * @param {Object} selection - Selection object
 * @returns {string} Request ID
 */
function generateRequestId(selection) {
    const text = selection.text || 'unknown';
    const timestamp = Date.now();
    return `${text.substring(0, 10).replace(/\s+/g, '-')}-${timestamp}`;
}

/**
 * Escape HTML characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Get loading element styles
 * @returns {string} CSS styles
 */
function getLoadingStyles() {
    return `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483646;
        opacity: 0;
        visibility: hidden;
        transition: opacity ${LOADING_CONFIG.animationDuration}ms ease, visibility ${LOADING_CONFIG.animationDuration}ms ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: none;
    `;
}

/**
 * Get error element styles
 * @returns {string} CSS styles
 */
function getErrorStyles() {
    return `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483646;
        opacity: 0;
        visibility: hidden;
        transform: translateX(100%);
        transition: all ${LOADING_CONFIG.animationDuration}ms ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: auto;
    `;
}

// Add CSS styles for loading and error states
const style = document.createElement('style');
style.textContent = `
    .dualsub-loading--visible {
        opacity: 1 !important;
        visibility: visible !important;
    }
    
    .dualsub-loading__backdrop {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(1px);
    }
    
    .dualsub-loading__content {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 24px 32px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 200px;
    }
    
    .dualsub-loading__spinner {
        width: 24px;
        height: 24px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: dualsub-spin 1s linear infinite;
    }
    
    @keyframes dualsub-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    
    .dualsub-loading__title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 4px;
    }
    
    .dualsub-loading__subtitle {
        font-size: 14px;
        opacity: 0.8;
        font-style: italic;
    }
    
    .dualsub-error--visible {
        opacity: 1 !important;
        visibility: visible !important;
        transform: translateX(0) !important;
    }
    
    .dualsub-error__content {
        background: #ff4444;
        color: white;
        padding: 16px 20px;
        border-radius: 8px;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        max-width: 300px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    
    .dualsub-error__icon {
        font-size: 20px;
        flex-shrink: 0;
    }
    
    .dualsub-error__title {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 4px;
    }
    
    .dualsub-error__message {
        font-size: 13px;
        opacity: 0.9;
        margin-bottom: 8px;
    }
    
    .dualsub-error__retry {
        font-size: 12px;
        text-decoration: underline;
        cursor: pointer;
        opacity: 0.8;
    }
    
    .dualsub-error__retry:hover {
        opacity: 1;
    }
    
    .dualsub-error__close {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s ease;
        flex-shrink: 0;
    }
    
    .dualsub-error__close:hover {
        background-color: rgba(255, 255, 255, 0.2);
    }
`;

document.head.appendChild(style);

/**
 * Get current loading state
 * @returns {Object} Current loading state
 */
export function getLoadingState() {
    return {
        activeRequests: loadingState.activeRequests.size,
        loadingElements: loadingState.loadingElements.size,
        errorElements: loadingState.errorElements.size,
        retryAttempts: Object.fromEntries(loadingState.retryAttempts)
    };
}

/**
 * Clear all loading and error states
 */
export function clearAllStates() {
    // Clear all active requests
    for (const [requestId] of loadingState.activeRequests) {
        stopLoading(requestId, false);
    }
    
    // Clear all error states
    for (const [requestId] of loadingState.errorElements) {
        hideError(requestId);
    }
    
    // Clear retry attempts
    loadingState.retryAttempts.clear();
    
    logWithFallback('info', 'All loading and error states cleared');
}
