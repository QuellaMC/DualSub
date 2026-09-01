import { AI_CONTEXT_CONFIG, EVENT_TYPES } from './constants.js';
import { AIContextModal } from '../ui/modal.js';
import { AIContextProvider } from '../providers/AIContextProvider.js';
import { PrivateAnalysisController } from './PrivateAnalysisController.js';
import Logger from '../../../utils/logger.js';

const SUPPORTED_FEATURES = new Set([
    AI_CONTEXT_CONFIG.FEATURES.INTERACTIVE_SUBTITLES,
    AI_CONTEXT_CONFIG.FEATURES.CONTEXT_MODAL,
]);

export class AIContextManager {
    constructor(platform, config = {}) {
        const { analysisAuthority = null, ...publicConfig } = config || {};
        this.platform = platform;
        this.config = { ...AI_CONTEXT_CONFIG, ...publicConfig };
        this.contentScript = publicConfig.contentScript || null;
        this.logger =
            this.contentScript?.contentLogger ||
            Logger.create('AIContextManager');

        this.modal = null;
        this.provider = null;
        this.textHandler = null;
        this.initialized = false;
        this.destroyed = false;
        this.activeRequest = null;
        this.enabledFeatures = new Set();
        this.metrics = {
            initializationTime: null,
            analysisCount: 0,
            errorCount: 0,
            lastActivity: null,
        };

        this._analysis = new PrivateAnalysisController(this, analysisAuthority);
        this._initializePromise = null;
        this._destroyPromise = null;
    }

    initialize() {
        if (this.destroyed) return Promise.resolve(false);
        if (!this._initializePromise) {
            this._initializePromise = this._performInitialize();
        }
        return this._initializePromise;
    }

    async _performInitialize() {
        const startedAt = performance.now();
        try {
            if (!AI_CONTEXT_CONFIG.PLATFORMS[this.platform?.toUpperCase()]) {
                throw new Error(`Platform '${this.platform}' is not supported`);
            }
            if (!this._analysis.start()) {
                throw new Error('Private analysis authority is invalid');
            }

            const modal = new AIContextModal({
                ...this.config.modal,
                contentScript: this.contentScript,
                analysisCapabilities: this._analysis.createModalCapabilities(),
                onSelectionRestored: () => this._analysis.reapplySelection(),
            });
            this.modal = modal;
            modal.setLogger(this.logger);
            await modal.initialize();
            if (this.destroyed) return false;

            const provider = new AIContextProvider(this.config.provider || {});
            this.provider = provider;
            if ((await provider.initialize()) !== true || this.destroyed) {
                throw new Error('AI Context Provider failed to initialize');
            }

            this._analysis.reapplySelection();
            this.enabledFeatures.add(AI_CONTEXT_CONFIG.FEATURES.CONTEXT_MODAL);
            this.initialized = true;
            this.metrics.initializationTime = performance.now() - startedAt;
            this._dispatchEvent(EVENT_TYPES.SYSTEM_INITIALIZED, {
                platform: this.platform,
                features: this.getEnabledFeatures(),
                initTime: this.metrics.initializationTime,
            });
            return true;
        } catch (error) {
            if (!this.destroyed) {
                this.metrics.errorCount += 1;
                this._log('error', 'AI Context initialization failed', {
                    error: error?.message,
                });
                this._dispatchEvent(EVENT_TYPES.SYSTEM_ERROR, {
                    error: error?.message,
                    context: 'initialization',
                    timestamp: Date.now(),
                });
                await this.destroy();
            }
            return false;
        }
    }

    async enableFeature(feature) {
        if (this.destroyed || !SUPPORTED_FEATURES.has(feature)) return false;
        if (
            feature === AI_CONTEXT_CONFIG.FEATURES.CONTEXT_MODAL &&
            !this.modal
        ) {
            return false;
        }
        this.enabledFeatures.add(feature);
        return true;
    }

    getEnabledFeatures() {
        return [...this.enabledFeatures];
    }

    getModal() {
        return this.modal;
    }

    getProvider() {
        return this.provider;
    }

    getTextHandler() {
        return null;
    }

    destroy() {
        if (this._destroyPromise) return this._destroyPromise;

        this.destroyed = true;
        this.initialized = false;
        this._analysis.stop();

        const components = [...new Set([this.modal, this.provider])].filter(
            Boolean
        );
        this.modal = null;
        this.provider = null;
        this.textHandler = null;
        this.activeRequest = null;
        this.enabledFeatures.clear();
        this.contentScript = null;
        this.config = null;

        this._destroyPromise = Promise.allSettled(
            components.map((component) => {
                try {
                    return component.destroy?.();
                } catch (error) {
                    return Promise.reject(error);
                }
            })
        ).then((results) => {
            const failures = results.filter(
                ({ status }) => status === 'rejected'
            ).length;
            this._log(
                failures ? 'error' : 'info',
                failures
                    ? 'AI Context cleanup completed with failures'
                    : 'AI Context Manager destroyed',
                failures ? { failures } : {}
            );
            this.logger = null;
        });
        return this._destroyPromise;
    }

    _dispatchEvent(type, detail) {
        if (!this.destroyed) {
            document.dispatchEvent(new CustomEvent(type, { detail }));
        }
    }

    _log(level, message, data = {}) {
        const method = this.logger?.[level];
        if (typeof method === 'function') {
            method.call(this.logger, message, {
                component: 'AIContextManager',
                platform: this.platform,
                ...data,
            });
        }
    }
}
