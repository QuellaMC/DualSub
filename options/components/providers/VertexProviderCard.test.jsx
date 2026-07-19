import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const importServiceAccountJson = jest.fn();
const testConnection = jest.fn();
const initializeStatus = jest.fn();
const updateManualAccessToken = jest.fn();
const useVertexTest = jest.fn(() => ({
    testResult: { visible: false, message: '', type: 'info' },
    importResult: { visible: false, message: '', type: 'info' },
    testing: false,
    importing: false,
    testConnection,
    importServiceAccountJson,
    initializeStatus,
    updateManualAccessToken,
}));

jest.unstable_mockModule('../../hooks/useVertexTest.js', () => ({
    useVertexTest,
}));

const { VertexProviderCard } = await import('./VertexProviderCard.jsx');

describe('VertexProviderCard service-account import', () => {
    test('auto-tests with the credentials returned by the import', async () => {
        const file = new File(['{}'], 'service-account.json', {
            type: 'application/json',
        });
        importServiceAccountJson.mockResolvedValue({
            accessToken: 'fresh-token',
            projectId: 'fresh-project',
            expiresAt: 1_000_000,
        });
        testConnection.mockResolvedValue(undefined);

        render(
            <VertexProviderCard
                t={(_key, fallback) => fallback}
                accessToken="stale-token"
                projectId="stale-project"
                location="europe-west1"
                model="gemini-2.5-flash"
                onAccessTokenChange={jest.fn()}
                onProjectIdChange={jest.fn()}
                onLocationChange={jest.fn()}
                onModelChange={jest.fn()}
                onProviderChange={jest.fn()}
            />
        );

        fireEvent.change(screen.getByLabelText('Upload service account JSON'), {
            target: { files: [file] },
        });

        await waitFor(() =>
            expect(importServiceAccountJson).toHaveBeenCalledWith(file)
        );
        await waitFor(() =>
            expect(testConnection).toHaveBeenCalledWith(
                'fresh-token',
                'fresh-project',
                'europe-west1',
                'gemini-2.5-flash'
            )
        );
        expect(testConnection).not.toHaveBeenCalledWith(
            'stale-token',
            'stale-project',
            expect.anything(),
            expect.anything()
        );
    });

    test('limits regions to hosts granted by the extension manifest', () => {
        const onLocationChange = jest.fn();
        render(
            <VertexProviderCard
                t={(_key, fallback) => fallback}
                accessToken=""
                projectId=""
                location="us-central1"
                model="gemini-2.5-flash"
                onAccessTokenChange={jest.fn()}
                onProjectIdChange={jest.fn()}
                onLocationChange={onLocationChange}
                onModelChange={jest.fn()}
                onProviderChange={jest.fn()}
            />
        );

        const locationSelect = screen.getByLabelText('Location:');
        expect(
            Array.from(locationSelect.options, (option) => option.value)
        ).toEqual([
            'us-central1',
            'us-east1',
            'us-west1',
            'europe-west1',
            'europe-west4',
            'asia-northeast1',
            'asia-southeast1',
        ]);

        fireEvent.change(locationSelect, {
            target: { value: 'asia-northeast1' },
        });
        expect(onLocationChange).toHaveBeenCalledWith('asia-northeast1');
    });

    test('keeps project ID typing local until a valid blur commit', async () => {
        const onProjectIdChange = jest.fn().mockResolvedValue(true);
        render(
            <VertexProviderCard
                t={(_key, fallback) => fallback}
                accessToken=""
                projectId="existing-project"
                location="us-central1"
                model="gemini-2.5-flash"
                onAccessTokenChange={jest.fn()}
                onProjectIdChange={onProjectIdChange}
                onLocationChange={jest.fn()}
                onModelChange={jest.fn()}
                onProviderChange={jest.fn()}
            />
        );

        const projectInput = screen.getByLabelText('Project ID:');
        for (const draft of [
            'n',
            'ne',
            'new',
            'new-',
            'new-pr',
            'new-project',
        ]) {
            fireEvent.change(projectInput, { target: { value: draft } });
            expect(projectInput).toHaveValue(draft);
            expect(onProjectIdChange).not.toHaveBeenCalled();
        }

        fireEvent.blur(projectInput);
        await waitFor(() =>
            expect(onProjectIdChange).toHaveBeenCalledWith('new-project')
        );
        expect(onProjectIdChange).toHaveBeenCalledTimes(1);
    });

    test('commits a valid project ID with Enter without a duplicate blur write', async () => {
        const onProjectIdChange = jest.fn().mockResolvedValue(true);
        render(
            <VertexProviderCard
                t={(_key, fallback) => fallback}
                accessToken=""
                projectId="existing-project"
                location="us-central1"
                model="gemini-2.5-flash"
                onAccessTokenChange={jest.fn()}
                onProjectIdChange={onProjectIdChange}
                onLocationChange={jest.fn()}
                onModelChange={jest.fn()}
                onProviderChange={jest.fn()}
            />
        );

        const projectInput = screen.getByLabelText('Project ID:');
        fireEvent.change(projectInput, {
            target: { value: 'domain.example:project-123' },
        });
        fireEvent.keyDown(projectInput, { key: 'Enter' });

        await waitFor(() =>
            expect(onProjectIdChange).toHaveBeenCalledWith(
                'domain.example:project-123'
            )
        );
        fireEvent.blur(projectInput);
        expect(onProjectIdChange).toHaveBeenCalledTimes(1);
    });

    test('keeps an invalid completed project ID local with validation', () => {
        const onProjectIdChange = jest.fn();
        render(
            <VertexProviderCard
                t={(_key, fallback) => fallback}
                accessToken=""
                projectId="existing-project"
                location="us-central1"
                model="gemini-2.5-flash"
                onAccessTokenChange={jest.fn()}
                onProjectIdChange={onProjectIdChange}
                onLocationChange={jest.fn()}
                onModelChange={jest.fn()}
                onProviderChange={jest.fn()}
            />
        );

        const projectInput = screen.getByLabelText('Project ID:');
        fireEvent.change(projectInput, { target: { value: 'Invalid-' } });
        fireEvent.blur(projectInput);

        expect(projectInput).toHaveValue('Invalid-');
        expect(projectInput).toHaveAttribute('aria-invalid', 'true');
        expect(projectInput).toHaveAccessibleDescription(
            'Enter a valid value before saving.'
        );
        expect(onProjectIdChange).not.toHaveBeenCalled();
    });

    test('keeps the model draft local until Enter commits once', async () => {
        const onModelChange = jest.fn().mockResolvedValue(true);
        render(
            <VertexProviderCard
                t={(_key, fallback) => fallback}
                accessToken=""
                projectId=""
                location="us-central1"
                model="gemini-2.5-flash"
                onAccessTokenChange={jest.fn()}
                onProjectIdChange={jest.fn()}
                onLocationChange={jest.fn()}
                onModelChange={onModelChange}
                onProviderChange={jest.fn()}
            />
        );

        const modelInput = screen.getByLabelText('Model:');
        fireEvent.change(modelInput, {
            target: { value: 'custom/model:v2' },
        });

        expect(modelInput).toHaveValue('custom/model:v2');
        expect(onModelChange).not.toHaveBeenCalled();

        fireEvent.keyDown(modelInput, { key: 'Enter' });
        await waitFor(() =>
            expect(onModelChange).toHaveBeenCalledWith('custom/model:v2')
        );

        fireEvent.blur(modelInput);
        expect(onModelChange).toHaveBeenCalledTimes(1);
    });

    test('keeps an invalid model editable without persistence', () => {
        const onModelChange = jest.fn();
        render(
            <VertexProviderCard
                t={(_key, fallback) => fallback}
                accessToken=""
                projectId=""
                location="us-central1"
                model="gemini-2.5-flash"
                onAccessTokenChange={jest.fn()}
                onProjectIdChange={jest.fn()}
                onLocationChange={jest.fn()}
                onModelChange={onModelChange}
                onProviderChange={jest.fn()}
            />
        );

        const modelInput = screen.getByLabelText('Model:');
        fireEvent.change(modelInput, { target: { value: '   ' } });
        fireEvent.blur(modelInput);

        expect(modelInput).toHaveValue('   ');
        expect(modelInput).toHaveAttribute('aria-invalid', 'true');
        expect(modelInput).toHaveAccessibleDescription(
            'Enter a valid value before saving.'
        );
        expect(onModelChange).not.toHaveBeenCalled();
    });
});
