// Content scripts and the side panel probe this before retrying work: a
// freshly woken worker answers immediately, and `ready` flips true only once
// every service finished initializing. Flags are set by initializeServices as
// each service comes up.
export interface ServiceReadiness {
    translation: boolean;
    subtitle: boolean;
    aiContext: boolean;
    aiContextInitialized: boolean;
}

const state: ServiceReadiness = {
    translation: false,
    subtitle: false,
    aiContext: false,
    aiContextInitialized: false,
};

export function markServiceReady(service: keyof ServiceReadiness): void {
    state[service] = true;
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
