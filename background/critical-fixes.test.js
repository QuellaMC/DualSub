import { translationProviders } from './services/translationService.js';
import { Providers } from '../content_scripts/shared/constants/providers.js';

// Smoke tests converted from background/test-critical-fixes.js

describe('Background critical fixes (smoke)', () => {
    test('translation service initializes provider', async () => {
        await translationProviders.initialize();
        const provider = translationProviders.getCurrentProvider();
        expect(provider).toBeTruthy();
        expect(
            Object.keys(translationProviders.getAvailableProviders())
        ).toEqual(Object.values(Providers));
        expect(typeof translationProviders.translate).toBe('function');
        expect(translationProviders.translateBatch).toBeUndefined();
    });
});
