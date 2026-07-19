import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const updateSetting = jest.fn().mockResolvedValue(true);
const updateSettings = jest.fn().mockResolvedValue(true);

jest.unstable_mockModule('../popup/hooks/index.js', () => ({
    useSettings: () => ({
        settings: { uiLanguage: 'en', selectedProvider: 'vertex_gemini' },
        updateSetting,
        updateSettings,
        loading: false,
        error: null,
    }),
    useTranslation: () => ({ t: (_key, fallback) => fallback }),
}));

jest.unstable_mockModule('./components/Sidebar.jsx', () => ({
    Sidebar: ({ onSectionChange }) => (
        <button onClick={() => onSectionChange('providers')}>Providers</button>
    ),
}));

jest.unstable_mockModule('./components/sections/ProvidersSection.jsx', () => ({
    ProvidersSection: ({ onSettingsChange }) => (
        <button
            onClick={() =>
                onSettingsChange({
                    vertexProjectId: 'project',
                    vertexAccessToken: 'token',
                })
            }
        >
            Save imported credentials
        </button>
    ),
}));

for (const modulePath of [
    './components/sections/GeneralSection.jsx',
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

const { OptionsApp } = await import('./OptionsApp.jsx');

describe('OptionsApp', () => {
    it('passes the atomic settings writer to provider imports', async () => {
        render(<OptionsApp />);
        fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Save imported credentials',
            })
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
