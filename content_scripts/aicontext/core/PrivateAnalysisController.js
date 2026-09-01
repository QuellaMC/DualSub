import {
    buildAnalyzeContextRequestMessage,
    MessageSenderRoles,
    parseAnalyzeContextResponseMessage,
} from '../../shared/protocol/messageProtocol.js';
import { CONTEXT_TYPES } from '../../shared/constants/contextTypes.js';
import { AI_CONTEXT_SIGNAL_TYPES } from './AIContextChannel.js';

const CONTEXT_TYPE_SET = new Set(CONTEXT_TYPES);
const CANCEL_REASONS = new Set([
    'user',
    'superseded',
    'modal-closed',
    'selection-invalidated',
]);

function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function normalizeAuthority(value) {
    if (!value || typeof value !== 'object') return null;
    const { channel, allocateRequestId, getSelectionSnapshot, clearSelection } =
        value;
    if (
        !channel ||
        typeof channel.publish !== 'function' ||
        typeof channel.subscribe !== 'function' ||
        typeof allocateRequestId !== 'function' ||
        typeof getSelectionSnapshot !== 'function' ||
        typeof clearSelection !== 'function'
    ) {
        return null;
    }
    return { channel, allocateRequestId, getSelectionSnapshot, clearSelection };
}

function normalizeContextTypes(value) {
    const contextTypes = value ?? CONTEXT_TYPES;
    if (
        !Array.isArray(contextTypes) ||
        contextTypes.length === 0 ||
        contextTypes.length > CONTEXT_TYPES.length ||
        new Set(contextTypes).size !== contextTypes.length ||
        !contextTypes.every((type) => CONTEXT_TYPE_SET.has(type))
    ) {
        return null;
    }
    return [...contextTypes];
}

function normalizeLanguages(value) {
    const targetLanguage = value?.targetLanguage;
    const originalLanguage = value?.originalLanguage;
    if (
        typeof targetLanguage !== 'string' ||
        targetLanguage.trim() !== targetLanguage ||
        targetLanguage.length === 0 ||
        typeof originalLanguage !== 'string' ||
        originalLanguage.trim() !== originalLanguage ||
        originalLanguage.length === 0
    ) {
        return null;
    }
    return { targetLanguage, originalLanguage };
}

function sameSelection(left, right) {
    return Boolean(
        left &&
        right &&
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision
    );
}

export class PrivateAnalysisController {
    constructor(manager, authority) {
        this.manager = manager;
        this.authority = normalizeAuthority(authority);
        this.active = false;
        this.selection = null;
        this.pending = null;
        this.lastRequestId = 0;
        this.lastFailure = null;
        this.results = new Map();
        this.settlementListeners = new Set();
        this.unsubscribers = [];
    }

    start() {
        if (this.active || !this.authority) return false;

        const subscribe = (type, listener) => {
            const unsubscribe = this.authority.channel.subscribe(
                type,
                listener
            );
            if (typeof unsubscribe !== 'function') {
                throw new TypeError('Invalid AI context channel');
            }
            this.unsubscribers.push(unsubscribe);
        };

        try {
            this.active = true;
            subscribe(AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT, (envelope) =>
                this._acceptSelection(envelope?.payload)
            );
            subscribe(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, (envelope) =>
                this._acceptWordIntent(envelope?.payload)
            );
            this._acceptSelection(this.authority.getSelectionSnapshot());
            return true;
        } catch {
            this.stop();
            return false;
        }
    }

    createModalCapabilities() {
        if (!this.active) return null;
        return Object.freeze({
            requestAnalysis: (options) => this.requestAnalysis(options),
            cancelAnalysis: (requestId, reason) =>
                this.cancelAnalysis(requestId, reason),
            subscribeSettled: (listener) => this.subscribeSettled(listener),
            takeResult: (requestId) => this.takeResult(requestId),
            clearSelection: () => this.clearSelection(),
        });
    }

