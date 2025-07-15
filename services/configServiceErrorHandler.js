// services/configServiceErrorHandler.js

/**
 * Utility class for handling ConfigService errors with enhanced context and recovery suggestions
 */
export class ConfigServiceErrorHandler {
    /**
     * Creates a contextual error object for storage operations
     * @param {string} operation - The operation being performed ('get', 'set', 'remove', 'clear')
     * @param {string} area - The storage area ('sync' or 'local')
     * @param {string|string[]} keys - The key(s) involved in the operation
     * @param {Error|object} originalError - The original Chrome runtime error
     * @param {object} additionalContext - Additional context information
     * @returns {Error} Enhanced error object with context
     */
    static createStorageError(operation, area, keys, originalError, additionalContext = {}) {
        // Normalize keys to array format
        const keyArray = Array.isArray(keys) ? keys : [keys];
        
        // Create error context
        const context = {
            operation,
            area,
            keys: keyArray,
            timestamp: new Date(),
            ...additionalContext
        };

        // Create enhanced error message
        const keyStr = keyArray.length === 1 ? `key "${keyArray[0]}"` : `keys [${keyArray.join(', ')}]`;
        const baseMessage = `ConfigService: ${operation} operation failed for ${keyStr} in ${area} storage`;
        
        // Extract original error message
        let originalMessage = 'Unknown error';
        if (originalError?.message) {
            originalMessage = originalError.message;
        } else if (originalError && typeof originalError.toString === 'function') {
            const stringified = originalError.toString();
            // Avoid generic "[object Object]" representation
            originalMessage = stringified === '[object Object]' ? 'Unknown error' : stringified;
        }
        const fullMessage = `${baseMessage}: ${originalMessage}`;

        // Create enhanced error object
        const error = new Error(fullMessage);
        error.name = 'ConfigServiceStorageError';
        error.originalError = originalError;
        error.context = context;
        
        // Add recovery action and quota error flag
        error.recoveryAction = this.getErrorRecoveryAction(error);
        error.isQuotaError = this.isQuotaExceededError(error);

        return error;
    }

    /**
     * Detects if an error is related to storage quota being exceeded
     * @param {Error|object} error - The error to check
     * @returns {boolean} True if the error is quota-related
     */
    static isQuotaExceededError(error) {
        if (!error) return false;

        // Check the error message for quota-related keywords
        const errorMessage = (error.message || error.toString() || '').toLowerCase();
        const originalMessage = (error.originalError?.message || error.originalError?.toString() || '').toLowerCase();
        
        const quotaKeywords = [
            'quota exceeded',
            'quota_exceeded',
            'storage quota',
            'maximum storage',
            'storage limit',
            'quota_bytes_per_item',
            'max_write_operations_per_hour',
            'max_write_operations_per_minute'
        ];

        return quotaKeywords.some(keyword => 
            errorMessage.includes(keyword) || originalMessage.includes(keyword)
        );
    }

    /**
     * Provides recovery action suggestions based on the error type
     * @param {Error|object} error - The error to analyze
     * @returns {string} Suggested recovery action
     */
    static getErrorRecoveryAction(error) {
        if (!error) return 'Unknown error - no specific recovery action available';

        // Check if it's a quota error first
        if (this.isQuotaExceededError(error)) {
            const context = error.context;
            if (context?.area === 'sync') {
                return 'Chrome sync storage quota exceeded. Consider: 1) Reducing the amount of data being stored, 2) Moving non-essential settings to local storage, 3) Clearing unused configuration data, 4) Checking if sync is enabled in Chrome settings';
            } else {
                return 'Local storage quota exceeded. Consider: 1) Clearing browser data for this extension, 2) Reducing the amount of data being stored, 3) Implementing data cleanup routines';
            }
        }

        // Analyze error message for other common issues
        const errorMessage = (error.message || error.toString() || '').toLowerCase();
        const originalMessage = (error.originalError?.message || error.originalError?.toString() || '').toLowerCase();
        const fullMessage = `${errorMessage} ${originalMessage}`;

        // Network/connectivity issues
        if (fullMessage.includes('network') || fullMessage.includes('connection') || fullMessage.includes('offline')) {
            return 'Network connectivity issue detected. Try again when online, or check Chrome sync settings if using sync storage';
        }

        // Permission issues
        if (fullMessage.includes('permission') || fullMessage.includes('access denied') || fullMessage.includes('unauthorized')) {
            return 'Permission error detected. Check extension permissions and Chrome storage access settings';
        }

        // Sync disabled issues
        if (fullMessage.includes('sync') && (fullMessage.includes('disabled') || fullMessage.includes('not available'))) {
            return 'Chrome sync appears to be disabled. Enable Chrome sync in browser settings or use local storage for this setting';
        }

        // Invalid key/data issues
        if (fullMessage.includes('invalid') || fullMessage.includes('malformed') || fullMessage.includes('corrupt')) {
            return 'Data validation error detected. Check that the data being stored is valid and properly formatted';
        }

        // Rate limiting
        if (fullMessage.includes('rate') || fullMessage.includes('throttle') || fullMessage.includes('too many')) {
            return 'Rate limiting detected. Reduce the frequency of storage operations or implement exponential backoff retry logic';
        }

        // Generic recovery action based on operation type
        const context = error.context;
        if (context?.operation) {
            switch (context.operation) {
                case 'get':
                    return 'Failed to retrieve data from storage. Try refreshing the extension or check if the keys exist';
                case 'set':
                    return 'Failed to save data to storage. Check available storage space and try again';
                case 'remove':
                    return 'Failed to remove data from storage. The keys may not exist or storage may be locked';
                case 'clear':
                    return 'Failed to clear storage. Try clearing individual keys or restart the browser';
                default:
                    return 'Storage operation failed. Try restarting the extension or browser';
            }
        }

        return 'Unknown storage error. Try restarting the extension or browser, and check Chrome storage settings';
    }
}