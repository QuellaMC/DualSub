/**
 * This module serves as the main export point for all content script functionality,
 * providing a clean and unified API for importing core and shared utilities across
 * the extension.
 *
 * Note: Platform-specific content scripts are not exported from this module to avoid
 * circular dependencies and are instead imported directly by the manifest.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

// Core functionality
export * from './core/index.js';

// Shared utilities
export { default as SubtitleUtilities } from './shared/subtitleUtilities.js';

// AI Context Integration
export { aiContextIntegrationManager } from './shared/aiContextIntegrationManager.js';
export { interactiveSubtitleFormatter } from './shared/interactiveSubtitleFormatter.js';
export { contextModal } from './shared/contextModal.js';
export { textSelectionHandler } from './shared/textSelectionHandler.js';
export { contextLoadingStates } from './shared/contextLoadingStates.js';

// Platform-specific content scripts are imported directly by the manifest
// They are not exported here to avoid circular dependencies