    requestAnalysis(options = {}) {
        if (!this.active || this.pending) return null;

        const cause = options?.cause ?? 'user';
        const retryOf = options?.retryOf ?? null;
        const contextTypes = normalizeContextTypes(options?.contextTypes);
        const retryAllowed =
            cause === 'retry' &&
            isPositiveSafeInteger(retryOf) &&
            this.lastFailure?.requestId === retryOf &&
            this.lastFailure.retryable === true &&
            this.lastFailure.selectionRevision ===
                this.selection?.selectionRevision;
        if (
            !contextTypes ||
            (cause === 'user' && retryOf !== null) ||
            (cause !== 'user' && !retryAllowed)
        ) {
            return null;
        }

        const selection = this.authority.getSelectionSnapshot();
        this._acceptSelection(selection);
        if (
            !selection ||
            !Array.isArray(selection.entries) ||
            !selection.entries.length
        ) {
            return null;
        }

        const requestId = this.authority.allocateRequestId();
        if (
            !isPositiveSafeInteger(requestId) ||
            requestId <= this.lastRequestId
        ) {
            return null;
        }
        this.lastRequestId = requestId;

        const pending = {
            requestId,
            selectionRevision: selection.selectionRevision,
            renderRevision: selection.renderRevision,
            providerRequestId: `aicontext-${requestId}`,
        };
        this.pending = pending;
        this.manager.activeRequest = pending.providerRequestId;
        this.manager.metrics.analysisCount += 1;
        this.manager.metrics.lastActivity = Date.now();
        void this._execute(pending, contextTypes, selection);
        return requestId;
    }

    cancelAnalysis(requestId, reason) {
        if (
            !this.active ||
            this.pending?.requestId !== requestId ||
            !CANCEL_REASONS.has(reason)
        ) {
            return false;
        }
        return this._finish(
            this.pending,
            { requestId, outcome: 'cancelled', reason },
            true
        );
    }

    subscribeSettled(listener) {
        if (!this.active || typeof listener !== 'function') return () => {};
        this.settlementListeners.add(listener);
        return () => this.settlementListeners.delete(listener);
    }

    takeResult(requestId) {
        if (!this.active || !isPositiveSafeInteger(requestId)) return null;
        const result = this.results.get(requestId) ?? null;
        this.results.delete(requestId);
        return result;
    }

    clearSelection() {
        if (!this.active) return false;
        try {
            return this.authority.clearSelection() === true;
        } catch {
            return false;
        }
    }

    reapplySelection() {
        if (
            !this.active ||
            !this.selection ||
            typeof this.manager.modal?.applySelectionSnapshot !== 'function'
        ) {
            return false;
        }
        try {
            return (
                this.manager.modal.applySelectionSnapshot(this.selection) ===
                true
            );
        } catch {
            return false;
        }
    }

    stop() {
        if (!this.active && this.unsubscribers.length === 0) return;
        this.active = false;
        if (this.pending) {
            this._cancelProvider(this.pending);
            this.pending = null;
        }
        for (const unsubscribe of this.unsubscribers.splice(0)) {
            try {
                unsubscribe();
            } catch {}
        }
        this.settlementListeners.clear();
        this.results.clear();
        this.selection = null;
        this.lastFailure = null;
        this.manager.activeRequest = null;
    }

    _acceptSelection(snapshot) {
        if (!this.active || !snapshot) return false;
        const previous = this.selection;
        this.selection = snapshot;
        if (this.pending && !sameSelection(this.pending, snapshot)) {
            this._finish(
                this.pending,
                {
                    requestId: this.pending.requestId,
                    outcome: 'cancelled',
                    reason: 'selection-invalidated',
                },
                true
            );
        }
        if (!sameSelection(previous, snapshot)) this.reapplySelection();
        return true;
    }

