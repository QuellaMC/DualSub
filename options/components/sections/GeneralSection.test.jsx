import React from 'react';
import { render, screen } from '@testing-library/react';
import { GeneralSection } from './GeneralSection.jsx';

const t = (_key, fallback) => fallback;

function renderSection(settings = {}) {
    return render(
        <GeneralSection t={t} settings={settings} onSettingChange={() => {}} />
    );
}

describe('GeneralSection defaults', () => {
    test('uses the configured default when hideOfficialSubtitles is absent', () => {
        renderSection();

        expect(
            screen.getByRole('checkbox', {
                name: 'Hide official subtitles:',
            })
        ).toBeChecked();
    });

    test('preserves an explicit false hideOfficialSubtitles setting', () => {
        renderSection({ hideOfficialSubtitles: false });

        expect(
            screen.getByRole('checkbox', {
                name: 'Hide official subtitles:',
            })
        ).not.toBeChecked();
    });

    test('uses the configured logging default when the setting is absent', () => {
        renderSection();

        expect(
            screen.getByRole('combobox', { name: 'Logging Level:' })
        ).toHaveValue('3');
    });

    test('preserves the explicit off logging level', () => {
        renderSection({ loggingLevel: 0 });

        expect(
            screen.getByRole('combobox', { name: 'Logging Level:' })
        ).toHaveValue('0');
    });
});
