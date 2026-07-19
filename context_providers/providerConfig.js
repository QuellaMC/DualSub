import { configSchema } from '../config/configSchema.js';
import { configService } from '../services/configService.js';

const PROVIDER_CONFIG_READ_ERROR_MESSAGE =
    'Required provider configuration is unavailable';
const CONFIG_SCHEMA_KEY_COUNT = Object.keys(configSchema).length;

/**
 * Stable provider-boundary error for configuration that could not be read
 * authoritatively. Dynamic storage details remain available only through the
 * standard, non-enumerable Error `cause` property.
 */
export class ProviderConfigReadError extends Error {
    constructor(cause) {
        super(PROVIDER_CONFIG_READ_ERROR_MESSAGE);
        if (cause !== undefined) {
            Object.defineProperty(this, 'cause', {
                value: cause,
                enumerable: false,
                configurable: true,
                writable: true,
            });
        }
        this.name = 'ProviderConfigReadError';
        this.code = 'PROVIDER_CONFIG_READ_FAILED';
        this.retryable = false;
        this.shouldRetry = false;
    }
}

function createRequiredKeysSnapshot(keys, nativeStructuredClone) {
    if (
        !Array.isArray(keys) ||
        Object.getPrototypeOf(keys) !== Array.prototype
    ) {
        return null;
    }

    const lengthDescriptor = Object.getOwnPropertyDescriptor(keys, 'length');
    if (
        lengthDescriptor === undefined ||
        !Object.hasOwn(lengthDescriptor, 'value') ||
        !Number.isInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 1 ||
        lengthDescriptor.value > CONFIG_SCHEMA_KEY_COUNT
    ) {
        return null;
    }

    const length = lengthDescriptor.value;
    if (Reflect.ownKeys(keys).length !== length + 1) return null;

    const uniqueKeys = new Set();
    const requestedKeys = new Array(length);
    for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(keys, String(index));
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }

        const key = descriptor.value;
        if (
            typeof key !== 'string' ||
            key === '__proto__' ||
            uniqueKeys.has(key) ||
            !Object.hasOwn(configSchema, key)
        ) {
            return null;
        }
        uniqueKeys.add(key);
        requestedKeys[index] = key;
    }

    nativeStructuredClone(keys);

    return Object.freeze(requestedKeys);
}

function getOwnDataDescriptor(record, key) {
    if (
        record === null ||
        (typeof record !== 'object' && typeof record !== 'function')
    ) {
        return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
        ? descriptor
        : null;
}

function isObjectRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Native structured cloning reads enumerable properties. Walk descriptors first
// so an accessor can never execute during the cloneability/proxy check below.
function hasOnlyDataProperties(value, seen = new WeakSet()) {
    if (value === null) return true;

    const valueType = typeof value;
    if (valueType !== 'object') {
        return valueType !== 'function' && valueType !== 'symbol';
    }
    if (seen.has(value)) return true;
    seen.add(value);

    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray) {
        if (prototype !== Array.prototype) return false;
    } else if (prototype !== null && prototype !== Object.prototype) {
        const constructorDescriptor = Object.getOwnPropertyDescriptor(
            prototype,
            'constructor'
        );
        if (constructorDescriptor !== undefined) return false;
    }

    const ownKeys = Reflect.ownKeys(value);
    for (let index = 0; index < ownKeys.length; index += 1) {
        const key = ownKeys[index];
        if (typeof key === 'symbol') return false;

        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
            descriptor === undefined ||
            !Object.hasOwn(descriptor, 'value') ||
            !hasOnlyDataProperties(descriptor.value, seen)
        ) {
            return false;
        }
    }

    return true;
}

function canStructuredClone(value, nativeStructuredClone) {
    try {
        // Besides proving cloneability, the native host operation rejects
        // transparent Proxy objects that descriptor checks cannot distinguish.
        nativeStructuredClone(value);
        return true;
    } catch {
        return false;
    }
}

function isDenseEmptyArray(value, nativeStructuredClone) {
    if (
        !Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Array.prototype ||
        !canStructuredClone(value, nativeStructuredClone)
    ) {
        return false;
    }

    const lengthDescriptor = getOwnDataDescriptor(value, 'length');
    if (lengthDescriptor?.value !== 0) return false;

    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === 1 && ownKeys[0] === 'length';
}

