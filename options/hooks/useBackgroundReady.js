import { useState, useCallback } from 'react';

/**
 * Hook for checking if background script is ready
 * @returns {Object} Ready check functions
 */
export function useBackgroundReady() {
    const [isReady, setIsReady] = useState(false);
    const [checking, setChecking] = useState(false);

    const checkBackgroundReady = useCallback(async () => {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'checkBackgroundReady',
            });
            return response.success && response.ready;
        } catch (error) {
            console.debug('Background readiness check failed', error);
            return false;
        }
    }, []);

    const waitForBackgroundReady = useCallback(
        async (maxRetries = 10, delay = 500) => {
            setChecking(true);

            for (let i = 0; i < maxRetries; i++) {
                if (await checkBackgroundReady()) {
                    console.debug('Background script is ready', {
                        attempt: i + 1,
                    });
                    setIsReady(true);
                    setChecking(false);
                    return true;
                }
                console.debug('Background script not ready, retrying...', {
                    attempt: i + 1,
                    maxRetries,
                });
                await new Promise((resolve) => setTimeout(resolve, delay));
            }

            console.warn(
                'Background script did not become ready within timeout',
                {
                    maxRetries,
                    totalWaitTime: maxRetries * delay,
                }
            );
            setChecking(false);
            return false;
        },
        [checkBackgroundReady]
    );

    return {
        isReady,
        checking,
        checkBackgroundReady,
        waitForBackgroundReady,
    };
}
