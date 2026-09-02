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
import * as vertexAuth from '@/shared/vertexAuth';
import { VertexProviderCard } from './VertexProviderCard';

const t = (key: string, ...subs: readonly (string | number)[]): string =>
    subs.length > 0 ? `${key}:${subs.join(',')}` : key;

const CONFIGURED = {
    vertexAccessToken: 'tok',
    vertexProjectId: 'my-project-123',
    vertexLocation: 'us-central1' as const,
    vertexModel: 'gemini-2.5-flash',
    vertexTokenExpiresAt: 0,
};

function renderCard(settings = CONFIGURED) {
    const save = vi.fn(() => Promise.resolve(true));
    render(<VertexProviderCard t={t} settings={settings} save={save} />);
    return { save };
}

function candidateResponse(): Response {
    return new Response(
        JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'pong' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('VertexProviderCard', () => {
    it('describes the configuration state, including token expiry', () => {
        renderCard({ ...CONFIGURED, vertexAccessToken: '' });
        expect(screen.getByRole('status')).toHaveTextContent(
            'vertexNotConfiguredEphemeral'
        );
        cleanup();

        renderCard({ ...CONFIGURED, vertexTokenExpiresAt: Date.now() - 1 });
        expect(screen.getByRole('status')).toHaveTextContent(
            'vertexTokenExpiredReimport'
        );
        cleanup();

        renderCard({
            ...CONFIGURED,
            vertexTokenExpiresAt: Date.now() + 2 * 60_000,
        });
        expect(screen.getByRole('status')).toHaveTextContent(
            'vertexTokenExpiringReimport:1'
        );
    });

    it('keeps project id and model local until a valid commit', async () => {
        const { save } = renderCard();
        const projectId = screen.getByLabelText('vertexProjectIdLabel');
        fireEvent.change(projectId, { target: { value: 'BAD ID' } });
        fireEvent.blur(projectId);
        expect(save).not.toHaveBeenCalled();
        expect(projectId).toHaveAttribute('aria-invalid', 'true');

        fireEvent.change(projectId, { target: { value: 'other-project-9' } });
        fireEvent.keyDown(projectId, { key: 'Enter' });
        await waitFor(() =>
            expect(save).toHaveBeenCalledWith({
                vertexProjectId: 'other-project-9',
            })
        );

        const model = screen.getByLabelText('vertexModelLabel');
        fireEvent.change(model, { target: { value: 'gemini-2.5-pro' } });
        fireEvent.blur(model);
        await waitFor(() =>
            expect(save).toHaveBeenCalledWith({ vertexModel: 'gemini-2.5-pro' })
        );
    });

    it('saves a pasted token as manual and clears the imported expiry', () => {
        const { save } = renderCard();
        fireEvent.change(screen.getByLabelText('vertexAccessTokenLabel'), {
            target: { value: 'ya29.new' },
        });
        expect(save).toHaveBeenCalledWith({
            vertexAccessToken: 'ya29.new',
            vertexTokenExpiresAt: 0,
        });
    });

    it('imports a service-account key, stores only the minted token, and auto-tests', async () => {
        const mint = vi
            .spyOn(vertexAuth, 'mintAccessToken')
            .mockResolvedValue({ accessToken: 'minted', expiresAt: 4_000_000 });
        const fetchMock = vi.fn(() => Promise.resolve(candidateResponse()));
        vi.stubGlobal('fetch', fetchMock);
        const { save } = renderCard({ ...CONFIGURED, vertexAccessToken: '' });

        const file = new File(
            [
                JSON.stringify({
                    type: 'service_account',
                    project_id: 'imported-project',
                    private_key:
                        '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
                    client_email:
                        'bot@imported-project.iam.gserviceaccount.com',
                }),
            ],
            'key.json',
            { type: 'application/json' }
        );
        fireEvent.change(screen.getByLabelText('Upload service account JSON'), {
            target: { files: [file] },
        });

        await waitFor(() =>
            expect(save).toHaveBeenCalledWith({
                vertexProjectId: 'imported-project',
                vertexAccessToken: 'minted',
                vertexTokenExpiresAt: 4_000_000,
                selectedProvider: 'vertex_gemini',
            })
        );
        expect(mint.mock.calls[0]?.[0]).toMatchObject({
            projectId: 'imported-project',
            clientEmail: 'bot@imported-project.iam.gserviceaccount.com',
        });
        expect(JSON.stringify(save.mock.calls)).not.toContain('PRIVATE KEY');
        await waitFor(() =>
            expect(
                screen.getAllByRole('status').map((s) => s.textContent)
            ).toContain('openaiConnectionSuccessful')
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports an unreadable key file without saving anything', async () => {
        const { save } = renderCard();
        const file = new File(['{'], 'key.json', { type: 'application/json' });
        fireEvent.change(screen.getByLabelText('Upload service account JSON'), {
            target: { files: [file] },
        });
        await waitFor(() =>
            expect(
                screen.getAllByRole('status').map((s) => s.textContent)
            ).toContain('vertexImportFailed:Invalid JSON file.')
        );
        expect(save).not.toHaveBeenCalled();
    });
});
