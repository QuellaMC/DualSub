import { jest } from '@jest/globals';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { POPUP_SETTINGS_KEYS } from '../shared/settingsProjections.js';

const updateSetting = jest.fn();
const updateSettings = jest.fn().mockResolvedValue(undefined);
const sendImmediateConfigUpdate = jest.fn();
const logger = { error: jest.fn() };
let settings = {
    appearanceAccordionOpen: true,
    subtitleFontSize: 1.1,
    uiLanguage: 'en',
};
let settingsError = null;
let initialLoadStatus = 'ready';
const useSettings = jest.fn(() => ({
    error: settingsError,
    initialLoadStatus,
    loading: false,
    settings,
    updateSetting,
    updateSettings,
}));

jest.unstable_mockModule('./hooks/index.js', () => ({
    useChromeMessage: () => ({ sendImmediateConfigUpdate }),
    useLogger: () => logger,
    useSettings,
    useTranslation: () => ({
        loading: false,
        t: (_key, fallback) => fallback,
    }),
}));

const { PopupApp } = await import('./PopupApp.jsx');

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, reject, resolve };
}

const sliderCases = [
    {
        confirmedValue: 1.1,
        key: 'subtitleFontSize',
        label: 'Font Size',
        previewValue: 1.4,
    },
    {
        confirmedValue: 0.3,
        key: 'subtitleGap',
        label: 'Vertical Gap',
        previewValue: 0.5,
    },
    {
        confirmedValue: 2.8,
        key: 'subtitleVerticalPosition',
        label: 'Vertical Position',
        previewValue: 3.2,
    },
];

function getImmediateMessages() {
    return sendImmediateConfigUpdate.mock.calls.map(([message]) => message);
}

