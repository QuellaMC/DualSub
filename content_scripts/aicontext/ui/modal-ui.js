import { MODAL_STATES } from '../core/constants.js';
import { getOrCreateUiRoot } from '../../shared/subtitleUtilities.js';

const TrustedPromise = Promise;
const trustedPromiseResolve = TrustedPromise.resolve.bind(TrustedPromise);
const trustedPromiseThen = Function.call.bind(TrustedPromise.prototype.then);

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
const TEXT_FALLBACK = '[unavailable]';
const MAX_DISPLAY_TEXT_LENGTH = 2000;
const MAX_LABEL_LENGTH = 200;
const FALLBACK_MESSAGES = Object.freeze({
    aiContextModalTitle: 'AI Context Analysis',
    aiContextSelectedWords: 'Selected Words',
    aiContextNoWordsSelected: 'No words selected',
    aiContextClickHint: 'Click a word to add or remove it.',
    aiContextStartAnalysis: 'Start Analysis',
    aiContextInitialMessage:
        'Select words from the subtitles to begin analysis.',
    aiContextAnalyzing: 'Analyzing context...',
    aiContextPauseAnalysis: 'Pause',
    aiContextPauseAnalysisTitle: 'Pause analysis',
    aiContextPauseNote: 'Select pause to cancel this analysis.',
    aiContextAnalysisFailed: 'Analysis Failed',
    aiContextRetryButton: 'Try Again',
    aiContextClose: 'Close',
});
const STATE_CLASSES = Object.freeze({
    [MODAL_STATES.HIDDEN]: 'is-hidden',
    [MODAL_STATES.SELECTION]: 'is-selection',
    [MODAL_STATES.PROCESSING]: 'is-analyzing',
    [MODAL_STATES.DISPLAY]: 'is-display',
    [MODAL_STATES.ERROR]: 'is-error',
});

function readProperty(source, key, fallback) {
    try {
        const value = source?.[key];
        return value === undefined ? fallback : value;
    } catch (_) {
        return fallback;
    }
}

function safeDisplayText(
    value,
    fallback = TEXT_FALLBACK,
    maxLength = MAX_DISPLAY_TEXT_LENGTH
) {
    const safeFallback =
        typeof fallback === 'string' ? fallback : TEXT_FALLBACK;
    const length = Number.isFinite(maxLength)
        ? Math.max(0, Math.min(Math.trunc(maxLength), MAX_DISPLAY_TEXT_LENGTH))
        : MAX_DISPLAY_TEXT_LENGTH;
    try {
        if (value === null || value === undefined) return '';
        return (typeof value === 'string' ? value : String(value)).slice(
            0,
            length
        );
    } catch (_) {
        return safeFallback.slice(0, length);
    }
}

export function sanitizeAnalysisHtml(value) {
    let source = '';
    try {
        source = typeof value === 'string' ? value : String(value ?? '');
    } catch (_) {
        return '';
    }

    const template = document.createElement('template');
    template.innerHTML = source;
    for (const element of [
        ...template.content.querySelectorAll('*'),
    ].reverse()) {
        if (BLOCKED_ANALYSIS_TAGS.has(element.tagName)) {
            element.remove();
            continue;
        }
        if (!ALLOWED_ANALYSIS_TAGS.has(element.tagName)) {
            element.replaceWith(...element.childNodes);
            continue;
        }

        const safeClasses = [...element.classList].filter((className) =>
            /^dualsub-[a-z0-9_-]+$/i.test(className)
        );
        for (const attribute of [...element.attributes]) {
            element.removeAttribute(attribute.name);
        }
        if (safeClasses.length > 0) {
            element.className = safeClasses.join(' ');
        }
    }
    return template.innerHTML;
}

function createElement(tagName, options = {}) {
    const element = document.createElement(tagName);
    if (options.id) element.id = options.id;
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attributes || {})) {
        element.setAttribute(name, value);
    }
    return element;
}

function removeListener(target, eventName, listener) {
    if (!listener) return;
    try {
        target?.removeEventListener?.(eventName, listener);
    } catch (_) {}
}

export class AIContextModalUI {
    constructor(core) {
        this.core = core;
        this.cssInjected = false;
        this._translationsCache = null;
        this._languageInitialized = false;
        this._languageLoadId = 0;
        this._terminalRetryActionCleanup = null;
        this._configLanguageUnsubscribe = null;
        this._storageLanguageChangeListener = null;
        this._fullscreenChangeListener = null;
        this._storeUnsubscribe = null;
        this._ownedModalElement = null;
        this._ownedOverlayElement = null;
        this._ownedContentElement = null;
        this._destroyed = false;
        this._destroyPromise = null;
    }

