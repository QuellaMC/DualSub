import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const importServiceAccountJson = jest.fn();
const testConnection = jest.fn();
const initializeStatus = jest.fn();
const useVertexTest = jest.fn(() => ({
    testResult: { visible: false, message: '', type: 'info' },
    importResult: { visible: false, message: '', type: 'info' },
    testing: false,
    importing: false,
    testConnection,
    importServiceAccountJson,
    initializeStatus,
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
});
