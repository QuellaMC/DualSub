import { useState, useCallback } from 'react';

/**
 * Hook for testing DeepL API connection
 * @param {Function} t - Translation function
 * @returns {Object} Test functions and state
 */
export function useDeepLTest(t) {
    const [testResult, setTestResult] = useState({
        visible: false,
        message: '',
        type: 'info', // 'success', 'error', 'warning', 'info'
    });
    const [testing, setTesting] = useState(false);

    const showTestResult = useCallback((message, type) => {
        setTestResult({
            visible: true,
            message,
            type,
        });
    }, []);

    const testConnection = useCallback(
        async (apiKey, apiPlan) => {
            if (
                typeof window.DeepLAPI === 'undefined' ||
                !window.DeepLAPI ||
                typeof window.DeepLAPI.testDeepLConnection !== 'function'
            ) {
                showTestResult(
                    t(
                        'deeplApiNotLoadedError',
                        '❌ DeepL API script is not available. Please refresh the page.'
                    ),
                    'error'
                );
                return;
            }

            if (!apiKey) {
                showTestResult(
                    t(
                        'deeplApiKeyError',
                        'Please enter your DeepL API key first.'
                    ),
                    'error'
                );
                return;
            }

            setTesting(true);
            showTestResult(
                t('testingConnection', 'Testing DeepL connection...'),
                'info'
            );

            try {
                const result = await window.DeepLAPI.testDeepLConnection(
                    apiKey,
                    apiPlan
                );

                if (result.success) {
                    showTestResult(
                        t(
                            'deeplTestSuccessSimple',
                            '✅ DeepL API test successful!'
                        ),
                        'success'
                    );
                } else {
                    let fallbackMessage;

                    switch (result.error) {
                        case 'API_KEY_MISSING':
                            fallbackMessage = t(
                                'deeplApiKeyError',
                                'Please enter your DeepL API key first.'
                            );
                            break;
                        case 'UNEXPECTED_FORMAT':
                            fallbackMessage = t(
                                'deeplTestUnexpectedFormat',
                                '⚠️ DeepL API responded but with unexpected format'
                            );
                            break;
                        case 'HTTP_403':
                            fallbackMessage = t(
                                'deeplTestInvalidKey',
                                '❌ DeepL API key is invalid or has been rejected.'
                            );
                            break;
                        case 'HTTP_456':
                            fallbackMessage = t(
                                'deeplTestQuotaExceeded',
                                '❌ DeepL API quota exceeded. Please check your usage limits.'
                            );
                            break;
                        case 'NETWORK_ERROR':
                            fallbackMessage = t(
                                'deeplTestNetworkError',
                                '❌ Network error: Could not connect to DeepL API. Check your internet connection.'
                            );
                            break;
                        default:
                            if (result.error.startsWith('HTTP_')) {
                                fallbackMessage = t(
                                    'deeplTestApiError',
                                    '❌ DeepL API error (%d): %s',
                                    result.status,
                                    result.message || 'Unknown error'
                                );
                            } else {
                                fallbackMessage = t(
                                    'deeplTestGenericError',
                                    '❌ Test failed: %s',
                                    result.message
                                );
                            }
                            break;
                    }

                    const errorType =
                        result.error === 'UNEXPECTED_FORMAT'
                            ? 'warning'
                            : 'error';
                    showTestResult(fallbackMessage, errorType);
                }
            } catch (error) {
                showTestResult(
                    t(
                        'deeplTestGenericError',
                        '❌ Test failed: %s',
                        error.message
                    ),
                    'error'
                );
            } finally {
                setTesting(false);
            }
        },
        [t, showTestResult]
    );

    const initializeStatus = useCallback(
        (apiKey) => {
            if (apiKey) {
                showTestResult(
                    t(
                        'deeplTestNeedsTesting',
                        '⚠️ DeepL API key needs testing.'
                    ),
                    'warning'
                );
            } else {
                showTestResult(
                    t(
                        'deeplApiKeyError',
                        'Please enter your DeepL API key first.'
                    ),
                    'error'
                );
            }
        },
        [t, showTestResult]
    );

    return {
        testResult,
        testing,
        testConnection,
        initializeStatus,
        showTestResult,
    };
}
