import { useCallback, useEffect, useRef, useState } from 'react';
import {
    hasHostPermission,
    requestHostPermission,
} from '../../utils/hostPermissions.js';

const EMPTY_TEST_RESULT = {
    visible: false,
    message: '',
    type: 'info',
};

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

    const invalidateRequests = useCallback(() => {
        requestGenerationRef.current += 1;
        if (!mountedRef.current) {
            return;
        }
        setTesting(false);
        setFetchingModels(false);
        setTestResult(EMPTY_TEST_RESULT);
    }, []);

    const runRequest = useCallback(
        async (kind, apiKey, baseUrl, onModelsLoaded) => {
            const generation = ++requestGenerationRef.current;
            const isCurrent = () =>
                mountedRef.current &&
                generation === requestGenerationRef.current;
            const publishStatus = (message, type) => {
                if (isCurrent()) {
                    setTestResult({ visible: true, message, type });
                }
            };
            const isTest = kind === 'test';

            if (!mountedRef.current) {
                return;
            }
            setTesting(false);
            setFetchingModels(false);

            if (!apiKey) {
                publishStatus(
                    t('openaiApiKeyError', 'Please enter an API key first.'),
                    'error'
                );
                return;
            }

            setTesting(isTest);
            setFetchingModels(!isTest);
            publishStatus(
                isTest
                    ? t('openaiTestingConnection', 'Testing connection...')
                    : t('openaieFetchingModels', 'Fetching models...'),
                'info'
            );

            try {
                const permissionGranted = await (isTest
                    ? requestHostPermission(baseUrl)
                    : hasHostPermission(baseUrl));
                if (!isCurrent()) {
                    return;
                }
                if (!permissionGranted) {
                    if (!isTest) {
                        publishStatus(
                            t(
                                'openaiEndpointPermissionRequired',
                                'Use Test Connection to grant access to this endpoint.'
                            ),
                            'warning'
                        );
                        return;
                    }
                    throw new Error('Endpoint access was not granted.');
                }

                const models = await fetchAvailableModels(apiKey, baseUrl);
                if (!isCurrent()) {
                    return;
                }

                onModelsLoaded?.(models, { apiKey, baseUrl });
                publishStatus(
                    isTest
                        ? t(
                              'openaiConnectionSuccessful',
                              'Connection successful!'
                          )
                        : t(
                              'openaiModelsFetchedSuccessfully',
                              'Models fetched successfully.'
                          ),
                    'success'
                );
            } catch (error) {
                publishStatus(
                    isTest
                        ? t(
                              'openaiConnectionFailed',
                              'Connection failed: %s',
                              error.message
                          )
                        : t(
                              'openaiFailedToFetchModels',
                              'Failed to fetch models: %s',
                              error.message
                          ),
                    'error'
                );
            } finally {
                if (isCurrent()) {
                    setTesting(false);
                    setFetchingModels(false);
                }
            }
        },
        [fetchAvailableModels, t]
    );

    const testConnection = useCallback(
        (apiKey, baseUrl, onModelsLoaded) =>
            runRequest('test', apiKey, baseUrl, onModelsLoaded),
        [runRequest]
    );

    const fetchModels = useCallback(
        (apiKey, baseUrl, onModelsLoaded) =>
            runRequest('fetch', apiKey, baseUrl, onModelsLoaded),
        [runRequest]
    );

    const initializeStatus = useCallback(
        (apiKey) => {
            if (!mountedRef.current) {
                return;
            }
            setTestResult({
                visible: true,
                message: apiKey
                    ? t(
                          'openaiTestNeedsTesting',
                          '⚠️ OpenAI-compatible API key needs testing.'
                      )
                    : t(
                          'openaiApiKeyError',
                          'Please enter your API key first.'
                      ),
                type: apiKey ? 'warning' : 'error',
            });
        },
        [t]
    );

    return {
        testResult,
        testing,
        fetchingModels,
        testConnection,
        fetchModels,
        invalidateRequests,
        initializeStatus,
    };
}
