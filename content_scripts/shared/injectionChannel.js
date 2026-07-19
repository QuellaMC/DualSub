import { readCustomEventDetail } from './subtitleRequestIdentity.js';

// This is a document/frame lifecycle capability, not a secret from the host
// page: the page can observe the script fragment and replay a genuine event.
// Transparent proxies, monkey-patched platform APIs, and never-settling
// thenables remain explicit residuals; this seam intentionally does not grow
// into a MessageChannel or SES-style execution boundary.

const CAPABILITY_BYTES = 32;
const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_SCRIPT_URL_CODE_UNITS = 4096;
const CHANNEL_FRAGMENT_KEY = 'dualsub-channel';
const CHANNEL_DETAIL_KEY = 'dualsubChannel';
const CHANNEL_KEYS = new Set(['capability', 'platform']);
const BUFFER_METADATA_KEYS = new Set(['pageUrl', 'timestamp']);
const SUPPORTED_PLATFORMS = new Set(['disneyplus', 'netflix']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ORDINARY_OBJECT_PROTOTYPE_KEYS = new Set(
    Reflect.ownKeys(Object.prototype)
);
const authorizedDetails = new WeakMap();

function isSupportedPlatform(platform) {
    return typeof platform === 'string' && SUPPORTED_PLATFORMS.has(platform);
}

function isCanonicalCapability(capability) {
    return (
        typeof capability === 'string' && CAPABILITY_PATTERN.test(capability)
    );
}

function bytesToCanonicalHex(bytes) {
    let encoded = '';
    for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0');
    return encoded;
}

function isOrdinaryRecordPrototype(prototype) {
    if (prototype === null || prototype === Object.prototype) return true;

    try {
        if (Object.getPrototypeOf(prototype) !== null) return false;
        const keys = Reflect.ownKeys(prototype);
        if (keys.length !== ORDINARY_OBJECT_PROTOTYPE_KEYS.size) return false;

        for (const key of keys) {
            if (!ORDINARY_OBJECT_PROTOTYPE_KEYS.has(key)) return false;
            const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            if (!descriptor || descriptor.enumerable) return false;
            if (key === 'constructor') {
                if (
                    !Object.hasOwn(descriptor, 'value') ||
                    typeof descriptor.value !== 'function'
                ) {
                    return false;
                }
                const nameDescriptor = Object.getOwnPropertyDescriptor(
                    descriptor.value,
                    'name'
                );
                if (
                    !nameDescriptor ||
                    !Object.hasOwn(nameDescriptor, 'value') ||
                    nameDescriptor.value !== 'Object'
                ) {
                    return false;
                }
            }
        }
        return true;
    } catch (_) {
        return false;
    }
}

function mintCapability(cryptoSource) {
    try {
        if (
            cryptoSource === null ||
            typeof cryptoSource !== 'object' ||
            typeof cryptoSource.getRandomValues !== 'function'
        ) {
            return null;
        }

        const bytes = new Uint8Array(CAPABILITY_BYTES);
        const result = cryptoSource.getRandomValues(bytes);
        if (result !== bytes || !bytes.some((byte) => byte !== 0)) return null;
        const capability = bytesToCanonicalHex(bytes);
        return isCanonicalCapability(capability) ? capability : null;
    } catch (_) {
        return null;
    }
}

function inspectDataRecord(value, allowedKeys = null) {
    try {
        if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
        ) {
            return null;
        }
        if (!isOrdinaryRecordPrototype(Object.getPrototypeOf(value))) {
            return null;
        }

        const entries = [];
        for (const key of Reflect.ownKeys(value)) {
            if (
                typeof key !== 'string' ||
                DANGEROUS_KEYS.has(key) ||
                (allowedKeys && !allowedKeys.has(key))
            ) {
                return null;
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (
                !descriptor ||
                !descriptor.enumerable ||
                !Object.hasOwn(descriptor, 'value')
            ) {
                return null;
            }
            entries.push([key, descriptor.value]);
        }
        return entries;
    } catch (_) {
        return null;
    }
}

function brandAuthorizedDetail(detail, platform, capability) {
    Object.freeze(detail);
    authorizedDetails.set(detail, { capability, platform });
    return detail;
}

function copyAuthorizedDetail(rawDetail, platform, capability) {
    const entries = inspectDataRecord(rawDetail);
    if (!entries) return null;

    let channel = null;
    const detail = Object.create(null);
    for (const [key, value] of entries) {
        if (key === CHANNEL_DETAIL_KEY) {
            if (channel !== null) return null;
            channel = value;
            continue;
        }
        Object.defineProperty(detail, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
        });
    }

    const channelEntries = inspectDataRecord(channel, CHANNEL_KEYS);
    if (!channelEntries || channelEntries.length !== CHANNEL_KEYS.size) {
        return null;
    }
    const channelSnapshot = Object.fromEntries(channelEntries);
    if (
        channelSnapshot.platform !== platform ||
        !isCanonicalCapability(channelSnapshot.capability) ||
        channelSnapshot.capability !== capability
    ) {
        return null;
    }

    return brandAuthorizedDetail(detail, platform, capability);
}

