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

const TrustedPromise = Promise;
const trustedPromiseAllSettled = TrustedPromise.allSettled.bind(TrustedPromise);
const trustedPromiseResolve = TrustedPromise.resolve.bind(TrustedPromise);
const trustedPromiseThen = Function.call.bind(TrustedPromise.prototype.then);

function settleCleanupAttempts(attempts, ignoredPromise = null) {
    const work = attempts.map((attempt) => {
        try {
            const result = attempt();
            return result === ignoredPromise ? undefined : result;
        } catch (_) {
            return undefined;
        }
    });
    try {
        return trustedPromiseAllSettled(work);
    } catch (_) {
        return trustedPromiseResolve([]);
    }
}

function readErrorMessageSafely(error) {
    try {
        const message = error?.message;
        return typeof message === 'string' ? message : 'Unknown error';
    } catch (_) {
        return 'Unknown error';
    }
}

const ALLOWED_ANALYSIS_TAGS = new Set([
    'B',
    'BLOCKQUOTE',
    'BR',
    'CODE',
    'DIV',
    'EM',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'I',
    'LI',
    'OL',
    'P',
    'PRE',
    'SPAN',
    'STRONG',
    'UL',
]);

const BLOCKED_ANALYSIS_TAGS = new Set([
    'EMBED',
    'IFRAME',
    'LINK',
    'MATH',
    'META',
    'OBJECT',
    'SCRIPT',
    'STYLE',
    'SVG',
    'TEMPLATE',
]);

const TERMINAL_TEXT_FALLBACK = '[unavailable]';
const MAX_TERMINAL_TEXT_LENGTH = 2000;
const MAX_TERMINAL_LABEL_LENGTH = 200;
const MAX_TERMINAL_PREVIEW_LENGTH = 500;

/**
 * Convert an untrusted display value without allowing user-defined coercion
 * hooks to escape. The returned string is always bounded.
 *
 * @param {*} value - Value to display
 * @param {string} fallback - Trusted fallback text
 * @param {number} maxLength - Maximum returned length
 * @returns {string}
 */
export function safeDisplayText(
    value,
    fallback = TERMINAL_TEXT_FALLBACK,
    maxLength = MAX_TERMINAL_TEXT_LENGTH
) {
    const trustedFallback =
        typeof fallback === 'string' ? fallback : TERMINAL_TEXT_FALLBACK;
    const requestedLength =
        typeof maxLength === 'number' && Number.isFinite(maxLength)
            ? Math.trunc(maxLength)
            : MAX_TERMINAL_TEXT_LENGTH;
    const boundedLength = Math.max(
        0,
        Math.min(requestedLength, MAX_TERMINAL_TEXT_LENGTH)
    );
    let text = trustedFallback;
    try {
        if (value === null || value === undefined) {
            text = '';
        } else if (typeof value === 'string') {
            text = value;
        } else {
            text = String(value);
        }
    } catch (_) {
        text = trustedFallback;
    }
    return text.slice(0, boundedLength);
}

function safeReadProperty(source, key, fallback) {
    try {
        const value = source?.[key];
        return value === undefined ? fallback : value;
    } catch (_) {
        return fallback;
    }
}

function safeReadResult(source) {
    try {
        return source?.result;
    } catch (_) {
        return TERMINAL_TEXT_FALLBACK;
    }
}

function safeResultPreview(value) {
    if (value === null) return 'null';

    const valueType = typeof value;
    if (valueType !== 'object' && valueType !== 'function') {
        if (valueType === 'undefined') return 'undefined';
        return safeDisplayText(
            value,
            TERMINAL_TEXT_FALLBACK,
            MAX_TERMINAL_PREVIEW_LENGTH
        );
    }

    try {
        const serialized = JSON.stringify(value, null, 2);
        if (typeof serialized === 'string') {
            return serialized.slice(0, MAX_TERMINAL_PREVIEW_LENGTH);
        }
    } catch (_) {
        return TERMINAL_TEXT_FALLBACK;
    }

    return TERMINAL_TEXT_FALLBACK;
}

/**
 * Keep the small formatting vocabulary produced by the legacy formatter while
 * stripping executable markup and all attributes except DualSub-owned classes.
 * Parsing happens in an inert template before the result enters the live DOM.
 */
