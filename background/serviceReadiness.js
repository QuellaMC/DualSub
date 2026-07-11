/**
 * Shared readiness gate for Manifest V3 event handlers.
 *
 * Chrome requires service-worker listeners to be registered synchronously, but
 * the services behind those listeners initialize asynchronously. This gate lets
 * listeners capture cold-start events immediately and defer only their handling.
 */
export class BackgroundServiceReadiness {
    constructor() {
        this.ready = false;
        this.settled = false;
        this.failure = null;
        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });
    }

    isReady() {
        return this.ready;
    }

    markReady() {
        if (this.settled) return;
        this.ready = true;
        this.settled = true;
        this.resolveReady();
    }

    markFailed(error) {
        if (this.settled) return;
        this.failure =
            error instanceof Error ? error : new Error(String(error));
        this.settled = true;
        this.resolveReady();
    }

    async waitUntilReady() {
        await this.readyPromise;
        if (this.failure) throw this.failure;
    }
}

export const backgroundServiceReadiness = new BackgroundServiceReadiness();
