import { useState, useCallback } from 'react';

/**
 * Hook for testing OpenAI API and fetching models
 * @param {Function} t - Translation function
 * @param {Function} fetchAvailableModels - Function to fetch models
 * @returns {Object} Test functions and state
 */
export function useOpenAITest(t, fetchAvailableModels) {
    const [testResult, setTestResult] = useState({
        visible: false,
        message: '',
        type: 'info',
    });
    const [testing, setTesting] = useState(false);
    const [fetchingModels, setFetchingModels] = useState(false);

    const showTestResult = useCallback((message, type) => {
        setTestResult({
            visible: true,
            message,
            type,
        });
    }, []);

    const testConnection = useCallback(async (apiKey, baseUrl) => {
        if (!apiKey) {
            showTestResult(
                t('openaiApiKeyError', 'Please enter an API key first.'),
                'error'
            );
            return;
        }

        setTesting(true);
        showTestResult(
            t('openaiTestingConnection', 'Testing connection...'),
            'info'
        );

        try {
            await fetchAvailableModels(apiKey, baseUrl);
            showTestResult(
                t('openaiConnectionSuccessful', 'Connection successful!'),
                'success'
            );
        } catch (error) {
            showTestResult(
                t('openaiConnectionFailed', 'Connection failed: %s', error.message),
                'error'
            );
        } finally {
            setTesting(false);
        }
    }, [t, fetchAvailableModels, showTestResult]);

    const fetchModels = useCallback(async (apiKey, baseUrl, onModelsLoaded) => {
        if (!apiKey) {
            return;
        }

        setFetchingModels(true);
        showTestResult(
            t('openaieFetchingModels', 'Fetching models...'),
            'info'
        );

        try {
            const models = await fetchAvailableModels(apiKey, baseUrl);
            
            if (onModelsLoaded) {
                onModelsLoaded(models);
            }

            showTestResult(
                t('openaiModelsFetchedSuccessfully', 'Models fetched successfully.'),
                'success'
            );
        } catch (error) {
            showTestResult(
                t('openaiFailedToFetchModels', 'Failed to fetch models: %s', error.message),
                'error'
            );
        } finally {
            setFetchingModels(false);
        }
    }, [t, fetchAvailableModels, showTestResult]);

    const initializeStatus = useCallback((apiKey) => {
        if (apiKey) {
            showTestResult(
                t('openaiTestNeedsTesting', '⚠️ OpenAI-compatible API key needs testing.'),
                'warning'
            );
        } else {
            showTestResult(
                t('openaiApiKeyError', 'Please enter your API key first.'),
                'error'
            );
        }
    }, [t, showTestResult]);

    return {
        testResult,
        testing,
        fetchingModels,
        testConnection,
        fetchModels,
        initializeStatus,
        showTestResult,
    };
}
