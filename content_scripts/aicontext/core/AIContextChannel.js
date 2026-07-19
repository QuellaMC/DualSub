import {
    tryCreatePlainDataSnapshot,
    utf8ByteLength,
} from '../../shared/protocol/plainDataSnapshot.js';

export const AI_CONTEXT_SIGNAL_TYPES = Object.freeze({
    WORD_INTENT: 'WORD_INTENT',
    SUBTITLE_CHANGED: 'SUBTITLE_CHANGED',
    SELECTION_SNAPSHOT: 'SELECTION_SNAPSHOT',
    ANALYSIS_REQUEST: 'ANALYSIS_REQUEST',
    ANALYSIS_CANCEL: 'ANALYSIS_CANCEL',
    ANALYSIS_SETTLED: 'ANALYSIS_SETTLED',
});

const SIGNAL_TYPE_VALUES = Object.freeze(
    Object.values(AI_CONTEXT_SIGNAL_TYPES)
);
const CALL_PROMISE_THEN = Function.prototype.call.bind(Promise.prototype.then);
const RESOLVE_PROMISE = Promise.resolve.bind(Promise);
const IGNORE_LISTENER_REJECTION = () => {};

const ANALYSIS_CANCEL_REASONS = Object.freeze([
    'user',
    'superseded',
    'modal-closed',
    'selection-invalidated',
]);
const ANALYSIS_FAILURE_CODES = Object.freeze([
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

function hasExactEnumerableDataKeys(value, expectedKeys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) return false;

    for (const key of expectedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
            !descriptor ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value')
        ) {
            return false;
        }
    }

    return ownKeys.every(
        (key) => typeof key === 'string' && expectedKeys.includes(key)
    );
}

function isWellFormedString(value) {
    if (typeof value !== 'string') return false;

    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            if (index + 1 >= value.length) return false;
            const nextCodeUnit = value.charCodeAt(index + 1);
            if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return false;
            index += 1;
        } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            return false;
        }
    }

    return true;
}

function isBoundedNonemptyString(value, maximumBytes) {
    return (
        isWellFormedString(value) &&
        value.length > 0 &&
        utf8ByteLength(value) <= maximumBytes
    );
}

function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function isValidWordIntent(payload, totalBytes) {
    return (
        totalBytes <= 512 &&
        hasExactEnumerableDataKeys(payload, [
            'action',
            'renderRevision',
            'wordIndex',
            'word',
            'sourceLanguage',
            'targetLanguage',
        ]) &&
        payload.action === 'toggle' &&
        isPositiveSafeInteger(payload.renderRevision) &&
        isNonnegativeSafeInteger(payload.wordIndex) &&
        isBoundedNonemptyString(payload.word, 256) &&
        payload.word === payload.word.trim() &&
        isBoundedNonemptyString(payload.sourceLanguage, 64) &&
        isBoundedNonemptyString(payload.targetLanguage, 64)
    );
}

function isValidSubtitleChanged(payload, totalBytes) {
    if (
        totalBytes > 4608 ||
        !hasExactEnumerableDataKeys(payload, [
            'renderRevision',
            'reason',
            'videoId',
            'text',
        ]) ||
        !isPositiveSafeInteger(payload.renderRevision) ||
        !['render', 'refresh', 'expired', 'clear'].includes(payload.reason) ||
        !isWellFormedString(payload.text) ||
        utf8ByteLength(payload.text) > 4096 ||
        (payload.videoId !== null &&
            (!isBoundedNonemptyString(payload.videoId, 256) ||
                payload.videoId !== payload.videoId.trim()))
    ) {
        return false;
    }

    if (payload.reason === 'render' || payload.reason === 'refresh') {
        return payload.text.length > 0 && payload.videoId !== null;
    }
    if (payload.reason === 'expired') {
        return payload.text === '' && payload.videoId !== null;
    }
    return payload.text === '' && payload.videoId === null;
}

function isDenseEnumerableArray(value, maximumLength) {
    if (!Array.isArray(value) || value.length > maximumLength) return false;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1) return false;

    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
            value,
            String(index)
        );
        if (
            !descriptor ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value')
        ) {
            return false;
        }
    }

    return true;
}

