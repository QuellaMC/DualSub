import { configSchema } from '../config/configSchema.js';
import * as settingsProjections from './settingsProjections.js';

const { OPTIONS_SETTINGS_KEYS, POPUP_SETTINGS_KEYS } = settingsProjections;

describe('settings projections', () => {
    test.each([
        {
            name: 'Popup',
            projection: POPUP_SETTINGS_KEYS,
        },
        {
            name: 'Options',
            projection: OPTIONS_SETTINGS_KEYS,
        },
    ])('$name has one frozen schema projection', ({ projection }) => {
        expect(Object.isFrozen(projection)).toBe(true);
        expect(new Set(projection).size).toBe(projection.length);
        expect(
            projection.every((key) => Object.hasOwn(configSchema, key))
        ).toBe(true);
    });

    test('Popup excludes every sensitive schema key', () => {
        expect(
            POPUP_SETTINGS_KEYS.filter((key) => configSchema[key].sensitive)
        ).toEqual([]);
    });

    test('Options explicitly includes every sensitive schema key', () => {
        const schemaSensitiveKeys = Object.keys(configSchema)
            .filter((key) => configSchema[key].sensitive)
            .sort();
        const projectedSensitiveKeys = OPTIONS_SETTINGS_KEYS.filter(
            (key) => configSchema[key].sensitive
        ).sort();

        expect(projectedSensitiveKeys).toEqual(schemaSensitiveKeys);
    });
});