    async initialize() {
        if (this._destroyed || this._languageInitialized) return;
        const language = await this._readUiLanguage();
        if (this._destroyed) return;
        await this._loadTranslations(language);
        if (this._destroyed) return;
        this._languageInitialized = true;
        this._setupLanguageChangeListener();
        this._setupFullscreenListener();
    }

    async createModalElement() {
        if (this._destroyed) return;
        if (!this._languageInitialized) await this.initialize();
        if (this._destroyed) return;
        await this._injectModalStyles();
        if (this._destroyed) return;

        this.clearTerminalRetryActions();
        for (const selector of [
            '#dualsub-context-modal',
            '#dualsub-modal-overlay',
            '#dualsub-modal-content',
        ]) {
            document.querySelector(selector)?.remove();
        }

        const modal = createElement('div', {
            id: 'dualsub-context-modal',
            className: 'dualsub-context-modal',
        });
        modal.style.display = 'none';

        const overlay = createElement('div', {
            id: 'dualsub-modal-overlay',
            className: 'dualsub-modal-overlay',
            attributes: { 'aria-hidden': 'true' },
        });
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';

        const content = createElement('div', {
            id: 'dualsub-modal-content',
            className: 'dualsub-modal-content',
            attributes: {
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'dualsub-modal-title',
            },
        });
        content.style.display = 'none';
        content.style.pointerEvents = 'auto';
        content.style.width = '95vw';
        content.style.maxWidth = 'min(95vw, 1000px)';
        content.style.height = '75vh';
        content.style.maxHeight = 'calc(100vh - 80px)';
        content.append(this._createModalHeader(), this._createModalBody());

        const uiRoot = getOrCreateUiRoot() || document.documentElement;
        uiRoot.append(overlay, content);
        (document.body || uiRoot).appendChild(modal);

        this.core.element = modal;
        this.core.overlayElement = overlay;
        this.core.contentElement = content;
        this._ownedModalElement = modal;
        this._ownedOverlayElement = overlay;
        this._ownedContentElement = content;
        this._subscribeToStore();
        this.core.markUiReady();
    }

    _createModalHeader() {
        const header = createElement('div', {
            className: 'dualsub-modal-header',
        });
        const title = this._localizedElement(
            'h3',
            'aiContextModalTitle',
            'dualsub-modal-title'
        );
        const closeButton = createElement('button', {
            id: 'dualsub-modal-close',
            className: 'dualsub-modal-close',
            text: '×',
            attributes: {
                type: 'button',
                'aria-label': this._getLocalizedMessage('aiContextClose'),
            },
        });
        header.append(title, closeButton);
        return header;
    }

    _createModalBody() {
        const body = createElement('div', { className: 'dualsub-modal-body' });
        body.append(this._createLeftPane(), this._createRightPane());
        return body;
    }

    _createLeftPane() {
        const pane = createElement('div', {
            id: 'dualsub-left-pane',
            className: 'dualsub-modal-pane',
        });
        const selection = createElement('div', {
            className: 'dualsub-selection-container',
        });
        const words = createElement('div', {
            id: 'dualsub-selected-words',
            className: 'dualsub-selected-words',
            attributes: { 'aria-live': 'polite' },
        });
        words.appendChild(this._createSelectionPlaceholder());
        selection.append(
            this._localizedElement('h4', 'aiContextSelectedWords'),
            words,
            this._localizedElement(
                'div',
                'aiContextClickHint',
                null,
                'dualsub-selection-hint'
            )
        );

        const controls = createElement('div', {
            className: 'dualsub-controls-container',
        });
        const label = this._getLocalizedMessage('aiContextStartAnalysis');
        const analysisButton = createElement('button', {
            id: 'dualsub-start-analysis',
            className: 'dualsub-analysis-button',
            text: label,
            attributes: { type: 'button', title: label },
        });
        analysisButton.dataset.i18n = 'aiContextStartAnalysis';
        analysisButton.disabled = true;
        controls.appendChild(analysisButton);
        pane.append(selection, controls);
        return pane;
    }

