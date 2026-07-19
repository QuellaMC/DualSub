import { useCallback, useRef } from 'react';
import {
    buildConfigChangedRequestMessage,
    parseContentControlResponseMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

/**
 * Hook for sending messages to content scripts with immediate config updates
 * @returns {Function} Send message function
 */
export function useChromeMessage() {
    const changeGenerationsRef = useRef(new Map());

    const sendImmediateConfigUpdate = useCallback((changes) => {
        let request;
        try {
            request = buildConfigChangedRequestMessage(changes);
        } catch (_) {
            console.debug(
                'Direct message failed, relying on storage events',
                'Invalid config-update request'
            );
            return;
        }
        const changesSnapshot = request.changes;
        const invocationGenerations = new Map();

        Object.keys(changesSnapshot).forEach((key) => {
            const generation = (changeGenerationsRef.current.get(key) ?? 0) + 1;
            changeGenerationsRef.current.set(key, generation);
            invocationGenerations.set(key, generation);
        });

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentChanges = Object.fromEntries(
                Object.entries(changesSnapshot).filter(
                    ([key]) =>
                        changeGenerationsRef.current.get(key) ===
                        invocationGenerations.get(key)
                )
            );

            if (tabs[0] && Object.keys(currentChanges).length > 0) {
                const currentRequest =
                    buildConfigChangedRequestMessage(currentChanges);
                chrome.tabs
                    .sendMessage(tabs[0].id, currentRequest)
                    .then((response) => {
                        const parsedResponse =
                            parseContentControlResponseMessage(
                                response,
                                currentRequest
                            );
                        if (!parsedResponse) {
                            throw new Error('Invalid config-update response');
                        }
                        if (!parsedResponse.success) {
                            throw new Error(parsedResponse.error);
                        }
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
