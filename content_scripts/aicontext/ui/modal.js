import { MODAL_STATES } from '../core/constants.js';
import { AIContextModalCore } from './modal-core.js';
import { AIContextModalUI } from './modal-ui.js';
import { AIContextModalEvents } from './modal-events.js';
import { AIContextModalAnimations } from './modal-animations.js';
import { ModalController } from './events/ModalController.js';

const TrustedPromise = Promise;
const trustedPromiseResolve = TrustedPromise.resolve.bind(TrustedPromise);
const trustedPromiseThen = Function.call.bind(TrustedPromise.prototype.then);

const ANALYSIS_CAPABILITY_KEYS = Object.freeze([
    'requestAnalysis',
    'cancelAnalysis',
    'clearSelection',
    'subscribeSettled',
    'takeResult',
]);

function extractAnalysisConfiguration(config) {
    const source =
        config !== null && typeof config === 'object'
            ? config
            : Object.create(null);
    let candidate;
    let coreConfig;
    try {
        ({ analysisCapabilities: candidate = null, ...coreConfig } = source);
    } catch (_) {
        throw new TypeError('Invalid analysisCapabilities configuration');
    }

    let capabilities = null;
    if (candidate !== null) {
        try {
            capabilities = Object.freeze(
                Object.fromEntries(
                    ANALYSIS_CAPABILITY_KEYS.map((key) => [key, candidate[key]])
                )
            );
            if (
                !candidate ||
                typeof candidate !== 'object' ||
                ANALYSIS_CAPABILITY_KEYS.some(
                    (key) => typeof capabilities[key] !== 'function'
                )
            ) {
                throw new TypeError();
            }
        } catch (_) {
            throw new TypeError('Invalid analysisCapabilities configuration');
        }
    }

    return {
        capabilities,
        coreConfig: Object.freeze({
            ...coreConfig,
            privateAnalysis: capabilities !== null,
        }),
    };
}

async function cleanup(target, method) {
    try {
        const action = target?.[method];
        if (typeof action === 'function') await action.call(target);
    } catch (_) {}
}

export class AIContextModal {
    constructor(config = {}) {
        const { capabilities, coreConfig } =
            extractAnalysisConfiguration(config);
        this._analysisCapabilities = capabilities;
        this._privateAnalysis = capabilities !== null;
        this.core = new AIContextModalCore(coreConfig);
        this.ui = null;
        this.events = null;
        this.animations = null;
        this.controller = null;
        this._initializePromise = null;
        this._destroyPromise = null;
        this._destroyed = false;
    }

    initialize() {
        if (this._initializePromise) return this._initializePromise;
        if (this._destroyed || !this.core) {
            return trustedPromiseResolve(undefined);
        }
        this._initializePromise = this._performInitialize();
        return this._initializePromise;
    }

    async _performInitialize() {
        const core = this.core;
        await core.initialize();
        if (this._destroyed || this.core !== core) return;

        const ui = new AIContextModalUI(core);
        this.ui = ui;
        await ui.initialize();
        if (this._destroyed || this.ui !== ui) return;
        await ui.createModalElement();
        if (this._destroyed || this.ui !== ui) return;

        const animations = new AIContextModalAnimations(core, ui);
        this.animations = animations;
        const controller = new ModalController(
            core,
            ui,
            animations,
            this._analysisCapabilities
        );
        this.controller = controller;
        const events = new AIContextModalEvents(core, ui, animations);
        events.modalController = controller;
        this.events = events;
        await events.setupEventListeners();
        if (
            this._destroyed ||
            this.events !== events ||
            this.controller !== controller
        ) {
            return;
        }

        core.markEventsReady();
        this._ensureHiddenState();
        core._log('debug', 'Modal initialized successfully');
    }

    setLogger(logger) {
        this.core?.setLogger(logger);
    }

    showSelectionMode(options = {}) {
        const { core, ui, animations, controller } = this;
        if (this._destroyed || !core?.element || !ui || !animations) {
            return false;
        }

        const isBusy =
            core.isAnalyzing ||
            core.state === MODAL_STATES.PROCESSING ||
            core.state === MODAL_STATES.DISPLAY ||
            core.state === MODAL_STATES.ERROR;
        if (!isBusy) {
            core.currentMode = 'selection';
            core.analysisResult = null;
            core.setAnalyzing(false);
            core.setState(MODAL_STATES.SELECTION);
        }

        const shown = animations.showModal(options);
        if (!shown) return false;
        if (!isBusy) ui.showInitialState();
        ui.updateSelectionDisplay();
        controller?.resetAnalysisButton();
        return true;
    }

