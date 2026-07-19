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
const MESSAGE_ACTION_CATALOG = new Set(Object.values(MessageActions));
const MAX_PROTOCOL_ENVELOPE_KEYS = 32;

const REGISTRATION_MESSAGE_KEYS = Object.freeze([
    'action',
    'data',
    'source',
    'timestamp',
]);
const BINDING_CONFIRMATION_MESSAGE_KEYS = Object.freeze(['action', 'data']);
const BINDING_KEYS = Object.freeze(['registrationId', 'tabId', 'windowId']);
const SIDEPANEL_MESSAGE_KEYS = Object.freeze(['action', 'data']);
const SIDEPANEL_TAB_BINDING_KEYS = Object.freeze(['tabId', 'windowId']);
const CONTENT_SELECTION_SNAPSHOT_KEYS = Object.freeze([
    'lifecycleGeneration',
    'selectionRevision',
    'renderRevision',
    'reason',
    'entries',
]);
const SELECTION_SNAPSHOT_RESPONSE_KEYS = Object.freeze(['success']);
const SIDEPANEL_WORD_INTENT_MESSAGE_KEYS = Object.freeze(['action', 'options']);
const SIDEPANEL_WORD_INTENT_OPTIONS_KEYS = Object.freeze([
    'autoOpen',
    'pauseVideo',
]);
const SIDEPANEL_WORD_INTENT_LIMITS = Object.freeze({
    maxDepth: 2,
    maxEntries: 8,
    maxStringBytes: 64,
    maxTotalBytes: 256,
});
const SELECTION_STATE_DATA_KEYS = Object.freeze(['binding', 'selection']);
const SELECTION_STATE_KEYS = Object.freeze([
    'selectionOwnerGeneration',
    'selectionRevision',
    'renderRevision',
    'reason',
    'entries',
]);
const REQUEST_ID_KEYS = Object.freeze(['requestId']);
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
const SELECTION_REMOVAL_COMMAND_RESPONSE_KEYS = Object.freeze([
    'success',
    'requestId',
]);
const SELECTION_REMOVAL_RESULT_KEYS = Object.freeze([
    'binding',
    'requestId',
    'selectionOwnerGeneration',
    'status',
]);
const SELECTION_ENTRY_KEYS = Object.freeze(['wordIndex', 'word']);
const SELECTION_REASONS = Object.freeze([
    'toggle',
    'add',
    'remove',
    'clear',
    'restore',
    'subtitle-change',
]);
const SELECTION_SNAPSHOT_LIMITS = Object.freeze({
    maxDepth: 4,
    maxEntries: 256,
    maxStringBytes: 4096,
    maxTotalBytes: 6144,
});
const MAX_SELECTION_ENTRIES = 64;
const MAX_SELECTION_WORD_BYTES = 256;
const MAX_SELECTION_JOINED_CODE_UNITS = 500;
const MAX_SELECTION_JOINED_BYTES = 4096;
const TRANSLATION_REQUEST_KEYS = Object.freeze([
    'action',
    'text',
    'targetLang',
    'cueStart',
    'cueVideoId',
]);
const TRANSLATION_REQUEST_INPUT_KEYS = Object.freeze([
    'text',
    'targetLang',
    'cueStart',
    'cueVideoId',
]);
const TRANSLATION_SUCCESS_INPUT_KEYS = Object.freeze([
    'translatedText',
    'cached',
    'processingTime',
]);
const TRANSLATION_FAILURE_INPUT_KEYS = Object.freeze([
    'retryable',
    'retryAfter',
]);
const MAX_TRANSLATION_RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSLATION_SUCCESS_RESPONSE_KEYS = Object.freeze([
    'translatedText',
    'originalText',
    'sourceLanguage',
    'targetLanguage',
    'cached',
    'processingTime',
    'cueStart',
    'cueVideoId',
]);
const TRANSLATION_FAILURE_RESPONSE_KEYS = Object.freeze([
    'error',
    'errorType',
    'retryable',
    'retryAfter',
    'cueStart',
    'cueVideoId',
]);
const ANALYZE_CONTENT_REQUEST_KEYS = Object.freeze([
    'action',
    'text',
    'contextTypes',
    'language',
    'targetLanguage',
    'platform',
    'requestId',
]);
const ANALYZE_CONTENT_REQUEST_INPUT_KEYS = Object.freeze([
    'text',
    'contextTypes',
    'language',
    'targetLanguage',
    'platform',
    'requestId',
]);
const ANALYZE_SIDEPANEL_REQUEST_KEYS = Object.freeze([
    'action',
    'text',
    'contextTypes',
    'targetLanguage',
    'requestId',
]);
const ANALYZE_SIDEPANEL_SINGLE_REQUEST_KEYS = Object.freeze([
    ...ANALYZE_SIDEPANEL_REQUEST_KEYS,
    'contextType',
]);
const ANALYZE_SIDEPANEL_REQUEST_INPUT_KEYS = Object.freeze([
    'text',
    'contextTypes',
    'targetLanguage',
    'requestId',
]);
const ANALYZE_SUCCESS_INPUT_KEYS = Object.freeze(['analysis']);
const ANALYZE_FAILURE_INPUT_KEYS = Object.freeze(['error', 'shouldRetry']);
const ANALYZE_SUCCESS_RESPONSE_KEYS = Object.freeze([
    'success',
    'result',
    'requestId',
]);
const ANALYZE_SUCCESS_RESULT_KEYS = Object.freeze([
    'analysis',
    'contextType',
    'contextTypes',
    'isStructured',
]);
const ANALYZE_FAILURE_RESPONSE_KEYS = Object.freeze([
    'success',
    'error',
    'shouldRetry',
    'requestId',
]);
const ANALYZE_SNAPSHOT_LIMITS = Object.freeze({
    maxDepth: 8,
    maxEntries: 256,
    maxStringBytes: 65536,
    maxTotalBytes: 65536,
});
const CONFIG_CHANGED_MESSAGE_KEYS = Object.freeze(['action', 'changes']);
const LOGGING_LEVEL_CHANGED_MESSAGE_KEYS = Object.freeze(['action', 'level']);
const SIDEPANEL_PAUSE_VIDEO_MESSAGE_KEYS = Object.freeze(['action']);
const CONTENT_CONTROL_SUCCESS_RESULT_KEYS = Object.freeze(['success']);
const CONTENT_CONTROL_FAILURE_RESULT_KEYS = Object.freeze(['success', 'error']);
const CONTENT_CONTROL_SUCCESS_RESPONSE_KEYS = Object.freeze([
    'action',
    'success',
]);
const CONTENT_CONTROL_FAILURE_RESPONSE_KEYS = Object.freeze([
    'action',
    'success',
    'error',
]);
const BACKGROUND_READINESS_REQUEST_KEYS = Object.freeze(['action']);
const BACKGROUND_READINESS_RESULT_KEYS = Object.freeze(['ready', 'services']);
const BACKGROUND_READINESS_RESPONSE_KEYS = Object.freeze([
    'action',
    'ready',
    'services',
]);
const BACKGROUND_SERVICE_STATE_KEYS = Object.freeze([
    'translation',
    'subtitle',
    'aiContext',
    'aiContextInitialized',
]);
const CONFIG_CHANGED_LIMITS = Object.freeze({
    maxDepth: 6,
    maxEntries: 64,
    maxStringBytes: 4096,
    maxTotalBytes: 16384,
});
const MAX_CONFIG_CHANGED_KEYS = 32;