    _createRightPane() {
        const pane = createElement('div', {
            id: 'dualsub-right-pane',
            className: 'dualsub-modal-pane',
        });
        const content = createElement('div', {
            id: 'dualsub-analysis-content',
            className: 'dualsub-analysis-content',
        });
        content.append(
            this._createInitialState(),
            this._createProcessingState(),
            createElement('div', {
                id: 'dualsub-analysis-results',
                className: 'dualsub-analysis-results',
                attributes: {
                    role: 'region',
                    'aria-live': 'polite',
                },
            })
        );
        pane.appendChild(content);
        return pane;
    }

    _createInitialState() {
        const state = createElement('div', {
            id: 'dualsub-initial-state',
            className: 'dualsub-analysis-placeholder',
        });
        state.appendChild(
            this._localizedElement('p', 'aiContextInitialMessage')
        );
        return state;
    }

    _createProcessingState() {
        const state = createElement('div', {
            id: 'dualsub-processing-state',
            className: 'dualsub-processing-state',
            attributes: { role: 'status', 'aria-live': 'polite' },
        });
        const loader = createElement('div', {
            className: 'loader',
            attributes: { 'aria-hidden': 'true' },
        });
        for (let index = 0; index < 7; index += 1) {
            loader.appendChild(
                createElement('div', { className: 'loader-square' })
            );
        }
        state.append(
            loader,
            this._localizedElement(
                'p',
                'aiContextAnalyzing',
                null,
                'dualsub-processing-text'
            ),
            this._localizedElement(
                'div',
                'aiContextPauseNote',
                null,
                'dualsub-processing-note'
            )
        );
        return state;
    }

    _localizedElement(tagName, key, id = null, className = null) {
        const element = createElement(tagName, {
            id,
            className,
            text: this._getLocalizedMessage(key),
        });
        element.dataset.i18n = key;
        return element;
    }

    _createSelectionPlaceholder() {
        return this._localizedElement(
            'span',
            'aiContextNoWordsSelected',
            null,
            'dualsub-placeholder'
        );
    }

    updateSelectionDisplay() {
        const scope = this.core?.contentElement || document;
        const container = scope.querySelector('#dualsub-selected-words');
        const button = scope.querySelector('#dualsub-start-analysis');
        if (!container || !button || !this.core) return;

        const entries = this._getSelectionEntries();
        if (entries.length === 0) {
            container.replaceChildren(this._createSelectionPlaceholder());
            container.classList.remove('dualsub-processing-disabled');
            button.disabled = true;
            return;
        }

        const privateAnalysis = this.core.config?.privateAnalysis === true;
        const chips = entries.map(({ key, word }, index) => {
            const chip = createElement('span', {
                className: 'dualsub-selected-word',
                text: word,
            });
            chip.dataset.word = word;
            chip.dataset.positionKey = key;
            chip.dataset.positionIndex = String(index);
            if (!privateAnalysis) {
                const remove = createElement('span', {
                    className: 'dualsub-word-remove',
                    text: '×',
                    attributes: {
                        role: 'button',
                        'aria-label': `Remove ${word}`,
                    },
                });
                remove.dataset.word = word;
                remove.dataset.positionKey = key;
                if (this.core.isAnalyzing) remove.hidden = true;
                chip.appendChild(remove);
            }
            return chip;
        });
        container.replaceChildren(...chips);
        container.classList.toggle(
            'dualsub-processing-disabled',
            this.core.isAnalyzing === true
        );
        button.disabled = false;
    }

    _getSelectionEntries() {
        try {
            const canonical = this.core.selectionModel?.getOrderedEntries?.();
            if (Array.isArray(canonical) && canonical.length > 0) {
                return canonical.map((entry, index) => ({
                    key: `private:${entry.wordIndex}:${index}`,
                    word: safeDisplayText(
                        entry.word,
                        '',
                        MAX_DISPLAY_TEXT_LENGTH
                    ),
                }));
            }
        } catch (_) {}

        const positions = this.core.selectedWordPositions;
        if (positions?.size > 0 && typeof positions.get === 'function') {
            const keys = [...(this.core.selectedWordsOrder || [])].filter(
                (key) => positions.has(key)
            );
            return keys
                .map((key, order) => ({ key, order, data: positions.get(key) }))
                .sort((left, right) => {
                    const leftIndex =
                        left.data?.position?.wordIndex ??
                        left.data?.position?.index ??
                        left.order;
                    const rightIndex =
                        right.data?.position?.wordIndex ??
                        right.data?.position?.index ??
                        right.order;
                    return leftIndex - rightIndex;
                })
                .map(({ key, data }) => ({
                    key,
                    word: safeDisplayText(data?.word, ''),
                }));
        }

        try {
            return [...(this.core.selectedWords || [])].map((word, index) => ({
                key: `fallback:${index}`,
                word: safeDisplayText(word, ''),
            }));
        } catch (_) {
            return [];
        }
    }

