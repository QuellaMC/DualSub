// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultValue, SETTINGS_KEYS } from '@/config/schema';
import {
    OPTIONS_SETTINGS_KEYS,
    type OptionsSettings,
    type SaveSettings,
} from '../types';
import { FeedbackProvider, type Feedback } from '../shell/feedback';
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

const feedback: Feedback = {
    apply: (change) => change().then(() => true),
    takeBackUndo: () => undefined,
    notify: () => undefined,
};

function renderSection(
    overrides: Partial<OptionsSettings> = {},
    save: SaveSettings = vi.fn(() => Promise.resolve(true))
) {
    const settings = { ...defaults(), ...overrides };
    const section = (shown: OptionsSettings) => (
        <FeedbackProvider value={feedback}>
            <LookSection t={t} settings={shown} save={save} />
        </FeedbackProvider>
    );
    const view = render(section(settings));
    const update = (changes: Partial<OptionsSettings>): void =>
        view.rerender(section({ ...settings, ...changes }));
    return { save, update, unmount: view.unmount };
}

/** Opens a row of the pane by its name. */
function openRow(name: string): void {
    fireEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', {
            name: new RegExp(`^${name}`),
        })
    );
}

function row(name: string): HTMLElement {
    return within(screen.getByRole('complementary')).getByRole('button', {
        name: new RegExp(`^${name}`),
    });
}

function line(name: 'original' | 'translated'): HTMLElement {
    return document.querySelector<HTMLElement>(
        `.stage .dualsub-${name}-subtitle`
    )!;
}

