/**
 * Message Handler for Background Services
 * 
 * Handles all chrome.runtime.onMessage communication between
 * content scripts and background services.
 * 
 * Maintains exact same API interface as original background.js
 * 
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from '../utils/loggingManager.js';

class MessageHandler {
    constructor() {
        this.logger = null;
        this.translationService = null;
        this.subtitleService = null;
        this.isInitialized = false;
    }

    /**
     * Initialize message handler with service dependencies
     */
    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.logger = loggingManager.createLogger('MessageHandler');
        
        // Set up message listener
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
        
        this.logger.info('Message handler initialized');
        this.isInitialized = true;
    }

    /**
     * Set service dependencies (will be injected after services are created)
     */
    setServices(translationService, subtitleService) {
        this.translationService = translationService;
        this.subtitleService = subtitleService;
        this.logger.debug('Services injected into message handler');
    }

    /**
     * Handle incoming messages from content scripts
     * @param {Object} message - The message object
     * @param {Object} sender - The sender information
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} True if response is async
     */
    handleMessage(message, sender, sendResponse) {
        this.logger.debug('Received message', {
            action: message.action,
            source: message.source,
            tabId: sender.tab?.id
        });

        switch (message.action) {
            case 'translate':
                return this.handleTranslateMessage(message, sendResponse);
            
            case 'fetchVTT':
                return this.handleFetchVTTMessage(message, sendResponse);
            
            case 'changeProvider':
                return this.handleChangeProviderMessage(message, sendResponse);
            
            default:
                this.logger.warn('Unknown message action', { action: message.action });
                return false;
        }
    }

    /**
     * Handle translation requests
     */
    handleTranslateMessage(message, sendResponse) {
        if (!this.translationService) {
            this.logger.error('Translation service not available');
            sendResponse({
                error: 'Translation service not initialized',
                originalText: message.text,
                cueStart: message.cueStart,
                cueVideoId: message.cueVideoId,
            });
            return true;
        }

        const { text, targetLang, cueStart, cueVideoId } = message;
        
        this.translationService
            .translate(text, 'auto', targetLang)
            .then((translatedText) => {
                sendResponse({
                    translatedText,
                    originalText: text,
                    cueStart,
                    cueVideoId,
                });
            })
            .catch((error) => {
                this.logger.error('Translation failed', error, {
                    text: text.substring(0, 50),
                    targetLang,
                });
                sendResponse({
                    error: 'Translation failed',
                    errorType: 'TRANSLATION_API_ERROR',
                    details: error.message || 'Unknown translation error',
                    originalText: text,
                    cueStart,
                    cueVideoId,
                });
            });
        
        return true; // Async response
    }

    /**
     * Handle VTT fetching requests
     */
    handleFetchVTTMessage(message, sendResponse) {
        if (!this.subtitleService) {
            this.logger.error('Subtitle service not available');
            sendResponse({
                success: false,
                error: 'Subtitle service not initialized',
                videoId: message.videoId,
            });
            return true;
        }

        if (message.source === 'netflix') {
            this.handleNetflixVTTRequest(message, sendResponse);
        } else {
            this.handleGenericVTTRequest(message, sendResponse);
        }
        
        return true; // Async response
    }

    /**
     * Handle Netflix-specific VTT requests
     */
    handleNetflixVTTRequest(message, sendResponse) {
        const {
            data,
            videoId,
            targetLanguage,
            originalLanguage,
            useNativeSubtitles,
            useOfficialTranslations,
        } = message;

        this.subtitleService
            .processNetflixSubtitles(
                data,
                targetLanguage,
                originalLanguage,
                useNativeSubtitles,
                useOfficialTranslations
            )
            .then((result) => {
                sendResponse({
                    success: true,
                    vttText: result.vttText,
                    targetVttText: result.targetVttText,
                    videoId,
                    url: result.url,
                    sourceLanguage: result.sourceLanguage,
                    targetLanguage: result.targetLanguage,
                    useNativeTarget: result.useNativeTarget,
                    availableLanguages: result.availableLanguages,
                });
            })
            .catch((error) => {
                this.logger.error('Netflix VTT processing failed', error, {
                    videoId,
                });
                sendResponse({
                    success: false,
                    error: `Netflix VTT Processing Error: ${error.message}`,
                    videoId,
                });
            });
    }

    /**
     * Handle generic VTT requests
     */
    handleGenericVTTRequest(message, sendResponse) {
        const { url, videoId, targetLanguage, originalLanguage } = message;

        this.subtitleService
            .fetchAndProcessSubtitles(url, targetLanguage, originalLanguage)
            .then((result) => {
                sendResponse({
                    success: true,
                    vttText: result.vttText,
                    targetVttText: result.targetVttText,
                    videoId,
                    url,
                    sourceLanguage: result.sourceLanguage,
                    targetLanguage: result.targetLanguage,
                    useNativeTarget: result.useNativeTarget,
                    availableLanguages: result.availableLanguages,
                    selectedLanguage: result.selectedLanguage,
                    targetLanguageInfo: result.targetLanguageInfo,
                });
            })
            .catch((error) => {
                this.logger.error('VTT processing failed', error, { url });
                sendResponse({
                    success: false,
                    error: `VTT Processing Error: ${error.message}`,
                    videoId,
                    url,
                });
            });
    }

    /**
     * Handle provider change requests
     */
    handleChangeProviderMessage(message, sendResponse) {
        if (!this.translationService) {
            this.logger.error('Translation service not available');
            sendResponse({
                success: false,
                message: 'Translation service not initialized',
            });
            return true;
        }

        const { providerId } = message;
        
        this.translationService
            .changeProvider(providerId)
            .then((result) => {
                sendResponse({
                    success: true,
                    message: result.message,
                });
            })
            .catch((error) => {
                this.logger.error('Provider change failed', error, { providerId });
                sendResponse({
                    success: false,
                    message: error.message || 'Failed to change provider',
                });
            });
        
        return true; // Async response
    }
}

// Export singleton instance
export const messageHandler = new MessageHandler();