    showInitialState() {
        this._setState(MODAL_STATES.SELECTION);
    }

    showProcessingState() {
        this._setState(MODAL_STATES.PROCESSING);
        const processing = this.core?.contentElement?.querySelector(
            '#dualsub-processing-state'
        );
        for (const square of processing?.querySelectorAll('.loader-square') ||
            []) {
            const animation = square.style.animation;
            square.style.animation = 'none';
            void square.offsetHeight;
            square.style.animation = animation;
        }
    }

    showAnalysisResults(results) {
        this.clearTerminalRetryActions();
        const output = this.core?.contentElement?.querySelector(
            '#dualsub-analysis-results'
        );
        if (output) {
            output.innerHTML = sanitizeAnalysisHtml(results);
            output.scrollTop = 0;
        }
        this.core?.setState(MODAL_STATES.DISPLAY);
    }

    showErrorState(error, metadata = {}) {
        const onClose = readProperty(metadata, 'onClose', () =>
            document.dispatchEvent(
                new CustomEvent('aicontext:modal:closeRequested')
            )
        );
        this._renderFailure({
            message: safeDisplayText(error, ''),
            onClose,
            retryable: false,
        });
    }

    showPrivateTerminalFailure(details = {}) {
        this._renderFailure({
            message: 'Analysis could not be completed.',
            retryable: readProperty(details, 'retryable', false) === true,
            onRetry: readProperty(details, 'onRetry', null),
            onClose: readProperty(details, 'onClose', null),
        });
    }

    _renderFailure({ message, retryable, onRetry, onClose }) {
        this.clearTerminalRetryActions();
        const output = this.core?.contentElement?.querySelector(
            '#dualsub-analysis-results'
        );
        if (!output) {
            this.core?.setState(MODAL_STATES.ERROR);
            return;
        }

        const container = createElement('div', {
            className: 'dualsub-error',
            attributes: { role: 'alert' },
        });
        const heading = createElement('h4', {
            text: safeDisplayText(
                this._getLocalizedMessage('aiContextAnalysisFailed'),
                'Analysis Failed',
                MAX_LABEL_LENGTH
            ),
        });
        const description = createElement('p', {
            text: safeDisplayText(message, ''),
        });
        const actions = createElement('div', {
            className: 'dualsub-error-actions',
        });
        const bindings = [];

        if (retryable && typeof onRetry === 'function') {
            const retry = createElement('button', {
                className: 'dualsub-btn dualsub-btn-primary',
                text: safeDisplayText(
                    this._getLocalizedMessage('aiContextRetryButton'),
                    'Try Again',
                    MAX_LABEL_LENGTH
                ),
                attributes: { type: 'button' },
            });
            actions.appendChild(retry);
            bindings.push({ button: retry, action: onRetry });
        }

        const close = createElement('button', {
            className: 'dualsub-btn dualsub-btn-secondary',
            text: safeDisplayText(
                this._getLocalizedMessage('aiContextClose'),
                'Close',
                MAX_LABEL_LENGTH
            ),
            attributes: { type: 'button' },
        });
        actions.appendChild(close);
        bindings.push({ button: close, action: onClose });
        container.append(heading, description, actions);
        output.replaceChildren(container);
        output.scrollTop = 0;
        this._bindTerminalActions(bindings);
        this.core.setState(MODAL_STATES.ERROR);
    }

    _bindTerminalActions(bindings) {
        const records = bindings.map(({ button, action }) => {
            const handler = (event) => {
                if (
                    this._destroyed ||
                    (this.core?.config?.privateAnalysis === true &&
                        event?.isTrusted !== true)
                ) {
                    return;
                }
                this.clearTerminalRetryActions();
                if (!this._destroyed && typeof action === 'function') action();
            };
            button.addEventListener('click', handler);
            return { button, handler };
        });
        this._terminalRetryActionCleanup = () => {
            for (const { button, handler } of records) {
                button.removeEventListener('click', handler);
            }
        };
    }

    clearTerminalRetryActions() {
        const cleanup = this._terminalRetryActionCleanup;
        this._terminalRetryActionCleanup = null;
        try {
            cleanup?.();
        } catch (_) {}
    }

