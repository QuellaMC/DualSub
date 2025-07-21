/**
 * Platform State Manager
 * Centralized state management for content script lifecycle
 */
export class PlatformState {
    constructor() {
        this.state = {
            initialized: false,
            platformReady: false,
            modulesLoaded: false,
            videoDetectionActive: false,
            cleanedUp: false,
            retryCount: 0
        };
        this.listeners = new Map();
    }

    /**
     * Get current state
     * @param {string} key - State key (optional)
     * @returns {any} State value or entire state
     */
    get(key) {
        return key ? this.state[key] : { ...this.state };
    }

    /**
     * Set state value and notify listeners
     * @param {string|Object} key - State key or state object
     * @param {any} value - State value (if key is string)
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
     * Subscribe to state changes
     * @param {string} key - State key to watch
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
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
     * Notify listeners of state changes
     * @param {Object} changes - Changed state values
     * @private
     */
    notifyListeners(changes) {
        for (const [key, change] of Object.entries(changes)) {
            const keyListeners = this.listeners.get(key);
            if (keyListeners) {
                keyListeners.forEach(callback => {
                    try {
                        callback(change.new, change.old);
                    } catch (error) {
                        console.error(`State listener error for key ${key}:`, error);
                    }
                });
            }
        }
    }

    /**
     * Reset state to initial values
     */
    reset() {
        this.set({
            initialized: false,
            platformReady: false,
            modulesLoaded: false,
            videoDetectionActive: false,
            cleanedUp: false,
            retryCount: 0
        });
    }

    /**
     * Check if platform is in a valid state for operations
     * @returns {boolean}
     */
    isOperational() {
        return this.state.initialized && 
               this.state.modulesLoaded && 
               !this.state.cleanedUp;
    }
}