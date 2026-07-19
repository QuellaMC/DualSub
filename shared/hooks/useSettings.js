import {
    useState,
    useEffect,
    useLayoutEffect,
    useCallback,
    useRef,
} from 'react';
import {
    configService,
    isSensitiveAccessExplicitlyEnabled,
} from '../../services/configService.js';

const hasOwn = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);

const SETTINGS_RECONCILIATION_ERROR_MESSAGE =
    'Unable to confirm persisted settings after a storage update.';
const SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE =
    'Unable to validate loaded settings.';

function defineOwnSetting(settings, key, value) {
    Object.defineProperty(settings, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
    });
}

function createSettingsObject(entries = []) {
    const settings = {};
    for (const [key, value] of entries) {
        defineOwnSetting(settings, key, value);
    }
    return settings;
}

function copySettingsObject(settings) {
    return createSettingsObject(Object.entries(settings));
}

function collectCanonicalWriteProjection(writeResult, requestedKeys) {
    try {
        if (writeResult === undefined) {
            return null;
        }
        if (writeResult === null || typeof writeResult !== 'object') {
            return null;
        }
        const prototype = Object.getPrototypeOf(writeResult);
        if (prototype !== Object.prototype && prototype !== null) {
            return null;
        }

        const resultKeys = Object.keys(writeResult);
        if (
            resultKeys.length !== requestedKeys.length ||
            resultKeys.some((key) => !requestedKeys.includes(key))
        ) {
            return null;
        }

        const projection = createSettingsObject();
        for (const key of requestedKeys) {
            const descriptor = Object.getOwnPropertyDescriptor(
                writeResult,
                key
            );
            if (!descriptor || !hasOwn(descriptor, 'value')) {
                return null;
            }
            defineOwnSetting(projection, key, descriptor.value);
        }
        return projection;
    } catch {
        return null;
    }
}

function collectStrictReadbackValues(
    readResult,
    requestedKeys = null,
    errorMessage = SETTINGS_RECONCILIATION_ERROR_MESSAGE
) {
    try {
        if (
            readResult === null ||
            (typeof readResult !== 'object' && typeof readResult !== 'function')
        ) {
            throw new TypeError(errorMessage);
        }

        const valuesDescriptor = Object.getOwnPropertyDescriptor(
            readResult,
            'values'
        );
        if (!valuesDescriptor || !hasOwn(valuesDescriptor, 'value')) {
            throw new TypeError(errorMessage);
        }

        const persistedValues = valuesDescriptor.value;
        if (persistedValues === null || typeof persistedValues !== 'object') {
            throw new TypeError(errorMessage);
        }
        const valuesPrototype = Object.getPrototypeOf(persistedValues);
        if (valuesPrototype !== Object.prototype && valuesPrototype !== null) {
            throw new TypeError(errorMessage);
        }

        const relevantPersistedValues = createSettingsObject();
        const keysToCollect = requestedKeys ?? Object.keys(persistedValues);
        for (const key of keysToCollect) {
            const valueDescriptor = Object.getOwnPropertyDescriptor(
                persistedValues,
                key
            );
            if (!valueDescriptor || !hasOwn(valueDescriptor, 'value')) {
                throw new TypeError(errorMessage);
            }
            defineOwnSetting(
                relevantPersistedValues,
                key,
                valueDescriptor.value
            );
        }
        return relevantPersistedValues;
    } catch {
        throw new TypeError(errorMessage);
    }
}

