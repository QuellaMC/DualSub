/**
 * ModalController - Pure controller for modal interactions
 * Orchestrates calls into ModalStore/SelectionModel/UI/Animations.
 * No direct DOM class toggles; relies on UI/Animations modules.
 */

import { MODAL_STATES } from '../../core/constants.js';

const TrustedPromise = Promise;
const trustedPromiseResolve = TrustedPromise.resolve.bind(TrustedPromise);
const trustedPromiseThen = Function.call.bind(TrustedPromise.prototype.then);

const PRIVATE_FAILURE_CODES = Object.freeze([
    'busy',
    'stale-selection',
    'disabled',
    'configuration',
    'rate-limited',
    'timeout',
    'network',
    'provider-unavailable',
    'invalid-response',
    'provider-error',
    'internal',
]);
const PRIVATE_CANCEL_REASONS = Object.freeze([
    'user',
    'superseded',
    'modal-closed',
    'selection-invalidated',
]);

function hasExactEnumerableDataKeys(value, expectedKeys) {
    try {
        if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
        ) {
            return false;
        }
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== expectedKeys.length) return false;
        return ownKeys.every((key) => {
            if (typeof key !== 'string' || !expectedKeys.includes(key)) {
                return false;
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return (
                descriptor?.enumerable === true &&
                Object.hasOwn(descriptor, 'value')
            );
        });
    } catch (_) {
        return false;
    }
}

function observeCapabilitySettlement(value) {
    try {
        const promise = trustedPromiseResolve(value);
        void trustedPromiseThen(promise, undefined, () => undefined);
    } catch (_) {}
}

function parsePrivateSettlement(value) {
    try {
        const requestId = Object.getOwnPropertyDescriptor(
            value,
            'requestId'
        )?.value;
        const outcome = Object.getOwnPropertyDescriptor(
            value,
            'outcome'
        )?.value;
        if (!Number.isSafeInteger(requestId) || requestId <= 0) return null;

        if (
            outcome === 'succeeded' &&
            hasExactEnumerableDataKeys(value, ['requestId', 'outcome'])
        ) {
            return Object.freeze({ requestId, outcome });
        }
        if (
            outcome === 'failed' &&
            hasExactEnumerableDataKeys(value, [
                'requestId',
                'outcome',
                'code',
                'retryable',
            ])
        ) {
            const code = Object.getOwnPropertyDescriptor(value, 'code').value;
            const retryable = Object.getOwnPropertyDescriptor(
                value,
                'retryable'
            ).value;
            if (
                !PRIVATE_FAILURE_CODES.includes(code) ||
                typeof retryable !== 'boolean'
            ) {
                return null;
            }
            return Object.freeze({ requestId, outcome, code, retryable });
        }
        if (
            outcome === 'cancelled' &&
            hasExactEnumerableDataKeys(value, [
                'requestId',
                'outcome',
                'reason',
            ])
        ) {
            const reason = Object.getOwnPropertyDescriptor(
                value,
                'reason'
            ).value;
            if (!PRIVATE_CANCEL_REASONS.includes(reason)) return null;
            return Object.freeze({ requestId, outcome, reason });
        }
    } catch (_) {}
    return null;
}

export class ModalController {
    constructor(core, ui, animations, analysisCapabilities = null) {
        this.core = core;
        this.ui = ui;
        this.animations = animations;
        this.events = null;
        this._destroyed = false;
        this._buttonListenerRecords = new Map();
        this._analysisCapabilities = analysisCapabilities;
        this._privateAnalysis = analysisCapabilities !== null;
        this._privateSettlementUnsubscribe = null;
        this._privateSettlementListener = null;
        this._privateSettlementSubscribed = false;
        this._privateRequestInProgress = false;
        this._privateBufferedSettlement = null;
        this._privateBufferedSettlementInvalid = false;
        this._privateCancelRequestedFor = null;
        this._privateClosedRequestId = null;

        if (this._privateAnalysis) this._subscribeToPrivateSettlements();
    }

    _releaseButtonListener(
        key,
        expectedRecord = this._buttonListenerRecords.get(key)
    ) {
        const record = this._buttonListenerRecords.get(key);
        if (!record || record !== expectedRecord) return false;

        this._buttonListenerRecords.delete(key);
        record.active = false;
        try {
            record.element?.removeEventListener(
                record.eventType,
                record.handler,
                record.options
            );
            return true;
        } catch (_) {
            return false;
        }
    }

