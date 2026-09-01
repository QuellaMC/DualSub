export class AIContextModalEvents {
    constructor(core, ui, animations = null) {
        this.core = core;
        this.ui = ui;
        this.animations = animations;
        this.modalController = null;
        this.boundHandlers = new Map();
        this._destroyed = false;
    }

    _releaseBoundEvent(key) {
        const record = this.boundHandlers.get(key);
        if (!record) return false;

        this.boundHandlers.delete(key);
        record.active = false;
        try {
            record.element.removeEventListener(
                record.eventType,
                record.handler,
                record.options
            );
            return true;
        } catch (_) {
            return false;
        }
    }

    _bindEvent(key, element, eventType, handler, options = undefined) {
        if (this._destroyed || !element || typeof handler !== 'function') {
            return null;
        }

        this._releaseBoundEvent(key);
        const record = {
            element,
            eventType,
            options,
            active: true,
            handler: null,
        };
        record.handler = (...args) => {
            if (this._destroyed || !record.active) return undefined;
            return handler(...args);
        };

        this.boundHandlers.set(key, record);
        try {
            element.addEventListener(eventType, record.handler, options);
        } catch (error) {
            this.boundHandlers.delete(key);
            record.active = false;
            throw error;
        }
        return record.handler;
    }

    async setupEventListeners() {
        if (this._destroyed || !this.core?.element) {
            if (!this._destroyed) throw new Error('Modal element not created');
            return;
        }

        this._setupModalControlEvents();
        this._setupAnalysisEvents();
        this._setupKeyboardEvents();
    }

    _setupModalControlEvents() {
        const closeButton =
            this.core.contentElement?.querySelector('#dualsub-modal-close') ||
            this.core.element.querySelector('#dualsub-modal-close');
        if (closeButton) {
            this._bindEvent('close-click', closeButton, 'click', (event) =>
                this._requestModalClose(event)
            );
        }

        this._bindEvent('overlay-click', this.core.element, 'click', (event) =>
            this._handleOverlayClick(event)
        );
        this._bindEvent(
            'overlay-mousedown',
            this.core.element,
            'mousedown',
            (event) => event.stopPropagation()
        );
        this._bindEvent(
            'global-click',
            document,
            'click',
            (event) => this._handleGlobalClick(event),
            true
        );
    }

    _setupAnalysisEvents() {
        const scope = this.core.contentElement || this.core.element;
        const startButton = scope.querySelector('#dualsub-start-analysis');
        if (startButton) {
            this._bindEvent('start-analysis', startButton, 'click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this.core?.isAnalyzing) {
                    return this.modalController?.pauseAnalysisFromDomEvent(
                        event
                    );
                }
                return this.modalController?.startAnalysisFromDomEvent(event);
            });
        }

        const pauseButton = scope.querySelector('#dualsub-pause-analysis');
        if (pauseButton) {
            this._bindEvent('pause-analysis', pauseButton, 'click', (event) =>
                this.modalController?.pauseAnalysisFromDomEvent(event)
            );
        }

        const newButton = scope.querySelector('#dualsub-new-analysis');
        if (newButton) {
            this._bindEvent('new-analysis', newButton, 'click', (event) =>
                this.modalController?.newAnalysisFromDomEvent(event)
            );
        }
    }

    _setupKeyboardEvents() {
        this._bindEvent('keydown', document, 'keydown', (event) =>
            this._handleKeyPress(event)
        );
    }

    _requestModalClose(event = null) {
        return this.modalController?.closeModalFromDomEvent(event) ?? false;
    }

    _handleOverlayClick(event) {
        event.stopPropagation();
        event.preventDefault();
        if (
            event.target === this.core?.element ||
            event.target?.classList?.contains('dualsub-modal-overlay')
        ) {
            return this._requestModalClose(event);
        }
        return false;
    }

    _handleGlobalClick(event) {
        if (!this.core?.isVisible) return;

        const modalContent =
            this.core.contentElement ||
            this.core.element?.querySelector('.dualsub-modal-content');
        if (
            modalContent?.contains(event.target) ||
            event.target?.classList?.contains('dualsub-interactive-word')
        ) {
            return;
        }

        event.stopPropagation();
        event.preventDefault();
    }

    _handleKeyPress(event) {
        if (!this.core?.isVisible || event?.isTrusted !== true) return false;

        if (event.key === 'Escape') {
            event.preventDefault();
            return this._requestModalClose(event);
        }
        if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            this.core.selectedWords.size > 0 &&
            !this.core.isAnalyzing
        ) {
            event.preventDefault();
            return this.modalController?.startAnalysisFromDomEvent(event);
        }
        return false;
    }

    removeEventListeners() {
        if (this._destroyed) return;
        this._destroyed = true;

        const records = [...this.boundHandlers.values()];
        this.boundHandlers.clear();
        for (const record of records) record.active = false;
        for (const record of records) {
            try {
                record.element.removeEventListener(
                    record.eventType,
                    record.handler,
                    record.options
                );
            } catch (_) {}
        }

        this.modalController = null;
        this.animations = null;
        this.ui = null;
        this.core = null;
    }
}
