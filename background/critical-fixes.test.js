import { translationProviders } from './services/translationService.js';
import { universalBatchProcessor } from './services/universalBatchProcessor.js';
import { sharedUtilityIntegration } from './utils/sharedUtilityIntegration.js';

// Smoke tests converted from background/test-critical-fixes.js

describe('Background critical fixes (smoke)', () => {
  test('shared utility integration basics', () => {
    const testVTT = `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello world\n\n00:00:03.500 --> 00:00:05.500\nHow are you?\n`;
    const cues = sharedUtilityIntegration.parseVTT(testVTT);
    expect(Array.isArray(cues)).toBe(true);
    expect(cues.length).toBeGreaterThan(0);
  });

  test('universal batch processor initializes and provides configs', async () => {
    await universalBatchProcessor.initialize();
    const size = universalBatchProcessor.getEffectiveBatchSize('openai_compatible');
    expect(size).toBeGreaterThan(0);
  });

  test('translation service initializes provider', async () => {
    await translationProviders.initialize();
    const provider = translationProviders.getCurrentProvider();
    expect(provider).toBeTruthy();
  });
});