    _bindButtonListener(key, element, handler, options = undefined) {
        if (this._destroyed || !element || typeof handler !== 'function') {
            return null;
        }

        const previousRecord = this._buttonListenerRecords.get(key);
        if (previousRecord) {
            this._releaseButtonListener(key, previousRecord);
        }
        if (this._destroyed || this._buttonListenerRecords.has(key)) {
            return null;
        }

        const record = {
            element,
            eventType: 'click',
            handler: null,
            options,
            active: true,
        };
        const guardedHandler = (...args) => {
            if (this._destroyed || !record.active) return undefined;
            return handler(...args);
        };
        record.handler = guardedHandler;
        this._buttonListenerRecords.set(key, record);
        try {
            element.addEventListener('click', guardedHandler, options);
        } catch (error) {
            record.active = false;
            if (this._buttonListenerRecords.get(key) === record) {
                this._buttonListenerRecords.delete(key);
            }
            throw error;
        }
        if (
            this._destroyed ||
            this._buttonListenerRecords.get(key) !== record
        ) {
            record.active = false;
            try {
                element.removeEventListener('click', guardedHandler, options);
            } catch (_) {}
            if (this._buttonListenerRecords.get(key) === record) {
                this._buttonListenerRecords.delete(key);
            }
            return null;
        }
        return guardedHandler;
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        const unsubscribe = this._privateSettlementUnsubscribe;
        this._privateSettlementUnsubscribe = null;
        this._privateSettlementSubscribed = false;
        this._privateSettlementListener = null;
        this._privateRequestInProgress = false;
        this._privateBufferedSettlement = null;
        this._privateBufferedSettlementInvalid = false;
        this._privateCancelRequestedFor = null;
        this._privateClosedRequestId = null;
        this._analysisCapabilities = null;
        try {
            if (typeof unsubscribe === 'function') unsubscribe();
        } catch (_) {}

        const records = [...this._buttonListenerRecords.values()];
        this._buttonListenerRecords.clear();
        for (const record of records) {
            record.active = false;
        }
        for (const record of records) {
            try {
                record.element?.removeEventListener(
                    record.eventType,
                    record.handler,
                    record.options
                );
            } catch (_) {}
        }

        this.core = null;
        this.ui = null;
        this.animations = null;
        this.events = null;
    }

    _subscribeToPrivateSettlements() {
        const capabilities = this._analysisCapabilities;
        if (!capabilities) return;

        const listener = (settlement) => {
            if (
                this._destroyed ||
                this._privateSettlementListener !== listener
            ) {
                return false;
            }
            return this._acceptPrivateSettlement(settlement);
        };
        this._privateSettlementListener = listener;

        let unsubscribe;
        try {
            unsubscribe = Reflect.apply(
                capabilities.subscribeSettled,
                undefined,
                [listener]
            );
        } catch (_) {
            unsubscribe = null;
        }
        if (
            this._destroyed ||
            this._privateSettlementListener !== listener ||
            typeof unsubscribe !== 'function'
        ) {
            this._privateSettlementListener = null;
            try {
                if (typeof unsubscribe === 'function') unsubscribe();
            } catch (_) {}
            return;
        }
        this._privateSettlementUnsubscribe = unsubscribe;
        this._privateSettlementSubscribed = true;
    }

    _acceptPrivateSettlement(value) {
        const settlement = parsePrivateSettlement(value);
        if (this._privateRequestInProgress) {
            if (!settlement || this._privateBufferedSettlement !== null) {
                this._privateBufferedSettlementInvalid = true;
                return false;
            }
            this._privateBufferedSettlement = settlement;
            return true;
        }
        if (!settlement) return false;
        return this._settlePrivateAnalysis(settlement);
    }

    _setPrivateCurrentRequest(requestId) {
        if (!this.core) return;
        this.core.currentRequest = requestId;
        try {
            this.core.store?.setRequestId(requestId);
        } catch (_) {}
    }

    _cancelPrivateRequestById(requestId, reason) {
        if (
            this._destroyed ||
            !this._analysisCapabilities ||
            !Number.isSafeInteger(requestId) ||
            requestId <= 0 ||
            !PRIVATE_CANCEL_REASONS.includes(reason)
        ) {
            return false;
        }
        if (this._privateCancelRequestedFor === requestId) return false;
        this._privateCancelRequestedFor = requestId;
        try {
            const cancelled = Reflect.apply(
                this._analysisCapabilities.cancelAnalysis,
                undefined,
                [requestId, reason]
            );
            if (cancelled === true) return true;
        } catch (_) {
            // Failed cancellation remains retryable below.
        }
        if (this._privateCancelRequestedFor === requestId) {
            this._privateCancelRequestedFor = null;
        }
        return false;
    }

    _startPrivateAnalysis({ cause = 'user', retryOf = null } = {}) {
        if (
            this._destroyed ||
            !this.core ||
            !this._analysisCapabilities ||
            !this._privateSettlementSubscribed ||
            this._privateRequestInProgress ||
            this.core.isAnalyzing ||
            this.core.selectedWords.size === 0 ||
            !['user', 'retry'].includes(cause) ||
            (cause === 'user' && retryOf !== null) ||
            (cause === 'retry' &&
                (!Number.isSafeInteger(retryOf) || retryOf <= 0))
        ) {
            return false;
        }

        const core = this.core;
        this._privateClosedRequestId = null;
        this._privateRequestInProgress = true;
        this._privateBufferedSettlement = null;
        this._privateBufferedSettlementInvalid = false;
        this._privateCancelRequestedFor = null;

        let requestId = null;
        try {
            requestId = Reflect.apply(
                this._analysisCapabilities.requestAnalysis,
                undefined,
                [
                    Object.freeze({
                        cause,
                        retryOf,
                        contextTypes: Object.freeze([
                            'cultural',
                            'historical',
                            'linguistic',
                        ]),
                    }),
                ]
            );
        } catch (_) {
            requestId = null;
        }

        const bufferedSettlement = this._privateBufferedSettlement;
        const invalidBuffer = this._privateBufferedSettlementInvalid;
        this._privateRequestInProgress = false;
        this._privateBufferedSettlement = null;
        this._privateBufferedSettlementInvalid = false;

        if (this._destroyed || this.core !== core) return false;
        const validRequestId = Number.isSafeInteger(requestId) && requestId > 0;
        const invalidSettlement =
            invalidBuffer ||
            (bufferedSettlement !== null &&
                (!validRequestId ||
                    bufferedSettlement.requestId !== requestId));
        if (!validRequestId || invalidSettlement) {
            if (validRequestId) {
                this._cancelPrivateRequestById(requestId, 'superseded');
            }
            return false;
        }

        this._setPrivateCurrentRequest(requestId);
        if (bufferedSettlement) {
            return this._settlePrivateAnalysis(bufferedSettlement);
        }
        return this._enterPrivateProcessingState(core, requestId);
    }

