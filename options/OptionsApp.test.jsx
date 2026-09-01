import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const updateSetting = jest.fn();
const updateSettings = jest.fn();
let settingsHookState;

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
        <button onClick={() => void onSettingChange('loggingLevel', 4)}>
            Save setting
        </button>
    ),
}));

jest.unstable_mockModule('./components/sections/ProvidersSection.jsx', () => ({
    ProvidersSection: ({ settings, onSettingsChange }) => (
        <>
            <output aria-label="Stored credential">
                {settings.vertexAccessToken}
            </output>
            <button
                onClick={() =>
                    void onSettingsChange({
                        vertexProjectId: 'project',
                        vertexAccessToken: 'token',
                    })
                }
            >
                Import credentials
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
    jest.unstable_mockModule(modulePath, () => ({ [exportName]: () => null }));
}

const { OPTIONS_SETTINGS_KEYS } =
    await import('../shared/settingsProjections.js');
const { OptionsApp } = await import('./OptionsApp.jsx');

function readyState(overrides = {}) {
    return {
        settings: {
            uiLanguage: 'en',
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

describe('OptionsApp', () => {
    beforeEach(() => {
        updateSetting.mockReset().mockResolvedValue(true);
        updateSettings.mockReset().mockResolvedValue(true);
        useSettings.mockClear();
        settingsHookState = readyState();
    });

    test('loads the options projection with sensitive credentials', () => {
        render(<OptionsApp />);

        expect(useSettings).toHaveBeenCalledWith(OPTIONS_SETTINGS_KEYS, {
            includeSensitive: true,
        });
        fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
        expect(screen.getByLabelText('Stored credential')).toHaveTextContent(
            'stored-token'
        );
    });

    test.each([
        [
            'loading',
            { loading: true, initialLoadStatus: 'loading' },
            'Loading...',
        ],
        [
            'unavailable',
            { settings: {}, initialLoadStatus: 'unavailable' },
            'Unable to load settings. Please reload the page and try again.',
        ],
    ])(
        'hides settings controls while settings are %s',
        (_name, state, text) => {
            settingsHookState = readyState(state);
            render(<OptionsApp />);

            expect(screen.getByText(text)).toBeInTheDocument();
            expect(screen.queryByRole('button')).not.toBeInTheDocument();
        }
    );

    test('keeps controls available for recoverable errors without exposing details', () => {
        settingsHookState = readyState({
            error: new Error('storage detail containing credential-name'),
        });
        render(<OptionsApp />);

        expect(
            screen.getByRole('button', { name: 'Save setting' })
        ).toBeVisible();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Unable to save settings. Please try again.'
        );
        expect(document.body).not.toHaveTextContent('credential-name');
    });

    test('reports a failed setting write through generic feedback', async () => {
        updateSetting.mockRejectedValueOnce(new Error('private write detail'));
        render(<OptionsApp />);

        fireEvent.click(screen.getByRole('button', { name: 'Save setting' }));

        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(
                'Unable to save settings. Please try again.'
            )
        );
        expect(updateSetting).toHaveBeenCalledWith('loggingLevel', 4);
        expect(document.body).not.toHaveTextContent('private write detail');
    });

    test('passes imported credentials to the atomic settings writer', async () => {
        render(<OptionsApp />);
        fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
        fireEvent.click(
            screen.getByRole('button', { name: 'Import credentials' })
        );

        await waitFor(() =>
            expect(updateSettings).toHaveBeenCalledWith({
                vertexProjectId: 'project',
                vertexAccessToken: 'token',
            })
        );
        expect(updateSetting).not.toHaveBeenCalled();
    });
});
