import type { SettingsKey } from '@/config/schema';

/**
 * Keys sent to an address the viewer sets, with that address and the
 * setting that records the origin the key was entered for. A key stays on
 * this computer while its address syncs and goes into backups, so the
 * address can change under it; the key still goes only to its own origin.
 */
export const KEY_ORIGINS = {
    openaiCompatibleApiKey: {
        address: 'openaiCompatibleBaseUrl',
        origin: 'openaiCompatibleApiKeyOrigin',
    },
    openaiApiKey: { address: 'openaiBaseUrl', origin: 'openaiApiKeyOrigin' },
} as const satisfies Partial<
    Record<SettingsKey, { address: SettingsKey; origin: SettingsKey }>
>;

export type OriginBoundKey = keyof typeof KEY_ORIGINS;
export type KeyBinding = (typeof KEY_ORIGINS)[OriginBoundKey];

/** The settings that decide where a key may go. */
export type KeyOriginSetting = KeyBinding['address' | 'origin'];

function isOriginBound(key: string): key is OriginBoundKey {
    return Object.hasOwn(KEY_ORIGINS, key);
}

/** Where requests to `address` go: its scheme, host, and port. */
export function originOf(address: string): string | null {
    try {
        return new URL(address).origin;
    } catch {
        return null;
    }
}

/** `settings[key]` as it may be sent now. A key whose address is on
 *  another origin than the one it was entered for is empty. */
export function usableCredential<K extends string>(
    key: K,
    settings: Partial<Record<K | KeyOriginSetting, string>>
): string {
    const value = settings[key] ?? '';
    if (!isOriginBound(key)) {
        return value;
    }
    const { address, origin } = KEY_ORIGINS[key];
    return settings[origin] === originOf(settings[address] ?? '') ? value : '';
}

/** The changes that enter `value` as `key` for `address`. */
export function keyEntry(
    key: OriginBoundKey,
    value: string,
    address: string
): Partial<Record<OriginBoundKey | KeyOriginSetting, string>> {
    return { [key]: value, [KEY_ORIGINS[key].origin]: originOf(address) ?? '' };
}
