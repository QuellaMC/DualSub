/**
 * Resource Manager for tracking and cleaning up resources
 */
export class ResourceManager {
    constructor(logger = console.log) {
        this.resources = new Map();
        this.logger = logger;
        this.isCleanedUp = false;
    }

    /**
     * Register a resource for cleanup
     * @param {string} name - Resource identifier
     * @param {any} resource - Resource instance
     * @param {Function} cleanupFn - Cleanup function
     */
    register(name, resource, cleanupFn) {
        if (this.isCleanedUp) {
            this.logger('warn', 'Attempting to register resource after cleanup', { name });
            return;
        }

        this.resources.set(name, {
            resource,
            cleanup: cleanupFn,
            registeredAt: Date.now()
        });

        this.logger('debug', 'Resource registered', { name, type: typeof resource });
    }

    /**
     * Unregister and cleanup a specific resource
     * @param {string} name - Resource identifier
     * @returns {boolean} Whether resource was found and cleaned up
     */
    unregister(name) {
        const resourceInfo = this.resources.get(name);
        if (!resourceInfo) {
            return false;
        }

        try {
            if (resourceInfo.cleanup) {
                resourceInfo.cleanup(resourceInfo.resource);
            }
            this.resources.delete(name);
            this.logger('debug', 'Resource unregistered', { name });
            return true;
        } catch (error) {
            this.logger('error', 'Error cleaning up resource', { name, error: error.message });
            return false;
        }
    }

    /**
     * Get a registered resource
     * @param {string} name - Resource identifier
     * @returns {any} Resource instance or null
     */
    get(name) {
        const resourceInfo = this.resources.get(name);
        return resourceInfo ? resourceInfo.resource : null;
    }

    /**
     * Check if a resource is registered
     * @param {string} name - Resource identifier
     * @returns {boolean}
     */
    has(name) {
        return this.resources.has(name);
    }

    /**
     * Get all registered resource names
     * @returns {string[]}
     */
    getResourceNames() {
        return Array.from(this.resources.keys());
    }

    /**
     * Cleanup all registered resources
     */
    cleanupAll() {
        if (this.isCleanedUp) {
            this.logger('debug', 'Resource manager already cleaned up');
            return;
        }

        const resourceNames = Array.from(this.resources.keys());
        let cleanedCount = 0;
        let errorCount = 0;

        for (const name of resourceNames) {
            try {
                if (this.unregister(name)) {
                    cleanedCount++;
                } else {
                    errorCount++;
                }
            } catch (error) {
                this.logger('error', 'Unexpected error during resource cleanup', { name, error: error.message });
                errorCount++;
            }
        }

        this.isCleanedUp = true;
        this.logger('info', 'Resource manager cleanup completed', { 
            cleaned: cleanedCount, 
            errors: errorCount,
            total: resourceNames.length 
        });
    }

    /**
     * Get resource statistics
     * @returns {Object} Resource statistics
     */
    getStats() {
        const now = Date.now();
        const resources = Array.from(this.resources.entries()).map(([name, info]) => ({
            name,
            type: typeof info.resource,
            age: now - info.registeredAt,
            hasCleanup: typeof info.cleanup === 'function'
        }));

        return {
            total: this.resources.size,
            isCleanedUp: this.isCleanedUp,
            resources
        };
    }
}