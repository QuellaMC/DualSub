import { MessageActions } from '../constants/messageActions.js';
import { CONTEXT_TYPES } from '../constants/contextTypes.js';
import {
    createPlainDataSnapshot,
    tryCreatePlainDataSnapshot,
    utf8ByteLength,
} from './plainDataSnapshot.js';

export const MessageSenderRoles = Object.freeze({
    BACKGROUND: 'background',
    CONTENT: 'content',
    OPTIONS: 'options',
    POPUP: 'popup',
    SIDEPANEL: 'sidepanel',
});

const ABSENT_OWN_PROPERTY = Symbol('absent-own-property');
const INVALID_OWN_PROPERTY = Symbol('invalid-own-property');
const MESSAGE_ACTIONS = new Set(Object.values(MessageActions));
const MAX_PROTOCOL_ENVELOPE_KEYS = 32;

const ROUTES = Object.freeze({
    [MessageActions.TRANSLATE]: Object.freeze({
        roles: Object.freeze([MessageSenderRoles.CONTENT]),
        keys: Object.freeze([
            'action',
            'text',
            'targetLang',
            'cueStart',
            'cueVideoId',
        ]),
    }),
    [MessageActions.ANALYZE_CONTEXT]: Object.freeze({
        roles: Object.freeze([
            MessageSenderRoles.CONTENT,
            MessageSenderRoles.SIDEPANEL,
        ]),
        keysByRole: Object.freeze({
            [MessageSenderRoles.CONTENT]: Object.freeze([
                'action',
                'text',
                'contextTypes',
                'language',
                'targetLanguage',
                'platform',
                'requestId',
            ]),
            [MessageSenderRoles.SIDEPANEL]: Object.freeze([
                'action',
                'text',
                'contextTypes',
                'targetLanguage',
                'requestId',
            ]),
        }),
    }),
    [MessageActions.CONFIG_CHANGED]: Object.freeze({
        roles: Object.freeze([MessageSenderRoles.POPUP]),
        keys: Object.freeze(['action', 'changes']),
    }),
    [MessageActions.LOGGING_LEVEL_CHANGED]: Object.freeze({
        roles: Object.freeze([MessageSenderRoles.BACKGROUND]),
        keys: Object.freeze(['action', 'level']),
    }),
    [MessageActions.SIDEPANEL_PAUSE_VIDEO]: Object.freeze({
        roles: Object.freeze([MessageSenderRoles.BACKGROUND]),
        keys: Object.freeze(['action']),
    }),
    [MessageActions.SIDEPANEL_WORD_SELECTED]: Object.freeze({
        roles: Object.freeze([MessageSenderRoles.CONTENT]),
        keys: Object.freeze(['action', 'options']),
    }),
});

const ANALYZE_SNAPSHOT_LIMITS = Object.freeze({
    maxDepth: 8,
    maxEntries: 256,
    maxStringBytes: 65536,
    maxTotalBytes: 65536,
});
const CONFIG_CHANGED_LIMITS = Object.freeze({
    maxDepth: 6,
    maxEntries: 64,
    maxStringBytes: 4096,
    maxTotalBytes: 16384,
});
const SIDEPANEL_WORD_INTENT_LIMITS = Object.freeze({
    maxDepth: 2,
    maxEntries: 8,
    maxStringBytes: 64,
    maxTotalBytes: 256,
});
const SELECTION_SNAPSHOT_LIMITS = Object.freeze({
    maxDepth: 4,
    maxEntries: 256,
    maxStringBytes: 4096,
    maxTotalBytes: 6144,
});

const BINDING_KEYS = Object.freeze(['registrationId', 'tabId', 'windowId']);
const CONTENT_SELECTION_KEYS = Object.freeze([
    'lifecycleGeneration',
    'selectionRevision',
    'renderRevision',
    'reason',
    'entries',
]);
const SELECTION_STATE_KEYS = Object.freeze([
    'selectionOwnerGeneration',
    'selectionRevision',
    'renderRevision',
    'reason',
    'entries',
]);
const SELECTION_REMOVAL_REQUEST_KEYS = Object.freeze([
    'binding',
    'requestId',
    'selectionOwnerGeneration',
    'selectionRevision',
    'renderRevision',
    'wordIndex',
]);
const SELECTION_REMOVAL_COMMAND_KEYS = Object.freeze([
    'requestId',
    'lifecycleGeneration',
    'selectionRevision',
    'renderRevision',
    'wordIndex',
]);
const SELECTION_REMOVAL_RESULT_KEYS = Object.freeze([
    'binding',
    'requestId',
    'selectionOwnerGeneration',
    'status',
]);
const SELECTION_REASONS = new Set([
    'toggle',
    'add',
    'remove',
    'clear',
    'restore',
    'subtitle-change',
]);
const MAX_CONFIG_CHANGED_KEYS = 32;
const MAX_SELECTION_ENTRIES = 64;
const MAX_SELECTION_WORD_BYTES = 256;
const MAX_SELECTION_JOINED_CODE_UNITS = 500;
const MAX_SELECTION_JOINED_BYTES = 4096;

function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    try {
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    } catch (_) {
        return false;
    }
}

function readExactRecord(record, expectedKeys) {
    if (!isPlainRecord(record)) return null;
    try {
        const keys = Reflect.ownKeys(record);
        if (
            keys.length !== expectedKeys.length ||
            keys.some((key) => typeof key !== 'string') ||
            !expectedKeys.every((key) => Object.hasOwn(record, key))
        ) {
            return null;
        }
        return record;
    } catch (_) {
        return null;
    }
}