function isNonBlankString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isNonBlankTrimmedString(value) {
    return isNonBlankString(value) && value === value.trim();
}

function isValidTranslationRequestValues(values) {
    return (
        values.action === MessageActions.TRANSLATE &&
        isNonBlankString(values.text) &&
        isNonBlankTrimmedString(values.targetLang) &&
        Number.isFinite(values.cueStart) &&
        values.cueStart >= 0 &&
        isNonBlankTrimmedString(values.cueVideoId)
    );
}

function isValidTranslationSuccessResultValues(values) {
    return (
        isNonBlankString(values.translatedText) &&
        typeof values.cached === 'boolean' &&
        Number.isSafeInteger(values.processingTime) &&
        values.processingTime >= 0
    );
}

function isValidTranslationSuccessValues(values, request) {
    return (
        isValidTranslationSuccessResultValues(values) &&
        values.originalText === request.text &&
        values.sourceLanguage === 'auto' &&
        values.targetLanguage === request.targetLang &&
        Object.is(values.cueStart, request.cueStart) &&
        values.cueVideoId === request.cueVideoId
    );
}

function isValidTranslationRetryAfter(value) {
    return (
        value === null ||
        (Number.isSafeInteger(value) &&
            value >= 0 &&
            value <= MAX_TRANSLATION_RETRY_AFTER_MS)
    );
}

function isValidTranslationFailureResultValues(values) {
    return (
        typeof values.retryable === 'boolean' &&
        isValidTranslationRetryAfter(values.retryAfter)
    );
}

function isValidTranslationFailureValues(values, request) {
    return (
        values.error === 'Translation failed' &&
        values.errorType === 'TranslationError' &&
        isValidTranslationFailureResultValues(values) &&
        Object.is(values.cueStart, request.cueStart) &&
        values.cueVideoId === request.cueVideoId
    );
}

function copyTranslationRequest(values) {
    return {
        action: MessageActions.TRANSLATE,
        text: values.text,
        targetLang: values.targetLang,
        cueStart: values.cueStart,
        cueVideoId: values.cueVideoId,
    };
}

function copyTranslationSuccessResponse(request, values) {
    return {
        translatedText: values.translatedText,
        originalText: request.text,
        sourceLanguage: 'auto',
        targetLanguage: request.targetLang,
        cached: values.cached,
        processingTime: values.processingTime,
        cueStart: request.cueStart,
        cueVideoId: request.cueVideoId,
    };
}

function copyTranslationFailureResponse(request, values) {
    return {
        error: 'Translation failed',
        errorType: 'TranslationError',
        retryable: values.retryable,
        retryAfter: values.retryAfter,
        cueStart: request.cueStart,
        cueVideoId: request.cueVideoId,
    };
}

export function buildTranslationRequestMessage(input) {
    const values = readExactOwnDataRecord(
        input,
        TRANSLATION_REQUEST_INPUT_KEYS
    );
    const request = values && copyTranslationRequest(values);
    if (!request || !isValidTranslationRequestValues(request)) {
        throw new TypeError('Invalid translation request');
    }
    return Object.freeze(request);
}

export function parseTranslationRequestMessage(message) {
    const values = readExactOwnDataRecord(message, TRANSLATION_REQUEST_KEYS);
    if (!values || !isValidTranslationRequestValues(values)) return null;

    return Object.freeze(copyTranslationRequest(values));
}

export function buildTranslationSuccessResponse(expectedRequest, result) {
    const request = parseTranslationRequestMessage(expectedRequest);
    if (!request) throw new TypeError('Invalid expected translation request');
    const values = readExactOwnDataRecord(
        result,
        TRANSLATION_SUCCESS_INPUT_KEYS
    );
    if (!values || !isValidTranslationSuccessResultValues(values)) {
        throw new TypeError('Invalid translation success result');
    }

    return Object.freeze(copyTranslationSuccessResponse(request, values));
}

export function buildTranslationFailureResponse(expectedRequest, failure) {
    const request = parseTranslationRequestMessage(expectedRequest);
    if (!request) throw new TypeError('Invalid expected translation request');
    const values = readExactOwnDataRecord(
        failure,
        TRANSLATION_FAILURE_INPUT_KEYS
    );
    if (!values || !isValidTranslationFailureResultValues(values)) {
        throw new TypeError('Invalid translation failure result');
    }

    return Object.freeze(copyTranslationFailureResponse(request, values));
}

export function parseTranslationResponseMessage(message, expectedRequest) {
    const request = parseTranslationRequestMessage(expectedRequest);
    if (!request) return null;
    const successValues = readExactOwnDataRecord(
        message,
        TRANSLATION_SUCCESS_RESPONSE_KEYS
    );
    if (
        successValues &&
        isValidTranslationSuccessValues(successValues, request)
    ) {
        return Object.freeze({
            status: 'success',
            ...copyTranslationSuccessResponse(request, successValues),
        });
    }

    const failureValues = readExactOwnDataRecord(
        message,
        TRANSLATION_FAILURE_RESPONSE_KEYS
    );
    if (
        !failureValues ||
        !isValidTranslationFailureValues(failureValues, request)
    ) {
        return null;
    }

    return Object.freeze({
        status: 'failure',
        ...copyTranslationFailureResponse(request, failureValues),
    });
}

function readDensePlainArray(value) {
    try {
        if (
            !Array.isArray(value) ||
            Object.getPrototypeOf(value) !== Array.prototype
        ) {
            return null;
        }

        const lengthDescriptor = Object.getOwnPropertyDescriptor(
            value,
            'length'
        );
        if (
            !lengthDescriptor ||
            !Object.hasOwn(lengthDescriptor, 'value') ||
            !Number.isSafeInteger(lengthDescriptor.value) ||
            lengthDescriptor.value < 0
        ) {
            return null;
        }

        const length = lengthDescriptor.value;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== length + 1 || !keys.includes('length')) return null;

        for (const key of keys) {
            if (key === 'length') continue;
            if (typeof key !== 'string') return null;
            const index = Number(key);
            if (
                !Number.isSafeInteger(index) ||
                index < 0 ||
                index >= length ||
                String(index) !== key
            ) {
                return null;
            }
        }

        const values = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(
                value,
                String(index)
            );
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
            values.push(descriptor.value);
        }
        return values;
    } catch (_) {
        return null;
    }
}

function normalizeAnalyzeContextTypesForBuilder(value) {
    const inputTypes = readDensePlainArray(value);
    if (!inputTypes) return null;

    const normalizedTypes = [];
    for (const type of inputTypes) {
        if (CONTEXT_TYPES.includes(type) && !normalizedTypes.includes(type)) {
            normalizedTypes.push(type);
        }
    }
    if (normalizedTypes.length < 1 || normalizedTypes.length > 3) return null;
    return normalizedTypes;
}