function deepFreezeClonedValue(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') return true;
    if (seen.has(value)) return true;
    seen.add(value);

    // The source graph was descriptor-checked before native cloning. Inspect
    // the clone again by descriptors so cycles remain safe and nested values
    // can be frozen without property reads.
    const ownKeys = Reflect.ownKeys(value);
    for (let index = 0; index < ownKeys.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
            value,
            ownKeys[index]
        );
        if (
            descriptor === undefined ||
            !Object.hasOwn(descriptor, 'value') ||
            !deepFreezeClonedValue(descriptor.value, seen)
        ) {
            return false;
        }
    }

    try {
        Object.freeze(value);
        return true;
    } catch {
        return false;
    }
}

function createAuthoritativeSnapshot(result, keys, nativeStructuredClone) {
    if (
        !isObjectRecord(result) ||
        !hasOnlyDataProperties(result) ||
        !canStructuredClone(result, nativeStructuredClone)
    ) {
        return null;
    }

    const okDescriptor = getOwnDataDescriptor(result, 'ok');
    const degradedDescriptor = getOwnDataDescriptor(result, 'degraded');
    const failedAreasDescriptor = getOwnDataDescriptor(result, 'failedAreas');
    const valuesDescriptor = getOwnDataDescriptor(result, 'values');
    const areasDescriptor = getOwnDataDescriptor(result, 'areas');

    if (
        okDescriptor?.value !== true ||
        degradedDescriptor?.value !== false ||
        failedAreasDescriptor === null ||
        !isDenseEmptyArray(
            failedAreasDescriptor.value,
            nativeStructuredClone
        ) ||
        valuesDescriptor === null ||
        !isObjectRecord(valuesDescriptor.value) ||
        !canStructuredClone(valuesDescriptor.value, nativeStructuredClone) ||
        areasDescriptor === null ||
        !isObjectRecord(areasDescriptor.value) ||
        !canStructuredClone(areasDescriptor.value, nativeStructuredClone)
    ) {
        return null;
    }

    const values = valuesDescriptor.value;
    const areas = areasDescriptor.value;
    const verifiedAreas = new Set();
    const clonedValues = new Array(keys.length);

    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const scope = configSchema[key].scope;
        if (!verifiedAreas.has(scope)) {
            const areaDescriptor = getOwnDataDescriptor(areas, scope);
            if (
                areaDescriptor === null ||
                !isObjectRecord(areaDescriptor.value) ||
                !canStructuredClone(
                    areaDescriptor.value,
                    nativeStructuredClone
                ) ||
                getOwnDataDescriptor(areaDescriptor.value, 'status')?.value !==
                    'ok'
            ) {
                return null;
            }
            verifiedAreas.add(scope);
        }

        const valueDescriptor = getOwnDataDescriptor(values, key);
        if (valueDescriptor === null) return null;

        let clonedValue;
        try {
            clonedValue = nativeStructuredClone(valueDescriptor.value);
        } catch {
            return null;
        }
        if (!deepFreezeClonedValue(clonedValue)) return null;
        clonedValues[index] = clonedValue;
    }

    const snapshot = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
        Object.defineProperty(snapshot, keys[index], {
            value: clonedValues[index],
            enumerable: true,
            configurable: false,
            writable: false,
        });
    }

    return Object.freeze(snapshot);
}

/**
 * Read one provider configuration snapshot across every required storage area.
 * The returned object has a null prototype and contains only the requested own
 * values. Any invalid request, degraded read, or malformed result is normalized
 * to {@link ProviderConfigReadError} without exposing configuration data.
 *
 * @param {string[]} keys
 * @returns {Promise<Record<string, unknown>>}
 * @throws {ProviderConfigReadError}
 */
export async function readRequiredProviderConfig(keys) {
    let nativeStructuredClone;
    try {
        nativeStructuredClone = globalThis.structuredClone;
    } catch (cause) {
        throw new ProviderConfigReadError(cause);
    }
    if (typeof nativeStructuredClone !== 'function') {
        throw new ProviderConfigReadError();
    }

    let requestedKeys;
    try {
        requestedKeys = createRequiredKeysSnapshot(keys, nativeStructuredClone);
    } catch (cause) {
        throw new ProviderConfigReadError(cause);
    }
    if (!requestedKeys) {
        throw new ProviderConfigReadError();
    }

    let result;
    try {
        result = await configService.readMultipleResultStrict(requestedKeys, {
            includeSensitive: true,
        });
    } catch (cause) {
        throw new ProviderConfigReadError(cause);
    }

    let snapshot;
    try {
        snapshot = createAuthoritativeSnapshot(
            result,
            requestedKeys,
            nativeStructuredClone
        );
    } catch (cause) {
        throw new ProviderConfigReadError(cause);
    }
    if (snapshot === null) throw new ProviderConfigReadError();

    return snapshot;
}
