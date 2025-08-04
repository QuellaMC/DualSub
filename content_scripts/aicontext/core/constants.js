/**
 * AI Context System Constants and Configuration
 * 
 * Centralized configuration and constants for the modular AI context system.
 * Defines system-wide defaults, event types, modal states, and platform-specific settings.
 * 
 * @author DualSub Extension - Modularization Architect
 * @version 2.0.0
 */

/**
 * Core AI Context Configuration
 */
export const AI_CONTEXT_CONFIG = {
    // System defaults
    DEFAULT_TIMEOUT: 30000,
    MAX_TEXT_LENGTH: 500,
    MIN_TEXT_LENGTH: 2,
    CACHE_TTL: 300000, // 5 minutes
    
    // Analysis types
    CONTEXT_TYPES: {
        CULTURAL: 'cultural',
        HISTORICAL: 'historical',
        LINGUISTIC: 'linguistic',
        COMPREHENSIVE: 'comprehensive'
    },
    
    // Platform-specific settings
    PLATFORMS: {
        NETFLIX: {
            name: 'netflix',
            selectors: {
                subtitleContainer: '.player-timedtext',
                videoPlayer: '.NFPlayer'
            },
            features: {
                interactiveSubtitles: true,
                contextModal: true,
                textSelection: true
            }
        },
        DISNEYPLUS: {
            name: 'disneyplus',
            selectors: {
                subtitleContainer: '.dss-subtitle-renderer',
                videoPlayer: '.btm-media-client-element'
            },
            features: {
                interactiveSubtitles: true,
                contextModal: true,
                textSelection: true
            }
        }
    },
    
    // Feature flags
    FEATURES: {
        INTERACTIVE_SUBTITLES: 'interactiveSubtitles',
        CONTEXT_MODAL: 'contextModal',
        TEXT_SELECTION: 'textSelection',
        LOADING_STATES: 'loadingStates',
        CONTEXT_CACHE: 'contextCache'
    }
};

/**
 * Modal State Constants
 */
export const MODAL_STATES = {
    HIDDEN: 'hidden',
    SELECTION: 'selection',
    ANALYZING: 'analyzing',
    DISPLAYING: 'displaying',
    ERROR: 'error',
    PAUSED: 'paused'
};

/**
 * Event Type Constants
 */
export const EVENT_TYPES = {
    // Core system events
    SYSTEM_INITIALIZED: 'aicontext:system:initialized',
    SYSTEM_ERROR: 'aicontext:system:error',
    
    // Modal events
    MODAL_SHOW: 'aicontext:modal:show',
    MODAL_HIDE: 'aicontext:modal:hide',
    MODAL_STATE_CHANGE: 'aicontext:modal:stateChange',
    
    // Analysis events
    ANALYSIS_START: 'aicontext:analysis:start',
    ANALYSIS_COMPLETE: 'aicontext:analysis:complete',
    ANALYSIS_ERROR: 'aicontext:analysis:error',
    ANALYSIS_PAUSE: 'aicontext:analysis:pause',
    ANALYSIS_RESUME: 'aicontext:analysis:resume',
    ANALYSIS_REQUESTED: 'aicontext:analysis:requested',
    ANALYSIS_PAUSED: 'aicontext:analysis:paused',

    // Modal control events
    MODAL_SHOW_REQUESTED: 'aicontext:modal:showRequested',
    MODAL_CLOSE_REQUESTED: 'aicontext:modal:closeRequested',
    NEW_ANALYSIS_REQUESTED: 'aicontext:analysis:newRequested',

    // Word selection events
    WORD_ADDED: 'aicontext:word:added',
    WORD_REMOVED: 'aicontext:word:removed',
    SELECTION_CLEARED: 'aicontext:selection:cleared',
    STATE_CHANGE: 'aicontext:state:change',
    
    // Text selection events
    TEXT_SELECTED: 'aicontext:text:selected',
    TEXT_DESELECTED: 'aicontext:text:deselected',
    WORD_CLICKED: 'aicontext:word:clicked',
    
    // Legacy event compatibility
    LEGACY_ANALYZE_SELECTION: 'dualsub-analyze-selection',
    LEGACY_WORD_SELECTED: 'dualsub-word-selected',
    LEGACY_CONTEXT_RESULT: 'dualsub-context-result',
    LEGACY_SHOW_CONTEXT: 'dualsub-show-context',
    LEGACY_CONTEXT_ERROR: 'dualsub-context-error'
};



/**
 * Performance and Monitoring Constants
 */
export const PERFORMANCE_CONFIG = {
    // Timing thresholds (ms)
    INITIALIZATION_TIMEOUT: 5000,
    MODAL_ANIMATION_DURATION: 300,
    TEXT_SELECTION_DEBOUNCE: 150,

    // Observability
    LOG_LEVELS: {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3
    }
};

/**
 * UI Configuration Constants
 */
export const UI_CONFIG = {
    // Modal dimensions and positioning
    MODAL: {
        MAX_WIDTH: '800px',
        MAX_HEIGHT: '600px',
        Z_INDEX: 10000,
        ANIMATION_DURATION: 300,
        SELECTION_STATE_AGE_THRESHOLD: 30000, // 30 seconds for page visibility changes
        SELECTION_STATE_REFRESH_THRESHOLD: 120000 // 2 minutes max age for refresh
    },
    
    // Text selection highlighting
    SELECTION: {
        HIGHLIGHT_CLASS: 'aicontext-selected',
        HOVER_CLASS: 'aicontext-hover',
        PROCESSING_CLASS: 'aicontext-processing'
    },
    
    // Loading states
    LOADING: {
        SPINNER_SIZE: '24px',
        PROGRESS_BAR_HEIGHT: '4px',
        FADE_DURATION: 200
    }
};

/**
 * API and Provider Configuration
 */
export const PROVIDER_CONFIG = {
    // Request settings
    DEFAULT_TIMEOUT: 30000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    
    // Batch processing
    BATCH_SIZE: 5,
    BATCH_TIMEOUT: 45000,
    
    // Rate limiting
    RATE_LIMIT: {
        REQUESTS_PER_MINUTE: 60,
        BURST_LIMIT: 10
    }
};

/**
 * Development and Testing Constants
 */
export const DEV_CONFIG = {
    // Debug flags
    ENABLE_VERBOSE_LOGGING: false,
    ENABLE_PERFORMANCE_MONITORING: true,
    ENABLE_ERROR_BOUNDARIES: true,
    
    // Test mode settings
    MOCK_AI_RESPONSES: false,
    SIMULATE_NETWORK_DELAY: false,
    FORCE_ERROR_CONDITIONS: false
};

/**
 * Get platform-specific configuration
 * @param {string} platform - Platform identifier
 * @returns {Object} Platform configuration
 */
export function getPlatformConfig(platform) {
    const platformKey = platform.toUpperCase();
    return AI_CONTEXT_CONFIG.PLATFORMS[platformKey] || null;
}

/**
 * Validate configuration object
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result
 */
export function validateConfig(config) {
    const errors = [];
    const warnings = [];
    
    // Required fields validation
    if (!config.platform) {
        errors.push('Platform is required');
    }
    
    // Platform support validation
    if (config.platform && !getPlatformConfig(config.platform)) {
        errors.push(`Platform '${config.platform}' is not supported`);
    }
    
    // Feature validation
    if (config.features) {
        const validFeatures = Object.values(AI_CONTEXT_CONFIG.FEATURES);
        const invalidFeatures = config.features.filter(f => !validFeatures.includes(f));
        if (invalidFeatures.length > 0) {
            warnings.push(`Unknown features: ${invalidFeatures.join(', ')}`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}