function readRoute(message, action, senderRole) {
    const route = ROUTES[action];
    if (!route) return null;
    if (senderRole !== undefined && !route.roles.includes(senderRole)) {
        return null;
    }
    const expectedKeys = route.keysByRole?.[senderRole] ?? route.keys;
    if (!expectedKeys) return null;
    const record = readExactRecord(message, expectedKeys);
    return record?.action === action ? record : null;
}

function readDenseArray(value) {
    try {
        if (
            !Array.isArray(value) ||
            Object.getPrototypeOf(value) !== Array.prototype ||
            Object.getOwnPropertySymbols(value).length > 0
        ) {
            return null;
        }
        const keys = Object.keys(value);
        if (
            keys.length !== value.length ||
            keys.some((key, index) => key !== String(index))
        ) {
            return null;
        }
        return [...value];
    } catch (_) {
        return null;
    }
}

function isNonBlankString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isNonBlankTrimmedString(value) {
    return isNonBlankString(value) && value === value.trim();
}

function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function isBoundedError(value) {
    return (
        isNonBlankTrimmedString(value) &&
        String.prototype.isWellFormed.call(value) &&
        utf8ByteLength(value) <= 512
    );
}

function normalizeTranslationRequest(value, exact = false) {
    const input = exact
        ? readRoute(value, MessageActions.TRANSLATE)
        : isPlainRecord(value)
          ? value
          : null;
    if (
        !input ||
        (exact && input.action !== MessageActions.TRANSLATE) ||
        !isNonBlankString(input.text) ||
        !isNonBlankTrimmedString(input.targetLang) ||
        !Number.isFinite(input.cueStart) ||
        input.cueStart < 0 ||
        !isNonBlankTrimmedString(input.cueVideoId)
    ) {
        return null;
    }
    return Object.freeze({
        action: MessageActions.TRANSLATE,
        text: input.text,
        targetLang: input.targetLang,
        cueStart: input.cueStart,
        cueVideoId: input.cueVideoId,
    });
}

export function buildTranslationRequestMessage(input) {
    const request = normalizeTranslationRequest(input);
    if (!request) throw new TypeError('Invalid translation request');
    return request;
}

export function parseTranslationRequestMessage(message) {
    return normalizeTranslationRequest(message, true);
}

export function buildTranslationSuccessResponse(expectedRequest, result) {
    const request = normalizeTranslationRequest(expectedRequest, true);
    if (
        !request ||
        !isPlainRecord(result) ||
        !isNonBlankString(result.translatedText)
    ) {
        throw new TypeError('Invalid translation success result');
    }
    return Object.freeze({ translatedText: result.translatedText });
}

export function buildTranslationFailureResponse(expectedRequest, failure) {
    const request = normalizeTranslationRequest(expectedRequest, true);
    if (!request || !isPlainRecord(failure)) {
        throw new TypeError('Invalid translation failure result');
    }
    return Object.freeze({ error: 'Translation failed' });
}

export function parseTranslationResponseMessage(message, expectedRequest) {
    const request = normalizeTranslationRequest(expectedRequest, true);
    if (!request) return null;

    const success = readExactRecord(message, ['translatedText']);
    if (success && isNonBlankString(success.translatedText)) {
        return Object.freeze({
            status: 'success',
            translatedText: success.translatedText,
            cueVideoId: request.cueVideoId,
        });
    }

    const failure = readExactRecord(message, ['error']);
    return failure?.error === 'Translation failed'
        ? Object.freeze({
              status: 'failure',
              error: 'Translation failed',
              cueVideoId: request.cueVideoId,
          })
        : null;
}

function normalizeContextTypes(value, filterInvalid) {
    const input = readDenseArray(value);
    if (!input) return null;

    const normalized = filterInvalid
        ? input.filter(
              (type, index) =>
                  CONTEXT_TYPES.includes(type) && input.indexOf(type) === index
          )
        : input;
    if (normalized.length < 1 || normalized.length > CONTEXT_TYPES.length) {
        return null;
    }
    if (
        !filterInvalid &&
        normalized.some(
            (type, index) =>
                !CONTEXT_TYPES.includes(type) ||
                normalized.indexOf(type) !== index
        )
    ) {
        return null;
    }
    return Object.freeze([...normalized]);
}

function normalizeAnalyzeRequest(senderRole, value, exact = false) {
    if (
        senderRole !== MessageSenderRoles.CONTENT &&
        senderRole !== MessageSenderRoles.SIDEPANEL
    ) {
        return null;
    }
    const input = exact
        ? readRoute(value, MessageActions.ANALYZE_CONTEXT, senderRole)
        : isPlainRecord(value)
          ? value
          : null;
    const contextTypes = input
        ? normalizeContextTypes(input.contextTypes, !exact)
        : null;
    if (
        !input ||
        !contextTypes ||
        !isNonBlankString(input.text) ||
        !isNonBlankString(input.targetLanguage) ||
        !isNonBlankString(input.requestId)
    ) {
        return null;
    }

    if (senderRole === MessageSenderRoles.CONTENT) {
        if (
            !isNonBlankString(input.language) ||
            !isNonBlankString(input.platform)
        ) {
            return null;
        }
        return Object.freeze({
            action: MessageActions.ANALYZE_CONTEXT,
            text: input.text,
            contextTypes,
            language: input.language,
            targetLanguage: input.targetLanguage,
            platform: input.platform,
            requestId: input.requestId,
        });
    }

    return Object.freeze({
        action: MessageActions.ANALYZE_CONTEXT,
        text: input.text,
        contextTypes,
        targetLanguage: input.targetLanguage,
        requestId: input.requestId,
    });
}

export function buildAnalyzeContextRequestMessage(senderRole, input) {
    const request = normalizeAnalyzeRequest(senderRole, input);
    if (!request) throw new TypeError('Invalid analyze-context request');
    return request;
}

