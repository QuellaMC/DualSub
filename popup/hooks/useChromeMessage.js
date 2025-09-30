import { useCallback } from 'react';

/**
 * Hook for sending messages to content scripts with immediate config updates
 * @returns {Function} Send message function
 */
export function useChromeMessage() {
    const sendImmediateConfigUpdate = useCallback((changes) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs
                    .sendMessage(tabs[0].id, {
                        action: 'configChanged',
                        changes: changes,
                    })
                    .catch((error) => {
                        // Fail silently - the storage change mechanism should handle it as fallback
                        console.debug(
                            'Direct message failed, relying on storage events',
                            error.message
                        );
                    });
            }
        });
    }, []);

    return { sendImmediateConfigUpdate };
}
