import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import {
    configService,
    isSensitiveAccessExplicitlyEnabled,
} from '../../services/configService.js';

const SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE =
    'Unable to validate loaded settings.';
const SETTINGS_RECONCILIATION_ERROR_MESSAGE =
    'Unable to confirm persisted settings after a storage update.';

function normalizeWatchedKeys(keys) {
    if (Array.isArray(keys)) {
        return keys;
    }
    return keys === null || keys === undefined ? null : [keys];
}

function requireStrictValues(result, requestedKeys, errorMessage) {
    const values = result?.values;
    if (values === null || typeof values !== 'object') {
        throw new TypeError(errorMessage);
    }

    if (
        requestedKeys &&
        requestedKeys.some((key) => !Object.hasOwn(values, key))
    ) {
        throw new TypeError(errorMessage);
    }

    return requestedKeys
        ? Object.fromEntries(requestedKeys.map((key) => [key, values[key]]))
        : { ...values };
}

function projectSettings(confirmedValues, pendingValues, watchedKeys) {
    const projected = {};
    const keys =
        watchedKeys ??
        new Set([...confirmedValues.keys(), ...pendingValues.keys()]);

    for (const key of keys) {
        const pending = pendingValues.get(key);
        if (pending) {
            projected[key] = pending.value;
            continue;
        }

        const confirmed = confirmedValues.get(key);
        if (confirmed) {
            projected[key] = confirmed.value;
        }
    }

    return projected;
}

/**
 * Keeps a projected settings snapshot synchronized with ConfigService.
 *
 * ConfigService is the persistence authority. This hook keeps only the latest
 * confirmed value for each key and a single optimistic overlay for each key.
 * Writes are serialized so a failed write can drop its overlay and reconcile
 * from storage without disturbing a newer user input.
 *
 * @param {string|string[]|null} keys Setting key(s) to watch, or null for all.
 * @param {{includeSensitive?: boolean}} options Projection options.
 * @returns {{settings: object, updateSetting: Function, updateSettings: Function, loading: boolean, initialLoadStatus: string, error: Error|null}}
 */
