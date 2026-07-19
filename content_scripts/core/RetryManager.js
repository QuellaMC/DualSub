/**
 * Manages operations that require retry logic, implementing an exponential backoff strategy
 * to handle transient failures gracefully.
 */
export class RetryManager {
    /**
     * Creates a new `RetryManager` instance.
     * @param {number} [maxRetries=3] - The maximum number of retry attempts.
     * @param {number} [baseDelay=1000] - The base delay in milliseconds for exponential backoff.
     */
    constructor(maxRetries = 3, baseDelay = 1000) {
        this.maxRetries = maxRetries;
        this.baseDelay = baseDelay;
    }

    /**
     * Executes an asynchronous operation with a retry mechanism.
     * @param {Function} operation - The asynchronous operation to execute.
     * @param {Object} [context={}] - Additional context for logging.
     * @param {Function} [logger=console.log] - The logger function to use for status updates.
     * @returns {Promise<*>} A promise that resolves with the operation's result.
     * @throws Will throw the last error encountered if all retry attempts fail.
     */
    async executeWithRetry(operation, context = {}, logger = console.log) {
        let lastError;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                logger(
                    'info',
                    `Attempting operation (${attempt + 1}/${this.maxRetries + 1})`,
                    context
                );
                return await operation();
            } catch (error) {
                lastError = error;
                logger('warn', `Operation failed on attempt ${attempt + 1}`, {
                    error: error.message,
                    ...context,
                });

                if (attempt < this.maxRetries) {
                    const delay = this.baseDelay * Math.pow(2, attempt);
                    logger('info', `Retrying in ${delay}ms`, context);
                    await this.delay(delay);
                } else {
                    logger('error', 'All retry attempts exhausted', {
                        error: error.message,
                        ...context,
                    });
                }
            }
        }

        throw lastError;
    }

    /**
     * A utility function to create a delay.
     * @param {number} ms - The delay duration in milliseconds.
     * @returns {Promise<void>} A promise that resolves after the specified delay.
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
