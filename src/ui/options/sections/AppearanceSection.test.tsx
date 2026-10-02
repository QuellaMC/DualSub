// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultValue, SETTINGS_KEYS } from '@/config/schema';
import { AppearanceSection } from './AppearanceSection';
import { OPTIONS_SETTINGS_KEYS, type OptionsSettings } from '../types';

const t = (key: string, ...subs: readonly (string | number)[]): string =>
    subs.length > 0 ? `${key}:${subs.join(',')}` : key;

function defaults(): OptionsSettings {
    const values: Record<string, unknown> = {};
    for (const key of SETTINGS_KEYS) {
        if ((OPTIONS_SETTINGS_KEYS as readonly string[]).includes(key)) {
            values[key] = getDefaultValue(key);
        }
    }
    return values as unknown as OptionsSettings;
}

function renderSection(
    overrides: Partial<OptionsSettings> = {},
    save = vi.fn(() => Promise.resolve(true))
) {
    const settings = { ...defaults(), ...overrides };
    const view = render(
        <AppearanceSection t={t} settings={settings} save={save} />
    );
    const update = (changes: Partial<OptionsSettings>): void =>
        view.rerender(
            <AppearanceSection
                t={t}
                settings={{ ...settings, ...changes }}
                save={save}
            />
        );
    return { save, update, unmount: view.unmount };
}

function previewSlot(name: 'original' | 'translated'): HTMLElement {
    return screen
        .getByRole('img', { name: 'lookPreviewLabel' })
        .querySelector<HTMLElement>(`.dualsub-${name}-subtitle`)!;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('AppearanceSection', () => {
    it("previews the chosen style with the renderer's own styling", () => {
        renderSection();
        expect(previewSlot('original')).toHaveTextContent(
            'lookPreviewOriginal'
        );
        expect(previewSlot('translated')).toHaveTextContent(
            'lookPreviewTranslation'
        );
        expect(previewSlot('original').style.fontWeight).toBe('normal');
        // 2% of a 1080-pixel picture.
        expect(previewSlot('original').style.fontSize).toBe('21.6px');
        cleanup();

        renderSection({ subtitleStyle: 'platform' });
        expect(previewSlot('original').style.fontWeight).toBe('bold');
        fireEvent.change(screen.getByLabelText('previewPlatformLabel'), {
            target: { value: 'disneyplus' },
        });
        expect(previewSlot('original').style.fontWeight).toBe('normal');
        expect(previewSlot('original').style.padding).toBe('0.5rem');
    });

    it('saves the style choice', () => {
        const { save } = renderSection();
        fireEvent.change(screen.getByLabelText('subtitleStyleLabel'), {
            target: { value: 'custom' },
        });
        expect(save).toHaveBeenCalledWith({ subtitleStyle: 'custom' });
    });

    it('selects the custom style on the first edit', () => {
        const { save } = renderSection();
        fireEvent.change(screen.getByLabelText('customFontLabel'), {
            target: { value: 'serif' },
        });
        expect(save).toHaveBeenCalledWith({ subtitleStyle: 'custom' });
    });

    it('previews each edit at once and saves the look after a pause, several edits as one write', async () => {
        const { save } = renderSection({ subtitleStyle: 'custom' });
        fireEvent.change(screen.getByLabelText('customFontLabel'), {
            target: { value: 'small-caps' },
        });
        expect(previewSlot('original').style.fontVariant).toBe('small-caps');
        fireEvent.change(
            screen.getByLabelText('customBackgroundOpacityLabel'),
            { target: { value: '0.25' } }
        );
        expect(previewSlot('original').style.backgroundColor).toBe(
            'rgba(0, 0, 0, 0.25)'
        );
        expect(save).not.toHaveBeenCalled();

        await waitFor(
            () =>
                expect(save).toHaveBeenCalledWith({
                    subtitleCustomLook: {
                        ...getDefaultValue('subtitleCustomLook'),
                        font: 'small-caps',
                        backgroundOpacity: 0.25,
                    },
                }),
            { timeout: 1500 }
        );
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('adopts a look arriving from storage unless an edit is pending', () => {
        const { update } = renderSection({ subtitleStyle: 'custom' });
        const font = screen.getByLabelText('customFontLabel');
        update({
            subtitleCustomLook: {
                ...getDefaultValue('subtitleCustomLook'),
                font: 'serif',
            },
        });
        expect(font).toHaveValue('serif');

        fireEvent.change(font, { target: { value: 'monospace' } });
        update({
            subtitleCustomLook: {
                ...getDefaultValue('subtitleCustomLook'),
                font: 'casual',
            },
        });
        expect(font).toHaveValue('monospace');
    });

    it('snaps back to the stored look when the write fails', async () => {
        renderSection(
            { subtitleStyle: 'custom' },
            vi.fn(() => Promise.resolve(false))
        );
        const font = screen.getByLabelText('customFontLabel');
        fireEvent.change(font, { target: { value: 'serif' } });
        expect(font).toHaveValue('serif');
        await waitFor(() => expect(font).toHaveValue('default'), {
            timeout: 1500,
        });
    });

    it('writes a pending edit when the section goes away', () => {
        const { save, unmount } = renderSection({ subtitleStyle: 'custom' });
        fireEvent.change(screen.getByLabelText('customFontLabel'), {
            target: { value: 'serif' },
        });
        expect(save).not.toHaveBeenCalled();
        unmount();
        expect(save).toHaveBeenCalledWith({
            subtitleCustomLook: {
                ...getDefaultValue('subtitleCustomLook'),
                font: 'serif',
            },
        });
    });
});
