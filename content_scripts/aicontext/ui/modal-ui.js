/**
 * AI Context Modal - UI Module
 *
 * DOM creation and UI rendering functionality.
 * Handles modal element creation, styling, and visual updates.
 *
 * @author DualSub Extension - UI Systems Engineer
 * @version 2.0.0
 */

import { MODAL_STATES } from '../core/constants.js';
import { getOrCreateUiRoot } from '../../shared/subtitleUtilities.js';

/**
 * Modal UI creation and management
 */
export class AIContextModalUI {
    constructor(core) {
        this.core = core;
        this.cssInjected = false;
        this._translationsCache = null;
        this._currentLanguage = null;
        this._languageInitialized = false;
    }

    /**
     * Initialize the UI module (Issue #2: Fixed internationalization race condition)
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._languageInitialized) {
            this.core._log('debug', 'Language already initialized, skipping');
            return;
        }

        this.core._log('debug', 'Starting UI module initialization');

        // Initialize language settings first
        await this._initializeLanguage();
        this._languageInitialized = true;

        this.core._log('info', 'UI module initialization completed', {
            language: this._currentLanguage,
            translationsLoaded: !!this._translationsCache,
        });
    }

    /**
     * Create modal DOM element (Issue #2: Fixed internationalization race condition)
     * @returns {Promise<void>}
     */
    async createModalElement() {
        // Ensure language is initialized before creating UI elements
        if (!this._languageInitialized) {
            this.core._log(
                'debug',
                'Language not initialized, initializing now'
            );
            await this.initialize();
        }
        this.core._log('debug', 'Creating modal DOM element');

        // Remove any existing modal
        const existingModal = document.getElementById('dualsub-context-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Remove any stale overlay/content from previous SPA navigations
        try {
            const staleNodes = document.querySelectorAll(
                '.dualsub-modal-overlay, .dualsub-modal-content'
            );
            staleNodes.forEach((node) => {
                if (node && node.parentElement) {
                    node.parentElement.removeChild(node);
                }
            });
        } catch (_) {}

        // Inject CSS styles first
        await this._injectModalStyles();

        // Create main modal container (EXACT legacy structure)
        const modal = document.createElement('div');
        modal.id = 'dualsub-context-modal';
        modal.className = 'dualsub-context-modal';
        modal.style.display = 'none'; // EXACT legacy initial state

        // Create separate overlay div (EXACT legacy structure)
        const overlay = document.createElement('div');
        overlay.id = 'dualsub-modal-overlay';
        overlay.className = 'dualsub-modal-overlay';
        overlay.style.display = 'none'; // Start hidden, will be shown when modal is displayed
        overlay.style.pointerEvents = 'none'; // Start non-interactive, will be enabled when modal is shown

        // Create modal content with two-pane layout
        const content = document.createElement('div');
        content.id = 'dualsub-modal-content';
        content.className = 'dualsub-modal-content';
        // Start fully hidden; visibility will be controlled by transitions
        content.style.display = 'none';
        content.style.pointerEvents = 'auto'; // Ensure modal content can receive clicks despite UI root container

        // Ensure proper initial dimensions for absolute positioning
        content.style.width = '95vw';
        content.style.maxWidth = 'min(95vw, 1000px)';
        content.style.height = '75vh';
        content.style.maxHeight = 'calc(100vh - 80px)';

        // Create header
        const header = this._createModalHeader();
        content.appendChild(header);

        // Create body with two-pane layout
        const body = this._createModalBody();
        content.appendChild(body);

        // KEY CHANGE: Place both modal overlay and content in UI root for fullscreen compatibility
        const uiRoot = getOrCreateUiRoot() || document.documentElement;
        const safeUiParent =
            uiRoot || document.documentElement || document.body;
        // Guard against early document_start timing where body may be null
        if (safeUiParent) {
            safeUiParent.appendChild(overlay);
            safeUiParent.appendChild(content);
        }

        // Modal element stays in body but is now just a container (no visual elements)
        const modalParent = document.body || uiRoot || document.documentElement;
        if (modalParent) {
            modalParent.appendChild(modal);
        }

        // If body is not yet available, move modal into body when it becomes available
        if (!document.body) {
            const moveModalToBody = () => {
                try {
                    if (
                        document.body &&
                        modal.parentElement !== document.body
                    ) {
                        document.body.appendChild(modal);
                    }
                } catch (_) {}
                document.removeEventListener('DOMContentLoaded', moveModalToBody);
            };
            document.addEventListener('DOMContentLoaded', moveModalToBody);
        }

        // Store references to all modal elements for easier access
        this.core.element = modal;
        this.core.overlayElement = overlay;
        this.core.contentElement = content;
        this.core._log(
            'debug',
            'Modal element created successfully with UI root integration',
            {
                modalId: modal.id,
                contentDisplay: content.style.display,
                contentParent: content.parentElement?.id,
                uiRootId: uiRoot.id,
            }
        );

        // Mark UI ready for SPA gating
        this.core.markUiReady();

        // Subscribe to ModalStore to apply state-driven classes
        try {
            if (this.core.store && typeof this.core.store.subscribe === 'function') {
                const unsubscribe = this.core.store.subscribe((st) => {
                    try {
                        this._applyStateClasses(st.modalState);
                    } catch (_) {}
                });
                this.core._storeUnsubscribe = unsubscribe;
            }
        } catch (_) {}
    }

    /**
     * Create modal header
     * @returns {HTMLElement} Header element
     * @private
     */
    _createModalHeader() {
        const header = document.createElement('div');
        header.className = 'dualsub-modal-header';
        header.innerHTML = `
            <h3 id="dualsub-modal-title">${this._getLocalizedMessage('aiContextModalTitle')}</h3>
            <button id="dualsub-modal-close" class="dualsub-modal-close" aria-label="Close" onclick="document.dispatchEvent(new CustomEvent('aicontext:modal:closeRequested'))">×</button>
        `;
        return header;
    }

    /**
     * Create modal body with two-pane layout
     * @returns {HTMLElement} Body element
     * @private
     */
    _createModalBody() {
        const body = document.createElement('div');
        body.className = 'dualsub-modal-body';

        // Left pane: Selection panel
        const leftPane = this._createLeftPane();
        body.appendChild(leftPane);

        // Right pane: Content area
        const rightPane = this._createRightPane();
        body.appendChild(rightPane);

        return body;
    }

    /**
     * Create left pane (selection panel)
     * @returns {HTMLElement} Left pane element
     * @private
     */
    _createLeftPane() {
        const leftPane = document.createElement('div');
        leftPane.id = 'dualsub-left-pane';
        leftPane.className = 'dualsub-modal-pane';

        // Selection container
        const selectionContainer = document.createElement('div');
        selectionContainer.className = 'dualsub-selection-container';

        selectionContainer.innerHTML = `
            <h4>${this._getLocalizedMessage('aiContextSelectedWords')}</h4>
            <div id="dualsub-selected-words" class="dualsub-selected-words">
                <span class="dualsub-placeholder">${this._getLocalizedMessage('aiContextNoWordsSelected')}</span>
            </div>
            <div class="dualsub-selection-hint">
                ${this._getLocalizedMessage('aiContextClickHint')}
            </div>
        `;

        leftPane.appendChild(selectionContainer);

        // Controls container (EXACT legacy structure)
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'dualsub-controls-container';

        // Analysis button
        const analysisButton = document.createElement('button');
        analysisButton.id = 'dualsub-start-analysis';
        analysisButton.className = 'dualsub-analysis-button';
        analysisButton.disabled = true;
        analysisButton.title = this._getLocalizedMessage(
            'aiContextStartAnalysis'
        ); // EXACT legacy attribute
        analysisButton.textContent = this._getLocalizedMessage(
            'aiContextStartAnalysis'
        );

        controlsContainer.appendChild(analysisButton);
        leftPane.appendChild(controlsContainer);

        return leftPane;
    }

    /**
     * Create right pane (content area)
     * @returns {HTMLElement} Right pane element
     * @private
     */
    _createRightPane() {
        const rightPane = document.createElement('div');
        rightPane.id = 'dualsub-right-pane';
        rightPane.className = 'dualsub-modal-pane';

        // Analysis content wrapper (EXACT legacy structure)
        const analysisContent = document.createElement('div');
        analysisContent.id = 'dualsub-analysis-content';
        analysisContent.className = 'dualsub-analysis-content';

        // Initial state (selection mode)
        const initialState = this._createInitialState();
        analysisContent.appendChild(initialState);

        // Processing state (analysis mode)
        const processingState = this._createProcessingState();
        analysisContent.appendChild(processingState);

        // Results state (display mode)
        const resultsState = this._createResultsState();
        analysisContent.appendChild(resultsState);

        rightPane.appendChild(analysisContent);
        return rightPane;
    }

    /**
     * Create initial state content
     * @returns {HTMLElement} Initial state element
     * @private
     */
    _createInitialState() {
        const container = document.createElement('div');
        container.id = 'dualsub-initial-state';
        container.className = 'dualsub-analysis-placeholder'; // EXACT legacy class name

        container.innerHTML = `
            <p>${this._getLocalizedMessage('aiContextInitialMessage')}</p>
        `;

        return container;
    }

    /**
     * Create processing state content
     * @returns {HTMLElement} Processing state element
     * @private
     */
    _createProcessingState() {
        const container = document.createElement('div');
        container.id = 'dualsub-processing-state';
        container.className = 'dualsub-processing-state'; // EXACT legacy class name
        // Do not set inline display; rely on CSS state classes

        // EXACT legacy structure with rotating squares loader
        container.innerHTML = `
            <div class="loader">
                <div class="loader-square"></div>
                <div class="loader-square"></div>
                <div class="loader-square"></div>
                <div class="loader-square"></div>
                <div class="loader-square"></div>
                <div class="loader-square"></div>
                <div class="loader-square"></div>
            </div>
            <p class="dualsub-processing-text">${this._getLocalizedMessage('aiContextAnalyzing')}</p>
            <div class="dualsub-processing-note">
                ${this._getLocalizedMessage('aiContextPauseNote')}
            </div>
        `;

        return container;
    }

    /**
     * Create results state content
     * @returns {HTMLElement} Results state element
     * @private
     */
    _createResultsState() {
        const container = document.createElement('div');
        container.id = 'dualsub-analysis-results';
        container.className = 'dualsub-analysis-results'; // EXACT legacy class name
        // Do not set inline display; rely on CSS state classes

        // EXACT legacy structure - empty container, content populated dynamically
        container.innerHTML = `
            <!-- Analysis results will be populated here -->
        `;

        return container;
    }

    /**
     * Update selection display
     */
    updateSelectionDisplay() {
        // Prefer querying within the current modal content to avoid stale nodes after SPA navigation
        const container =
            this.core.contentElement?.querySelector(
                '#dualsub-selected-words'
            ) || document.getElementById('dualsub-selected-words');
        const button =
            this.core.contentElement?.querySelector(
                '#dualsub-start-analysis'
            ) || document.getElementById('dualsub-start-analysis');

        if (!container || !button) return;

        const hasPositions =
            this.core.selectedWordPositions &&
            this.core.selectedWordPositions.size > 0;
        const hasWords =
            this.core.selectedWords && this.core.selectedWords.size > 0;

        if (!hasPositions && !hasWords) {
            container.innerHTML = `<span class="dualsub-placeholder">${this._getLocalizedMessage('aiContextNoWordsSelected')}</span>`;
            button.disabled = true;
        } else {
            // Sort position keys by subtitle sequence
            const sortedPositionKeys = hasPositions
                ? [...this.core.selectedWordsOrder].sort((keyA, keyB) => {
                      const positionA =
                          this.core.selectedWordPositions.get(keyA);
                      const positionB =
                          this.core.selectedWordPositions.get(keyB);

                      if (!positionA || !positionB) return 0;

                      // Sort by wordIndex (position in subtitle)
                      const indexA =
                          positionA.position?.wordIndex ??
                          positionA.position?.index ??
                          0;
                      const indexB =
                          positionB.position?.wordIndex ??
                          positionB.position?.index ??
                          0;

                      return indexA - indexB;
                  })
                : // Fallback: no positions yet (first frame after SPA). Build from words set.
                  Array.from(this.core.selectedWords || []).map((w, idx) =>
                      `${w}:fallback:${idx}`
                  );

            const wordsHtml = sortedPositionKeys
                .map((positionKey, index) => {
                    const positionData = hasPositions
                        ? this.core.selectedWordPositions.get(positionKey)
                        : null;
                    const word = positionData ? positionData.word : positionKey.split(':')[0];

                    // Hide remove buttons during processing
                    const removeButtonStyle = this.core.isAnalyzing
                        ? ' style="display: none;"'
                        : '';
                    return `<span class="dualsub-selected-word" data-word="${word}" data-position-key="${positionKey}" data-position-index="${index}">
                    ${word}
                    <span class="dualsub-word-remove" data-word="${word}" data-position-key="${positionKey}"${removeButtonStyle}>×</span>
                </span>`;
                })
                .filter((html) => html)
                .join('');

            container.innerHTML = wordsHtml;
            button.disabled = !hasPositions && !hasWords;

            // Apply disabled styling if processing is active
            if (this.core.isAnalyzing) {
                container.classList.add('dualsub-processing-disabled');
                // Safety: force-hide remove buttons
                try {
                    container.querySelectorAll('.dualsub-word-remove').forEach((el) => {
                        el.style.display = 'none';
                    });
                } catch (_) {}
            } else {
                container.classList.remove('dualsub-processing-disabled');
                // Ensure remove buttons are visible again when re-enabled
                try {
                    container.querySelectorAll('.dualsub-word-remove').forEach((el) => {
                        el.style.removeProperty('display');
                    });
                } catch (_) {}
            }
        }
    }

    /**
     * Show initial state
     */
    showInitialState() {
        // Always allow returning to initial state when explicitly requested (e.g., Pause)
        this.core.setState(MODAL_STATES.SELECTION);
    }

    /**
     * Show processing state
     */
    showProcessingState() {
        // Delegate to centralized state rendering and refresh loader animation
        this.core.setState(MODAL_STATES.PROCESSING);
        const processing =
            this.core.contentElement?.querySelector(
                '#dualsub-processing-state'
            ) || document.getElementById('dualsub-processing-state');
        if (processing) {
            const squares = processing.querySelectorAll('.loader-square');
            squares.forEach((sq) => {
                const previous = sq.style.animation;
                sq.style.animation = 'none';
                
                sq.offsetHeight; // trigger reflow
                sq.style.animation = previous || '';
            });
        }
    }

    /**
     * Show results state
     */
    showResultsState() {
        // Delegate to centralized state rendering
        this.core.setState(MODAL_STATES.DISPLAY);
    }

    /**
     * Show analysis results
     * @param {string} results - HTML results content
     */
    showAnalysisResults(results) {
        const scope = this.core.contentElement || document;
        const analysisResults = scope.querySelector('#dualsub-analysis-results');
        if (analysisResults && results) {
            // Basic sanitization before injecting HTML
            const sanitized = String(results)
                .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
                .replace(/\son\w+="[^"]*"/gi, '')
                .replace(/\sjavascript:/gi, '');
            analysisResults.innerHTML = sanitized;
            analysisResults.scrollTop = 0;
        }
        this.core.setState(MODAL_STATES.DISPLAY);
    }

    /**
     * Show error state
     * @param {string} error - Error message
     */
    showErrorState(error) {
        const errorHtml = `
            <div class="dualsub-error">
                <h4>${this._getLocalizedMessage('aiContextAnalysisFailed')}</h4>
                <p>${error}</p>
                <button class="dualsub-btn dualsub-btn-secondary" onclick="document.dispatchEvent(new CustomEvent('aicontext:modal:closeRequested'))">
                    ${this._getLocalizedMessage('aiContextClose')}
                </button>
            </div>
        `;

        const scope = this.core.contentElement || document;
        const analysisResults = scope.querySelector('#dualsub-analysis-results');
        if (analysisResults) {
            const sanitized = errorHtml
                .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
                .replace(/\son\w+="[^"]*"/gi, '')
                .replace(/\sjavascript:/gi, '');
            analysisResults.innerHTML = sanitized;
            analysisResults.scrollTop = 0;
        }
        this.core.setState(MODAL_STATES.ERROR);
    }

    /**
     * Get localized message using DualSub's config-based localization system (Fixed internationalization)
     * @param {string} key - Message key
     * @returns {string} Localized message
     * @private
     */
    _getLocalizedMessage(key) {
        // Use DualSub's translation cache if available
        if (
            this._translationsCache &&
            this._translationsCache[key] &&
            this._translationsCache[key].message
        ) {
            this.core._log('debug', 'Using cached translation', {
                key,
                language: this._currentLanguage,
                message: this._translationsCache[key].message,
            });
            return this._translationsCache[key].message;
        }

        // Fallback to Chrome's i18n system
        try {
            const localizedText = chrome.i18n.getMessage(key);
            if (localizedText) {
                this.core._log('debug', 'Using Chrome i18n translation', {
                    key,
                    message: localizedText,
                });
                return localizedText;
            }
        } catch (error) {
            this.core._log('warn', 'Failed to get Chrome i18n message', {
                key,
                error: error.message,
            });
        }

        // Final fallback to English hardcoded messages
        const fallbackMessages = {
            aiContextModalTitle: 'AI Context Analysis',
            aiContextSelectedWords: 'Selected Words',
            aiContextNoWordsSelected: 'No words selected',
            aiContextClickHint: '💡 Click a word to add or remove it.',
            aiContextStartAnalysis: 'Start Analysis',
            aiContextInitialMessage:
                'Select words from the subtitles to begin analysis.',
            aiContextAnalyzing: 'Analyzing context...',
            aiContextPauseAnalysis: '⏸ Pause',
            aiContextPauseNote: 'Click ⏸ to pause analysis',
            aiContextAnalysisFailed: 'Analysis Failed',
            aiContextClose: 'Close',
            aiContextAnalysisResults: 'Analysis Results',
            aiContextNoContent: 'No Analysis Content',
            aiContextNoContentMessage:
                'Analysis completed but no content was returned.',
        };

        const fallbackMessage = fallbackMessages[key] || key;
        this.core._log('debug', 'Using fallback translation', {
            key,
            message: fallbackMessage,
        });
        return fallbackMessage;
    }

    /**
     * Initialize language settings using DualSub's config manager (Fixed internationalization)
     * @returns {Promise<void>}
     * @private
     */
    async _initializeLanguage() {
        try {
            // Get language preference from DualSub's config manager
            let uiLanguage = 'en'; // Default fallback

            // Access configService through the content script instance
            if (
                this.core.contentScript &&
                this.core.contentScript.configService
            ) {
                uiLanguage =
                    await this.core.contentScript.configService.get(
                        'uiLanguage'
                    );
                this.core._log(
                    'debug',
                    'Retrieved language from content script config service',
                    { uiLanguage }
                );
            } else if (window.configService) {
                uiLanguage = await window.configService.get('uiLanguage');
                this.core._log(
                    'debug',
                    'Retrieved language from global config service',
                    { uiLanguage }
                );
            } else {
                // Fallback: try to get from chrome storage directly
                const result = await chrome.storage.sync.get(['uiLanguage']);
                uiLanguage = result.uiLanguage || 'en';
                this.core._log(
                    'debug',
                    'Retrieved language from chrome storage fallback',
                    { uiLanguage }
                );
            }

            this._currentLanguage = uiLanguage;

            // Load translations for the detected language
            await this._loadTranslations(uiLanguage);

            this.core._log('info', 'Language initialization completed', {
                language: this._currentLanguage,
                translationsLoaded: !!this._translationsCache,
                configServiceAvailable: !!(
                    this.core.contentScript &&
                    this.core.contentScript.configService
                ),
            });

            // Set up language change listener (same pattern as popup.js)
            this._setupLanguageChangeListener();

            // Also listen for fullscreen changes to refresh button locales
            const onFsChange = () => {
                try {
                    const startBtn = (this.core.contentElement?.querySelector('#dualsub-start-analysis') || document.getElementById('dualsub-start-analysis'));
                    if (startBtn && !startBtn.getAttribute('data-paused-toggle')) {
                        const title = this._getLocalizedMessage('aiContextStartAnalysis');
                        startBtn.title = title;
                        startBtn.textContent = title;
                    }
                } catch (_) {}
            };
            document.addEventListener('fullscreenchange', onFsChange);
            this._onFullscreenChange = onFsChange;
        } catch (error) {
            this.core._log('error', 'Failed to initialize language settings', {
                error: error.message,
            });
            this._currentLanguage = 'en';
            this._translationsCache = null;
        }
    }

    /**
     * Set up language change listener to handle dynamic language switching
     * @private
     */
    _setupLanguageChangeListener() {
        try {
            // Use configService from content script instance
            const configService =
                this.core.contentScript?.configService || window.configService;

            if (
                configService &&
                typeof configService.onChanged === 'function'
            ) {
                configService.onChanged(async (changes) => {
                    if (changes.uiLanguage) {
                        const newLang = changes.uiLanguage;
                        this.core._log(
                            'info',
                            'Detected UI language change, reloading translations',
                            {
                                oldLanguage: this._currentLanguage,
                                newLanguage: newLang,
                            }
                        );

                        this._currentLanguage = newLang;
                        await this._loadTranslations(newLang);

                        // Refresh modal UI if it's currently visible
                        if (this.core.isVisible) {
                            this._refreshModalUI();
                        }
                    }
                });

                this.core._log(
                    'debug',
                    'Language change listener set up successfully',
                    {
                        configServiceSource: this.core.contentScript
                            ?.configService
                            ? 'contentScript'
                            : 'global',
                    }
                );
            } else {
                // Fallback: listen for storage changes directly
                chrome.storage.onChanged.addListener((changes, areaName) => {
                    if (areaName === 'sync' && changes.uiLanguage) {
                        const newLang = changes.uiLanguage.newValue;
                        this.core._log(
                            'info',
                            'Detected UI language change via storage, reloading translations',
                            {
                                oldLanguage: this._currentLanguage,
                                newLanguage: newLang,
                            }
                        );

                        this._currentLanguage = newLang;
                        this._loadTranslations(newLang).then(() => {
                            if (this.core.isVisible) {
                                this._refreshModalUI();
                            }
                        });
                    }
                });

                this.core._log(
                    'debug',
                    'Language change listener set up via storage fallback'
                );
            }
        } catch (error) {
            this.core._log(
                'warn',
                'Failed to set up language change listener',
                {
                    error: error.message,
                }
            );
        }
    }

    /**
     * Refresh modal UI with new translations
     * @private
     */
    _refreshModalUI() {
        try {
            // Update modal title
            const titleElement = document.getElementById('dualsub-modal-title');
            if (titleElement) {
                titleElement.textContent = this._getLocalizedMessage(
                    'aiContextModalTitle'
                );
            }

            // Update start analysis button localization immediately
            const startBtn = (this.core.contentElement?.querySelector('#dualsub-start-analysis') || document.getElementById('dualsub-start-analysis'));
            if (startBtn) {
                const title = this._getLocalizedMessage('aiContextStartAnalysis');
                startBtn.title = title;
                // Only set text when not in pause state
                if (!startBtn.getAttribute('data-paused-toggle')) {
                    startBtn.textContent = title;
                }
            }

            // Update selection display
            this.updateSelectionDisplay();

            // Update any visible analysis results
            const resultsContainer = document.getElementById(
                'dualsub-analysis-results'
            );
            if (resultsContainer && resultsContainer.innerHTML.trim()) {
                // Re-render results with new language
                // This would need the original analysis data to re-render properly
                this.core._log(
                    'debug',
                    'Modal UI refreshed with new language',
                    {
                        language: this._currentLanguage,
                    }
                );
            }
        } catch (error) {
            this.core._log('error', 'Failed to refresh modal UI', {
                error: error.message,
            });
        }
    }

    /**
     * Load translations for specified language (same pattern as options.js and popup.js)
     * @param {string} langCode - Language code (e.g., 'zh-CN', 'en', 'es')
     * @returns {Promise<Object>} Translations object
     * @private
     */
    async _loadTranslations(langCode) {
        try {
            // Convert hyphens to underscores for folder structure (zh-CN -> zh_CN)
            const normalizedLangCode = langCode.replace('-', '_');

            const translationsPath = chrome.runtime.getURL(
                `_locales/${normalizedLangCode}/messages.json`
            );

            this.core._log('debug', 'Loading translations', {
                langCode,
                normalizedLangCode,
                translationsPath,
            });

            const response = await fetch(translationsPath);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const translations = await response.json();
            this._translationsCache = translations;

            this.core._log('info', 'Translations loaded successfully', {
                language: langCode,
                normalizedLangCode,
                keysLoaded: Object.keys(translations).length,
                aiContextKeys: Object.keys(translations).filter((key) =>
                    key.startsWith('aiContext')
                ).length,
            });

            return translations;
        } catch (error) {
            this.core._log(
                'warn',
                `Could not load '${langCode}' translations, falling back to English`,
                {
                    langCode,
                    error: error.message,
                }
            );

            // Fallback to English
            try {
                const fallbackPath = chrome.runtime.getURL(
                    '_locales/en/messages.json'
                );
                const fallbackResponse = await fetch(fallbackPath);
                const fallbackTranslations = await fallbackResponse.json();
                this._translationsCache = fallbackTranslations;

                this.core._log('info', 'English fallback translations loaded', {
                    originalLanguage: langCode,
                    keysLoaded: Object.keys(fallbackTranslations).length,
                });

                return fallbackTranslations;
            } catch (fallbackError) {
                this.core._log('error', 'Failed to load any translations', {
                    originalLanguage: langCode,
                    fallbackError: fallbackError.message,
                });
                this._translationsCache = null;
                return {};
            }
        }
    }

    /**
     * Test and debug translation loading (for troubleshooting)
     * @returns {Object} Debug information about translations
     * @public
     */
    getTranslationDebugInfo() {
        const debugInfo = {
            currentLanguage: this._currentLanguage,
            translationsCacheLoaded: !!this._translationsCache,
            translationKeys: this._translationsCache
                ? Object.keys(this._translationsCache).filter((key) =>
                      key.startsWith('aiContext')
                  )
                : [],
            sampleTranslations: {},
        };

        // Test specific keys that should be in Chinese
        const testKeys = [
            'aiContextCultural',
            'aiContextModalTitle',
            'aiContextStartAnalysis',
        ];
        testKeys.forEach((key) => {
            debugInfo.sampleTranslations[key] = this._getLocalizedMessage(key);
        });

        this.core._log('info', 'Translation debug info', debugInfo);
        return debugInfo;
    }

    /**
     * Apply CSS state classes on content element per modal state from store
     * @param {string} modalState
     * @private
     */
    _applyStateClasses(modalState) {
        const content = this.core.contentElement || document.getElementById('dualsub-modal-content');
        if (!content) return;
        content.classList.remove('is-hidden', 'is-selection', 'is-analyzing', 'is-display', 'is-error');
        switch (modalState) {
            case 'hidden':
                content.classList.add('is-hidden');
                break;
            case 'selection':
                content.classList.add('is-selection');
                break;
            case 'processing':
                content.classList.add('is-analyzing');
                break;
            case 'display':
                content.classList.add('is-display');
                break;
            case 'error':
                content.classList.add('is-error');
                break;
        }
    }

    /**
     * Manually reload translations for specified language (for testing/debugging)
     * @param {string} langCode - Language code to load
     * @returns {Promise<void>}
     * @public
     */
    async reloadTranslations(langCode) {
        this.core._log('info', 'Manually reloading translations', {
            oldLanguage: this._currentLanguage,
            newLanguage: langCode,
        });

        this._currentLanguage = langCode;
        await this._loadTranslations(langCode);

        if (this.core.isVisible) {
            this._refreshModalUI();
        }

        // Return debug info for verification
        return this.getTranslationDebugInfo();
    }

    /**
     * Inject modal CSS styles
     * @returns {Promise<void>}
     * @private
     */
    async _injectModalStyles() {
        if (this.cssInjected) return;

        try {
            // Load CSS file
            const cssUrl = chrome.runtime.getURL(
                'content_scripts/aicontext/ui/modal.css'
            );
            const response = await fetch(cssUrl);
            const cssText = await response.text();

            // Create and inject style element
            const style = document.createElement('style');
            style.id = 'dualsub-modal-styles';
            style.textContent = cssText;
            if (document.head) {
                document.head.appendChild(style);
            } else {
                // Fallback when running at document_start before <head> exists
                (document.documentElement || document.body).appendChild(style);
                const moveStyleToHead = () => {
                    try {
                        if (document.head && style.parentElement !== document.head) {
                            document.head.appendChild(style);
                        }
                    } catch (_) {}
                    document.removeEventListener('DOMContentLoaded', moveStyleToHead);
                };
                document.addEventListener('DOMContentLoaded', moveStyleToHead);
            }

            this.cssInjected = true;
            this.core._log('debug', 'Modal CSS styles injected successfully');
        } catch (error) {
            this.core._log('error', 'Failed to inject modal CSS styles', {
                error: error.message,
            });
            // Fallback to inline styles if CSS file loading fails
            this._injectFallbackStyles();
        }
    }

    /**
     * Inject fallback inline styles
     * @private
     */
    _injectFallbackStyles() {
        const style = document.createElement('style');
        style.id = 'dualsub-modal-styles-fallback';
        style.textContent = `
            .dualsub-context-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 9998;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                visibility: hidden;
                opacity: 0;
                transition: opacity 300ms ease;
            }
            .dualsub-context-modal--visible {
                opacity: 1 !important;
                visibility: visible !important;
            }
            .dualsub-modal-content {
                position: absolute;
                top: 2vh;
                left: 50%;
                transform: translateX(-50%) scale(0.95);
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                max-width: min(95vw, 1000px);
                width: 95vw;
                height: 75vh;
                max-height: calc(100vh - 80px);
                overflow: hidden;
                transition: all 0.3s ease;
                display: flex;
                flex-direction: column;
                pointer-events: auto;
            }
            .dualsub-context-modal--visible .dualsub-modal-content {
                transform: translateX(-50%) scale(1) !important;
            }
        `;
        document.head.appendChild(style);
        this.cssInjected = true;
    }
}