    _setState(state) {
        this.clearTerminalRetryActions();
        this.core?.setState(state);
    }

    _applyStateClasses(state) {
        const content = this.core?.contentElement;
        if (!content) return;
        for (const className of Object.values(STATE_CLASSES)) {
            content.classList.remove(className);
        }
        const className = STATE_CLASSES[state];
        if (className) content.classList.add(className);
        content.setAttribute(
            'aria-busy',
            state === MODAL_STATES.PROCESSING ? 'true' : 'false'
        );
    }

    _subscribeToStore() {
        try {
            this._storeUnsubscribe?.();
        } catch (_) {}
        const core = this.core;
        const unsubscribe = core.store?.subscribe?.((state) => {
            if (!this._destroyed && this.core === core) {
                this._applyStateClasses(state.modalState);
            }
        });
        this._storeUnsubscribe =
            typeof unsubscribe === 'function' ? unsubscribe : null;
        core._storeUnsubscribe = this._storeUnsubscribe;
    }

    _getLocalizedMessage(key) {
        const cached = this._translationsCache?.[key]?.message;
        if (typeof cached === 'string' && cached) return cached;
        try {
            const message = chrome.i18n.getMessage(key);
            if (message) return message;
        } catch (_) {}
        return FALLBACK_MESSAGES[key] || key;
    }

    async _readUiLanguage() {
        try {
            const configService =
                this.core?.contentScript?.configService || window.configService;
            if (typeof configService?.get === 'function') {
                return (await configService.get('uiLanguage')) || 'en';
            }
            const stored = await chrome.storage.sync.get(['uiLanguage']);
            return stored?.uiLanguage || 'en';
        } catch (_) {
            return 'en';
        }
    }

    async _loadTranslations(language) {
        const loadId = ++this._languageLoadId;
        const load = async (languageCode) => {
            const normalized = String(languageCode || 'en').replaceAll(
                '-',
                '_'
            );
            const response = await fetch(
                chrome.runtime.getURL(`_locales/${normalized}/messages.json`)
            );
            if (response.ok === false)
                throw new Error('Translation load failed');
            return response.json();
        };

        let translations = null;
        try {
            translations = await load(language);
        } catch (_) {
            if (language !== 'en') {
                try {
                    translations = await load('en');
                } catch (_) {}
            }
        }
        if (this._destroyed || loadId !== this._languageLoadId) return false;
        this._translationsCache =
            translations && typeof translations === 'object'
                ? translations
                : null;
        return true;
    }

    _setupLanguageChangeListener() {
        this._removeLanguageChangeListener();
        const configService =
            this.core?.contentScript?.configService || window.configService;
        if (typeof configService?.onChanged === 'function') {
            const unsubscribe = configService.onChanged((changes) => {
                const value = readProperty(changes, 'uiLanguage', null);
                const language = readProperty(value, 'newValue', value);
                if (typeof language === 'string' && language) {
                    void this.reloadTranslations(language);
                }
            });
            this._configLanguageUnsubscribe =
                typeof unsubscribe === 'function' ? unsubscribe : null;
            return;
        }

        const listener = (changes, areaName) => {
            const language = changes?.uiLanguage?.newValue;
            if (
                areaName === 'sync' &&
                typeof language === 'string' &&
                language
            ) {
                void this.reloadTranslations(language);
            }
        };
        this._storageLanguageChangeListener = listener;
        try {
            chrome.storage.onChanged.addListener(listener);
        } catch (_) {
            this._storageLanguageChangeListener = null;
        }
    }

    _removeLanguageChangeListener() {
        const unsubscribe = this._configLanguageUnsubscribe;
        this._configLanguageUnsubscribe = null;
        try {
            unsubscribe?.();
        } catch (_) {}
        const listener = this._storageLanguageChangeListener;
        this._storageLanguageChangeListener = null;
        if (listener) {
            try {
                chrome.storage.onChanged.removeListener(listener);
            } catch (_) {}
        }
    }

    _setupFullscreenListener() {
        removeListener(
            document,
            'fullscreenchange',
            this._fullscreenChangeListener
        );
        const listener = () => {
            if (!this._destroyed) this._refreshModalUI();
        };
        this._fullscreenChangeListener = listener;
        document.addEventListener('fullscreenchange', listener);
    }

