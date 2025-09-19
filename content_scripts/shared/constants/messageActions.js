// Centralized message actions used between content scripts and background services
// Keep this as the single source of truth for cross-context protocol strings.

export const MessageActions = {
  TRANSLATE: 'translate',
  TRANSLATE_BATCH: 'translateBatch',
  CHECK_BATCH_SUPPORT: 'checkBatchSupport',
  FETCH_VTT: 'fetchVTT',
  CHANGE_PROVIDER: 'changeProvider',
  ANALYZE_CONTEXT: 'analyzeContext',
  CHANGE_CONTEXT_PROVIDER: 'changeContextProvider',
  GET_CONTEXT_STATUS: 'getContextStatus',
  GET_AVAILABLE_MODELS: 'getAvailableModels',
  GET_DEFAULT_MODEL: 'getDefaultModel',
  RELOAD_CONTEXT_PROVIDER_CONFIG: 'reloadContextProviderConfig',
  PING: 'ping',
  CHECK_BACKGROUND_READY: 'checkBackgroundReady',
  // Content-side actions
  TOGGLE_SUBTITLES: 'toggleSubtitles',
  CONFIG_CHANGED: 'configChanged',
  LOGGING_LEVEL_CHANGED: 'LOGGING_LEVEL_CHANGED',
};
