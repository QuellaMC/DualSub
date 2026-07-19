import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import { useChromeMessage } from './useChromeMessage.js';

describe('useChromeMessage', () => {
    beforeEach(() => {
        chrome.tabs.query = jest.fn();
        chrome.tabs.sendMessage = jest.fn();
    });

    test('sends the exact centralized config-update payload to the active tab', async () => {
        const changes = Object.freeze({
            subtitleFontSize: 1.4,
            subtitlesEnabled: true,
        });
        chrome.tabs.query.mockImplementation((_query, callback) => {
            callback([{ id: 42 }]);
        });
        chrome.tabs.sendMessage.mockResolvedValue({
            action: MessageActions.CONFIG_CHANGED,
            success: true,
        });
        const { result } = renderHook(() => useChromeMessage());

        act(() => {
            result.current.sendImmediateConfigUpdate(changes);
        });

        expect(chrome.tabs.query).toHaveBeenCalledWith(
            { active: true, currentWindow: true },
            expect.any(Function)
        );
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
            action: MessageActions.CONFIG_CHANGED,
            changes,
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(console.debug).not.toHaveBeenCalled();
    });

    test('suppresses an older same-key preview when active-tab queries resolve out of order', () => {
        const queryCallbacks = [];
        chrome.tabs.query.mockImplementation((_query, callback) => {
            queryCallbacks.push(callback);
        });
        chrome.tabs.sendMessage.mockResolvedValue({
            action: MessageActions.CONFIG_CHANGED,
            success: true,
        });
        const { result } = renderHook(() => useChromeMessage());

        act(() => {
            result.current.sendImmediateConfigUpdate({ targetLanguage: 'ja' });
            result.current.sendImmediateConfigUpdate({ targetLanguage: 'ko' });
        });

        act(() => {
            queryCallbacks[1]([{ id: 42 }]);
            queryCallbacks[0]([{ id: 42 }]);
        });

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
            action: MessageActions.CONFIG_CHANGED,
            changes: { targetLanguage: 'ko' },
        });
    });

    test('preserves disjoint preview keys without merging stale same-key values', () => {
        const queryCallbacks = [];
        chrome.tabs.query.mockImplementation((_query, callback) => {
            queryCallbacks.push(callback);
        });
        chrome.tabs.sendMessage.mockResolvedValue({
            action: MessageActions.CONFIG_CHANGED,
            success: true,
        });
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
        });

        act(() => {
            queryCallbacks[1]([{ id: 42 }]);
            queryCallbacks[0]([{ id: 42 }]);
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

    test('captures an immutable preview snapshot without mutating the caller object', () => {
        let queryCallback;
        chrome.tabs.query.mockImplementation((_query, callback) => {
            queryCallback = callback;
        });
        chrome.tabs.sendMessage.mockResolvedValue({
            action: MessageActions.CONFIG_CHANGED,
            success: true,
        });
        const { result } = renderHook(() => useChromeMessage());
        const changes = { targetLanguage: 'ja' };

        act(() => {
            result.current.sendImmediateConfigUpdate(changes);
        });

        expect(Object.isFrozen(changes)).toBe(false);
        changes.targetLanguage = 'ko';
        act(() => {
            queryCallback([{ id: 42 }]);
        });

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
            action: MessageActions.CONFIG_CHANGED,
            changes: { targetLanguage: 'ja' },
        });
    });

    test('does not send when the active-tab query has no tab', () => {
        chrome.tabs.query.mockImplementation((_query, callback) => {
            callback([]);
        });
        const { result } = renderHook(() => useChromeMessage());

        act(() => {
            result.current.sendImmediateConfigUpdate({
                subtitlesEnabled: true,
            });
        });

        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('contains a rejected direct response and preserves the storage fallback', async () => {
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
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('rejects an uncorrelated direct response and preserves the storage fallback', async () => {
        chrome.tabs.query.mockImplementation((_query, callback) => {
            callback([{ id: 7 }]);
        });
        chrome.tabs.sendMessage.mockResolvedValue({
            action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
            success: true,
        });
        const { result } = renderHook(() => useChromeMessage());

        act(() => {
            result.current.sendImmediateConfigUpdate({ targetLanguage: 'ja' });
        });

        await waitFor(() => {
            expect(console.debug).toHaveBeenCalledWith(
                'Direct message failed, relying on storage events',
                'Invalid config-update response'
            );
        });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });
});
