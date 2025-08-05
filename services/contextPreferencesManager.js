/**
 * Context Preferences Manager
 * 
 * Manages granular user preferences for AI context analysis types,
 * interaction methods, and display options for the cultural context assistant.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

import { configService } from './configService.js';
import Logger from '../utils/logger.js';

const logger = Logger.create('ContextPreferencesManager');

/**
 * Available context types with detailed descriptions
 */
export const CONTEXT_TYPES = {
    cultural: {
        id: 'cultural',
        name: 'Cultural Context',
        description: 'Idioms, slang, cultural references, and conversational subtext',
        examples: ['break a leg', 'spill the tea', 'it\'s raining cats and dogs'],
        defaultEnabled: true,
        priority: 1
    },
    historical: {
        id: 'historical',
        name: 'Historical Context',
        description: 'Historical figures, events, time periods, and background information',
        examples: ['World War II references', 'Renaissance period', 'Ancient Rome'],
        defaultEnabled: true,
        priority: 2
    },
    linguistic: {
        id: 'linguistic',
        name: 'Linguistic Context',
        description: 'Etymology, grammar patterns, language evolution, and translation nuances',
        examples: ['word origins', 'false friends', 'grammatical structures'],
        defaultEnabled: true,
        priority: 3
    }
};

/**
 * Interaction methods for triggering context analysis
 */
export const INTERACTION_METHODS = {
    click: {
        id: 'click',
        name: 'Click to Analyze',
        description: 'Click on individual words to get context analysis',
        defaultEnabled: true
    },
    selection: {
        id: 'selection',
        name: 'Text Selection',
        description: 'Select text phrases to analyze multiple words together',
        defaultEnabled: true
    },
    hover: {
        id: 'hover',
        name: 'Hover Preview',
        description: 'Show brief context on hover (requires click for full analysis)',
        defaultEnabled: false
    }
};

/**
 * Display preferences for context modals
 */
export const DISPLAY_PREFERENCES = {
    position: {
        center: 'Center of screen',
        top: 'Top of screen',
        bottom: 'Bottom of screen',
        cursor: 'Near cursor position'
    },
    size: {
        small: 'Compact view',
        medium: 'Standard view',
        large: 'Detailed view'
    },
    theme: {
        auto: 'Match system theme',
        light: 'Light theme',
        dark: 'Dark theme'
    }
};

/**
 * Context Preferences Manager class
 */
export class ContextPreferencesManager {
    constructor() {
        this.preferencesCache = new Map();
        this.defaultPreferences = this.getDefaultPreferences();
    }

    /**
     * Get default preferences
     * @returns {Object} Default preferences object
     */
    getDefaultPreferences() {
        return {
            // Context types
            enabledContextTypes: Object.keys(CONTEXT_TYPES),
            contextTypePriority: Object.values(CONTEXT_TYPES)
                .sort((a, b) => a.priority - b.priority)
                .map(type => type.id),
            
            // Interaction methods
            enabledInteractionMethods: Object.keys(INTERACTION_METHODS)
                .filter(method => INTERACTION_METHODS[method].defaultEnabled),
            
            // Display preferences
            modalPosition: 'center',
            modalSize: 'medium',
            modalTheme: 'auto',
            autoClose: false,
            autoCloseDelay: 10000,
            
            // Advanced preferences
            showExamples: true,
            showConfidence: false,
            enableKeyboardShortcuts: true,
            enableSoundFeedback: false,
            
            // Language-specific preferences
            languageSpecificSettings: {},
            
            // Performance preferences
            enableCaching: true,
            maxCacheAge: 3600000, // 1 hour
            enablePrefetch: false,
            
            // Accessibility preferences
            highContrast: false,
            reducedMotion: false,
            screenReaderOptimized: false
        };
    }