const LOOK = getDefaultValue('subtitleCustomLook');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('LookSection', () => {
    it('applies a ready-made look with a named toast, in the custom style', () => {
        const { save } = renderSection({ subtitleStyle: 'platform' });
        openRow('lookRowLook');
        fireEvent.click(
            screen.getByRole('button', { name: 'lookPresetContrast' })
        );
        expect(save).toHaveBeenCalledWith(
            {
                subtitleStyle: 'custom',
                subtitleCustomLook: expect.objectContaining({
                    bold: true,
                    edge: 'outline',
                }) as unknown,
            },
            { message: 'toastPreset:lookPresetContrast' }
        );
    });

    it('looks like the site on request, which its own settings then decide', () => {
        const { save, update } = renderSection();
        openRow('lookRowLook');
        fireEvent.click(
            screen.getByRole('button', { name: 'lookStylePlatform' })
        );
        expect(save).toHaveBeenCalledWith(
            { subtitleStyle: 'platform' },
            { message: 'toastStylePlatform' }
        );

        update({ subtitleStyle: 'platform' });
        expect(screen.getByText('lookStylePlatformHelp')).toBeInTheDocument();
        expect(screen.queryByLabelText('lookFontLabel')).toBeNull();
        expect(
            screen.getByRole('group', { name: 'lookPreviewSite' })
        ).toBeInTheDocument();
    });

    it('shows each edit on the stage at once and saves after a pause, several edits as one write', async () => {
        const { save } = renderSection();
        openRow('lookRowLook');
        fireEvent.change(screen.getByLabelText('lookFontLabel'), {
            target: { value: 'small-caps' },
        });
        fireEvent.change(screen.getByLabelText('lookBoxOpacityLabel'), {
            target: { value: '0.25' },
        });
        expect(line('original').style.fontVariant).toBe('small-caps');
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
        openRow('lookRowLook');
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
        openRow('lookRowLook');
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
        openRow('lookRowLook');
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
        openRow('lookRowLook');
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
        openRow('lookRowLook');
        const opacity = screen.getByLabelText('lookBoxOpacityLabel');
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
        openRow('lookRowLook');
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
        openRow('lookRowLook');
        fireEvent.click(screen.getByRole('switch', { name: 'lookBoldLabel' }));
        fireEvent.click(
            screen.getByRole('button', { name: 'lookPresetContrast' })
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
        openRow('lookRowPosition');
        fireEvent.click(screen.getByRole('button', { name: /lookMoveUp/ }));
        expect(save).toHaveBeenCalledWith(
            { subtitleVerticalPosition: 9.9 },
            { message: 'toastMovedUp' }
        );
    });

    it('opens the settings of the line clicked on the stage', () => {
        renderSection();
        expect(row('lookRowSize')).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(line('original'));
        expect(row('lookRowLook')).toHaveAttribute('aria-expanded', 'true');
        expect(row('lookRowSize')).toHaveAttribute('aria-expanded', 'false');

        fireEvent.keyDown(line('translated'), { key: 'Enter' });
        expect(row('lookTranslationColorTitle')).toHaveAttribute(
            'aria-expanded',
            'true'
        );
        expect(line('translated')).toHaveClass('stage-picked');
    });

    it('drags the subtitles to a new height and saves it once, where they drop', () => {
        const { save } = renderSection();
        const stage = screen.getByRole('group', { name: 'previewLabel' });
        vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(0, 0, 640, 360)
        );
        fireEvent.pointerDown(line('original'), {
            button: 0,
            buttons: 1,
            pointerId: 1,
            clientY: 300,
        });
        fireEvent.pointerMove(stage, {
            buttons: 1,
            pointerId: 1,
            clientY: 282,
        });
        fireEvent.pointerMove(stage, {
            buttons: 1,
            pointerId: 1,
            clientY: 264,
        });
        expect(save).not.toHaveBeenCalled();
        expect(row('lookRowPosition')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByLabelText('lookExactPosition')).toHaveValue('5');

        fireEvent.pointerUp(stage, { pointerId: 1 });
        fireEvent.click(stage);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(
            { subtitleVerticalPosition: 5 },
            { message: 'toastMoved' }
        );
    });

    it('takes a press that barely moves for a click on the line', () => {
        const { save } = renderSection();
        const stage = screen.getByRole('group', { name: 'previewLabel' });
        fireEvent.pointerDown(line('original'), {
            button: 0,
            buttons: 1,
            pointerId: 1,
            clientY: 300,
        });
        fireEvent.pointerMove(stage, {
            buttons: 1,
            pointerId: 1,
            clientY: 298,
        });
        fireEvent.pointerUp(stage, { pointerId: 1 });
        fireEvent.click(line('original'));
        expect(save).not.toHaveBeenCalled();
        expect(row('lookRowLook')).toHaveAttribute('aria-expanded', 'true');
    });

    it('moves the subtitles with the arrow keys, further with Shift', async () => {
        const { save } = renderSection();
        fireEvent.keyDown(line('original'), { key: 'ArrowUp' });
        expect(save).toHaveBeenLastCalledWith(
            { subtitleVerticalPosition: 3.1 },
            { message: 'toastMovedUp' }
        );
        fireEvent.keyDown(line('original'), {
            key: 'ArrowDown',
            shiftKey: true,
        });
        await waitFor(() =>
            expect(save).toHaveBeenLastCalledWith(
                { subtitleVerticalPosition: 2.1 },
                { message: 'toastMovedDown' }
            )
        );
        expect(row('lookRowPosition')).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows the subtitles full screen with their own controls, and hands focus back after', () => {
        const { save } = renderSection();
        const open = screen.getByRole('button', { name: 'lookFullScreen' });
        fireEvent.click(open);
        const dialog = screen.getByRole('dialog', { name: 'lookFullScreen' });
        const done = within(dialog).getByRole('button', { name: 'commonDone' });
        expect(done).toHaveFocus();

        fireEvent.click(
            within(dialog).getByRole('button', { name: 'sizeLarge' })
        );
        expect(save).toHaveBeenCalledWith(
            { subtitleFontScale: 1.3 },
            { message: 'toastSize:sizeLarge' }
        );

        fireEvent.click(done);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(open).toHaveFocus();
    });
});
