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
import { browser } from 'wxt/browser';
import { getDefaultValue, SETTINGS_KEYS } from '@/config/schema';
import { AIContextSection } from './AIContextSection';
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

function renderSection(overrides: Partial<OptionsSettings> = {}) {
    const save = vi.fn(() => Promise.resolve(true));
    const settings = { ...defaults(), aiContextEnabled: true, ...overrides };
    render(<AIContextSection t={t} settings={settings} save={save} />);
    return { save };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('AIContextSection', () => {
    it('shows only the toggle while the feature is off', () => {
        const { save } = renderSection({ aiContextEnabled: false });
        expect(
            screen.queryByLabelText('aiContextProviderLabel')
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('aiContextEnabledLabel'));
        expect(save).toHaveBeenCalledWith({ aiContextEnabled: true });
    });

    it('saves context types as a list and warns when none remain', () => {
        const { save } = renderSection({ aiContextTypes: ['cultural'] });
        fireEvent.click(screen.getByLabelText('contextTypeHistoricalLabel'));
        expect(save).toHaveBeenCalledWith({
            aiContextTypes: ['cultural', 'historical'],
        });
        cleanup();

        renderSection({ aiContextTypes: [] });
        expect(screen.getByRole('alert')).toHaveTextContent(
            'aiContextTypesRequired'
        );
    });

    it('commits numeric drafts only when they are in range', async () => {
        const { save } = renderSection();
        const timeout = screen.getByLabelText('aiContextTimeoutLabel');
        fireEvent.change(timeout, { target: { value: '100' } });
        fireEvent.blur(timeout);
        expect(save).not.toHaveBeenCalled();
        expect(timeout).toHaveAttribute('aria-invalid', 'true');

        fireEvent.change(timeout, { target: { value: '15000' } });
        fireEvent.keyDown(timeout, { key: 'Enter' });
        await waitFor(() =>
            expect(save).toHaveBeenCalledWith({ aiContextTimeout: 15000 })
        );

        fireEvent.change(screen.getByLabelText('aiContextRetryAttemptsLabel'), {
            target: { value: '9' },
        });
        expect(save).not.toHaveBeenCalledWith({ aiContextRetryAttempts: 9 });
        fireEvent.change(screen.getByLabelText('aiContextRetryAttemptsLabel'), {
            target: { value: '2' },
        });
        expect(save).toHaveBeenCalledWith({ aiContextRetryAttempts: 2 });
    });

    it('offers the model catalog for each AI provider', () => {
        renderSection();
        expect(screen.getByLabelText('openaiModelLabel')).toHaveValue(
            'gpt-5.6-luna'
        );
        cleanup();

        renderSection({
            aiContextProvider: 'gemini',
            geminiModel: 'custom-gemini',
        });
        const select = screen.getByLabelText('geminiModelLabel');
        expect(select).toHaveValue('custom-gemini');
        expect(
            [...select.querySelectorAll('option')].map((option) => option.value)
        ).toEqual([
            'custom-gemini',
            'gemini-3.5-flash',
            'gemini-2.5-flash',
            'gemini-2.5-pro',
        ]);
    });

    it('requests a custom OpenAI host from the click and reports the outcome', async () => {
        const request = vi
            .spyOn(browser.permissions, 'request')
            .mockResolvedValue(false as never);
        renderSection({ openaiBaseUrl: 'https://llm.example.com/v1' });
        expect(
            screen.getByRole('group', { name: 'llm.example.com' })
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole('button', { name: 'openaiHostPermissionButton' })
        );
        expect(request).toHaveBeenCalledWith({
            origins: ['https://llm.example.com/*'],
        });
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'openaiHostPermissionDenied'
            )
        );
    });

    it('does not offer a permission request for an invalid base URL', () => {
        renderSection();
        const input = screen.getByLabelText('openaiBaseUrlLabel');
        fireEvent.change(input, { target: { value: 'nope' } });
        expect(
            screen.getByRole('button', { name: 'openaiHostPermissionButton' })
        ).toBeDisabled();
    });
});
