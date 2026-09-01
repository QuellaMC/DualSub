export function injectScript(
    scriptSrc,
    scriptId,
    onLoad = () => {},
    onError = () => {},
    logger = console.log,
    isModule = false
) {
    if (document.getElementById(scriptId)) return false;

    try {
        const script = document.createElement('script');
        script.src = scriptSrc;
        script.id = scriptId;
        if (isModule) script.type = 'module';
        script.onload = onLoad;
        script.onerror = (error) => {
            logger(`Failed to load script ${scriptId}`, error);
            onError(error);
        };

        const target = document.head || document.documentElement;
        if (!target) return false;
        target.appendChild(script);
        return true;
    } catch (error) {
        logger(`Error during script injection: ${error.message}`);
        onError(error);
        return false;
    }
}

export class EventBuffer {
    constructor(logger = console.log, maxSize = 100, maxAge = 30000) {
        this.buffer = [];
        this.logger = logger;
        this.maxSize = maxSize;
        this.maxAge = maxAge;
        this.isProcessing = false;
    }

    add(eventData) {
        const event = eventData.timestamp
            ? eventData
            : { ...eventData, timestamp: Date.now() };

        this.#discardStaleEvents();
        if (this.buffer.length >= this.maxSize) this.buffer.shift();
        this.buffer.push(event);
    }

    processAll(processor) {
        if (this.isProcessing || this.buffer.length === 0) return;

        this.isProcessing = true;
        this.#discardStaleEvents();
        const events = this.buffer;
        this.buffer = [];

        try {
            events.forEach((event, index) => {
                try {
                    processor(event, index);
                } catch (error) {
                    this.logger('Failed to process buffered event.', error);
                }
            });
        } finally {
            this.isProcessing = false;
        }
    }

    clear() {
        this.buffer = [];
    }

    size() {
        return this.buffer.length;
    }

    #discardStaleEvents() {
        const cutoff = Date.now() - this.maxAge;
        this.buffer = this.buffer.filter(
            (event) => (event.timestamp || 0) >= cutoff
        );
    }
}

export function logWithFallback(
    level,
    message,
    data = {},
    prefix = 'ContentScript'
) {
    console.log(`[${prefix}] [${level.toUpperCase()}] ${message}`, data);
}

export class IntervalManager {
    constructor() {
        this.intervals = new Map();
    }

    set(name, callback, delay) {
        this.clear(name);

        try {
            const id = setInterval(() => {
                try {
                    callback();
                } catch (error) {
                    console.error(`Error in interval ${name}:`, error);
                    this.clear(name);
                }
            }, delay);
            this.intervals.set(name, id);
            return true;
        } catch (error) {
            console.error(`Failed to set interval ${name}:`, error);
            return false;
        }
    }

    clear(name) {
        const id = this.intervals.get(name);
        if (id === undefined) return;
        clearInterval(id);
        this.intervals.delete(name);
    }

    clearAll() {
        for (const id of this.intervals.values()) clearInterval(id);
        this.intervals.clear();
    }
}