function parseCanonicalAnalyzeContextTypes(value) {
    const contextTypes = readDensePlainArray(value);
    if (!contextTypes || contextTypes.length < 1 || contextTypes.length > 3) {
        return null;
    }

    const seen = new Set();
    for (const type of contextTypes) {
        if (!CONTEXT_TYPES.includes(type) || seen.has(type)) return null;
        seen.add(type);
    }
    return contextTypes;
}

function isValidAnalyzeContentValues(values) {
    return (
        isNonBlankString(values.text) &&
        isNonBlankString(values.language) &&
        isNonBlankString(values.targetLanguage) &&
        isNonBlankString(values.platform) &&
        isNonBlankString(values.requestId)
    );
}

function isValidAnalyzeSidePanelValues(values) {
    return (
        isNonBlankString(values.text) &&
        isNonBlankString(values.targetLanguage) &&
        isNonBlankString(values.requestId)
    );
}

function copyAnalyzeContentRequest(values, contextTypes) {
    return {
        action: MessageActions.ANALYZE_CONTEXT,
        text: values.text,
        contextTypes: Object.freeze([...contextTypes]),
        language: values.language,
        targetLanguage: values.targetLanguage,
        platform: values.platform,
        requestId: values.requestId,
    };
}

function copyAnalyzeSidePanelRequest(values, contextTypes) {
    const request = {
        action: MessageActions.ANALYZE_CONTEXT,
        text: values.text,
        contextTypes: Object.freeze([...contextTypes]),
        targetLanguage: values.targetLanguage,
        requestId: values.requestId,
    };
    if (contextTypes.length === 1) request.contextType = contextTypes[0];
    return request;
}

export function buildAnalyzeContextRequestMessage(senderRole, input) {
    let values;
    if (senderRole === MessageSenderRoles.CONTENT) {
        values = readExactOwnDataRecord(
            input,
            ANALYZE_CONTENT_REQUEST_INPUT_KEYS
        );
        const contextTypes =
            values &&
            isValidAnalyzeContentValues(values) &&
            normalizeAnalyzeContextTypesForBuilder(values.contextTypes);
        if (!contextTypes) {
            throw new TypeError('Invalid content analyze-context request');
        }
        return Object.freeze(copyAnalyzeContentRequest(values, contextTypes));
    }

    if (senderRole === MessageSenderRoles.SIDEPANEL) {
        values = readExactOwnDataRecord(
            input,
            ANALYZE_SIDEPANEL_REQUEST_INPUT_KEYS
        );
        const contextTypes =
            values &&
            isValidAnalyzeSidePanelValues(values) &&
            normalizeAnalyzeContextTypesForBuilder(values.contextTypes);
        if (!contextTypes) {
            throw new TypeError('Invalid side-panel analyze-context request');
        }
        return Object.freeze(copyAnalyzeSidePanelRequest(values, contextTypes));
    }

    throw new TypeError('Invalid analyze-context sender role');
}

export function parseAnalyzeContextRequestMessage(message, senderRole) {
    if (senderRole === MessageSenderRoles.CONTENT) {
        const values = readExactOwnDataRecord(
            message,
            ANALYZE_CONTENT_REQUEST_KEYS
        );
        const contextTypes =
            values &&
            values.action === MessageActions.ANALYZE_CONTEXT &&
            isValidAnalyzeContentValues(values) &&
            parseCanonicalAnalyzeContextTypes(values.contextTypes);
        if (!contextTypes) return null;
        return Object.freeze(copyAnalyzeContentRequest(values, contextTypes));
    }

    if (senderRole !== MessageSenderRoles.SIDEPANEL) return null;

    let hasContextType = true;
    let values = readExactOwnDataRecord(
        message,
        ANALYZE_SIDEPANEL_SINGLE_REQUEST_KEYS
    );
    if (!values) {
        hasContextType = false;
        values = readExactOwnDataRecord(
            message,
            ANALYZE_SIDEPANEL_REQUEST_KEYS
        );
    }
    const contextTypes =
        values &&
        values.action === MessageActions.ANALYZE_CONTEXT &&
        isValidAnalyzeSidePanelValues(values) &&
        parseCanonicalAnalyzeContextTypes(values.contextTypes);
    if (
        !contextTypes ||
        hasContextType !== (contextTypes.length === 1) ||
        (hasContextType && values.contextType !== contextTypes[0])
    ) {
        return null;
    }
    return Object.freeze(copyAnalyzeSidePanelRequest(values, contextTypes));
}

function deriveAnalyzeContextType(contextTypes) {
    if (contextTypes.length === 1) return contextTypes[0];
    if (
        contextTypes.length === CONTEXT_TYPES.length &&
        CONTEXT_TYPES.every((type) => contextTypes.includes(type))
    ) {
        return 'all';
    }
    return 'combined';
}

function isPlainRecord(value) {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    } catch (_) {
        return false;
    }
}

function snapshotAnalyzeResult(value) {
    if (!isPlainRecord(value)) {
        throw new TypeError('Invalid analyze-context analysis');
    }
    return createPlainDataSnapshot(value, ANALYZE_SNAPSHOT_LIMITS).value;
}

function isValidAnalyzeFailureValues(values) {
    if (
        !values ||
        typeof values.error !== 'string' ||
        values.error.length === 0 ||
        values.error !== values.error.trim() ||
        !String.prototype.isWellFormed.call(values.error) ||
        utf8ByteLength(values.error) > 512 ||
        typeof values.shouldRetry !== 'boolean'
    ) {
        return false;
    }
    return true;
}

function copyAnalyzeSuccessResult(request, analysis) {
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
    const request = parseAnalyzeContextRequestMessage(
        expectedRequest,
        senderRole
    );
    const values = readExactOwnDataRecord(
        result,
        ANALYZE_SUCCESS_INPUT_KEYS,
        true
    );
    if (!request || !values) {
        throw new TypeError('Invalid analyze-context success response');
    }

    let analysis;
    try {
        analysis = snapshotAnalyzeResult(values.analysis);
    } catch (_) {
        throw new TypeError('Invalid analyze-context success response');
    }
    return Object.freeze({
        success: true,
        result: copyAnalyzeSuccessResult(request, analysis),
        requestId: request.requestId,
    });
}

export function buildAnalyzeContextFailureResponse(
    senderRole,
    expectedRequest,
    failure
) {
    const request = parseAnalyzeContextRequestMessage(
        expectedRequest,
        senderRole
    );
    const values = readExactOwnDataRecord(
        failure,
        ANALYZE_FAILURE_INPUT_KEYS,
        true
    );
    if (!request || !isValidAnalyzeFailureValues(values)) {
        throw new TypeError('Invalid analyze-context failure response');
    }

    return Object.freeze({
        success: false,
        error: values.error,
        shouldRetry: values.shouldRetry,
        requestId: request.requestId,
    });
}

function contextTypesMatchExpected(value, expectedTypes) {
    const parsedTypes = parseCanonicalAnalyzeContextTypes(value);
    return (
        parsedTypes &&
        parsedTypes.length === expectedTypes.length &&
        parsedTypes.every((type, index) => type === expectedTypes[index])
    );
}

