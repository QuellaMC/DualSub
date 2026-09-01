export const AI_CONTEXT_CONFIG = Object.freeze({
    PLATFORMS: Object.freeze({
        NETFLIX: Object.freeze({ name: 'netflix' }),
        DISNEYPLUS: Object.freeze({ name: 'disneyplus' }),
    }),
    FEATURES: Object.freeze({
        INTERACTIVE_SUBTITLES: 'interactiveSubtitles',
        CONTEXT_MODAL: 'contextModal',
    }),
});

export const MODAL_STATES = Object.freeze({
    HIDDEN: 'hidden',
    SELECTION: 'selection',
    PROCESSING: 'processing',
    DISPLAY: 'display',
    ERROR: 'error',
});

export const EVENT_TYPES = Object.freeze({
    SYSTEM_INITIALIZED: 'aicontext:system:initialized',
    SYSTEM_ERROR: 'aicontext:system:error',
    MODAL_SHOW: 'aicontext:modal:show',
    MODAL_HIDE: 'aicontext:modal:hide',
    MODAL_STATE_CHANGE: 'aicontext:modal:stateChange',
    ANALYSIS_COMPLETE: 'aicontext:analysis:complete',
    WORD_ADDED: 'aicontext:word:added',
    WORD_REMOVED: 'aicontext:word:removed',
    SELECTION_CLEARED: 'aicontext:selection:cleared',
});

export const UI_CONFIG = Object.freeze({
    MODAL: Object.freeze({
        SELECTION_STATE_AGE_THRESHOLD: 30_000,
        SELECTION_STATE_REFRESH_THRESHOLD: 120_000,
    }),
});
