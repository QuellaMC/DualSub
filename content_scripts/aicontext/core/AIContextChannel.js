export const AI_CONTEXT_SIGNAL_TYPES = Object.freeze({
    WORD_INTENT: 'WORD_INTENT',
    SUBTITLE_CHANGED: 'SUBTITLE_CHANGED',
    SELECTION_SNAPSHOT: 'SELECTION_SNAPSHOT',
    ANALYSIS_REQUEST: 'ANALYSIS_REQUEST',
    ANALYSIS_CANCEL: 'ANALYSIS_CANCEL',
    ANALYSIS_SETTLED: 'ANALYSIS_SETTLED',
});

const SIGNAL_TYPES = Object.freeze(Object.values(AI_CONTEXT_SIGNAL_TYPES));
const SIGNAL_TYPE_SET = new Set(SIGNAL_TYPES);
const NOOP = () => {};

/**
 * Creates a lifecycle-scoped channel for trusted AI-context collaborators.
 */
export function createAIContextChannel({ lifecycleGeneration } = {}) {
    if (!Number.isSafeInteger(lifecycleGeneration) || lifecycleGeneration < 0) {
        throw new TypeError(
            'lifecycleGeneration must be a nonnegative safe integer'
        );
    }

    const listenersByType = new Map(SIGNAL_TYPES.map((type) => [type, []]));
    let active = true;

    const publish = (type, payload) => {
        if (!active || !SIGNAL_TYPE_SET.has(type)) return 0;

        const listeners = listenersByType.get(type);
        const subscriptions = [...listeners];
        const envelope = Object.freeze({
            type,
            lifecycleGeneration,
            payload,
        });
        let delivered = 0;

        for (const subscription of subscriptions) {
            if (!active) break;
            delivered += 1;
            try {
                Promise.resolve(subscription.listener(envelope)).catch(NOOP);
            } catch {
                // One subscriber must not prevent the others from running.
            }
        }

        return delivered;
    };

    const subscribe = (type, listener) => {
        if (
            !active ||
            !SIGNAL_TYPE_SET.has(type) ||
            typeof listener !== 'function'
        ) {
            return NOOP;
        }

        const listeners = listenersByType.get(type);
        const subscription = { listener };
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
        if (!active) return;
        active = false;
        for (const listeners of listenersByType.values()) {
            listeners.length = 0;
        }
        listenersByType.clear();
    };

    return Object.freeze({ publish, subscribe, destroy });
}