export function sanitizeAnalysisHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value ?? '');

    const elements = [...template.content.querySelectorAll('*')].reverse();
    for (const element of elements) {
        if (BLOCKED_ANALYSIS_TAGS.has(element.tagName)) {
            element.remove();
            continue;
        }

        if (!ALLOWED_ANALYSIS_TAGS.has(element.tagName)) {
            element.replaceWith(...element.childNodes);
            continue;
        }

        for (const attribute of [...element.attributes]) {
            if (attribute.name !== 'class') {
                element.removeAttribute(attribute.name);
            }
        }

        if (element.hasAttribute('class')) {
            const safeClasses = [...element.classList].filter((className) =>
                /^dualsub-[a-z0-9_-]+$/i.test(className)
            );
            if (safeClasses.length > 0) {
                element.className = safeClasses.join(' ');
            } else {
                element.removeAttribute('class');
            }
        }
    }

    return template.innerHTML;
}

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
        this._terminalRetryActionCleanup = null;
        this._destroyed = false;
        this._destroyPromise = null;
        this._configLanguageUnsubscribe = null;
        this._storageLanguageChangeListener = null;
        this._fullscreenChangeListener = null;
        this._moveModalToBodyListener = null;
        this._moveStyleToHeadListener = null;
        this._languageCleanupBarriers = new Set();
        this._languageSetupGeneration = 0;
        this._languageSubscriptionGeneration = 0;
        this._languageLoadGeneration = 0;
        this._terminalActionSetupGeneration = 0;
        this._storeUnsubscribe = null;
        this._ownedModalElement = null;
        this._ownedOverlayElement = null;
        this._ownedContentElement = null;
    }

    /**
     * Initialize the UI module (Issue #2: Fixed internationalization race condition)
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._destroyed) return;
        if (this._languageInitialized) {
            this.core._log('debug', 'Language already initialized, skipping');
            return;
        }

        this.core._log('debug', 'Starting UI module initialization');

        // Initialize language settings first
        const languageInitialized = await this._initializeLanguage();
        if (this._destroyed) return;
        if (languageInitialized !== true) return;
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
        if (this._destroyed) return;
        this.clearTerminalRetryActions();
        this._releaseDeferredDomReadyListener('_moveModalToBodyListener');
        // Ensure language is initialized before creating UI elements
        if (!this._languageInitialized) {
            this.core._log(
                'debug',
                'Language not initialized, initializing now'
            );
            await this.initialize();
            if (this._destroyed) return;
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
        if (this._destroyed) return;

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
                if (this._destroyed) {
                    this._releaseDeferredDomReadyListener(
                        '_moveModalToBodyListener',
                        moveModalToBody
                    );
                    return;
                }
                try {
                    if (
                        document.body &&
                        modal.parentElement !== document.body
                    ) {
                        document.body.appendChild(modal);
                    }
                } catch (_) {}
                this._releaseDeferredDomReadyListener(
                    '_moveModalToBodyListener',
                    moveModalToBody
                );
            };
            this._moveModalToBodyListener = moveModalToBody;
            document.addEventListener('DOMContentLoaded', moveModalToBody);
            if (
                this._destroyed ||
                this._moveModalToBodyListener !== moveModalToBody
            ) {
                try {
                    document.removeEventListener(
                        'DOMContentLoaded',
                        moveModalToBody
                    );
                } catch (_) {}
                return;
            }
        }

        // Store references to all modal elements for easier access
        this.core.element = modal;
        this.core.overlayElement = overlay;
        this.core.contentElement = content;
        this._ownedModalElement = modal;
        this._ownedOverlayElement = overlay;
        this._ownedContentElement = content;
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
            if (
                this.core.store &&
                typeof this.core.store.subscribe === 'function'
            ) {
                const core = this.core;
                const unsubscribe = core.store.subscribe((st) => {
                    try {
                        this._applyStateClasses(st.modalState);
                    } catch (_) {}
                });
                if (this._destroyed || this.core !== core) {
                    try {
                        if (typeof unsubscribe === 'function') unsubscribe();
                    } catch (_) {}
                    return;
                }
                const previousUnsubscribe = this._storeUnsubscribe;
                this._storeUnsubscribe = unsubscribe;
                core._storeUnsubscribe = unsubscribe;
                if (typeof previousUnsubscribe === 'function') {
                    try {
                        previousUnsubscribe();
                    } catch (_) {}
                }
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
            const placeholder = document.createElement('span');
            placeholder.className = 'dualsub-placeholder';
            placeholder.textContent = this._getLocalizedMessage(
                'aiContextNoWordsSelected'
            );
            container.replaceChildren(placeholder);
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
                  Array.from(this.core.selectedWords || []).map(
                      (w, idx) => `${w}:fallback:${idx}`
                  );

            const wordElements = sortedPositionKeys.map(
                (positionKey, index) => {
                    const positionData = hasPositions
                        ? this.core.selectedWordPositions.get(positionKey)
                        : null;
                    const word = positionData
                        ? String(positionData.word ?? '')
                        : Array.from(this.core.selectedWords || [])[index] ||
                          '';

                    const wordElement = document.createElement('span');
                    wordElement.className = 'dualsub-selected-word';
                    wordElement.dataset.word = word;
                    wordElement.dataset.positionKey = positionKey;
                    wordElement.dataset.positionIndex = String(index);
                    wordElement.append(document.createTextNode(word));

                    const removeButton = document.createElement('span');
                    removeButton.className = 'dualsub-word-remove';
                    removeButton.dataset.word = word;
                    removeButton.dataset.positionKey = positionKey;
                    removeButton.textContent = '×';
                    if (this.core.isAnalyzing) {
                        removeButton.style.display = 'none';
                    }
                    if (this.core.config?.privateAnalysis !== true) {
                        wordElement.appendChild(removeButton);
                    }

                    return wordElement;
                }
            );

            container.replaceChildren(...wordElements);
            button.disabled = !hasPositions && !hasWords;

            // Apply disabled styling if processing is active
            if (this.core.isAnalyzing) {
                container.classList.add('dualsub-processing-disabled');
                // Safety: force-hide remove buttons
                try {
                    container
                        .querySelectorAll('.dualsub-word-remove')
                        .forEach((el) => {
                            el.style.display = 'none';
                        });
                } catch (_) {}
            } else {
                container.classList.remove('dualsub-processing-disabled');
                // Ensure remove buttons are visible again when re-enabled
                try {
                    container
                        .querySelectorAll('.dualsub-word-remove')
                        .forEach((el) => {
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
        this.clearTerminalRetryActions();
        // Always allow returning to initial state when explicitly requested (e.g., Pause)
        this.core.setState(MODAL_STATES.SELECTION);
    }

    /**
     * Show processing state
     */
    showProcessingState() {
        this.clearTerminalRetryActions();
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
        this.clearTerminalRetryActions();
        // Delegate to centralized state rendering
        this.core.setState(MODAL_STATES.DISPLAY);
    }

    /**
     * Show analysis results
     * @param {string} results - HTML results content
     */
    showAnalysisResults(results) {
        this.clearTerminalRetryActions();
        const scope = this.core.contentElement || document;
        const analysisResults = scope.querySelector(
            '#dualsub-analysis-results'
        );
        if (analysisResults && results) {
            analysisResults.innerHTML = sanitizeAnalysisHtml(results);
            analysisResults.scrollTop = 0;
        }
        this.core.setState(MODAL_STATES.DISPLAY);
    }

    _isCurrentTerminalActionSetup(setupGeneration) {
        return (
            !this._destroyed &&
            setupGeneration === this._terminalActionSetupGeneration
        );
    }

    _beginTerminalActionSetup() {
        if (this._destroyed) return null;
        const setupGeneration = ++this._terminalActionSetupGeneration;
        this.clearTerminalRetryActions(setupGeneration);
        return this._isCurrentTerminalActionSetup(setupGeneration)
            ? setupGeneration
            : null;
    }

    _registerTerminalActions(setupGeneration, actions, publishActions) {
        if (!this._isCurrentTerminalActionSetup(setupGeneration)) return false;

        const actionRecord = { active: true, published: false };
        let actionCleanup;
        const bindings = actions.map(({ button, action }) => {
            const binding = { button, action, handler: null };
            binding.handler = (event) => {
                if (
                    !this._isCurrentTerminalActionSetup(setupGeneration) ||
                    !actionRecord.active ||
                    !actionRecord.published ||
                    this._terminalRetryActionCleanup !== actionCleanup
                ) {
                    return;
                }
                if (
                    this.core.config?.privateAnalysis === true &&
                    event?.isTrusted !== true
                ) {
                    return;
                }

                this.clearTerminalRetryActions();
                if (
                    this._destroyed ||
                    actionRecord.active ||
                    this._terminalRetryActionCleanup !== null
                ) {
                    return;
                }
                if (typeof binding.action === 'function') binding.action();
            };
            return binding;
        });
        actionCleanup = () => {
            actionRecord.active = false;
            for (const { button, handler } of bindings) {
                try {
                    button.removeEventListener('click', handler);
                } catch (_) {}
            }
        };
        const releaseActions = () => {
            try {
                actionCleanup();
            } finally {
                if (this._terminalRetryActionCleanup === actionCleanup) {
                    this._terminalRetryActionCleanup = null;
                }
            }
        };

        this._terminalRetryActionCleanup = actionCleanup;
        for (const { button, handler } of bindings) {
            try {
                button.addEventListener('click', handler);
            } catch (_) {
                releaseActions();
                return false;
            }
            if (
                !this._isCurrentTerminalActionSetup(setupGeneration) ||
                this._terminalRetryActionCleanup !== actionCleanup
            ) {
                releaseActions();
                return false;
            }
        }

        try {
            publishActions();
        } catch (error) {
            releaseActions();
            throw error;
        }
        if (
            !this._isCurrentTerminalActionSetup(setupGeneration) ||
            !actionRecord.active ||
            this._terminalRetryActionCleanup !== actionCleanup
        ) {
            releaseActions();
            return false;
        }
        actionRecord.published = true;
        return true;
    }

    /**
     * Show error state
     * @param {string} error - Error message
     */
    showErrorState(error) {
        const setupGeneration = this._beginTerminalActionSetup();
        if (setupGeneration === null) return;
        const scope = this.core.contentElement || document;
        const analysisResults = scope.querySelector(
            '#dualsub-analysis-results'
        );
        if (analysisResults) {
            const errorContainer = document.createElement('div');
            errorContainer.className = 'dualsub-error';

            const heading = document.createElement('h4');
            heading.textContent = this._getLocalizedMessage(
                'aiContextAnalysisFailed'
            );

            const message = document.createElement('p');
            message.textContent = String(error ?? '');

            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'dualsub-btn dualsub-btn-secondary';
            closeButton.textContent =
                this._getLocalizedMessage('aiContextClose');
            if (
                !this._registerTerminalActions(
                    setupGeneration,
                    [
                        {
                            button: closeButton,
                            action: () =>
                                document.dispatchEvent(
                                    new CustomEvent(
                                        'aicontext:modal:closeRequested'
                                    )
                                ),
                        },
                    ],
                    () => {
                        errorContainer.append(heading, message, closeButton);
                        analysisResults.replaceChildren(errorContainer);
                        analysisResults.scrollTop = 0;
                        if (
                            this._isCurrentTerminalActionSetup(setupGeneration)
                        ) {
                            this.core.setState(MODAL_STATES.ERROR);
                        }
                    }
                )
            ) {
                return;
            }
            return;
        }
        if (!this._isCurrentTerminalActionSetup(setupGeneration)) return;
        this.core.setState(MODAL_STATES.ERROR);
    }

    /**
     * Render the private analysis terminal state without provider text,
     * attempt counters, result previews, or document-dispatched actions.
     *
     * @param {Object} details - Trusted action callbacks and retryability
     */
    showPrivateTerminalFailure(details = {}) {
        const setupGeneration = this._beginTerminalActionSetup();
        if (setupGeneration === null) return;
        const scope = this.core.contentElement || document;
        const analysisResults = scope.querySelector(
            '#dualsub-analysis-results'
        );
        if (!analysisResults) {
            if (this._isCurrentTerminalActionSetup(setupGeneration)) {
                this.core.setState(MODAL_STATES.ERROR);
            }
            return;
        }

        const retryable =
            safeReadProperty(details, 'retryable', false) === true;
        const onRetry = safeReadProperty(details, 'onRetry', null);
        const onClose = safeReadProperty(details, 'onClose', null);

        const errorContainer = document.createElement('div');
        errorContainer.className = 'dualsub-error';

        const heading = document.createElement('h4');
        heading.textContent = safeDisplayText(
            this._getLocalizedMessage('aiContextAnalysisFailed'),
            'Analysis Failed',
            MAX_TERMINAL_LABEL_LENGTH
        );

        const message = document.createElement('p');
        message.textContent = 'Analysis could not be completed.';

        const actions = document.createElement('div');
        actions.className = 'dualsub-error-actions';
        actions.style.marginTop = '15px';
        const actionBindings = [];

        if (retryable && typeof onRetry === 'function') {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'dualsub-btn dualsub-btn-primary';
            retryButton.textContent = safeDisplayText(
                this._getLocalizedMessage('aiContextRetryButton'),
                'Try Again',
                MAX_TERMINAL_LABEL_LENGTH
            );
            actions.appendChild(retryButton);
            actionBindings.push({ button: retryButton, action: onRetry });
        }

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'dualsub-btn dualsub-btn-secondary';
        if (actionBindings.length > 0) closeButton.style.marginLeft = '10px';
        closeButton.textContent = safeDisplayText(
            this._getLocalizedMessage('aiContextClose'),
            'Close',
            MAX_TERMINAL_LABEL_LENGTH
        );
        actions.appendChild(closeButton);
        actionBindings.push({ button: closeButton, action: onClose });

        if (
            !this._registerTerminalActions(
                setupGeneration,
                actionBindings,
                () => {
                    errorContainer.append(heading, message, actions);
                    analysisResults.replaceChildren(errorContainer);
                    analysisResults.scrollTop = 0;
                    if (this._isCurrentTerminalActionSetup(setupGeneration)) {
                        this.core.setState(MODAL_STATES.ERROR);
                    }
                }
            )
        ) {
            return;
        }
    }

    /**
     * Show the terminal state reached after invalid-response retries are
     * exhausted. All provider-controlled values are rendered as text; action
     * controls are created separately so sanitization cannot remove them.
     *
     * @param {Object} details - Terminal failure details
     */
    showTerminalRetryFailure(details) {
        const setupGeneration = this._beginTerminalActionSetup();
        if (setupGeneration === null) return;
        const scope = this.core.contentElement || document;
        const analysisResults = scope.querySelector(
            '#dualsub-analysis-results'
        );
        if (!analysisResults) {
            if (this._isCurrentTerminalActionSetup(setupGeneration)) {
                this.core.setState(MODAL_STATES.DISPLAY);
            }
            return;
        }

        const title = safeDisplayText(
            safeReadProperty(details, 'title', 'Analysis Failed'),
            'Analysis Failed',
            MAX_TERMINAL_LABEL_LENGTH
        );
        const messageText = safeDisplayText(
            safeReadProperty(details, 'message', TERMINAL_TEXT_FALLBACK)
        );
        const errorText = safeDisplayText(
            safeReadProperty(details, 'error', TERMINAL_TEXT_FALLBACK)
        );
        const currentAttempt = safeDisplayText(
            safeReadProperty(details, 'currentAttempt', '?'),
            '?',
            20
        );
        const maxRetries = safeDisplayText(
            safeReadProperty(details, 'maxRetries', '?'),
            '?',
            20
        );
        const retryLabel = safeDisplayText(
            safeReadProperty(details, 'retryLabel', 'Try Again'),
            'Try Again',
            MAX_TERMINAL_LABEL_LENGTH
        );
        const closeLabel = safeDisplayText(
            safeReadProperty(details, 'closeLabel', 'Close'),
            'Close',
            MAX_TERMINAL_LABEL_LENGTH
        );
        const resultPreview = safeResultPreview(safeReadResult(details));
        const onRetry = safeReadProperty(details, 'onRetry', null);
        const onClose = safeReadProperty(details, 'onClose', null);
        if (!this._isCurrentTerminalActionSetup(setupGeneration)) return;

        const errorContainer = document.createElement('div');
        errorContainer.className = 'dualsub-error';

        const heading = document.createElement('h4');
        heading.textContent = title;

        const message = document.createElement('p');
        message.textContent = messageText;

        const errorDetails = document.createElement('div');
        errorDetails.className = 'dualsub-error-details';
        errorDetails.style.margin = '15px 0';
        errorDetails.textContent = `Error: ${errorText}\nAttempts: ${currentAttempt}/${maxRetries}`;

        const actions = document.createElement('div');
        actions.className = 'dualsub-error-actions';
        actions.style.marginTop = '15px';

        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'dualsub-btn dualsub-btn-primary';
        retryButton.textContent = retryLabel;

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'dualsub-btn dualsub-btn-secondary';
        closeButton.style.marginLeft = '10px';
        closeButton.textContent = closeLabel;

        const debugDetails = document.createElement('details');
        debugDetails.open = true;
        const debugSummary = document.createElement('summary');
        debugSummary.textContent = 'Debug Information';
        const debugContent = document.createElement('pre');
        debugContent.textContent = `Error Type: Invalid Analysis Response\nRetry Attempts: ${currentAttempt}\nLast Error: ${errorText}\nResult Preview: ${resultPreview}`;
        debugDetails.append(debugSummary, debugContent);

        if (
            !this._registerTerminalActions(
                setupGeneration,
                [
                    { button: retryButton, action: onRetry },
                    { button: closeButton, action: onClose },
                ],
                () => {
                    actions.append(retryButton, closeButton);
                    errorContainer.append(
                        heading,
                        message,
                        errorDetails,
                        actions,
                        debugDetails
                    );
                    analysisResults.replaceChildren(errorContainer);
                    analysisResults.scrollTop = 0;
                    if (this._isCurrentTerminalActionSetup(setupGeneration)) {
                        this.core.setState(MODAL_STATES.DISPLAY);
                    }
                }
            )
        ) {
            return;
        }
    }

    /**
     * Remove action handlers owned by the terminal retry UI.
     * @param {?number} setupGeneration - Current setup allowed to clear without invalidating itself
     * @returns {Promise<Array>}
     */
    clearTerminalRetryActions(setupGeneration = null) {
        if (setupGeneration === null) {
            this._terminalActionSetupGeneration += 1;
        } else if (setupGeneration !== this._terminalActionSetupGeneration) {
            return trustedPromiseResolve([]);
        }

        const cleanup = this._terminalRetryActionCleanup;
        this._terminalRetryActionCleanup = null;
        return settleCleanupAttempts(
            [
                () => {
                    if (typeof cleanup === 'function') return cleanup();
                    return undefined;
                },
            ],
            this._destroyPromise
        );
    }

    _releaseDeferredDomReadyListener(field, expectedListener = this[field]) {
        const listener = this[field];
        if (!listener || listener !== expectedListener) return false;

        this[field] = null;
        try {
            document.removeEventListener('DOMContentLoaded', listener);
            return true;
        } catch (_) {
            return false;
        }
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
        const isCurrent = this._startLanguageLoad();
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
                if (!isCurrent()) return false;
                this.core._log(
                    'debug',
                    'Retrieved language from content script config service',
                    { uiLanguage }
                );
            } else if (window.configService) {
                uiLanguage = await window.configService.get('uiLanguage');
                if (!isCurrent()) return false;
                this.core._log(
                    'debug',
                    'Retrieved language from global config service',
                    { uiLanguage }
                );
            } else {
                // Fallback: try to get from chrome storage directly
                const result = await chrome.storage.sync.get(['uiLanguage']);
                if (!isCurrent()) return false;
                uiLanguage = result.uiLanguage || 'en';
                this.core._log(
                    'debug',
                    'Retrieved language from chrome storage fallback',
                    { uiLanguage }
                );
            }

            // Load translations for the detected language
            await this._loadTranslations(uiLanguage, isCurrent);
            if (!isCurrent()) return false;
            this._currentLanguage = uiLanguage;

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
            if (this._destroyed) return;

            // Also listen for fullscreen changes to refresh button locales
            const onFsChange = () => {
                if (this._destroyed) return;
                try {
                    const startBtn =
                        this.core.contentElement?.querySelector(
                            '#dualsub-start-analysis'
                        ) || document.getElementById('dualsub-start-analysis');
                    if (
                        startBtn &&
                        !startBtn.getAttribute('data-paused-toggle')
                    ) {
                        const title = this._getLocalizedMessage(
                            'aiContextStartAnalysis'
                        );
                        startBtn.title = title;
                        startBtn.textContent = title;
                    }
                } catch (_) {}
            };
            const previousFullscreenListener =
                this._fullscreenChangeListener || this._onFullscreenChange;
            this._fullscreenChangeListener = null;
            this._onFullscreenChange = null;
            if (previousFullscreenListener) {
                try {
                    document.removeEventListener(
                        'fullscreenchange',
                        previousFullscreenListener
                    );
                } catch (_) {}
            }
            if (this._destroyed) return;
            this._fullscreenChangeListener = onFsChange;
            this._onFullscreenChange = onFsChange;
            document.addEventListener('fullscreenchange', onFsChange);
            if (this._destroyed) {
                this._fullscreenChangeListener = null;
                this._onFullscreenChange = null;
                try {
                    document.removeEventListener(
                        'fullscreenchange',
                        onFsChange
                    );
                } catch (_) {}
            }
            return isCurrent();
        } catch (error) {
            const errorMessage = readErrorMessageSafely(error);
            if (!isCurrent()) return false;
            this.core._log('error', 'Failed to initialize language settings', {
                error: errorMessage,
            });
            if (!isCurrent()) return false;
            this._currentLanguage = 'en';
            this._translationsCache = null;
            return true;
        }
    }

    /**
     * Set up language change listener to handle dynamic language switching
     * @private
     */
    _setupLanguageChangeListener() {
        if (this._destroyed) return;

        const setupGeneration = ++this._languageSetupGeneration;
        this._releaseLanguageListenerAuthority();
        if (!this._isCurrentLanguageSetup(setupGeneration)) return;

        const subscriptionGeneration = this._languageSubscriptionGeneration;
        let configCandidate = null;
        let storageCandidate = null;
        try {
            // Use configService from content script instance
            const configService =
                this.core.contentScript?.configService || window.configService;

            if (
                configService &&
                typeof configService.onChanged === 'function'
            ) {
                const unsubscribe = configService.onChanged(async (changes) => {
                    if (
                        !this._isCurrentLanguageSubscription(
                            subscriptionGeneration,
                            setupGeneration
                        )
                    ) {
                        return;
                    }
                    if (changes.uiLanguage) {
                        const newLang = changes.uiLanguage;
                        const isCurrent = this._startLanguageLoad(() =>
                            this._isCurrentLanguageSubscription(
                                subscriptionGeneration,
                                setupGeneration
                            )
                        );
                        if (!isCurrent()) return;
                        this.core._log(
                            'info',
                            'Detected UI language change, reloading translations',
                            {
                                oldLanguage: this._currentLanguage,
                                newLanguage: newLang,
                            }
                        );

                        await this._loadTranslations(newLang, isCurrent);
                        if (!isCurrent()) return;
                        this._currentLanguage = newLang;

                        // Refresh modal UI if it's currently visible
                        if (this.core.isVisible) {
                            if (!isCurrent()) return;
                            this._refreshModalUI();
                        }
                    }
                });
                configCandidate = unsubscribe;

                if (
                    this._isCurrentLanguageSubscription(
                        subscriptionGeneration,
                        setupGeneration
                    )
                ) {
                    this._configLanguageUnsubscribe = unsubscribe;
                } else {
                    this._invokeLanguageUnsubscribe(unsubscribe);
                    return;
                }

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
                const onStorageChanged = async (changes, areaName) => {
                    if (
                        !this._isCurrentLanguageSubscription(
                            subscriptionGeneration,
                            setupGeneration
                        )
                    ) {
                        return;
                    }
                    if (areaName === 'sync' && changes.uiLanguage) {
                        const newLang = changes.uiLanguage.newValue;
                        const isCurrent = this._startLanguageLoad(() =>
                            this._isCurrentLanguageSubscription(
                                subscriptionGeneration,
                                setupGeneration
                            )
                        );
                        if (!isCurrent()) return;
                        this.core._log(
                            'info',
                            'Detected UI language change via storage, reloading translations',
                            {
                                oldLanguage: this._currentLanguage,
                                newLanguage: newLang,
                            }
                        );

                        await this._loadTranslations(newLang, isCurrent);
                        if (!isCurrent()) return;
                        this._currentLanguage = newLang;
                        if (this.core.isVisible) {
                            if (!isCurrent()) return;
                            this._refreshModalUI();
                        }
                    }
                };
                storageCandidate = onStorageChanged;
                this._storageLanguageChangeListener = onStorageChanged;
                chrome.storage.onChanged.addListener(onStorageChanged);
                if (
                    !this._isCurrentLanguageSubscription(
                        subscriptionGeneration,
                        setupGeneration
                    )
                ) {
                    try {
                        chrome.storage.onChanged.removeListener(
                            onStorageChanged
                        );
                    } catch (_) {}
                    if (
                        this._storageLanguageChangeListener === onStorageChanged
                    ) {
                        this._storageLanguageChangeListener = null;
                    }
                    return;
                }

                this.core._log(
                    'debug',
                    'Language change listener set up via storage fallback'
                );
            }
        } catch (error) {
            const subscriptionStillCurrent =
                this._isCurrentLanguageSetup(setupGeneration) &&
                subscriptionGeneration === this._languageSubscriptionGeneration;
            if (subscriptionStillCurrent) {
                this._languageSubscriptionGeneration += 1;
            }

            if (
                configCandidate &&
                this._configLanguageUnsubscribe === configCandidate
            ) {
                this._configLanguageUnsubscribe = null;
                this._invokeLanguageUnsubscribe(configCandidate);
            }
            if (storageCandidate) {
                try {
                    chrome.storage.onChanged.removeListener(storageCandidate);
                } catch (_) {}
                if (this._storageLanguageChangeListener === storageCandidate) {
                    this._storageLanguageChangeListener = null;
                }
            }

            const errorMessage = readErrorMessageSafely(error);
            if (
                this._destroyed ||
                !this._isCurrentLanguageSetup(setupGeneration)
            ) {
                return;
            }
            this.core._log(
                'warn',
                'Failed to set up language change listener',
                {
                    error: errorMessage,
                }
            );
        }
    }

    _isCurrentLanguageSetup(setupGeneration) {
        return (
            !this._destroyed &&
            setupGeneration === this._languageSetupGeneration
        );
    }

    _isCurrentLanguageSubscription(
        subscriptionGeneration,
        setupGeneration = this._languageSetupGeneration
    ) {
        return (
            this._isCurrentLanguageSetup(setupGeneration) &&
            subscriptionGeneration === this._languageSubscriptionGeneration
        );
    }

    _startLanguageLoad(ownerIsCurrent = () => true) {
        const core = this.core;
        const generation = ++this._languageLoadGeneration;
        return () => {
            if (
                this._destroyed ||
                this.core !== core ||
                generation !== this._languageLoadGeneration
            ) {
                return false;
            }
            let ownerCurrent = false;
            try {
                ownerCurrent = ownerIsCurrent() === true;
            } catch (_) {
                return false;
            }
            return (
                ownerCurrent &&
                !this._destroyed &&
                this.core === core &&
                generation === this._languageLoadGeneration
            );
        };
    }

    _invokeLanguageUnsubscribe(unsubscribe) {
        if (typeof unsubscribe !== 'function') {
            return trustedPromiseResolve(undefined);
        }

        let resolveBarrier;
        const barrier = new TrustedPromise((resolve) => {
            resolveBarrier = resolve;
        });
        this._languageCleanupBarriers.add(barrier);
        let cleanupResult;
        try {
            cleanupResult = unsubscribe();
        } catch (_) {
            cleanupResult = undefined;
        }
        const cleanup = settleCleanupAttempts(
            [() => cleanupResult],
            this._destroyPromise
        );
        const finish = () => {
            this._languageCleanupBarriers.delete(barrier);
            resolveBarrier();
        };
        trustedPromiseThen(cleanup, finish, finish);
        return barrier;
    }

    _waitForLanguageCleanupBarriers() {
        const barriers = [...this._languageCleanupBarriers];
        if (barriers.length === 0) {
            return trustedPromiseResolve(undefined);
        }

        let cleanup;
        try {
            cleanup = trustedPromiseAllSettled(barriers);
        } catch (_) {
            cleanup = trustedPromiseResolve(undefined);
        }
        return trustedPromiseThen(cleanup, () =>
            this._waitForLanguageCleanupBarriers()
        );
    }

    _releaseLanguageListenerAuthority() {
        this._languageSubscriptionGeneration += 1;
        const configUnsubscribe = this._configLanguageUnsubscribe;
        const storageListener = this._storageLanguageChangeListener;
        this._configLanguageUnsubscribe = null;
        this._storageLanguageChangeListener = null;

        try {
            if (storageListener) {
                chrome.storage.onChanged.removeListener(storageListener);
            }
        } catch (_) {}
        this._invokeLanguageUnsubscribe(configUnsubscribe);
    }

    revokeAuthority() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._languageSetupGeneration += 1;
        this._languageSubscriptionGeneration += 1;
        this._languageLoadGeneration += 1;
        this._terminalActionSetupGeneration += 1;
    }

    /**
     * Terminally release UI-owned listeners.
     *
     * @returns {Promise<void>} The canonical destruction promise
     */
    destroy() {
        if (this._destroyPromise) return this._destroyPromise;

        let resolveDestroy;
        this._destroyPromise = new TrustedPromise((resolve) => {
            resolveDestroy = resolve;
        });
        this.revokeAuthority();
        const configUnsubscribe = this._configLanguageUnsubscribe;
        const storageListener = this._storageLanguageChangeListener;
        const fullscreenListener =
            this._fullscreenChangeListener || this._onFullscreenChange;
        const moveModalToBodyListener = this._moveModalToBodyListener;
        const moveStyleToHeadListener = this._moveStyleToHeadListener;
        const core = this.core;
        const storeUnsubscribe = this._storeUnsubscribe;
        const ownedModalElement = this._ownedModalElement;
        const ownedOverlayElement = this._ownedOverlayElement;
        const ownedContentElement = this._ownedContentElement;
        this._configLanguageUnsubscribe = null;
        this._storageLanguageChangeListener = null;
        this._fullscreenChangeListener = null;
        this._onFullscreenChange = null;
        this._moveModalToBodyListener = null;
        this._moveStyleToHeadListener = null;
        this._storeUnsubscribe = null;
        this._ownedModalElement = null;
        this._ownedOverlayElement = null;
        this._ownedContentElement = null;

        const terminalRetryCleanup = this.clearTerminalRetryActions();
        const cleanup = settleCleanupAttempts(
            [
                () => terminalRetryCleanup,
                () => {
                    if (storageListener) {
                        return chrome.storage.onChanged.removeListener(
                            storageListener
                        );
                    }
                    return undefined;
                },
                () => {
                    if (fullscreenListener) {
                        return document.removeEventListener(
                            'fullscreenchange',
                            fullscreenListener
                        );
                    }
                    return undefined;
                },
                () => {
                    if (moveModalToBodyListener) {
                        return document.removeEventListener(
                            'DOMContentLoaded',
                            moveModalToBodyListener
                        );
                    }
                    return undefined;
                },
                () => {
                    if (moveStyleToHeadListener) {
                        return document.removeEventListener(
                            'DOMContentLoaded',
                            moveStyleToHeadListener
                        );
                    }
                    return undefined;
                },
                () => this._invokeLanguageUnsubscribe(configUnsubscribe),
                () => {
                    if (core?._storeUnsubscribe === storeUnsubscribe) {
                        core._storeUnsubscribe = null;
                    }
                    if (typeof storeUnsubscribe === 'function') {
                        return storeUnsubscribe();
                    }
                    return undefined;
                },
                () => ownedModalElement?.remove(),
                () => ownedOverlayElement?.remove(),
                () => ownedContentElement?.remove(),
            ],
            this._destroyPromise
        );
        const detachState = () => {
            this.core = null;
            this._translationsCache = null;
            this._currentLanguage = null;
            this._languageInitialized = false;
            this._languageCleanupBarriers.clear();
            resolveDestroy();
        };
        const finishCleanup = () => {
            const languageCleanup = this._waitForLanguageCleanupBarriers();
            trustedPromiseThen(languageCleanup, detachState, detachState);
        };
        trustedPromiseThen(cleanup, finishCleanup, finishCleanup);
        return this._destroyPromise;
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
            const startBtn =
                this.core.contentElement?.querySelector(
                    '#dualsub-start-analysis'
                ) || document.getElementById('dualsub-start-analysis');
            if (startBtn) {
                const title = this._getLocalizedMessage(
                    'aiContextStartAnalysis'
                );
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
     * @param {Function} isCurrent - Whether this load still owns commit authority
     * @returns {Promise<Object>} Translations object
     * @private
     */
    async _loadTranslations(langCode, isCurrent = () => !this._destroyed) {
        const acceptsCommit = () => {
            if (this._destroyed) return false;
            try {
                return isCurrent();
            } catch (_) {
                return false;
            }
        };

        if (!acceptsCommit()) return {};
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
            if (!acceptsCommit()) return {};
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const translations = await response.json();
            if (!acceptsCommit()) return {};
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
            if (!acceptsCommit()) return {};
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
                if (!acceptsCommit()) return {};
                const fallbackTranslations = await fallbackResponse.json();
                if (!acceptsCommit()) return {};
                this._translationsCache = fallbackTranslations;

                this.core._log('info', 'English fallback translations loaded', {
                    originalLanguage: langCode,
                    keysLoaded: Object.keys(fallbackTranslations).length,
                });

                return fallbackTranslations;
            } catch (fallbackError) {
                if (!acceptsCommit()) return {};
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
        if (modalState !== MODAL_STATES.DISPLAY) {
            this.clearTerminalRetryActions();
        }
        const content =
            this.core.contentElement ||
            document.getElementById('dualsub-modal-content');
        if (!content) return;
        content.classList.remove(
            'is-hidden',
            'is-selection',
            'is-analyzing',
            'is-display',
            'is-error'
        );
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
        if (this._destroyed || !this.core) return undefined;
        const core = this.core;
        const isCurrent = this._startLanguageLoad();

        core._log('info', 'Manually reloading translations', {
            oldLanguage: this._currentLanguage,
            newLanguage: langCode,
        });
        if (!isCurrent()) return undefined;

        await this._loadTranslations(langCode, isCurrent);
        if (!isCurrent()) return undefined;
        this._currentLanguage = langCode;

        if (core.isVisible) {
            if (!isCurrent()) return undefined;
            this._refreshModalUI();
        }
        if (!isCurrent()) return undefined;

        // Return debug info for verification
        return this.getTranslationDebugInfo();
    }

    /**
     * Inject modal CSS styles
     * @returns {Promise<void>}
     * @private
     */
    async _injectModalStyles() {
        if (this._destroyed || this.cssInjected) return;
        this._releaseDeferredDomReadyListener('_moveStyleToHeadListener');

        try {
            // Load CSS file
            const cssUrl = chrome.runtime.getURL(
                'content_scripts/aicontext/ui/modal.css'
            );
            const response = await fetch(cssUrl);
            if (this._destroyed) return;
            const cssText = await response.text();
            if (this._destroyed) return;

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
                    if (this._destroyed) {
                        this._releaseDeferredDomReadyListener(
                            '_moveStyleToHeadListener',
                            moveStyleToHead
                        );
                        return;
                    }
                    try {
                        if (
                            document.head &&
                            style.parentElement !== document.head
                        ) {
                            document.head.appendChild(style);
                        }
                    } catch (_) {}
                    this._releaseDeferredDomReadyListener(
                        '_moveStyleToHeadListener',
                        moveStyleToHead
                    );
                };
                this._moveStyleToHeadListener = moveStyleToHead;
                document.addEventListener('DOMContentLoaded', moveStyleToHead);
                if (
                    this._destroyed ||
                    this._moveStyleToHeadListener !== moveStyleToHead
                ) {
                    try {
                        document.removeEventListener(
                            'DOMContentLoaded',
                            moveStyleToHead
                        );
                    } catch (_) {}
                    return;
                }
            }

            this.cssInjected = true;
            this.core._log('debug', 'Modal CSS styles injected successfully');
        } catch (error) {
            if (this._destroyed) return;
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
