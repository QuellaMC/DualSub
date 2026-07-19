import { useState, useCallback, useEffect, useRef } from 'react';
import {
    hasHostPermission,
    requestHostPermission,
} from '../../utils/hostPermissions.js';

const EMPTY_TEST_RESULT = {
    visible: false,
    message: '',
    type: 'info',
};

/**
 * Hook for testing OpenAI API and fetching models
 * @param {Function} t - Translation function
 * @param {Function} fetchAvailableModels - Function to fetch models
 * @returns {Object} Test functions and state
 */
export function useOpenAITest(t, fetchAvailableModels) {
    const [testResult, setTestResult] = useState(EMPTY_TEST_RESULT);
    const [testing, setTesting] = useState(false);
    const [fetchingModels, setFetchingModels] = useState(false);
    const mountedRef = useRef(true);
    const requestGenerationRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestGenerationRef.current += 1;
        };
    }, []);

    const showTestResult = useCallback((message, type) => {
        if (!mountedRef.current) {
            return;
        }
        setTestResult({
            visible: true,
            message,
            type,
        });
    }, []);

    const isCurrentRequest = useCallback(
        (generation) =>
            mountedRef.current && generation === requestGenerationRef.current,
        []
    );

    const publishRequestStatus = useCallback(
        (generation, message, type) => {
            if (!isCurrentRequest(generation)) {
                return;
            }
            setTestResult({
                visible: true,
                message,
                type,
            });
        },
        [isCurrentRequest]
    );

    const startRequest = useCallback((type) => {
        const generation = ++requestGenerationRef.current;
        if (mountedRef.current) {
            setTesting(type === 'test');
            setFetchingModels(type === 'fetch');
        }
        return generation;
    }, []);

    const finishRequest = useCallback(
        (generation) => {
            if (!isCurrentRequest(generation)) {
                return;
            }
            setTesting(false);
            setFetchingModels(false);
        },
        [isCurrentRequest]
    );

    const invalidateRequests = useCallback(() => {
        requestGenerationRef.current += 1;
        if (!mountedRef.current) {
            return;
        }
        setTesting(false);
        setFetchingModels(false);
        setTestResult(EMPTY_TEST_RESULT);
    }, []);

    const testConnection = useCallback(
        async (apiKey, baseUrl, onModelsLoaded) => {
            const generation = startRequest('test');
            if (!apiKey) {
                publishRequestStatus(
                    generation,
                    t('openaiApiKeyError', 'Please enter an API key first.'),
                    'error'
                );
                finishRequest(generation);
                return;
            }

            publishRequestStatus(
                generation,
                t('openaiTestingConnection', 'Testing connection...'),
                'info'
            );

            try {
                const permissionGranted = await requestHostPermission(baseUrl);
                if (!isCurrentRequest(generation)) {
                    return;
                }
                if (!permissionGranted) {
                    throw new Error('Endpoint access was not granted.');
                }
                const models = await fetchAvailableModels(apiKey, baseUrl);
                if (!isCurrentRequest(generation)) {
                    return;
                }
                onModelsLoaded?.(models);
                publishRequestStatus(
                    generation,
                    t('openaiConnectionSuccessful', 'Connection successful!'),
                    'success'
                );
            } catch (error) {
                publishRequestStatus(
                    generation,
                    t(
                        'openaiConnectionFailed',
                        'Connection failed: %s',
                        error.message
                    ),
                    'error'
                );
            } finally {
                finishRequest(generation);
            }
        },
        [
            t,
            fetchAvailableModels,
            finishRequest,
            isCurrentRequest,
            publishRequestStatus,
            startRequest,
        ]
    );

    const fetchModels = useCallback(
        async (apiKey, baseUrl, onModelsLoaded) => {
            const generation = startRequest('fetch');
            if (!apiKey) {
                finishRequest(generation);
                return;
            }

            publishRequestStatus(
                generation,
                t('openaieFetchingModels', 'Fetching models...'),
                'info'
            );

            try {
                const permissionGranted = await hasHostPermission(baseUrl);
                if (!isCurrentRequest(generation)) {
                    return;
                }
                if (!permissionGranted) {
                    publishRequestStatus(
                        generation,
                        t(
                            'openaiEndpointPermissionRequired',
                            'Use Test Connection to grant access to this endpoint.'
                        ),
                        'warning'
                    );
                    return;
                }
                const models = await fetchAvailableModels(apiKey, baseUrl);

                if (!isCurrentRequest(generation)) {
                    return;
                }
                onModelsLoaded?.(models);

                publishRequestStatus(
                    generation,
                    t(
                        'openaiModelsFetchedSuccessfully',
                        'Models fetched successfully.'
                    ),
                    'success'
                );
            } catch (error) {
                publishRequestStatus(
                    generation,
                    t(
                        'openaiFailedToFetchModels',
                        'Failed to fetch models: %s',
                        error.message
                    ),
                    'error'
                );
            } finally {
                finishRequest(generation);
            }
        },
        [
            t,
            fetchAvailableModels,
            finishRequest,
            isCurrentRequest,
            publishRequestStatus,
            startRequest,
        ]
    );

    const initializeStatus = useCallback(
        (apiKey) => {
            if (apiKey) {
                showTestResult(
                    t(
                        'openaiTestNeedsTesting',
                        '⚠️ OpenAI-compatible API key needs testing.'
                    ),
                    'warning'
                );
            } else {
                showTestResult(
                    t('openaiApiKeyError', 'Please enter your API key first.'),
                    'error'
                );
            }
        },
        [t, showTestResult]
    );

    return {
        testResult,
        testing,
        fetchingModels,
        testConnection,
        fetchModels,
        invalidateRequests,
        initializeStatus,
        showTestResult,
    };
}
