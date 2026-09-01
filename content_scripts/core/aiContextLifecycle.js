import { createAIContextChannel } from '../aicontext/core/AIContextChannel.js';
import { validateSetting } from '../../config/configSchema.js';

export const AI_CONTEXT_CONFIGURATION_KEYS = Object.freeze([
    'aiContextEnabled',
    'aiContextProvider',
    'aiContextTypes',
    'aiContextTimeout',
    'aiContextRetryAttempts',
]);

export const AI_CONTEXT_LIFECYCLE_CONFIG_KEYS = new Set([
    ...AI_CONTEXT_CONFIGURATION_KEYS,
    'aiContextRateLimit',
    'aiContextBurstLimit',
    'aiContextMandatoryDelay',
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
    'geminiApiKey',
    'geminiModel',
]);

export function logAIContextLifecycleFailure(contentScript, level, message) {
    try {
        contentScript.logWithFallback(level, message);
    } catch {}
}

function setInteractionsEnabled(contentScript, enabled) {
    try {
        contentScript.subtitleUtils?.setInteractiveSubtitlesEnabled?.(enabled);
        return true;
    } catch {
        logAIContextLifecycleFailure(
            contentScript,
            'warn',
            'AI interaction state update failed'
        );
        return false;
    }
}

class AIContextFeatureOwner {
    constructor(lifecycle, generation) {
        this.lifecycle = lifecycle;
        this.contentScript = lifecycle.contentScript;
        this.generation = generation;
        this.channel = createAIContextChannel({
            lifecycleGeneration: generation,
        });
        this.active = true;
        this.drained = false;
        this.cleanups = [];
        this.cleanupPromise = null;
        this.eventListenersAttached = false;
        this.fullscreenListenerAttached = false;
        this.interactiveCleanupAttached = false;
    }

    addCleanup(cleanup) {
        if (typeof cleanup !== 'function') return;
        if (this.active) {
            this.cleanups.push(cleanup);
            return;
        }
        this.lifecycle.trackCleanup(this.lifecycle.runCleanup(cleanup));
    }

    drain() {
        if (this.cleanupPromise) return this.cleanupPromise;
        this.active = false;
        this.drained = true;
        try {
            this.channel.destroy();
        } catch {
            logAIContextLifecycleFailure(
                this.contentScript,
                'warn',
                'AI context channel destruction failed'
            );
        }
        const cleanups = this.cleanups
            .splice(0)
            .map((cleanup) => this.lifecycle.runCleanup(cleanup));
        this.cleanupPromise = Promise.allSettled(cleanups).then(
            () => undefined
        );
        return this.cleanupPromise;
    }
}

class AIContextLifecycle {
    constructor(contentScript) {
        this.contentScript = contentScript;
        this.generation = 0;
        this.activeGeneration = null;
        this.terminal = false;
        this.terminalCleanupPromise = null;
        this.pendingCleanups = new Set();
        this.candidateCleanups = new Map();
        this.owner = new AIContextFeatureOwner(this, 0);
    }

    isCurrent(owner) {
        return (
            !this.terminal &&
            owner instanceof AIContextFeatureOwner &&
            owner.lifecycle === this &&
            owner.active &&
            this.owner === owner &&
            owner.generation === this.generation
        );
    }

    runCleanup(cleanup) {
        return Promise.resolve()
            .then(cleanup)
            .catch(() => {
                logAIContextLifecycleFailure(
                    this.contentScript,
                    'warn',
                    'AI feature cleanup failed'
                );
            });
    }

    trackCleanup(promise) {
        const tracked = Promise.resolve(promise).finally(() => {
            this.pendingCleanups.delete(tracked);
        });
        this.pendingCleanups.add(tracked);
        return tracked;
    }

    detachCandidate(candidate) {
        if (this.contentScript.aiContextManager === candidate) {
            this.contentScript.aiContextManager = null;
        }
        if (this.contentScript.sidePanelIntegration === candidate) {
            this.contentScript.sidePanelIntegration = null;
        }
    }

    cleanupCandidate(candidate, level, message) {
        if (
            !candidate ||
            (typeof candidate !== 'object' && typeof candidate !== 'function')
        ) {
            return Promise.resolve();
        }
        const existing = this.candidateCleanups.get(candidate);
        if (existing) {
            this.detachCandidate(candidate);
            return existing;
        }

        let resolveCleanup;
        const cleanupPromise = new Promise((resolve) => {
            resolveCleanup = resolve;
        });
        this.candidateCleanups.set(candidate, cleanupPromise);
        this.detachCandidate(candidate);
        void Promise.resolve()
            .then(() => candidate.destroy?.())
            .catch(() => {
                logAIContextLifecycleFailure(
                    this.contentScript,
                    level,
                    message
                );
            })
            .finally(() => {
                this.detachCandidate(candidate);
                resolveCleanup();
            });
        return cleanupPromise;
    }

