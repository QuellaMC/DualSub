/**
 * Manages resources that require explicit cleanup, such as event listeners or observers,
 * to prevent memory leaks.
 */
export class ResourceManager {
    constructor(logger = console.log) {
        this.resources = new Map();
        this.logger = logger;
        this.isCleanedUp = false;
    }

    /**
     * Registers a resource to be cleaned up later.
     * @param {string} name - A unique identifier for the resource.
     * @param {*} resource - The resource instance to be managed.
     * @param {Function} cleanupFn - The function to call to clean up the resource.
     */
    register(name, resource, cleanupFn) {
        if (this.isCleanedUp) {
            this.logger('warn', 'Attempted to register a resource after cleanup.', { name });
            return;
        }

        this.resources.set(name, {
            resource,
            cleanup: cleanupFn,
            registeredAt: Date.now()
        });

        this.logger('debug', 'Resource registered.', { name, type: typeof resource });
    }

    /**
     * Unregisters and cleans up a specific resource by its identifier.
     * @param {string} name - The identifier of the resource to unregister.
     * @returns {boolean} `true` if the resource was found and cleaned up, otherwise `false`.
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
            this.logger('debug', 'Resource unregistered.', { name });
            return true;
        } catch (error) {
            this.logger('error', 'Error cleaning up resource.', { name, error: error.message });
            return false;
        }
    }

    /**
     * Retrieves a registered resource by its identifier.
     * @param {string} name - The identifier of the resource to retrieve.
     * @returns {*} The resource instance, or `null` if not found.
     */
    get(name) {
        const resourceInfo = this.resources.get(name);
        return resourceInfo ? resourceInfo.resource : null;
    }

    /**
     * Checks if a resource is registered.
     * @param {string} name - The identifier of the resource to check.
     * @returns {boolean} `true` if the resource is registered, otherwise `false`.
     */
    has(name) {
        return this.resources.has(name);
    }

    /**
     * Gets the names of all registered resources.
     * @returns {string[]} An array of resource identifiers.
     */
    getResourceNames() {
        return Array.from(this.resources.keys());
    }

    /**
     * Cleans up all registered resources.
     */
    cleanupAll() {
        if (this.isCleanedUp) {
            this.logger('debug', 'Resource manager has already been cleaned up.');
            return;
        }

        const resourceNames = this.getResourceNames();
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
                this.logger('error', 'Unexpected error during resource cleanup.', { name, error: error.message });
                errorCount++;
            }
        }

        this.isCleanedUp = true;
        this.logger('info', 'Resource manager cleanup completed.', { 
            cleaned: cleanedCount, 
            errors: errorCount,
            total: resourceNames.length 
        });
    }

    /**
     * Gets statistics about the managed resources.
     * @returns {Object} An object containing resource statistics.
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