    _hasPrivateRequestAuthority(core, requestId) {
        return (
            !this._destroyed &&
            this.core === core &&
            core.currentRequest === requestId
        );
    }

    _enterPrivateProcessingState(core, requestId) {
        if (!this._hasPrivateRequestAuthority(core, requestId)) return false;
        core.currentMode = 'analysis';
        core.setAnalyzing(true);
        if (!this._hasPrivateRequestAuthority(core, requestId)) return false;
        core.setState(MODAL_STATES.PROCESSING);
        if (!this._hasPrivateRequestAuthority(core, requestId)) return false;

        if (
            this.animations &&
            typeof this.animations.showProcessingState === 'function'
        ) {
            this.animations.showProcessingState();
        } else {
            this.ui?.showProcessingState();
        }
        if (!this._hasPrivateRequestAuthority(core, requestId)) return false;

        try {
            this.events?._disableWordInteractions?.();
        } catch (_) {}
        try {
            document
                .getElementById('dualsub-original-subtitle')
                ?.classList.add('dualsub-subtitles-disabled');
        } catch (_) {}
        try {
            this.ui?.updateSelectionDisplay();
            core.syncSelectionHighlights();
        } catch (_) {}
        if (!this._hasPrivateRequestAuthority(core, requestId)) return false;

        try {
            const scope = core.contentElement || document;
            const button = scope.querySelector('#dualsub-start-analysis');
            if (button) {
                button.textContent = this._getLocalizedMessage(
                    'aiContextPauseAnalysis'
                );
                button.className = 'dualsub-analysis-button processing';
                button.title = this._getLocalizedMessage(
                    'aiContextPauseAnalysisTitle'
                );
                button.disabled = false;
                button.setAttribute('data-paused-toggle', 'true');
                const replacement = button.cloneNode(true);
                button.parentNode.replaceChild(replacement, button);
                this._bindButtonListener(
                    'analysis-button',
                    replacement,
                    (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.pauseAnalysisFromDomEvent(event);
                    }
                );
            }
        } catch (_) {}
        return this._hasPrivateRequestAuthority(core, requestId);
    }

    _clearPrivateRequestBeforeRendering(core) {
        this._setPrivateCurrentRequest(null);
        core.setAnalyzing(false);
        this._privateCancelRequestedFor = null;
    }

    _releasePrivateProcessingUi(core) {
        try {
            document
                .getElementById('dualsub-selected-words')
                ?.classList.remove('dualsub-processing-disabled');
            document
                .getElementById('dualsub-original-subtitle')
                ?.classList.remove('dualsub-subtitles-disabled');
            core.contentElement?.classList.remove(
                'dualsub-processing-active',
                'dualsub-processing-sticky'
            );
            core.element?.classList.remove('dualsub-processing-disabled');
        } catch (_) {}
        try {
            this.events?._enableWordInteractions?.();
        } catch (_) {}
        try {
            this.ui?.updateSelectionDisplay();
        } catch (_) {}
        this.resetAnalysisButton();
    }

    _renderPrivateFailure(requestId, retryable) {
        const core = this.core;
        if (this._destroyed || !core) return false;
        core.currentMode = 'error';
        this._releasePrivateProcessingUi(core);
        this.ui?.showPrivateTerminalFailure?.({
            retryable,
            onRetry: () => {
                if (this._destroyed || this.core !== core) return false;
                return this._startPrivateAnalysis({
                    cause: 'retry',
                    retryOf: requestId,
                });
            },
            onClose: () => {
                if (this._destroyed || this.core !== core) return false;
                return this.closeModal();
            },
        });
        return true;
    }