function isValidSelectionSnapshot(payload, totalBytes) {
    if (
        totalBytes > 6144 ||
        !hasExactEnumerableDataKeys(payload, [
            'selectionRevision',
            'renderRevision',
            'reason',
            'entries',
        ]) ||
        !isPositiveSafeInteger(payload.selectionRevision) ||
        !isPositiveSafeInteger(payload.renderRevision) ||
        ![
            'toggle',
            'add',
            'remove',
            'clear',
            'restore',
            'subtitle-change',
        ].includes(payload.reason) ||
        !isDenseEnumerableArray(payload.entries, 64)
    ) {
        return false;
    }

    const requiresEmptyEntries =
        payload.reason === 'clear' || payload.reason === 'subtitle-change';
    const requiresNonemptyEntries =
        payload.reason === 'add' || payload.reason === 'restore';
    if (
        (requiresEmptyEntries && payload.entries.length !== 0) ||
        (requiresNonemptyEntries && payload.entries.length === 0)
    ) {
        return false;
    }

    let previousWordIndex = -1;
    let joinedCodeUnits = 0;
    let joinedBytes = 0;

    for (const entry of payload.entries) {
        if (
            !hasExactEnumerableDataKeys(entry, ['wordIndex', 'word']) ||
            !isNonnegativeSafeInteger(entry.wordIndex) ||
            entry.wordIndex <= previousWordIndex ||
            !isBoundedNonemptyString(entry.word, 256)
        ) {
            return false;
        }

        if (previousWordIndex !== -1) {
            joinedCodeUnits += 1;
            joinedBytes += 1;
        }
        joinedCodeUnits += entry.word.length;
        joinedBytes += utf8ByteLength(entry.word);
        if (joinedCodeUnits > 500 || joinedBytes > 4096) return false;
        previousWordIndex = entry.wordIndex;
    }

    return true;
}

function isValidAnalysisRequest(payload, totalBytes) {
    if (
        totalBytes > 512 ||
        !hasExactEnumerableDataKeys(payload, [
            'requestId',
            'selectionRevision',
            'cause',
            'retryOf',
            'contextTypes',
        ]) ||
        !isPositiveSafeInteger(payload.requestId) ||
        !isPositiveSafeInteger(payload.selectionRevision) ||
        !['user', 'retry'].includes(payload.cause) ||
        !isDenseEnumerableArray(payload.contextTypes, 3) ||
        payload.contextTypes.length === 0
    ) {
        return false;
    }

    if (payload.cause === 'user' && payload.retryOf !== null) {
        return false;
    }
    if (payload.cause === 'retry' && !isPositiveSafeInteger(payload.retryOf)) {
        return false;
    }

    const canonicalContextTypes = ['cultural', 'historical', 'linguistic'];
    let previousCanonicalIndex = -1;
    for (const contextType of payload.contextTypes) {
        const canonicalIndex = canonicalContextTypes.indexOf(contextType);
        if (canonicalIndex <= previousCanonicalIndex) return false;
        previousCanonicalIndex = canonicalIndex;
    }

    return true;
}

function isValidAnalysisCancel(payload, totalBytes) {
    return (
        totalBytes <= 256 &&
        hasExactEnumerableDataKeys(payload, ['requestId', 'reason']) &&
        isPositiveSafeInteger(payload.requestId) &&
        ANALYSIS_CANCEL_REASONS.includes(payload.reason)
    );
}

function isValidAnalysisSettled(payload, totalBytes) {
    if (
        totalBytes > 256 ||
        payload === null ||
        typeof payload !== 'object' ||
        !isPositiveSafeInteger(payload.requestId)
    ) {
        return false;
    }

    if (payload.outcome === 'succeeded') {
        return hasExactEnumerableDataKeys(payload, ['requestId', 'outcome']);
    }
    if (payload.outcome === 'failed') {
        return (
            hasExactEnumerableDataKeys(payload, [
                'requestId',
                'outcome',
                'code',
                'retryable',
            ]) &&
            ANALYSIS_FAILURE_CODES.includes(payload.code) &&
            typeof payload.retryable === 'boolean'
        );
    }
    if (payload.outcome === 'cancelled') {
        return (
            hasExactEnumerableDataKeys(payload, [
                'requestId',
                'outcome',
                'reason',
            ]) && ANALYSIS_CANCEL_REASONS.includes(payload.reason)
        );
    }
    return false;
}

function isValidTypedPayload(type, payload, totalBytes) {
    if (type === AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT) {
        return isValidWordIntent(payload, totalBytes);
    }
    if (type === AI_CONTEXT_SIGNAL_TYPES.SUBTITLE_CHANGED) {
        return isValidSubtitleChanged(payload, totalBytes);
    }
    if (type === AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT) {
        return isValidSelectionSnapshot(payload, totalBytes);
    }
    if (type === AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_REQUEST) {
        return isValidAnalysisRequest(payload, totalBytes);
    }
    if (type === AI_CONTEXT_SIGNAL_TYPES.ANALYSIS_CANCEL) {
        return isValidAnalysisCancel(payload, totalBytes);
    }
    return isValidAnalysisSettled(payload, totalBytes);
}