    /**
     * Load user preferences
     * @returns {Promise<Object>} User preferences
     */
    async loadPreferences() {
        try {
            const configKeys = [
                'aiContextTypes',
                'interactiveSubtitlesEnabled',
                'contextOnClick',
                'contextOnSelection',
                'contextModalPosition',
                'contextModalSize',
                'contextAutoClose',
                'contextAutoCloseDelay'
            ];

            const settings = await configService.getMultiple(configKeys);
            
            // Merge with defaults
            const preferences = {
                ...this.defaultPreferences,
                enabledContextTypes: settings.aiContextTypes || this.defaultPreferences.enabledContextTypes,
                enabledInteractionMethods: this.getEnabledInteractionMethods(settings),
                modalPosition: settings.contextModalPosition || this.defaultPreferences.modalPosition,
                modalSize: settings.contextModalSize || this.defaultPreferences.modalSize,
                autoClose: settings.contextAutoClose || this.defaultPreferences.autoClose,
                autoCloseDelay: settings.contextAutoCloseDelay || this.defaultPreferences.autoCloseDelay
            };

            // Cache preferences
            this.preferencesCache.set('current', preferences);

            logger.debug('Preferences loaded', {
                enabledContextTypes: preferences.enabledContextTypes.length,
                enabledInteractionMethods: preferences.enabledInteractionMethods.length
            });

            return preferences;

        } catch (error) {
            logger.error('Failed to load preferences', error);
            return this.defaultPreferences;
        }
    }

    /**
     * Save user preferences
     * @param {Object} preferences - Preferences to save
     * @returns {Promise<boolean>} Success status
     */
    async savePreferences(preferences) {
        try {
            const updates = {
                aiContextTypes: preferences.enabledContextTypes,
                contextModalPosition: preferences.modalPosition,
                contextModalSize: preferences.modalSize,
                contextAutoClose: preferences.autoClose,
                contextAutoCloseDelay: preferences.autoCloseDelay,
                contextOnClick: preferences.enabledInteractionMethods.includes('click'),
                contextOnSelection: preferences.enabledInteractionMethods.includes('selection')
            };

            await configService.setMultiple(updates);
            
            // Update cache
            this.preferencesCache.set('current', preferences);

            logger.info('Preferences saved', {
                enabledContextTypes: preferences.enabledContextTypes,
                modalPosition: preferences.modalPosition,
                modalSize: preferences.modalSize
            });

            return true;

        } catch (error) {
            logger.error('Failed to save preferences', error);
            return false;
        }
    }

    /**
     * Get enabled interaction methods from settings
     * @param {Object} settings - Configuration settings
     * @returns {Array} Enabled interaction method IDs
     */
    getEnabledInteractionMethods(settings) {
        // Always return both interaction methods as they are always enabled
        return ['click', 'selection'];
    }

    /**
     * Check if a context type is enabled
     * @param {string} contextType - Context type ID
     * @returns {Promise<boolean>} True if enabled
     */
    async isContextTypeEnabled(contextType) {
        try {
            const preferences = await this.getPreferences();
            return preferences.enabledContextTypes.includes(contextType);
        } catch (error) {
            logger.error('Failed to check context type status', error, { contextType });
            return CONTEXT_TYPES[contextType]?.defaultEnabled || false;
        }
    }

    /**
     * Check if an interaction method is enabled
     * @param {string} method - Interaction method ID
     * @returns {Promise<boolean>} True if enabled
     */
    async isInteractionMethodEnabled(method) {
        try {
            const preferences = await this.getPreferences();
            return preferences.enabledInteractionMethods.includes(method);
        } catch (error) {
            logger.error('Failed to check interaction method status', error, { method });
            return INTERACTION_METHODS[method]?.defaultEnabled || false;
        }
    }

    /**
     * Get current preferences (cached or load)
     * @returns {Promise<Object>} Current preferences
     */
    async getPreferences() {
        if (this.preferencesCache.has('current')) {
            return this.preferencesCache.get('current');
        }
        return await this.loadPreferences();
    }

    /**
     * Update specific preference
     * @param {string} key - Preference key
     * @param {*} value - New value
     * @returns {Promise<boolean>} Success status
     */
    async updatePreference(key, value) {
        try {
            const preferences = await this.getPreferences();
            preferences[key] = value;
            return await this.savePreferences(preferences);
        } catch (error) {
            logger.error('Failed to update preference', error, { key, value });
            return false;
        }
    }

