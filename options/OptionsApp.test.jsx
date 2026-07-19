import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const updateSetting = jest.fn();
const updateSettings = jest.fn();
const singleSaveResult = jest.fn();
const batchSaveResult = jest.fn();

let settingsHookState;

function createReadyHookState(overrides = {}) {
    return {
        settings: {
            uiLanguage: 'en',
            selectedProvider: 'vertex_gemini',
            vertexAccessToken: 'stored-token',
        },
        updateSetting,
        updateSettings,
        loading: false,
        initialLoadStatus: 'ready',
        error: null,
        ...overrides,
    };
}

const useSettings = jest.fn(() => settingsHookState);

jest.unstable_mockModule('../popup/hooks/index.js', () => ({
    useSettings,
    useTranslation: () => ({ t: (_key, fallback) => fallback }),
}));

jest.unstable_mockModule('./components/Sidebar.jsx', () => ({
    Sidebar: ({ onSectionChange }) => (
        <button onClick={() => onSectionChange('providers')}>Providers</button>
    ),
}));

jest.unstable_mockModule('./components/sections/GeneralSection.jsx', () => ({
    GeneralSection: ({ onSettingChange }) => (
        <button
            onClick={() =>
                void onSettingChange('loggingLevel', 4).then(singleSaveResult)
            }
        >
            Save general setting
        </button>
    ),
}));

jest.unstable_mockModule('./components/sections/ProvidersSection.jsx', () => ({
    ProvidersSection: ({ settings, onSettingsChange }) => (
        <>
            <output aria-label="Stored Vertex credential">
                {settings.vertexAccessToken}
            </output>
            <button
                onClick={() =>
                    void onSettingsChange({
                        vertexProjectId: 'project',
                        vertexAccessToken: 'token',
                    }).then(batchSaveResult)
                }
            >
                Save imported credentials
            </button>
        </>
    ),
}));

for (const modulePath of [
    './components/sections/TranslationSection.jsx',
    './components/sections/AIContextSection.jsx',
    './components/sections/AdvancedSection.jsx',
    './components/sections/AboutSection.jsx',
]) {
    const exportName = modulePath.match(/\/([^/]+)\.jsx$/)[1];
    jest.unstable_mockModule(modulePath, () => ({
        [exportName]: () => null,
    }));
}

const { OPTIONS_SETTINGS_KEYS } =
    await import('../shared/settingsProjections.js');
const { OptionsApp } = await import('./OptionsApp.jsx');

