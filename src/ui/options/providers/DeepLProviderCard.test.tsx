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
import { DeepLProviderCard } from './DeepLProviderCard';

const t = (key: string, ...subs: readonly (string | number)[]): string =>
    subs.length > 0 ? `${key}:${subs.join(',')}` : key;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('DeepLProviderCard', () => {
    it('asks for a key first, then flags an untested key', () => {
        const save = vi.fn(() => Promise.resolve(true));
        const view = render(
            <DeepLProviderCard t={t} apiKey="" plan="free" save={save} />
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            'deeplApiKeyError'
        );
        expect(screen.getByRole('button')).toBeDisabled();

        view.rerender(
            <DeepLProviderCard t={t} apiKey="k" plan="free" save={save} />
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            'deeplTestNeedsTesting'
        );
        expect(screen.getByRole('button')).toBeEnabled();
    });

    it('saves edits and runs the connection check', async () => {
        const save = vi.fn(() => Promise.resolve(true));
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(jsonResponse({ translations: [{ text: 'x' }] }))
            )
        );
        render(<DeepLProviderCard t={t} apiKey="k" plan="free" save={save} />);

        fireEvent.change(screen.getByLabelText('apiKeyLabel'), {
            target: { value: 'k2' },
        });
        expect(save).toHaveBeenCalledWith({ deeplApiKey: 'k2' });
        fireEvent.change(screen.getByLabelText('apiPlanLabel'), {
            target: { value: 'pro' },
        });
        expect(save).toHaveBeenCalledWith({ deeplApiPlan: 'pro' });

        fireEvent.click(screen.getByRole('button'));
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'deeplTestSuccessSimple'
            )
        );
    });

    it('explains a rejected key', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response('', { status: 403 })))
        );
        render(
            <DeepLProviderCard
                t={t}
                apiKey="bad"
                plan="free"
                save={vi.fn(() => Promise.resolve(true))}
            />
        );
        fireEvent.click(screen.getByRole('button'));
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'deeplTestInvalidKey'
            )
        );
    });
});