    showAnalysisResult(analysisResult) {
        if (
            this._privateAnalysis ||
            this._destroyed ||
            !this.core?.element ||
            !analysisResult
        ) {
            return false;
        }
        this.core.currentMode = 'display';
        this.core.setAnalysisResult(analysisResult);
        if (!this.core.isVisible)
            this.animations?.showModal({ mode: 'display' });
        this.animations?.showResultsState(analysisResult);
        return true;
    }

    showError(error, metadata = {}) {
        if (this._privateAnalysis || this._destroyed || !this.core?.element) {
            return false;
        }
        this.core.currentMode = 'error';
        if (!this.core.isVisible) this.animations?.showModal({ mode: 'error' });
        if (this.animations?.showErrorState) {
            this.animations.showErrorState(error, metadata);
        } else {
            this.core.setState(MODAL_STATES.ERROR);
            this.ui?.showErrorState(error, metadata);
        }
        return true;
    }

    hide() {
        if (this._destroyed || !this.core) return false;
        if (this.animations?.hideModal) this.animations.hideModal();
        else this.core.setState(MODAL_STATES.HIDDEN);
        return true;
    }

    handleWordSelection() {
        return false;
    }

    applySelectionSnapshot(snapshot) {
        if (!this._privateAnalysis || this._destroyed || !this.core) {
            return false;
        }
        const applied = this.core.applyPrivateSelectionSnapshot(snapshot);
        if (!applied || this._destroyed) return false;

        try {
            this.ui?.updateSelectionDisplay();
            this.core.syncSelectionHighlights();
        } catch (_) {}
        return !this._destroyed;
    }

    get element() {
        return this.core?.element ?? null;
    }

    get isVisible() {
        return this.core?.isVisible ?? false;
    }

    get state() {
        return this.core?.state ?? MODAL_STATES.HIDDEN;
    }

    get currentMode() {
        return this.core?.currentMode ?? null;
    }

    get selectedWords() {
        return this.core?.selectedWords ?? new Set();
    }

    get selectedText() {
        return this.core?.selectedText ?? '';
    }

    get selectedWordsOrder() {
        return this.core?.selectedWordsOrder ?? [];
    }

    get originalSentenceWords() {
        return this.core?.originalSentenceWords ?? [];
    }

    get wordPositions() {
        return this.core?.wordPositions ?? new Map();
    }

    get analysisResult() {
        return this.core?.analysisResult ?? null;
    }

    get isAnalyzing() {
        return this.core?.isAnalyzing ?? false;
    }

    get currentRequest() {
        return this.core?.currentRequest ?? null;
    }

    get config() {
        return this.core?.config ?? null;
    }

    _ensureHiddenState() {
        const core = this.core;
        if (!core) return;
        core.element?.classList.remove('dualsub-context-modal--visible');
        core.overlayElement?.classList.remove('dualsub-visible');
        core.contentElement?.classList.remove('dualsub-visible');
        if (core.element) core.element.style.pointerEvents = 'none';
        if (core.overlayElement)
            core.overlayElement.style.pointerEvents = 'none';
        core.isVisible = false;
        core.setState(MODAL_STATES.HIDDEN);
    }

    destroy() {
        if (this._destroyPromise) return this._destroyPromise;
        this._destroyed = true;

        const owned = {
            core: this.core,
            ui: this.ui,
            events: this.events,
            animations: this.animations,
            controller: this.controller,
        };
        this.core = null;
        this.ui = null;
        this.events = null;
        this.animations = null;
        this.controller = null;
        this._analysisCapabilities = null;

        this._destroyPromise = trustedPromiseThen(
            trustedPromiseResolve(undefined),
            () => this._performDestroy(owned)
        );
        return this._destroyPromise;
    }

    async _performDestroy(owned) {
        try {
            owned.ui?.revokeAuthority?.();
        } catch (_) {}
        await cleanup(owned.events, 'removeEventListeners');
        await cleanup(owned.controller, 'destroy');
        await cleanup(owned.animations, 'cleanup');
        await cleanup(owned.ui, 'destroy');
        await cleanup(owned.core, 'destroy');
    }
}