describe('PopupApp slider persistence', () => {
    beforeEach(() => {
        settings = {
            appearanceAccordionOpen: true,
            subtitleFontSize: 1.1,
            uiLanguage: 'en',
        };
        settingsError = null;
        initialLoadStatus = 'ready';
        useSettings.mockClear();
        updateSetting.mockReset();
        updateSettings.mockClear();
        sendImmediateConfigUpdate.mockClear();
        logger.error.mockClear();
    });

    test('requests the exact shared non-sensitive Popup projection', () => {
        render(<PopupApp />);

        expect(useSettings).toHaveBeenCalledTimes(1);
        expect(useSettings.mock.calls[0]).toHaveLength(1);
        expect(useSettings.mock.calls[0][0]).toBe(POPUP_SETTINGS_KEYS);
    });

    test('blocks settings controls when the initial load is unavailable and recovers from authoritative settings', () => {
        settings = {};
        initialLoadStatus = 'unavailable';

        const view = render(<PopupApp />);

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/failed to load settings/i);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(
            view.container.querySelector('button, input, select, textarea')
        ).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(
            'Settings initial load unavailable'
        );

        fireEvent.click(alert);
        fireEvent.keyDown(alert, { key: 'Enter' });
        expect(updateSetting).not.toHaveBeenCalled();
        expect(updateSettings).not.toHaveBeenCalled();
        expect(sendImmediateConfigUpdate).not.toHaveBeenCalled();

        settings = {
            appearanceAccordionOpen: true,
            subtitleFontSize: 1.1,
            subtitlesEnabled: false,
            uiLanguage: 'en',
        };
        initialLoadStatus = 'ready';
        view.rerender(<PopupApp />);

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(
            screen.getByRole('checkbox', { name: 'Enable Dual Subtitles' })
        ).not.toBeChecked();
    });

    test('keeps ready settings interactive when a recoverable write error exists', () => {
        settingsError = new Error('write failed');

        render(<PopupApp />);

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        const subtitlesToggle = screen.getByRole('checkbox', {
            name: 'Enable Dual Subtitles',
        });
        expect(subtitlesToggle).not.toBeDisabled();

        fireEvent.click(subtitlesToggle);

        expect(updateSetting).toHaveBeenCalledWith('subtitlesEnabled', false);
        expect(logger.error).not.toHaveBeenCalled();
    });

    test('keeps every rendered settings read and interaction write inside the shared projection', async () => {
        const readKeys = new Set();
        settings = new Proxy(settings, {
            get(target, key, receiver) {
                if (typeof key === 'string') {
                    readKeys.add(key);
                }
                return Reflect.get(target, key, receiver);
            },
        });
        render(<PopupApp />);

        fireEvent.click(
            screen.getByRole('checkbox', {
                name: 'Enable Dual Subtitles',
            })
        );
        fireEvent.click(
            screen.getByRole('checkbox', {
                name: 'Use Official Subtitles When Available',
            })
        );
        fireEvent.change(
            screen.getByRole('combobox', { name: 'Original Language' }),
            { target: { value: 'es' } }
        );
        fireEvent.change(
            screen.getByRole('combobox', { name: 'Translate to' }),
            { target: { value: 'fr' } }
        );
        fireEvent.change(
            screen.getByRole('combobox', { name: 'Display Order' }),
            { target: { value: 'translation_top' } }
        );
        fireEvent.change(screen.getByRole('combobox', { name: 'Layout' }), {
            target: { value: 'row' },
        });
        for (const [name, value] of [
            ['Font Size', '1.4'],
            ['Vertical Gap', '0.5'],
            ['Vertical Position', '3.2'],
        ]) {
            const slider = screen.getByRole('slider', { name });
            fireEvent.change(slider, { target: { value } });
            fireEvent.pointerUp(slider);
        }
        fireEvent.change(
            screen.getByRole('spinbutton', { name: 'Time Offset (sec)' }),
            { target: { value: '0.4' } }
        );
        const appearanceDetails = screen
            .getByText('Subtitle Appearance & Timing')
            .closest('details');
        appearanceDetails.open = false;
        fireEvent(appearanceDetails, new Event('toggle', { bubbles: true }));
        await act(async () => {
            await Promise.resolve();
        });

        const writtenKeys = new Set([
            ...updateSetting.mock.calls.map(([key]) => key),
            ...updateSettings.mock.calls.flatMap(([updates]) =>
                Object.keys(updates)
            ),
        ]);
        const expectedWritableKeys = POPUP_SETTINGS_KEYS.filter(
            (key) => !['uiLanguage', 'loggingLevel'].includes(key)
        );

        expect(readKeys.size).toBeGreaterThan(0);
        expect(
            [...readKeys].filter((key) => !POPUP_SETTINGS_KEYS.includes(key))
        ).toEqual([]);
        expect([...writtenKeys].sort()).toEqual(expectedWritableKeys.sort());
    });

    test('uses the configured subtitles default when the setting is absent', () => {
        render(<PopupApp />);

        expect(
            screen.getByRole('checkbox', { name: 'Enable Dual Subtitles' })
        ).toBeChecked();
    });

    test('preserves an explicit false subtitles setting', () => {
        settings = { ...settings, subtitlesEnabled: false };
        render(<PopupApp />);

        expect(
            screen.getByRole('checkbox', { name: 'Enable Dual Subtitles' })
        ).not.toBeChecked();
    });

    test('uses the configured target-language default when the setting is absent', () => {
        render(<PopupApp />);

        expect(
            screen.getByRole('combobox', { name: 'Translate to' })
        ).toHaveValue('zh-CN');
    });

    test.each(sliderCases)(
        '$label sends one immediate preview and no redundant success message',
        async ({ key, label, previewValue }) => {
            updateSetting.mockResolvedValueOnce(undefined);
            render(<PopupApp />);

            const slider = screen.getByRole('slider', { name: label });
            fireEvent.change(slider, {
                target: { value: String(previewValue) },
            });
            fireEvent.pointerUp(slider);

            await waitFor(() =>
                expect(updateSetting).toHaveBeenCalledWith(key, previewValue)
            );
            expect(getImmediateMessages()).toEqual([{ [key]: previewValue }]);
        }
    );

    test.each(sliderCases)(
        '$label rolls a current failed preview back to its confirmed value',
        async ({ confirmedValue, key, label, previewValue }) => {
            const failedCommit = createDeferred();
            updateSetting.mockReturnValueOnce(failedCommit.promise);
            render(<PopupApp />);

            const slider = screen.getByRole('slider', { name: label });
            fireEvent.change(slider, {
                target: { value: String(previewValue) },
            });
            fireEvent.pointerUp(slider);

            expect(getImmediateMessages()).toEqual([{ [key]: previewValue }]);

            await act(async () => {
                failedCommit.reject(new Error('storage unavailable'));
                await failedCommit.promise.catch(() => undefined);
            });

            await waitFor(() =>
                expect(getImmediateMessages()).toEqual([
                    { [key]: previewValue },
                    { [key]: confirmedValue },
                ])
            );
        }
    );

    test('never replays an older successful preview and rolls a current failure back to the latest confirmation', async () => {
        const firstCommit = createDeferred();
        const latestCommit = createDeferred();
        updateSetting
            .mockReturnValueOnce(firstCommit.promise)
            .mockReturnValueOnce(latestCommit.promise);
        render(<PopupApp />);

        const slider = screen.getByRole('slider', { name: 'Font Size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.8' } });
        fireEvent.pointerUp(slider);

        expect(getImmediateMessages()).toEqual([
            { subtitleFontSize: 1.4 },
            { subtitleFontSize: 1.8 },
        ]);

        await act(async () => {
            firstCommit.resolve();
            await firstCommit.promise;
        });
        await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(2));
        expect(getImmediateMessages()).toEqual([
            { subtitleFontSize: 1.4 },
            { subtitleFontSize: 1.8 },
        ]);

        await act(async () => {
            latestCommit.reject(new Error('storage unavailable'));
            await latestCommit.promise.catch(() => undefined);
        });
        await waitFor(() =>
            expect(getImmediateMessages()).toEqual([
                { subtitleFontSize: 1.4 },
                { subtitleFontSize: 1.8 },
                { subtitleFontSize: 1.4 },
            ])
        );
    });

    test('does not roll back an older failed commit over a newer preview', async () => {
        const firstCommit = createDeferred();
        const latestCommit = createDeferred();
        updateSetting
            .mockReturnValueOnce(firstCommit.promise)
            .mockReturnValueOnce(latestCommit.promise);
        render(<PopupApp />);

        const slider = screen.getByRole('slider', { name: 'Font Size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.8' } });
        fireEvent.pointerUp(slider);

        await act(async () => {
            firstCommit.reject(new Error('storage unavailable'));
            await firstCommit.promise.catch(() => undefined);
        });
        await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(2));
        expect(getImmediateMessages()).toEqual([
            { subtitleFontSize: 1.4 },
            { subtitleFontSize: 1.8 },
        ]);

        await act(async () => {
            latestCommit.resolve();
            await latestCommit.promise;
        });
        expect(getImmediateMessages()).toEqual([
            { subtitleFontSize: 1.4 },
            { subtitleFontSize: 1.8 },
        ]);
    });

    test('uses new authoritative props as rollback authority for the next queued commit', async () => {
        const staleCommit = createDeferred();
        const latestCommit = createDeferred();
        updateSetting
            .mockReturnValueOnce(staleCommit.promise)
            .mockReturnValueOnce(latestCommit.promise);
        const view = render(<PopupApp />);
        const slider = screen.getByRole('slider', { name: 'Font Size' });

        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);

        settings = { ...settings, subtitleFontSize: 1.8 };
        view.rerender(<PopupApp />);
        fireEvent.change(slider, { target: { value: '2.0' } });
        fireEvent.pointerUp(slider);

        await act(async () => {
            staleCommit.reject(new Error('stale write failed'));
            await staleCommit.promise.catch(() => undefined);
        });
        await waitFor(() =>
            expect(
                updateSetting.mock.calls.filter(
                    ([key]) => key === 'subtitleFontSize'
                )
            ).toEqual([
                ['subtitleFontSize', 1.4],
                ['subtitleFontSize', 2],
            ])
        );
        expect(getImmediateMessages()).toEqual([
            { subtitleFontSize: 1.4 },
            { subtitleFontSize: 2 },
        ]);

        await act(async () => {
            latestCommit.reject(new Error('latest write failed'));
            await latestCommit.promise.catch(() => undefined);
        });
        await waitFor(() =>
            expect(getImmediateMessages()).toEqual([
                { subtitleFontSize: 1.4 },
                { subtitleFontSize: 2 },
                { subtitleFontSize: 1.8 },
            ])
        );
    });

    test('persists a queued release after unmount without scheduling status state', async () => {
        const firstCommit = createDeferred();
        const latestCommit = createDeferred();
        let markLatestCommitStarted;
        const latestCommitStarted = new Promise((resolve) => {
            markLatestCommitStarted = resolve;
        });
        updateSetting
            .mockReturnValueOnce(firstCommit.promise)
            .mockImplementationOnce((_key, value) => {
                markLatestCommitStarted(value);
                return latestCommit.promise;
            });
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

        const { unmount } = render(<PopupApp />);
        const slider = screen.getByRole('slider', { name: 'Font Size' });

        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.8' } });
        fireEvent.pointerUp(slider);

        expect(updateSetting).toHaveBeenCalledTimes(1);
        expect(updateSetting).toHaveBeenNthCalledWith(
            1,
            'subtitleFontSize',
            1.4
        );

        unmount();
        const statusTimersAtUnmount = setTimeoutSpy.mock.calls.length;

        await act(async () => {
            firstCommit.resolve();
            await firstCommit.promise;
            await latestCommitStarted;
        });

        expect(updateSetting).toHaveBeenCalledTimes(2);
        expect(updateSetting).toHaveBeenNthCalledWith(
            2,
            'subtitleFontSize',
            1.8
        );

        await act(async () => {
            latestCommit.resolve();
            await latestCommit.promise;
        });

        expect(setTimeoutSpy).toHaveBeenCalledTimes(statusTimersAtUnmount);
    });
});
