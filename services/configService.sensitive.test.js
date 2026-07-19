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

    it('does not read or return credentials when getAll options are omitted', async () => {
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

        const config = await configService.getAll();

        expect(config.subtitlesEnabled).toBe(false);
        for (const key of SENSITIVE_KEYS) {
            expect(config).not.toHaveProperty(key);
        }
        for (const [, keys] of getFromStorage.mock.calls) {
            expect(keys).toEqual(expect.not.arrayContaining(SENSITIVE_KEYS));
        }
    });

    it('reads and returns credentials only when getAll receives an exact own opt-in', async () => {
        const getFromStorage = jest
            .spyOn(configService, 'getFromStorage')
            .mockImplementation(async (_area, keys) =>
                Object.fromEntries(
                    keys.map((key) => [key, `explicit-value-${key}`])
                )
            );

        const config = await configService.getAll({ includeSensitive: true });

        for (const key of SENSITIVE_KEYS) {
            expect(config[key]).toBe(`explicit-value-${key}`);
        }
        expect(getFromStorage.mock.calls).toEqual(
            expect.arrayContaining([
                [
                    'local',
                    expect.arrayContaining(SENSITIVE_KEYS),
                    expect.any(Object),
                    { privacySafeLogs: true },
                ],
            ])
        );
    });

    it('filters credential values when onChanged options are omitted', () => {
        const callback = jest.fn();
        const unsubscribe = configService.onChanged(callback);
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

        callback.mockClear();
        projectedCallback({ geminiApiKey: 'still-must-not-leak' });
        expect(callback).not.toHaveBeenCalled();

        unsubscribe();
        expect(configService.changeListeners.size).toBe(0);
    });

    it('forwards credentials only when onChanged receives an exact own opt-in', () => {
        const callback = jest.fn();
        const unsubscribe = configService.onChanged(callback, {
            includeSensitive: true,
        });
        const [registeredCallback] = configService.changeListeners;
        const changes = {
            openaiApiKey: 'explicit-secret',
            subtitlesEnabled: false,
        };

        registeredCallback(changes);

        expect(callback).toHaveBeenCalledWith(changes);
        unsubscribe();
        expect(configService.changeListeners.size).toBe(0);
    });
});