export function parseAnalyzeContextResponseMessage(
    message,
    expectedRequest,
    senderRole
) {
    const request = parseAnalyzeContextRequestMessage(
        expectedRequest,
        senderRole
    );
    if (!request) return null;

    try {
        const success = readExactOwnDataRecord(
            message,
            ANALYZE_SUCCESS_RESPONSE_KEYS,
            true
        );
        if (
            success &&
            success.success === true &&
            success.requestId === request.requestId
        ) {
            const result = readExactOwnDataRecord(
                success.result,
                ANALYZE_SUCCESS_RESULT_KEYS,
                true
            );
            if (
                result &&
                result.contextType ===
                    deriveAnalyzeContextType(request.contextTypes) &&
                contextTypesMatchExpected(
                    result.contextTypes,
                    request.contextTypes
                ) &&
                result.isStructured === true
            ) {
                const analysis = snapshotAnalyzeResult(result.analysis);
                return Object.freeze({
                    status: 'success',
                    requestId: request.requestId,
                    result: copyAnalyzeSuccessResult(request, analysis),
                });
            }
        }

        const failure = readExactOwnDataRecord(
            message,
            ANALYZE_FAILURE_RESPONSE_KEYS,
            true
        );
        if (
            !failure ||
            failure.success !== false ||
            failure.requestId !== request.requestId ||
            !isValidAnalyzeFailureValues(failure)
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
    const backgroundUrl = runtime.getURL(paths.background);
    const optionsUrl = runtime.getURL(paths.options);
    const popupUrl = runtime.getURL(paths.popup);
    const sidepanelUrl = runtime.getURL(paths.sidepanel);
    if (
        typeof extensionRoot !== 'string' ||
        typeof backgroundUrl !== 'string' ||
        typeof optionsUrl !== 'string' ||
        typeof popupUrl !== 'string' ||
        typeof sidepanelUrl !== 'string'
    ) {
        return null;
    }

    return {
        backgroundUrl,
        extensionId: runtime.id,
        extensionOrigin: extensionRoot.replace(/\/+$/u, ''),
        optionsUrl,
        popupUrl,
        sidepanelUrl,
    };
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

    let platform = null;
    if (
        parsedUrl.hostname === 'netflix.com' ||
        parsedUrl.hostname.endsWith('.netflix.com')
    ) {
        platform = 'netflix';
    } else if (
        parsedUrl.hostname === 'disneyplus.com' ||
        parsedUrl.hostname.endsWith('.disneyplus.com')
    ) {
        platform = 'disneyplus';
    }

    if (!platform) return null;
    return {
        href: parsedUrl.href,
        origin: parsedUrl.origin,
        platform,
    };
}

export function classifyExtensionMessageSender(
    sender,
    runtime = globalThis.chrome?.runtime
) {
    try {
        const endpoints = readRuntimeEndpoints(runtime);
        if (!endpoints) return null;

        // JavaScript cannot distinguish a fully transparent Proxy from its
        // target. Read only known data descriptors and return a detached,
        // frozen primitive snapshot; revoked or throwing traps fail closed.
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

        let role = null;
        if (url === endpoints.backgroundUrl) {
            role = MessageSenderRoles.BACKGROUND;
        } else if (url === endpoints.sidepanelUrl) {
            role = MessageSenderRoles.SIDEPANEL;
        } else if (url === endpoints.popupUrl) {
            role = MessageSenderRoles.POPUP;
        } else if (url === endpoints.optionsUrl) {
            role = MessageSenderRoles.OPTIONS;
        }

        if (role === MessageSenderRoles.OPTIONS) {
            if (
                origin !== ABSENT_OWN_PROPERTY &&
                origin !== null &&
                origin !== endpoints.extensionOrigin
            ) {
                return null;
            }
            if (tab !== ABSENT_OWN_PROPERTY && tab !== null) {
                const tabUrl = readOwnDataValue(tab, 'url');
                if (tabUrl !== endpoints.optionsUrl) return null;
            }
        } else if (role) {
            if (
                (origin !== ABSENT_OWN_PROPERTY &&
                    origin !== null &&
                    origin !== endpoints.extensionOrigin) ||
                (tab !== ABSENT_OWN_PROPERTY && tab !== null)
            ) {
                return null;
            }
        }

        if (role) return Object.freeze({ role });

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
            typeof documentId !== 'string' ||
            documentId.length === 0 ||
            documentLifecycle !== 'active' ||
            frameId !== 0 ||
            !Number.isSafeInteger(tabId) ||
            tabId < 0 ||
            !Number.isSafeInteger(windowId) ||
            windowId < 0 ||
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

function readExactOwnDataRecord(
    record,
    expectedKeys,
    requireEnumerable = false
) {
    if (!record || typeof record !== 'object') return null;

    try {
        // A faithful transparent Proxy cannot be distinguished from its
        // target through these reflective operations. Callers only copy
        // validated primitives into new frozen records and retain no input.
        const prototype = Object.getPrototypeOf(record);
        if (prototype !== Object.prototype && prototype !== null) return null;

        const keys = Reflect.ownKeys(record);
        if (
            keys.length !== expectedKeys.length ||
            !keys.every(
                (key) => typeof key === 'string' && expectedKeys.includes(key)
            )
        ) {
            return null;
        }

        const values = Object.create(null);
        for (const key of expectedKeys) {
            const descriptor = Object.getOwnPropertyDescriptor(record, key);
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                (requireEnumerable && descriptor.enumerable !== true)
            ) {
                return null;
            }
            values[key] = descriptor.value;
        }
        return values;
    } catch (_) {
        return null;
    }
}

export function readProtocolMessageAction(message) {
    try {
        if (!isPlainRecord(message)) return null;
        const keys = Reflect.ownKeys(message);
        if (
            keys.length < 1 ||
            keys.length > MAX_PROTOCOL_ENVELOPE_KEYS ||
            keys.some((key) => typeof key !== 'string')
        ) {
            return null;
        }
        const action = readOwnDataValue(message, 'action', true, true);
        return typeof action === 'string' && MESSAGE_ACTION_CATALOG.has(action)
            ? action
            : null;
    } catch (_) {
        return null;
    }
}

function normalizeConfigChanges(input) {
    const snapshot = tryCreatePlainDataSnapshot(input, CONFIG_CHANGED_LIMITS);
    if (!snapshot.accepted || !isPlainRecord(snapshot.value)) return null;

    try {
        const keys = Reflect.ownKeys(snapshot.value);
        if (
            keys.length < 1 ||
            keys.length > MAX_CONFIG_CHANGED_KEYS ||
            keys.some((key) => typeof key !== 'string')
        ) {
            return null;
        }

        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(
                snapshot.value,
                key
            );
            if (
                !descriptor ||
                !Object.hasOwn(descriptor, 'value') ||
                descriptor.enumerable !== true
            ) {
                return null;
            }
        }
        return snapshot.value;
    } catch (_) {
        return null;
    }
}

function copyConfigChangedRequest(changes) {
    return Object.freeze({
        action: MessageActions.CONFIG_CHANGED,
        changes,
    });
}

export function buildConfigChangedRequestMessage(changes) {
    const normalizedChanges = normalizeConfigChanges(changes);
    if (!normalizedChanges) {
        throw new TypeError('Invalid config-change request');
    }
    return copyConfigChangedRequest(normalizedChanges);
}

export function parseConfigChangedRequestMessage(message, senderRole) {
    if (senderRole !== MessageSenderRoles.POPUP) return null;

    const values = readExactOwnDataRecord(
        message,
        CONFIG_CHANGED_MESSAGE_KEYS,
        true
    );
    const changes =
        values?.action === MessageActions.CONFIG_CHANGED
            ? normalizeConfigChanges(values.changes)
            : null;
    return changes ? copyConfigChangedRequest(changes) : null;
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
    if (senderRole !== MessageSenderRoles.BACKGROUND) return null;
    const values = readExactOwnDataRecord(
        message,
        LOGGING_LEVEL_CHANGED_MESSAGE_KEYS,
        true
    );
    if (
        values?.action !== MessageActions.LOGGING_LEVEL_CHANGED ||
        !Number.isSafeInteger(values.level) ||
        values.level < 0 ||
        values.level > 4
    ) {
        return null;
    }
    return Object.freeze({
        action: MessageActions.LOGGING_LEVEL_CHANGED,
        level: values.level,
    });
}

export function buildSidePanelPauseVideoRequestMessage() {
    return Object.freeze({
        action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
    });
}

export function parseSidePanelPauseVideoRequestMessage(message, senderRole) {
    if (senderRole !== MessageSenderRoles.BACKGROUND) return null;
    const values = readExactOwnDataRecord(
        message,
        SIDEPANEL_PAUSE_VIDEO_MESSAGE_KEYS,
        true
    );
    if (values?.action !== MessageActions.SIDEPANEL_PAUSE_VIDEO) return null;
    return buildSidePanelPauseVideoRequestMessage();
}

function normalizeContentControlRequest(expectedRequest) {
    const snapshot = tryCreatePlainDataSnapshot(
        expectedRequest,
        CONFIG_CHANGED_LIMITS
    );
    if (!snapshot.accepted) return null;

    const action = readOwnDataValue(snapshot.value, 'action', true, true);
    switch (action) {
        case MessageActions.CONFIG_CHANGED:
            return parseConfigChangedRequestMessage(
                snapshot.value,
                MessageSenderRoles.POPUP
            );
        case MessageActions.LOGGING_LEVEL_CHANGED:
            return parseLoggingLevelChangedRequestMessage(
                snapshot.value,
                MessageSenderRoles.BACKGROUND
            );
        case MessageActions.SIDEPANEL_PAUSE_VIDEO:
            return parseSidePanelPauseVideoRequestMessage(
                snapshot.value,
                MessageSenderRoles.BACKGROUND
            );
        default:
            return null;
    }
}

function isValidContentControlError(error) {
    return (
        typeof error === 'string' &&
        error.length > 0 &&
        error === error.trim() &&
        String.prototype.isWellFormed.call(error) &&
        utf8ByteLength(error) <= 512
    );
}

function normalizeContentControlResponse(response, expectedRequest) {
    const request = normalizeContentControlRequest(expectedRequest);
    if (!request) return null;

    const successValues = readExactOwnDataRecord(
        response,
        CONTENT_CONTROL_SUCCESS_RESPONSE_KEYS,
        true
    );
    if (
        successValues?.action === request.action &&
        successValues.success === true
    ) {
        return Object.freeze({ action: request.action, success: true });
    }

    const failureValues = readExactOwnDataRecord(
        response,
        CONTENT_CONTROL_FAILURE_RESPONSE_KEYS,
        true
    );
    if (
        failureValues?.action !== request.action ||
        failureValues.success !== false ||
        !isValidContentControlError(failureValues.error)
    ) {
        return null;
    }
    return Object.freeze({
        action: request.action,
        success: false,
        error: failureValues.error,
    });
}

export function buildContentControlResponseMessage(expectedRequest, result) {
    const request = normalizeContentControlRequest(expectedRequest);
    if (!request) {
        throw new TypeError('Invalid content-control request');
    }

    const successValues = readExactOwnDataRecord(
        result,
        CONTENT_CONTROL_SUCCESS_RESULT_KEYS,
        true
    );
    if (successValues?.success === true) {
        return Object.freeze({ action: request.action, success: true });
    }

    const failureValues = readExactOwnDataRecord(
        result,
        CONTENT_CONTROL_FAILURE_RESULT_KEYS,
        true
    );
    if (
        failureValues?.success !== false ||
        !isValidContentControlError(failureValues.error)
    ) {
        throw new TypeError('Invalid content-control response');
    }
    return Object.freeze({
        action: request.action,
        success: false,
        error: failureValues.error,
    });
}

export function parseContentControlResponseMessage(response, expectedRequest) {
    try {
        return normalizeContentControlResponse(response, expectedRequest);
    } catch (_) {
        return null;
    }
}

function isBackgroundReadinessAction(action) {
    return (
        action === MessageActions.PING ||
        action === MessageActions.CHECK_BACKGROUND_READY
    );
}

function normalizeBackgroundServiceState(services) {
    const values = readExactOwnDataRecord(
        services,
        BACKGROUND_SERVICE_STATE_KEYS,
        true
    );
    if (
        !values ||
        BACKGROUND_SERVICE_STATE_KEYS.some(
            (key) => typeof values[key] !== 'boolean'
        ) ||
        (values.aiContextInitialized && !values.aiContext)
    ) {
        return null;
    }
    return Object.freeze({
        translation: values.translation,
        subtitle: values.subtitle,
        aiContext: values.aiContext,
        aiContextInitialized: values.aiContextInitialized,
    });
}

function serviceStateIsReady(services) {
    return (
        services.translation &&
        services.subtitle &&
        services.aiContext &&
        services.aiContextInitialized
    );
}

export function buildBackgroundReadinessRequestMessage(action) {
    if (!isBackgroundReadinessAction(action)) {
        throw new TypeError('Invalid background-readiness action');
    }
    return Object.freeze({ action });
}

export function parseBackgroundReadinessRequestMessage(message, senderRole) {
    if (
        senderRole !== MessageSenderRoles.CONTENT &&
        senderRole !== MessageSenderRoles.SIDEPANEL
    ) {
        return null;
    }
    const values = readExactOwnDataRecord(
        message,
        BACKGROUND_READINESS_REQUEST_KEYS,
        true
    );
    return isBackgroundReadinessAction(values?.action)
        ? Object.freeze({ action: values.action })
        : null;
}

export function buildBackgroundReadinessResponseMessage(
    expectedRequest,
    result
) {
    const request = parseBackgroundReadinessRequestMessage(
        expectedRequest,
        MessageSenderRoles.CONTENT
    );
    const values = readExactOwnDataRecord(
        result,
        BACKGROUND_READINESS_RESULT_KEYS,
        true
    );
    const services = values && normalizeBackgroundServiceState(values.services);
    if (
        !request ||
        !services ||
        typeof values.ready !== 'boolean' ||
        values.ready !== serviceStateIsReady(services)
    ) {
        throw new TypeError('Invalid background-readiness response');
    }
    return Object.freeze({
        action: request.action,
        ready: values.ready,
        services,
    });
}

export function parseBackgroundReadinessResponseMessage(
    response,
    expectedRequest
) {
    try {
        const request = parseBackgroundReadinessRequestMessage(
            expectedRequest,
            MessageSenderRoles.CONTENT
        );
        const values = readExactOwnDataRecord(
            response,
            BACKGROUND_READINESS_RESPONSE_KEYS,
            true
        );
        const services =
            values && normalizeBackgroundServiceState(values.services);
        if (
            !request ||
            !services ||
            values.action !== request.action ||
            typeof values.ready !== 'boolean' ||
            values.ready !== serviceStateIsReady(services)
        ) {
            return null;
        }
        return Object.freeze({
            action: request.action,
            ready: values.ready,
            services,
        });
    } catch (_) {
        return null;
    }
}

function normalizeSidePanelWordIntentOptions(input) {
    const snapshot = tryCreatePlainDataSnapshot(
        input,
        SIDEPANEL_WORD_INTENT_LIMITS
    );
    if (!snapshot.accepted) return null;
    const values = readExactOwnDataRecord(
        snapshot.value,
        SIDEPANEL_WORD_INTENT_OPTIONS_KEYS,
        true
    );
    if (
        !values ||
        typeof values.autoOpen !== 'boolean' ||
        typeof values.pauseVideo !== 'boolean'
    ) {
        return null;
    }
    return Object.freeze({
        autoOpen: values.autoOpen,
        pauseVideo: values.pauseVideo,
    });
}

function copyBinding(binding) {
    return {
        registrationId: binding.registrationId,
        tabId: binding.tabId,
        windowId: binding.windowId,
    };
}

function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function isWellFormedSelectionWord(value) {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        String.prototype.isWellFormed.call(value) &&
        utf8ByteLength(value) <= MAX_SELECTION_WORD_BYTES
    );
}

function readSelectionEntries(value) {
    try {
        if (
            !Array.isArray(value) ||
            Object.getPrototypeOf(value) !== Array.prototype
        ) {
            return null;
        }

        const lengthDescriptor = Object.getOwnPropertyDescriptor(
            value,
            'length'
        );
        const length = lengthDescriptor?.value;
        if (
            !lengthDescriptor ||
            !Object.hasOwn(lengthDescriptor, 'value') ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > MAX_SELECTION_ENTRIES
        ) {
            return null;
        }

        const keys = Reflect.ownKeys(value);
        if (keys.length !== length + 1 || !keys.includes('length')) return null;

        const entries = [];
        let previousWordIndex = -1;
        let joinedCodeUnits = 0;
        let joinedBytes = 0;
        for (let index = 0; index < length; index += 1) {
            const key = String(index);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (
                !descriptor ||
                descriptor.enumerable !== true ||
                !Object.hasOwn(descriptor, 'value')
            ) {
                return null;
            }

            const entryValues = readExactOwnDataRecord(
                descriptor.value,
                SELECTION_ENTRY_KEYS,
                true
            );
            if (
                !entryValues ||
                !isNonnegativeSafeInteger(entryValues.wordIndex) ||
                entryValues.wordIndex <= previousWordIndex ||
                !isWellFormedSelectionWord(entryValues.word)
            ) {
                return null;
            }

            if (index > 0) {
                joinedCodeUnits += 1;
                joinedBytes += 1;
            }
            joinedCodeUnits += entryValues.word.length;
            joinedBytes += utf8ByteLength(entryValues.word);
            if (
                joinedCodeUnits > MAX_SELECTION_JOINED_CODE_UNITS ||
                joinedBytes > MAX_SELECTION_JOINED_BYTES
            ) {
                return null;
            }

            entries.push(
                Object.freeze({
                    wordIndex: entryValues.wordIndex,
                    word: entryValues.word,
                })
            );
            previousWordIndex = entryValues.wordIndex;
        }

        if (
            !keys.every(
                (key) =>
                    key === 'length' ||
                    (typeof key === 'string' &&
                        /^(0|[1-9]\d*)$/.test(key) &&
                        Number(key) < length)
            )
        ) {
            return null;
        }

        return Object.freeze(entries);
    } catch (_) {
        return null;
    }
}

function normalizeSelectionSnapshotData(input, { includeLifecycle }) {
    const snapshot = tryCreatePlainDataSnapshot(
        input,
        SELECTION_SNAPSHOT_LIMITS
    );
    if (!snapshot.accepted) return null;

    const expectedKeys = includeLifecycle
        ? CONTENT_SELECTION_SNAPSHOT_KEYS
        : CONTENT_SELECTION_SNAPSHOT_KEYS.slice(1);
    const values = readExactOwnDataRecord(snapshot.value, expectedKeys, true);
    if (
        !values ||
        (includeLifecycle &&
            !isPositiveSafeInteger(values.lifecycleGeneration)) ||
        !isPositiveSafeInteger(values.selectionRevision) ||
        !isPositiveSafeInteger(values.renderRevision) ||
        !SELECTION_REASONS.includes(values.reason)
    ) {
        return null;
    }

    const entries = readSelectionEntries(values.entries);
    if (!entries) return null;
    const requiresEmptyEntries =
        values.reason === 'clear' || values.reason === 'subtitle-change';
    const requiresNonemptyEntries =
        values.reason === 'add' || values.reason === 'restore';
    if (
        (requiresEmptyEntries && entries.length !== 0) ||
        (requiresNonemptyEntries && entries.length === 0)
    ) {
        return null;
    }

    const normalized = {};
    if (includeLifecycle) {
        normalized.lifecycleGeneration = values.lifecycleGeneration;
    }
    normalized.selectionRevision = values.selectionRevision;
    normalized.renderRevision = values.renderRevision;
    normalized.reason = values.reason;
    normalized.entries = entries;
    return Object.freeze(normalized);
}

function normalizeSelectionState(selection) {
    if (selection === null) return null;

    const snapshot = tryCreatePlainDataSnapshot(
        selection,
        SELECTION_SNAPSHOT_LIMITS
    );
    if (!snapshot.accepted) return undefined;
    const values = readExactOwnDataRecord(
        snapshot.value,
        SELECTION_STATE_KEYS,
        true
    );
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
        { includeLifecycle: false }
    );
    if (!state) return undefined;

    return Object.freeze({
        selectionOwnerGeneration: values.selectionOwnerGeneration,
        selectionRevision: state.selectionRevision,
        renderRevision: state.renderRevision,
        reason: state.reason,
        entries: state.entries,
    });
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

function normalizeRequestIdRecord(value) {
    const values = readExactOwnDataRecord(value, REQUEST_ID_KEYS, true);
    if (!values || !isPositiveSafeInteger(values.requestId)) return null;
    return Object.freeze({ requestId: values.requestId });
}

function normalizeSelectionRemovalRequestData(value) {
    const values = readExactOwnDataRecord(
        value,
        SELECTION_REMOVAL_REQUEST_KEYS,
        true
    );
    const binding = values && parseSidePanelBindingTuple(values.binding);
    if (
        !binding ||
        !isPositiveSafeInteger(values.requestId) ||
        !isPositiveSafeInteger(values.selectionOwnerGeneration) ||
        !isPositiveSafeInteger(values.selectionRevision) ||
        !isPositiveSafeInteger(values.renderRevision) ||
        !isNonnegativeSafeInteger(values.wordIndex)
    ) {
        return null;
    }

    return Object.freeze({
        binding,
        requestId: values.requestId,
        selectionOwnerGeneration: values.selectionOwnerGeneration,
        selectionRevision: values.selectionRevision,
        renderRevision: values.renderRevision,
        wordIndex: values.wordIndex,
    });
}

function normalizeSelectionRemovalCommandData(value) {
    const values = readExactOwnDataRecord(
        value,
        SELECTION_REMOVAL_COMMAND_KEYS,
        true
    );
    if (
        !values ||
        !isPositiveSafeInteger(values.requestId) ||
        !isPositiveSafeInteger(values.lifecycleGeneration) ||
        !isPositiveSafeInteger(values.selectionRevision) ||
        !isPositiveSafeInteger(values.renderRevision) ||
        !isNonnegativeSafeInteger(values.wordIndex)
    ) {
        return null;
    }

    return Object.freeze({
        requestId: values.requestId,
        lifecycleGeneration: values.lifecycleGeneration,
        selectionRevision: values.selectionRevision,
        renderRevision: values.renderRevision,
        wordIndex: values.wordIndex,
    });
}

function isSelectionRemovalStatus(value) {
    return value === 'applied' || value === 'rejected';
}

function normalizeSelectionRemovalResultData(value) {
    const values = readExactOwnDataRecord(
        value,
        SELECTION_REMOVAL_RESULT_KEYS,
        true
    );
    const binding = values && parseSidePanelBindingTuple(values.binding);
    if (
        !binding ||
        !isPositiveSafeInteger(values.requestId) ||
        !isPositiveSafeInteger(values.selectionOwnerGeneration) ||
        !isSelectionRemovalStatus(values.status)
    ) {
        return null;
    }
    return Object.freeze({
        binding,
        requestId: values.requestId,
        selectionOwnerGeneration: values.selectionOwnerGeneration,
        status: values.status,
    });
}

export function buildSidePanelContentSelectionSnapshotMessage(input) {
    const data = normalizeSelectionSnapshotData(input, {
        includeLifecycle: true,
    });
    if (!data) throw new TypeError('Invalid side-panel selection snapshot');

    return Object.freeze({
        action: MessageActions.SIDEPANEL_SELECTION_SYNC,
        data,
    });
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
    try {
        const snapshot = tryCreatePlainDataSnapshot(
            message,
            SIDEPANEL_WORD_INTENT_LIMITS
        );
        if (!snapshot.accepted) return null;
        const envelope = readExactOwnDataRecord(
            snapshot.value,
            SIDEPANEL_WORD_INTENT_MESSAGE_KEYS,
            true
        );
        if (
            !envelope ||
            envelope.action !== MessageActions.SIDEPANEL_WORD_SELECTED
        ) {
            return null;
        }
        const options = normalizeSidePanelWordIntentOptions(envelope.options);
        if (!options) return null;
        return Object.freeze({
            action: MessageActions.SIDEPANEL_WORD_SELECTED,
            options,
        });
    } catch (_) {
        return null;
    }
}

export function parseSidePanelContentSelectionSnapshotMessage(message) {
    try {
        const envelope = readExactOwnDataRecord(
            message,
            SIDEPANEL_MESSAGE_KEYS,
            true
        );
        if (
            !envelope ||
            envelope.action !== MessageActions.SIDEPANEL_SELECTION_SYNC
        ) {
            return null;
        }
        return normalizeSelectionSnapshotData(envelope.data, {
            includeLifecycle: true,
        });
    } catch (_) {
        return null;
    }
}

export function buildSidePanelContentSelectionSnapshotResponse(status) {
    if (status !== 'accepted' && status !== 'rejected') {
        throw new TypeError('Invalid side-panel selection snapshot status');
    }
    return Object.freeze({ success: status === 'accepted' });
}

export function parseSidePanelContentSelectionSnapshotResponse(response) {
    try {
        const values = readExactOwnDataRecord(
            response,
            SELECTION_SNAPSHOT_RESPONSE_KEYS,
            true
        );
        if (!values || typeof values.success !== 'boolean') return null;
        return Object.freeze({
            status: values.success ? 'accepted' : 'rejected',
        });
    } catch (_) {
        return null;
    }
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
    try {
        const normalizedExpectedBinding =
            parseSidePanelBindingTuple(expectedBinding);
        const envelope = readExactOwnDataRecord(
            message,
            SIDEPANEL_MESSAGE_KEYS,
            true
        );
        const data =
            envelope?.action === MessageActions.SIDEPANEL_SELECTION_SYNC
                ? readExactOwnDataRecord(
                      envelope.data,
                      SELECTION_STATE_DATA_KEYS,
                      true
                  )
                : null;
        const binding = data && parseSidePanelBindingTuple(data.binding);
        const selection = data ? normalizeSelectionState(data.selection) : null;
        if (
            !normalizedExpectedBinding ||
            !binding ||
            !bindingsEqual(binding, normalizedExpectedBinding) ||
            selection === undefined
        ) {
            return null;
        }
        return Object.freeze({ binding, selection });
    } catch (_) {
        return null;
    }
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
    try {
        const envelope = readExactOwnDataRecord(
            message,
            SIDEPANEL_MESSAGE_KEYS,
            true
        );
        if (
            !envelope ||
            envelope.action !== MessageActions.SIDEPANEL_GET_STATE
        ) {
            return null;
        }
        return normalizeRequestIdRecord(envelope.data);
    } catch (_) {
        return null;
    }
}

export function buildSidePanelSelectionRepublishAck(expectedRequest) {
    const request = normalizeRequestIdRecord(expectedRequest);
    if (!request) {
        throw new TypeError('Invalid side-panel selection republish request');
    }
    return Object.freeze({ requestId: request.requestId });
}

export function parseSidePanelSelectionRepublishAck(response, expectedRequest) {
    try {
        const request = normalizeRequestIdRecord(expectedRequest);
        const acknowledgement = normalizeRequestIdRecord(response);
        if (
            !request ||
            !acknowledgement ||
            acknowledgement.requestId !== request.requestId
        ) {
            return null;
        }
        return acknowledgement;
    } catch (_) {
        return null;
    }
}

export function buildSidePanelSelectionRemovalRequestMessage(input) {
    const data = normalizeSelectionRemovalRequestData(input);
    if (!data) {
        throw new TypeError('Invalid side-panel selection removal request');
    }
    return Object.freeze({
        action: MessageActions.SIDEPANEL_UPDATE_STATE,
        data,
    });
}

export function parseSidePanelSelectionRemovalRequestMessage(message) {
    try {
        const envelope = readExactOwnDataRecord(
            message,
            SIDEPANEL_MESSAGE_KEYS,
            true
        );
        if (
            !envelope ||
            envelope.action !== MessageActions.SIDEPANEL_UPDATE_STATE
        ) {
            return null;
        }
        return normalizeSelectionRemovalRequestData(envelope.data);
    } catch (_) {
        return null;
    }
}

export function buildSidePanelSelectionRemovalCommandMessage(
    removalRequest,
    lifecycleGeneration
) {
    const removal = normalizeSelectionRemovalRequestData(removalRequest);
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
    try {
        const envelope = readExactOwnDataRecord(
            message,
            SIDEPANEL_MESSAGE_KEYS,
            true
        );
        if (
            !envelope ||
            envelope.action !== MessageActions.SIDEPANEL_UPDATE_STATE
        ) {
            return null;
        }
        return normalizeSelectionRemovalCommandData(envelope.data);
    } catch (_) {
        return null;
    }
}

export function buildSidePanelSelectionRemovalCommandResponse(
    expectedCommand,
    status
) {
    const command = normalizeSelectionRemovalCommandData(expectedCommand);
    if (!command || !isSelectionRemovalStatus(status)) {
        throw new TypeError(
            'Invalid side-panel selection removal command response'
        );
    }
    return Object.freeze({
        success: status === 'applied',
        requestId: command.requestId,
    });
}

export function parseSidePanelSelectionRemovalCommandResponse(
    response,
    expectedCommand
) {
    try {
        const command = normalizeSelectionRemovalCommandData(expectedCommand);
        const values = readExactOwnDataRecord(
            response,
            SELECTION_REMOVAL_COMMAND_RESPONSE_KEYS,
            true
        );
        if (
            !command ||
            !values ||
            typeof values.success !== 'boolean' ||
            values.requestId !== command.requestId
        ) {
            return null;
        }
        return Object.freeze({
            requestId: command.requestId,
            status: values.success ? 'applied' : 'rejected',
        });
    } catch (_) {
        return null;
    }
}

export function buildSidePanelSelectionRemovalResultMessage(
    expectedRemovalRequest,
    status
) {
    const removal = normalizeSelectionRemovalRequestData(
        expectedRemovalRequest
    );
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
    try {
        const removal = normalizeSelectionRemovalRequestData(
            expectedRemovalRequest
        );
        const envelope = readExactOwnDataRecord(
            message,
            SIDEPANEL_MESSAGE_KEYS,
            true
        );
        const result =
            envelope?.action === MessageActions.SIDEPANEL_UPDATE_STATE
                ? normalizeSelectionRemovalResultData(envelope.data)
                : null;
        if (
            !removal ||
            !result ||
            !bindingsEqual(result.binding, removal.binding) ||
            result.requestId !== removal.requestId ||
            result.selectionOwnerGeneration !== removal.selectionOwnerGeneration
        ) {
            return null;
        }
        return result;
    } catch (_) {
        return null;
    }
}

function isStructuredCloneableRecord(record) {
    if (typeof globalThis.structuredClone !== 'function') return false;
    try {
        globalThis.structuredClone(record);
        return true;
    } catch (_) {
        return false;
    }
}

function normalizeSidePanelTabBinding(input) {
    const values = readExactOwnDataRecord(
        input,
        SIDEPANEL_TAB_BINDING_KEYS,
        true
    );
    if (
        !values ||
        !Number.isSafeInteger(values.tabId) ||
        values.tabId < 0 ||
        !Number.isSafeInteger(values.windowId) ||
        values.windowId < 0 ||
        !isStructuredCloneableRecord(input)
    ) {
        return null;
    }
    return Object.freeze({
        tabId: values.tabId,
        windowId: values.windowId,
    });
}

function buildSidePanelTabBindingMessage(action, input) {
    const binding = normalizeSidePanelTabBinding(input);
    if (!binding) {
        throw new TypeError('Invalid side-panel tab binding');
    }
    return {
        action,
        data: { tabId: binding.tabId, windowId: binding.windowId },
    };
}

function parseSidePanelTabBindingMessage(message, expectedAction) {
    try {
        const envelope = readExactOwnDataRecord(
            message,
            SIDEPANEL_MESSAGE_KEYS,
            true
        );
        if (envelope?.action !== expectedAction) return null;
        const binding = normalizeSidePanelTabBinding(envelope.data);
        if (!binding || !isStructuredCloneableRecord(message)) return null;
        return binding;
    } catch (_) {
        return null;
    }
}

export function buildSidePanelTabActivatedMessage(input) {
    return buildSidePanelTabBindingMessage(
        MessageActions.SIDEPANEL_TAB_ACTIVATED,
        input
    );
}

export function parseSidePanelTabActivatedMessage(message) {
    return parseSidePanelTabBindingMessage(
        message,
        MessageActions.SIDEPANEL_TAB_ACTIVATED
    );
}

export function buildSidePanelForceBindTabMessage(input) {
    return buildSidePanelTabBindingMessage(
        MessageActions.SIDEPANEL_FORCE_BIND_TAB,
        input
    );
}

export function parseSidePanelForceBindTabMessage(message) {
    return parseSidePanelTabBindingMessage(
        message,
        MessageActions.SIDEPANEL_FORCE_BIND_TAB
    );
}

export function parseSidePanelBindingTuple(binding) {
    const values = readExactOwnDataRecord(binding, BINDING_KEYS, true);
    if (!values) return null;
    if (
        !Number.isSafeInteger(values.registrationId) ||
        values.registrationId <= 0 ||
        !Number.isSafeInteger(values.tabId) ||
        values.tabId < 0 ||
        !Number.isSafeInteger(values.windowId) ||
        values.windowId < 0
    ) {
        return null;
    }
    if (!isStructuredCloneableRecord(binding)) return null;

    return Object.freeze(copyBinding(values));
}

export function buildSidePanelRegistrationMessage(binding, timestamp) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new TypeError('Invalid side-panel registration timestamp');
    }
    const normalizedBinding = parseSidePanelBindingTuple(binding);
    if (!normalizedBinding) {
        throw new TypeError('Invalid side-panel registration binding');
    }
    return {
        action: MessageActions.SIDEPANEL_REGISTER,
        data: copyBinding(normalizedBinding),
        source: 'sidepanel',
        timestamp,
    };
}

