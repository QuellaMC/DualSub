// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultValue, SETTINGS_KEYS } from '@/config/schema';
import {
    OPTIONS_SETTINGS_KEYS,
    type OptionsSettings,
    type SaveSettings,
} from '../types';
import { LookSection } from './LookSection';

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
    save: SaveSettings = vi.fn(() => Promise.resolve(true))
) {
    const settings = { ...defaults(), ...overrides };
    const onDraft = vi.fn();
    const view = render(
        <LookSection t={t} settings={settings} save={save} onDraft={onDraft} />
    );
    fireEvent.click(
        screen.getByRole('button', { name: 'lookCustomizeButton' })
    );
    const update = (changes: Partial<OptionsSettings>): void =>
        view.rerender(
            <LookSection
                t={t}
                settings={{ ...settings, ...changes }}
                save={save}
                onDraft={onDraft}
            />
        );
    return { save, update, onDraft, unmount: view.unmount };
}

const LOOK = getDefaultValue('subtitleCustomLook');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('LookSection', () => {
    it('applies a ready-made look with a named toast', () => {
        const { save } = renderSection();
        fireEvent.click(
            screen.getByRole('button', { name: /lookPresetContrast/ })
        );
        expect(save).toHaveBeenCalledWith(
            {
                subtitleCustomLook: expect.objectContaining({
                    bold: true,
                    edge: 'outline',
                }) as unknown,
            },
            { message: 'toastPreset:lookPresetContrast' }
        );
    });

    it('shares each edit with the preview at once and saves after a pause, several edits as one write', async () => {
        const { save, onDraft } = renderSection();
        fireEvent.change(screen.getByLabelText('lookFontLabel'), {
            target: { value: 'small-caps' },
        });
        fireEvent.change(screen.getByLabelText(/lookBoxOpacityLabel/), {
            target: { value: '0.25' },
        });
        expect(onDraft).toHaveBeenLastCalledWith(
            expect.objectContaining({
                subtitleCustomLook: {
                    ...LOOK,
                    font: 'small-caps',
                    backgroundOpacity: 0.25,
                },
            })
        );
        expect(save).not.toHaveBeenCalled();

        await waitFor(
            () =>
                expect(save).toHaveBeenCalledWith(
                    {
                        subtitleCustomLook: {
                            ...LOOK,
                            font: 'small-caps',
                            backgroundOpacity: 0.25,
                        },
                    },
                    'quiet'
                ),
            { timeout: 1500 }
        );
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('adopts a look arriving from storage unless an edit is pending', () => {
        const { update } = renderSection();
        const font = screen.getByLabelText('lookFontLabel');
        update({ subtitleCustomLook: { ...LOOK, font: 'serif' } });
        expect(font).toHaveValue('serif');

        fireEvent.change(font, { target: { value: 'monospace' } });
        update({ subtitleCustomLook: { ...LOOK, font: 'casual' } });
        expect(font).toHaveValue('monospace');
    });

    it('snaps back to the stored look when the write fails', async () => {
        renderSection(
            {},
            vi.fn(() => Promise.resolve(false))
        );
        const font = screen.getByLabelText('lookFontLabel');
        fireEvent.change(font, { target: { value: 'serif' } });
        expect(font).toHaveValue('serif');
        await waitFor(() => expect(font).toHaveValue('default'), {
            timeout: 1500,
        });
    });

    it('keeps one write in flight and writes the newest draft once it settles', async () => {
        const first = Promise.withResolvers<boolean>();
        const save: SaveSettings = vi
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockResolvedValue(true);
        renderSection({}, save);
        const font = screen.getByLabelText('lookFontLabel');
        fireEvent.change(font, { target: { value: 'serif' } });
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1), {
            timeout: 1500,
        });

        fireEvent.change(font, { target: { value: 'monospace' } });
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(save).toHaveBeenCalledTimes(1);

        first.resolve(true);
        await waitFor(() =>
            expect(save).toHaveBeenLastCalledWith(
                { subtitleCustomLook: { ...LOOK, font: 'monospace' } },
                'quiet'
            )
        );
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('writes a pending edit when the section goes away', () => {
        const { save, unmount } = renderSection();
        fireEvent.change(screen.getByLabelText('lookFontLabel'), {
            target: { value: 'serif' },
        });
        expect(save).not.toHaveBeenCalled();
        unmount();
        expect(save).toHaveBeenCalledWith(
            { subtitleCustomLook: { ...LOOK, font: 'serif' } },
            'quiet'
        );
    });

    it('writes an edit as soon as the interaction that made it ends', async () => {
        const { save } = renderSection();
        const opacity = screen.getByLabelText(/lookBoxOpacityLabel/);
        fireEvent.change(opacity, { target: { value: '0.25' } });
        expect(save).not.toHaveBeenCalled();
        fireEvent.pointerUp(opacity);
        expect(save).toHaveBeenLastCalledWith(
            { subtitleCustomLook: { ...LOOK, backgroundOpacity: 0.25 } },
            'quiet'
        );
        await act(() => Promise.resolve());

        fireEvent.change(opacity, { target: { value: '0.5' } });
        fireEvent.keyUp(opacity, { key: 'ArrowRight' });
        expect(save).toHaveBeenLastCalledWith(
            { subtitleCustomLook: { ...LOOK, backgroundOpacity: 0.5 } },
            'quiet'
        );
    });

    it('starts writing a waiting edit before the page goes away', () => {
        const { save } = renderSection();
        fireEvent.change(screen.getByLabelText('lookFontLabel'), {
            target: { value: 'small-caps' },
        });
        window.dispatchEvent(new Event('pagehide'));
        expect(save).toHaveBeenCalledWith(
            { subtitleCustomLook: { ...LOOK, font: 'small-caps' } },
            'quiet'
        );
    });

    it('lets a pick replace an edit still waiting for its pause', async () => {
        const { save } = renderSection();
        fireEvent.click(screen.getByRole('switch', { name: 'lookBoldLabel' }));
        fireEvent.click(
            screen.getByRole('button', { name: /lookPresetContrast/ })
        );
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(
            {
                subtitleCustomLook: expect.objectContaining({
                    edge: 'outline',
                    backgroundOpacity: 0.85,
                }) as unknown,
            },
            { message: 'toastPreset:lookPresetContrast' }
        );
    });

    it('moves the subtitles in steps within the picture', () => {
        const { save } = renderSection({ subtitleVerticalPosition: 9.5 });
        fireEvent.click(screen.getByRole('button', { name: /lookMoveUp/ }));
        expect(save).toHaveBeenCalledWith(
            { subtitleVerticalPosition: 9.9 },
            { message: 'toastMovedUp' }
        );
    });
});
