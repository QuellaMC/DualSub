export class ServiceError extends Error {
    constructor(message, type = 'SERVICE_ERROR', details = {}) {
        super(message);
        this.name = 'ServiceError';
        this.type = type;
        this.details = details;
    }
}

export class TranslationError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'TRANSLATION_ERROR', details);
        this.name = 'TranslationError';
    }
}

export class SubtitleProcessingError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'SUBTITLE_PROCESSING_ERROR', details);
        this.name = 'SubtitleProcessingError';
    }
}

export class RateLimitError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'RATE_LIMIT_ERROR', details);
        this.name = 'RateLimitError';
    }
}

class ServiceRegistry {
    constructor() {
        this.services = new Map();
        this.dependencies = new Map();
    }

    register(name, service, dependencies = []) {
        this.services.set(name, service);
        this.dependencies.set(name, dependencies);
    }

    getServiceNames() {
        return Array.from(this.services.keys());
    }

    validateDependencies(name) {
        const deps = this.dependencies.get(name) || [];
        return deps.every((dep) => this.services.has(dep));
    }
}

export const serviceRegistry = new ServiceRegistry();
