// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FeedbackProvider, type Feedback } from '../shell/feedback';
import { OpenAICompatibleProviderCard } from './OpenAICompatibleProviderCard';

const t = (key: string, ...subs: readonly (string | number)[]): string =>
    subs.length > 0 ? `${key}:${subs.join(',')}` : key;

function modelsResponse(ids: string[]): Response {
    return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

function renderCard(
    overrides: Partial<{
        apiKey: string;
        baseUrl: string;
        model: string;
        advanced: boolean;
    }> = {}
) {
    const save = vi.fn(() => Promise.resolve(true));
    const props = {
        apiKey: 'sk',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        advanced: true,
        ...overrides,
    };
    // The page makes each change in turn; so does this stand-in.
    let changes: Promise<unknown> = Promise.resolve();
    const feedback: Feedback = {
        apply: (change) => {
            const made = changes.then(change).then(
                () => true,
                () => false
            );
            changes = made;
            return made;
        },
        notify: vi.fn(),
    };
    render(
        <FeedbackProvider value={feedback}>
            <OpenAICompatibleProviderCard t={t} save={save} {...props} />
        </FeedbackProvider>
    );
    return { save };
}

/** Advance fake timers and drain the promise chains behind them. */
async function flush(ms = 0): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
        for (let i = 0; i < 20; i += 1) {
            await Promise.resolve();
        }
    });
}

function modelOptions(): string[] {
    return [
        ...screen.getByLabelText('setupModel').querySelectorAll('option'),
    ].map((option) => option.value);
}

beforeEach(async () => {
    vi.useFakeTimers();
    await fakeBrowser.storage.sync.clear();
    await fakeBrowser.storage.local.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('OpenAICompatibleProviderCard', () => {
    it('fetches the model catalog after typing settles when the host is already permitted', async () => {
        const fetchMock = vi.fn(() =>
            Promise.resolve(modelsResponse(['gpt-a', 'gpt-4o-mini']))
        );
        vi.stubGlobal('fetch', fetchMock);
        renderCard();
        expect(screen.getByRole('status')).toHaveTextContent(
            'openaiTestNeedsTesting'
        );

        await flush(999);
        expect(fetchMock).not.toHaveBeenCalled();
        await flush(1);
        expect(screen.getByRole('status')).toHaveTextContent(
            'openaiModelsFetchedSuccessfully'
        );
        expect(modelOptions()).toEqual(['gpt-a', 'gpt-4o-mini']);
    });

    it('asks for the host permission before listing models on a custom endpoint', async () => {
        vi.spyOn(browser.permissions, 'contains').mockResolvedValue(
            false as never
        );
        const request = vi
            .spyOn(browser.permissions, 'request')
            .mockResolvedValue(true as never);
        const fetchMock = vi.fn(() =>
            Promise.resolve(modelsResponse(['local-model']))
        );
        vi.stubGlobal('fetch', fetchMock);
        renderCard({ baseUrl: 'https://llm.example.com/v1', model: 'custom' });

        await flush(1000);
        expect(screen.getByRole('status')).toHaveTextContent(
            'openaiEndpointPermissionRequired'
        );
        expect(fetchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /setupCheckKey/ }));
        expect(request).toHaveBeenCalledWith({
            origins: ['https://llm.example.com/*'],
        });
        await flush();
        expect(screen.getByRole('status')).toHaveTextContent(
            'openaiConnectionSuccessful'
        );
        expect(modelOptions()).toEqual(['custom', 'local-model']);
    });

    it('keeps the base URL local until it is committed, rejecting invalid values', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(modelsResponse([])))
        );
        const { save } = renderCard();
        const input = screen.getByLabelText('setupAddress');

        fireEvent.change(input, { target: { value: 'not a url' } });
        fireEvent.blur(input);
        await flush();
        expect(save).not.toHaveBeenCalled();
        expect(input).toHaveAttribute('aria-invalid', 'true');

        fireEvent.change(input, {
            target: { value: 'https://llm.example.com/v1/' },
        });
        fireEvent.keyDown(input, { key: 'Enter' });
        await flush();
        expect(save).toHaveBeenCalledWith(
            { openaiCompatibleBaseUrl: 'https://llm.example.com/v1/' },
            'quiet'
        );
    });

    it('enters a key for the origin of the stored address, and saves model edits directly', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(modelsResponse([])))
        );
        await fakeBrowser.storage.sync.set({
            openaiCompatibleBaseUrl: 'https://api.openai.com/v1',
        });
        const { save } = renderCard();
        fireEvent.change(screen.getByLabelText('setupPasteKey'), {
            target: { value: 'sk-2' },
        });
        await flush();
        expect(
            await fakeBrowser.storage.local.get([
                'openaiCompatibleApiKey',
                'openaiCompatibleApiKeyOrigin',
            ])
        ).toEqual({
            openaiCompatibleApiKey: 'sk-2',
            openaiCompatibleApiKeyOrigin: 'https://api.openai.com',
        });
        fireEvent.change(screen.getByLabelText('setupModel'), {
            target: { value: 'gpt-4o-mini' },
        });
        expect(save).toHaveBeenCalledWith(
            { openaiCompatibleModel: 'gpt-4o-mini' },
            'quiet'
        );
        await flush();
    });

    it('fills in a known service from one click, and asks for the address only for another', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(modelsResponse([])))
        );
        const { save } = renderCard({ advanced: false });
        expect(screen.queryByLabelText('setupAddress')).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'setupServiceOpenAI' })
        ).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(
            screen.getByRole('button', { name: 'setupServiceGemini' })
        );
        expect(save).toHaveBeenCalledWith(
            {
                openaiCompatibleBaseUrl:
                    'https://generativelanguage.googleapis.com/v1beta/openai',
                openaiCompatibleModel: 'gemini-2.5-flash',
            },
            'quiet'
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'setupServiceOther' })
        );
        expect(screen.getByLabelText('setupAddress')).toBeInTheDocument();
        await flush();
    });
});