export function parseSidePanelRegistrationMessage(message) {
    const envelope = readExactOwnDataRecord(message, REGISTRATION_MESSAGE_KEYS);
    if (!envelope) return null;
    if (
        envelope.action !== MessageActions.SIDEPANEL_REGISTER ||
        envelope.source !== 'sidepanel' ||
        !Number.isSafeInteger(envelope.timestamp) ||
        envelope.timestamp < 0
    ) {
        return null;
    }

    const binding = parseSidePanelBindingTuple(envelope.data);
    if (!binding || !isStructuredCloneableRecord(message)) return null;

    return binding;
}

export function buildSidePanelBindingConfirmationMessage(binding) {
    const normalizedBinding = parseSidePanelBindingTuple(binding);
    if (!normalizedBinding) {
        throw new TypeError('Invalid side-panel binding confirmation');
    }
    return {
        action: MessageActions.SIDEPANEL_BINDING_CONFIRMED,
        data: copyBinding(normalizedBinding),
    };
}

export function parseSidePanelBindingConfirmationMessage(message) {
    const envelope = readExactOwnDataRecord(
        message,
        BINDING_CONFIRMATION_MESSAGE_KEYS
    );
    if (
        !envelope ||
        envelope.action !== MessageActions.SIDEPANEL_BINDING_CONFIRMED
    ) {
        return null;
    }

    const binding = parseSidePanelBindingTuple(envelope.data);
    if (!binding || !isStructuredCloneableRecord(message)) return null;

    return binding;
}
