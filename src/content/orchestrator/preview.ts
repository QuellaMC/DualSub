import { prepareSettingValue } from '@/config/schema';
import { CONTENT_SETTINGS_KEYS, type ContentSettings } from './PlayerSession';

type ContentSettingsKey = (typeof CONTENT_SETTINGS_KEYS)[number];

function isContentSettingsKey(key: string): key is ContentSettingsKey {
    return (CONTENT_SETTINGS_KEYS as readonly string[]).includes(key);
}

/**
 * Canonical display values from a live-preview payload. Any key outside the
 * display set or any invalid value rejects the whole payload, so a preview
 * is applied completely or not at all.
 * @throws {TypeError}
 */
export function prepareContentPreview(
    changes: Record<string, unknown>
): Partial<ContentSettings> {
    const prepared: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
        if (!isContentSettingsKey(key)) {
            throw new TypeError(`"${key}" is not a display setting.`);
        }
        prepared[key] = prepareSettingValue(key, changes[key]);
    }
    return prepared;
}
