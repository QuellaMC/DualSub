/**
 * This module serves as the central export point for all core content script
 * functionality, providing a unified interface for accessing common utilities,
 * constants, error handling, and base classes.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

// Core utilities
export * from './utils.js';
export * from './constants.js';
export * from './errorHandling.js';
export * from './ResourceManager.js';

// Configuration and factories
export * from './PlatformConfigFactory.js';

// Base classes
export * from './BaseContentScript.js';