function readAuthorizedDetail(event, platform, capability) {
    const rawDetail = readCustomEventDetail(event);
    if (rawDetail === undefined) return null;

    const existingAuthority = authorizedDetails.get(rawDetail);
    if (existingAuthority) {
        return existingAuthority.platform === platform &&
            existingAuthority.capability === capability
            ? rawDetail
            : null;
    }

    return copyAuthorizedDetail(rawDetail, platform, capability);
}

function createPageDetail(platform, capability, type) {
    if (typeof type !== 'string' || type.length === 0 || type.length > 64) {
        return null;
    }

    return Object.freeze({
        type,
        [CHANNEL_DETAIL_KEY]: Object.freeze({ platform, capability }),
    });
}

function createScriptUrl(baseUrl, platform, capability) {
    if (
        typeof baseUrl !== 'string' ||
        baseUrl.length === 0 ||
        baseUrl.length > MAX_SCRIPT_URL_CODE_UNITS
    ) {
        return null;
    }

    try {
        const parsedUrl = new URL(baseUrl);
        if (
            parsedUrl.protocol !== 'chrome-extension:' ||
            parsedUrl.username !== '' ||
            parsedUrl.password !== '' ||
            parsedUrl.port !== ''
        ) {
            return null;
        }
        parsedUrl.hash = `${CHANNEL_FRAGMENT_KEY}=${platform}.${capability}`;
        return parsedUrl.href;
    } catch (_) {
        return null;
    }
}

function createRegistry(cryptoProvider) {
    const capabilityByPlatform = new Map();

    const getOrCreateCapability = (platform) => {
        if (!isSupportedPlatform(platform)) return null;
        if (capabilityByPlatform.has(platform)) {
            return capabilityByPlatform.get(platform);
        }

        let cryptoSource;
        try {
            cryptoSource = cryptoProvider();
        } catch (_) {
            return null;
        }
        const capability = mintCapability(cryptoSource);
        if (!capability) return null;
        capabilityByPlatform.set(platform, capability);
        return capability;
    };

    const createChannel = (platform) => {
        const capability = getOrCreateCapability(platform);
        if (!capability) return null;
        let active = true;

        return Object.freeze({
            platform,
            accept(event) {
                return active
                    ? readAuthorizedDetail(event, platform, capability)
                    : null;
            },
            createEventDetail(type) {
                return active
                    ? createPageDetail(platform, capability, type)
                    : null;
            },
            createScriptUrl(baseUrl) {
                return active
                    ? createScriptUrl(baseUrl, platform, capability)
                    : null;
            },
            revoke() {
                active = false;
            },
        });
    };

    return Object.freeze({ createChannel });
}

