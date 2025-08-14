/**
 * ModalController - Pure controller for modal interactions
 * Orchestrates calls into ModalStore/SelectionModel/UI/Animations.
 * No direct DOM class toggles; relies on UI/Animations modules.
 */

import { MODAL_STATES } from '../../core/constants.js';

export class ModalController {
    constructor(core, ui, animations) {
        this.core = core;
        this.ui = ui;
        this.animations = animations;
    }

    async startAnalysis() {
        if (!this.core || this.core.selectedWords.size === 0) return;

        // Reset previous state if needed
        if (this.core.isAnalyzing) {
            this.pauseAnalysis();
        }

        this.core.currentMode = 'analysis';
        // Mark analyzing first to ensure downstream logic (sync/highlight, event guards) sees locked state
        this.core.setAnalyzing(true);
        this.core.setState(MODAL_STATES.PROCESSING);

        if (this.animations && typeof this.animations.showProcessingState === 'function') {
            this.animations.showProcessingState();
        } else {
            this.ui.showProcessingState();
        }

        // Disable interactions consistently (mirror Events module behavior)
        try {
            if (this.events && typeof this.events._disableWordInteractions === 'function') {
                this.events._disableWordInteractions();
            }
            // Ensure original subtitles visually reflect disabled state
            try {
                const original = document.getElementById('dualsub-original-subtitle');
                if (original) original.classList.add('dualsub-subtitles-disabled');
            } catch (_) {}
            // Force-hide remove buttons immediately for robustness
            try {
                const selected = document.getElementById('dualsub-selected-words');
                selected?.querySelectorAll('.dualsub-word-remove').forEach((el) => { el.style.display = 'none'; });
            } catch (_) {}
        } catch (_) {}

        // Freeze selection persistence and suppress immediate restorations
        try { this.core.selectionPersistence.lastManualSelectionTs = Date.now(); } catch (_) {}

        // Ensure UI reflects disabled removal (hide X icons) and keep highlights visible
        try { this.ui.updateSelectionDisplay(); } catch (_) {}
        try { this.core.syncSelectionHighlights(); } catch (_) {}

        // Switch button to pause state
        try {
            const scope = this.core.contentElement || document;
            const btn = scope.querySelector('#dualsub-start-analysis');
            if (btn) {
                btn.textContent = this._getLocalizedMessage('aiContextPauseAnalysis');
                btn.className = 'dualsub-analysis-button processing';
                btn.title = this._getLocalizedMessage('aiContextPauseAnalysisTitle');
                btn.disabled = false;
                btn.setAttribute('data-paused-toggle', 'true');
                const newButton = btn.cloneNode(true);
                btn.parentNode.replaceChild(newButton, btn);
                newButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.pauseAnalysis();
                });
            }
        } catch (_) {}

        // Resolve language prefs
        let targetLanguage = 'en';
        let sourceLanguage = 'auto';
        try {
            const cfg = this.core.contentScript?.configService || window.configService;
            if (cfg && typeof cfg.getMultiple === 'function') {
                const prefs = await cfg.getMultiple(['targetLanguage', 'originalLanguage']);
                if (prefs?.targetLanguage) targetLanguage = prefs.targetLanguage;
                if (prefs?.originalLanguage) sourceLanguage = prefs.originalLanguage;
            } else if (chrome?.storage?.sync) {
                const result = await chrome.storage.sync.get(['targetLanguage', 'originalLanguage']);
                if (result.targetLanguage) targetLanguage = result.targetLanguage;
                if (result.originalLanguage) sourceLanguage = result.originalLanguage;
            }
        } catch (_) {}

        // Dispatch analysis request
        const requestId = `analysis-${Date.now()}`;
        this.core.currentRequest = requestId;

        document.dispatchEvent(
            new CustomEvent('dualsub-analyze-selection', {
                detail: {
                    requestId,
                    text: this.core.selectedText,
                    contextTypes: ['cultural', 'historical', 'linguistic'],
                    language: sourceLanguage,
                    targetLanguage: targetLanguage,
                    selection: {
                        text: this.core.selectedText,
                        words: Array.from(this.core.selectedWords),
                    },
                },
            })
        );

        this.core._log('info', 'Context analysis started (controller)', {
            text: this.core.selectedText,
            selectedWordsCount: this.core.selectedWords.size,
            requestId,
        });
    }

    pauseAnalysis() {
        // Emit pause intent so the manager can cancel the in-flight provider request
        try {
            document.dispatchEvent(new CustomEvent('aicontext:analysis:pause', {
                detail: { requestId: this.core.currentRequest }
            }));
        } catch (_) {}

        this.core.isAnalyzing = false;
        this.core.currentRequest = null;
        this.core.currentMode = 'selection';
        // Re-enable interactions
        try {
            const selectedWordsElement = document.getElementById('dualsub-selected-words');
            selectedWordsElement?.classList.remove('dualsub-processing-disabled');
        } catch (_) {}
        // Reset state back to selection
        this.core.setState(MODAL_STATES.SELECTION);
        this.ui.showInitialState();
        try { this.ui.updateSelectionDisplay(); } catch (_) {}
        // Ensure processing classes cleared
        try {
            const content = this.core.contentElement || document.getElementById('dualsub-modal-content');
            content?.classList.remove('is-analyzing', 'dualsub-processing-active', 'dualsub-processing-sticky');
            if (this.core.element) this.core.element.classList.remove('dualsub-processing-disabled');
            // Remove disabled class from subtitles
            try {
                const original = document.getElementById('dualsub-original-subtitle');
                if (original) original.classList.remove('dualsub-subtitles-disabled');
            } catch (_) {}
            // Ensure chips show remove buttons again after unfreezing
            try {
                const selected = document.getElementById('dualsub-selected-words');
                selected?.querySelectorAll('.dualsub-word-remove').forEach((el) => { el.style.removeProperty('display'); });
            } catch (_) {}
        } catch (_) {}
        // Reset Start button
        this.resetAnalysisButton();
    }

    newAnalysis() {
        // Do not clear selection automatically when starting a new analysis session UI-wise.
        // Keep selection until user explicitly removes or closes the modal.
        // this.core.clearSelection();
        this.core.analysisResult = null;
        this.core.setState(MODAL_STATES.SELECTION);
        this.ui.showInitialState();
        this.ui.updateSelectionDisplay();
    }

    closeModal() {
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
        try { this.ui.updateSelectionDisplay(); } catch (_) {}
        // Clear visual highlights on subtitles when closing
        try {
            const original = document.getElementById('dualsub-original-subtitle');
            if (original) {
                original.querySelectorAll('.dualsub-interactive-word.dualsub-word-selected')
                    .forEach((el) => el.classList.remove('dualsub-word-selected'));
            }
        } catch (_) {}
        // Hide modal via animations if available
        if (this.animations && typeof this.animations.hideModal === 'function') {
            this.animations.hideModal();
        } else {
            this.core.setState(MODAL_STATES.HIDDEN);
        }
    }

    onAnalysisResult(detail) {
        const { requestId, result, success, error, shouldRetry } = detail || {};

        this.core._log('debug', 'Controller received analysis result', {
            requestId,
            expectedId: this.core.currentRequest,
            success,
            hasResult: !!result,
            hasError: !!error,
        });

        // If there's no currentRequest (paused/cancelled) or IDs don't match, ignore this result
        if (!this.core.currentRequest || (requestId && this.core.currentRequest && requestId !== this.core.currentRequest)) {
            this.core._log('debug', 'Ignoring result - request ID mismatch (controller)', {
                receivedId: requestId,
                expectedId: this.core.currentRequest,
            });
            return;
        }

        if (success && result) {
            // Store raw result for observability
            try { this.core.setAnalysisResult(result); } catch (_) {}

            const html = this._buildResultsHtml(result);
            if (this.animations && typeof this.animations.showResultsState === 'function') {
                this.animations.showResultsState(html);
            } else {
                this.core.setState(MODAL_STATES.DISPLAY);
                this.ui.showAnalysisResults(html);
            }
            // Re-enable interactions and reset button to Start
            try {
                const selectedWordsElement = document.getElementById('dualsub-selected-words');
                if (selectedWordsElement) {
                    selectedWordsElement.classList.remove('dualsub-processing-disabled');
                }
            } catch (_) {}
            try { this.ui.updateSelectionDisplay(); } catch (_) {}
            // Re-enable subtitles interaction visuals
            try {
                const original = document.getElementById('dualsub-original-subtitle');
                if (original) original.classList.remove('dualsub-subtitles-disabled');
            } catch (_) {}
            // Ensure chips show remove buttons again after results
            try {
                const selected = document.getElementById('dualsub-selected-words');
                selected?.querySelectorAll('.dualsub-word-remove').forEach((el) => { el.style.removeProperty('display'); });
            } catch (_) {}
            this.resetAnalysisButton();
            return;
        }

        if (shouldRetry) {
            this._handleInvalidAnalysisResponse(requestId, result, error || 'Invalid analysis result');
            return;
        }

        // Final error
        const errorMessage = (typeof error === 'string') ? error : (error?.message || 'Unknown error');
        if (this.animations && typeof this.animations.showErrorState === 'function') {
            this.animations.showErrorState(errorMessage, { requestId });
        } else {
            this.core.setState(MODAL_STATES.ERROR);
            this.ui.showErrorState(errorMessage, { requestId });
        }
    }

    resetAnalysisButton() {
        const scope = this.core.contentElement || document;
        const analysisButton = scope.querySelector('#dualsub-start-analysis') || document.getElementById('dualsub-start-analysis');
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
            this.startAnalysis();
        };
        newButton.addEventListener('click', startHandler);
    }

    _buildResultsHtml(result) {
        let html = '';
        if (result.analysis) {
            if (result.isStructured && typeof result.analysis === 'object') {
                html += this._formatStructuredAnalysis(result.analysis, result.contextType);
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
        if (contextType === 'cultural' || contextType === 'all') html += this._formatCulturalSection(analysis);
        if (contextType === 'historical' || contextType === 'all') html += this._formatHistoricalSection(analysis);
        if (contextType === 'linguistic' || contextType === 'all') html += this._formatLinguisticSection(analysis);
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
        if (typeof content === 'string') return this._formatAnalysisText(content);
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
            return html || this._formatAnalysisText(JSON.stringify(content, null, 2));
        }
        return '';
    }

    _formatCulturalSection(analysis) {
        let html = '';
        const cultural = analysis.cultural_context || analysis.cultural_analysis;
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
        const historical = analysis.historical_context || analysis.historical_analysis;
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
        } catch (_) { return type; }
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
            historicalsignificance: 'aiContextHistoricalSignificance',
            evolution: 'aiContextEvolution',
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
            learningtips: 'aiContextLearningTips',
            learning: 'aiContextLearningTips',
            tips: 'aiContextLearningTips',
            relatedexpressions: 'aiContextRelatedExpressions',
            related: 'aiContextRelatedExpressions',
            expressions: 'aiContextRelatedExpressions',
            keyinsights: 'aiContextKeyInsights',
            insights: 'aiContextKeyInsights',
            key: 'aiContextKeyInsights',
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
                .toUpperCase() + String(fieldName || '').slice(1).replace(/_/g, ' ') + ':'
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
            if (match.includes('<li>1.') || /\d+\./.test(match)) return `<ol>${match}</ol>`;
            return `<ul>${match}</ul>`;
        });
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
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
        try { return this.ui._getLocalizedMessage(key); } catch (_) { return key; }
    }

    _handleInvalidAnalysisResponse(requestId, result, error) {
        this.core._log('warn', 'Invalid analysis response detected (controller)', {
            requestId,
            error,
        });

        if (typeof this.core.prepareRetry === 'function' && this.core.canRetryAnalysis()) {
            this.core.prepareRetry({ requestId, text: this.core.selectedText }, error);

            // Notify user and update processing text if possible
            try {
                const notification = document.getElementById('dualsub-retry-notification');
                if (notification) notification.textContent = this._getLocalizedMessage('aiContextRetryNotification') || 'Analysis failed, retrying...';
            } catch (_) {}

            const newRequestId = `analysis-${Date.now()}`;
            this.core.currentRequest = newRequestId;
            document.dispatchEvent(new CustomEvent('dualsub-analyze-selection', {
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
            }));
            return;
        }

        // Exhausted retries; show error
        const err = typeof error === 'string' ? error : (error?.message || 'Invalid analysis result');
        if (this.animations && typeof this.animations.showErrorState === 'function') {
            this.animations.showErrorState(err, { requestId });
        } else {
            this.core.setState(MODAL_STATES.ERROR);
            this.ui.showErrorState(err, { requestId });
        }
    }
}


