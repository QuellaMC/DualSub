// Centralized message actions used between content scripts and background services
// Keep this as the single source of truth for cross-context protocol strings.

export const MessageActions = Object.freeze({
    TRANSLATE: 'translate',
    FETCH_VTT: 'fetchVTT',
    ANALYZE_CONTEXT: 'analyzeContext',
    PING: 'ping',
    CHECK_BACKGROUND_READY: 'checkBackgroundReady',
    // Content-side actions
    CONFIG_CHANGED: 'configChanged',
    LOGGING_LEVEL_CHANGED: 'LOGGING_LEVEL_CHANGED',
    // Side Panel actions
    SIDEPANEL_WORD_SELECTED: 'sidePanelWordSelected',
    SIDEPANEL_PAUSE_VIDEO: 'sidePanelPauseVideo',
    SIDEPANEL_GET_STATE: 'sidePanelGetState',
    SIDEPANEL_UPDATE_STATE: 'sidePanelUpdateState',
    SIDEPANEL_REGISTER: 'sidePanelRegister',
    SIDEPANEL_SELECTION_SYNC: 'sidePanelSelectionSync',
    SIDEPANEL_TAB_ACTIVATED: 'tabActivated',
    SIDEPANEL_FORCE_BIND_TAB: 'sidePanelForceBindTab',
    SIDEPANEL_BINDING_CONFIRMED: 'sidePanelBindingConfirmed',
});

export const SubtitleRequestSources = Object.freeze({
    DISNEY_PLUS: 'disneyplus',
    NETFLIX: 'netflix',
});