    transition(joinAllCleanups = false) {
        const previousOwner = this.owner;
        const manager = this.contentScript.aiContextManager;
        const sidePanel = this.contentScript.sidePanelIntegration;
        this.contentScript.aiContextManager = null;
        this.contentScript.sidePanelIntegration = null;
        this.activeGeneration = null;
        this.generation += 1;
        this.owner = new AIContextFeatureOwner(this, this.generation);

        setInteractionsEnabled(this.contentScript, false);
        const cleanup = Promise.allSettled([
            previousOwner.drain(),
            this.cleanupCandidate(
                manager,
                'error',
                'AI context manager destruction failed'
            ),
            this.cleanupCandidate(
                sidePanel,
                'warn',
                'Side panel integration destruction failed'
            ),
        ]).then(() => undefined);
        this.trackCleanup(cleanup);
        if (this.terminal) {
            this.owner.drain();
        }
        return {
            owner: this.owner,
            cleanupPromise: joinAllCleanups ? this.settle() : cleanup,
        };
    }

    async settle() {
        while (this.pendingCleanups.size > 0) {
            await Promise.allSettled([...this.pendingCleanups]);
        }
    }
}

export function initializeAIContextLifecycle(contentScript) {
    contentScript._aiContextLifecycle = new AIContextLifecycle(contentScript);
    contentScript.aiContextManager = null;
    contentScript.sidePanelIntegration = null;
}

export function getAIContextLifecycleState(contentScript) {
    return contentScript._aiContextLifecycle ?? null;
}

export function getAIContextFeatureOwnerState(owner) {
    return owner instanceof AIContextFeatureOwner ? owner : null;
}

export function isAIContextFeatureOwnerCurrent(contentScript, owner) {
    return getAIContextLifecycleState(contentScript)?.isCurrent(owner) ?? false;
}

export function registerAIContextFeatureCleanup(contentScript, owner, cleanup) {
    const ownerState = getAIContextFeatureOwnerState(owner);
    if (ownerState?.contentScript === contentScript) {
        ownerState.addCleanup(cleanup);
        return;
    }
    const lifecycle = getAIContextLifecycleState(contentScript);
    if (lifecycle && typeof cleanup === 'function') {
        lifecycle.trackCleanup(lifecycle.runCleanup(cleanup));
    }
}

export function beginAIContextFeatureLifecycle(
    contentScript,
    joinAllCleanups = false
) {
    const lifecycle = getAIContextLifecycleState(contentScript);
    if (!lifecycle) throw new Error('AI context lifecycle is unavailable');
    return lifecycle.transition(joinAllCleanups);
}

export function settleAllAIContextTaskGroups(contentScript) {
    return (
        getAIContextLifecycleState(contentScript)?.settle() ?? Promise.resolve()
    );
}

export function destroyAIContextManagerCandidate(contentScript, candidate) {
    return (
        getAIContextLifecycleState(contentScript)?.cleanupCandidate(
            candidate,
            'error',
            'AI context manager destruction failed'
        ) ?? Promise.resolve()
    );
}

export function destroySidePanelIntegrationCandidate(contentScript, candidate) {
    return (
        getAIContextLifecycleState(contentScript)?.cleanupCandidate(
            candidate,
            'warn',
            'Side panel integration destruction failed'
        ) ?? Promise.resolve()
    );
}

export function trackAIContextManagerCandidateFactory(
    contentScript,
    owner,
    candidatePromise
) {
    let setupPromise = Promise.resolve();
    let cleanupPromise = null;
    const lifecycle = getAIContextLifecycleState(contentScript);
    const requestCleanup = () => {
        if (!cleanupPromise) {
            cleanupPromise = Promise.resolve(candidatePromise).then(
                async (candidate) => {
                    await setupPromise.catch(() => undefined);
                    await destroyAIContextManagerCandidate(
                        contentScript,
                        candidate
                    );
                },
                () => undefined
            );
        }
        return cleanupPromise;
    };
    registerAIContextFeatureCleanup(contentScript, owner, requestCleanup);
    return {
        claimCandidate: (candidate) =>
            Boolean(
                candidate &&
                lifecycle?.isCurrent(owner) &&
                !lifecycle.candidateCleanups.has(candidate)
            ),
        requestCleanup,
        setSetupPromise: (promise) => {
            setupPromise = Promise.resolve(promise);
        },
    };
}