export function parseAnalyzeContextRequestMessage(message, senderRole) {
    return normalizeAnalyzeRequest(senderRole, message, true);
}

function deriveAnalyzeContextType(contextTypes) {
    if (contextTypes.length === 1) return contextTypes[0];
    return contextTypes.length === CONTEXT_TYPES.length &&
        CONTEXT_TYPES.every((type) => contextTypes.includes(type))
        ? 'all'
        : 'combined';
}

function snapshotAnalysis(value) {
    if (!isPlainRecord(value)) {
        throw new TypeError('Invalid analyze-context analysis');
    }
    return createPlainDataSnapshot(value, ANALYZE_SNAPSHOT_LIMITS).value;
}

function createAnalyzeResultProjection(request, analysis) {
    return Object.freeze({
        analysis,
        contextType: deriveAnalyzeContextType(request.contextTypes),
        contextTypes: Object.freeze([...request.contextTypes]),
        isStructured: true,
    });
}

export function buildAnalyzeContextSuccessResponse(
    senderRole,
    expectedRequest,
    result
) {
    const request = normalizeAnalyzeRequest(senderRole, expectedRequest, true);
    if (!request || !isPlainRecord(result)) {
        throw new TypeError('Invalid analyze-context success response');
    }
    let analysis;
    try {
        analysis = snapshotAnalysis(result.analysis);
    } catch (_) {
        throw new TypeError('Invalid analyze-context success response');
    }
    return Object.freeze({
        success: true,
        result: Object.freeze({ analysis }),
    });
}

export function buildAnalyzeContextFailureResponse(
    senderRole,
    expectedRequest,
    failure
) {
    const request = normalizeAnalyzeRequest(senderRole, expectedRequest, true);
    if (
        !request ||
        !isPlainRecord(failure) ||
        !isBoundedError(failure.error) ||
        typeof failure.shouldRetry !== 'boolean'
    ) {
        throw new TypeError('Invalid analyze-context failure response');
    }
    return Object.freeze({
        success: false,
        error: failure.error,
        shouldRetry: failure.shouldRetry,
    });
}

export function parseAnalyzeContextResponseMessage(
    message,
    expectedRequest,
    senderRole
) {
    const request = normalizeAnalyzeRequest(senderRole, expectedRequest, true);
    if (!request) return null;

    try {
        const success = readExactRecord(message, ['success', 'result']);
        if (success?.success === true) {
            const result = readExactRecord(success.result, ['analysis']);
            if (result) {
                const analysis = snapshotAnalysis(result.analysis);
                return Object.freeze({
                    status: 'success',
                    requestId: request.requestId,
                    result: createAnalyzeResultProjection(request, analysis),
                });
            }
        }

        const failure = readExactRecord(message, [
            'success',
            'error',
            'shouldRetry',
        ]);
        if (
            failure?.success !== false ||
            !isBoundedError(failure?.error) ||
            typeof failure.shouldRetry !== 'boolean'
        ) {
            return null;
        }
        return Object.freeze({
            status: 'failure',
            requestId: request.requestId,
            error: failure.error,
            shouldRetry: failure.shouldRetry,
        });
    } catch (_) {
        return null;
    }
}

function readOwnDataValue(
    record,
    key,
    required = true,
    requireEnumerable = false
) {
    if (record === null || typeof record !== 'object') {
        return INVALID_OWN_PROPERTY;
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
        return required ? INVALID_OWN_PROPERTY : ABSENT_OWN_PROPERTY;
    }
    if (
        !Object.hasOwn(descriptor, 'value') ||
        (requireEnumerable && descriptor.enumerable !== true)
    ) {
        return INVALID_OWN_PROPERTY;
    }
    return descriptor.value;
}

function readRuntimeEndpoints(runtime) {
    if (
        !runtime ||
        typeof runtime.id !== 'string' ||
        runtime.id.length === 0 ||
        typeof runtime.getManifest !== 'function' ||
        typeof runtime.getURL !== 'function'
    ) {
        return null;
    }
    const manifest = runtime.getManifest();
    const paths = {
        background: manifest?.background?.service_worker,
        options: manifest?.options_ui?.page,
        popup: manifest?.action?.default_popup,
        sidepanel: manifest?.side_panel?.default_path,
    };
    if (
        Object.values(paths).some(
            (path) => typeof path !== 'string' || path.length === 0
        )
    ) {
        return null;
    }

    const extensionRoot = runtime.getURL('');
    const endpoints = {
        backgroundUrl: runtime.getURL(paths.background),
        extensionId: runtime.id,
        extensionOrigin:
            typeof extensionRoot === 'string'
                ? extensionRoot.replace(/\/+$/u, '')
                : null,
        optionsUrl: runtime.getURL(paths.options),
        popupUrl: runtime.getURL(paths.popup),
        sidepanelUrl: runtime.getURL(paths.sidepanel),
    };
    return Object.values(endpoints).every(
        (value) => typeof value === 'string' && value.length > 0
    )
        ? endpoints
        : null;
}

function parseSupportedContentUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return null;
    const parsedUrl = new URL(rawUrl);
    if (
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.port !== '' ||
        parsedUrl.hostname.endsWith('.')
    ) {
        return null;
    }

    const platform =
        parsedUrl.hostname === 'netflix.com' ||
        parsedUrl.hostname.endsWith('.netflix.com')
            ? 'netflix'
            : parsedUrl.hostname === 'disneyplus.com' ||
                parsedUrl.hostname.endsWith('.disneyplus.com')
              ? 'disneyplus'
              : null;
    return platform
        ? {
              href: parsedUrl.href,
              origin: parsedUrl.origin,
              platform,
          }
        : null;
}

