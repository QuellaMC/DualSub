// services/configServiceErrorHandler.test.js
import { ConfigServiceErrorHandler } from './configServiceErrorHandler.js';

describe('ConfigServiceErrorHandler', () => {
    describe('createStorageError', () => {
        it('should create enhanced error with single key', () => {
            const originalError = new Error('Chrome storage failed');
            const error = ConfigServiceErrorHandler.createStorageError(
                'get',
                'sync',
                'testKey',
                originalError,
                { method: 'get' }
            );

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('ConfigServiceStorageError');
            expect(error.message).toContain('get operation failed for key "testKey" in sync storage');
            expect(error.message).toContain('Chrome storage failed');
            expect(error.originalError).toBe(originalError);
            expect(error.context.operation).toBe('get');
            expect(error.context.area).toBe('sync');
            expect(error.context.keys).toEqual(['testKey']);
            expect(error.context.timestamp).toBeInstanceOf(Date);
            expect(error.context.method).toBe('get');
            expect(typeof error.recoveryAction).toBe('string');
            expect(typeof error.isQuotaError).toBe('boolean');
        });

        it('should create enhanced error with multiple keys', () => {
            const originalError = { message: 'Storage operation failed' };
            const keys = ['key1', 'key2', 'key3'];
            const error = ConfigServiceErrorHandler.createStorageError(
                'set',
                'local',
                keys,
                originalError
            );

            expect(error.message).toContain('set operation failed for keys [key1, key2, key3] in local storage');
            expect(error.context.keys).toEqual(keys);
            expect(error.context.operation).toBe('set');
            expect(error.context.area).toBe('local');
        });

        it('should handle string keys by converting to array', () => {
            const error = ConfigServiceErrorHandler.createStorageError(
                'remove',
                'sync',
                'singleKey',
                new Error('Test error')
            );

            expect(error.context.keys).toEqual(['singleKey']);
        });

        it('should handle errors without message', () => {
            const originalError = {};
            const error = ConfigServiceErrorHandler.createStorageError(
                'clear',
                'local',
                [],
                originalError
            );

            expect(error.message).toContain('Unknown error');
            expect(error.originalError).toBe(originalError);
        });

        it('should include additional context', () => {
            const additionalContext = {
                method: 'setMultiple',
                retryCount: 2,
                userAgent: 'test'
            };
            const error = ConfigServiceErrorHandler.createStorageError(
                'set',
                'sync',
                'key',
                new Error('Test'),
                additionalContext
            );

            expect(error.context.method).toBe(additionalContext.method);
            expect(error.context.retryCount).toBe(additionalContext.retryCount);
            expect(error.context.userAgent).toBe(additionalContext.userAgent);
        });
    });

    describe('isQuotaExceededError', () => {
        it('should detect quota exceeded errors from error message', () => {
            const quotaErrors = [
                new Error('Quota exceeded'),
                new Error('QUOTA_EXCEEDED'),
                new Error('Storage quota has been exceeded'),
                new Error('Maximum storage limit reached'),
                new Error('quota_bytes_per_item exceeded'),
                new Error('max_write_operations_per_hour limit reached')
            ];

            quotaErrors.forEach(error => {
                expect(ConfigServiceErrorHandler.isQuotaExceededError(error)).toBe(true);
            });
        });

        it('should detect quota exceeded errors from original error', () => {
            const error = {
                message: 'Storage operation failed',
                originalError: new Error('QUOTA_EXCEEDED: Storage quota exceeded')
            };

            expect(ConfigServiceErrorHandler.isQuotaExceededError(error)).toBe(true);
        });

        it('should handle case insensitive detection', () => {
            const errors = [
                new Error('Quota Exceeded'),
                new Error('STORAGE QUOTA'),
                new Error('Maximum Storage'),
                { originalError: { message: 'Quota_Exceeded' } }
            ];

            errors.forEach(error => {
                expect(ConfigServiceErrorHandler.isQuotaExceededError(error)).toBe(true);
            });
        });

        it('should return false for non-quota errors', () => {
            const nonQuotaErrors = [
                new Error('Network error'),
                new Error('Permission denied'),
                new Error('Invalid key'),
                { message: 'Connection failed' },
                null,
                undefined,
                {}
            ];

            nonQuotaErrors.forEach(error => {
                expect(ConfigServiceErrorHandler.isQuotaExceededError(error)).toBe(false);
            });
        });

        it('should handle errors without message property', () => {
            const error = {
                toString: () => 'quota exceeded'
            };

            expect(ConfigServiceErrorHandler.isQuotaExceededError(error)).toBe(true);
        });
    });

    describe('getErrorRecoveryAction', () => {
        it('should provide quota recovery actions for sync storage', () => {
            const error = {
                message: 'Quota exceeded',
                context: { area: 'sync' }
            };

            const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
            expect(action).toContain('Chrome sync storage quota exceeded');
            expect(action).toContain('Moving non-essential settings to local storage');
            expect(action).toContain('sync is enabled in Chrome settings');
        });

        it('should provide quota recovery actions for local storage', () => {
            const error = {
                message: 'Storage quota exceeded',
                context: { area: 'local' }
            };

            const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
            expect(action).toContain('Local storage quota exceeded');
            expect(action).toContain('Clearing browser data');
            expect(action).toContain('data cleanup routines');
        });

        it('should detect network connectivity issues', () => {
            const networkErrors = [
                new Error('Network connection failed'),
                new Error('Offline mode detected'),
                { originalError: { message: 'Connection timeout' } }
            ];

            networkErrors.forEach(error => {
                const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
                expect(action).toContain('Network connectivity issue');
                expect(action).toContain('Try again when online');
            });
        });

        it('should detect permission issues', () => {
            const permissionErrors = [
                new Error('Permission denied'),
                new Error('Access denied to storage'),
                { message: 'Unauthorized access' }
            ];

            permissionErrors.forEach(error => {
                const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
                expect(action).toContain('Permission error detected');
                expect(action).toContain('extension permissions');
            });
        });

        it('should detect sync disabled issues', () => {
            const syncErrors = [
                new Error('Sync is disabled'),
                new Error('Chrome sync not available'),
                { originalError: { message: 'Sync service disabled' } }
            ];

            syncErrors.forEach(error => {
                const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
                expect(action).toContain('Chrome sync appears to be disabled');
                expect(action).toContain('Enable Chrome sync');
            });
        });

        it('should detect data validation issues', () => {
            const validationErrors = [
                new Error('Invalid data format'),
                new Error('Malformed JSON'),
                { message: 'Corrupt data detected' }
            ];

            validationErrors.forEach(error => {
                const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
                expect(action).toContain('Data validation error');
                expect(action).toContain('properly formatted');
            });
        });

        it('should detect rate limiting issues', () => {
            const rateLimitErrors = [
                new Error('Rate limit exceeded'),
                new Error('Too many requests'),
                { originalError: { message: 'Throttled operation' } }
            ];

            rateLimitErrors.forEach(error => {
                const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
                expect(action).toContain('Rate limiting detected');
                expect(action).toContain('exponential backoff');
            });
        });

        it('should provide operation-specific recovery actions', () => {
            const operations = [
                { operation: 'get', expectedText: 'Failed to retrieve data' },
                { operation: 'set', expectedText: 'Failed to save data' },
                { operation: 'remove', expectedText: 'Failed to remove data' },
                { operation: 'clear', expectedText: 'Failed to clear storage' }
            ];

            operations.forEach(({ operation, expectedText }) => {
                const error = {
                    message: 'Generic error',
                    context: { operation }
                };

                const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
                expect(action).toContain(expectedText);
            });
        });

        it('should handle null/undefined errors', () => {
            expect(ConfigServiceErrorHandler.getErrorRecoveryAction(null))
                .toContain('Unknown error - no specific recovery action available');
            expect(ConfigServiceErrorHandler.getErrorRecoveryAction(undefined))
                .toContain('Unknown error - no specific recovery action available');
        });

        it('should provide generic recovery action for unknown errors', () => {
            const error = new Error('Some unknown error');
            const action = ConfigServiceErrorHandler.getErrorRecoveryAction(error);
            expect(action).toContain('Unknown storage error');
            expect(action).toContain('restarting the extension');
        });

        it('should integrate with createStorageError for quota detection', () => {
            const quotaError = new Error('QUOTA_EXCEEDED');
            const enhancedError = ConfigServiceErrorHandler.createStorageError(
                'set',
                'sync',
                'testKey',
                quotaError
            );

            expect(enhancedError.isQuotaError).toBe(true);
            expect(enhancedError.recoveryAction).toContain('Chrome sync storage quota exceeded');
        });
    });

    describe('integration tests', () => {
        it('should create fully enhanced error with all properties', () => {
            const originalError = new Error('QUOTA_EXCEEDED: Storage limit reached');
            const error = ConfigServiceErrorHandler.createStorageError(
                'set',
                'sync',
                ['key1', 'key2'],
                originalError,
                { method: 'setMultiple', retryCount: 1 }
            );

            // Verify all properties are set correctly
            expect(error.name).toBe('ConfigServiceStorageError');
            expect(error.message).toContain('set operation failed for keys [key1, key2] in sync storage');
            expect(error.originalError).toBe(originalError);
            expect(error.isQuotaError).toBe(true);
            expect(error.recoveryAction).toContain('Chrome sync storage quota exceeded');
            expect(error.context.operation).toBe('set');
            expect(error.context.area).toBe('sync');
            expect(error.context.keys).toEqual(['key1', 'key2']);
            expect(error.context.method).toBe('setMultiple');
        });

        it('should handle Chrome runtime lastError format', () => {
            const chromeError = {
                message: 'QUOTA_EXCEEDED_PER_ITEM'
            };
            const error = ConfigServiceErrorHandler.createStorageError(
                'set',
                'local',
                'largeData',
                chromeError
            );

            expect(error.isQuotaError).toBe(true);
            expect(error.message).toContain('QUOTA_EXCEEDED_PER_ITEM');
            expect(error.recoveryAction).toContain('Local storage quota exceeded');
        });
    });
});