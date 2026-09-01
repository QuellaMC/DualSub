import { MODAL_STATES } from '../../core/constants.js';
import { CONTEXT_TYPES } from '../../../shared/constants/contextTypes.js';

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

function observeCapabilitySettlement(value) {
    try {
        const promise = trustedPromiseResolve(value);
        void trustedPromiseThen(promise, undefined, () => undefined);
    } catch (_) {}
}

function parsePrivateSettlement(value) {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const { requestId, outcome } = value;
        if (!Number.isSafeInteger(requestId) || requestId <= 0) return null;

        if (outcome === 'succeeded') {
            return Object.freeze({ requestId, outcome });
        }
        if (outcome === 'failed') {
            const { code, retryable } = value;
            if (
                !PRIVATE_FAILURE_CODES.includes(code) ||
                typeof retryable !== 'boolean'
            ) {
                return null;
            }
            return Object.freeze({ requestId, outcome, code, retryable });
        }
        if (outcome === 'cancelled') {
            const { reason } = value;
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
        this._destroyed = false;
        this._analysisCapabilities = analysisCapabilities;
        this._privateAnalysis = analysisCapabilities !== null;
        this._privateSettlementUnsubscribe = null;
        this._privateSettlementListener = null;
        this._privateSettlementSubscribed = false;
        this._privateCancelRequestedFor = null;

        if (this._privateAnalysis) this._subscribeToPrivateSettlements();
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        const unsubscribe = this._privateSettlementUnsubscribe;
        this._privateSettlementUnsubscribe = null;
        this._privateSettlementSubscribed = false;
        this._privateSettlementListener = null;
        this._privateCancelRequestedFor = null;
        this._analysisCapabilities = null;
        try {
            if (typeof unsubscribe === 'function') unsubscribe();
        } catch (_) {}

        this.core = null;
        this.ui = null;
        this.animations = null;
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
            unsubscribe = capabilities.subscribeSettled(listener);
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
        if (!settlement) return false;
        if (settlement.requestId !== this.core?.currentRequest) {
            if (settlement.outcome === 'succeeded') {
                try {
                    this._analysisCapabilities.takeResult(settlement.requestId);
                } catch (_) {}
            }
            return false;
        }
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
            const cancelled = this._analysisCapabilities.cancelAnalysis(
                requestId,
                reason
            );
            if (cancelled === true) return true;
        } catch (_) {}
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
        this._privateCancelRequestedFor = null;

        let requestId = null;
        try {
            requestId = this._analysisCapabilities.requestAnalysis(
                Object.freeze({
                    cause,
                    retryOf,
                    contextTypes: CONTEXT_TYPES,
                })
            );
        } catch (_) {
            requestId = null;
        }

        if (this._destroyed || this.core !== core) return false;
        const validRequestId = Number.isSafeInteger(requestId) && requestId > 0;
        if (!validRequestId) return false;

        this._setPrivateCurrentRequest(requestId);
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
            core.contentElement?.classList.add('dualsub-processing-active');
            const original = document.getElementById(
                'dualsub-original-subtitle'
            );
            if (original) {
                original.classList.add('dualsub-subtitles-disabled');
                original.style.pointerEvents = 'none';
            }
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
            document
                .getElementById('dualsub-original-subtitle')
                ?.style.removeProperty('pointer-events');
            core.contentElement?.classList.remove(
                'dualsub-processing-active',
                'dualsub-processing-sticky'
            );
            core.element?.classList.remove('dualsub-processing-disabled');
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
            core.currentRequest !== settlement.requestId
        ) {
            return false;
        }

        const requestId = settlement.requestId;
        this._clearPrivateRequestBeforeRendering(core);
        if (this._destroyed || this.core !== core) return false;

        if (settlement.outcome === 'succeeded') {
            let result;
            try {
                result = this._analysisCapabilities.takeResult(requestId);
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
            !this._privateAnalysis ||
            this.core.selectedWords.size === 0
        ) {
            return false;
        }
        return this._startPrivateAnalysis({ cause: 'user', retryOf: null });
    }

    pauseAnalysis() {
        if (this._destroyed || !this.core || !this._privateAnalysis) {
            return false;
        }
        return this._cancelPrivateRequestById(this.core.currentRequest, 'user');
    }

    newAnalysis() {
        if (this._destroyed || !this.core) return false;
        if (this._privateAnalysis && this.core.isAnalyzing) return false;
        this.core.analysisResult = null;
        this.core.setState(MODAL_STATES.SELECTION);
        this.ui.showInitialState();
        this.ui.updateSelectionDisplay();
        return true;
    }

    closeModal() {
        if (this._destroyed || !this.core || !this._privateAnalysis) {
            return false;
        }

        const core = this.core;
        const requestId = core.currentRequest;
        this._setPrivateCurrentRequest(null);
        core.setAnalyzing(false);
        this._releasePrivateProcessingUi(core);

        if (Number.isSafeInteger(requestId) && requestId > 0) {
            this._cancelPrivateRequestById(requestId, 'modal-closed');
        }
        try {
            const clearResult = this._analysisCapabilities.clearSelection();
            observeCapabilitySettlement(clearResult);
        } catch (_) {}
        try {
            const cleanup = this.ui?.clearTerminalRetryActions?.();
            observeCapabilitySettlement(cleanup);
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
}
