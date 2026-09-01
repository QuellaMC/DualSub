import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import { useChromeMessage } from './useChromeMessage.js';

describe('useChromeMessage', () => {
    beforeEach(() => {
        chrome.tabs.query = jest.fn();
        chrome.tabs.sendMessage = jest.fn();
    });

    test('sends the centralized minimal config-update message', async () => {
        chrome.tabs.query.mockImplementation((_query, callback) => {
            callback([{ id: 42 }]);
        });
        chrome.tabs.sendMessage.mockResolvedValue({ success: true });
        const { result } = renderHook(() => useChromeMessage());

        act(() => {
            result.current.sendImmediateConfigUpdate({
                subtitleFontSize: 1.4,
                subtitlesEnabled: true,
            });
        });

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
            action: MessageActions.CONFIG_CHANGED,
            changes: {
                subtitleFontSize: 1.4,
                subtitlesEnabled: true,
            },
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(console.debug).not.toHaveBeenCalled();
    });

    test('sends only the latest value for each key when tab queries reorder', () => {
        const callbacks = [];
        chrome.tabs.query.mockImplementation((_query, callback) => {
            callbacks.push(callback);
        });
        chrome.tabs.sendMessage.mockResolvedValue({ success: true });
        const { result } = renderHook(() => useChromeMessage());

        act(() => {
            result.current.sendImmediateConfigUpdate({
                subtitleFontSize: 1,
                subtitlesEnabled: true,
            });
            result.current.sendImmediateConfigUpdate({
                subtitleFontSize: 1.4,
                targetLanguage: 'ja',
            });
            callbacks[1]([{ id: 42 }]);
            callbacks[0]([{ id: 42 }]);
        });

        expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(1, 42, {
            action: MessageActions.CONFIG_CHANGED,
            changes: { subtitleFontSize: 1.4, targetLanguage: 'ja' },
        });
        expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(2, 42, {
            action: MessageActions.CONFIG_CHANGED,
            changes: { subtitlesEnabled: true },
        });
    });

    test('contains direct-delivery failure so storage remains the fallback', async () => {
        chrome.tabs.query.mockImplementation((_query, callback) => {
            callback([{ id: 7 }]);
        });
        chrome.tabs.sendMessage.mockRejectedValue(new Error('receiver gone'));
        const { result } = renderHook(() => useChromeMessage());

        act(() => {
            result.current.sendImmediateConfigUpdate({ targetLanguage: 'ja' });
        });

        await waitFor(() => {
            expect(console.debug).toHaveBeenCalledWith(
                'Direct message failed, relying on storage events',
                'receiver gone'
            );
        });
    });
});
