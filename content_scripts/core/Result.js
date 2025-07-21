/**
 * Result Pattern Implementation
 * 
 * Provides a functional approach to error handling without throwing exceptions.
 * Useful for operations that can fail and need to return both success/failure state
 * and associated data or error information.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * Result class for functional error handling
 * @template T, E
 */
export class Result {
    /**
     * Create a new Result instance
     * @private
     * @param {boolean} isSuccess - Whether the result is successful
     * @param {T} value - The success value
     * @param {E} error - The error value
     */
    constructor(isSuccess, value, error) {
        this._isSuccess = isSuccess;
        this._value = value;
        this._error = error;
    }

    /**
     * Create a successful result
     * @template T
     * @param {T} value - The success value
     * @returns {Result<T, never>} Success result
     */
    static success(value) {
        return new Result(true, value, null);
    }

    /**
     * Create a failed result
     * @template E
     * @param {E} error - The error value
     * @returns {Result<never, E>} Error result
     */
    static failure(error) {
        return new Result(false, null, error);
    }

    /**
     * Check if result is successful
     * @returns {boolean} Whether result is successful
     */
    isSuccess() {
        return this._isSuccess;
    }

    /**
     * Check if result is a failure
     * @returns {boolean} Whether result is a failure
     */
    isFailure() {
        return !this._isSuccess;
    }

    /**
     * Get the success value
     * @returns {T} The success value
     * @throws {Error} If result is a failure
     */
    getValue() {
        if (!this._isSuccess) {
            throw new Error('Cannot get value from failed result');
        }
        return this._value;
    }

    /**
     * Get the error value
     * @returns {E} The error value
     * @throws {Error} If result is successful
     */
    getError() {
        if (this._isSuccess) {
            throw new Error('Cannot get error from successful result');
        }
        return this._error;
    }

    /**
     * Get value or return default
     * @param {T} defaultValue - Default value to return if failed
     * @returns {T} The value or default
     */
    getValueOr(defaultValue) {
        return this._isSuccess ? this._value : defaultValue;
    }

    /**
     * Map the success value to a new value
     * @template U
     * @param {function(T): U} mapper - Function to map the value
     * @returns {Result<U, E>} New result with mapped value
     */
    map(mapper) {
        if (!this._isSuccess) {
            return Result.failure(this._error);
        }
        try {
            return Result.success(mapper(this._value));
        } catch (error) {
            return Result.failure(error);
        }
    }

    /**
     * Map the error value to a new error
     * @template F
     * @param {function(E): F} mapper - Function to map the error
     * @returns {Result<T, F>} New result with mapped error
     */
    mapError(mapper) {
        if (this._isSuccess) {
            return Result.success(this._value);
        }
        try {
            return Result.failure(mapper(this._error));
        } catch (error) {
            return Result.failure(error);
        }
    }

    /**
     * Chain operations that return Results
     * @template U
     * @param {function(T): Result<U, E>} mapper - Function that returns a Result
     * @returns {Result<U, E>} The chained result
     */
    flatMap(mapper) {
        if (!this._isSuccess) {
            return Result.failure(this._error);
        }
        try {
            return mapper(this._value);
        } catch (error) {
            return Result.failure(error);
        }
    }

    /**
     * Execute a function if result is successful
     * @param {function(T): void} callback - Function to execute
     * @returns {Result<T, E>} This result for chaining
     */
    onSuccess(callback) {
        if (this._isSuccess) {
            callback(this._value);
        }
        return this;
    }

    /**
     * Execute a function if result is a failure
     * @param {function(E): void} callback - Function to execute
     * @returns {Result<T, E>} This result for chaining
     */
    onFailure(callback) {
        if (!this._isSuccess) {
            callback(this._error);
        }
        return this;
    }

    /**
     * Convert to JSON representation
     * @returns {Object} JSON representation
     */
    toJSON() {
        return {
            isSuccess: this._isSuccess,
            value: this._isSuccess ? this._value : undefined,
            error: !this._isSuccess ? this._error : undefined
        };
    }

    /**
     * Create Result from a promise
     * @template T
     * @param {Promise<T>} promise - Promise to convert
     * @returns {Promise<Result<T, Error>>} Result wrapped promise
     */
    static async fromPromise(promise) {
        try {
            const value = await promise;
            return Result.success(value);
        } catch (error) {
            return Result.failure(error);
        }
    }

    /**
     * Create Result from a function that might throw
     * @template T
     * @param {function(): T} fn - Function to execute
     * @returns {Result<T, Error>} Result of function execution
     */
    static fromThrowing(fn) {
        try {
            return Result.success(fn());
        } catch (error) {
            return Result.failure(error);
        }
    }
}