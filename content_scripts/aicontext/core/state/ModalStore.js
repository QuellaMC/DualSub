import { MODAL_STATES } from '../constants.js';

/**
 * ModalStore - Observable store for modal UI state
 *
 * Holds visibility, modal state, mode, analyzing flag, requestId and analysisResult.
 * Notifies subscribers on changes. Pure data container (no DOM access).
 */
export class ModalStore {
    constructor(initial = {}) {
        this._state = {
            isVisible: false,
            modalState: MODAL_STATES.HIDDEN,
            mode: null,
            analyzing: false,
            requestId: null,
            analysisResult: null,
            ...initial,
        };
        this._subscribers = new Set();
    }

    getState() {
        return { ...this._state };
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this._subscribers.add(listener);
        // Immediately invoke with current state to initialize listeners
        try {
            listener(this.getState());
        } catch (_) {}
        return () => {
            this._subscribers.delete(listener);
        };
    }

    set(partial) {
        const next = { ...this._state, ...partial };
        try {
            const same = JSON.stringify(next) === JSON.stringify(this._state);
            if (same) return;
        } catch (_) {}
        this._state = next;
        this._notify();
    }

    setState(modalState) {
        this.set({ modalState });
    }

    setVisibility(isVisible) {
        this.set({ isVisible });
    }

    setAnalyzing(analyzing) {
        this.set({ analyzing });
    }

    setMode(mode) {
        this.set({ mode });
    }

    setRequestId(requestId) {
        this.set({ requestId });
    }

    setAnalysisResult(analysisResult) {
        this.set({ analysisResult });
    }

    _notify() {
        const snapshot = this.getState();
        for (const subscriber of this._subscribers) {
            try {
                subscriber(snapshot);
            } catch (_) {}
        }
    }
}