export function registerAIContextInteractiveCleanup(contentScript, owner) {
    const ownerState = getAIContextFeatureOwnerState(owner);
    if (
        !ownerState ||
        ownerState.contentScript !== contentScript ||
        ownerState.interactiveCleanupAttached
    ) {
        return;
    }
    ownerState.interactiveCleanupAttached = true;
    registerAIContextFeatureCleanup(contentScript, owner, () => {
        const lifecycle = getAIContextLifecycleState(contentScript);
        if (lifecycle?.activeGeneration === owner.generation) {
            lifecycle.activeGeneration = null;
        }
        if (
            lifecycle?.owner === owner ||
            lifecycle?.activeGeneration === null
        ) {
            setInteractionsEnabled(contentScript, false);
        }
    });
}

export function preventStaleAIContextInteractionCommit(contentScript, owner) {
    const lifecycle = getAIContextLifecycleState(contentScript);
    if (
        lifecycle &&
        lifecycle.owner !== owner &&
        lifecycle.activeGeneration !== lifecycle.owner?.generation
    ) {
        setInteractionsEnabled(contentScript, false);
    }
}

export function trackAIContextInteractiveInitialization(
    contentScript,
    owner,
    initializationPromise
) {
    let cleanupPromise;
    const waitForInitialization = () => {
        cleanupPromise ??= Promise.resolve(initializationPromise)
            .catch(() => undefined)
            .then(() =>
                preventStaleAIContextInteractionCommit(contentScript, owner)
            );
        return cleanupPromise;
    };
    registerAIContextFeatureCleanup(
        contentScript,
        owner,
        waitForInitialization
    );
    return waitForInitialization;
}

export function commitAIContextInteractionState(contentScript, owner) {
    const lifecycle = getAIContextLifecycleState(contentScript);
    if (!lifecycle?.isCurrent(owner)) return false;
    lifecycle.activeGeneration = owner.generation;
    setInteractionsEnabled(contentScript, true);
    return true;
}

function safeUnsubscribe(unsubscribe) {
    let active = true;
    return async () => {
        if (!active || typeof unsubscribe !== 'function') return false;
        active = false;
        try {
            await unsubscribe();
            return true;
        } catch {
            return false;
        }
    };
}

export function createAIContextHostFacade(contentScript) {
    const configService = Object.freeze({
        async get(key) {
            if (key !== 'uiLanguage') return undefined;
            try {
                const value = await contentScript.configService?.get?.(key);
                return typeof value === 'string' ? value : undefined;
            } catch {
                return undefined;
            }
        },
        async getMultiple(keys) {
            if (
                !Array.isArray(keys) ||
                keys.length !== 2 ||
                keys[0] !== 'targetLanguage' ||
                keys[1] !== 'originalLanguage'
            ) {
                return undefined;
            }
            try {
                const values =
                    await contentScript.configService?.getMultiple?.(keys);
                return Object.freeze({
                    ...(typeof values?.targetLanguage === 'string' && {
                        targetLanguage: values.targetLanguage,
                    }),
                    ...(typeof values?.originalLanguage === 'string' && {
                        originalLanguage: values.originalLanguage,
                    }),
                });
            } catch {
                return undefined;
            }
        },
        onChanged(callback) {
            if (typeof callback !== 'function') return safeUnsubscribe();
            try {
                const unsubscribe = contentScript.configService?.onChanged?.(
                    (changes) => {
                        if (typeof changes?.uiLanguage === 'string') {
                            return callback(
                                Object.freeze({
                                    uiLanguage: changes.uiLanguage,
                                })
                            );
                        }
                        return undefined;
                    }
                );
                return safeUnsubscribe(unsubscribe);
            } catch {
                return safeUnsubscribe();
            }
        },
    });

    return Object.freeze({
        contentLogger: contentScript.contentLogger,
        get configService() {
            return contentScript.configService ? configService : null;
        },
        get activePlatform() {
            const platform = contentScript.activePlatform;
            if (typeof platform?.pausePlayback !== 'function') return null;
            return Object.freeze({
                pausePlayback: async () => {
                    try {
                        return (await platform.pausePlayback()) === true;
                    } catch {
                        return false;
                    }
                },
            });
        },
    });
}

export function readExactOwnDataProjection(result, keys) {
    const values = result?.values;
    if (!values || typeof values !== 'object') return null;
    const projection = {};
    for (const key of keys) {
        if (!Object.hasOwn(values, key) || !validateSetting(key, values[key])) {
            return null;
        }
        projection[key] = values[key];
    }
    if (Object.keys(values).length !== keys.length) return null;
    projection.aiContextTypes = [...projection.aiContextTypes];
    return projection;
}

export { setInteractionsEnabled as setAIContextInteractionsEnabled };