export function createInjectionChannelRegistry(
    cryptoProvider = () => globalThis.crypto
) {
    if (typeof cryptoProvider !== 'function') {
        throw new TypeError('Injection channel crypto provider is invalid.');
    }
    return createRegistry(cryptoProvider);
}

const injectionChannelRegistry = createRegistry(() => globalThis.crypto);

export function createInjectionChannel(platform) {
    return injectionChannelRegistry.createChannel(platform);
}

export function acceptInjectedEvent(config, event) {
    try {
        const channelDescriptor = Object.getOwnPropertyDescriptor(
            config,
            'channel'
        );
        if (!channelDescriptor || !Object.hasOwn(channelDescriptor, 'value')) {
            return null;
        }
        const acceptDescriptor = Object.getOwnPropertyDescriptor(
            channelDescriptor.value,
            'accept'
        );
        if (
            !acceptDescriptor ||
            !Object.hasOwn(acceptDescriptor, 'value') ||
            typeof acceptDescriptor.value !== 'function'
        ) {
            return null;
        }
        return acceptDescriptor.value.call(channelDescriptor.value, event);
    } catch (_) {
        return null;
    }
}

export function createInjectedScriptUrl(config, baseUrl) {
    try {
        const channelDescriptor = Object.getOwnPropertyDescriptor(
            config,
            'channel'
        );
        if (!channelDescriptor || !Object.hasOwn(channelDescriptor, 'value')) {
            return null;
        }
        const methodDescriptor = Object.getOwnPropertyDescriptor(
            channelDescriptor.value,
            'createScriptUrl'
        );
        if (
            !methodDescriptor ||
            !Object.hasOwn(methodDescriptor, 'value') ||
            typeof methodDescriptor.value !== 'function'
        ) {
            return null;
        }
        return methodDescriptor.value.call(channelDescriptor.value, baseUrl);
    } catch (_) {
        return null;
    }
}

export function revokeInjectionChannel(config) {
    try {
        const channelDescriptor = Object.getOwnPropertyDescriptor(
            config,
            'channel'
        );
        if (!channelDescriptor || !Object.hasOwn(channelDescriptor, 'value')) {
            return false;
        }
        const methodDescriptor = Object.getOwnPropertyDescriptor(
            channelDescriptor.value,
            'revoke'
        );
        if (
            !methodDescriptor ||
            !Object.hasOwn(methodDescriptor, 'value') ||
            typeof methodDescriptor.value !== 'function'
        ) {
            return false;
        }
        methodDescriptor.value.call(channelDescriptor.value);
        return true;
    } catch (_) {
        return false;
    }
}

export function extendAcceptedInjectedEvent(detail, metadata) {
    try {
        const authority = authorizedDetails.get(detail);
        if (!authority) return null;
        const detailEntries = inspectDataRecord(detail);
        const metadataEntries = inspectDataRecord(
            metadata,
            BUFFER_METADATA_KEYS
        );
        if (!detailEntries || !metadataEntries) return null;

        const extended = Object.create(null);
        for (const [key, value] of detailEntries) {
            Object.defineProperty(extended, key, {
                configurable: true,
                enumerable: true,
                writable: true,
                value,
            });
        }
        for (const [key, value] of metadataEntries) {
            if (Object.hasOwn(extended, key)) return null;
            if (
                (key === 'timestamp' &&
                    (!Number.isFinite(value) || value < 0)) ||
                (key === 'pageUrl' &&
                    (typeof value !== 'string' ||
                        value.length > MAX_SCRIPT_URL_CODE_UNITS))
            ) {
                return null;
            }
            Object.defineProperty(extended, key, {
                configurable: true,
                enumerable: true,
                writable: true,
                value,
            });
        }

        return brandAuthorizedDetail(
            extended,
            authority.platform,
            authority.capability
        );
    } catch (_) {
        return null;
    }
}