describe('OptionsApp', () => {
    beforeEach(() => {
        updateSetting.mockReset().mockResolvedValue(true);
        updateSettings.mockReset().mockResolvedValue(true);
        singleSaveResult.mockReset();
        batchSaveResult.mockReset();
        useSettings.mockClear();
        settingsHookState = createReadyHookState();
    });

    it('requests the exact Options projection with explicit sensitive access', () => {
        render(<OptionsApp />);

        expect(useSettings).toHaveBeenCalled();
        const [keys, options] = useSettings.mock.calls[0];
        expect(keys).toBe(OPTIONS_SETTINGS_KEYS);
        const sensitiveDescriptor = Object.getOwnPropertyDescriptor(
            options,
            'includeSensitive'
        );
        expect(sensitiveDescriptor).toEqual(
            expect.objectContaining({ value: true })
        );
        expect(sensitiveDescriptor).not.toHaveProperty('get');
    });

    it('passes a loaded credential to the provider controls', () => {
        render(<OptionsApp />);
        fireEvent.click(screen.getByRole('button', { name: 'Providers' }));

        expect(
            screen.getByRole('status', {
                name: 'Stored Vertex credential',
            })
        ).toHaveTextContent('stored-token');
    });

    it('renders no settings controls when the authoritative load is unavailable', () => {
        settingsHookState = createReadyHookState({
            settings: {},
            initialLoadStatus: 'unavailable',
            error: new Error('raw storage failure with credential-name'),
        });

        render(<OptionsApp />);

        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to load settings. Please reload the page and try again.'
        );
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(document.body).not.toHaveTextContent(
            'raw storage failure with credential-name'
        );
        expect(updateSetting).not.toHaveBeenCalled();
        expect(updateSettings).not.toHaveBeenCalled();
    });

    it('restores authoritative controls after an unavailable load recovers', async () => {
        settingsHookState = createReadyHookState({
            settings: {},
            initialLoadStatus: 'unavailable',
        });
        const view = render(<OptionsApp />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();

        settingsHookState = createReadyHookState();
        view.rerender(<OptionsApp />);

        expect(
            screen.getByRole('button', { name: 'Providers' })
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole('button', { name: 'Save general setting' })
        );
        await waitFor(() => {
            expect(updateSetting).toHaveBeenCalledWith('loggingLevel', 4);
            expect(singleSaveResult).toHaveBeenCalledWith(true);
        });
    });

    it('keeps the existing loading state free of settings controls', () => {
        settingsHookState = createReadyHookState({
            settings: {},
            loading: true,
            initialLoadStatus: 'loading',
        });

        render(<OptionsApp />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading...');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('keeps ready controls available when the hook reports a recoverable error', () => {
        settingsHookState = createReadyHookState({
            error: new Error('raw recoverable storage detail'),
        });

        render(<OptionsApp />);

        expect(
            screen.getByRole('button', { name: 'Save general setting' })
        ).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to save settings. Please try again.'
        );
        expect(document.body).not.toHaveTextContent(
            'raw recoverable storage detail'
        );
    });

    it('returns false and shows a generic error after a single-setting write fails', async () => {
        updateSetting.mockRejectedValueOnce(
            new Error('raw single-write credential detail')
        );

        render(<OptionsApp />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Save general setting' })
        );

        await waitFor(() =>
            expect(singleSaveResult).toHaveBeenCalledWith(false)
        );
        expect(updateSetting).toHaveBeenCalledWith('loggingLevel', 4);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to save settings. Please try again.'
        );
        expect(document.body).not.toHaveTextContent(
            'raw single-write credential detail'
        );
        expect(updateSettings).not.toHaveBeenCalled();
    });

    it('does not invoke a function-valued single-setting rejection', async () => {
        const hostileRejection = jest.fn();
        updateSetting.mockRejectedValueOnce(hostileRejection);

        render(<OptionsApp />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Save general setting' })
        );

        await waitFor(() =>
            expect(singleSaveResult).toHaveBeenCalledWith(false)
        );
        expect(updateSetting).toHaveBeenCalledWith('loggingLevel', 4);
        expect(hostileRejection).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to save settings. Please try again.'
        );
    });

    it('shows the generic error after a falsy single-setting rejection', async () => {
        updateSetting.mockRejectedValueOnce(null);

        render(<OptionsApp />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Save general setting' })
        );

        await waitFor(() =>
            expect(singleSaveResult).toHaveBeenCalledWith(false)
        );
        expect(updateSetting).toHaveBeenCalledWith('loggingLevel', 4);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to save settings. Please try again.'
        );
    });

    it('returns false and shows a generic error after an atomic credential write fails', async () => {
        updateSettings.mockRejectedValueOnce(
            new Error('raw batch credential detail')
        );

        render(<OptionsApp />);
        fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Save imported credentials',
            })
        );

        await waitFor(() =>
            expect(batchSaveResult).toHaveBeenCalledWith(false)
        );
        expect(updateSettings).toHaveBeenCalledWith({
            vertexProjectId: 'project',
            vertexAccessToken: 'token',
        });
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to save settings. Please try again.'
        );
        expect(document.body).not.toHaveTextContent(
            'raw batch credential detail'
        );
        expect(updateSetting).not.toHaveBeenCalled();
    });

    it('shows the generic error after a falsy atomic rejection', async () => {
        updateSettings.mockRejectedValueOnce(null);

        render(<OptionsApp />);
        fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Save imported credentials',
            })
        );

        await waitFor(() =>
            expect(batchSaveResult).toHaveBeenCalledWith(false)
        );
        expect(updateSettings).toHaveBeenCalledWith({
            vertexProjectId: 'project',
            vertexAccessToken: 'token',
        });
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to save settings. Please try again.'
        );
    });

    it('does not invoke a function-valued atomic rejection', async () => {
        const hostileRejection = jest.fn();
        updateSettings.mockRejectedValueOnce(hostileRejection);

        render(<OptionsApp />);
        fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Save imported credentials',
            })
        );

        await waitFor(() =>
            expect(batchSaveResult).toHaveBeenCalledWith(false)
        );
        expect(updateSettings).toHaveBeenCalledWith({
            vertexProjectId: 'project',
            vertexAccessToken: 'token',
        });
        expect(hostileRejection).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to save settings. Please try again.'
        );
    });

    it('passes the atomic settings writer to provider imports', async () => {
        render(<OptionsApp />);
        fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Save imported credentials',
            })
        );

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledWith({
                vertexProjectId: 'project',
                vertexAccessToken: 'token',
            });
            expect(batchSaveResult).toHaveBeenCalledWith(true);
        });
        expect(updateSetting).not.toHaveBeenCalled();
    });
});
