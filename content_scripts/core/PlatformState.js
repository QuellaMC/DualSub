/**
 * Manages the state for the content script lifecycle, providing a centralized
 * location for state tracking and updates.
 */
export class PlatformState {
    constructor() {
        this.state = {
            initialized: false,
            platformReady: false,
            modulesLoaded: false,
            videoDetectionActive: false,
            cleanedUp: false,
            retryCount: 0,
        };
        this.listeners = new Map();
    }

    /**
     * Gets the current state.
     * @param {string} [key] - If provided, returns the value of a single state property.
     * @returns {*} The entire state object or the value of the specified state property.
     */
    get(key) {
        return key ? this.state[key] : { ...this.state };
    }

    /**
     * Sets a state value and notifies any listeners of the change.
     * @param {string|Object} key - The state property to set, or an object of key-value pairs to update.
     * @param {*} [value] - The new value for the state property (if `key` is a string).
     */
    set(key, value) {
        const changes = {};

        if (typeof key === 'object') {
            Object.assign(this.state, key);
            Object.assign(changes, key);
        } else {
            const oldValue = this.state[key];
            this.state[key] = value;
            changes[key] = { old: oldValue, new: value };
        }

        this.notifyListeners(changes);
    }

    /**
     * Subscribes a callback function to state changes for a specific property.
     * @param {string} key - The state property to watch.
     * @param {Function} callback - The function to call when the state property changes.
     * @returns {Function} A function to unsubscribe the callback.
     */
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }

        this.listeners.get(key).add(callback);

        return () => {
            const keyListeners = this.listeners.get(key);
            if (keyListeners) {
                keyListeners.delete(callback);
                if (keyListeners.size === 0) {
                    this.listeners.delete(key);
                }
            }
        };
    }

    /**
     * Notifies all registered listeners of state changes.
     * @param {Object} changes - An object containing the changed state properties.
     * @private
     */
    notifyListeners(changes) {
        for (const [key, change] of Object.entries(changes)) {
            const keyListeners = this.listeners.get(key);
            if (keyListeners) {
                keyListeners.forEach((callback) => {
                    try {
                        callback(change.new, change.old);
                    } catch (error) {
                        console.error(
                            `State listener error for key ${key}:`,
                            error
                        );
                    }
                });
            }
        }
    }

    /**
     * Resets the state to its initial values.
     */
    reset() {
        this.set({
            initialized: false,
            platformReady: false,
            modulesLoaded: false,
            videoDetectionActive: false,
            cleanedUp: false,
            retryCount: 0,
        });
    }

    /**
     * Checks if the platform is in an operational state.
     * @returns {boolean} `true` if the platform is initialized and not cleaned up, otherwise `false`.
     */
    isOperational() {
        return (
            this.state.initialized &&
            this.state.modulesLoaded &&
            !this.state.cleanedUp
        );
    }
}
