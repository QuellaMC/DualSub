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

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

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
    test('uses the configured request timeout default when the setting is absent', () => {
        renderSection({ aiContextProvider: 'openai' });

        expect(screen.getByLabelText('Request Timeout (ms):')).toHaveValue(
            30000
        );
    });

    test('uses the configured cache default when the setting is absent', () => {
        renderSection({ aiContextProvider: 'openai' });

        expect(
            screen.getByRole('checkbox', { name: 'Enable Caching:' })
        ).toBeChecked();
    });

    test('uses the configured retry-attempt default when the setting is absent', () => {
        renderSection({ aiContextProvider: 'openai' });

        expect(screen.getByLabelText('Retry Attempts:')).toHaveValue(3);
    });

    test('preserves explicit false and zero advanced-setting values', () => {
        renderSection({
            aiContextProvider: 'openai',
            aiContextCacheEnabled: false,
            aiContextRetryAttempts: 0,
            aiContextTimeout: 0,
        });

        expect(
            screen.getByRole('checkbox', { name: 'Enable Caching:' })
        ).not.toBeChecked();
        expect(screen.getByLabelText('Request Timeout (ms):')).toHaveValue(0);
        expect(screen.getByLabelText('Retry Attempts:')).toHaveValue(0);
    });

    test('keeps sequential timeout typing local and commits the valid draft on blur', async () => {
        const onSettingChange = jest.fn().mockResolvedValue(true);
        renderSection(
            {
                aiContextProvider: 'openai',
                aiContextTimeout: 10000,
            },
            onSettingChange
        );

        const timeoutInput = screen.getByLabelText('Request Timeout (ms):');
        expect(timeoutInput).toHaveAttribute('min', '5000');
        expect(timeoutInput).toHaveAttribute('max', '30000');

        for (const draft of ['3', '30', '300', '3000', '30000']) {
            fireEvent.change(timeoutInput, { target: { value: draft } });
            expect(timeoutInput).toHaveValue(Number(draft));
            expect(onSettingChange).not.toHaveBeenCalled();
        }

        fireEvent.blur(timeoutInput);
        await waitFor(() =>
            expect(onSettingChange).toHaveBeenCalledWith(
                'aiContextTimeout',
                30000
            )
        );
        expect(onSettingChange).toHaveBeenCalledTimes(1);
    });

    test('commits a valid rate-limit draft on Enter without persisting prefixes', async () => {
        const onSettingChange = jest.fn().mockResolvedValue(true);
        renderSection(
            {
                aiContextProvider: 'openai',
                aiContextRateLimit: 60,
            },
            onSettingChange
        );

        const rateLimitInput = screen.getByLabelText(
            'Rate Limit (requests/min):'
        );
        expect(rateLimitInput).toHaveAttribute('min', '10');
        expect(rateLimitInput).toHaveAttribute('max', '300');

        fireEvent.change(rateLimitInput, { target: { value: '1' } });
        fireEvent.change(rateLimitInput, { target: { value: '12' } });
        fireEvent.change(rateLimitInput, { target: { value: '120' } });
        expect(onSettingChange).not.toHaveBeenCalled();

        fireEvent.keyDown(rateLimitInput, { key: 'Enter' });
        await waitFor(() =>
            expect(onSettingChange).toHaveBeenCalledWith(
                'aiContextRateLimit',
                120
            )
        );
        fireEvent.blur(rateLimitInput);
        expect(onSettingChange).toHaveBeenCalledTimes(1);
    });

    test('keeps an out-of-range numeric draft local with accessible validation', () => {
        const onSettingChange = jest.fn();
        renderSection(
            {
                aiContextProvider: 'openai',
                aiContextTimeout: 10000,
            },
            onSettingChange
        );

        const timeoutInput = screen.getByLabelText('Request Timeout (ms):');
        fireEvent.change(timeoutInput, { target: { value: '30001' } });
        fireEvent.blur(timeoutInput);

        expect(timeoutInput).toHaveValue(30001);
        expect(timeoutInput).toHaveAttribute('aria-invalid', 'true');
        expect(timeoutInput).toHaveAccessibleDescription(
            'Enter a valid value before saving.'
        );
        expect(onSettingChange).not.toHaveBeenCalled();
    });

    test('renders the requested OpenAI GPT-5.6 choices with Luna as default', () => {
        renderSection({ aiContextProvider: 'openai' });

        expect(screen.getByLabelText('Base URL:')).toHaveValue(
            getDefaultValue('openaiBaseUrl')
        );
        const modelInput = screen.getByLabelText('Model:');
        expect(modelInput).toHaveValue(getDefaultValue('openaiModel'));
        expect(
            Array.from(
                document.querySelector('#openaiModelOptions').options,
                ({ value }) => value
            )
        ).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6']);
    });

    test('does not mask explicit empty or invalid OpenAI fields with local defaults', () => {
        const view = renderSection({
            aiContextProvider: 'openai',
            openaiBaseUrl: '',
            openaiModel: '',
        });

        expect(screen.getByLabelText('Base URL:')).toHaveValue('');
        expect(screen.getByLabelText('Model:')).toHaveValue('');

        view.rerender(
            createSection({
                aiContextProvider: 'openai',
                openaiBaseUrl: 'not a URL',
                openaiModel: '   ',
            })
        );
        expect(screen.getByLabelText('Base URL:')).toHaveValue('not a URL');
        expect(screen.getByLabelText('Model:')).toHaveValue('   ');
    });

    test('preserves and commits a custom OpenAI-compatible model on blur', async () => {
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
        expect(onSettingChange).not.toHaveBeenCalled();

        fireEvent.blur(modelInput);
        await waitFor(() =>
            expect(onSettingChange).toHaveBeenCalledWith(
                'openaiModel',
                'provider-specific-model-v2'
            )
        );
        expect(onSettingChange).toHaveBeenCalledTimes(1);
    });

    test('keeps an invalid OpenAI model editable without persistence', () => {
        const onSettingChange = jest.fn();
        renderSection({ aiContextProvider: 'openai' }, onSettingChange);

        const modelInput = screen.getByLabelText('Model:');
        fireEvent.change(modelInput, { target: { value: '   ' } });
        fireEvent.blur(modelInput);

        expect(modelInput).toHaveValue('   ');
        expect(modelInput).toHaveAttribute('aria-invalid', 'true');
        expect(modelInput).toHaveAccessibleDescription(
            'Enter a valid value before saving.'
        );
        expect(onSettingChange).not.toHaveBeenCalled();
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
        const scopeDisclosure =
            'Configured endpoint: https://models.example.com/v1. Chrome permission scope: https://models.example.com/* (all paths and ports on this host).';

        expect(screen.getByText('models.example.com')).toBeInTheDocument();
        expect(screen.getByText(scopeDisclosure)).toBeInTheDocument();
        expect(status).toBeEmptyDOMElement();
        expect(baseUrlInput).toHaveAccessibleDescription(scopeDisclosure);
        expect(permissionGroup).toContainElement(allowButton);
        expect(allowButton).toHaveAccessibleDescription(
            `models.example.com ${scopeDisclosure}`
        );
    });

    test('discloses the exact loopback endpoint and Chrome all-port scope', async () => {
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(true),
        };
        renderSection({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'http://localhost:11434/v1',
        });

        expect(
            screen.getByText(
                'Configured endpoint: http://localhost:11434/v1. Chrome permission scope: http://localhost/* (all paths and ports on this host).'
            )
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));
        expect(chrome.permissions.request).toHaveBeenCalledWith({
            origins: ['http://localhost/*'],
        });
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access granted.'
            )
        );
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
            'models.example.com Configured endpoint: https://models.example.com/v1. Chrome permission scope: https://models.example.com/* (all paths and ports on this host). API host access granted.'
        );
    });

    test('requests the visible valid draft synchronously while its blur commit is pending', async () => {
        const persistence = deferred();
        const onSettingChange = jest.fn(() => persistence.promise);
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(true),
        };
        renderSection(
            {
                aiContextProvider: 'openai',
                openaiBaseUrl: 'https://first.example.com/v1',
            },
            onSettingChange
        );

        const baseUrlInput = screen.getByLabelText('Base URL:');
        fireEvent.change(baseUrlInput, {
            target: { value: 'https://draft.example.com/v2' },
        });

        expect(onSettingChange).not.toHaveBeenCalled();
        expect(
            screen.getByRole('group', { name: 'draft.example.com' })
        ).toBeInTheDocument();

        fireEvent.blur(baseUrlInput);
        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));

        expect(onSettingChange).toHaveBeenCalledTimes(1);
        expect(onSettingChange).toHaveBeenCalledWith(
            'openaiBaseUrl',
            'https://draft.example.com/v2'
        );
        expect(chrome.permissions.request).toHaveBeenCalledWith({
            origins: ['https://draft.example.com/*'],
        });

        persistence.resolve(true);
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'API host access granted.'
            )
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

    test('keeps actionable permission errors in a translated message', async () => {
        const translatedT = createTranslator({
            openaiHostPermissionError: 'Localized permission error: %s',
        });
        chrome.permissions = {
            request: jest
                .fn()
                .mockRejectedValue(new Error('permission backend failed')),
        };
        renderSection(
            {
                aiContextProvider: 'openai',
                openaiBaseUrl: 'https://models.example.com/v1',
            },
            undefined,
            translatedT
        );

        fireEvent.click(screen.getByRole('button', { name: 'Allow API host' }));

        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'Localized permission error: permission backend failed'
            )
        );
        expect(
            screen.getByRole('group', { name: 'models.example.com' })
        ).toHaveClass('error');
    });

    test('keeps an invalid URL editable while blocking persistence and permission', () => {
        const onSettingChange = jest.fn();
        chrome.permissions = {
            request: jest.fn().mockResolvedValue(true),
        };
        renderSection(
            {
                aiContextProvider: 'openai',
                openaiBaseUrl: 'https://models.example.com/v1',
            },
            onSettingChange
        );

        const baseUrlInput = screen.getByLabelText('Base URL:');
        fireEvent.change(baseUrlInput, {
            target: { value: 'http://remote.example.com/v1' },
        });
        fireEvent.blur(baseUrlInput);

        expect(baseUrlInput).toHaveValue('http://remote.example.com/v1');
        expect(baseUrlInput).toHaveAttribute('aria-invalid', 'true');
        expect(baseUrlInput).toHaveAccessibleDescription(
            'Enter a valid value before saving.'
        );
        expect(onSettingChange).not.toHaveBeenCalled();

        const allowButton = screen.getByRole('button', {
            name: 'Allow API host',
        });
        expect(allowButton).toBeDisabled();
        fireEvent.click(allowButton);
        expect(chrome.permissions.request).not.toHaveBeenCalled();
    });
});
