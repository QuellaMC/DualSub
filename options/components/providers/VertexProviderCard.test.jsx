import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const importServiceAccountJson = jest.fn();
const testConnection = jest.fn();
const initializeStatus = jest.fn();
const updateManualAccessToken = jest.fn();

jest.unstable_mockModule('../../hooks/useVertexTest.js', () => ({
    useVertexTest: () => ({
        testResult: { visible: false, message: '', type: 'info' },
        importResult: { visible: false, message: '', type: 'info' },
        testing: false,
        importing: false,
        testConnection,
        importServiceAccountJson,
        initializeStatus,
        updateManualAccessToken,
    }),
}));

const { VertexProviderCard } = await import('./VertexProviderCard.jsx');
const t = (_key, fallback) => fallback;

function renderCard(overrides = {}) {
    const props = {
        t,
        accessToken: 'token',
        projectId: 'project',
        location: 'europe-west1',
        model: 'gemini-2.5-flash',
        onAccessTokenChange: jest.fn(),
        onProjectIdChange: jest.fn().mockResolvedValue(true),
        onLocationChange: jest.fn(),
        onModelChange: jest.fn().mockResolvedValue(true),
        onProviderChange: jest.fn(),
        ...overrides,
    };
    return { ...render(<VertexProviderCard {...props} />), props };
}

describe('VertexProviderCard', () => {
    beforeEach(() => {
        importServiceAccountJson.mockReset();
        testConnection.mockReset().mockResolvedValue(undefined);
        initializeStatus.mockReset().mockResolvedValue(undefined);
        updateManualAccessToken.mockReset().mockResolvedValue(true);
    });

    test('wires stored credentials and manual token edits to the Vertex hook', async () => {
        renderCard();

        await waitFor(() =>
            expect(initializeStatus).toHaveBeenCalledWith('token', 'project')
        );
        fireEvent.change(screen.getByLabelText('Access Token:'), {
            target: { value: 'replacement-token' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Test Connection' })
        );

        expect(updateManualAccessToken).toHaveBeenCalledWith(
            'replacement-token'
        );
        expect(testConnection).toHaveBeenCalledWith(
            'token',
            'project',
            'europe-west1',
            'gemini-2.5-flash'
        );
    });

    test('tests imported credentials instead of stale props', async () => {
        const file = new File(['{}'], 'service-account.json', {
            type: 'application/json',
        });
        importServiceAccountJson.mockResolvedValue({
            accessToken: 'fresh-token',
            projectId: 'fresh-project',
        });
        renderCard({ accessToken: 'stale-token', projectId: 'stale-project' });

        fireEvent.change(screen.getByLabelText('Upload service account JSON'), {
            target: { files: [file] },
        });

        await waitFor(() =>
            expect(testConnection).toHaveBeenCalledWith(
                'fresh-token',
                'fresh-project',
                'europe-west1',
                'gemini-2.5-flash'
            )
        );
    });

    test('offers only manifest-supported regions', () => {
        const { props } = renderCard();
        const location = screen.getByLabelText('Location:');

        expect(Array.from(location.options, ({ value }) => value)).toEqual([
            'us-central1',
            'us-east1',
            'us-west1',
            'europe-west1',
            'europe-west4',
            'asia-northeast1',
            'asia-southeast1',
        ]);
        fireEvent.change(location, { target: { value: 'asia-northeast1' } });
        expect(props.onLocationChange).toHaveBeenCalledWith('asia-northeast1');
    });

    test('commits valid project and model drafts through the shared field hook', async () => {
        const { props } = renderCard();
        const project = screen.getByLabelText('Project ID:');
        const model = screen.getByLabelText('Model:');

        fireEvent.change(project, { target: { value: 'new-project' } });
        fireEvent.blur(project);
        fireEvent.change(model, { target: { value: 'custom/model:v2' } });
        fireEvent.keyDown(model, { key: 'Enter' });

        await waitFor(() => {
            expect(props.onProjectIdChange).toHaveBeenCalledWith('new-project');
            expect(props.onModelChange).toHaveBeenCalledWith('custom/model:v2');
        });
    });

    test('keeps invalid provider fields local with accessible feedback', () => {
        const { props } = renderCard();
        const model = screen.getByLabelText('Model:');

        fireEvent.change(model, { target: { value: '   ' } });
        fireEvent.blur(model);

        expect(model).toHaveValue('   ');
        expect(model).toHaveAttribute('aria-invalid', 'true');
        expect(model).toHaveAccessibleDescription(
            'Enter a valid value before saving.'
        );
        expect(props.onModelChange).not.toHaveBeenCalled();
    });
});