export function classifyExtensionMessageSender(
    sender,
    runtime = globalThis.chrome?.runtime
) {
    try {
        const endpoints = readRuntimeEndpoints(runtime);
        if (!endpoints) return null;

        const id = readOwnDataValue(sender, 'id');
        const url = readOwnDataValue(sender, 'url');
        const origin = readOwnDataValue(sender, 'origin', false);
        const tab = readOwnDataValue(sender, 'tab', false);
        if (
            id !== endpoints.extensionId ||
            typeof url !== 'string' ||
            origin === INVALID_OWN_PROPERTY ||
            tab === INVALID_OWN_PROPERTY
        ) {
            return null;
        }

        const extensionRole =
            url === endpoints.backgroundUrl
                ? MessageSenderRoles.BACKGROUND
                : url === endpoints.sidepanelUrl
                  ? MessageSenderRoles.SIDEPANEL
                  : url === endpoints.popupUrl
                    ? MessageSenderRoles.POPUP
                    : url === endpoints.optionsUrl
                      ? MessageSenderRoles.OPTIONS
                      : null;

        if (extensionRole === MessageSenderRoles.OPTIONS) {
            if (
                origin !== ABSENT_OWN_PROPERTY &&
                origin !== null &&
                origin !== endpoints.extensionOrigin
            ) {
                return null;
            }
            if (tab !== ABSENT_OWN_PROPERTY && tab !== null) {
                if (readOwnDataValue(tab, 'url') !== endpoints.optionsUrl) {
                    return null;
                }
            }
        } else if (extensionRole) {
            if (
                (origin !== ABSENT_OWN_PROPERTY &&
                    origin !== null &&
                    origin !== endpoints.extensionOrigin) ||
                (tab !== ABSENT_OWN_PROPERTY && tab !== null)
            ) {
                return null;
            }
        }
        if (extensionRole) return Object.freeze({ role: extensionRole });
        if (tab === ABSENT_OWN_PROPERTY || tab === null) return null;

        const documentId = readOwnDataValue(sender, 'documentId');
        const documentLifecycle = readOwnDataValue(
            sender,
            'documentLifecycle',
            true,
            true
        );
        const frameId = readOwnDataValue(sender, 'frameId');
        const tabId = readOwnDataValue(tab, 'id');
        const windowId = readOwnDataValue(tab, 'windowId');
        const active = readOwnDataValue(tab, 'active');
        const tabUrl = readOwnDataValue(tab, 'url');
        if (
            !isNonBlankString(documentId) ||
            documentLifecycle !== 'active' ||
            frameId !== 0 ||
            !isNonnegativeSafeInteger(tabId) ||
            !isNonnegativeSafeInteger(windowId) ||
            active !== true
        ) {
            return null;
        }

        const parsedSenderUrl = parseSupportedContentUrl(url);
        const parsedTabUrl = parseSupportedContentUrl(tabUrl);
        if (
            !parsedSenderUrl ||
            !parsedTabUrl ||
            parsedSenderUrl.platform !== parsedTabUrl.platform ||
            parsedSenderUrl.origin !== parsedTabUrl.origin ||
            (origin !== ABSENT_OWN_PROPERTY &&
                origin !== null &&
                origin !== parsedSenderUrl.origin)
        ) {
            return null;
        }

        return Object.freeze({
            role: MessageSenderRoles.CONTENT,
            platform: parsedSenderUrl.platform,
            tabId,
            windowId,
            documentId,
            documentLifecycle: 'active',
            origin: parsedSenderUrl.origin,
            senderUrl: parsedSenderUrl.href,
            tabUrl: parsedTabUrl.href,
            frameId: 0,
        });
    } catch (_) {
        return null;
    }
}

export function readProtocolMessageAction(message) {
    if (!isPlainRecord(message)) return null;
    try {
        const keys = Reflect.ownKeys(message);
        if (
            keys.length < 1 ||
            keys.length > MAX_PROTOCOL_ENVELOPE_KEYS ||
            keys.some((key) => typeof key !== 'string')
        ) {
            return null;
        }
        const action = readOwnDataValue(message, 'action', true, true);
        return typeof action === 'string' && MESSAGE_ACTIONS.has(action)
            ? action
            : null;
    } catch (_) {
        return null;
    }
}

function normalizeConfigChanges(input) {
    const snapshot = tryCreatePlainDataSnapshot(input, CONFIG_CHANGED_LIMITS);
    if (!snapshot.accepted || !isPlainRecord(snapshot.value)) return null;
    const keys = Object.keys(snapshot.value);
    return keys.length >= 1 && keys.length <= MAX_CONFIG_CHANGED_KEYS
        ? snapshot.value
        : null;
}

export function buildConfigChangedRequestMessage(changes) {
    const normalizedChanges = normalizeConfigChanges(changes);
    if (!normalizedChanges) {
        throw new TypeError('Invalid config-change request');
    }
    return Object.freeze({
        action: MessageActions.CONFIG_CHANGED,
        changes: normalizedChanges,
    });
}

export function parseConfigChangedRequestMessage(message, senderRole) {
    const envelope = readRoute(
        message,
        MessageActions.CONFIG_CHANGED,
        senderRole
    );
    const changes = envelope ? normalizeConfigChanges(envelope.changes) : null;
    return changes
        ? Object.freeze({
              action: MessageActions.CONFIG_CHANGED,
              changes,
          })
        : null;
}

export function buildLoggingLevelChangedRequestMessage(level) {
    if (!Number.isSafeInteger(level) || level < 0 || level > 4) {
        throw new TypeError('Invalid logging-level request');
    }
    return Object.freeze({
        action: MessageActions.LOGGING_LEVEL_CHANGED,
        level,
    });
}