    _acceptWordIntent(intent) {
        const selection = this.selection;
        const modal = this.manager.modal;
        if (
            !this.active ||
            intent?.action !== 'toggle' ||
            !selection ||
            intent.renderRevision !== selection?.renderRevision ||
            !selection.entries?.some(
                (entry) =>
                    entry.wordIndex === intent.wordIndex &&
                    entry.word === intent.word
            ) ||
            typeof modal?.showSelectionMode !== 'function'
        ) {
            return false;
        }

        try {
            Promise.resolve(
                this.manager.contentScript?.activePlatform?.pausePlayback?.()
            ).catch(() => {});
        } catch {}
        try {
            return (
                modal.showSelectionMode({
                    trigger: 'word-selection',
                    preserveSelection: true,
                }) === true
            );
        } catch {
            return false;
        }
    }

    async _execute(pending, contextTypes, selection) {
        let languages;
        try {
            languages = normalizeLanguages(
                await this.manager.contentScript?.configService?.getMultiple?.([
                    'targetLanguage',
                    'originalLanguage',
                ])
            );
        } catch {
            languages = null;
        }
        if (!this._isCurrent(pending, selection)) return;
        if (!languages) {
            this._fail(pending, 'configuration', false);
            return;
        }

        const text = selection.entries.map((entry) => entry.word).join(' ');
        let expectedRequest;
        try {
            expectedRequest = buildAnalyzeContextRequestMessage(
                MessageSenderRoles.CONTENT,
                {
                    text,
                    contextTypes,
                    language: languages.originalLanguage,
                    targetLanguage: languages.targetLanguage,
                    platform: this.manager.platform,
                    requestId: pending.providerRequestId,
                }
            );
        } catch {
            this._fail(pending, 'configuration', false);
            return;
        }

        const provider = this.manager.provider;
        if (typeof provider?.analyzeContext !== 'function') {
            this._fail(pending, 'provider-unavailable', false);
            return;
        }

        let response;
        try {
            response = await provider.analyzeContext(text, {
                contextTypes,
                language: languages.originalLanguage,
                targetLanguage: languages.targetLanguage,
                platform: this.manager.platform,
                requestId: pending.providerRequestId,
            });
        } catch {
            if (this._isCurrent(pending, selection)) {
                this._fail(pending, 'internal', false);
            }
            return;
        }
        if (!this._isCurrent(pending, selection)) return;

        const parsed = parseAnalyzeContextResponseMessage(
            response,
            expectedRequest,
            MessageSenderRoles.CONTENT
        );
        if (!parsed) {
            this._fail(pending, 'invalid-response', false);
        } else if (parsed.status === 'failure') {
            this.manager.metrics.errorCount += 1;
            this._fail(pending, 'provider-error', parsed.shouldRetry);
        } else {
            this.results.set(pending.requestId, parsed.result);
            this._finish(pending, {
                requestId: pending.requestId,
                outcome: 'succeeded',
            });
        }
    }

    _isCurrent(pending, selection) {
        return Boolean(
            this.active &&
            !this.manager.destroyed &&
            this.pending === pending &&
            sameSelection(this.selection, selection)
        );
    }

    _fail(pending, code, retryable) {
        this._finish(pending, {
            requestId: pending.requestId,
            outcome: 'failed',
            code,
            retryable,
        });
    }

    _finish(pending, settlement, cancelProvider = false) {
        if (!this.active || this.pending !== pending) return false;
        this.pending = null;
        this.manager.activeRequest = null;
        if (cancelProvider) this._cancelProvider(pending);

        if (settlement.outcome === 'failed') {
            this.results.delete(pending.requestId);
            this.lastFailure = {
                requestId: pending.requestId,
                retryable: settlement.retryable,
                selectionRevision: pending.selectionRevision,
            };
        } else {
            if (settlement.outcome !== 'succeeded') {
                this.results.delete(pending.requestId);
            }
            this.lastFailure = null;
        }

        queueMicrotask(() => {
            if (!this.active) {
                this.results.delete(pending.requestId);
                return;
            }
            for (const listener of [...this.settlementListeners]) {
                try {
                    listener(Object.freeze(settlement));
                } catch {}
            }
            this.results.delete(pending.requestId);
        });
        return true;
    }

    _cancelProvider(pending) {
        try {
            this.manager.provider?.cancelRequest?.(pending.providerRequestId);
        } catch {}
    }
}
