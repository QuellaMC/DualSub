import { jest } from '@jest/globals';
import { getDefaultValue } from '../config/configSchema.js';
import { configService } from './configService.js';

describe('ConfigService stored-value validation', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('falls back when a stored scalar has the wrong type or range', async () => {
        jest.spyOn(configService, 'getFromStorage').mockResolvedValue({
            loggingLevel: 99,
        });

        await expect(configService.get('loggingLevel')).resolves.toBe(3);
    });

    it('validates every value returned by getMultiple', async () => {
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) =>
                Object.fromEntries(
                    keys.map((key) => {
                        const values = {
                            uiLanguage: 'es',
                            aiContextTypes: { cultural: true },
                            subtitleBlacklist: [],
                        };
                        return [key, values[key]];
                    })
                )
        );

        await expect(
            configService.getMultiple([
                'uiLanguage',
                'aiContextTypes',
                'subtitleBlacklist',
            ])
        ).resolves.toEqual({
            uiLanguage: 'es',
            aiContextTypes: ['cultural', 'historical', 'linguistic'],
            subtitleBlacklist: getDefaultValue('subtitleBlacklist'),
        });
    });

    it.each([
        {
            failedArea: 'local',
            healthyArea: 'sync',
            storedValues: { uiLanguage: 'es' },
            expected: { uiLanguage: 'es', debugMode: false },
        },
        {
            failedArea: 'sync',
            healthyArea: 'local',
            storedValues: { debugMode: true },
            expected: { uiLanguage: 'en', debugMode: true },
        },
    ])(
        'preserves $healthyArea values when the $failedArea read fails',
        async ({ failedArea, storedValues, expected }) => {
            jest.spyOn(configService, 'getFromStorage').mockImplementation(
                async (area) => {
                    if (area === failedArea) {
                        throw new Error(`${area} unavailable`);
                    }
                    return storedValues;
                }
            );

            await expect(configService.getAll()).resolves.toMatchObject(
                expected
            );
        }
    );

    it('repairs invalid persisted values during startup default verification', async () => {
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) => {
                const stored = Object.fromEntries(
                    keys.map((key) => [key, getDefaultValue(key)])
                );
                if (keys.includes('loggingLevel')) {
                    stored.loggingLevel = Number.NaN;
                }
                return stored;
            }
        );
        const setToStorage = jest
            .spyOn(configService, 'setToStorage')
            .mockResolvedValue();

        await configService.setDefaultsForMissingKeys();

        expect(setToStorage).toHaveBeenCalledWith(
            'sync',
            { loggingLevel: 3 },
            expect.objectContaining({
                operation: 'initialization-set-sync',
            })
        );
    });
});
