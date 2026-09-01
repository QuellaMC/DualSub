import { configService } from '../services/configService.js';

const PROVIDER_CONFIG_READ_ERROR_MESSAGE =
    'Required provider configuration is unavailable';

function createProviderConfigReadError() {
    return new Error(PROVIDER_CONFIG_READ_ERROR_MESSAGE);
}

/** Read all provider-required values through ConfigService. */
export async function readRequiredProviderConfig(keys) {
    let strictResult;
    try {
        strictResult = await configService.readMultipleResultStrict(keys, {
            includeSensitive: true,
        });
    } catch {
        throw createProviderConfigReadError();
    }

    const values = strictResult?.values;
    if (
        values === null ||
        typeof values !== 'object' ||
        !keys.every((key) => Object.hasOwn(values, key))
    ) {
        throw createProviderConfigReadError();
    }

    return values;
}