function areSettingsValuesEqual(left, right, seenPairs = new WeakMap()) {
    if (Object.is(left, right)) {
        return true;
    }

    try {
        if (
            left === null ||
            right === null ||
            typeof left !== 'object' ||
            typeof right !== 'object' ||
            Array.isArray(left) !== Array.isArray(right)
        ) {
            return false;
        }

        const previouslyComparedRight = seenPairs.get(left);
        if (previouslyComparedRight) {
            return previouslyComparedRight === right;
        }
        seenPairs.set(left, right);

        if (Array.isArray(left)) {
            if (left.length !== right.length) {
                return false;
            }
        } else {
            const plainPrototypes = [Object.prototype, null];
            if (
                !plainPrototypes.includes(Object.getPrototypeOf(left)) ||
                !plainPrototypes.includes(Object.getPrototypeOf(right))
            ) {
                return false;
            }
        }

        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);
        if (leftKeys.length !== rightKeys.length) {
            return false;
        }

        for (const key of leftKeys) {
            if (!hasOwn(right, key)) {
                return false;
            }
            const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
            const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
            if (
                !leftDescriptor ||
                !rightDescriptor ||
                !hasOwn(leftDescriptor, 'value') ||
                !hasOwn(rightDescriptor, 'value') ||
                !areSettingsValuesEqual(
                    leftDescriptor.value,
                    rightDescriptor.value,
                    seenPairs
                )
            ) {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

function toWatchedKeys(requestedKeys) {
    if (Array.isArray(requestedKeys)) {
        return requestedKeys;
    }
    return requestedKeys === null || requestedKeys === undefined
        ? null
        : [requestedKeys];
}

function createRequestIdentity(serializedKeys, includeSensitive) {
    return `${includeSensitive ? 'sensitive' : 'public'}:${serializedKeys}`;
}

function readOwnDataValue(object, key) {
    if (
        object === null ||
        (typeof object !== 'object' && typeof object !== 'function')
    ) {
        return { found: false };
    }
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && hasOwn(descriptor, 'value')
        ? { found: true, value: descriptor.value }
        : { found: false };
}

function collectOperationKeys(operations) {
    const keys = new Set();
    if (!Array.isArray(operations)) {
        return keys;
    }

    const lengthResult = readOwnDataValue(operations, 'length');
    if (!lengthResult.found || !Number.isSafeInteger(lengthResult.value)) {
        return keys;
    }
    for (let index = 0; index < lengthResult.value; index += 1) {
        const operationResult = readOwnDataValue(operations, String(index));
        if (!operationResult.found) {
            continue;
        }
        const operationKeysResult = readOwnDataValue(
            operationResult.value,
            'keys'
        );
        const operationKeys = operationKeysResult.value;
        if (!operationKeysResult.found || !Array.isArray(operationKeys)) {
            continue;
        }
        const keysLengthResult = readOwnDataValue(operationKeys, 'length');
        if (
            !keysLengthResult.found ||
            !Number.isSafeInteger(keysLengthResult.value)
        ) {
            continue;
        }
        for (
            let keyIndex = 0;
            keyIndex < keysLengthResult.value;
            keyIndex += 1
        ) {
            const keyResult = readOwnDataValue(operationKeys, String(keyIndex));
            if (keyResult.found) {
                keys.add(keyResult.value);
            }
        }
    }
    return keys;
}

function getConfirmedSuccessfulKeys(error, updatedKeys) {
    try {
        const successfulResult = readOwnDataValue(error, 'successful');
        const failedResult = readOwnDataValue(error, 'failed');
        const validationErrorsResult = readOwnDataValue(
            error,
            'validationErrors'
        );
        const successfulKeys = collectOperationKeys(successfulResult.value);
        const failedKeys = collectOperationKeys(failedResult.value);
        const validationErrors = validationErrorsResult.value;

        if (validationErrorsResult.found && Array.isArray(validationErrors)) {
            const lengthResult = readOwnDataValue(validationErrors, 'length');
            if (
                !lengthResult.found ||
                !Number.isSafeInteger(lengthResult.value)
            ) {
                return [];
            }
            for (let index = 0; index < lengthResult.value; index += 1) {
                const validationErrorResult = readOwnDataValue(
                    validationErrors,
                    String(index)
                );
                if (!validationErrorResult.found) {
                    continue;
                }
                const keyResult = readOwnDataValue(
                    validationErrorResult.value,
                    'key'
                );
                if (keyResult.found && keyResult.value) {
                    failedKeys.add(keyResult.value);
                }
            }
        }

        return updatedKeys.filter(
            (key) => successfulKeys.has(key) && !failedKeys.has(key)
        );
    } catch {
        // Partial-success metadata is optional delegated data. A hostile proxy,
        // accessor, or malformed descriptor must fail closed without replacing
        // the original write rejection.
        return [];
    }
}

function shouldApplyAuthoritativeValue(currentValue, nextValue) {
    if (!currentValue) {
        return true;
    }

    // A load begun while a write was in flight may have captured pre-write
    // storage. Preserve it as a rollback base, but let that write's confirmed
    // success win regardless of which promise continuation runs first.
    if (
        nextValue.source === 'write' &&
        currentValue.source === 'load' &&
        currentValue.protectedWriteEpoch === nextValue.writeEpoch
    ) {
        return true;
    }
    if (
        nextValue.source === 'load' &&
        nextValue.protectedWriteEpoch !== undefined &&
        ['event', 'readback'].includes(currentValue.source) &&
        currentValue.revision > nextValue.protectedWriteEpoch
    ) {
        return false;
    }
    if (
        nextValue.source === 'load' &&
        currentValue.source === 'write' &&
        nextValue.protectedWriteEpoch === currentValue.writeEpoch
    ) {
        return false;
    }

    return currentValue.revision <= nextValue.revision;
}

/**
 * Hook for managing extension settings
 * @param {string|string[]} keys - Setting key(s) to watch
 * @returns {Object} Settings state and update function
 */
export function useSettings(keys, options = {}) {
    const includeSensitive = isSensitiveAccessExplicitlyEnabled(options);
    const serializedKeys = JSON.stringify(toWatchedKeys(keys));
    const requestIdentity = createRequestIdentity(
        serializedKeys,
        includeSensitive
    );
    const renderWatchedKeys = toWatchedKeys(JSON.parse(serializedKeys));
    const committedWatchedKeysRef = useRef(renderWatchedKeys);
    const committedRequestRef = useRef({
        identity: requestIdentity,
        includeSensitive,
        watchedKeys: renderWatchedKeys,
        token: {},
        authorityToken: {},
    });
    const [settings, setSettings] = useState(() => createSettingsObject());
    const [loadStatus, setLoadStatus] = useState(() => ({
        requestIdentity,
        status: 'loading',
    }));
    const [error, setError] = useState(null);
    const writeQueueRef = useRef(Promise.resolve());
    const pendingValuesRef = useRef(new Map());
    const authoritativeValuesRef = useRef(new Map());
    const activeWriteEpochsRef = useRef(new Map());
    const authorityRevisionRef = useRef(0);
    // Operation failures and event-reconciliation uncertainty have different
    // ownership rules. Keep them in separate ledgers, then derive the one
    // public error with operation failures taking precedence.
    const operationErrorRef = useRef(null);
    const latestSettledOperationRevisionRef = useRef(0);
    const reconciliationErrorRef = useRef(null);
    const unresolvedReconciliationKeysRef = useRef(new Map());
    const watchedKeyTokensRef = useRef(
        new Map((renderWatchedKeys ?? []).map((key) => [key, {}]))
    );
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const isKeyWatched = useCallback((key) => {
        const watchedKeys = committedWatchedKeysRef.current;
        return !watchedKeys || watchedKeys.includes(key);
    }, []);

    const nextAuthorityRevision = useCallback(() => {
        authorityRevisionRef.current += 1;
        return authorityRevisionRef.current;
    }, []);

    const enqueueWrite = useCallback((operation) => {
        const queuedWrite = writeQueueRef.current
            .catch(() => undefined)
            .then(operation);
        writeQueueRef.current = queuedWrite;
        return queuedWrite;
    }, []);

    const applyAuthoritativeValues = useCallback(
        (values, revision, source, options = {}) => {
            const authorityToken =
                options.authorityToken ??
                committedRequestRef.current.authorityToken;
            if (authorityToken !== committedRequestRef.current.authorityToken) {
                return;
            }
            for (const [key, value] of Object.entries(values)) {
                const nextValue = {
                    value,
                    revision,
                    source,
                    authorityToken,
                    writeEpoch: options.writeEpoch,
                    protectedWriteEpoch: options.protectedWriteEpochs?.get(key),
                };
                const currentValue = authoritativeValuesRef.current.get(key);
                if (shouldApplyAuthoritativeValue(currentValue, nextValue)) {
                    authoritativeValuesRef.current.set(key, nextValue);
                }
            }
        },
        []
    );

    const finishActiveWrite = useCallback((writeEpoch, writtenKeys) => {
        for (const key of writtenKeys) {
            if (activeWriteEpochsRef.current.get(key) === writeEpoch) {
                activeWriteEpochsRef.current.delete(key);
            }
        }
    }, []);

    const reconcileAuthoritativeValues = useCallback(
        (keysToReconcile) => {
            if (!mountedRef.current || keysToReconcile.length === 0) {
                return;
            }
            setSettings((previousSettings) => {
                const reconciledSettings = copySettingsObject(previousSettings);
                const authorityToken =
                    committedRequestRef.current.authorityToken;
                for (const key of keysToReconcile) {
                    if (!isKeyWatched(key)) {
                        delete reconciledSettings[key];
                        continue;
                    }

                    // A newer call may have taken ownership before React applies
                    // this updater. Its optimistic value must remain untouched.
                    if (
                        pendingValuesRef.current.get(key)?.authorityToken ===
                        authorityToken
                    ) {
                        continue;
                    }

                    const authoritativeValue =
                        authoritativeValuesRef.current.get(key);
                    if (authoritativeValue?.authorityToken === authorityToken) {
                        defineOwnSetting(
                            reconciledSettings,
                            key,
                            authoritativeValue.value
                        );
                    } else {
                        delete reconciledSettings[key];
                    }
                }
                return reconciledSettings;
            });
        },
        [isKeyWatched]
    );

    const settlePendingValues = useCallback(
        (token, keysToSettle) => {
            const ownedKeys = keysToSettle.filter(
                (key) => pendingValuesRef.current.get(key)?.token === token
            );
            for (const key of ownedKeys) {
                pendingValuesRef.current.delete(key);
            }
            reconcileAuthoritativeValues(ownedKeys);
        },
        [reconcileAuthoritativeValues]
    );

    const trackPendingValues = useCallback((updates) => {
        let resolveSettled;
        const settled = new Promise((resolve) => {
            resolveSettled = resolve;
        });
        const token = { settled };
        const requestSnapshot = committedRequestRef.current;
        const authorityToken = requestSnapshot.authorityToken;
        let cleared = false;
        for (const [key, value] of Object.entries(updates)) {
            pendingValuesRef.current.set(key, {
                token,
                value,
                authorityToken,
            });
        }

        return {
            token,
            authorityToken,
            clear: () => {
                if (cleared) {
                    return;
                }
                cleared = true;
                for (const key of Object.keys(updates)) {
                    if (pendingValuesRef.current.get(key)?.token === token) {
                        pendingValuesRef.current.delete(key);
                    }
                }
                resolveSettled();
            },
        };
    }, []);

    const syncVisibleError = useCallback(() => {
        if (!mountedRef.current) {
            return;
        }

        if (unresolvedReconciliationKeysRef.current.size === 0) {
            reconciliationErrorRef.current = null;
        } else if (reconciliationErrorRef.current === null) {
            // Keep the public reconciliation surface fixed and key-free. The
            // per-key ledger is internal and must never leak setting names or
            // storage/provider error details.
            reconciliationErrorRef.current = new Error(
                SETTINGS_RECONCILIATION_ERROR_MESSAGE
            );
        }

        const nextVisibleError =
            operationErrorRef.current?.error ??
            reconciliationErrorRef.current ??
            null;
        setError((currentVisibleError) =>
            currentVisibleError === nextVisibleError
                ? currentVisibleError
                : nextVisibleError
        );
    }, []);

    const getOrCreateWatchedKeyToken = useCallback((key) => {
        let token = watchedKeyTokensRef.current.get(key);
        if (!token) {
            token = {};
            watchedKeyTokensRef.current.set(key, token);
        }
        return token;
    }, []);

    const resolveReconciliationKeys = useCallback(
        (proofRevision, confirmedKeys) => {
            if (!mountedRef.current) {
                return false;
            }
            let resolvedAny = false;
            for (const key of confirmedKeys) {
                const failureRevision =
                    unresolvedReconciliationKeysRef.current.get(key);
                if (
                    failureRevision !== undefined &&
                    failureRevision <= proofRevision
                ) {
                    unresolvedReconciliationKeysRef.current.delete(key);
                    resolvedAny = true;
                }
            }
            return resolvedAny;
        },
        []
    );

    const completeSuccessfulOperation = useCallback(
        (proofRevision, confirmedKeys, authorityToken) => {
            if (
                !mountedRef.current ||
                authorityToken !== committedRequestRef.current.authorityToken
            ) {
                return false;
            }

            // A successful write is independent proof for only its own keys.
            // Resolve those per-key failures even when an unrelated operation
            // error appeared while the write was pending.
            resolveReconciliationKeys(proofRevision, confirmedKeys);

            // Operation revisions are assigned at start. The latest settled
            // outcome owns the operation-error slot: a newer success clears an
            // older failure even if it appeared while the success was pending,
            // while an older completion cannot touch a newer outcome.
            const ownsLatestOutcome =
                proofRevision >= latestSettledOperationRevisionRef.current;
            if (ownsLatestOutcome) {
                latestSettledOperationRevisionRef.current = proofRevision;
                if (
                    !operationErrorRef.current ||
                    operationErrorRef.current.operationRevision <= proofRevision
                ) {
                    operationErrorRef.current = null;
                }
            }
            syncVisibleError();
            return ownsLatestOutcome;
        },
        [resolveReconciliationKeys, syncVisibleError]
    );

    const publishOperationError = useCallback(
        (nextError, kind, operationRevision, authorityToken) => {
            if (
                !mountedRef.current ||
                authorityToken !== committedRequestRef.current.authorityToken
            ) {
                return false;
            }
            if (operationRevision < latestSettledOperationRevisionRef.current) {
                return false;
            }
            latestSettledOperationRevisionRef.current = operationRevision;
            operationErrorRef.current = {
                error: nextError,
                kind,
                operationRevision,
            };
            syncVisibleError();
            return true;
        },
        [syncVisibleError]
    );

    const publishWriteError = useCallback(
        (nextError, operationRevision, authorityToken) =>
            publishOperationError(
                nextError,
                'write',
                operationRevision,
                authorityToken
            ),
        [publishOperationError]
    );

    const publishLoadFailure = useCallback(
        (nextError, operationRevision, authorityToken) =>
            publishOperationError(
                nextError
                    ? nextError
                    : new Error(SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE),
                'load',
                operationRevision,
                authorityToken
            ),
        [publishOperationError]
    );

    const publishReconciliationError = useCallback(
        (readbackRevision, readbackKeys, capturedWatchTokens = null) => {
            if (!mountedRef.current) {
                return;
            }
            const relevantKeys = readbackKeys.filter((key) => {
                const currentAuthority =
                    authoritativeValuesRef.current.get(key);
                const activeWriteRevision =
                    activeWriteEpochsRef.current.get(key);
                const remainedContinuouslyWatched =
                    !capturedWatchTokens ||
                    capturedWatchTokens.get(key) ===
                        watchedKeyTokensRef.current.get(key);
                return (
                    isKeyWatched(key) &&
                    remainedContinuouslyWatched &&
                    (!currentAuthority ||
                        currentAuthority.revision <= readbackRevision) &&
                    (!activeWriteRevision ||
                        activeWriteRevision <= readbackRevision)
                );
            });
            let advanced = false;
            for (const key of relevantKeys) {
                const currentFailureRevision =
                    unresolvedReconciliationKeysRef.current.get(key);
                if (
                    currentFailureRevision === undefined ||
                    currentFailureRevision < readbackRevision
                ) {
                    unresolvedReconciliationKeysRef.current.set(
                        key,
                        readbackRevision
                    );
                    advanced = true;
                }
            }
            if (advanced) {
                syncVisibleError();
            }
        },
        [isKeyWatched, syncVisibleError]
    );

    const clearReconciliationError = useCallback(
        (readbackRevision, confirmedKeys) => {
            if (!mountedRef.current) {
                return;
            }
            if (resolveReconciliationKeys(readbackRevision, confirmedKeys)) {
                // A strict proof can update hidden reconciliation provenance,
                // but the derived surface keeps any operation error visible.
                syncVisibleError();
            }
        },
        [resolveReconciliationKeys, syncVisibleError]
    );

    useLayoutEffect(() => {
        const nextWatchedKeys = toWatchedKeys(JSON.parse(serializedKeys));
        const currentRequest = committedRequestRef.current;
        if (currentRequest.identity !== requestIdentity) {
            const sensitivityChanged =
                currentRequest.includeSensitive !== includeSensitive;
            committedRequestRef.current = {
                identity: requestIdentity,
                includeSensitive,
                watchedKeys: nextWatchedKeys,
                token: {},
                authorityToken: sensitivityChanged
                    ? {}
                    : currentRequest.authorityToken,
            };
            if (sensitivityChanged) {
                pendingValuesRef.current.clear();
                authoritativeValuesRef.current.clear();
                activeWriteEpochsRef.current.clear();
                unresolvedReconciliationKeysRef.current.clear();
                operationErrorRef.current = null;
                latestSettledOperationRevisionRef.current = 0;
                reconciliationErrorRef.current = null;
                setSettings(createSettingsObject());
                setError(null);
            }
        }
        committedWatchedKeysRef.current = nextWatchedKeys;

        if (nextWatchedKeys) {
            const nextWatchedKeySet = new Set(nextWatchedKeys);
            for (const key of watchedKeyTokensRef.current.keys()) {
                if (!nextWatchedKeySet.has(key)) {
                    watchedKeyTokensRef.current.delete(key);
                }
            }
            for (const key of nextWatchedKeys) {
                getOrCreateWatchedKeyToken(key);
            }
            for (const key of unresolvedReconciliationKeysRef.current.keys()) {
                if (!nextWatchedKeySet.has(key)) {
                    unresolvedReconciliationKeysRef.current.delete(key);
                }
            }
        }

        syncVisibleError();
        setLoadStatus((currentStatus) =>
            currentStatus.requestIdentity === requestIdentity &&
            currentStatus.status === 'loading'
                ? currentStatus
                : { requestIdentity, status: 'loading' }
        );
    }, [
        getOrCreateWatchedKeyToken,
        includeSensitive,
        requestIdentity,
        serializedKeys,
        syncVisibleError,
    ]);

    const launchStrictReadback = useCallback(
        (
            keysToRead,
            reportUncertainty = false,
            reservedRevision = null,
            capturedWatchTokens = null,
            requestSnapshot = committedRequestRef.current
        ) => {
            const uniqueKeys = [...new Set(keysToRead)];
            const isCurrentRequest = () =>
                mountedRef.current &&
                committedRequestRef.current.token === requestSnapshot.token;
            if (!isCurrentRequest() || uniqueKeys.length === 0) {
                return;
            }

            const readbackRevision =
                reservedRevision ?? nextAuthorityRevision();
            void (async () => {
                try {
                    const readResult =
                        await configService.readMultipleResultStrict(
                            uniqueKeys,
                            {
                                includeSensitive:
                                    requestSnapshot.includeSensitive,
                            }
                        );
                    if (!isCurrentRequest()) {
                        return;
                    }

                    // Strict ConfigService reads reject failed areas, while the
                    // caller remains responsible for required-key projection.
                    // Validate the complete projection before committing any
                    // returned value so a nominal but incomplete/hostile shape
                    // remains uncertain rather than becoming partial authority.
                    const relevantPersistedValues = collectStrictReadbackValues(
                        readResult,
                        uniqueKeys
                    );
                    const eligibleKeys = capturedWatchTokens
                        ? uniqueKeys.filter(
                              (key) =>
                                  isKeyWatched(key) &&
                                  capturedWatchTokens.get(key) ===
                                      watchedKeyTokensRef.current.get(key)
                          )
                        : uniqueKeys;
                    const eligiblePersistedValues = createSettingsObject(
                        eligibleKeys.map((key) => [
                            key,
                            relevantPersistedValues[key],
                        ])
                    );
                    applyAuthoritativeValues(
                        eligiblePersistedValues,
                        readbackRevision,
                        'readback',
                        { authorityToken: requestSnapshot.authorityToken }
                    );
                    reconcileAuthoritativeValues(eligibleKeys);
                    // Every successful strict read is persisted-state proof,
                    // regardless of whether an event or a failed local write
                    // launched it. It resolves only matching older key entries;
                    // any visible operation error keeps priority.
                    clearReconciliationError(readbackRevision, eligibleKeys);
                } catch {
                    if (!isCurrentRequest()) {
                        return;
                    }
                    console.error('Settings reconciliation failed.');
                    if (reportUncertainty) {
                        publishReconciliationError(
                            readbackRevision,
                            uniqueKeys,
                            capturedWatchTokens
                        );
                    }
                }
            })();
        },
        [
            applyAuthoritativeValues,
            clearReconciliationError,
            isKeyWatched,
            nextAuthorityRevision,
            publishReconciliationError,
            reconcileAuthoritativeValues,
        ]
    );

    const applyLoadedSettings = useCallback(
        (data, loadRevision, protectedWriteEpochs, authorityToken) => {
            if (!mountedRef.current) {
                return;
            }
            const loadedValues =
                data && typeof data === 'object'
                    ? data
                    : createSettingsObject();
            applyAuthoritativeValues(loadedValues, loadRevision, 'load', {
                protectedWriteEpochs,
                authorityToken,
            });

            setSettings((previousSettings) => {
                if (!mountedRef.current) {
                    return previousSettings;
                }
                if (
                    committedRequestRef.current.authorityToken !==
                    authorityToken
                ) {
                    return previousSettings;
                }
                const watchedKeys = committedWatchedKeysRef.current;
                const candidateKeys = watchedKeys
                    ? new Set(watchedKeys)
                    : new Set([
                          ...Object.keys(previousSettings),
                          ...Object.keys(loadedValues),
                          ...authoritativeValuesRef.current.keys(),
                          ...pendingValuesRef.current.keys(),
                      ]);
                const loadedSettings = createSettingsObject();

                for (const key of candidateKeys) {
                    if (!isKeyWatched(key)) {
                        continue;
                    }
                    const pendingValue = pendingValuesRef.current.get(key);
                    if (pendingValue?.authorityToken === authorityToken) {
                        defineOwnSetting(
                            loadedSettings,
                            key,
                            pendingValue.value
                        );
                        continue;
                    }

                    const authoritativeValue =
                        authoritativeValuesRef.current.get(key);
                    const hasCurrentAuthority =
                        authoritativeValue?.authorityToken === authorityToken;
                    if (hasOwn(loadedValues, key) && hasCurrentAuthority) {
                        defineOwnSetting(
                            loadedSettings,
                            key,
                            authoritativeValue.value
                        );
                    } else if (
                        hasCurrentAuthority &&
                        authoritativeValue.revision >= loadRevision
                    ) {
                        defineOwnSetting(
                            loadedSettings,
                            key,
                            authoritativeValue.value
                        );
                    } else if (hasOwn(loadedValues, key)) {
                        defineOwnSetting(
                            loadedSettings,
                            key,
                            loadedValues[key]
                        );
                    }
                }

                return loadedSettings;
            });
        },
        [applyAuthoritativeValues, isKeyWatched]
    );

    // Load initial settings
    useEffect(() => {
        let cancelled = false;
        const requestSnapshot = committedRequestRef.current;
        if (requestSnapshot.identity !== requestIdentity) {
            return undefined;
        }
        const loadRevision = nextAuthorityRevision();
        const protectedWriteEpochs = new Map(activeWriteEpochsRef.current);
        const isCurrentRequest = () =>
            !cancelled &&
            mountedRef.current &&
            committedRequestRef.current.token === requestSnapshot.token;

        const loadSettings = async () => {
            try {
                if (mountedRef.current) {
                    setSettings((previousSettings) => {
                        if (!mountedRef.current) {
                            return previousSettings;
                        }
                        const watchedKeys = committedWatchedKeysRef.current;
                        if (!watchedKeys) {
                            return previousSettings;
                        }

                        const projectedSettings = createSettingsObject();
                        for (const key of watchedKeys) {
                            if (hasOwn(previousSettings, key)) {
                                defineOwnSetting(
                                    projectedSettings,
                                    key,
                                    previousSettings[key]
                                );
                            }
                        }
                        return projectedSettings;
                    });
                }
                let data;
                const projectedKeys = requestSnapshot.watchedKeys;

                if (projectedKeys) {
                    const readResult =
                        await configService.readMultipleResultStrict(
                            projectedKeys,
                            {
                                includeSensitive:
                                    requestSnapshot.includeSensitive,
                            }
                        );
                    if (!isCurrentRequest()) {
                        return;
                    }
                    data = collectStrictReadbackValues(
                        readResult,
                        projectedKeys,
                        SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE
                    );
                } else {
                    const readResult = await configService.readAllResultStrict({
                        includeSensitive: requestSnapshot.includeSensitive,
                    });
                    if (!isCurrentRequest()) {
                        return;
                    }
                    data = collectStrictReadbackValues(
                        readResult,
                        null,
                        SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE
                    );
                }

                if (isCurrentRequest()) {
                    applyLoadedSettings(
                        data,
                        loadRevision,
                        protectedWriteEpochs,
                        requestSnapshot.authorityToken
                    );
                    completeSuccessfulOperation(
                        loadRevision,
                        [],
                        requestSnapshot.authorityToken
                    );
                    setLoadStatus((currentStatus) =>
                        currentStatus.requestIdentity === requestIdentity
                            ? { requestIdentity, status: 'ready' }
                            : currentStatus
                    );
                }
            } catch (err) {
                if (isCurrentRequest()) {
                    publishLoadFailure(
                        err,
                        loadRevision,
                        requestSnapshot.authorityToken
                    );
                    console.error('Settings initial load failed.');
                    setLoadStatus((currentStatus) =>
                        currentStatus.requestIdentity === requestIdentity
                            ? { requestIdentity, status: 'unavailable' }
                            : currentStatus
                    );
                }
            }
        };

        loadSettings();
        return () => {
            cancelled = true;
        };
    }, [
        applyLoadedSettings,
        nextAuthorityRevision,
        completeSuccessfulOperation,
        requestIdentity,
        publishLoadFailure,
    ]);

    // Listen for setting changes
    useEffect(() => {
        const requestSnapshot = committedRequestRef.current;
        if (requestSnapshot.identity !== requestIdentity) {
            return undefined;
        }
        const isCurrentRequest = () =>
            mountedRef.current &&
            committedRequestRef.current.token === requestSnapshot.token;
        const handleChange = (changes) => {
            if (!isCurrentRequest()) {
                return;
            }
            const relevantChanges = createSettingsObject();
            const watchedKeys = requestSnapshot.watchedKeys;
            for (const [key, value] of Object.entries(changes)) {
                if (watchedKeys && !watchedKeys.includes(key)) {
                    continue;
                }
                defineOwnSetting(relevantChanges, key, value);
            }

            if (Object.keys(relevantChanges).length === 0) {
                return;
            }

            const changedKeys = [];
            const pendingTokens = new Set();
            for (const [key, value] of Object.entries(relevantChanges)) {
                const pendingCandidate = pendingValuesRef.current.get(key);
                const pendingValue =
                    pendingCandidate?.authorityToken ===
                    requestSnapshot.authorityToken
                        ? pendingCandidate
                        : undefined;
                const authorityCandidate =
                    authoritativeValuesRef.current.get(key);
                const currentAuthority =
                    authorityCandidate?.authorityToken ===
                    requestSnapshot.authorityToken
                        ? authorityCandidate
                        : undefined;
                if (
                    !currentAuthority ||
                    !areSettingsValuesEqual(currentAuthority.value, value) ||
                    (pendingValue &&
                        !areSettingsValuesEqual(pendingValue.value, value))
                ) {
                    changedKeys.push(key);
                    if (pendingValue) {
                        pendingTokens.add(pendingValue.token);
                    }
                }
            }
            const eventRevision = nextAuthorityRevision();
            const changedKeyWatchTokens = new Map(
                changedKeys.map((key) => [key, getOrCreateWatchedKeyToken(key)])
            );
            applyAuthoritativeValues(relevantChanges, eventRevision, 'event', {
                authorityToken: requestSnapshot.authorityToken,
            });
            setSettings((previousSettings) => {
                if (
                    !mountedRef.current ||
                    committedRequestRef.current.token !== requestSnapshot.token
                ) {
                    return previousSettings;
                }
                const nextSettings = copySettingsObject(previousSettings);
                for (const [key, eventValue] of Object.entries(
                    relevantChanges
                )) {
                    if (!isKeyWatched(key)) {
                        delete nextSettings[key];
                        continue;
                    }
                    const pendingValue = pendingValuesRef.current.get(key);
                    if (
                        pendingValue?.authorityToken ===
                            requestSnapshot.authorityToken &&
                        !areSettingsValuesEqual(pendingValue.value, eventValue)
                    ) {
                        continue;
                    }

                    const authoritativeValue =
                        authoritativeValuesRef.current.get(key);
                    if (
                        authoritativeValue?.authorityToken ===
                        requestSnapshot.authorityToken
                    ) {
                        defineOwnSetting(
                            nextSettings,
                            key,
                            authoritativeValue.value
                        );
                    }
                }
                return nextSettings;
            });
            const launchEventReadback = () =>
                launchStrictReadback(
                    changedKeys,
                    true,
                    eventRevision,
                    changedKeyWatchTokens,
                    requestSnapshot
                );
            if (pendingTokens.size === 0) {
                launchEventReadback();
            } else {
                // Each changing callback owns exactly one read. If it observed
                // optimistic writes, wait for those exact generations so the
                // storage proof cannot be captured before their persistence
                // attempts finish. The event revision was already reserved,
                // so later writes/events still outrank the deferred result.
                // A write that never settles intentionally leaves its optimistic
                // UI visible and the event as provisional rollback authority;
                // it does not block the write queue continuation synchronously.
                void Promise.allSettled(
                    [...pendingTokens].map((token) => token.settled)
                ).then(launchEventReadback);
            }
        };

        const unsubscribe = configService.onChanged(handleChange, {
            includeSensitive: requestSnapshot.includeSensitive,
        });

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [
        applyAuthoritativeValues,
        getOrCreateWatchedKeyToken,
        isKeyWatched,
        launchStrictReadback,
        nextAuthorityRevision,
        requestIdentity,
    ]);

    // Update a setting
    const updateSetting = useCallback(
        async (key, value) => {
            const update = createSettingsObject([[key, value]]);
            const pendingWrite = trackPendingValues(update);
            if (mountedRef.current && isKeyWatched(key)) {
                setSettings((previousSettings) => {
                    if (
                        !mountedRef.current ||
                        pendingWrite.authorityToken !==
                            committedRequestRef.current.authorityToken ||
                        !isKeyWatched(key)
                    ) {
                        return previousSettings;
                    }
                    const nextSettings = copySettingsObject(previousSettings);
                    defineOwnSetting(nextSettings, key, value);
                    return nextSettings;
                });
            }
            try {
                return await enqueueWrite(async () => {
                    // Revisions are assigned when the queued operation actually
                    // starts, not when its optimistic UI was issued.
                    const operationRevision = nextAuthorityRevision();
                    if (
                        pendingWrite.authorityToken ===
                        committedRequestRef.current.authorityToken
                    ) {
                        activeWriteEpochsRef.current.set(
                            key,
                            operationRevision
                        );
                    }
                    try {
                        const canonicalValue = await configService.set(
                            key,
                            value
                        );
                        const hasCanonicalValue = canonicalValue !== undefined;
                        finishActiveWrite(operationRevision, [key]);
                        if (hasCanonicalValue) {
                            applyAuthoritativeValues(
                                createSettingsObject([[key, canonicalValue]]),
                                operationRevision,
                                'write',
                                {
                                    writeEpoch: operationRevision,
                                    authorityToken: pendingWrite.authorityToken,
                                }
                            );
                        }
                        settlePendingValues(pendingWrite.token, [key]);
                        const writeMatchesCurrentAuthority =
                            pendingWrite.authorityToken ===
                            committedRequestRef.current.authorityToken;
                        completeSuccessfulOperation(
                            operationRevision,
                            writeMatchesCurrentAuthority && hasCanonicalValue
                                ? [key]
                                : [],
                            pendingWrite.authorityToken
                        );
                        if (
                            writeMatchesCurrentAuthority &&
                            !hasCanonicalValue
                        ) {
                            launchStrictReadback([key], true);
                        }
                        return true;
                    } catch (err) {
                        finishActiveWrite(operationRevision, [key]);
                        settlePendingValues(pendingWrite.token, [key]);
                        publishWriteError(
                            err,
                            operationRevision,
                            pendingWrite.authorityToken
                        );
                        if (
                            pendingWrite.authorityToken ===
                            committedRequestRef.current.authorityToken
                        ) {
                            launchStrictReadback([key]);
                        }
                        console.error('Settings update failed.');
                        throw err;
                    }
                });
            } finally {
                pendingWrite.clear();
            }
        },
        [
            enqueueWrite,
            applyAuthoritativeValues,
            completeSuccessfulOperation,
            finishActiveWrite,
            isKeyWatched,
            launchStrictReadback,
            nextAuthorityRevision,
            publishWriteError,
            settlePendingValues,
            trackPendingValues,
        ]
    );

    // Update multiple settings at once
    const updateSettings = useCallback(
        async (updates) => {
            // Freeze the operation's own key/value bindings at invocation.
            // Config values may be structured-cloneable objects, so this is
            // intentionally a shallow snapshot rather than normalization or a
            // deep clone of caller-owned values.
            const safeUpdates = createSettingsObject(Object.entries(updates));
            const pendingWrite = trackPendingValues(safeUpdates);
            const updatedKeys = Object.keys(safeUpdates);
            if (mountedRef.current) {
                setSettings((previousSettings) => {
                    if (
                        !mountedRef.current ||
                        pendingWrite.authorityToken !==
                            committedRequestRef.current.authorityToken
                    ) {
                        return previousSettings;
                    }
                    const nextSettings = copySettingsObject(previousSettings);
                    for (const [key, value] of Object.entries(safeUpdates)) {
                        if (isKeyWatched(key)) {
                            defineOwnSetting(nextSettings, key, value);
                        }
                    }
                    return nextSettings;
                });
            }
            try {
                return await enqueueWrite(async () => {
                    const operationRevision = nextAuthorityRevision();
                    if (
                        pendingWrite.authorityToken ===
                        committedRequestRef.current.authorityToken
                    ) {
                        for (const key of updatedKeys) {
                            activeWriteEpochsRef.current.set(
                                key,
                                operationRevision
                            );
                        }
                    }
                    try {
                        const writeResult =
                            await configService.setMultiple(safeUpdates);
                        const confirmedUpdates =
                            collectCanonicalWriteProjection(
                                writeResult,
                                updatedKeys
                            );
                        finishActiveWrite(operationRevision, updatedKeys);
                        if (confirmedUpdates) {
                            applyAuthoritativeValues(
                                confirmedUpdates,
                                operationRevision,
                                'write',
                                {
                                    writeEpoch: operationRevision,
                                    authorityToken: pendingWrite.authorityToken,
                                }
                            );
                        }
                        settlePendingValues(pendingWrite.token, updatedKeys);
                        const writeMatchesCurrentAuthority =
                            pendingWrite.authorityToken ===
                            committedRequestRef.current.authorityToken;
                        completeSuccessfulOperation(
                            operationRevision,
                            writeMatchesCurrentAuthority && confirmedUpdates
                                ? updatedKeys
                                : [],
                            pendingWrite.authorityToken
                        );
                        if (writeMatchesCurrentAuthority && !confirmedUpdates) {
                            launchStrictReadback(updatedKeys, true);
                        }
                        return true;
                    } catch (writeError) {
                        finishActiveWrite(operationRevision, updatedKeys);
                        // ConfigService reports partial persistence explicitly.
                        // Its error metadata identifies successful keys but does
                        // not expose their producer-normalized values. Never
                        // promote raw caller input as authority; retain the
                        // previous values until strict readback proves the exact
                        // canonical persisted projection.
                        const writeMatchesCurrentAuthority =
                            pendingWrite.authorityToken ===
                            committedRequestRef.current.authorityToken;
                        const confirmedSuccessfulKeys =
                            writeMatchesCurrentAuthority
                                ? getConfirmedSuccessfulKeys(
                                      writeError,
                                      updatedKeys
                                  )
                                : [];
                        settlePendingValues(pendingWrite.token, updatedKeys);
                        publishWriteError(
                            writeError,
                            operationRevision,
                            pendingWrite.authorityToken
                        );
                        if (writeMatchesCurrentAuthority) {
                            clearReconciliationError(
                                operationRevision,
                                confirmedSuccessfulKeys
                            );
                        }

                        // Readback is additional proof, not a prerequisite for
                        // removing a failed generation's optimistic values or
                        // allowing a later queued write to start.
                        if (writeMatchesCurrentAuthority) {
                            launchStrictReadback(updatedKeys);
                        }
                        console.error('Settings batch update failed.');
                        throw writeError;
                    }
                });
            } finally {
                pendingWrite.clear();
            }
        },
        [
            enqueueWrite,
            applyAuthoritativeValues,
            clearReconciliationError,
            completeSuccessfulOperation,
            finishActiveWrite,
            isKeyWatched,
            launchStrictReadback,
            nextAuthorityRevision,
            publishWriteError,
            settlePendingValues,
            trackPendingValues,
        ]
    );

    const renderMatchesCommittedSensitivity =
        committedRequestRef.current.includeSensitive === includeSensitive;
    const visibleAuthorityToken = committedRequestRef.current.authorityToken;
    let visibleSettings = renderMatchesCommittedSensitivity
        ? settings
        : createSettingsObject();
    if (!renderMatchesCommittedSensitivity) {
        // A sensitivity transition is public before its layout commit. Do not
        // expose authority or optimistic values owned by the prior permission
        // generation during that render.
        visibleSettings = createSettingsObject();
    } else if (renderWatchedKeys) {
        visibleSettings = createSettingsObject();
        for (const key of renderWatchedKeys) {
            const pendingValue = pendingValuesRef.current.get(key);
            if (pendingValue?.authorityToken === visibleAuthorityToken) {
                defineOwnSetting(visibleSettings, key, pendingValue.value);
                continue;
            }

            const authoritativeValue = authoritativeValuesRef.current.get(key);
            if (authoritativeValue?.authorityToken === visibleAuthorityToken) {
                defineOwnSetting(
                    visibleSettings,
                    key,
                    authoritativeValue.value
                );
                continue;
            }

            if (hasOwn(settings, key)) {
                defineOwnSetting(visibleSettings, key, settings[key]);
            }
        }
    } else {
        const overlayValue = (key, value) => {
            if (
                hasOwn(visibleSettings, key) &&
                Object.is(visibleSettings[key], value)
            ) {
                return;
            }
            if (visibleSettings === settings) {
                visibleSettings = copySettingsObject(settings);
            }
            defineOwnSetting(visibleSettings, key, value);
        };

        for (const [
            key,
            authoritativeValue,
        ] of authoritativeValuesRef.current) {
            if (authoritativeValue.authorityToken === visibleAuthorityToken) {
                overlayValue(key, authoritativeValue.value);
            }
        }
        for (const [key, pendingValue] of pendingValuesRef.current) {
            if (pendingValue.authorityToken === visibleAuthorityToken) {
                overlayValue(key, pendingValue.value);
            }
        }
    }

    const initialLoadStatus =
        committedRequestRef.current.identity !== requestIdentity ||
        loadStatus.requestIdentity !== requestIdentity
            ? 'loading'
            : loadStatus.status;
    const loading = initialLoadStatus === 'loading';
    const visibleError = renderMatchesCommittedSensitivity ? error : null;

    return {
        settings: visibleSettings,
        updateSetting,
        updateSettings,
        loading,
        initialLoadStatus,
        error: visibleError,
    };
}
