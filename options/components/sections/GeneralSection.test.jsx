import React from 'react';
import { render, screen } from '@testing-library/react';
import { GeneralSection } from './GeneralSection.jsx';

const t = (_key, fallback) => fallback;

function section(settings) {
    return (
        <GeneralSection t={t} settings={settings} onSettingChange={() => {}} />
    );
}

test('uses schema defaults without masking explicit falsy settings', () => {
    const view = render(section({}));
    const subtitles = screen.getByRole('checkbox', {
        name: 'Hide official subtitles:',
    });
    const logging = screen.getByRole('combobox', { name: 'Logging Level:' });

    expect(subtitles).toBeChecked();
    expect(logging).toHaveValue('3');

    view.rerender(section({ hideOfficialSubtitles: false, loggingLevel: 0 }));
    expect(subtitles).not.toBeChecked();
    expect(logging).toHaveValue('0');
});
