import type { SettingsValues } from '@/config/schema';

/** The key each address setting sends its requests with. */
const ADDRESS_KEYS = {
    openaiCompatibleBaseUrl: 'openaiCompatibleApiKey',
    openaiBaseUrl: 'openaiApiKey',
} as const;

type AddressSetting = keyof typeof ADDRESS_KEYS;
type AddressChange = Partial<
    Pick<SettingsValues, AddressSetting | (typeof ADDRESS_KEYS)[AddressSetting]>
>;

function sameHost(left: string, right: string): boolean {
    try {
        return new URL(left).origin === new URL(right).origin;
    } catch {
        return false;
    }
}

/** The changes that point `setting` from `current` to `next`. A key never
 *  goes to a host it was not entered for, so moving to another host clears
 *  it. */
export function addressChange(
    setting: AddressSetting,
    current: string,
    next: string
): AddressChange {
    const changes: AddressChange = { [setting]: next };
    if (!sameHost(current, next)) {
        changes[ADDRESS_KEYS[setting]] = '';
    }
    return changes;
}
