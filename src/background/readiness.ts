// Content scripts and the side panel probe this before retrying work: a
// freshly woken worker answers immediately, and `ready` flips true only once
// every service finished initializing. Requests park on whenServiceReady so
// an event that woke the worker is served after init instead of dropped.
export interface ServiceReadiness {
    translation: boolean;
    subtitle: boolean;
    aiContext: boolean;
    aiContextInitialized: boolean;
}

type ServiceName = keyof ServiceReadiness;

const state: ServiceReadiness = {
    translation: false,
    subtitle: false,
    aiContext: false,
    aiContextInitialized: false,
};

const waiters = new Map<ServiceName, PromiseWithResolvers<void>>();

export function markServiceReady(service: ServiceName): void {
    state[service] = true;
    waiters.get(service)?.resolve();
}

/** Resolves once the named service has been marked ready (immediately if it
 *  already is). Never rejects — callers own their own timeouts. */
export function whenServiceReady(service: ServiceName): Promise<void> {
    if (state[service]) {
        return Promise.resolve();
    }
    let waiter = waiters.get(service);
    if (!waiter) {
        waiter = Promise.withResolvers<void>();
        waiters.set(service, waiter);
    }
    return waiter.promise;
}

export function readinessSnapshot(): {
    ready: boolean;
    services: ServiceReadiness;
} {
    const services = { ...state };
    return {
        ready:
            services.translation &&
            services.subtitle &&
            services.aiContext &&
            services.aiContextInitialized,
        services,
    };
}