export function parseLoggingLevelChangedRequestMessage(message, senderRole) {
    const envelope = readRoute(
        message,
        MessageActions.LOGGING_LEVEL_CHANGED,
        senderRole
    );
    return envelope &&
        Number.isSafeInteger(envelope.level) &&
        envelope.level >= 0 &&
        envelope.level <= 4
        ? Object.freeze({
              action: MessageActions.LOGGING_LEVEL_CHANGED,
              level: envelope.level,
          })
        : null;
}

export function buildSidePanelPauseVideoRequestMessage() {
    return Object.freeze({ action: MessageActions.SIDEPANEL_PAUSE_VIDEO });
}

export function parseSidePanelPauseVideoRequestMessage(message, senderRole) {
    return readRoute(message, MessageActions.SIDEPANEL_PAUSE_VIDEO, senderRole)
        ? buildSidePanelPauseVideoRequestMessage()
        : null;
}

function normalizeContentControlRequest(expectedRequest) {
    const action = readProtocolMessageAction(expectedRequest);
    switch (action) {
        case MessageActions.CONFIG_CHANGED:
            return parseConfigChangedRequestMessage(
                expectedRequest,
                MessageSenderRoles.POPUP
            );
        case MessageActions.LOGGING_LEVEL_CHANGED:
            return parseLoggingLevelChangedRequestMessage(
                expectedRequest,
                MessageSenderRoles.BACKGROUND
            );
        case MessageActions.SIDEPANEL_PAUSE_VIDEO:
            return parseSidePanelPauseVideoRequestMessage(
                expectedRequest,
                MessageSenderRoles.BACKGROUND
            );
        default:
            return null;
    }
}

export function buildContentControlResponseMessage(expectedRequest, result) {
    const request = normalizeContentControlRequest(expectedRequest);
    if (!request || !isPlainRecord(result)) {
        throw new TypeError('Invalid content-control response');
    }
    if (result.success === true) {
        return Object.freeze({ success: true });
    }
    if (result.success !== false || !isBoundedError(result.error)) {
        throw new TypeError('Invalid content-control response');
    }
    return Object.freeze({ success: false, error: result.error });
}

export function parseContentControlResponseMessage(response, expectedRequest) {
    const request = normalizeContentControlRequest(expectedRequest);
    if (!request) return null;

    const success = readExactRecord(response, ['success']);
    if (success?.success === true) {
        return Object.freeze({ action: request.action, success: true });
    }
    const failure = readExactRecord(response, ['success', 'error']);
    return failure?.success === false && isBoundedError(failure.error)
        ? Object.freeze({
              action: request.action,
              success: false,
              error: failure.error,
          })
        : null;
}

function normalizeSidePanelWordIntentOptions(input, exact = false) {
    const source = exact
        ? input
        : isPlainRecord(input)
          ? {
                autoOpen: input.autoOpen,
                pauseVideo: input.pauseVideo,
            }
          : null;
    const snapshot = tryCreatePlainDataSnapshot(
        source,
        SIDEPANEL_WORD_INTENT_LIMITS
    );
    const options = snapshot.accepted
        ? readExactRecord(snapshot.value, ['autoOpen', 'pauseVideo'])
        : null;
    return options &&
        typeof options.autoOpen === 'boolean' &&
        typeof options.pauseVideo === 'boolean'
        ? Object.freeze({
              autoOpen: options.autoOpen,
              pauseVideo: options.pauseVideo,
          })
        : null;
}

export function buildSidePanelWordIntentMessage(input) {
    const options = normalizeSidePanelWordIntentOptions(input);
    if (!options) throw new TypeError('Invalid side-panel word intent');
    return Object.freeze({
        action: MessageActions.SIDEPANEL_WORD_SELECTED,
        options,
    });
}

export function parseSidePanelWordIntentMessage(message) {
    const envelope = readRoute(message, MessageActions.SIDEPANEL_WORD_SELECTED);
    const options = envelope
        ? normalizeSidePanelWordIntentOptions(envelope.options, true)
        : null;
    return options
        ? Object.freeze({
              action: MessageActions.SIDEPANEL_WORD_SELECTED,
              options,
          })
        : null;
}

function isWellFormedSelectionWord(value) {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        String.prototype.isWellFormed.call(value) &&
        utf8ByteLength(value) <= MAX_SELECTION_WORD_BYTES
    );
}

function normalizeSelectionEntries(value, exact = false) {
    const input = readDenseArray(value);
    if (!input || input.length > MAX_SELECTION_ENTRIES) return null;

    const entries = [];
    let previousWordIndex = -1;
    let joinedCodeUnits = 0;
    let joinedBytes = 0;
    for (const [index, entry] of input.entries()) {
        const values = exact
            ? readExactRecord(entry, ['wordIndex', 'word'])
            : isPlainRecord(entry)
              ? entry
              : null;
        if (
            !values ||
            !isNonnegativeSafeInteger(values.wordIndex) ||
            values.wordIndex <= previousWordIndex ||
            !isWellFormedSelectionWord(values.word)
        ) {
            return null;
        }
        if (index > 0) {
            joinedCodeUnits += 1;
            joinedBytes += 1;
        }
        joinedCodeUnits += values.word.length;
        joinedBytes += utf8ByteLength(values.word);
        if (
            joinedCodeUnits > MAX_SELECTION_JOINED_CODE_UNITS ||
            joinedBytes > MAX_SELECTION_JOINED_BYTES
        ) {
            return null;
        }
        entries.push(
            Object.freeze({
                wordIndex: values.wordIndex,
                word: values.word,
            })
        );
        previousWordIndex = values.wordIndex;
    }
    return Object.freeze(entries);
}