    _refreshModalUI() {
        const content = this.core?.contentElement;
        if (!content) return;
        for (const element of content.querySelectorAll('[data-i18n]')) {
            if (
                element.id === 'dualsub-start-analysis' &&
                element.hasAttribute('data-paused-toggle')
            ) {
                continue;
            }
            const key = element.dataset.i18n;
            element.textContent = this._getLocalizedMessage(key);
            if (element.id === 'dualsub-start-analysis') {
                element.title = element.textContent;
            }
        }
        const close = content.querySelector('#dualsub-modal-close');
        close?.setAttribute(
            'aria-label',
            this._getLocalizedMessage('aiContextClose')
        );
        this.updateSelectionDisplay();
    }

    async reloadTranslations(language) {
        if (this._destroyed || !language) return false;
        const loaded = await this._loadTranslations(language);
        if (!loaded || this._destroyed) return false;
        this._refreshModalUI();
        return true;
    }

    async _injectModalStyles() {
        if (this._destroyed || this.cssInjected) return;
        if (
            document.getElementById('dualsub-modal-styles') ||
            document.getElementById('dualsub-modal-styles-fallback')
        ) {
            this.cssInjected = true;
            return;
        }
        try {
            const response = await fetch(
                chrome.runtime.getURL('content_scripts/aicontext/ui/modal.css')
            );
            const cssText = await response.text();
            if (this._destroyed) return;
            const style = createElement('style', {
                id: 'dualsub-modal-styles',
                text: cssText,
            });
            (document.head || document.documentElement).appendChild(style);
            this.cssInjected = true;
        } catch (_) {
            if (!this._destroyed) this._injectFallbackStyles();
        }
    }

    _injectFallbackStyles() {
        if (document.getElementById('dualsub-modal-styles-fallback')) {
            this.cssInjected = true;
            return;
        }
        const style = createElement('style', {
            id: 'dualsub-modal-styles-fallback',
            text: `
                .dualsub-modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .55); z-index: 9998; }
                .dualsub-modal-content { position: fixed; top: 2vh; left: 50%; transform: translateX(-50%); z-index: 10000; background: white; color: #111; border-radius: 12px; overflow: hidden; }
                #dualsub-initial-state, #dualsub-processing-state, #dualsub-analysis-results { display: none; }
                .is-selection #dualsub-initial-state, .is-analyzing #dualsub-processing-state, .is-display #dualsub-analysis-results, .is-error #dualsub-analysis-results { display: block; }
            `,
        });
        (document.head || document.documentElement).appendChild(style);
        this.cssInjected = true;
    }

    revokeAuthority() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._languageLoadId += 1;
    }

    destroy() {
        if (this._destroyPromise) return this._destroyPromise;
        this.revokeAuthority();
        const owned = {
            core: this.core,
            configUnsubscribe: this._configLanguageUnsubscribe,
            storageListener: this._storageLanguageChangeListener,
            fullscreenListener: this._fullscreenChangeListener,
            storeUnsubscribe: this._storeUnsubscribe,
            terminalCleanup: this._terminalRetryActionCleanup,
            nodes: [
                this._ownedModalElement,
                this._ownedOverlayElement,
                this._ownedContentElement,
            ],
        };
        this._configLanguageUnsubscribe = null;
        this._storageLanguageChangeListener = null;
        this._fullscreenChangeListener = null;
        this._storeUnsubscribe = null;
        this._terminalRetryActionCleanup = null;
        this._ownedModalElement = null;
        this._ownedOverlayElement = null;
        this._ownedContentElement = null;

        this._destroyPromise = trustedPromiseThen(
            trustedPromiseResolve(undefined),
            () => this._performDestroy(owned)
        );
        return this._destroyPromise;
    }

    async _performDestroy(owned) {
        try {
            owned.terminalCleanup?.();
        } catch (_) {}
        if (owned.storageListener) {
            try {
                chrome.storage.onChanged.removeListener(owned.storageListener);
            } catch (_) {}
        }
        removeListener(document, 'fullscreenchange', owned.fullscreenListener);
        try {
            const work = owned.configUnsubscribe?.();
            await trustedPromiseResolve(work);
        } catch (_) {}
        try {
            owned.storeUnsubscribe?.();
        } catch (_) {}
        if (owned.core?._storeUnsubscribe === owned.storeUnsubscribe) {
            owned.core._storeUnsubscribe = null;
        }
        for (const node of owned.nodes) node?.remove();
        this.core = null;
        this._translationsCache = null;
        this._languageInitialized = false;
    }
}
