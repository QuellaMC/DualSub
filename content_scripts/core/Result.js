/**
 * Implements the Result pattern, providing a functional approach to error handling
 * that avoids throwing exceptions. This is particularly useful for operations that can
 * fail and need to clearly communicate success or failure along with associated data or errors.
 *
 * @template T The type of the success value.
 * @template E The type of the error value.
 */
export class Result {
    /**
     * @private
     * @param {boolean} isSuccess - Indicates if the result is a success.
     * @param {T} value - The success value.
     * @param {E} error - The error value.
     */
    constructor(isSuccess, value, error) {
        this._isSuccess = isSuccess;
        this._value = value;
        this._error = error;
    }

    /**
     * Creates a successful result.
     * @template T
     * @param {T} value - The success value.
     * @returns {Result<T, never>} A `Result` object representing success.
     */
    static success(value) {
        return new Result(true, value, null);
    }

    /**
     * Creates a failed result.
     * @template E
     * @param {E} error - The error value.
     * @returns {Result<never, E>} A `Result` object representing failure.
     */
    static failure(error) {
        return new Result(false, null, error);
    }

    /**
     * Checks if the result is successful.
     * @returns {boolean} `true` if the result is a success, otherwise `false`.
     */
    isSuccess() {
        return this._isSuccess;
    }

    /**
     * Checks if the result is a failure.
     * @returns {boolean} `true` if the result is a failure, otherwise `false`.
     */
    isFailure() {
        return !this._isSuccess;
    }

    /**
     * Gets the success value.
     * @returns {T} The success value.
     * @throws {Error} If the result is a failure.
     */
    getValue() {
        if (!this._isSuccess) {
            throw new Error('Cannot get value from a failed result.');
        }
        return this._value;
    }

    /**
     * Gets the error value.
     * @returns {E} The error value.
     * @throws {Error} If the result is successful.
     */
    getError() {
        if (this._isSuccess) {
            throw new Error('Cannot get error from a successful result.');
        }
        return this._error;
    }

    /**
     * Gets the success value or a default value if the result is a failure.
     * @param {T} defaultValue - The default value to return on failure.
     * @returns {T} The success value or the default value.
     */
    getValueOr(defaultValue) {
        return this._isSuccess ? this._value : defaultValue;
    }

    /**
     * Maps the success value to a new value.
     * @template U
     * @param {function(T): U} mapper - The function to map the success value.
     * @returns {Result<U, E>} A new `Result` with the mapped value or the original error.
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
     * Maps the error value to a new error.
     * @template F
     * @param {function(E): F} mapper - The function to map the error value.
     * @returns {Result<T, F>} A new `Result` with the mapped error or the original value.
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
     * Chains operations that return a `Result`.
     * @template U
     * @param {function(T): Result<U, E>} mapper - The function that returns a new `Result`.
     * @returns {Result<U, E>} The result of the chained operation.
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
     * Executes a callback if the result is successful.
     * @param {function(T): void} callback - The function to execute on success.
     * @returns {Result<T, E>} The original `Result` instance for chaining.
     */
    onSuccess(callback) {
        if (this._isSuccess) {
            callback(this._value);
        }
        return this;
    }

    /**
     * Executes a callback if the result is a failure.
     * @param {function(E): void} callback - The function to execute on failure.
     * @returns {Result<T, E>} The original `Result` instance for chaining.
     */
    onFailure(callback) {
        if (!this._isSuccess) {
            callback(this._error);
        }
        return this;
    }

    /**
     * Converts the `Result` to a JSON representation.
     * @returns {{isSuccess: boolean, value: T|undefined, error: E|undefined}} A JSON-serializable object.
     */
    toJSON() {
        return {
            isSuccess: this._isSuccess,
            value: this._isSuccess ? this._value : undefined,
            error: !this._isSuccess ? this._error : undefined,
        };
    }

    /**
     * Creates a `Result` from a promise.
     * @template T
     * @param {Promise<T>} promise - The promise to convert.
     * @returns {Promise<Result<T, Error>>} A promise that resolves to a `Result`.
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
     * Creates a `Result` from a function that might throw an error.
     * @template T
     * @param {function(): T} fn - The function to execute.
     * @returns {Result<T, Error>} The `Result` of the function execution.
     */
    static fromThrowing(fn) {
        try {
            return Result.success(fn());
        } catch (error) {
            return Result.failure(error);
        }
    }
}