export function useSettings(keys, options = {}) {
    const includeSensitive = isSensitiveAccessExplicitlyEnabled(options);
    const serializedKeys = JSON.stringify(normalizeWatchedKeys(keys));
    const watchedKeys = JSON.parse(serializedKeys);
    const requestIdentity = `${includeSensitive ? 'sensitive' : 'public'}:${serializedKeys}`;

    const confirmedValuesRef = useRef(new Map());
    const pendingValuesRef = useRef(new Map());
    const reconciliationRef = useRef(new Map());
    const writeQueueRef = useRef(Promise.resolve());
    const revisionRef = useRef(0);
    const mountedRef = useRef(true);
    const scopeRef = useRef({
        generation: 0,
        includeSensitive,
    });
    const requestRef = useRef({
        identity: requestIdentity,
        includeSensitive,
        watchedKeys,
        subscriptionFailed: false,
        status: 'loading',
        token: {},
    });
    const errorKindRef = useRef(null);

    const [, setRenderRevision] = useState(0);
    const [loadState, setLoadState] = useState({
        identity: requestIdentity,
        status: 'loading',
    });
    const [error, setError] = useState(null);

    const forceRender = useCallback(() => {
        if (mountedRef.current) {
            setRenderRevision((revision) => revision + 1);
        }
    }, []);

    const nextRevision = useCallback(() => {
        revisionRef.current += 1;
        return revisionRef.current;
    }, []);

    const isCurrentScope = useCallback(
        (scope) =>
            mountedRef.current &&
            scope.generation === scopeRef.current.generation,
        []
    );

    const isCurrentRequest = useCallback(
        (request) =>
            mountedRef.current && request.token === requestRef.current.token,
        []
    );

    const replaceError = useCallback((kind, nextError) => {
        if (!mountedRef.current) {
            return;
        }
        errorKindRef.current = kind;
        setError(nextError);
    }, []);

    const publishWriteError = useCallback(
        (nextError) => {
            if (requestRef.current.status !== 'unavailable') {
                replaceError('write', nextError);
            }
        },
        [replaceError]
    );

    const syncReconciliationError = useCallback(() => {
        if (
            requestRef.current.status !== 'ready' ||
            ['load', 'write'].includes(errorKindRef.current)
        ) {
            return;
        }

        const hasFailure = [...reconciliationRef.current.values()].some(
            ({ failed }) => failed
        );
        if (hasFailure && errorKindRef.current !== 'reconciliation') {
            replaceError(
                'reconciliation',
                new Error(SETTINGS_RECONCILIATION_ERROR_MESSAGE)
            );
        } else if (!hasFailure && errorKindRef.current === 'reconciliation') {
            replaceError(null, null);
        }
    }, [replaceError]);

    const markReconciliationFailure = useCallback(
        (keysToMark, revision) => {
            for (const key of keysToMark) {
                const entry = reconciliationRef.current.get(key);
                if (entry?.revision === revision) {
                    reconciliationRef.current.set(key, {
                        revision,
                        failed: true,
                    });
                }
            }
            syncReconciliationError();
        },
        [syncReconciliationError]
    );

    const resolveReconciliation = useCallback(
        (confirmedKeys, proofRevision) => {
            for (const key of confirmedKeys) {
                const entry = reconciliationRef.current.get(key);
                if (entry && entry.revision <= proofRevision) {
                    reconciliationRef.current.delete(key);
                }
            }
            syncReconciliationError();
        },
        [syncReconciliationError]
    );

    const clearAfterWriteSuccess = useCallback(
        (updatedKeys, revision) => {
            resolveReconciliation(updatedKeys, revision);
            if (
                requestRef.current.status === 'ready' &&
                errorKindRef.current === 'write'
            ) {
                replaceError(null, null);
                syncReconciliationError();
            }
        },
        [replaceError, resolveReconciliation, syncReconciliationError]
    );

    const commitConfirmedValues = useCallback(
        (values, revision, scope, source, protectedKeys = new Set()) => {
            if (!isCurrentScope(scope)) {
                return [];
            }

            const committedKeys = [];
            for (const [key, value] of Object.entries(values)) {
                if (
                    source !== 'write' &&
                    (protectedKeys.has(key) ||
                        pendingValuesRef.current.has(key))
                ) {
                    continue;
                }
                if (
                    source === 'event' &&
                    reconciliationRef.current.get(key)?.revision !== revision
                ) {
                    continue;
                }

                const current = confirmedValuesRef.current.get(key);
                if (current && current.revision > revision) {
                    continue;
                }

                confirmedValuesRef.current.set(key, { value, revision });
                committedKeys.push(key);
            }

            if (committedKeys.length > 0) {
                forceRender();
            }
            return committedKeys;
        },
        [forceRender, isCurrentScope]
    );

    const readAndCommit = useCallback(
        async (
            requestedKeys,
            revision,
            scope,
            {
                request = null,
                errorMessage = SETTINGS_RECONCILIATION_ERROR_MESSAGE,
                source = 'read',
            } = {}
        ) => {
            const protectedKeys = new Set(pendingValuesRef.current.keys());
            try {
                const readResult = requestedKeys
                    ? await configService.readMultipleResultStrict(
                          requestedKeys,
                          { includeSensitive: scope.includeSensitive }
                      )
                    : await configService.readAllResultStrict({
                          includeSensitive: scope.includeSensitive,
                      });
                const values = requireStrictValues(
                    readResult,
                    requestedKeys,
                    errorMessage
                );

                if (
                    !isCurrentScope(scope) ||
                    (request && !isCurrentRequest(request))
                ) {
                    return { ok: false, stale: true };
                }

                const committedKeys = commitConfirmedValues(
                    values,
                    revision,
                    scope,
                    source,
                    protectedKeys
                );
                return { ok: true, committedKeys };
            } catch (readError) {
                if (
                    !isCurrentScope(scope) ||
                    (request && !isCurrentRequest(request))
                ) {
                    return { ok: false, stale: true };
                }
                return { ok: false, error: readError };
            }
        },
        [commitConfirmedValues, isCurrentRequest, isCurrentScope]
    );

    const enqueueWrite = useCallback((operation) => {
        const result = writeQueueRef.current.then(operation, operation);
        writeQueueRef.current = result.catch(() => undefined);
        return result;
    }, []);

    const stagePendingValues = useCallback(
        (updates, revision, settled) => {
            for (const [key, value] of Object.entries(updates)) {
                pendingValuesRef.current.set(key, {
                    revision,
                    settled,
                    value,
                });
            }
            forceRender();
        },
        [forceRender]
    );

    const clearPendingValues = useCallback(
        (updatedKeys, revision) => {
            let changed = false;
            for (const key of updatedKeys) {
                const pending = pendingValuesRef.current.get(key);
                if (pending?.revision === revision) {
                    pendingValuesRef.current.delete(key);
                    changed = true;
                }
            }
            if (changed) {
                forceRender();
            }
        },
        [forceRender]
    );

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useLayoutEffect(() => {
        if (requestRef.current.identity === requestIdentity) {
            return;
        }

        if (scopeRef.current.includeSensitive !== includeSensitive) {
            scopeRef.current = {
                generation: scopeRef.current.generation + 1,
                includeSensitive,
            };
            confirmedValuesRef.current.clear();
            pendingValuesRef.current.clear();
        }
        reconciliationRef.current.clear();

        requestRef.current = {
            identity: requestIdentity,
            includeSensitive,
            watchedKeys: JSON.parse(serializedKeys),
            subscriptionFailed: false,
            status: 'loading',
            token: {},
        };
        errorKindRef.current = null;
        setError(null);
        setLoadState({ identity: requestIdentity, status: 'loading' });
        forceRender();
    }, [forceRender, includeSensitive, requestIdentity, serializedKeys]);

    useEffect(() => {
        const request = requestRef.current;
        if (request.identity !== requestIdentity) {
            return undefined;
        }

        const scope = { ...scopeRef.current };
        const revision = nextRevision();
        let cancelled = false;

        void (async () => {
            const read = await readAndCommit(
                request.watchedKeys,
                revision,
                scope,
                {
                    request,
                    errorMessage: SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE,
                }
            );
            if (cancelled || read.stale || !isCurrentRequest(request)) {
                return;
            }
            if (request.subscriptionFailed) {
                return;
            }

            if (read.ok) {
                request.status = 'ready';
                if (errorKindRef.current !== 'write') {
                    replaceError(null, null);
                }
                setLoadState({ identity: requestIdentity, status: 'ready' });
                syncReconciliationError();
                return;
            }

            request.status = 'unavailable';
            replaceError(
                'load',
                read.error ?? new Error(SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE)
            );
            console.error('Settings initial load failed.');
            setLoadState({
                identity: requestIdentity,
                status: 'unavailable',
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [
        isCurrentRequest,
        nextRevision,
        readAndCommit,
        replaceError,
        requestIdentity,
        syncReconciliationError,
    ]);

    useEffect(() => {
        const request = requestRef.current;
        if (request.identity !== requestIdentity) {
            return undefined;
        }

        const scope = { ...scopeRef.current };
        let disposed = false;
        const handleChange = (changes) => {
            if (
                disposed ||
                request.status === 'unavailable' ||
                !isCurrentRequest(request)
            ) {
                return;
            }

            const changedKeys = Object.keys(changes).filter(
                (key) =>
                    !request.watchedKeys || request.watchedKeys.includes(key)
            );
            const keysToRead = changedKeys.filter((key) => {
                const pending = pendingValuesRef.current.get(key);
                const confirmed = confirmedValuesRef.current.get(key);
                return (
                    pending ||
                    !confirmed ||
                    !Object.is(confirmed.value, changes[key])
                );
            });
            if (keysToRead.length === 0) {
                return;
            }

            const revision = nextRevision();
            for (const key of keysToRead) {
                reconciliationRef.current.set(key, {
                    revision,
                    failed: false,
                });
            }

            const refreshKeys = async (refreshKeysForRevision) => {
                if (disposed || !isCurrentRequest(request)) {
                    return;
                }
                const currentKeys = refreshKeysForRevision.filter(
                    (key) =>
                        reconciliationRef.current.get(key)?.revision ===
                        revision
                );
                if (currentKeys.length === 0) {
                    return;
                }
                const read = await readAndCommit(currentKeys, revision, scope, {
                    request,
                    source: 'event',
                });
                if (disposed || read.stale || !isCurrentRequest(request)) {
                    return;
                }
                if (!read.ok) {
                    markReconciliationFailure(currentKeys, revision);
                    console.error('Settings reconciliation failed.');
                } else {
                    resolveReconciliation(read.committedKeys, revision);
                }
            };

            const immediateKeys = [];
            const deferredGroups = new Map();
            for (const key of [...new Set(keysToRead)]) {
                const settled = pendingValuesRef.current.get(key)?.settled;
                if (!settled) {
                    immediateKeys.push(key);
                    continue;
                }
                const deferredKeys = deferredGroups.get(settled) ?? [];
                deferredKeys.push(key);
                deferredGroups.set(settled, deferredKeys);
            }

            if (immediateKeys.length > 0) {
                void refreshKeys(immediateKeys);
            }
            for (const [settled, deferredKeys] of deferredGroups) {
                void settled.then(() => refreshKeys(deferredKeys));
            }
        };

        let unsubscribe;
        try {
            unsubscribe = configService.onChanged(handleChange, {
                includeSensitive: request.includeSensitive,
            });
        } catch {
            request.subscriptionFailed = true;
            request.status = 'unavailable';
            replaceError(
                'load',
                new Error(SETTINGS_RECONCILIATION_ERROR_MESSAGE)
            );
            setLoadState({
                identity: requestIdentity,
                status: 'unavailable',
            });
            console.error('Settings subscription failed.');
        }

        return () => {
            disposed = true;
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [
        isCurrentRequest,
        markReconciliationFailure,
        nextRevision,
        readAndCommit,
        replaceError,
        requestIdentity,
        resolveReconciliation,
    ]);

    const runWrite = useCallback(
        (updates, persist, failureMessage) => {
            const snapshot = Object.fromEntries(Object.entries(updates));
            const updatedKeys = Object.keys(snapshot);
            const revision = nextRevision();
            const scope = { ...scopeRef.current };
            let settleWrite;
            const settled = new Promise((resolve) => {
                settleWrite = resolve;
            });
            stagePendingValues(snapshot, revision, settled);

            const result = enqueueWrite(async () => {
                try {
                    const canonicalValues = await persist(snapshot);
                    const committedKeys = commitConfirmedValues(
                        canonicalValues,
                        revision,
                        scope,
                        'write'
                    );
                    clearPendingValues(updatedKeys, revision);
                    if (isCurrentScope(scope)) {
                        clearAfterWriteSuccess(committedKeys, revision);
                    }
                    return true;
                } catch (writeError) {
                    clearPendingValues(updatedKeys, revision);
                    if (isCurrentScope(scope)) {
                        publishWriteError(writeError);
                        void readAndCommit(updatedKeys, revision, scope).then(
                            (read) => {
                                if (read.ok) {
                                    resolveReconciliation(
                                        read.committedKeys,
                                        revision
                                    );
                                } else if (!read.stale) {
                                    console.error(
                                        'Settings reconciliation failed.'
                                    );
                                }
                            }
                        );
                    }
                    console.error(failureMessage);
                    throw writeError;
                }
            });
            void result.then(settleWrite, settleWrite);
            return result;
        },
        [
            clearAfterWriteSuccess,
            clearPendingValues,
            commitConfirmedValues,
            enqueueWrite,
            isCurrentScope,
            nextRevision,
            publishWriteError,
            readAndCommit,
            resolveReconciliation,
            stagePendingValues,
        ]
    );

    const updateSetting = useCallback(
        (key, value) =>
            runWrite(
                Object.fromEntries([[key, value]]),
                async (snapshot) => ({
                    [key]: await configService.set(key, snapshot[key]),
                }),
                'Settings update failed.'
            ),
        [runWrite]
    );

    const updateSettings = useCallback(
        (updates) =>
            runWrite(
                updates,
                (snapshot) => configService.setMultiple(snapshot),
                'Settings batch update failed.'
            ),
        [runWrite]
    );

    const initialLoadStatus =
        loadState.identity === requestIdentity ? loadState.status : 'loading';
    const renderMatchesScope =
        scopeRef.current.includeSensitive === includeSensitive;
    const settings =
        renderMatchesScope && initialLoadStatus !== 'unavailable'
            ? projectSettings(
                  confirmedValuesRef.current,
                  pendingValuesRef.current,
                  watchedKeys
              )
            : {};

    return {
        settings,
        updateSetting,
        updateSettings,
        loading: initialLoadStatus === 'loading',
        initialLoadStatus,
        error:
            renderMatchesScope && loadState.identity === requestIdentity
                ? error
                : null,
    };
}