function isAllowedSignalType(type) {
    return (
        typeof type === 'string' &&
        Object.hasOwn(AI_CONTEXT_SIGNAL_TYPES, type) &&
        AI_CONTEXT_SIGNAL_TYPES[type] === type
    );
}

function isolateListenerResult(result) {
    try {
        CALL_PROMISE_THEN(result, undefined, IGNORE_LISTENER_REJECTION);
        return;
    } catch {
        // Non-Promise results are normalized below without dynamic `.catch`.
    }

    try {
        const normalizedPromise = RESOLVE_PROMISE(result);
        CALL_PROMISE_THEN(
            normalizedPromise,
            undefined,
            IGNORE_LISTENER_REJECTION
        );
    } catch {
        // Hostile thenables and intrinsic failures remain isolated.
    }
}

/**
 * Creates a private, lifecycle-scoped AI context signal channel.
 *
 * @param {{ lifecycleGeneration: number }} options
 * @returns {{
 *   publish: (type: string, payload: unknown) => number,
 *   subscribe: (type: string, listener: Function) => Function,
 *   destroy: () => void
 * }}
 */
export function createAIContextChannel(options) {
    let generationDescriptor;

    if (options !== null && typeof options === 'object') {
        try {
            generationDescriptor = Object.getOwnPropertyDescriptor(
                options,
                'lifecycleGeneration'
            );
        } catch {
            generationDescriptor = undefined;
        }
    }

    const lifecycleGeneration = generationDescriptor?.value;

    if (
        !generationDescriptor ||
        !Object.hasOwn(generationDescriptor, 'value') ||
        !Number.isSafeInteger(lifecycleGeneration) ||
        lifecycleGeneration < 0
    ) {
        throw new TypeError(
            'lifecycleGeneration must be a nonnegative safe integer'
        );
    }

    const target = new EventTarget();
    const listenersByType = new Map(
        SIGNAL_TYPE_VALUES.map((type) => [type, []])
    );
    const dispatchersByType = new Map();
    const channelAuthority = {
        active: true,
        lifecycleGeneration,
    };

    for (const type of SIGNAL_TYPE_VALUES) {
        const dispatcher = (event) => {
            for (const subscription of event.detail.subscriptions) {
                if (
                    !channelAuthority.active ||
                    channelAuthority.lifecycleGeneration !== lifecycleGeneration
                ) {
                    break;
                }

                event.detail.deliveryState.delivered += 1;
                try {
                    const result = subscription.listener(event.detail.envelope);
                    isolateListenerResult(result);
                } catch {
                    // Listener failures are isolated from the private channel.
                }
            }
        };
        dispatchersByType.set(type, dispatcher);
        target.addEventListener(type, dispatcher);
    }

    const publish = (type, payload) => {
        if (!channelAuthority.active) return 0;
        if (!isAllowedSignalType(type)) {
            return 0;
        }

        const listeners = listenersByType.get(type);
        if (!listeners) return 0;
        const subscriptions = [...listeners];
        const snapshot = tryCreatePlainDataSnapshot(payload);
        if (!snapshot.accepted || !channelAuthority.active) return 0;
        if (!isValidTypedPayload(type, snapshot.value, snapshot.totalBytes)) {
            return 0;
        }

        const envelope = Object.freeze({
            type,
            lifecycleGeneration,
            payload: snapshot.value,
        });
        const deliveryState = { delivered: 0 };

        target.dispatchEvent(
            new CustomEvent(type, {
                detail: { deliveryState, subscriptions, envelope },
            })
        );

        return deliveryState.delivered;
    };

    const subscribe = (type, listener) => {
        if (
            !channelAuthority.active ||
            !isAllowedSignalType(type) ||
            typeof listener !== 'function'
        ) {
            return () => {};
        }

        const subscription = { listener };
        const listeners = listenersByType.get(type);
        listeners.push(subscription);
        let subscribed = true;

        return () => {
            if (!subscribed) return;
            subscribed = false;
            const index = listeners.indexOf(subscription);
            if (index !== -1) listeners.splice(index, 1);
        };
    };

    const destroy = () => {
        if (!channelAuthority.active) return;
        channelAuthority.active = false;

        for (const listeners of listenersByType.values()) {
            listeners.length = 0;
        }
        for (const [type, dispatcher] of dispatchersByType) {
            target.removeEventListener(type, dispatcher);
        }
        listenersByType.clear();
        dispatchersByType.clear();
    };

    return Object.freeze({ publish, subscribe, destroy });
}
