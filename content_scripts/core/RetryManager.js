/**
 * Retry Manager for handling initialization retries with exponential backoff
 */
export class RetryManager {
    constructor(maxRetries = 3, baseDelay = 1000) {
        this.maxRetries = maxRetries;
        this.baseDelay = baseDelay;
    }

    /**
     * Execute operation with retry logic
     * @param {Function} operation - Async operation to retry
     * @param {Object} context - Context for logging
     * @param {Function} logger - Logger function
     * @returns {Promise<any>} Operation result
     */
    async executeWithRetry(operation, context = {}, logger = console.log) {
        let lastError;
        
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                logger('info', `Attempting operation (${attempt + 1}/${this.maxRetries + 1})`, context);
                return await operation();
            } catch (error) {
                lastError = error;
                logger('warn', `Operation failed on attempt ${attempt + 1}`, { error: error.message, ...context });
                
                if (attempt < this.maxRetries) {
                    const delay = this.baseDelay * Math.pow(2, attempt);
                    logger('info', `Retrying in ${delay}ms`, context);
                    await this.delay(delay);
                } else {
                    logger('error', 'All retry attempts exhausted', { error: error.message, ...context });
                }
            }
        }
        
        throw lastError;
    }

    /**
     * Delay utility
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}