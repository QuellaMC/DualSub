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
const updateSettings = jest.fn();
const sendImmediateConfigUpdate = jest.fn();
const logger = { error: jest.fn() };
let initialLoadStatus = 'ready';
let settings;

const useSettings = jest.fn(() => ({
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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

describe('PopupApp', () => {
    beforeEach(() => {
        settings = {
            appearanceAccordionOpen: true,
            subtitleFontSize: 1.1,
            uiLanguage: 'en',
        };
        initialLoadStatus = 'ready';
        useSettings.mockClear();
        updateSetting.mockReset();
        updateSettings.mockReset();
        sendImmediateConfigUpdate.mockClear();
        logger.error.mockClear();
    });

    test('uses the shared popup projection and schema defaults', () => {
        render(<PopupApp />);

        expect(useSettings).toHaveBeenCalledWith(POPUP_SETTINGS_KEYS);
        expect(
            screen.getByRole('checkbox', { name: 'Enable Dual Subtitles' })
        ).toBeChecked();
        expect(
            screen.getByRole('combobox', { name: 'Translate to' })
        ).toHaveValue('zh-CN');
    });

    test('shows an unavailable state until authoritative settings recover', () => {
        settings = {};
        initialLoadStatus = 'unavailable';
        const view = render(<PopupApp />);

        expect(screen.getByRole('alert')).toHaveTextContent(
            /failed to load settings/i
        );
        expect(
            view.container.querySelector('input, select, button')
        ).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(
            'Settings initial load unavailable'
        );

        settings = { subtitlesEnabled: false, uiLanguage: 'en' };
        initialLoadStatus = 'ready';
        view.rerender(<PopupApp />);

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(
            screen.getByRole('checkbox', { name: 'Enable Dual Subtitles' })
        ).not.toBeChecked();
    });

    test('persists the official-subtitle pair and previews it immediately', async () => {
        settings = { ...settings, useOfficialTranslations: false };
        updateSettings.mockResolvedValue(undefined);
        render(<PopupApp />);

        fireEvent.click(
            screen.getByRole('checkbox', {
                name: 'Use Official Subtitles When Available',
            })
        );

        const changes = {
            useNativeSubtitles: true,
            useOfficialTranslations: true,
        };
        expect(updateSettings).toHaveBeenCalledWith(changes);
        await waitFor(() =>
            expect(sendImmediateConfigUpdate).toHaveBeenCalledWith(changes)
        );
    });

    test('previews a slider live and persists its released value once', async () => {
        updateSetting.mockResolvedValue(undefined);
        render(<PopupApp />);
        const slider = screen.getByRole('slider', { name: 'Font Size' });

        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);

        expect(sendImmediateConfigUpdate).toHaveBeenCalledTimes(1);
        expect(sendImmediateConfigUpdate).toHaveBeenCalledWith({
            subtitleFontSize: 1.4,
        });
        await waitFor(() =>
            expect(updateSetting).toHaveBeenCalledWith('subtitleFontSize', 1.4)
        );
        expect(
            updateSetting.mock.calls.filter(
                ([key]) => key === 'subtitleFontSize'
            )
        ).toHaveLength(1);
    });

    test('rolls back only the latest failed slider preview', async () => {
        const firstCommit = deferred();
        const latestCommit = deferred();
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
            firstCommit.resolve();
            await firstCommit.promise;
        });
        await act(async () => {
            latestCommit.reject(new Error('storage unavailable'));
            await latestCommit.promise.catch(() => undefined);
        });

        await waitFor(() =>
            expect(sendImmediateConfigUpdate.mock.calls).toEqual([
                [{ subtitleFontSize: 1.4 }],
                [{ subtitleFontSize: 1.8 }],
                [{ subtitleFontSize: 1.4 }],
            ])
        );
    });
});