function normalizeSelectionSnapshotData(
    input,
    includeLifecycle,
    exact = false
) {
    const source = exact
        ? input
        : isPlainRecord(input)
          ? {
                ...(includeLifecycle
                    ? { lifecycleGeneration: input.lifecycleGeneration }
                    : {}),
                selectionRevision: input.selectionRevision,
                renderRevision: input.renderRevision,
                reason: input.reason,
                entries: input.entries,
            }
          : null;
    const snapshot = tryCreatePlainDataSnapshot(
        source,
        SELECTION_SNAPSHOT_LIMITS
    );
    if (!snapshot.accepted) return null;
    const keys = includeLifecycle
        ? CONTENT_SELECTION_KEYS
        : CONTENT_SELECTION_KEYS.slice(1);
    const values = readExactRecord(snapshot.value, keys);
    if (
        !values ||
        (includeLifecycle &&
            !isPositiveSafeInteger(values.lifecycleGeneration)) ||
        !isPositiveSafeInteger(values.selectionRevision) ||
        !isPositiveSafeInteger(values.renderRevision) ||
        !SELECTION_REASONS.has(values.reason)
    ) {
        return null;
    }
    const entries = normalizeSelectionEntries(values.entries, exact);
    if (!entries) return null;
    if (
        ((values.reason === 'clear' || values.reason === 'subtitle-change') &&
            entries.length !== 0) ||
        ((values.reason === 'add' || values.reason === 'restore') &&
            entries.length === 0)
    ) {
        return null;
    }

    const normalized = {
        selectionRevision: values.selectionRevision,
        renderRevision: values.renderRevision,
        reason: values.reason,
        entries,
    };
    if (includeLifecycle) {
        normalized.lifecycleGeneration = values.lifecycleGeneration;
        return Object.freeze({
            lifecycleGeneration: normalized.lifecycleGeneration,
            selectionRevision: normalized.selectionRevision,
            renderRevision: normalized.renderRevision,
            reason: normalized.reason,
            entries: normalized.entries,
        });
    }
    return Object.freeze(normalized);
}

export function parseContentSelectionSnapshot(snapshot) {
    return normalizeSelectionSnapshotData(snapshot, false);
}

function normalizeSelectionState(selection) {
    if (selection === null) return null;
    const snapshot = tryCreatePlainDataSnapshot(
        selection,
        SELECTION_SNAPSHOT_LIMITS
    );
    const values = snapshot.accepted
        ? readExactRecord(snapshot.value, SELECTION_STATE_KEYS)
        : null;
    if (!values || !isPositiveSafeInteger(values.selectionOwnerGeneration)) {
        return undefined;
    }
    const state = normalizeSelectionSnapshotData(
        {
            selectionRevision: values.selectionRevision,
            renderRevision: values.renderRevision,
            reason: values.reason,
            entries: values.entries,
        },
        false
    );
    return state
        ? Object.freeze({
              selectionOwnerGeneration: values.selectionOwnerGeneration,
              selectionRevision: state.selectionRevision,
              renderRevision: state.renderRevision,
              reason: state.reason,
              entries: state.entries,
          })
        : undefined;
}

export function buildSidePanelContentSelectionSnapshotMessage(input) {
    const data = normalizeSelectionSnapshotData(input, true);
    if (!data) throw new TypeError('Invalid side-panel selection snapshot');
    return Object.freeze({
        action: MessageActions.SIDEPANEL_SELECTION_SYNC,
        data,
    });
}

export function parseSidePanelContentSelectionSnapshotMessage(message) {
    const envelope = readExactRecord(message, ['action', 'data']);
    return envelope?.action === MessageActions.SIDEPANEL_SELECTION_SYNC
        ? normalizeSelectionSnapshotData(envelope.data, true, true)
        : null;
}

export function buildSidePanelContentSelectionSnapshotResponse(status) {
    if (status !== 'accepted' && status !== 'rejected') {
        throw new TypeError('Invalid side-panel selection snapshot status');
    }
    return Object.freeze({ success: status === 'accepted' });
}

export function parseSidePanelContentSelectionSnapshotResponse(response) {
    const values = readExactRecord(response, ['success']);
    return values && typeof values.success === 'boolean'
        ? Object.freeze({
              status: values.success ? 'accepted' : 'rejected',
          })
        : null;
}

function copyBinding(binding) {
    return {
        registrationId: binding.registrationId,
        tabId: binding.tabId,
        windowId: binding.windowId,
    };
}

function parseSidePanelBindingTuple(binding) {
    const values = readExactRecord(binding, BINDING_KEYS);
    return values &&
        isPositiveSafeInteger(values.registrationId) &&
        isNonnegativeSafeInteger(values.tabId) &&
        isNonnegativeSafeInteger(values.windowId)
        ? Object.freeze(copyBinding(values))
        : null;
}

function bindingsEqual(left, right) {
    return Boolean(
        left &&
        right &&
        left.registrationId === right.registrationId &&
        left.tabId === right.tabId &&
        left.windowId === right.windowId
    );
}

export function buildSidePanelSelectionStateMessage(binding, selection) {
    const normalizedBinding = parseSidePanelBindingTuple(binding);
    const normalizedSelection = normalizeSelectionState(selection);
    if (!normalizedBinding || normalizedSelection === undefined) {
        throw new TypeError('Invalid side-panel selection state');
    }
    return Object.freeze({
        action: MessageActions.SIDEPANEL_SELECTION_SYNC,
        data: Object.freeze({
            binding: normalizedBinding,
            selection: normalizedSelection,
        }),
    });
}

