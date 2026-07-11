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

function createTranslator(messages = {}) {
    return (key, fallback = '', ...substitutions) => {
        let message = messages[key] || fallback || key;
        let substitutionIndex = 0;
        message = message.replace(/%[sd]/g, (placeholder) =>
            substitutionIndex < substitutions.length
                ? substitutions[substitutionIndex++]
                : placeholder
        );
        return message;
    };
}

const t = createTranslator();

function createSection(settings, onSettingChange = () => {}, translate = t) {
    return (
        <AIContextSection
            t={translate}
            settings={{
                aiContextEnabled: true,
                aiContextTypes: ['cultural'],
                ...settings,
            }}
            onSettingChange={onSettingChange}
        />
    );
}

function renderSection(settings, onSettingChange = () => {}, translate = t) {
    return render(createSection(settings, onSettingChange, translate));
}

describe('AIContextSection model contracts', () => {
    test('renders the requested OpenAI GPT-5.6 choices with Luna as default', () => {
        renderSection({ aiContextProvider: 'openai' });

        const modelInput = screen.getByLabelText('Model:');
        expect(modelInput).toHaveValue('gpt-5.6-luna');
        expect(
            Array.from(
                document.querySelector('#openaiModelOptions').options,
                ({ value }) => value
            )
        ).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6']);
    });

    test('preserves and edits a custom OpenAI-compatible model', () => {
        const onSettingChange = jest.fn();
        renderSection(
            {
                aiContextProvider: 'openai',
                openaiBaseUrl: 'https://models.example.test/v1',
                openaiModel: 'provider-specific-model',
            },
            onSettingChange
        );

        const modelInput = screen.getByLabelText('Model:');
        expect(modelInput).toHaveValue('provider-specific-model');

        fireEvent.change(modelInput, {
            target: { value: 'provider-specific-model-v2' },
        });
        expect(onSettingChange).toHaveBeenCalledWith(
            'openaiModel',
            'provider-specific-model-v2'
        );
    });

    test('renders Gemini 3.5 Flash without shut-down Gemini 1.5 choices', () => {
        renderSection({ aiContextProvider: 'gemini' });

        const modelSelect = screen.getByLabelText('Model:');
        const modelValues = Array.from(
            modelSelect.options,
            ({ value }) => value
        );
        expect(modelSelect).toHaveValue('gemini-3.5-flash');
        expect(modelValues[0]).toBe('gemini-3.5-flash');
        expect(modelValues).not.toEqual(
            expect.arrayContaining(['gemini-1.5-flash', 'gemini-1.5-pro'])
        );
    });

    test('shows validation guidance when no context type is selected', () => {
        renderSection({
            aiContextProvider: 'openai',
            aiContextTypes: [],
        });

        expect(
            screen.getByText('Select at least one context type.')
        ).toBeInTheDocument();
    });

    test('groups the endpoint permission state and action accessibly', () => {
        renderSection({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'https://models.example.com/v1',
        });

        const status = screen.getByRole('status');
        const baseUrlInput = screen.getByLabelText('Base URL:');
        const allowButton = screen.getByRole('button', {
            name: 'Allow API host',
        });
        const permissionGroup = screen.getByRole('group', {
            name: 'models.example.com',
        });

        expect(screen.getByText('models.example.com')).toBeInTheDocument();
        expect(status).toBeEmptyDOMElement();
        expect(baseUrlInput).not.toHaveAttribute('aria-describedby');
        expect(permissionGroup).toContainElement(allowButton);
        expect(allowButton).toHaveAccessibleDescription('models.example.com');
    });

    test('requests a custom OpenAI host from the explicit user gesture', async () => {
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(true),
        };
        renderSection({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'https://models.example.com/v1',
        });

        const allowButton = screen.getByRole('button', {
            name: 'Allow API host',
        });
        fireEvent.click(allowButton);

        expect(chrome.permissions.request).toHaveBeenCalledWith({
            origins: ['https://models.example.com/*'],
        });
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access granted.'
            )
        );
        expect(
            screen.getByRole('status').closest('.api-host-permission')
        ).toHaveClass('granted');
        expect(allowButton).toHaveAccessibleDescription(
            'models.example.com API host access granted.'
        );
    });

    test('recognizes the built-in OpenAI host without prompting', async () => {
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(true),
        };
        renderSection({ aiContextProvider: 'openai' });

        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));

        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access granted.'
            )
        );
        expect(chrome.permissions.request).not.toHaveBeenCalled();
    });

    test('shows a busy, disabled permission action while Chrome responds', async () => {
        let resolvePermission;
        chrome.permissions = {
            request: jest.fn(
                () =>
                    new Promise((resolve) => {
                        resolvePermission = resolve;
                    })
            ),
        };
        renderSection({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'https://models.example.com/v1',
        });

        const allowButton = screen.getByRole('button', {
            name: 'Allow API host',
        });
        fireEvent.click(allowButton);

        expect(allowButton).toBeDisabled();
        expect(allowButton).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('status')).toHaveTextContent(
            'Checking API host access…'
        );
        expect(
            screen.getByRole('status').closest('.api-host-permission')
        ).toHaveClass('pending');

        resolvePermission(true);
        await waitFor(() => expect(allowButton).toBeEnabled());
        expect(allowButton).toHaveAttribute('aria-busy', 'false');
    });

    test('clears permission state when storage supplies a different URL', async () => {
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(true),
        };
        const view = renderSection({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'https://first.example.com/v1',
        });

        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access granted.'
            )
        );

        view.rerender(
            createSection({
                aiContextProvider: 'openai',
                openaiBaseUrl: 'https://second.example.com/v1',
            })
        );

        expect(
            screen.getByRole('group', { name: 'second.example.com' })
        ).toHaveClass('idle');
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    test('ignores an older host result after a new host request starts', async () => {
        let resolveFirstRequest;
        let resolveSecondRequest;
        chrome.permissions = {
            request: jest
                .fn()
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            resolveFirstRequest = resolve;
                        })
                )
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            resolveSecondRequest = resolve;
                        })
                ),
        };
        const view = renderSection({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'https://first.example.com/v1',
        });

        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));
        view.rerender(
            createSection({
                aiContextProvider: 'openai',
                openaiBaseUrl: 'https://second.example.com/v1',
            })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));

        expect(chrome.permissions.request).toHaveBeenNthCalledWith(1, {
            origins: ['https://first.example.com/*'],
        });
        expect(chrome.permissions.request).toHaveBeenNthCalledWith(2, {
            origins: ['https://second.example.com/*'],
        });

        await act(async () => {
            resolveFirstRequest(true);
            await Promise.resolve();
        });
        expect(screen.getByRole('status')).toHaveTextContent(
            'Checking API host access…'
        );

        await act(async () => {
            resolveSecondRequest(false);
            await Promise.resolve();
        });
        expect(screen.getByRole('status')).toHaveTextContent(
            'API host access was not granted.'
        );
        expect(
            screen.getByRole('group', { name: 'second.example.com' })
        ).toHaveClass('denied');
    });

    test('renders a denied permission result as retryable feedback', async () => {
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(false),
        };
        renderSection({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'https://models.example.com/v1',
        });

        const allowButton = screen.getByRole('button', {
            name: 'Allow API host',
        });
        fireEvent.click(allowButton);

        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access was not granted.'
            )
        );
        expect(allowButton).toBeEnabled();
        expect(
            screen.getByRole('group', { name: 'models.example.com' })
        ).toHaveClass('denied');
    });

    test('keeps actionable error details in a translated message', async () => {
        const translatedT = createTranslator({
            openaiHostPermissionError: 'Localized permission error: %s',
        });
        renderSection(
            {
                aiContextProvider: 'openai',
                openaiBaseUrl: 'http://remote.example.com/v1',
            },
            undefined,
            translatedT
        );

        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));

        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'Localized permission error: Custom providers must use HTTPS (HTTP is allowed only for localhost).'
            )
        );
        expect(
            screen.getByRole('group', { name: 'remote.example.com' })
        ).toHaveClass('error');
    });
});
