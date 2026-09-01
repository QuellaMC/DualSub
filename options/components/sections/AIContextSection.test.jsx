import React from 'react';
import { jest } from '@jest/globals';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { AIContextSection } from './AIContextSection.jsx';
import { getDefaultValue } from '../../../config/configSchema.js';

const t = (_key, fallback = '', ...values) => {
    let index = 0;
    return fallback.replace(/%[sd]/g, () => values[index++]);
};

function section(overrides = {}, onSettingChange = jest.fn(), translate = t) {
    return (
        <AIContextSection
            t={translate}
            settings={{
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                aiContextTypes: ['cultural'],
                ...overrides,
            }}
            onSettingChange={onSettingChange}
        />
    );
}

describe('AIContextSection', () => {
    afterEach(() => {
        delete chrome.permissions;
    });

    test('uses schema defaults without masking explicit settings', () => {
        const view = render(section());

        expect(screen.getByLabelText('Base URL:')).toHaveValue(
            getDefaultValue('openaiBaseUrl')
        );
        expect(screen.getByLabelText('Model:')).toHaveValue(
            getDefaultValue('openaiModel')
        );
        expect(screen.getByLabelText('Request Timeout (ms):')).toHaveValue(
            30000
        );
        expect(
            screen.getByRole('checkbox', { name: 'Enable Caching:' })
        ).toBeChecked();
        expect(screen.getByLabelText('Retry Attempts:')).toHaveValue(3);

        view.rerender(
            section({
                openaiBaseUrl: '',
                openaiModel: '',
                aiContextCacheEnabled: false,
                aiContextRetryAttempts: 0,
                aiContextTimeout: 0,
            })
        );
        expect(screen.getByLabelText('Base URL:')).toHaveValue('');
        expect(screen.getByLabelText('Model:')).toHaveValue('');
        expect(screen.getByLabelText('Request Timeout (ms):')).toHaveValue(0);
        expect(
            screen.getByRole('checkbox', { name: 'Enable Caching:' })
        ).not.toBeChecked();
        expect(screen.getByLabelText('Retry Attempts:')).toHaveValue(0);
    });

    test('renders current provider choices and keeps API keys sensitive', () => {
        const onSettingChange = jest.fn();
        const view = render(section({}, onSettingChange));

        expect(
            Array.from(
                document.querySelector('#openaiModelOptions').options,
                ({ value }) => value
            )
        ).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6']);
        const apiKey = screen.getByLabelText('API Key:');
        expect(apiKey).toHaveAttribute('type', 'password');
        fireEvent.change(apiKey, { target: { value: 'secret' } });
        expect(onSettingChange).toHaveBeenCalledWith('openaiApiKey', 'secret');

        view.rerender(section({ aiContextProvider: 'gemini' }));
        expect(screen.getByLabelText('Model:')).toHaveValue('gemini-3.5-flash');
    });

    test('commits a complete numeric draft instead of intermediate prefixes', async () => {
        const onSettingChange = jest.fn().mockResolvedValue(true);
        render(section({ aiContextTimeout: 10000 }, onSettingChange));
        const timeout = screen.getByLabelText('Request Timeout (ms):');

        for (const value of ['3', '30', '300', '3000', '30000']) {
            fireEvent.change(timeout, { target: { value } });
        }
        expect(onSettingChange).not.toHaveBeenCalled();

        fireEvent.blur(timeout);
        await waitFor(() =>
            expect(onSettingChange).toHaveBeenCalledWith(
                'aiContextTimeout',
                30000
            )
        );
    });

    test('keeps invalid drafts local with accessible feedback', () => {
        const onSettingChange = jest.fn();
        render(section({}, onSettingChange));
        const model = screen.getByLabelText('Model:');

        fireEvent.change(model, { target: { value: '   ' } });
        fireEvent.blur(model);

        expect(model).toHaveValue('   ');
        expect(model).toHaveAttribute('aria-invalid', 'true');
        expect(model).toHaveAccessibleDescription(
            'Enter a valid value before saving.'
        );
        expect(onSettingChange).not.toHaveBeenCalled();
    });

    test('persists context type changes and warns when none are selected', () => {
        const onSettingChange = jest.fn();
        render(
            section(
                { aiContextTypes: [], aiContextProvider: 'gemini' },
                onSettingChange
            )
        );

        expect(
            screen.getByText('Select at least one context type.')
        ).toBeVisible();
        fireEvent.click(
            screen.getByRole('checkbox', { name: 'Cultural Context:' })
        );
        expect(onSettingChange).toHaveBeenCalledWith('aiContextTypes', [
            'cultural',
        ]);
    });

    test('discloses and requests the configured Chrome host scope', async () => {
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(true),
        };
        render(
            section({ openaiBaseUrl: 'https://models.example.com:8443/v1' })
        );
        const disclosure =
            'Configured endpoint: https://models.example.com:8443/v1. Chrome permission scope: https://models.example.com/* (all paths and ports on this host).';

        expect(screen.getByText(disclosure)).toBeVisible();
        expect(screen.getByLabelText('Base URL:')).toHaveAccessibleDescription(
            disclosure
        );
        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));

        expect(chrome.permissions.request).toHaveBeenCalledWith({
            origins: ['https://models.example.com/*'],
        });
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access granted.'
            )
        );
    });

    test('requests a valid visible draft while its save is pending', async () => {
        const save = Promise.withResolvers();
        const onSettingChange = jest.fn(() => save.promise);
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(true),
        };
        render(
            section(
                { openaiBaseUrl: 'https://first.example.com/v1' },
                onSettingChange
            )
        );
        const baseUrl = screen.getByLabelText('Base URL:');

        fireEvent.change(baseUrl, {
            target: { value: 'https://draft.example.com/v2' },
        });
        fireEvent.blur(baseUrl);
        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));

        expect(onSettingChange).toHaveBeenCalledWith(
            'openaiBaseUrl',
            'https://draft.example.com/v2'
        );
        expect(chrome.permissions.request).toHaveBeenCalledWith({
            origins: ['https://draft.example.com/*'],
        });
        save.resolve(true);
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access granted.'
            )
        );
    });

    test('ignores a permission result for a replaced endpoint', async () => {
        const first = Promise.withResolvers();
        chrome.permissions = {
            request: jest
                .fn()
                .mockReturnValueOnce(first.promise)
                .mockResolvedValueOnce(false),
        };
        const view = render(
            section({ openaiBaseUrl: 'https://first.example.com/v1' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));
        expect(
            screen.getByRole('button', { name: 'Allow API host' })
        ).toBeDisabled();

        view.rerender(
            section({ openaiBaseUrl: 'https://second.example.com/v1' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access was not granted.'
            )
        );

        await act(async () => first.resolve(true));
        expect(screen.getByRole('status')).toHaveTextContent(
            'API host access was not granted.'
        );
    });

    test('shows permission failures as retryable feedback', async () => {
        chrome.permissions = {
            request: jest
                .fn()
                .mockRejectedValue(new Error('permission backend failed')),
        };
        render(section({ openaiBaseUrl: 'https://models.example.com/v1' }));

        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));

        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'Could not request API host access: permission backend failed'
            )
        );
        expect(
            screen.getByRole('button', { name: 'Allow API host' })
        ).toBeEnabled();
    });

    test('blocks invalid endpoints from persistence and permission requests', () => {
        const onSettingChange = jest.fn();
        chrome.permissions = { request: jest.fn().mockResolvedValue(true) };
        render(section({}, onSettingChange));
        const baseUrl = screen.getByLabelText('Base URL:');

        fireEvent.change(baseUrl, {
            target: { value: 'http://remote.example.com/v1' },
        });
        fireEvent.blur(baseUrl);

        expect(baseUrl).toHaveAttribute('aria-invalid', 'true');
        expect(
            screen.getByRole('button', { name: 'Allow API host' })
        ).toBeDisabled();
        expect(onSettingChange).not.toHaveBeenCalled();
        expect(chrome.permissions.request).not.toHaveBeenCalled();
    });
});
