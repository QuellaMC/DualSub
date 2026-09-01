import { jest } from '@jest/globals';
import { getDefaultValue } from '../config/configSchema.js';
import { ConfigServiceReadError, configService } from './configService.js';

describe('ConfigService stored-value validation', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns a canonical stored value without repairing during a regular read', async () => {
        jest.spyOn(configService, 'getFromStorage').mockResolvedValue({
            targetLanguage: 'EN-us',
        });
        const setToStorage = jest.spyOn(configService, 'setToStorage');

        await expect(configService.get('targetLanguage')).resolves.toBe(
            'en-US'
        );
        expect(setToStorage).not.toHaveBeenCalled();
    });

    it('detaches a collection returned by a regular read', async () => {
        const storedTypes = ['cultural'];
        jest.spyOn(configService, 'getFromStorage').mockResolvedValue({
            aiContextTypes: storedTypes,
        });

        const result = await configService.get('aiContextTypes');
        storedTypes[0] = 'invalid-after-read';

        expect(result).toEqual(['cultural']);
        expect(result).not.toBe(storedTypes);
    });

    it('canonicalizes valid values and defaults invalid values in getMultiple', async () => {
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) =>
                Object.fromEntries(
                    keys.map((key) => {
                        const values = {
                            targetLanguage: 'EN-us',
                            aiContextTypes: { cultural: true },
                            subtitleBlacklist: [],
                        };
                        return [key, values[key]];
                    })
                )
        );

        await expect(
            configService.getMultiple([
                'targetLanguage',
                'aiContextTypes',
                'subtitleBlacklist',
            ])
        ).resolves.toEqual({
            targetLanguage: 'en-US',
            aiContextTypes: getDefaultValue('aiContextTypes'),
            subtitleBlacklist: getDefaultValue('subtitleBlacklist'),
        });
    });

    it('returns canonical stored values and schema defaults after healthy getAll reads', async () => {
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (area) =>
                area === 'sync'
                    ? {
                          uiLanguage: 'invalid-locale',
                          targetLanguage: 'EN-us',
                      }
                    : {}
        );

        await expect(configService.getAll()).resolves.toMatchObject({
            uiLanguage: getDefaultValue('uiLanguage'),
            targetLanguage: 'en-US',
            debugMode: getDefaultValue('debugMode'),
        });
    });

    it.each([
        {
            failedArea: 'local',
            storedValues: { uiLanguage: 'es' },
        },
        {
            failedArea: 'sync',
            storedValues: { debugMode: true },
        },
    ])(
        'rejects getAll without mixed/default values when the $failedArea read fails',
        async ({ failedArea, storedValues }) => {
            const storageFailure = new Error(`${failedArea} unavailable`);
            jest.spyOn(configService, 'getFromStorage').mockImplementation(
                async (area) => {
                    if (area === failedArea) throw storageFailure;
                    return storedValues;
                }
            );

            let error;
            try {
                await configService.getAll();
            } catch (caught) {
                error = caught;
            }

            expect(error).toBeInstanceOf(ConfigServiceReadError);
            expect(error.failedAreas).toEqual([failedArea]);
            expect(error).not.toHaveProperty('cause');
            expect(error).not.toHaveProperty('values');
            expect(error).not.toHaveProperty('uiLanguage');
            expect(error).not.toHaveProperty('debugMode');
        }
    );

    it('repairs a noncanonical stored value once without rewriting exact defaults', async () => {
        let canonicalValuePersisted = false;
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) => {
                const stored = Object.fromEntries(
                    keys.map((key) => [key, getDefaultValue(key)])
                );
                if (keys.includes('targetLanguage')) {
                    stored.targetLanguage = canonicalValuePersisted
                        ? 'en-US'
                        : 'EN-us';
                }
                return stored;
            }
        );
        const setToStorage = jest
            .spyOn(configService, 'setToStorage')
            .mockImplementation(async (_area, values) => {
                if (values.targetLanguage === 'en-US') {
                    canonicalValuePersisted = true;
                }
            });

        await configService.setDefaultsForMissingKeys();
        await configService.setDefaultsForMissingKeys();

        expect(setToStorage).toHaveBeenCalledTimes(1);
        expect(setToStorage).toHaveBeenCalledWith(
            'sync',
            { targetLanguage: 'en-US' },
            expect.objectContaining({
                operation: 'initialization-set-sync',
            })
        );
    });

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

        expect(setToStorage).toHaveBeenCalledTimes(1);
        expect(setToStorage).toHaveBeenCalledWith(
            'sync',
            { loggingLevel: 3 },
            expect.objectContaining({
                operation: 'initialization-set-sync',
            })
        );
    });
});