    /**
     * Toggle context type enabled status
     * @param {string} contextType - Context type ID
     * @returns {Promise<boolean>} New enabled status
     */
    async toggleContextType(contextType) {
        try {
            const preferences = await this.getPreferences();
            const isEnabled = preferences.enabledContextTypes.includes(contextType);
            
            if (isEnabled) {
                preferences.enabledContextTypes = preferences.enabledContextTypes
                    .filter(type => type !== contextType);
            } else {
                preferences.enabledContextTypes.push(contextType);
            }

            await this.savePreferences(preferences);
            
            logger.info('Context type toggled', {
                contextType,
                newStatus: !isEnabled
            });

            return !isEnabled;

        } catch (error) {
            logger.error('Failed to toggle context type', error, { contextType });
            return false;
        }
    }

    /**
     * Get language-specific preferences
     * @param {string} languageCode - Language code (e.g., 'en', 'es')
     * @returns {Promise<Object>} Language-specific preferences
     */
    async getLanguagePreferences(languageCode) {
        try {
            const preferences = await this.getPreferences();
            return preferences.languageSpecificSettings[languageCode] || {};
        } catch (error) {
            logger.error('Failed to get language preferences', error, { languageCode });
            return {};
        }
    }

    /**
     * Set language-specific preferences
     * @param {string} languageCode - Language code
     * @param {Object} languagePrefs - Language-specific preferences
     * @returns {Promise<boolean>} Success status
     */
    async setLanguagePreferences(languageCode, languagePrefs) {
        try {
            const preferences = await this.getPreferences();
            preferences.languageSpecificSettings[languageCode] = languagePrefs;
            return await this.savePreferences(preferences);
        } catch (error) {
            logger.error('Failed to set language preferences', error, { languageCode });
            return false;
        }
    }

    /**
     * Reset preferences to defaults
     * @returns {Promise<boolean>} Success status
     */
    async resetToDefaults() {
        try {
            const defaultPrefs = this.getDefaultPreferences();
            const success = await this.savePreferences(defaultPrefs);
            
            if (success) {
                this.preferencesCache.clear();
                logger.info('Preferences reset to defaults');
            }
            
            return success;
        } catch (error) {
            logger.error('Failed to reset preferences', error);
            return false;
        }
    }

    /**
     * Export preferences for backup
     * @returns {Promise<Object>} Exported preferences
     */
    async exportPreferences() {
        try {
            const preferences = await this.getPreferences();
            return {
                version: '1.0.0',
                exportDate: new Date().toISOString(),
                preferences
            };
        } catch (error) {
            logger.error('Failed to export preferences', error);
            return null;
        }
    }

    /**
     * Import preferences from backup
     * @param {Object} exportedData - Exported preferences data
     * @returns {Promise<boolean>} Success status
     */
    async importPreferences(exportedData) {
        try {
            if (!exportedData || !exportedData.preferences) {
                throw new Error('Invalid export data');
            }

            const preferences = {
                ...this.defaultPreferences,
                ...exportedData.preferences
            };

            const success = await this.savePreferences(preferences);
            
            if (success) {
                logger.info('Preferences imported successfully', {
                    version: exportedData.version,
                    exportDate: exportedData.exportDate
                });
            }
            
            return success;
        } catch (error) {
            logger.error('Failed to import preferences', error);
            return false;
        }
    }

    /**
     * Get preferences summary for display
     * @returns {Promise<Object>} Preferences summary
     */
    async getPreferencesSummary() {
        try {
            const preferences = await this.getPreferences();
            
            return {
                contextTypes: {
                    enabled: preferences.enabledContextTypes.length,
                    total: Object.keys(CONTEXT_TYPES).length,
                    list: preferences.enabledContextTypes.map(id => CONTEXT_TYPES[id]?.name || id)
                },
                interactionMethods: {
                    enabled: preferences.enabledInteractionMethods.length,
                    total: Object.keys(INTERACTION_METHODS).length,
                    list: preferences.enabledInteractionMethods.map(id => INTERACTION_METHODS[id]?.name || id)
                },
                display: {
                    position: DISPLAY_PREFERENCES.position[preferences.modalPosition] || preferences.modalPosition,
                    size: DISPLAY_PREFERENCES.size[preferences.modalSize] || preferences.modalSize,
                    autoClose: preferences.autoClose
                }
            };
        } catch (error) {
            logger.error('Failed to get preferences summary', error);
            return null;
        }
    }
}

// Export singleton instance
export const contextPreferencesManager = new ContextPreferencesManager();