    _settlePrivateAnalysis(settlement) {
        const core = this.core;
        if (
            this._destroyed ||
            !core ||
            !settlement ||
            (core.currentRequest !== settlement.requestId &&
                this._privateClosedRequestId !== settlement.requestId)
        ) {
            return false;
        }

        const requestId = settlement.requestId;
        if (this._privateClosedRequestId === requestId) {
            this._setPrivateCurrentRequest(null);
            core.setAnalyzing(false);
            this._privateCancelRequestedFor = null;
            if (settlement.outcome === 'succeeded') {
                try {
                    Reflect.apply(
                        this._analysisCapabilities.takeResult,
                        undefined,
                        [requestId]
                    );
                } catch (_) {}
            }
            return true;
        }
        this._clearPrivateRequestBeforeRendering(core);
        if (this._destroyed || this.core !== core) return false;

        if (settlement.outcome === 'succeeded') {
            let result;
            try {
                result = Reflect.apply(
                    this._analysisCapabilities.takeResult,
                    undefined,
                    [requestId]
                );
            } catch (_) {
                result = null;
            }
            if (
                this._destroyed ||
                this.core !== core ||
                result === null ||
                typeof result !== 'object' ||
                Array.isArray(result)
            ) {
                return this._renderPrivateFailure(requestId, true);
            }

            let html;
            try {
                if (core.setPrivateAnalysisResult(result) !== true) {
                    return this._renderPrivateFailure(requestId, true);
                }
                html = this._buildResultsHtml(result);
            } catch (_) {
                return this._renderPrivateFailure(requestId, true);
            }
            if (this._destroyed || this.core !== core) return false;

            core.currentMode = 'display';
            if (
                this.animations &&
                typeof this.animations.showResultsState === 'function'
            ) {
                this.animations.showResultsState(html);
            } else {
                core.setState(MODAL_STATES.DISPLAY);
                this.ui?.showAnalysisResults(html);
            }
            if (this._destroyed || this.core !== core) return false;
            this._releasePrivateProcessingUi(core);
            return true;
        }

        if (settlement.outcome === 'failed') {
            return this._renderPrivateFailure(requestId, settlement.retryable);
        }

        core.currentMode = 'selection';
        this._releasePrivateProcessingUi(core);
        if (settlement.reason !== 'modal-closed') {
            core.setState(MODAL_STATES.SELECTION);
            this.ui?.showInitialState();
        }
        return true;
    }

    async startAnalysis() {
        if (
            this._destroyed ||
            !this.core ||
            this.core.selectedWords.size === 0
        ) {
            return;
        }
        if (this._privateAnalysis) {
            return this._startPrivateAnalysis({ cause: 'user', retryOf: null });
        }
        const core = this.core;
        const ui = this.ui;
        const animations = this.animations;

        // Reset previous state if needed
        if (core.isAnalyzing) {
            this.pauseAnalysis();
            if (this._destroyed || this.core !== core) return;
        }

        core.currentMode = 'analysis';
        // Mark analyzing first to ensure downstream logic (sync/highlight, event guards) sees locked state
        core.setAnalyzing(true);
        if (this._destroyed || this.core !== core) return;
        core.setState(MODAL_STATES.PROCESSING);
        if (this._destroyed || this.core !== core) return;

        if (
            animations &&
            typeof animations.showProcessingState === 'function'
        ) {
            animations.showProcessingState();
        } else {
            ui.showProcessingState();
        }
        if (this._destroyed || this.core !== core) return;

        // Disable interactions consistently (mirror Events module behavior)
        try {
            if (
                this.events &&
                typeof this.events._disableWordInteractions === 'function'
            ) {
                this.events._disableWordInteractions();
            }
            // Ensure original subtitles visually reflect disabled state
            try {
                const original = document.getElementById(
                    'dualsub-original-subtitle'
                );
                if (original)
                    original.classList.add('dualsub-subtitles-disabled');
            } catch (_) {}
            // Force-hide remove buttons immediately for robustness
            try {
                const selected = document.getElementById(
                    'dualsub-selected-words'
                );
                selected
                    ?.querySelectorAll('.dualsub-word-remove')
                    .forEach((el) => {
                        el.style.display = 'none';
                    });
            } catch (_) {}
        } catch (_) {}

        // Freeze selection persistence and suppress immediate restorations
        try {
            core.selectionPersistence.lastManualSelectionTs = Date.now();
        } catch (_) {}

        // Ensure UI reflects disabled removal (hide X icons) and keep highlights visible
        try {
            ui.updateSelectionDisplay();
        } catch (_) {}
        try {
            core.syncSelectionHighlights();
        } catch (_) {}

        // Switch button to pause state
        try {
            const scope = core.contentElement || document;
            const btn = scope.querySelector('#dualsub-start-analysis');
            if (btn) {
                btn.textContent = this._getLocalizedMessage(
                    'aiContextPauseAnalysis'
                );
                btn.className = 'dualsub-analysis-button processing';
                btn.title = this._getLocalizedMessage(
                    'aiContextPauseAnalysisTitle'
                );
                btn.disabled = false;
                btn.setAttribute('data-paused-toggle', 'true');
                const newButton = btn.cloneNode(true);
                btn.parentNode.replaceChild(newButton, btn);
                this._bindButtonListener(
                    'analysis-button',
                    newButton,
                    (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.pauseAnalysis();
                    }
                );
            }
        } catch (_) {}

        // Resolve language prefs
        let targetLanguage = 'en';
        let sourceLanguage = 'auto';
        try {
            const cfg =
                core.contentScript?.configService || window.configService;
            if (cfg && typeof cfg.getMultiple === 'function') {
                const prefs = await cfg.getMultiple([
                    'targetLanguage',
                    'originalLanguage',
                ]);
                if (prefs?.targetLanguage)
                    targetLanguage = prefs.targetLanguage;
                if (prefs?.originalLanguage)
                    sourceLanguage = prefs.originalLanguage;
            } else if (chrome?.storage?.sync) {
                const result = await chrome.storage.sync.get([
                    'targetLanguage',
                    'originalLanguage',
                ]);
                if (result.targetLanguage)
                    targetLanguage = result.targetLanguage;
                if (result.originalLanguage)
                    sourceLanguage = result.originalLanguage;
            }
        } catch (_) {}

        if (this._destroyed || this.core !== core) return;

        // Dispatch analysis request
        const requestId = `analysis-${Date.now()}`;
        core.currentRequest = requestId;

        document.dispatchEvent(
            new CustomEvent('dualsub-analyze-selection', {
                detail: {
                    requestId,
                    text: core.selectedText,
                    contextTypes: ['cultural', 'historical', 'linguistic'],
                    language: sourceLanguage,
                    targetLanguage: targetLanguage,
                    selection: {
                        text: core.selectedText,
                        words: Array.from(core.selectedWords),
                    },
                },
            })
        );

        core._log('info', 'Context analysis started (controller)', {
            textLength: core.selectedText.length,
            selectedWordsCount: core.selectedWords.size,
            requestId,
        });
    }

