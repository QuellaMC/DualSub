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
    beforeEach(() => {
        configService.changeListeners.clear();
        configService.changeListenerInitialized = false;
    });

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
        jest.spyOn(configService, 'getFromStorage').mockImplementation(
            async (_area, keys) =>
                Object.fromEntries(
                    keys.map((key) => [key, `explicit-value-${key}`])
                )
        );

        const config = await configService.getAll({ includeSensitive: true });

        for (const key of SENSITIVE_KEYS) {
            expect(config[key]).toBe(`explicit-value-${key}`);
        }
    });

    it('filters credential values when onChanged options are omitted', () => {
        const callback = jest.fn();
        const unsubscribe = configService.onChanged(callback);
        configService.initializeChangeListener();
        const emitStorageChange =
            chrome.storage.onChanged.addListener.mock.calls.at(-1)[0];

        emitStorageChange(
            {
                openaiApiKey: { newValue: 'must-not-leak' },
                vertexAccessToken: { newValue: 'must-not-leak-either' },
                debugMode: { newValue: false },
            },
            'local'
        );

        expect(callback).toHaveBeenCalledWith({ debugMode: false });
        expect(JSON.stringify(callback.mock.calls)).not.toContain(
            'must-not-leak'
        );

        callback.mockClear();
        emitStorageChange(
            { geminiApiKey: { newValue: 'still-must-not-leak' } },
            'local'
        );
        expect(callback).not.toHaveBeenCalled();

        unsubscribe();
        expect(configService.changeListeners.size).toBe(0);
    });

    it('forwards credentials only when onChanged receives an exact own opt-in', () => {
        const callback = jest.fn();
        const unsubscribe = configService.onChanged(callback, {
            includeSensitive: true,
        });
        configService.initializeChangeListener();
        const emitStorageChange =
            chrome.storage.onChanged.addListener.mock.calls.at(-1)[0];

        emitStorageChange(
            {
                openaiApiKey: { newValue: 'explicit-secret' },
                debugMode: { newValue: false },
            },
            'local'
        );

        expect(callback).toHaveBeenCalledWith({
            openaiApiKey: 'explicit-secret',
            debugMode: false,
        });
        unsubscribe();
        expect(configService.changeListeners.size).toBe(0);
    });
});
