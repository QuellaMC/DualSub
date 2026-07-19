import { expect, test } from '@jest/globals';
import {
    migrateLegacyConfiguration,
    resetConfigurationMigrationForTests,
} from '../background/configMigrations.js';
import { VERTEX_LOCATIONS as SHARED_VERTEX_LOCATIONS } from '../content_scripts/shared/constants/providers.js';
import { VERTEX_LOCATIONS as UI_VERTEX_LOCATIONS } from '../options/components/providers/VertexProviderCard.jsx';
import { configSchema } from './configSchema.js';

const EXPECTED_VERTEX_LOCATIONS = [
    'us-central1',
    'us-east1',
    'us-west1',
    'europe-west1',
    'europe-west4',
    'asia-northeast1',
    'asia-southeast1',
];

test('schema, migration, and UI share one immutable Vertex region contract', async () => {
    expect(SHARED_VERTEX_LOCATIONS).toEqual(EXPECTED_VERTEX_LOCATIONS);
    expect(Object.isFrozen(SHARED_VERTEX_LOCATIONS)).toBe(true);
    expect(configSchema.vertexLocation.allowedValues).toBe(
        SHARED_VERTEX_LOCATIONS
    );
    expect(UI_VERTEX_LOCATIONS).toBe(SHARED_VERTEX_LOCATIONS);
    expect(() => SHARED_VERTEX_LOCATIONS.push('mutation-attempt')).toThrow(
        TypeError
    );

    for (const vertexLocation of SHARED_VERTEX_LOCATIONS) {
        resetConfigurationMigrationForTests();
        chrome.storage.sync.get.mockResolvedValue({ vertexLocation });
        chrome.storage.local.get.mockResolvedValue({});
        chrome.storage.sync.set.mockClear();
        chrome.storage.local.set.mockClear();

        await migrateLegacyConfiguration();

        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    }
});