    pauseAnalysis() {
        if (this._destroyed || !this.core) return;
        const core = this.core;
        const ui = this.ui;

        if (this._privateAnalysis) {
            return this._cancelPrivateRequestById(core.currentRequest, 'user');
        }

        // Emit pause intent so the manager can cancel the in-flight provider request
        try {
            document.dispatchEvent(
                new CustomEvent('aicontext:analysis:pause', {
                    detail: { requestId: core.currentRequest },
                })
            );
        } catch (_) {}
        if (this._destroyed || this.core !== core) return;

        core.isAnalyzing = false;
        core.currentRequest = null;
        core.currentMode = 'selection';
        // Re-enable interactions
        try {
            const selectedWordsElement = document.getElementById(
                'dualsub-selected-words'
            );
            selectedWordsElement?.classList.remove(
                'dualsub-processing-disabled'
            );
        } catch (_) {}
        // Reset state back to selection
        core.setState(MODAL_STATES.SELECTION);
        if (this._destroyed || this.core !== core) return;
        ui.showInitialState();
        try {
            ui.updateSelectionDisplay();
        } catch (_) {}
        // Ensure processing classes cleared
        try {
            const content =
                core.contentElement ||
                document.getElementById('dualsub-modal-content');
            content?.classList.remove(
                'is-analyzing',
                'dualsub-processing-active',
                'dualsub-processing-sticky'
            );
            if (core.element)
                core.element.classList.remove('dualsub-processing-disabled');
            // Remove disabled class from subtitles
            try {
                const original = document.getElementById(
                    'dualsub-original-subtitle'
                );
                if (original)
                    original.classList.remove('dualsub-subtitles-disabled');
            } catch (_) {}
            // Ensure chips show remove buttons again after unfreezing
            try {
                const selected = document.getElementById(
                    'dualsub-selected-words'
                );
                selected
                    ?.querySelectorAll('.dualsub-word-remove')
                    .forEach((el) => {
                        el.style.removeProperty('display');
                    });
            } catch (_) {}
        } catch (_) {}
        // Reset Start button
        this.resetAnalysisButton();
    }

    newAnalysis() {
        if (this._destroyed || !this.core) return false;
        if (this._privateAnalysis && this.core.isAnalyzing) return false;
        // Do not clear selection automatically when starting a new analysis session UI-wise.
        // Keep selection until user explicitly removes or closes the modal.
        // this.core.clearSelection();
        this.core.analysisResult = null;
        this.core.setState(MODAL_STATES.SELECTION);
        this.ui.showInitialState();
        this.ui.updateSelectionDisplay();
    }

    closeModal() {
        if (this._destroyed || !this.core) return false;
        if (this._privateAnalysis) {
            const core = this.core;
            if (
                Number.isSafeInteger(core.currentRequest) &&
                core.currentRequest > 0
            ) {
                const requestId = core.currentRequest;
                this._privateClosedRequestId = requestId;
                this._setPrivateCurrentRequest(null);
                core.setAnalyzing(false);
                this._cancelPrivateRequestById(requestId, 'modal-closed');
            }
            try {
                const clearResult = Reflect.apply(
                    this._analysisCapabilities.clearSelection,
                    undefined,
                    []
                );
                observeCapabilitySettlement(clearResult);
            } catch (_) {}
            if (
                this.animations &&
                typeof this.animations.hideModal === 'function'
            ) {
                this.animations.hideModal();
            } else {
                core.setState(MODAL_STATES.HIDDEN);
            }
            return true;
        }
        // Pause/stop analysis if in progress
        if (this.core.isAnalyzing) {
            this.pauseAnalysis();
        }
        // Clear selection and reset
        this.core.clearSelection();
        this.core.originalSentenceWords = [];
        this.core.wordPositions.clear();
        this.core.selectedWordsOrder = [];
        this.core.selectedText = '';
        try {
            this.ui.updateSelectionDisplay();
        } catch (_) {}
        // Clear visual highlights on subtitles when closing
        try {
            const original = document.getElementById(
                'dualsub-original-subtitle'
            );
            if (original) {
                original
                    .querySelectorAll(
                        '.dualsub-interactive-word.dualsub-word-selected'
                    )
                    .forEach((el) =>
                        el.classList.remove('dualsub-word-selected')
                    );
            }
        } catch (_) {}
        // Hide modal via animations if available
        if (
            this.animations &&
            typeof this.animations.hideModal === 'function'
        ) {
            this.animations.hideModal();
        } else {
            this.core.setState(MODAL_STATES.HIDDEN);
        }
    }

