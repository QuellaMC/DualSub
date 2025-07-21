/**
 * Content Scripts - Main Export
 * 
 * Central export point for all content script functionality.
 * Provides a clean API for importing content script utilities.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

// Core functionality
export * from './core/index.js';

// Shared utilities
export { default as SubtitleUtilities } from './shared/subtitleUtilities.js';

// Platform-specific content scripts are imported directly by the manifest
// They are not exported here to avoid circular dependencies