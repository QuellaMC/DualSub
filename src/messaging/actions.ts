// Wire-format action strings — unchanged from v2 so a v3 background and any
// in-flight v2 page speak the same protocol during the update window.
export const MessageActions = {
    TRANSLATE: 'translate',
    FETCH_VTT: 'fetchVTT',
    ANALYZE_CONTEXT: 'analyzeContext',
    PING: 'ping',
    CHECK_BACKGROUND_READY: 'checkBackgroundReady',
    CONFIG_CHANGED: 'configChanged',
    LOGGING_LEVEL_CHANGED: 'LOGGING_LEVEL_CHANGED',
    SIDEPANEL_WORD_SELECTED: 'sidePanelWordSelected',
    SIDEPANEL_PAUSE_VIDEO: 'sidePanelPauseVideo',
    SIDEPANEL_GET_STATE: 'sidePanelGetState',
    SIDEPANEL_UPDATE_STATE: 'sidePanelUpdateState',
    SIDEPANEL_REGISTER: 'sidePanelRegister',
    SIDEPANEL_SELECTION_SYNC: 'sidePanelSelectionSync',
    SIDEPANEL_TAB_ACTIVATED: 'tabActivated',
    SIDEPANEL_FORCE_BIND_TAB: 'sidePanelForceBindTab',
    SIDEPANEL_BINDING_CONFIRMED: 'sidePanelBindingConfirmed',
} as const;

export type MessageAction =
    (typeof MessageActions)[keyof typeof MessageActions];
