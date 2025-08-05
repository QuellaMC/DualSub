/**
 * AI Context Analysis System - Main Entry Point
 *
 * Centralized modular architecture for AI-powered context analysis
 * in browser extension environments. Provides unified interface for
 * platform-agnostic AI context features.
 *
 * @author DualSub Extension - Modularization Architect
 * @version 2.0.0
 * @since 2024-08-02
 */

// Core System Components
import { AIContextManager } from './core/AIContextManager.js';
import { AIContextProvider } from './providers/AIContextProvider.js';

export { AIContextManager, AIContextProvider };

// UI Components
import { AIContextModal } from './ui/modal.js';

// Event Handlers
import { TextSelectionHandler } from './handlers/textSelection.js';

export { AIContextModal, TextSelectionHandler };

// Configuration and Constants
export {
    AI_CONTEXT_CONFIG,
    MODAL_STATES,
    EVENT_TYPES,
} from './core/constants.js';

/**
 * Initialize the complete AI Context system
 * @param {string} platform - Target platform (netflix, disneyplus)
 * @param {Object} config - System configuration
 * @returns {Promise<AIContextManager>} Initialized manager instance
 */
export async function initializeAIContext(platform, config = {}) {
    const manager = new AIContextManager(platform, config);
    await manager.initialize();
    return manager;
}

/**
 * Quick setup for platform content scripts
 * @param {Object} options - Setup options
 * @returns {Promise<Object>} Setup result with manager and components
 */
export async function setupAIContextForPlatform(options = {}) {
    const { platform, config, enabledFeatures = [] } = options;

    const manager = await initializeAIContext(platform, config);

    const components = {
        manager,
        modal: manager.getModal(),
        provider: manager.getProvider(),
        textHandler: manager.getTextHandler(),
    };

    // Enable requested features
    for (const feature of enabledFeatures) {
        await manager.enableFeature(feature);
    }

    return {
        success: true,
        platform,
        components,
        features: manager.getEnabledFeatures(),
    };
}

/**
 * System health check and diagnostics
 * @returns {Object} System status and metrics
 */
export function getSystemStatus() {
    return {
        version: '2.0.0',
        architecture: 'modular',
        timestamp: Date.now(),
        modules: {
            core: 'AIContextManager',
            ui: 'AIContextModal',
            providers: 'AIContextProvider',
            handlers: ['TextSelectionHandler'],
        },
    };
}
