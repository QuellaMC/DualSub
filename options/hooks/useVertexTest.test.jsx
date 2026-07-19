import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

const getAccessTokenFromServiceAccount = jest.fn();
const checkTokenExpiration = jest.fn();

jest.unstable_mockModule('../../utils/vertexAuth.js', () => ({
    getAccessTokenFromServiceAccount,
    checkTokenExpiration,
}));

const { useVertexTest } = await import('./useVertexTest.js');

const t = (_key, fallback, ...substitutions) => {
    let index = 0;
    return fallback.replace(/%s/g, () => String(substitutions[index++]));
};

describe('useVertexTest service-account import', () => {
    beforeEach(() => {
        getAccessTokenFromServiceAccount.mockResolvedValue({
            accessToken: 'short-lived-token',
            expiresIn: 3600,
        });
        checkTokenExpiration.mockResolvedValue(null);
    });

    test('uses the private key only in memory and never passes it to storage', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const operationOrder = [];
        const serviceAccount = {
            type: 'service_account',
            project_id: 'fresh-project',
            client_email: 'vertex@example.test',
            private_key: '-----BEGIN PRIVATE KEY-----secret-key-material',
        };
        const onAccessTokenChange = jest.fn().mockResolvedValue(undefined);
        const onProjectIdChange = jest.fn().mockResolvedValue(undefined);
        const onProviderChange = jest.fn().mockResolvedValue(undefined);
        const onCredentialsChange = jest.fn().mockImplementation(async () => {
            operationOrder.push('save-credentials');
            return true;
        });
        chrome.storage.local.set.mockImplementation(async () => {
            operationOrder.push('save-expiry');
        });
        const { result } = renderHook(() =>
            useVertexTest(
                t,
                onAccessTokenChange,
                onProjectIdChange,
                onProviderChange,
                onCredentialsChange
            )
        );

        let importedCredentials;
        await act(async () => {
            importedCredentials = await result.current.importServiceAccountJson(
                {
                    text: jest
                        .fn()
                        .mockResolvedValue(JSON.stringify(serviceAccount)),
                }
            );
        });

        expect(getAccessTokenFromServiceAccount).toHaveBeenCalledWith(
            serviceAccount
        );
        expect(chrome.storage.local.remove).toHaveBeenCalledWith(
            'vertexServiceAccount'
        );
        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            vertexTokenExpiresAt: 4_600_000,
        });
        for (const [storedValue] of chrome.storage.local.set.mock.calls) {
            expect(JSON.stringify(storedValue)).not.toContain(
                serviceAccount.private_key
            );
            expect(storedValue).not.toHaveProperty('vertexServiceAccount');
        }
        expect(onCredentialsChange).toHaveBeenCalledWith({
            vertexProjectId: 'fresh-project',
            vertexAccessToken: 'short-lived-token',
        });
        expect(onProjectIdChange).not.toHaveBeenCalled();
        expect(onAccessTokenChange).not.toHaveBeenCalled();
        expect(onProviderChange).toHaveBeenCalledWith('vertex_gemini');
        expect(operationOrder).toEqual(['save-credentials', 'save-expiry']);
        expect(importedCredentials).toEqual({
            projectId: 'fresh-project',
            accessToken: 'short-lived-token',
            expiresAt: 4_600_000,
        });
    });

    test('does not report success or switch provider when credential storage fails', async () => {
        const onProviderChange = jest.fn();
        const onCredentialsChange = jest.fn().mockResolvedValue(false);
        const { result } = renderHook(() =>
            useVertexTest(
                t,
                jest.fn(),
                jest.fn(),
                onProviderChange,
                onCredentialsChange
            )
        );
        const serviceAccount = {
            type: 'service_account',
            project_id: 'fresh-project',
            client_email: 'vertex@example.test',
            private_key: '-----BEGIN PRIVATE KEY-----secret-key-material',
        };
        let importError;

        await act(async () => {
            try {
                await result.current.importServiceAccountJson({
                    text: jest
                        .fn()
                        .mockResolvedValue(JSON.stringify(serviceAccount)),
                });
            } catch (error) {
                importError = error;
            }
        });

        expect(importError).toEqual(
            new Error('Failed to save imported credentials.')
        );
        expect(onProviderChange).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
            expect.objectContaining({
                vertexTokenExpiresAt: expect.any(Number),
            })
        );
        expect(result.current.importResult).toMatchObject({
            visible: true,
            type: 'error',
            message: expect.stringContaining(
                'Failed to save imported credentials.'
            ),
        });
    });

    test('tells the user to re-import or enter a manual token after expiry', async () => {
        checkTokenExpiration.mockResolvedValue({
            isExpired: true,
            isExpiringSoon: true,
            expiresInMinutes: -1,
        });
        const { result } = renderHook(() =>
            useVertexTest(t, jest.fn(), jest.fn(), jest.fn())
        );

        await act(async () => {
            await result.current.initializeStatus('expired-token', 'project');
        });

        expect(result.current.testResult).toEqual(
            expect.objectContaining({
                visible: true,
                type: 'warning',
                message: expect.stringMatching(
                    /re-import.*paste a new access token/i
                ),
            })
        );
    });

    test('clears imported-token expiry metadata after saving a manual token', async () => {
        const operationOrder = [];
        const onAccessTokenChange = jest.fn().mockImplementation(async () => {
            operationOrder.push('save');
            return true;
        });
        chrome.storage.local.remove.mockImplementation(async (key) => {
            if (key === 'vertexTokenExpiresAt') {
                operationOrder.push('remove-expiry');
            }
        });
        const { result } = renderHook(() =>
            useVertexTest(t, onAccessTokenChange, jest.fn(), jest.fn())
        );

        await act(async () => {
            await result.current.updateManualAccessToken('fresh-manual-token');
        });

        expect(chrome.storage.local.remove).toHaveBeenCalledWith(
            'vertexTokenExpiresAt'
        );
        expect(onAccessTokenChange).toHaveBeenCalledWith('fresh-manual-token');
        expect(operationOrder).toEqual(['save', 'remove-expiry']);
    });

    test('keeps expiry metadata when saving a manual token fails', async () => {
        const onAccessTokenChange = jest
            .fn()
            .mockRejectedValue(new Error('storage unavailable'));
        const { result } = renderHook(() =>
            useVertexTest(t, onAccessTokenChange, jest.fn(), jest.fn())
        );

        let saved;
        await act(async () => {
            saved =
                await result.current.updateManualAccessToken(
                    'fresh-manual-token'
                );
        });

        expect(saved).toBe(false);
        expect(chrome.storage.local.remove).not.toHaveBeenCalledWith(
            'vertexTokenExpiresAt'
        );
        expect(result.current.testResult).toEqual(
            expect.objectContaining({
                visible: true,
                type: 'error',
                message: expect.stringContaining('storage unavailable'),
            })
        );
    });
});
