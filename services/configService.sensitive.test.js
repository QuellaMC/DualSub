import { jest } from '@jest/globals';
import { configSchema } from '../config/configSchema.js';
import { configService } from './configService.js';

const SENSITIVE_KEYS = [
    'deeplApiKey',
    'openaiCompatibleApiKey',
    'vertexAccessToken',
    'openaiApiKey',
    'geminiApiKey',
];

describe('ConfigService sensitive projections', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        configService.changeListeners.clear();
    });

    it('marks every provider credential as sensitive and device-local', () => {
        for (const key of SENSITIVE_KEYS) {
            expect(configSchema[key]).toMatchObject({
                scope: 'local',
                sensitive: true,
            });
        }
    });

    it('does not read or return credentials for an untrusted projection', async () => {
        const getFromStorage = jest
            .spyOn(configService, 'getFromStorage')
            .mockImplementation(async (_area, keys) =>
                Object.fromEntries(
                    keys.map((key) => [
                        key,
                        key === 'subtitlesEnabled' ? false : `value-${key}`,
                    ])
                )
            );

        const config = await configService.getAll({
            includeSensitive: false,
        });

        expect(config.subtitlesEnabled).toBe(false);
        for (const key of SENSITIVE_KEYS) {
            expect(config).not.toHaveProperty(key);
        }
        for (const [, keys] of getFromStorage.mock.calls) {
            expect(keys).toEqual(expect.not.arrayContaining(SENSITIVE_KEYS));
        }
    });

    it('filters credential values from untrusted change listeners', () => {
        const callback = jest.fn();
        const unsubscribe = configService.onChanged(callback, {
            includeSensitive: false,
        });
        const [projectedCallback] = configService.changeListeners;

        projectedCallback({
            openaiApiKey: 'must-not-leak',
            vertexAccessToken: 'must-not-leak-either',
            subtitlesEnabled: false,
        });

        expect(callback).toHaveBeenCalledWith({ subtitlesEnabled: false });
        expect(JSON.stringify(callback.mock.calls)).not.toContain(
            'must-not-leak'
        );
        unsubscribe();
        expect(configService.changeListeners.size).toBe(0);
    });
});
