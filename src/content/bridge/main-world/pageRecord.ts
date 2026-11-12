// Reads of the page's own objects. A site's getters and methods can throw
// or change shape at any release, so every read fails soft to undefined.

export type PageRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is PageRecord {
    return value !== null && typeof value === 'object';
}

export function readProperty(target: unknown, key: string): unknown {
    if (!isRecord(target)) {
        return undefined;
    }
    try {
        return target[key];
    } catch {
        return undefined;
    }
}

export function readPath(target: unknown, ...keys: string[]): unknown {
    let current = target;
    for (const key of keys) {
        current = readProperty(current, key);
    }
    return current;
}

export function callMethod(
    target: unknown,
    name: string,
    ...args: unknown[]
): unknown {
    const method = readProperty(target, name);
    if (typeof method !== 'function') {
        return undefined;
    }
    try {
        return (method as (...callArgs: unknown[]) => unknown).apply(
            target,
            args
        );
    } catch {
        return undefined;
    }
}