export function parseSidePanelSelectionStateMessage(message, expectedBinding) {
    const expected = parseSidePanelBindingTuple(expectedBinding);
    const envelope = readExactRecord(message, ['action', 'data']);
    const data =
        envelope?.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            ? readExactRecord(envelope.data, ['binding', 'selection'])
            : null;
    const binding = data ? parseSidePanelBindingTuple(data.binding) : null;
    const selection = data ? normalizeSelectionState(data.selection) : null;
    return expected &&
        binding &&
        bindingsEqual(binding, expected) &&
        selection !== undefined
        ? Object.freeze({ binding, selection })
        : null;
}

function normalizeRequestId(value) {
    const record = readExactRecord(value, ['requestId']);
    return record && isPositiveSafeInteger(record.requestId)
        ? Object.freeze({ requestId: record.requestId })
        : null;
}

export function buildSidePanelSelectionRepublishRequestMessage(requestId) {
    if (!isPositiveSafeInteger(requestId)) {
        throw new TypeError('Invalid side-panel selection republish request');
    }
    return Object.freeze({
        action: MessageActions.SIDEPANEL_GET_STATE,
        data: Object.freeze({ requestId }),
    });
}

export function parseSidePanelSelectionRepublishRequestMessage(message) {
    const envelope = readExactRecord(message, ['action', 'data']);
    return envelope?.action === MessageActions.SIDEPANEL_GET_STATE
        ? normalizeRequestId(envelope.data)
        : null;
}

export function buildSidePanelSelectionRepublishAck(expectedRequest) {
    if (!normalizeRequestId(expectedRequest)) {
        throw new TypeError('Invalid side-panel selection republish request');
    }
    return Object.freeze({ success: true });
}

export function parseSidePanelSelectionRepublishAck(response, expectedRequest) {
    const request = normalizeRequestId(expectedRequest);
    const acknowledgement = readExactRecord(response, ['success']);
    return request && acknowledgement?.success === true ? request : null;
}

function normalizeSelectionRemovalRequest(value, exact = false) {
    const values = exact
        ? readExactRecord(value, SELECTION_REMOVAL_REQUEST_KEYS)
        : isPlainRecord(value)
          ? value
          : null;
    const binding = values ? parseSidePanelBindingTuple(values.binding) : null;
    return binding &&
        isPositiveSafeInteger(values.requestId) &&
        isPositiveSafeInteger(values.selectionOwnerGeneration) &&
        isPositiveSafeInteger(values.selectionRevision) &&
        isPositiveSafeInteger(values.renderRevision) &&
        isNonnegativeSafeInteger(values.wordIndex)
        ? Object.freeze({
              binding,
              requestId: values.requestId,
              selectionOwnerGeneration: values.selectionOwnerGeneration,
              selectionRevision: values.selectionRevision,
              renderRevision: values.renderRevision,
              wordIndex: values.wordIndex,
          })
        : null;
}

function normalizeSelectionRemovalCommand(value) {
    const values = readExactRecord(value, SELECTION_REMOVAL_COMMAND_KEYS);
    return values &&
        isPositiveSafeInteger(values.requestId) &&
        isPositiveSafeInteger(values.lifecycleGeneration) &&
        isPositiveSafeInteger(values.selectionRevision) &&
        isPositiveSafeInteger(values.renderRevision) &&
        isNonnegativeSafeInteger(values.wordIndex)
        ? Object.freeze({
              requestId: values.requestId,
              lifecycleGeneration: values.lifecycleGeneration,
              selectionRevision: values.selectionRevision,
              renderRevision: values.renderRevision,
              wordIndex: values.wordIndex,
          })
        : null;
}

function isSelectionRemovalStatus(value) {
    return value === 'applied' || value === 'rejected';
}

function normalizeSelectionRemovalResult(value) {
    const values = readExactRecord(value, SELECTION_REMOVAL_RESULT_KEYS);
    const binding = values ? parseSidePanelBindingTuple(values.binding) : null;
    return binding &&
        isPositiveSafeInteger(values.requestId) &&
        isPositiveSafeInteger(values.selectionOwnerGeneration) &&
        isSelectionRemovalStatus(values.status)
        ? Object.freeze({
              binding,
              requestId: values.requestId,
              selectionOwnerGeneration: values.selectionOwnerGeneration,
              status: values.status,
          })
        : null;
}

export function buildSidePanelSelectionRemovalRequestMessage(input) {
    const data = normalizeSelectionRemovalRequest(input);
    if (!data) {
        throw new TypeError('Invalid side-panel selection removal request');
    }
    return Object.freeze({
        action: MessageActions.SIDEPANEL_UPDATE_STATE,
        data,
    });
}

export function parseSidePanelSelectionRemovalRequestMessage(message) {
    const envelope = readExactRecord(message, ['action', 'data']);
    return envelope?.action === MessageActions.SIDEPANEL_UPDATE_STATE
        ? normalizeSelectionRemovalRequest(envelope.data, true)
        : null;
}

export function buildSidePanelSelectionRemovalCommandMessage(
    removalRequest,
    lifecycleGeneration
) {
    const removal = normalizeSelectionRemovalRequest(removalRequest);
    if (!removal || !isPositiveSafeInteger(lifecycleGeneration)) {
        throw new TypeError('Invalid side-panel selection removal command');
    }
    return Object.freeze({
        action: MessageActions.SIDEPANEL_UPDATE_STATE,
        data: Object.freeze({
            requestId: removal.requestId,
            lifecycleGeneration,
            selectionRevision: removal.selectionRevision,
            renderRevision: removal.renderRevision,
            wordIndex: removal.wordIndex,
        }),
    });
}