    onAnalysisResult(detail) {
        if (this._privateAnalysis) return false;
        const { requestId, result, success, error, shouldRetry } = detail || {};

        this.core._log('debug', 'Controller received analysis result', {
            requestId,
            expectedId: this.core.currentRequest,
            success,
            hasResult: !!result,
            hasError: !!error,
        });

        // If there's no currentRequest (paused/cancelled) or IDs don't match, ignore this result
        if (
            !this.core.currentRequest ||
            (requestId &&
                this.core.currentRequest &&
                requestId !== this.core.currentRequest)
        ) {
            this.core._log(
                'debug',
                'Ignoring result - request ID mismatch (controller)',
                {
                    receivedId: requestId,
                    expectedId: this.core.currentRequest,
                }
            );
            return;
        }

        if (success && result) {
            // Store raw result for observability
            try {
                this.core.setAnalysisResult(result);
            } catch (_) {}

            const html = this._buildResultsHtml(result);
            if (
                this.animations &&
                typeof this.animations.showResultsState === 'function'
            ) {
                this.animations.showResultsState(html);
            } else {
                this.core.setState(MODAL_STATES.DISPLAY);
                this.ui.showAnalysisResults(html);
            }
            // Re-enable interactions and reset button to Start
            try {
                const selectedWordsElement = document.getElementById(
                    'dualsub-selected-words'
                );
                if (selectedWordsElement) {
                    selectedWordsElement.classList.remove(
                        'dualsub-processing-disabled'
                    );
                }
            } catch (_) {}
            try {
                this.ui.updateSelectionDisplay();
            } catch (_) {}
            // Re-enable subtitles interaction visuals
            try {
                const original = document.getElementById(
                    'dualsub-original-subtitle'
                );
                if (original)
                    original.classList.remove('dualsub-subtitles-disabled');
            } catch (_) {}
            // Ensure chips show remove buttons again after results
            try {
                const selected = document.getElementById(
                    'dualsub-selected-words'
                );
                selected
                    ?.querySelectorAll('.dualsub-word-remove')
                    .forEach((el) => {
                        el.style.removeProperty('display');
                    });
            } catch (_) {}
            this.resetAnalysisButton();
            return;
        }

        if (shouldRetry) {
            this._handleInvalidAnalysisResponse(
                requestId,
                result,
                error || 'Invalid analysis result'
            );
            return;
        }

        // Final error
        const errorMessage =
            typeof error === 'string'
                ? error
                : error?.message || 'Unknown error';
        if (
            this.animations &&
            typeof this.animations.showErrorState === 'function'
        ) {
            this.animations.showErrorState(errorMessage, { requestId });
        } else {
            this.core.setState(MODAL_STATES.ERROR);
            this.ui.showErrorState(errorMessage, { requestId });
        }
    }

