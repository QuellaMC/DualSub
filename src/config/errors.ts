export type StorageArea = 'sync' | 'local';
export const STORAGE_AREAS: readonly StorageArea[] = ['sync', 'local'];

export type StorageOperation = 'get' | 'set' | 'remove';

const QUOTA_KEYWORDS = [
    'quota exceeded',
    'quota_exceeded',
    'storage quota',
    'maximum storage',
    'storage limit',
    'quota_bytes_per_item',
    'max_write_operations_per_hour',
    'max_write_operations_per_minute',
];

function describeError(error: unknown): string {
    if (error === null || error === undefined) {
        return 'Unknown error';
    }
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'object') {
        const message = (error as { message?: unknown }).message;
        return typeof message === 'string' && message
            ? message
            : 'Unknown error';
    }
    if (typeof error === 'string') {
        return error;
    }
    if (
        typeof error === 'number' ||
        typeof error === 'boolean' ||
        typeof error === 'bigint'
    ) {
        return String(error);
    }
    return 'Unknown error';
}

function isQuotaMessage(error: unknown): boolean {
    const message = describeError(error).toLowerCase();
    return QUOTA_KEYWORDS.some((keyword) => message.includes(keyword));
}

/** A single chrome.storage operation failed. */
export class ConfigStorageError extends Error {
    override readonly name = 'ConfigStorageError';
    readonly operation: StorageOperation;
    readonly area: StorageArea;
    readonly keys: readonly string[];
    readonly isQuotaError: boolean;

    constructor(
        operation: StorageOperation,
        area: StorageArea,
        keys: readonly string[],
        cause: unknown
    ) {
        const keyLabel =
            keys.length === 1
                ? `key "${keys[0]}"`
                : `keys [${keys.join(', ')}]`;
        super(
            `ConfigService: ${operation} operation failed for ${keyLabel} in ${area} storage: ${describeError(cause)}`,
            { cause }
        );
        this.operation = operation;
        this.area = area;
        this.keys = [...keys];
        this.isQuotaError = isQuotaMessage(this) || isQuotaMessage(cause);
    }
}

export interface AreaResult {
    status: 'ok' | 'error' | 'not-requested';
    error?: unknown;
}

interface ReadFailureSummary {
    ok: false;
    degraded: boolean;
    failedAreas: StorageArea[];
    areas: Record<StorageArea, { status: AreaResult['status'] }>;
    unknownKeyCount: number;
    excludedSensitiveKeyCount: number;
}

/**
 * A caller required an authoritative read, but one or more requested storage
 * areas could not be read. Carries metadata only — never setting values.
 */
export class ConfigServiceReadError extends Error {
    override readonly name = 'ConfigServiceReadError';
    readonly failedAreas: StorageArea[];
    readonly result: ReadFailureSummary;

    constructor(
        failedAreas: readonly StorageArea[],
        areas: Record<StorageArea, AreaResult>,
        counts: { unknownKeyCount: number; excludedSensitiveKeyCount: number }
    ) {
        const areaLabel = failedAreas.join(', ') || 'unknown';
        const firstFailure = failedAreas[0];
        super(`ConfigService read failed for storage area(s): ${areaLabel}`, {
            cause: firstFailure ? areas[firstFailure].error : undefined,
        });
        this.failedAreas = [...failedAreas];
        this.result = {
            ok: false,
            degraded: true,
            failedAreas: [...failedAreas],
            areas: {
                sync: { status: areas.sync.status },
                local: { status: areas.local.status },
            },
            unknownKeyCount: counts.unknownKeyCount,
            excludedSensitiveKeyCount: counts.excludedSensitiveKeyCount,
        };
    }
}

/** Aggregated multi-area write/validation failure (setMultiple, defaults). */
export class ConfigWriteError extends Error {
    override readonly name = 'ConfigWriteError';
    readonly completeFailure: boolean;
    readonly failedAreas: StorageArea[];
    readonly errors: { area: StorageArea; error: unknown }[];

    constructor(
        message: string,
        options: {
            completeFailure: boolean;
            errors: { area: StorageArea; error: unknown }[];
        }
    ) {
        super(message, { cause: options.errors[0]?.error });
        this.completeFailure = options.completeFailure;
        this.errors = options.errors;
        this.failedAreas = options.errors.map((entry) => entry.area);
    }
}

/** setMultiple rejected some keys/values before any write happened. */
export class ConfigValidationError extends Error {
    override readonly name = 'ConfigValidationError';
    readonly invalidKeys: string[];

    constructor(invalidKeys: readonly string[]) {
        super(
            `setMultiple failed with ${invalidKeys.length} validation error(s): ${invalidKeys
                .map((key) => `invalid "${key}"`)
                .join('; ')}`
        );
        this.invalidKeys = [...invalidKeys];
    }
}