export function parseSidePanelSelectionRemovalCommandMessage(message) {
    const envelope = readExactRecord(message, ['action', 'data']);
    return envelope?.action === MessageActions.SIDEPANEL_UPDATE_STATE
        ? normalizeSelectionRemovalCommand(envelope.data)
        : null;
}

export function buildSidePanelSelectionRemovalCommandResponse(
    expectedCommand,
    status
) {
    if (
        !normalizeSelectionRemovalCommand(expectedCommand) ||
        !isSelectionRemovalStatus(status)
    ) {
        throw new TypeError(
            'Invalid side-panel selection removal command response'
        );
    }
    return Object.freeze({ success: status === 'applied' });
}

export function parseSidePanelSelectionRemovalCommandResponse(
    response,
    expectedCommand
) {
    const command = normalizeSelectionRemovalCommand(expectedCommand);
    const values = readExactRecord(response, ['success']);
    return command && values && typeof values.success === 'boolean'
        ? Object.freeze({
              requestId: command.requestId,
              status: values.success ? 'applied' : 'rejected',
          })
        : null;
}

export function buildSidePanelSelectionRemovalResultMessage(
    expectedRemovalRequest,
    status
) {
    const removal = normalizeSelectionRemovalRequest(expectedRemovalRequest);
    if (!removal || !isSelectionRemovalStatus(status)) {
        throw new TypeError('Invalid side-panel selection removal result');
    }
    return Object.freeze({
        action: MessageActions.SIDEPANEL_UPDATE_STATE,
        data: Object.freeze({
            binding: removal.binding,
            requestId: removal.requestId,
            selectionOwnerGeneration: removal.selectionOwnerGeneration,
            status,
        }),
    });
}

export function parseSidePanelSelectionRemovalResultMessage(
    message,
    expectedRemovalRequest
) {
    const removal = normalizeSelectionRemovalRequest(expectedRemovalRequest);
    const envelope = readExactRecord(message, ['action', 'data']);
    const result =
        envelope?.action === MessageActions.SIDEPANEL_UPDATE_STATE
            ? normalizeSelectionRemovalResult(envelope.data)
            : null;
    return removal &&
        result &&
        bindingsEqual(result.binding, removal.binding) &&
        result.requestId === removal.requestId &&
        result.selectionOwnerGeneration === removal.selectionOwnerGeneration
        ? result
        : null;
}

function normalizeTabBinding(input, exact = false) {
    const values = exact
        ? readExactRecord(input, ['tabId', 'windowId'])
        : isPlainRecord(input)
          ? input
          : null;
    return values &&
        isNonnegativeSafeInteger(values.tabId) &&
        isNonnegativeSafeInteger(values.windowId)
        ? Object.freeze({ tabId: values.tabId, windowId: values.windowId })
        : null;
}

function buildTabBindingMessage(action, input) {
    const binding = normalizeTabBinding(input);
    if (!binding) throw new TypeError('Invalid side-panel tab binding');
    return Object.freeze({
        action,
        data: Object.freeze({
            tabId: binding.tabId,
            windowId: binding.windowId,
        }),
    });
}

function parseTabBindingMessage(message, expectedAction) {
    const envelope = readExactRecord(message, ['action', 'data']);
    return envelope?.action === expectedAction
        ? normalizeTabBinding(envelope.data, true)
        : null;
}

export function buildSidePanelTabActivatedMessage(input) {
    return buildTabBindingMessage(
        MessageActions.SIDEPANEL_TAB_ACTIVATED,
        input
    );
}

export function parseSidePanelTabActivatedMessage(message) {
    return parseTabBindingMessage(
        message,
        MessageActions.SIDEPANEL_TAB_ACTIVATED
    );
}

export function buildSidePanelForceBindTabMessage(input) {
    return buildTabBindingMessage(
        MessageActions.SIDEPANEL_FORCE_BIND_TAB,
        input
    );
}

export function parseSidePanelForceBindTabMessage(message) {
    return parseTabBindingMessage(
        message,
        MessageActions.SIDEPANEL_FORCE_BIND_TAB
    );
}

export function buildSidePanelRegistrationMessage(binding, timestamp) {
    const normalizedBinding = parseSidePanelBindingTuple(binding);
    if (!normalizedBinding || !isNonnegativeSafeInteger(timestamp)) {
        throw new TypeError('Invalid side-panel registration');
    }
    return Object.freeze({
        action: MessageActions.SIDEPANEL_REGISTER,
        data: Object.freeze(copyBinding(normalizedBinding)),
        source: 'sidepanel',
        timestamp,
    });
}

export function parseSidePanelRegistrationMessage(message) {
    const envelope = readExactRecord(message, [
        'action',
        'data',
        'source',
        'timestamp',
    ]);
    if (
        envelope?.action !== MessageActions.SIDEPANEL_REGISTER ||
        envelope.source !== 'sidepanel' ||
        !isNonnegativeSafeInteger(envelope.timestamp)
    ) {
        return null;
    }
    return parseSidePanelBindingTuple(envelope.data);
}

export function buildSidePanelBindingConfirmationMessage(binding) {
    const normalizedBinding = parseSidePanelBindingTuple(binding);
    if (!normalizedBinding) {
        throw new TypeError('Invalid side-panel binding confirmation');
    }
    return Object.freeze({
        action: MessageActions.SIDEPANEL_BINDING_CONFIRMED,
        data: Object.freeze(copyBinding(normalizedBinding)),
    });
}

export function parseSidePanelBindingConfirmationMessage(message) {
    const envelope = readExactRecord(message, ['action', 'data']);
    return envelope?.action === MessageActions.SIDEPANEL_BINDING_CONFIRMED
        ? parseSidePanelBindingTuple(envelope.data)
        : null;
}