    resetAnalysisButton() {
        if (this._destroyed || !this.core) return;
        const scope = this.core.contentElement || document;
        const analysisButton =
            scope.querySelector('#dualsub-start-analysis') ||
            document.getElementById('dualsub-start-analysis');
        if (!analysisButton) return;

        const title = this._getLocalizedMessage('aiContextStartAnalysis');
        analysisButton.textContent = title;
        analysisButton.className = 'dualsub-analysis-button';
        analysisButton.title = title;
        analysisButton.disabled = this.core.selectedWords.size === 0;
        analysisButton.removeAttribute('data-paused-toggle');

        const newButton = analysisButton.cloneNode(true);
        analysisButton.parentNode.replaceChild(newButton, analysisButton);

        const startHandler = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.startAnalysisFromDomEvent(event);
        };
        this._bindButtonListener('analysis-button', newButton, startHandler);
    }

    _isTrustedPrivateDomEvent(event) {
        return !this._privateAnalysis || event?.isTrusted === true;
    }

    startAnalysisFromDomEvent(event) {
        if (!this._isTrustedPrivateDomEvent(event)) return false;
        return this.startAnalysis();
    }

    pauseAnalysisFromDomEvent(event) {
        if (!this._isTrustedPrivateDomEvent(event)) return false;
        return this.pauseAnalysis();
    }

    closeModalFromDomEvent(event) {
        if (!this._isTrustedPrivateDomEvent(event)) return false;
        return this.closeModal();
    }

    newAnalysisFromDomEvent(event) {
        if (!this._isTrustedPrivateDomEvent(event)) return false;
        return this.newAnalysis();
    }

    _buildResultsHtml(result) {
        let html = '';
        if (result.analysis) {
            if (result.isStructured && typeof result.analysis === 'object') {
                html += this._formatStructuredAnalysis(
                    result.analysis,
                    result.contextType
                );
            } else {
                html += `<div class="dualsub-analysis-section">
                        <h4>${this._getContextTypeTitle(result.contextType)} Analysis</h4>
                        <div class="dualsub-analysis-text">${this._formatAnalysisText(result.analysis)}</div>
                    </div>`;
            }
        } else {
            if (result.cultural) {
                html += `<div class="dualsub-analysis-section">
                        <h4>${this._getLocalizedSectionHeader('aiContextCultural')}</h4>
                        <div class="dualsub-analysis-text">${this._formatAnalysisText(result.cultural)}</div>
                    </div>`;
            }
            if (result.historical) {
                html += `<div class="dualsub-analysis-section">
                        <h4>${this._getLocalizedSectionHeader('aiContextHistorical')}</h4>
                        <div class="dualsub-analysis-text">${this._formatAnalysisText(result.historical)}</div>
                    </div>`;
            }
            if (result.linguistic) {
                html += `<div class="dualsub-analysis-section">
                        <h4>${this._getLocalizedSectionHeader('aiContextLinguistic')}</h4>
                        <div class="dualsub-analysis-text">${this._formatAnalysisText(result.linguistic)}</div>
                    </div>`;
            }
        }

        if (!html) {
            const context = result.contextType || 'all';
            html = `<div class="dualsub-analysis-section">
                <h4>${this._getContextTypeTitle(context)} Analysis</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(result.analysis || result || '')}</div>
            </div>`;
        }
        return html;
    }

    _formatStructuredAnalysis(analysis, contextType) {
        if (!analysis || typeof analysis !== 'object') return '';
        let html = '';
        if (analysis.definition) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextDefinition')}</h4>
                <div class="dualsub-analysis-text">
                    <p><strong>${analysis.definition}</strong></p>
                </div>
            </div>`;
        }
        if (contextType === 'cultural' || contextType === 'all')
            html += this._formatCulturalSection(analysis);
        if (contextType === 'historical' || contextType === 'all')
            html += this._formatHistoricalSection(analysis);
        if (contextType === 'linguistic' || contextType === 'all')
            html += this._formatLinguisticSection(analysis);
        html += this._formatUsageSection(analysis);
        html += this._formatLearningSection(analysis);
        if (!html) {
            html = `<div class="dualsub-analysis-section">
                <h4>${this._getContextTypeTitle(contextType)} Analysis</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(analysis)}</div>
            </div>`;
        }
        return html;
    }

    _formatAnalysisText(text) {
        if (!text) return '';
        const html = this._parseMarkdownToHtml(text);
        if (html && html !== text && html.includes('<')) return html;
        return String(text)
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>');
    }

    _formatObjectContent(content) {
        if (typeof content === 'string')
            return this._formatAnalysisText(content);
        if (typeof content === 'object' && content !== null) {
            let html = '';
            for (const [key, value] of Object.entries(content)) {
                if (typeof value === 'string' && value.trim()) {
                    const formattedKey = this._getLocalizedFieldName(key);
                    html += `<div class="dualsub-analysis-subsection">
                        <strong>${formattedKey}</strong> ${this._formatAnalysisText(value)}
                    </div>`;
                }
            }
            return (
                html ||
                this._formatAnalysisText(JSON.stringify(content, null, 2))
            );
        }
        return '';
    }

    _formatCulturalSection(analysis) {
        let html = '';
        const cultural =
            analysis.cultural_context || analysis.cultural_analysis;
        if (cultural) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextCultural')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(cultural)}</div>
            </div>`;
        }
        if (analysis.cultural_significance) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextCulturalSignificance')}</h4>
                <div class="dualsub-analysis-text"><p>${analysis.cultural_significance}</p></div>
            </div>`;
        }
        return html;
    }

    _formatHistoricalSection(analysis) {
        let html = '';
        const historical =
            analysis.historical_context || analysis.historical_analysis;
        if (historical) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextHistorical')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(historical)}</div>
            </div>`;
        }
        if (analysis.historical_significance) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextHistoricalSignificance')}</h4>
                <div class="dualsub-analysis-text"><p>${analysis.historical_significance}</p></div>
            </div>`;
        }
        return html;
    }

    _formatLinguisticSection(analysis) {
        let html = '';
        const linguistic = analysis.etymology || analysis.linguistic_analysis;
        if (linguistic) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextLinguistic')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(linguistic)}</div>
            </div>`;
        }
        if (analysis.grammar || analysis.semantics) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextGrammar')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(analysis.grammar || analysis.semantics)}</div>
            </div>`;
        }
        return html;
    }

    _formatUsageSection(analysis) {
        let html = '';
        if (analysis.usage || analysis.examples) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextUsage')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(analysis.usage || analysis.examples)}</div>
            </div>`;
        }
        return html;
    }

    _formatLearningSection(analysis) {
        let html = '';
        if (analysis.learning_tips || analysis.tips) {
            html += `<div class="dualsub-analysis-section">
                <h4>${this._getLocalizedSectionHeader('aiContextLearningTips')}</h4>
                <div class="dualsub-analysis-text">${this._formatObjectContent(analysis.learning_tips || analysis.tips)}</div>
            </div>`;
        }
        return html;
    }

    _getLocalizedSectionHeader(key) {
        return this._getLocalizedMessage(key);
    }

    _getContextTypeTitle(contextType) {
        switch (contextType) {
            case 'cultural':
                return this._getLocalizedContextType('cultural');
            case 'historical':
                return this._getLocalizedContextType('historical');
            case 'linguistic':
                return this._getLocalizedContextType('linguistic');
            case 'all':
                return this._getLocalizedContextType('comprehensive');
            default:
                return this._getLocalizedContextType('generic');
        }
    }

    _getLocalizedContextType(type) {
        try {
            const keyMap = {
                cultural: 'aiContextTypeCultural',
                historical: 'aiContextTypeHistorical',
                linguistic: 'aiContextTypeLinguistic',
                comprehensive: 'aiContextTypeComprehensive',
                generic: 'aiContextTypeGeneric',
            };
            const key = keyMap[type] || keyMap.generic;
            return this.ui._getLocalizedMessage(key) || type;
        } catch (_) {
            return type;
        }
    }

    _getLocalizedFieldName(fieldName) {
        // Normalize and map common field names to rich localization keys (aligned with events module)
        const normalizedField = String(fieldName || '')
            .toLowerCase()
            .replace(/[_\s]+/g, '')
            .replace(/&/g, '');

        const fieldMappings = {
            culturalcontext: 'aiContextCulturalContext',
            cultural: 'aiContextCulturalContext',
            socialusage: 'aiContextSocialUsage',
            social: 'aiContextSocialUsage',
            regionalnotes: 'aiContextRegionalNotes',
            regional: 'aiContextRegionalNotes',
            origins: 'aiContextOrigins',
            origin: 'aiContextOrigins',
            historicalcontext: 'aiContextHistoricalContext',
            historical: 'aiContextHistoricalContext',
            historicalsignificance: 'aiContextHistoricalSignificanceLabel',
            evolution: 'aiContextEvolutionLabel',
            linguisticanalysis: 'aiContextLinguisticAnalysis',
            linguistic: 'aiContextLinguisticAnalysis',
            etymology: 'aiContextEtymology',
            grammarsemantics: 'aiContextGrammarSemantics',
            grammar: 'aiContextGrammarSemantics',
            grammarnotes: 'aiContextGrammarNotes',
            semantics: 'aiContextGrammarSemantics',
            translationnotes: 'aiContextTranslationNotes',
            usageexamples: 'aiContextUsageExamples',
            usage: 'aiContextUsageExamples',
            examples: 'aiContextUsageExamples',
            learningtips: 'aiContextLearningTipsLabel',
            learning: 'aiContextLearningTipsLabel',
            tips: 'aiContextLearningTipsLabel',
            relatedexpressions: 'aiContextRelatedExpressionsLabel',
            related: 'aiContextRelatedExpressionsLabel',
            expressions: 'aiContextRelatedExpressionsLabel',
            keyinsights: 'aiContextKeyInsightsLabel',
            insights: 'aiContextKeyInsightsLabel',
            key: 'aiContextKeyInsightsLabel',
        };

        const messageKey = fieldMappings[normalizedField];
        if (messageKey) {
            try {
                const msg = this.ui._getLocalizedMessage(messageKey);
                if (msg) return msg;
            } catch (_) {}
        }
        // Fallback: Capitalize and append colon
        return (
            String(fieldName || '')
                .charAt(0)
                .toUpperCase() +
            String(fieldName || '')
                .slice(1)
                .replace(/_/g, ' ') +
            ':'
        );
    }

    _parseMarkdownToHtml(text) {
        if (!text || typeof text !== 'string') return '';
        let html = text;
        html = html.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
        html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
        html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '$1');
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');
        html = html.replace(/^\* (.*$)/gm, '<li>$1</li>');
        html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
        html = html.replace(/^(\d+)\. (.*$)/gm, '<li>$1. $2</li>');
        html = html.replace(/(<li>.*<\/li>)/gs, (match) => {
            if (match.includes('<li>1.') || /\d+\./.test(match))
                return `<ol>${match}</ol>`;
            return `<ul>${match}</ul>`;
        });
        html = html.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank">$1</a>'
        );
        html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');
        if (!html.startsWith('<') && html.trim()) html = `<p>${html}</p>`;
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p>(<h[1-6]>.*<\/h[1-6]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>.*<\/ul>)<\/p>/gs, '$1');
        html = html.replace(/<p>(<ol>.*<\/ol>)<\/p>/gs, '$1');
        html = html.replace(/<p>(<blockquote>.*<\/blockquote>)<\/p>/g, '$1');
        return html;
    }

    _getLocalizedMessage(key) {
        try {
            return this.ui._getLocalizedMessage(key);
        } catch (_) {
            return key;
        }
    }

    _handleInvalidAnalysisResponse(requestId, result, error) {
        this.core._log(
            'warn',
            'Invalid analysis response detected (controller)',
            {
                requestId,
                errorName: error?.name,
                errorLength:
                    typeof error === 'string'
                        ? error.length
                        : error?.message?.length || 0,
            }
        );

        if (
            typeof this.core.prepareRetry === 'function' &&
            this.core.canRetryAnalysis()
        ) {
            this.core.prepareRetry(
                { requestId, text: this.core.selectedText },
                error
            );

            // Notify user and update processing text if possible
            try {
                const notification = document.getElementById(
                    'dualsub-retry-notification'
                );
                if (notification)
                    notification.textContent =
                        this._getLocalizedMessage(
                            'aiContextRetryNotification'
                        ) || 'Analysis failed, retrying...';
            } catch (_) {}

            const newRequestId = `analysis-${Date.now()}`;
            this.core.currentRequest = newRequestId;
            document.dispatchEvent(
                new CustomEvent('dualsub-analyze-selection', {
                    detail: {
                        requestId: newRequestId,
                        text: this.core.selectedText,
                        contextTypes: ['cultural', 'historical', 'linguistic'],
                        language: 'auto',
                        targetLanguage: 'en',
                        selection: {
                            text: this.core.selectedText,
                            words: Array.from(this.core.selectedWords),
                        },
                    },
                })
            );
            return;
        }

        // Exhausted retries; show error
        const err =
            typeof error === 'string'
                ? error
                : error?.message || 'Invalid analysis result';
        if (
            this.animations &&
            typeof this.animations.showErrorState === 'function'
        ) {
            this.animations.showErrorState(err, { requestId });
        } else {
            this.core.setState(MODAL_STATES.ERROR);
            this.ui.showErrorState(err, { requestId });
        }
    }
}
