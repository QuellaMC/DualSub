import { jest } from '@jest/globals';
import { getAccessTokenFromServiceAccount } from './vertexAuth.js';

describe('Vertex service-account token exchange', () => {
    test('rejects a non-Google token endpoint before signing or sending credentials', async () => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn();

        try {
            await expect(
                getAccessTokenFromServiceAccount({
                    client_email: 'service@example.test',
                    private_key: 'private-key-must-not-be-used',
                    token_uri: 'https://attacker.example/token',
                })
            ).rejects.toThrow('canonical Google OAuth endpoint');
            expect(global.fetch).not.toHaveBeenCalled();
        } finally {
            global.fetch = originalFetch;
        }
    });
});
