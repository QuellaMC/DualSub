const REDACTED_VALUE = '[REDACTED]';
const CIRCULAR_VALUE = '[Circular]';
const UNSERIALIZABLE_VALUE = '[Unserializable]';

const SENSITIVE_KEY_FRAGMENTS = [
    'apikey',
    'accesstoken',
    'privatekey',
    'authorization',
    'password',
    'secret',
    'credential',
    'serviceaccount',
];

function isSensitiveKey(key: string): boolean {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
        normalizedKey.includes(fragment)
    );
}

function redactUrlQueryDetails(value: string): string {
    return value.replace(/\bhttps?:\/\/[^\s<>"']+/gi, (candidate) => {
        try {
            const url = new URL(candidate);
            if (!url.search && !url.hash) {
                return candidate;
            }
            return `${url.origin}${url.pathname}${url.search ? `?${REDACTED_VALUE}` : ''}${url.hash ? `#${REDACTED_VALUE}` : ''}`;
        } catch {
            return candidate;
        }
    });
}

export function redactSensitiveText(value: string): string {
    const redacted = value
        .replace(
            /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)* PRIVATE KEY-----/g,
            REDACTED_VALUE
        )
        .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED_VALUE}`)
        .replace(
            /([?&](?:api[_-]?key|access[_-]?token|authorization|password|secret|credential)=)[^&#\s]*/gi,
            `$1${REDACTED_VALUE}`
        )
        .replace(
            /(\b(?:api[_ -]?key|access[_ -]?token|private[_ -]?key|authorization|password|secret|credential|service[_ -]?account)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
            `$1${REDACTED_VALUE}`
        );
    return redactUrlQueryDetails(redacted);
}

export function redactSensitiveData(
    value: unknown,
    seen = new WeakSet<object>()
): unknown {
    if (typeof value === 'string') {
        return redactSensitiveText(value);
    }
    if (
        value === null ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }
    if (typeof value === 'undefined') {
        return undefined;
    }
    if (typeof value === 'bigint' || typeof value === 'symbol') {
        return String(value);
    }
    if (typeof value === 'function') {
        return `[Function ${value.name || 'anonymous'}]`;
    }

    if (seen.has(value)) {
        return CIRCULAR_VALUE;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? 'Invalid Date'
            : value.toISOString();
    }

    seen.add(value);
    try {
        if (value instanceof Error) {
            const redactedError: Record<string, unknown> = {
                name: redactSensitiveText(value.name),
                message: redactSensitiveText(value.message),
                ...(value.stack && { stack: redactSensitiveText(value.stack) }),
            };
            for (const key of Object.keys(value)) {
                if (key in redactedError) {
                    continue;
                }
                redactedError[key] = isSensitiveKey(key)
                    ? REDACTED_VALUE
                    : redactSensitiveData(
                          (value as unknown as Record<string, unknown>)[key],
                          seen
                      );
            }
            return redactedError;
        }

        if (Array.isArray(value)) {
            return value.map((item) => redactSensitiveData(item, seen));
        }

        const redactedObject = Object.create(null) as Record<string, unknown>;
        for (const key of Object.keys(value)) {
            if (isSensitiveKey(key)) {
                redactedObject[key] = REDACTED_VALUE;
                continue;
            }
            try {
                redactedObject[key] = redactSensitiveData(
                    (value as Record<string, unknown>)[key],
                    seen
                );
            } catch {
                redactedObject[key] = UNSERIALIZABLE_VALUE;
            }
        }
        return redactedObject;
    } catch {
        return UNSERIALIZABLE_VALUE;
    } finally {
        seen.delete(value);
    }
}

function hasLogData(data: unknown): boolean {
    if (data === null || typeof data === 'undefined') {
        return false;
    }
    if (Array.isArray(data)) {
        return data.length > 0;
    }
    return typeof data !== 'object' || Object.keys(data).length > 0;
}

function isErrorLike(value: unknown): value is Error {
    if (value instanceof Error) {
        return true;
    }
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const candidate = value as {
        message?: unknown;
        stack?: unknown;
        name?: unknown;
    };
    return (
        typeof candidate.message === 'string' &&
        (typeof candidate.stack === 'string' ||
            (typeof candidate.name === 'string' &&
                candidate.name.endsWith('Error')))
    );
}

export const LOG_LEVELS = {
    OFF: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
} as const;

export type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];

// One level per JS context, fed from the loggingLevel setting by whichever
// module owns config in that context (background loggingManager, content
// orchestrator via LOGGING_LEVEL_CHANGED, UI via settings).
let currentLevel: number = LOG_LEVELS.INFO;

export function setLoggingLevel(level: number): void {
    currentLevel = level;
}

export function getLoggingLevel(): number {
    return currentLevel;
}

function shouldLog(level: number): boolean {
    return currentLevel >= level && currentLevel > LOG_LEVELS.OFF;
}

function formatMessage(
    level: string,
    component: string,
    message: string,
    data: unknown
): string {
    const timestamp = new Date().toISOString();
    const safeMessage = redactSensitiveText(message);
    const baseMessage = `[${timestamp}] [${level}] [${component}] ${safeMessage}`;
    const safeData = redactSensitiveData(data);
    if (hasLogData(safeData)) {
        return `${baseMessage} | Data: ${JSON.stringify(safeData)}`;
    }
    return baseMessage;
}

export interface Logger {
    debug(message: string, data?: object): void;
    info(message: string, data?: object): void;
    warn(message: string, data?: object): void;
    error(message: string, error?: unknown, context?: object): void;
}

export function createLogger(component: string): Logger {
    return {
        debug(message, data = {}) {
            if (shouldLog(LOG_LEVELS.DEBUG)) {
                console.debug(formatMessage('DEBUG', component, message, data));
            }
        },
        info(message, data = {}) {
            if (shouldLog(LOG_LEVELS.INFO)) {
                console.info(formatMessage('INFO', component, message, data));
            }
        },
        warn(message, data = {}) {
            if (shouldLog(LOG_LEVELS.WARN)) {
                console.warn(formatMessage('WARN', component, message, data));
            }
        },
        error(message, error = null, context = {}) {
            if (!shouldLog(LOG_LEVELS.ERROR)) {
                return;
            }
            const actualError = isErrorLike(error) ? error : null;
            const actualContext =
                error !== null && typeof error === 'object' && !actualError
                    ? { ...error, ...context }
                    : context;
            const errorData = {
                ...actualContext,
                ...(actualError && {
                    errorMessage: actualError.message,
                    errorStack: actualError.stack,
                    errorName: actualError.name,
                }),
            };
            console.error(
                formatMessage('ERROR', component, message, errorData)
            );
        },
    };
}
