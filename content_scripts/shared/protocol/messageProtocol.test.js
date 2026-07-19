import { MessageActions } from '../constants/messageActions.js';
import { CONTEXT_TYPES } from '../constants/contextTypes.js';
import {
    buildAnalyzeContextRequestMessage,
    buildAnalyzeContextFailureResponse,
    buildAnalyzeContextSuccessResponse,
    buildBackgroundReadinessRequestMessage,
    buildBackgroundReadinessResponseMessage,
    buildConfigChangedRequestMessage,
    buildContentControlResponseMessage,
    buildLoggingLevelChangedRequestMessage,
    buildSidePanelPauseVideoRequestMessage,
    buildSidePanelContentSelectionSnapshotMessage,
    buildSidePanelContentSelectionSnapshotResponse,
    buildSidePanelBindingConfirmationMessage,
    buildSidePanelForceBindTabMessage,
    buildSidePanelSelectionStateMessage,
    buildSidePanelSelectionRepublishAck,
    buildSidePanelSelectionRepublishRequestMessage,
    buildSidePanelSelectionRemovalRequestMessage,
    buildSidePanelSelectionRemovalCommandMessage,
    buildSidePanelSelectionRemovalCommandResponse,
    buildSidePanelSelectionRemovalResultMessage,
    buildSidePanelRegistrationMessage,
    buildSidePanelTabActivatedMessage,
    buildSidePanelWordIntentMessage,
    buildTranslationFailureResponse,
    buildTranslationRequestMessage,
    buildTranslationSuccessResponse,
    classifyExtensionMessageSender,
    MessageSenderRoles,
    parseAnalyzeContextRequestMessage,
    parseAnalyzeContextResponseMessage,
    parseBackgroundReadinessRequestMessage,
    parseBackgroundReadinessResponseMessage,
    parseConfigChangedRequestMessage,
    parseContentControlResponseMessage,
    parseLoggingLevelChangedRequestMessage,
    parseSidePanelPauseVideoRequestMessage,
    parseSidePanelContentSelectionSnapshotMessage,
    parseSidePanelContentSelectionSnapshotResponse,
    parseSidePanelBindingConfirmationMessage,
    parseSidePanelForceBindTabMessage,
    parseSidePanelSelectionStateMessage,
    parseSidePanelSelectionRepublishAck,
    parseSidePanelSelectionRepublishRequestMessage,
    parseSidePanelSelectionRemovalRequestMessage,
    parseSidePanelSelectionRemovalCommandMessage,
    parseSidePanelSelectionRemovalCommandResponse,
    parseSidePanelSelectionRemovalResultMessage,
    parseSidePanelRegistrationMessage,
    parseSidePanelTabActivatedMessage,
    parseSidePanelWordIntentMessage,
    parseTranslationRequestMessage,
    parseTranslationResponseMessage,
    readProtocolMessageAction,
} from './messageProtocol.js';

const EXTENSION_ID = 'dualsub-test-extension';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const MAX_RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const TEST_MANIFEST = Object.freeze({
    action: Object.freeze({ default_popup: 'popup/popup.html' }),
    background: Object.freeze({ service_worker: 'background.js' }),
    options_ui: Object.freeze({ page: 'options/options.html' }),
    side_panel: Object.freeze({ default_path: 'sidepanel/sidepanel.html' }),
});

describe('content-control request protocol', () => {
    test('builds and parses a bounded detached config-change request for the popup role', () => {
        const changes = {
            subtitlesEnabled: true,
            targetLanguage: 'EN-us',
        };

        const request = buildConfigChangedRequestMessage(changes);

        expect(request).toEqual({
            action: MessageActions.CONFIG_CHANGED,
            changes: {
                subtitlesEnabled: true,
                targetLanguage: 'EN-us',
            },
        });
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.changes)).toBe(true);
        expect(request.changes).not.toBe(changes);

        const parsed = parseConfigChangedRequestMessage(
            request,
            MessageSenderRoles.POPUP
        );
        expect(parsed).toEqual(request);
        expect(parsed).not.toBe(request);
        expect(parsed.changes).not.toBe(request.changes);
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.changes)).toBe(true);
        expect(
            parseConfigChangedRequestMessage(
                request,
                MessageSenderRoles.BACKGROUND
            )
        ).toBeNull();
    });

    test('accepts only exact logging and pause controls from the background role', () => {
        const loggingRequest = buildLoggingLevelChangedRequestMessage(3);
        const pauseRequest = buildSidePanelPauseVideoRequestMessage();

        expect(loggingRequest).toEqual({
            action: MessageActions.LOGGING_LEVEL_CHANGED,
            level: 3,
        });
        expect(pauseRequest).toEqual({
            action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
        });
        expect(
            parseLoggingLevelChangedRequestMessage(
                loggingRequest,
                MessageSenderRoles.BACKGROUND
            )
        ).toEqual(loggingRequest);
        expect(
            parseSidePanelPauseVideoRequestMessage(
                pauseRequest,
                MessageSenderRoles.BACKGROUND
            )
        ).toEqual(pauseRequest);

        for (const role of [
            MessageSenderRoles.CONTENT,
            MessageSenderRoles.POPUP,
            MessageSenderRoles.SIDEPANEL,
        ]) {
            expect(
                parseLoggingLevelChangedRequestMessage(loggingRequest, role)
            ).toBeNull();
            expect(
                parseSidePanelPauseVideoRequestMessage(pauseRequest, role)
            ).toBeNull();
        }
    });

    test('correlates exact content-control success and failure responses to the request action', () => {
        const configRequest = buildConfigChangedRequestMessage({
            subtitlesEnabled: true,
        });
        const pauseRequest = buildSidePanelPauseVideoRequestMessage();
        const success = buildContentControlResponseMessage(configRequest, {
            success: true,
        });
        const failure = buildContentControlResponseMessage(pauseRequest, {
            success: false,
            error: 'Video could not be paused',
        });

        expect(success).toEqual({
            action: MessageActions.CONFIG_CHANGED,
            success: true,
        });
        expect(failure).toEqual({
            action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
            success: false,
            error: 'Video could not be paused',
        });
        expect(
            parseContentControlResponseMessage(success, configRequest)
        ).toEqual(success);
        expect(
            parseContentControlResponseMessage(failure, pauseRequest)
        ).toEqual(failure);
        expect(
            parseContentControlResponseMessage(success, pauseRequest)
        ).toBeNull();
        expect(
            parseContentControlResponseMessage(
                { ...success, extra: true },
                configRequest
            )
        ).toBeNull();
    });

    test('rejects malformed config envelopes without invoking accessors', () => {
        let reads = 0;
        const accessorChanges = {};
        Object.defineProperty(accessorChanges, 'targetLanguage', {
            enumerable: true,
            get() {
                reads += 1;
                return 'ja';
            },
        });
        const accessorEnvelope = { changes: { targetLanguage: 'ja' } };
        Object.defineProperty(accessorEnvelope, 'action', {
            enumerable: true,
            get() {
                reads += 1;
                return MessageActions.CONFIG_CHANGED;
            },
        });

        for (const changes of [
            {},
            [],
            Object.create({ inherited: true }),
            accessorChanges,
            { subtitleFontSize: Number.NaN },
            { subtitleFontSize: Number.POSITIVE_INFINITY },
            { nested: { value: Symbol('forbidden') } },
            { targetLanguage: 'x'.repeat(4097) },
        ]) {
            expect(() => buildConfigChangedRequestMessage(changes)).toThrow(
                TypeError
            );
        }

        const symbolChanges = { targetLanguage: 'ja' };
        symbolChanges[Symbol('extra')] = true;
        expect(() => buildConfigChangedRequestMessage(symbolChanges)).toThrow(
            TypeError
        );
        expect(
            parseConfigChangedRequestMessage(
                accessorEnvelope,
                MessageSenderRoles.POPUP
            )
        ).toBeNull();
        expect(
            parseConfigChangedRequestMessage(
                {
                    action: MessageActions.CONFIG_CHANGED,
                    changes: accessorChanges,
                },
                MessageSenderRoles.POPUP
            )
        ).toBeNull();
        expect(
            parseConfigChangedRequestMessage(
                {
                    action: MessageActions.CONFIG_CHANGED,
                    changes: { targetLanguage: 'ja' },
                    extra: true,
                },
                MessageSenderRoles.POPUP
            )
        ).toBeNull();
        expect(reads).toBe(0);
    });

    test('accepts a transparent config proxy but retains only a deeply frozen snapshot', () => {
        const rawChanges = {
            aiContextTypes: ['summary', 'cultural'],
        };
        const request = buildConfigChangedRequestMessage(
            new Proxy(rawChanges, {})
        );
        rawChanges.aiContextTypes[0] = 'mutated';

        expect(request.changes).toEqual({
            aiContextTypes: ['summary', 'cultural'],
        });
        expect(request.changes).not.toBe(rawChanges);
        expect(Object.isFrozen(request.changes)).toBe(true);
        expect(Object.isFrozen(request.changes.aiContextTypes)).toBe(true);
    });

    test.each([-1, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3'])(
        'rejects invalid logging level %p',
        (level) => {
            expect(() => buildLoggingLevelChangedRequestMessage(level)).toThrow(
                TypeError
            );
            expect(
                parseLoggingLevelChangedRequestMessage(
                    {
                        action: MessageActions.LOGGING_LEVEL_CHANGED,
                        level,
                    },
                    MessageSenderRoles.BACKGROUND
                )
            ).toBeNull();
        }
    );

    test('rejects inexact logging and pause envelopes', () => {
        const logging = buildLoggingLevelChangedRequestMessage(2);
        const pause = buildSidePanelPauseVideoRequestMessage();
        expect(
            parseLoggingLevelChangedRequestMessage(
                { ...logging, source: 'background' },
                MessageSenderRoles.BACKGROUND
            )
        ).toBeNull();
        expect(
            parseLoggingLevelChangedRequestMessage(
                { action: MessageActions.LOGGING_LEVEL_CHANGED },
                MessageSenderRoles.BACKGROUND
            )
        ).toBeNull();
        expect(
            parseSidePanelPauseVideoRequestMessage(
                { ...pause, source: 'background' },
                MessageSenderRoles.BACKGROUND
            )
        ).toBeNull();
        expect(
            parseSidePanelPauseVideoRequestMessage(
                {},
                MessageSenderRoles.BACKGROUND
            )
        ).toBeNull();
    });

    test('rejects malformed content-control results and response errors', () => {
        const request = buildSidePanelPauseVideoRequestMessage();
        for (const result of [
            {},
            { success: true, error: 'extra' },
            { success: false },
            { success: false, error: '' },
            { success: false, error: ' padded ' },
            { success: false, error: 'x'.repeat(513) },
        ]) {
            expect(() =>
                buildContentControlResponseMessage(request, result)
            ).toThrow(TypeError);
        }
        expect(
            parseContentControlResponseMessage(
                {
                    action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
                    success: false,
                    error: 'Video could not be paused',
                    extra: true,
                },
                request
            )
        ).toBeNull();
    });
});

describe('background-readiness protocol', () => {
    const serviceState = Object.freeze({
        translation: true,
        subtitle: true,
        aiContext: true,
        aiContextInitialized: true,
    });

    test.each([MessageActions.PING, MessageActions.CHECK_BACKGROUND_READY])(
        'round-trips the exact %s request and correlated service state',
        (action) => {
            const request = buildBackgroundReadinessRequestMessage(action);
            expect(request).toEqual({ action });
            expect(Object.isFrozen(request)).toBe(true);

            for (const role of [
                MessageSenderRoles.CONTENT,
                MessageSenderRoles.SIDEPANEL,
            ]) {
                expect(
                    parseBackgroundReadinessRequestMessage(request, role)
                ).toEqual(request);
            }
            expect(
                parseBackgroundReadinessRequestMessage(
                    request,
                    MessageSenderRoles.POPUP
                )
            ).toBeNull();

            const response = buildBackgroundReadinessResponseMessage(request, {
                ready: true,
                services: serviceState,
            });
            expect(response).toEqual({
                action,
                ready: true,
                services: serviceState,
            });
            expect(Object.isFrozen(response)).toBe(true);
            expect(Object.isFrozen(response.services)).toBe(true);
            expect(
                parseBackgroundReadinessResponseMessage(response, request)
            ).toEqual(response);

            const otherAction =
                action === MessageActions.PING
                    ? MessageActions.CHECK_BACKGROUND_READY
                    : MessageActions.PING;
            expect(
                parseBackgroundReadinessResponseMessage(response, {
                    action: otherAction,
                })
            ).toBeNull();
        }
    );

    test('rejects inexact readiness requests, wrong roles, and inconsistent states', () => {
        const request = buildBackgroundReadinessRequestMessage(
            MessageActions.PING
        );
        expect(
            parseBackgroundReadinessRequestMessage(
                { ...request, timestamp: 1 },
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
        expect(
            parseBackgroundReadinessRequestMessage(
                {},
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
        expect(() =>
            buildBackgroundReadinessRequestMessage(
                MessageActions.CONFIG_CHANGED
            )
        ).toThrow(TypeError);

        const inconsistent = {
            ready: true,
            services: {
                translation: true,
                subtitle: false,
                aiContext: true,
                aiContextInitialized: true,
            },
        };
        expect(() =>
            buildBackgroundReadinessResponseMessage(request, inconsistent)
        ).toThrow(TypeError);
        expect(
            parseBackgroundReadinessResponseMessage(
                { action: MessageActions.PING, ...inconsistent },
                request
            )
        ).toBeNull();
    });

    test('contains readiness accessors and revoked proxies', () => {
        let reads = 0;
        const accessor = {};
        Object.defineProperty(accessor, 'action', {
            enumerable: true,
            get() {
                reads += 1;
                return MessageActions.PING;
            },
        });
        const revoked = Proxy.revocable({ action: MessageActions.PING }, {});
        revoked.revoke();

        for (const message of [accessor, revoked.proxy]) {
            expect(
                parseBackgroundReadinessRequestMessage(
                    message,
                    MessageSenderRoles.CONTENT
                )
            ).toBeNull();
        }
        expect(reads).toBe(0);
    });
});

describe('protocol action lookup', () => {
    test('reads one catalog action from a plain envelope without consulting payload values', () => {
        let payloadReads = 0;
        const message = {
            action: MessageActions.CONFIG_CHANGED,
        };
        Object.defineProperty(message, 'changes', {
            enumerable: true,
            get() {
                payloadReads += 1;
                throw new Error('must remain unread');
            },
        });

        expect(readProtocolMessageAction(message)).toBe(
            MessageActions.CONFIG_CHANGED
        );
        expect(payloadReads).toBe(0);
    });

    test('fails closed for hostile and noncatalog action envelopes', () => {
        let actionReads = 0;
        const accessor = {};
        Object.defineProperty(accessor, 'action', {
            enumerable: true,
            get() {
                actionReads += 1;
                return MessageActions.PING;
            },
        });
        const symbolEnvelope = { action: MessageActions.PING };
        symbolEnvelope[Symbol('extra')] = true;
        const revoked = Proxy.revocable({ action: MessageActions.PING }, {});
        revoked.revoke();

        for (const value of [
            accessor,
            symbolEnvelope,
            Object.create({ action: MessageActions.PING }),
            [],
            new Date(),
            { action: 'not-a-catalog-action' },
            revoked.proxy,
        ]) {
            expect(readProtocolMessageAction(value)).toBeNull();
        }
        expect(actionReads).toBe(0);
    });

    test('accepts a transparent proxy but returns only its primitive catalog action', () => {
        const message = new Proxy({ action: MessageActions.PING }, {});
        expect(readProtocolMessageAction(message)).toBe(MessageActions.PING);
    });
});

describe('side-panel tab-binding route protocol', () => {
    test.each([
        [
            MessageActions.SIDEPANEL_TAB_ACTIVATED,
            buildSidePanelTabActivatedMessage,
            parseSidePanelTabActivatedMessage,
        ],
        [
            MessageActions.SIDEPANEL_FORCE_BIND_TAB,
            buildSidePanelForceBindTabMessage,
            parseSidePanelForceBindTabMessage,
        ],
    ])(
        'round-trips one exact %s tuple',
        (action, buildMessage, parseMessage) => {
            const input = { tabId: 7, windowId: 3 };
            const message = buildMessage(input);

            expect(message).toEqual({ action, data: input });
            expect(Reflect.ownKeys(message)).toEqual(['action', 'data']);
            expect(Reflect.ownKeys(message.data)).toEqual([
                'tabId',
                'windowId',
            ]);

            const parsed = parseMessage(message);
            expect(parsed).toEqual(input);
            expect(parsed).not.toBe(input);
            expect(Object.isFrozen(parsed)).toBe(true);
        }
    );

    test.each([
        ['missing tab', { windowId: 3 }],
        ['missing window', { tabId: 7 }],
        ['extra field', { tabId: 7, windowId: 3, extra: true }],
        [
            'inherited field',
            Object.assign(Object.create({ extra: true }), {
                tabId: 7,
                windowId: 3,
            }),
        ],
        ['negative tab', { tabId: -1, windowId: 3 }],
        ['fractional tab', { tabId: 1.5, windowId: 3 }],
        ['unsafe tab', { tabId: Number.MAX_SAFE_INTEGER + 1, windowId: 3 }],
        ['NaN tab', { tabId: Number.NaN, windowId: 3 }],
        ['infinite tab', { tabId: Number.POSITIVE_INFINITY, windowId: 3 }],
        ['negative window', { tabId: 7, windowId: -1 }],
        ['fractional window', { tabId: 7, windowId: 1.5 }],
        ['unsafe window', { tabId: 7, windowId: Number.MAX_SAFE_INTEGER + 1 }],
        ['NaN window', { tabId: 7, windowId: Number.NaN }],
        ['infinite window', { tabId: 7, windowId: Number.POSITIVE_INFINITY }],
    ])('rejects %s route data', (_label, data) => {
        for (const [action, buildMessage, parseMessage] of [
            [
                MessageActions.SIDEPANEL_TAB_ACTIVATED,
                buildSidePanelTabActivatedMessage,
                parseSidePanelTabActivatedMessage,
            ],
            [
                MessageActions.SIDEPANEL_FORCE_BIND_TAB,
                buildSidePanelForceBindTabMessage,
                parseSidePanelForceBindTabMessage,
            ],
        ]) {
            expect(() => buildMessage(data)).toThrow(TypeError);
            expect(parseMessage({ action, data })).toBeNull();
        }
    });

    test('rejects accessors and noncanonical envelopes without invoking getters', () => {
        let reads = 0;
        const accessorData = { windowId: 3 };
        Object.defineProperty(accessorData, 'tabId', {
            enumerable: true,
            get() {
                reads += 1;
                return 7;
            },
        });
        const accessorEnvelope = { data: { tabId: 7, windowId: 3 } };
        Object.defineProperty(accessorEnvelope, 'action', {
            enumerable: true,
            get() {
                reads += 1;
                return MessageActions.SIDEPANEL_FORCE_BIND_TAB;
            },
        });

        expect(() => buildSidePanelForceBindTabMessage(accessorData)).toThrow(
            TypeError
        );
        expect(
            parseSidePanelForceBindTabMessage({
                action: MessageActions.SIDEPANEL_FORCE_BIND_TAB,
                data: accessorData,
            })
        ).toBeNull();
        expect(parseSidePanelForceBindTabMessage(accessorEnvelope)).toBeNull();
        expect(
            parseSidePanelForceBindTabMessage({
                action: MessageActions.SIDEPANEL_FORCE_BIND_TAB,
                data: { tabId: 7, windowId: 3 },
                extra: true,
            })
        ).toBeNull();
        expect(reads).toBe(0);
    });
});

function createRuntime() {
    return {
        id: EXTENSION_ID,
        getManifest: () => TEST_MANIFEST,
        getURL: (path = '') => `${EXTENSION_ORIGIN}/${path}`,
    };
}

function createContentSender() {
    return {
        documentId: 'document-1',
        documentLifecycle: 'active',
        frameId: 0,
        id: EXTENSION_ID,
        origin: 'https://www.netflix.com',
        tab: {
            active: true,
            id: 7,
            url: 'https://www.netflix.com/watch/80123456?tab=1',
            windowId: 3,
        },
        url: 'https://www.netflix.com/watch/80123456?sender=1',
    };
}

function createTranslationRequestInput() {
    return {
        text: 'Subtitle text',
        targetLang: 'en-US',
        cueStart: 12.5,
        cueVideoId: 'video-cue-7',
    };
}

function createTranslationRequestWire() {
    return {
        action: MessageActions.TRANSLATE,
        ...createTranslationRequestInput(),
    };
}

function createTranslationSuccessWire() {
    return {
        ...buildTranslationSuccessResponse(createTranslationRequestWire(), {
            translatedText: 'Translated subtitle',
            cached: false,
            processingTime: 9,
        }),
    };
}

function createTranslationFailureWire() {
    return {
        ...buildTranslationFailureResponse(createTranslationRequestWire(), {
            retryable: false,
            retryAfter: null,
        }),
    };
}

describe('translation request protocol', () => {
    test('builds the exact frozen detached request wire shape', () => {
        const input = {
            cueStart: 0,
            cueVideoId: 'cue-1',
            targetLang: 'zh-CN',
            text: '  Retain these spaces  ',
        };

        const message = buildTranslationRequestMessage(input);

        expect(message).toEqual({
            action: MessageActions.TRANSLATE,
            text: '  Retain these spaces  ',
            targetLang: 'zh-CN',
            cueStart: 0,
            cueVideoId: 'cue-1',
        });
        expect(Object.keys(message)).toEqual([
            'action',
            'text',
            'targetLang',
            'cueStart',
            'cueVideoId',
        ]);
        expect(Object.getPrototypeOf(message)).toBe(Object.prototype);
        expect(Object.isFrozen(message)).toBe(true);

        input.text = 'mutated';
        input.cueStart = 99;
        expect(message.text).toBe('  Retain these spaces  ');
        expect(message.cueStart).toBe(0);
    });

    test('parses a null-prototype request into a frozen detached plain record', () => {
        const message = Object.assign(Object.create(null), {
            action: MessageActions.TRANSLATE,
            text: 'Subtitle text',
            targetLang: 'en-US',
            cueStart: 12.5,
            cueVideoId: 'video-cue-7',
        });

        const parsed = parseTranslationRequestMessage(message);
        const second = parseTranslationRequestMessage(message);

        expect(parsed).toEqual({
            action: MessageActions.TRANSLATE,
            text: 'Subtitle text',
            targetLang: 'en-US',
            cueStart: 12.5,
            cueVideoId: 'video-cue-7',
        });
        expect(parsed).not.toBe(message);
        expect(second).toEqual(parsed);
        expect(second).not.toBe(parsed);
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        expect(Object.isFrozen(parsed)).toBe(true);

        message.text = 'mutated';
        expect(parsed.text).toBe('Subtitle text');
    });

    test('rejects a request with the wrong action', () => {
        const message = {
            action: MessageActions.SIDEPANEL_REGISTER,
            text: 'Subtitle text',
            targetLang: 'en-US',
            cueStart: 0,
            cueVideoId: 'video-cue-7',
        };

        expect(parseTranslationRequestMessage(message)).toBeNull();
    });

    test.each([
        ['text', ''],
        ['text', '   '],
        ['text', 1],
        ['targetLang', ''],
        ['targetLang', ' en-US'],
        ['targetLang', 'en-US '],
        ['targetLang', 1],
        ['cueVideoId', ''],
        ['cueVideoId', ' cue-1'],
        ['cueVideoId', 'cue-1 '],
        ['cueVideoId', 1],
        ['cueStart', -1],
        ['cueStart', Number.NaN],
        ['cueStart', Number.POSITIVE_INFINITY],
        ['cueStart', '0'],
    ])('rejects an invalid request %s value', (key, value) => {
        const message = {
            action: MessageActions.TRANSLATE,
            text: 'Subtitle text',
            targetLang: 'en-US',
            cueStart: 0,
            cueVideoId: 'video-cue-7',
            [key]: value,
        };

        expect(parseTranslationRequestMessage(message)).toBeNull();
    });

    test('refuses to build an invalid request', () => {
        expect(() =>
            buildTranslationRequestMessage({
                text: 'Subtitle text',
                targetLang: ' en-US',
                cueStart: 0,
                cueVideoId: 'video-cue-7',
            })
        ).toThrow(TypeError);
    });

    test.each(['action', 'text', 'targetLang', 'cueStart', 'cueVideoId'])(
        'rejects a request missing %s',
        (key) => {
            const message = createTranslationRequestWire();
            delete message[key];

            expect(parseTranslationRequestMessage(message)).toBeNull();
        }
    );

    test.each([
        [
            'an extra string key',
            (message) => {
                message.extra = true;
            },
        ],
        [
            'an extra symbol key',
            (message) => {
                message[Symbol('extra')] = true;
            },
        ],
        ['an array prototype', (message) => Object.assign([], message)],
        [
            'an exotic prototype',
            (message) => Object.assign(Object.create({}), message),
        ],
    ])('rejects a request with %s', (_label, transformMessage) => {
        const message = createTranslationRequestWire();
        const transformed = transformMessage(message) ?? message;

        expect(parseTranslationRequestMessage(transformed)).toBeNull();
    });

    test.each(['action', 'text', 'targetLang', 'cueStart', 'cueVideoId'])(
        'rejects a request %s accessor without invoking it',
        (key) => {
            const message = createTranslationRequestWire();
            const originalValue = message[key];
            let getterCalls = 0;
            Object.defineProperty(message, key, {
                configurable: true,
                enumerable: true,
                get() {
                    getterCalls += 1;
                    return originalValue;
                },
            });

            expect(parseTranslationRequestMessage(message)).toBeNull();
            expect(getterCalls).toBe(0);
        }
    );

    test.each([
        ['text', () => 'Subtitle text'],
        ['targetLang', Symbol('en-US')],
        ['cueStart', 1n],
        ['cueVideoId', { id: 'video-cue-7' }],
    ])('rejects non-cloneable or non-primitive request %s', (key, value) => {
        const message = createTranslationRequestWire();
        message[key] = value;

        expect(parseTranslationRequestMessage(message)).toBeNull();
    });

    test.each(['missing', 'extra', 'symbol', 'accessor', 'array', 'exotic'])(
        'refuses to build an input with an %s own-data shape',
        (variant) => {
            let input = createTranslationRequestInput();
            let getterCalls = 0;
            if (variant === 'missing') delete input.text;
            if (variant === 'extra') input.extra = true;
            if (variant === 'symbol') input[Symbol('extra')] = true;
            if (variant === 'array') input = Object.assign([], input);
            if (variant === 'exotic') {
                input = Object.assign(Object.create({}), input);
            }
            if (variant === 'accessor') {
                Object.defineProperty(input, 'text', {
                    get() {
                        getterCalls += 1;
                        return 'Subtitle text';
                    },
                });
            }

            expect(() => buildTranslationRequestMessage(input)).toThrow(
                TypeError
            );
            expect(getterCalls).toBe(0);
        }
    );

    test('accepts a null-prototype builder input and returns a fresh record each time', () => {
        const input = Object.assign(
            Object.create(null),
            createTranslationRequestInput()
        );

        const first = buildTranslationRequestMessage(input);
        const second = buildTranslationRequestMessage(input);

        expect(first).toEqual(createTranslationRequestWire());
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
        expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
        expect(Object.isFrozen(first)).toBe(true);
    });

    test.each(['request', 'builder input'])(
        'fails closed when a %s descriptor trap throws',
        (targetName) => {
            const target =
                targetName === 'request'
                    ? createTranslationRequestWire()
                    : createTranslationRequestInput();
            const hostile = new Proxy(target, {
                getOwnPropertyDescriptor() {
                    throw new Error('hostile descriptor trap');
                },
            });

            if (targetName === 'request') {
                expect(() =>
                    parseTranslationRequestMessage(hostile)
                ).not.toThrow();
                expect(parseTranslationRequestMessage(hostile)).toBeNull();
            } else {
                expect(() => buildTranslationRequestMessage(hostile)).toThrow(
                    TypeError
                );
            }
        }
    );

    test.each(['getPrototypeOf', 'ownKeys'])(
        'fails closed when a request %s trap throws',
        (trapName) => {
            const hostile = new Proxy(createTranslationRequestWire(), {
                [trapName]() {
                    throw new Error('hostile request trap');
                },
            });

            expect(() => parseTranslationRequestMessage(hostile)).not.toThrow();
            expect(parseTranslationRequestMessage(hostile)).toBeNull();
        }
    );

    test('fails closed for a revoked request proxy', () => {
        const revocable = Proxy.revocable(createTranslationRequestWire(), {});
        revocable.revoke();

        expect(() =>
            parseTranslationRequestMessage(revocable.proxy)
        ).not.toThrow();
        expect(parseTranslationRequestMessage(revocable.proxy)).toBeNull();
    });

    test('accepts a faithful transparent proxy but returns only a detached snapshot', () => {
        const rawMessage = createTranslationRequestWire();
        const proxy = new Proxy(rawMessage, {});

        const parsed = parseTranslationRequestMessage(proxy);

        expect(parsed).toEqual(rawMessage);
        expect(parsed).not.toBe(rawMessage);
        expect(parsed).not.toBe(proxy);
        expect(Object.isFrozen(parsed)).toBe(true);

        rawMessage.text = 'mutated';
        expect(parsed.text).toBe('Subtitle text');

        const rawInput = createTranslationRequestInput();
        const built = buildTranslationRequestMessage(new Proxy(rawInput, {}));
        rawInput.text = 'mutated input';
        expect(built.text).toBe('Subtitle text');
    });
});

describe('translation response protocol', () => {
    test('builds the exact frozen detached success wire shape', () => {
        const expectedRequest = buildTranslationRequestMessage({
            text: '  Original subtitle  ',
            targetLang: 'zh-CN',
            cueStart: 12.5,
            cueVideoId: 'video-cue-7',
        });
        const result = {
            translatedText: '  Translated subtitle  ',
            cached: false,
            processingTime: 7,
        };

        const response = buildTranslationSuccessResponse(
            expectedRequest,
            result
        );

        expect(response).toEqual({
            translatedText: '  Translated subtitle  ',
            originalText: '  Original subtitle  ',
            sourceLanguage: 'auto',
            targetLanguage: 'zh-CN',
            cached: false,
            processingTime: 7,
            cueStart: 12.5,
            cueVideoId: 'video-cue-7',
        });
        expect(Object.keys(response)).toEqual([
            'translatedText',
            'originalText',
            'sourceLanguage',
            'targetLanguage',
            'cached',
            'processingTime',
            'cueStart',
            'cueVideoId',
        ]);
        expect(Object.getPrototypeOf(response)).toBe(Object.prototype);
        expect(Object.isFrozen(response)).toBe(true);

        result.translatedText = 'mutated';
        result.cached = true;
        expect(response.translatedText).toBe('  Translated subtitle  ');
        expect(response.cached).toBe(false);
    });

    test.each([
        ['translatedText', ''],
        ['translatedText', '   '],
        ['translatedText', 1],
        ['cached', 'false'],
        ['cached', null],
        ['processingTime', -1],
        ['processingTime', 1.5],
        ['processingTime', Number.NaN],
        ['processingTime', Number.POSITIVE_INFINITY],
        ['processingTime', Number.MAX_SAFE_INTEGER + 1],
        ['processingTime', '7'],
    ])('refuses to build an invalid success %s', (key, value) => {
        const result = {
            translatedText: 'Translated subtitle',
            cached: true,
            processingTime: 7,
            [key]: value,
        };

        expect(() =>
            buildTranslationSuccessResponse(
                createTranslationRequestWire(),
                result
            )
        ).toThrow(TypeError);
    });

    test('builds the exact frozen detached failure wire shape', () => {
        const expectedRequest = createTranslationRequestWire();
        const failure = { retryable: true, retryAfter: null };

        const response = buildTranslationFailureResponse(
            expectedRequest,
            failure
        );

        expect(response).toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: true,
            retryAfter: null,
            cueStart: 12.5,
            cueVideoId: 'video-cue-7',
        });
        expect(Object.keys(response)).toEqual([
            'error',
            'errorType',
            'retryable',
            'retryAfter',
            'cueStart',
            'cueVideoId',
        ]);
        expect(Object.getPrototypeOf(response)).toBe(Object.prototype);
        expect(Object.isFrozen(response)).toBe(true);

        failure.retryable = false;
        failure.retryAfter = 100;
        expect(response.retryable).toBe(true);
        expect(response.retryAfter).toBeNull();
    });

    test.each([0, MAX_RETRY_AFTER_MS])(
        'builds a failure at the retryAfter endpoint %s',
        (retryAfter) => {
            const response = buildTranslationFailureResponse(
                createTranslationRequestWire(),
                { retryable: false, retryAfter }
            );

            expect(response.retryAfter).toBe(retryAfter);
            expect(response.retryable).toBe(false);
        }
    );

    test.each([
        ['retryable', 'true'],
        ['retryable', null],
        ['retryAfter', -1],
        ['retryAfter', 1.5],
        ['retryAfter', Number.NaN],
        ['retryAfter', Number.POSITIVE_INFINITY],
        ['retryAfter', MAX_RETRY_AFTER_MS + 1],
        ['retryAfter', '0'],
    ])('refuses to build an invalid failure %s', (key, value) => {
        const failure = {
            retryable: true,
            retryAfter: null,
            [key]: value,
        };

        expect(() =>
            buildTranslationFailureResponse(
                createTranslationRequestWire(),
                failure
            )
        ).toThrow(TypeError);
    });

    test.each(['error', 'provider', 'rawError'])(
        'refuses to leak a failure %s field',
        (key) => {
            const failure = {
                retryable: false,
                retryAfter: null,
                [key]: 'sensitive provider detail',
            };

            expect(() =>
                buildTranslationFailureResponse(
                    createTranslationRequestWire(),
                    failure
                )
            ).toThrow(TypeError);
        }
    );

    test('parses a success into an explicit frozen detached local result', () => {
        const expectedRequest = createTranslationRequestWire();
        const response = {
            ...buildTranslationSuccessResponse(expectedRequest, {
                translatedText: 'Translated subtitle',
                cached: true,
                processingTime: 9,
            }),
        };

        const parsed = parseTranslationResponseMessage(
            response,
            expectedRequest
        );

        expect(parsed).toEqual({
            status: 'success',
            translatedText: 'Translated subtitle',
            originalText: 'Subtitle text',
            sourceLanguage: 'auto',
            targetLanguage: 'en-US',
            cached: true,
            processingTime: 9,
            cueStart: 12.5,
            cueVideoId: 'video-cue-7',
        });
        expect(Object.keys(parsed)).toEqual([
            'status',
            'translatedText',
            'originalText',
            'sourceLanguage',
            'targetLanguage',
            'cached',
            'processingTime',
            'cueStart',
            'cueVideoId',
        ]);
        expect(parsed).not.toBe(response);
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        expect(Object.isFrozen(parsed)).toBe(true);

        response.translatedText = 'mutated';
        expect(parsed.translatedText).toBe('Translated subtitle');
    });

    test.each([
        ['translatedText', ''],
        ['translatedText', '   '],
        ['translatedText', 1],
        ['originalText', 'different subtitle'],
        ['sourceLanguage', 'en'],
        ['sourceLanguage', new String('auto')],
        ['targetLanguage', 'fr'],
        ['cached', 'true'],
        ['cached', null],
        ['processingTime', -1],
        ['processingTime', 1.5],
        ['processingTime', Number.NaN],
        ['processingTime', Number.POSITIVE_INFINITY],
        ['processingTime', Number.MAX_SAFE_INTEGER + 1],
        ['cueStart', 12.6],
        ['cueStart', '12.5'],
        ['cueVideoId', 'different-cue'],
        ['cueVideoId', 7],
    ])('rejects an invalid success response %s', (key, value) => {
        const expectedRequest = createTranslationRequestWire();
        const response = {
            ...buildTranslationSuccessResponse(expectedRequest, {
                translatedText: 'Translated subtitle',
                cached: false,
                processingTime: 9,
            }),
            [key]: value,
        };

        expect(
            parseTranslationResponseMessage(response, expectedRequest)
        ).toBeNull();
    });

    test('parses a failure into an explicit frozen detached local result', () => {
        const expectedRequest = createTranslationRequestWire();
        const response = {
            ...buildTranslationFailureResponse(expectedRequest, {
                retryable: true,
                retryAfter: 0,
            }),
        };

        const parsed = parseTranslationResponseMessage(
            response,
            expectedRequest
        );

        expect(parsed).toEqual({
            status: 'failure',
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: true,
            retryAfter: 0,
            cueStart: 12.5,
            cueVideoId: 'video-cue-7',
        });
        expect(Object.keys(parsed)).toEqual([
            'status',
            'error',
            'errorType',
            'retryable',
            'retryAfter',
            'cueStart',
            'cueVideoId',
        ]);
        expect(parsed).not.toBe(response);
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        expect(Object.isFrozen(parsed)).toBe(true);

        response.retryable = false;
        expect(parsed.retryable).toBe(true);
    });

    test('parses the maximum retryAfter endpoint', () => {
        const expectedRequest = createTranslationRequestWire();
        const response = buildTranslationFailureResponse(expectedRequest, {
            retryable: true,
            retryAfter: MAX_RETRY_AFTER_MS,
        });

        expect(
            parseTranslationResponseMessage(response, expectedRequest)
        ).toEqual({
            status: 'failure',
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: true,
            retryAfter: MAX_RETRY_AFTER_MS,
            cueStart: 12.5,
            cueVideoId: 'video-cue-7',
        });
    });

    test.each([
        ['error', 'Provider message'],
        ['error', 1],
        ['errorType', 'ProviderError'],
        ['errorType', new String('TranslationError')],
        ['retryable', 'true'],
        ['retryable', null],
        ['retryAfter', -1],
        ['retryAfter', 1.5],
        ['retryAfter', Number.NaN],
        ['retryAfter', Number.POSITIVE_INFINITY],
        ['retryAfter', MAX_RETRY_AFTER_MS + 1],
        ['retryAfter', '0'],
        ['cueStart', 12.6],
        ['cueStart', '12.5'],
        ['cueVideoId', 'different-cue'],
        ['cueVideoId', 7],
    ])('rejects an invalid failure response %s', (key, value) => {
        const expectedRequest = createTranslationRequestWire();
        const response = {
            ...buildTranslationFailureResponse(expectedRequest, {
                retryable: true,
                retryAfter: null,
            }),
            [key]: value,
        };

        expect(
            parseTranslationResponseMessage(response, expectedRequest)
        ).toBeNull();
    });

    test.each(['provider', 'rawError', 'stack'])(
        'rejects a failure response leaking %s',
        (key) => {
            const expectedRequest = createTranslationRequestWire();
            const response = {
                ...buildTranslationFailureResponse(expectedRequest, {
                    retryable: false,
                    retryAfter: null,
                }),
                [key]: 'sensitive provider detail',
            };

            expect(
                parseTranslationResponseMessage(response, expectedRequest)
            ).toBeNull();
        }
    );

    describe.each([
        [
            'success',
            createTranslationSuccessWire,
            [
                'translatedText',
                'originalText',
                'sourceLanguage',
                'targetLanguage',
                'cached',
                'processingTime',
                'cueStart',
                'cueVideoId',
            ],
        ],
        [
            'failure',
            createTranslationFailureWire,
            [
                'error',
                'errorType',
                'retryable',
                'retryAfter',
                'cueStart',
                'cueVideoId',
            ],
        ],
    ])('%s response record boundary', (status, createWire, keys) => {
        test('accepts a null-prototype record and returns a fresh plain snapshot', () => {
            const response = Object.assign(Object.create(null), createWire());

            const first = parseTranslationResponseMessage(
                response,
                createTranslationRequestWire()
            );
            const second = parseTranslationResponseMessage(
                response,
                createTranslationRequestWire()
            );

            expect(first.status).toBe(status);
            expect(second).toEqual(first);
            expect(second).not.toBe(first);
            expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
            expect(Object.isFrozen(first)).toBe(true);
        });

        test.each(keys)('rejects a response missing %s', (key) => {
            const response = createWire();
            delete response[key];

            expect(
                parseTranslationResponseMessage(
                    response,
                    createTranslationRequestWire()
                )
            ).toBeNull();
        });

        test.each([
            [
                'an extra string key',
                (response) => {
                    response.extra = true;
                    return response;
                },
            ],
            [
                'an extra symbol key',
                (response) => {
                    response[Symbol('extra')] = true;
                    return response;
                },
            ],
            ['an array prototype', (response) => Object.assign([], response)],
            [
                'an exotic prototype',
                (response) => Object.assign(Object.create({}), response),
            ],
        ])('rejects a response with %s', (_label, transformResponse) => {
            const response = transformResponse(createWire());

            expect(
                parseTranslationResponseMessage(
                    response,
                    createTranslationRequestWire()
                )
            ).toBeNull();
        });

        test.each(keys)(
            'rejects a response %s accessor without invoking it',
            (key) => {
                const response = createWire();
                const originalValue = response[key];
                let getterCalls = 0;
                Object.defineProperty(response, key, {
                    configurable: true,
                    enumerable: true,
                    get() {
                        getterCalls += 1;
                        return originalValue;
                    },
                });

                expect(
                    parseTranslationResponseMessage(
                        response,
                        createTranslationRequestWire()
                    )
                ).toBeNull();
                expect(getterCalls).toBe(0);
            }
        );

        test.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'])(
            'fails closed when the %s trap throws',
            (trapName) => {
                const hostile = new Proxy(createWire(), {
                    [trapName]() {
                        throw new Error('hostile response trap');
                    },
                });

                expect(() =>
                    parseTranslationResponseMessage(
                        hostile,
                        createTranslationRequestWire()
                    )
                ).not.toThrow();
                expect(
                    parseTranslationResponseMessage(
                        hostile,
                        createTranslationRequestWire()
                    )
                ).toBeNull();
            }
        );

        test('fails closed for a revoked response proxy', () => {
            const revocable = Proxy.revocable(createWire(), {});
            revocable.revoke();

            expect(() =>
                parseTranslationResponseMessage(
                    revocable.proxy,
                    createTranslationRequestWire()
                )
            ).not.toThrow();
            expect(
                parseTranslationResponseMessage(
                    revocable.proxy,
                    createTranslationRequestWire()
                )
            ).toBeNull();
        });

        test('accepts a faithful transparent proxy but returns a detached snapshot', () => {
            const rawResponse = createWire();
            const proxy = new Proxy(rawResponse, {});

            const parsed = parseTranslationResponseMessage(
                proxy,
                createTranslationRequestWire()
            );

            expect(parsed.status).toBe(status);
            expect(parsed).not.toBe(rawResponse);
            expect(parsed).not.toBe(proxy);
            expect(Object.isFrozen(parsed)).toBe(true);

            const mutableKey = status === 'success' ? 'cached' : 'retryable';
            rawResponse[mutableKey] = !rawResponse[mutableKey];
            expect(parsed[mutableKey]).not.toBe(rawResponse[mutableKey]);
        });
    });

    describe.each([
        [
            'success',
            () => ({
                translatedText: 'Translated subtitle',
                cached: false,
                processingTime: 9,
            }),
            (input) =>
                buildTranslationSuccessResponse(
                    createTranslationRequestWire(),
                    input
                ),
            ['translatedText', 'cached', 'processingTime'],
        ],
        [
            'failure',
            () => ({ retryable: false, retryAfter: null }),
            (input) =>
                buildTranslationFailureResponse(
                    createTranslationRequestWire(),
                    input
                ),
            ['retryable', 'retryAfter'],
        ],
    ])('%s response builder input', (_label, createInput, build, keys) => {
        test('accepts null-prototype input and returns a fresh frozen wire record', () => {
            const input = Object.assign(Object.create(null), createInput());

            const first = build(input);
            const second = build(input);

            expect(second).toEqual(first);
            expect(second).not.toBe(first);
            expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
            expect(Object.isFrozen(first)).toBe(true);
        });

        test.each(keys)('refuses input missing %s', (key) => {
            const input = createInput();
            delete input[key];

            expect(() => build(input)).toThrow(TypeError);
        });

        test.each(['extra', 'symbol', 'accessor', 'array', 'exotic'])(
            'refuses %s input',
            (variant) => {
                let input = createInput();
                let getterCalls = 0;
                if (variant === 'extra') input.extra = true;
                if (variant === 'symbol') input[Symbol('extra')] = true;
                if (variant === 'array') input = Object.assign([], input);
                if (variant === 'exotic') {
                    input = Object.assign(Object.create({}), input);
                }
                if (variant === 'accessor') {
                    const key = keys[0];
                    const originalValue = input[key];
                    Object.defineProperty(input, key, {
                        get() {
                            getterCalls += 1;
                            return originalValue;
                        },
                    });
                }

                expect(() => build(input)).toThrow(TypeError);
                expect(getterCalls).toBe(0);
            }
        );

        test('fails closed when an input descriptor trap throws', () => {
            const hostile = new Proxy(createInput(), {
                getOwnPropertyDescriptor() {
                    throw new Error('hostile builder-input trap');
                },
            });

            expect(() => build(hostile)).toThrow(TypeError);
        });

        test('fails closed for a revoked input proxy', () => {
            const revocable = Proxy.revocable(createInput(), {});
            revocable.revoke();

            expect(() => build(revocable.proxy)).toThrow(TypeError);
        });

        test('accepts a faithful transparent input proxy without retaining it', () => {
            const rawInput = createInput();
            const wire = build(new Proxy(rawInput, {}));
            const copiedValue = wire[keys[0]];

            rawInput[keys[0]] = null;
            expect(wire[keys[0]]).toBe(copiedValue);
            expect(Object.values(wire)).not.toContain(rawInput);
            expect(Object.isFrozen(wire)).toBe(true);
        });
    });

    test.each(['success', 'failure'])(
        'requires a valid expected request for %s builders and parsing',
        (variant) => {
            const invalidRequest = createTranslationRequestWire();
            invalidRequest.action = MessageActions.SIDEPANEL_REGISTER;
            const build =
                variant === 'success'
                    ? () =>
                          buildTranslationSuccessResponse(invalidRequest, {
                              translatedText: 'Translated subtitle',
                              cached: false,
                              processingTime: 9,
                          })
                    : () =>
                          buildTranslationFailureResponse(invalidRequest, {
                              retryable: false,
                              retryAfter: null,
                          });
            const response =
                variant === 'success'
                    ? createTranslationSuccessWire()
                    : createTranslationFailureWire();

            expect(build).toThrow(TypeError);
            expect(
                parseTranslationResponseMessage(response, invalidRequest)
            ).toBeNull();
        }
    );

    test('never reads or adopts unrelated thenables', () => {
        const expectedRequest = createTranslationRequestWire();
        const response = createTranslationSuccessWire();
        let thenReads = 0;
        Object.defineProperty(response, 'then', {
            get() {
                thenReads += 1;
                throw new Error('must not inspect unrelated thenables');
            },
        });

        expect(
            parseTranslationResponseMessage(response, expectedRequest)
        ).toBeNull();
        expect(thenReads).toBe(0);

        const thenableValue = {};
        Object.defineProperty(thenableValue, 'then', {
            get() {
                thenReads += 1;
                throw new Error('must not adopt required-field thenables');
            },
        });
        const requiredThenableResponse = createTranslationSuccessWire();
        requiredThenableResponse.translatedText = thenableValue;

        expect(
            parseTranslationResponseMessage(
                requiredThenableResponse,
                expectedRequest
            )
        ).toBeNull();
        expect(thenReads).toBe(0);
    });
});

describe('analyze-context request protocol', () => {
    const [cultural, historical, linguistic] = CONTEXT_TYPES;

    function createContentAnalyzeInput() {
        return {
            text: '  Subtitle text with retained spaces  ',
            contextTypes: [linguistic, cultural],
            language: ' auto ',
            targetLanguage: ' zh-CN ',
            platform: ' netflix ',
            requestId: ' content-request-1 ',
        };
    }

    function createSidePanelAnalyzeInput(contextTypes = [historical]) {
        return {
            text: 'Selected subtitle words',
            contextTypes,
            targetLanguage: 'en-US',
            requestId: 'sidepanel-request-1',
        };
    }

    function createContentAnalyzeWire() {
        return {
            action: MessageActions.ANALYZE_CONTEXT,
            ...createContentAnalyzeInput(),
        };
    }

    function createSidePanelAnalyzeWire(contextTypes = [historical]) {
        const message = {
            action: MessageActions.ANALYZE_CONTEXT,
            ...createSidePanelAnalyzeInput(contextTypes),
        };
        if (contextTypes.length === 1) {
            message.contextType = contextTypes[0];
        }
        return message;
    }

    function expectAnalyzeBuilderToReject(role, input) {
        expect(() => buildAnalyzeContextRequestMessage(role, input)).toThrow(
            TypeError
        );
    }

    function expectAnalyzeParserToReject(role, wire) {
        expect(() =>
            parseAnalyzeContextRequestMessage(wire, role)
        ).not.toThrow();
        expect(parseAnalyzeContextRequestMessage(wire, role)).toBeNull();
    }

    test('builds the exact frozen detached content request shape', () => {
        const input = createContentAnalyzeInput();

        const message = buildAnalyzeContextRequestMessage(
            MessageSenderRoles.CONTENT,
            input
        );

        expect(message).toEqual({
            action: MessageActions.ANALYZE_CONTEXT,
            text: '  Subtitle text with retained spaces  ',
            contextTypes: [linguistic, cultural],
            language: ' auto ',
            targetLanguage: ' zh-CN ',
            platform: ' netflix ',
            requestId: ' content-request-1 ',
        });
        expect(Object.keys(message)).toEqual([
            'action',
            'text',
            'contextTypes',
            'language',
            'targetLanguage',
            'platform',
            'requestId',
        ]);
        expect(Object.getPrototypeOf(message)).toBe(Object.prototype);
        expect(Object.isFrozen(message)).toBe(true);
        expect(Object.isFrozen(message.contextTypes)).toBe(true);
        expect(message.contextTypes).not.toBe(input.contextTypes);
        expect(message.platform).toBe(' netflix ');

        input.text = 'mutated';
        input.contextTypes[0] = historical;
        expect(message.text).toBe('  Subtitle text with retained spaces  ');
        expect(message.contextTypes).toEqual([linguistic, cultural]);
    });

    test('builds the exact side-panel single-type compatibility shape', () => {
        const input = createSidePanelAnalyzeInput([historical]);

        const message = buildAnalyzeContextRequestMessage(
            MessageSenderRoles.SIDEPANEL,
            input
        );

        expect(message).toEqual({
            action: MessageActions.ANALYZE_CONTEXT,
            text: 'Selected subtitle words',
            contextTypes: [historical],
            targetLanguage: 'en-US',
            requestId: 'sidepanel-request-1',
            contextType: historical,
        });
        expect(Object.keys(message)).toEqual([
            'action',
            'text',
            'contextTypes',
            'targetLanguage',
            'requestId',
            'contextType',
        ]);
        expect(Object.isFrozen(message)).toBe(true);
        expect(Object.isFrozen(message.contextTypes)).toBe(true);
        expect(message.contextTypes).not.toBe(input.contextTypes);
    });

    test('builds the exact side-panel multi-type shape without contextType', () => {
        const message = buildAnalyzeContextRequestMessage(
            MessageSenderRoles.SIDEPANEL,
            createSidePanelAnalyzeInput([cultural, linguistic])
        );

        expect(message).toEqual({
            action: MessageActions.ANALYZE_CONTEXT,
            text: 'Selected subtitle words',
            contextTypes: [cultural, linguistic],
            targetLanguage: 'en-US',
            requestId: 'sidepanel-request-1',
        });
        expect(Object.keys(message)).toEqual([
            'action',
            'text',
            'contextTypes',
            'targetLanguage',
            'requestId',
        ]);
        expect(Object.hasOwn(message, 'contextType')).toBe(false);
    });

    test.each([MessageSenderRoles.CONTENT, MessageSenderRoles.SIDEPANEL])(
        'never serializes role, source, or metadata for %s',
        (role) => {
            const input =
                role === MessageSenderRoles.CONTENT
                    ? createContentAnalyzeInput()
                    : createSidePanelAnalyzeInput();

            const message = buildAnalyzeContextRequestMessage(role, input);

            expect(Object.hasOwn(message, 'role')).toBe(false);
            expect(Object.hasOwn(message, 'source')).toBe(false);
            expect(Object.hasOwn(message, 'metadata')).toBe(false);
        }
    );

    test('filters unsupported builder entries and deduplicates in input order', () => {
        const input = createSidePanelAnalyzeInput([
            'unsupported',
            linguistic,
            7,
            cultural,
            linguistic,
            null,
            historical,
            cultural,
        ]);

        const message = buildAnalyzeContextRequestMessage(
            MessageSenderRoles.SIDEPANEL,
            input
        );

        expect(message.contextTypes).toEqual([
            linguistic,
            cultural,
            historical,
        ]);
        expect(Object.hasOwn(message, 'contextType')).toBe(false);
        expect(Object.isFrozen(message.contextTypes)).toBe(true);
    });

    test('derives contextType after filtering to one supported type', () => {
        const message = buildAnalyzeContextRequestMessage(
            MessageSenderRoles.SIDEPANEL,
            createSidePanelAnalyzeInput([
                'unsupported',
                cultural,
                cultural,
                false,
            ])
        );

        expect(message.contextTypes).toEqual([cultural]);
        expect(message.contextType).toBe(cultural);
    });

    test.each([
        ['empty', []],
        ['all unsupported', ['unsupported', 1, null]],
        ['non-array string', cultural],
        ['non-array object', { 0: cultural, length: 1 }],
    ])('rejects %s builder contextTypes', (_label, contextTypes) => {
        expect(() =>
            buildAnalyzeContextRequestMessage(
                MessageSenderRoles.SIDEPANEL,
                createSidePanelAnalyzeInput(contextTypes)
            )
        ).toThrow(TypeError);
    });

    test('parses content and side-panel requests into frozen detached records', () => {
        const contentWire = createContentAnalyzeWire();
        const sidePanelWire = createSidePanelAnalyzeWire([
            linguistic,
            historical,
        ]);

        const content = parseAnalyzeContextRequestMessage(
            contentWire,
            MessageSenderRoles.CONTENT
        );
        const sidePanel = parseAnalyzeContextRequestMessage(
            sidePanelWire,
            MessageSenderRoles.SIDEPANEL
        );

        expect(content).toEqual(contentWire);
        expect(sidePanel).toEqual(sidePanelWire);
        for (const [parsed, wire] of [
            [content, contentWire],
            [sidePanel, sidePanelWire],
        ]) {
            expect(parsed).not.toBe(wire);
            expect(parsed.contextTypes).not.toBe(wire.contextTypes);
            expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
            expect(Object.isFrozen(parsed)).toBe(true);
            expect(Object.isFrozen(parsed.contextTypes)).toBe(true);
        }

        contentWire.text = 'mutated';
        contentWire.contextTypes[0] = cultural;
        expect(content.text).toBe('  Subtitle text with retained spaces  ');
        expect(content.contextTypes).toEqual([linguistic, cultural]);
    });

    test.each([MessageSenderRoles.CONTENT, MessageSenderRoles.SIDEPANEL])(
        'returns fresh object and array identities for repeated %s calls',
        (role) => {
            const input =
                role === MessageSenderRoles.CONTENT
                    ? createContentAnalyzeInput()
                    : createSidePanelAnalyzeInput([cultural]);
            const wire =
                role === MessageSenderRoles.CONTENT
                    ? createContentAnalyzeWire()
                    : createSidePanelAnalyzeWire([cultural]);

            const firstBuild = buildAnalyzeContextRequestMessage(role, input);
            const secondBuild = buildAnalyzeContextRequestMessage(role, input);
            const firstParse = parseAnalyzeContextRequestMessage(wire, role);
            const secondParse = parseAnalyzeContextRequestMessage(wire, role);

            expect(secondBuild).toEqual(firstBuild);
            expect(secondBuild).not.toBe(firstBuild);
            expect(secondBuild.contextTypes).not.toBe(firstBuild.contextTypes);
            expect(secondParse).toEqual(firstParse);
            expect(secondParse).not.toBe(firstParse);
            expect(secondParse.contextTypes).not.toBe(firstParse.contextTypes);
        }
    );

    test('rejects cross-role request shapes', () => {
        expect(
            parseAnalyzeContextRequestMessage(
                createContentAnalyzeWire(),
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
        expect(
            parseAnalyzeContextRequestMessage(
                createSidePanelAnalyzeWire(),
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
    });

    test.each([
        MessageSenderRoles.BACKGROUND,
        MessageSenderRoles.OPTIONS,
        'CONTENT',
        '',
        null,
        undefined,
    ])('rejects the unsupported sender role %p', (role) => {
        expect(() =>
            buildAnalyzeContextRequestMessage(role, createContentAnalyzeInput())
        ).toThrow(TypeError);
        expect(
            parseAnalyzeContextRequestMessage(createContentAnalyzeWire(), role)
        ).toBeNull();
    });

    test('requires exact single-type contextType equality', () => {
        const missing = createSidePanelAnalyzeWire([cultural]);
        delete missing.contextType;
        const mismatched = createSidePanelAnalyzeWire([cultural]);
        mismatched.contextType = historical;

        expect(
            parseAnalyzeContextRequestMessage(
                missing,
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
        expect(
            parseAnalyzeContextRequestMessage(
                mismatched,
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
    });

    test('forbids contextType on multi-type side-panel requests', () => {
        const message = createSidePanelAnalyzeWire([cultural, historical]);
        message.contextType = cultural;

        expect(
            parseAnalyzeContextRequestMessage(
                message,
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
    });

    test.each([
        ['unsupported', [cultural, 'unsupported']],
        ['duplicate', [cultural, cultural]],
        ['non-string', [cultural, 1]],
        ['empty', []],
        ['non-array', cultural],
    ])('strictly rejects a %s parser contextTypes value', (_label, value) => {
        const message = createSidePanelAnalyzeWire([cultural, historical]);
        message.contextTypes = value;
        delete message.contextType;

        expect(
            parseAnalyzeContextRequestMessage(
                message,
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
    });

    test.each([
        [
            'sparse array',
            () => {
                const value = new Array(2);
                value[1] = cultural;
                return value;
            },
        ],
        [
            'symbol-key array',
            () => {
                const value = [cultural];
                value[Symbol('extra')] = true;
                return value;
            },
        ],
        [
            'enumerable extra-key array',
            () => {
                const value = [cultural];
                value.extra = true;
                return value;
            },
        ],
        [
            'non-enumerable extra-key array',
            () => {
                const value = [cultural];
                Object.defineProperty(value, 'extra', { value: true });
                return value;
            },
        ],
        [
            'exotic-prototype array',
            () => Object.setPrototypeOf([cultural], null),
        ],
        [
            'array subclass',
            () => {
                class ContextTypesArray extends Array {}
                return new ContextTypesArray(cultural);
            },
        ],
    ])('rejects a structurally invalid %s', (_label, createValue) => {
        const builderInput = createSidePanelAnalyzeInput(createValue());
        const wire = createSidePanelAnalyzeWire([cultural]);
        wire.contextTypes = createValue();

        expect(() =>
            buildAnalyzeContextRequestMessage(
                MessageSenderRoles.SIDEPANEL,
                builderInput
            )
        ).toThrow(TypeError);
        expect(
            parseAnalyzeContextRequestMessage(
                wire,
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
    });

    test('rejects a contextTypes element accessor without invoking it', () => {
        let getterCalls = 0;
        const contextTypes = [cultural];
        Object.defineProperty(contextTypes, 0, {
            configurable: true,
            enumerable: true,
            get() {
                getterCalls += 1;
                return cultural;
            },
        });
        const input = createSidePanelAnalyzeInput(contextTypes);
        const wire = createSidePanelAnalyzeWire([cultural]);
        wire.contextTypes = contextTypes;

        expect(() =>
            buildAnalyzeContextRequestMessage(
                MessageSenderRoles.SIDEPANEL,
                input
            )
        ).toThrow(TypeError);
        expect(
            parseAnalyzeContextRequestMessage(
                wire,
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
        expect(getterCalls).toBe(0);
    });

    test.each([
        [MessageSenderRoles.CONTENT, createContentAnalyzeInput],
        [MessageSenderRoles.SIDEPANEL, createSidePanelAnalyzeInput],
    ])('requires exact builder keys for %s', (role, createInput) => {
        const base = createInput();
        for (const key of Object.keys(base)) {
            const missing = createInput();
            delete missing[key];
            expectAnalyzeBuilderToReject(role, missing);
        }

        for (const extraKey of [
            'action',
            'contextType',
            'role',
            'source',
            'metadata',
            'extra',
        ]) {
            const extra = createInput();
            extra[extraKey] = true;
            expectAnalyzeBuilderToReject(role, extra);
        }

        const symbolKeyed = createInput();
        symbolKeyed[Symbol('extra')] = true;
        expectAnalyzeBuilderToReject(role, symbolKeyed);

        const nonPlain = Object.assign(
            Object.create({ inherited: true }),
            createInput()
        );
        expectAnalyzeBuilderToReject(role, nonPlain);
    });

    test.each([
        [MessageSenderRoles.CONTENT, createContentAnalyzeWire],
        [MessageSenderRoles.SIDEPANEL, createSidePanelAnalyzeWire],
    ])('requires exact own data wire keys for %s', (role, createWire) => {
        const base = createWire();
        for (const key of Object.keys(base)) {
            const missing = createWire();
            delete missing[key];
            expect(parseAnalyzeContextRequestMessage(missing, role)).toBeNull();
        }

        for (const extraKey of ['role', 'source', 'metadata', 'extra']) {
            const extra = createWire();
            extra[extraKey] = true;
            expect(parseAnalyzeContextRequestMessage(extra, role)).toBeNull();
        }

        const symbolKeyed = createWire();
        symbolKeyed[Symbol('extra')] = true;
        expect(parseAnalyzeContextRequestMessage(symbolKeyed, role)).toBeNull();

        const nonPlain = Object.assign(
            Object.create({ inherited: true }),
            createWire()
        );
        expect(parseAnalyzeContextRequestMessage(nonPlain, role)).toBeNull();
    });

    test.each([
        [MessageSenderRoles.CONTENT, createContentAnalyzeInput],
        [MessageSenderRoles.SIDEPANEL, createSidePanelAnalyzeInput],
    ])('rejects a %s builder accessor', (role, createInput) => {
        const input = createInput();
        let getterCalls = 0;
        Object.defineProperty(input, 'text', {
            configurable: true,
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'Selected text';
            },
        });

        expect(() => buildAnalyzeContextRequestMessage(role, input)).toThrow(
            TypeError
        );
        expect(getterCalls).toBe(0);
    });

    test.each([
        [MessageSenderRoles.CONTENT, createContentAnalyzeWire],
        [MessageSenderRoles.SIDEPANEL, createSidePanelAnalyzeWire],
    ])('rejects a %s wire accessor without invoking it', (role, createWire) => {
        const wire = createWire();
        let getterCalls = 0;
        Object.defineProperty(wire, 'text', {
            configurable: true,
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'Selected text';
            },
        });

        expect(parseAnalyzeContextRequestMessage(wire, role)).toBeNull();
        expect(getterCalls).toBe(0);
    });

    test.each([
        [MessageSenderRoles.CONTENT, 'text'],
        [MessageSenderRoles.CONTENT, 'language'],
        [MessageSenderRoles.CONTENT, 'targetLanguage'],
        [MessageSenderRoles.CONTENT, 'platform'],
        [MessageSenderRoles.CONTENT, 'requestId'],
        [MessageSenderRoles.SIDEPANEL, 'text'],
        [MessageSenderRoles.SIDEPANEL, 'targetLanguage'],
        [MessageSenderRoles.SIDEPANEL, 'requestId'],
    ])('rejects invalid %s %s string values', (role, key) => {
        for (const invalidValue of ['', '   ', null, 1, true]) {
            const input =
                role === MessageSenderRoles.CONTENT
                    ? createContentAnalyzeInput()
                    : createSidePanelAnalyzeInput();
            input[key] = invalidValue;
            expect(() =>
                buildAnalyzeContextRequestMessage(role, input)
            ).toThrow(TypeError);

            const wire =
                role === MessageSenderRoles.CONTENT
                    ? createContentAnalyzeWire()
                    : createSidePanelAnalyzeWire();
            wire[key] = invalidValue;
            expect(parseAnalyzeContextRequestMessage(wire, role)).toBeNull();
        }
    });

    test.each([
        [MessageSenderRoles.CONTENT, createContentAnalyzeWire],
        [MessageSenderRoles.SIDEPANEL, createSidePanelAnalyzeWire],
    ])('requires the exact analyze action for %s', (role, createWire) => {
        for (const action of [
            MessageActions.TRANSLATE,
            'ANALYZE_CONTEXT',
            '',
            null,
        ]) {
            const wire = createWire();
            wire.action = action;
            expect(parseAnalyzeContextRequestMessage(wire, role)).toBeNull();
        }
    });

    test.each([
        [MessageSenderRoles.CONTENT, createContentAnalyzeInput],
        [MessageSenderRoles.SIDEPANEL, createSidePanelAnalyzeInput],
    ])('contains hostile %s builder inputs', (role, createInput) => {
        const revokedRecord = Proxy.revocable(createInput(), {});
        revokedRecord.revoke();
        expectAnalyzeBuilderToReject(role, revokedRecord.proxy);

        const throwingRecord = new Proxy(createInput(), {
            ownKeys() {
                throw new Error('hostile input ownKeys trap');
            },
        });
        expectAnalyzeBuilderToReject(role, throwingRecord);

        const revokedArray = Proxy.revocable([cultural], {});
        revokedArray.revoke();
        const arrayInput = createInput();
        arrayInput.contextTypes = revokedArray.proxy;
        expectAnalyzeBuilderToReject(role, arrayInput);
    });

    test.each([
        [MessageSenderRoles.CONTENT, createContentAnalyzeWire],
        [MessageSenderRoles.SIDEPANEL, createSidePanelAnalyzeWire],
    ])('contains hostile %s parser inputs', (role, createWire) => {
        const revokedRecord = Proxy.revocable(createWire(), {});
        revokedRecord.revoke();
        expectAnalyzeParserToReject(role, revokedRecord.proxy);

        const throwingRecord = new Proxy(createWire(), {
            getPrototypeOf() {
                throw new Error('hostile wire prototype trap');
            },
        });
        expectAnalyzeParserToReject(role, throwingRecord);

        const revokedArray = Proxy.revocable([cultural], {});
        revokedArray.revoke();
        const arrayWire = createWire();
        arrayWire.contextTypes = revokedArray.proxy;
        expectAnalyzeParserToReject(role, arrayWire);
    });
});

describe('analyze-context response protocol', () => {
    const [cultural, historical, linguistic] = CONTEXT_TYPES;
    const analyzeRoles = [
        MessageSenderRoles.CONTENT,
        MessageSenderRoles.SIDEPANEL,
    ];

    function createExpectedRequest(
        role,
        contextTypes = [cultural],
        requestId = 'analysis-request-1'
    ) {
        if (role === MessageSenderRoles.CONTENT) {
            return buildAnalyzeContextRequestMessage(role, {
                text: 'Subtitle text',
                contextTypes,
                language: 'auto',
                targetLanguage: 'en',
                platform: 'netflix',
                requestId,
            });
        }
        return buildAnalyzeContextRequestMessage(role, {
            text: 'Selected words',
            contextTypes,
            targetLanguage: 'en',
            requestId,
        });
    }

    function createAnalysis() {
        return {
            summary: 'Contextual analysis',
            details: { confidence: 0.9, tags: ['safe'] },
        };
    }

    function createSuccessWire(
        role = MessageSenderRoles.CONTENT,
        contextTypes = [cultural],
        analysis = createAnalysis()
    ) {
        const request = createExpectedRequest(role, contextTypes);
        const response = buildAnalyzeContextSuccessResponse(role, request, {
            analysis,
        });
        return { request, response };
    }

    function createMutableSuccessWire(role, contextTypes, analysis) {
        const { request, response } = createSuccessWire(
            role,
            contextTypes,
            analysis
        );
        return {
            request,
            wire: {
                success: response.success,
                result: {
                    analysis: response.result.analysis,
                    contextType: response.result.contextType,
                    contextTypes: [...response.result.contextTypes],
                    isStructured: response.result.isStructured,
                },
                requestId: response.requestId,
            },
        };
    }

    function createFailureWire(role = MessageSenderRoles.CONTENT) {
        const request = createExpectedRequest(role);
        const response = buildAnalyzeContextFailureResponse(role, request, {
            error: 'Analysis failed',
            shouldRetry: true,
        });
        return { request, wire: { ...response } };
    }

    function createNestedAnalysis(depth) {
        let value = 'leaf';
        for (let index = 0; index < depth; index += 1) {
            value = { next: value };
        }
        return value;
    }

    function createEntryAnalysis(count) {
        const analysis = {};
        for (let index = 0; index < count; index += 1) {
            analysis[`k${index}`] = true;
        }
        return analysis;
    }

    test.each(analyzeRoles)('builds exact frozen %s success', (role) => {
        const analysis = createAnalysis();
        const request = createExpectedRequest(role, [historical]);

        const response = buildAnalyzeContextSuccessResponse(role, request, {
            analysis,
        });

        expect(response).toEqual({
            success: true,
            result: {
                analysis: createAnalysis(),
                contextType: historical,
                contextTypes: [historical],
                isStructured: true,
            },
            requestId: 'analysis-request-1',
        });
        expect(Reflect.ownKeys(response)).toEqual([
            'success',
            'result',
            'requestId',
        ]);
        expect(Reflect.ownKeys(response.result)).toEqual([
            'analysis',
            'contextType',
            'contextTypes',
            'isStructured',
        ]);
        expect(response.result.analysis).not.toBe(analysis);
        expect(response.result.analysis.details).not.toBe(analysis.details);
        expect(response.result.contextTypes).not.toBe(request.contextTypes);
        expect(Object.isFrozen(response)).toBe(true);
        expect(Object.isFrozen(response.result)).toBe(true);
        expect(Object.isFrozen(response.result.analysis)).toBe(true);
        expect(Object.isFrozen(response.result.analysis.details)).toBe(true);
        expect(Object.isFrozen(response.result.analysis.details.tags)).toBe(
            true
        );
        expect(Object.isFrozen(response.result.contextTypes)).toBe(true);

        analysis.summary = 'mutated';
        analysis.details.tags[0] = 'mutated';
        expect(response.result.analysis).toEqual(createAnalysis());
    });

    test.each([
        [[cultural], cultural],
        [[linguistic, cultural], 'combined'],
        [[linguistic, cultural, historical], 'all'],
    ])('derives %p without reordering', (types, expectedType) => {
        const request = createExpectedRequest(
            MessageSenderRoles.SIDEPANEL,
            types
        );
        const response = buildAnalyzeContextSuccessResponse(
            MessageSenderRoles.SIDEPANEL,
            request,
            { analysis: createAnalysis() }
        );

        expect(response.result.contextType).toBe(expectedType);
        expect(response.result.contextTypes).toEqual(types);
    });

    test.each(analyzeRoles)('builds exact frozen %s failure', (role) => {
        const request = createExpectedRequest(role);
        const response = buildAnalyzeContextFailureResponse(role, request, {
            error: 'é'.repeat(256),
            shouldRetry: false,
        });

        expect(response).toEqual({
            success: false,
            error: 'é'.repeat(256),
            shouldRetry: false,
            requestId: 'analysis-request-1',
        });
        expect(Reflect.ownKeys(response)).toEqual([
            'success',
            'error',
            'shouldRetry',
            'requestId',
        ]);
        expect(Object.isFrozen(response)).toBe(true);
    });

    test('uses the reachable 64 KiB record boundaries', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);
        const aboveDefault = { payload: 'a'.repeat(16385) };
        const exactTotal = { '': 'a'.repeat(65534) };

        const first = buildAnalyzeContextSuccessResponse(
            MessageSenderRoles.CONTENT,
            request,
            { analysis: aboveDefault }
        );
        const boundary = buildAnalyzeContextSuccessResponse(
            MessageSenderRoles.CONTENT,
            request,
            { analysis: exactTotal }
        );

        expect(first.result.analysis.payload).toHaveLength(16385);
        expect(boundary.result.analysis['']).toHaveLength(65534);
        expect(() =>
            buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.CONTENT,
                request,
                { analysis: { '': 'a'.repeat(65535) } }
            )
        ).toThrow(TypeError);
        expect(() =>
            buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.CONTENT,
                request,
                { analysis: { payload: 'a'.repeat(65537) } }
            )
        ).toThrow(TypeError);
    });

    test('enforces the analysis depth and entry profile', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);

        for (const [analysis, shouldThrow] of [
            [createNestedAnalysis(9), false],
            [createNestedAnalysis(10), true],
            [createEntryAnalysis(256), false],
            [createEntryAnalysis(257), true],
        ]) {
            const build = () =>
                buildAnalyzeContextSuccessResponse(
                    MessageSenderRoles.CONTENT,
                    request,
                    { analysis }
                );
            if (shouldThrow) expect(build).toThrow(TypeError);
            else expect(build).not.toThrow();
        }
    });

    test('parses success into a fresh deeply frozen local result', () => {
        const analysis = createAnalysis();
        const { request, wire } = createMutableSuccessWire(
            MessageSenderRoles.CONTENT,
            [linguistic, historical],
            analysis
        );
        wire.result.analysis = analysis;

        const parsed = parseAnalyzeContextResponseMessage(
            wire,
            request,
            MessageSenderRoles.CONTENT
        );
        const second = parseAnalyzeContextResponseMessage(
            wire,
            request,
            MessageSenderRoles.CONTENT
        );

        expect(parsed).toEqual({
            status: 'success',
            requestId: 'analysis-request-1',
            result: {
                analysis: createAnalysis(),
                contextType: 'combined',
                contextTypes: [linguistic, historical],
                isStructured: true,
            },
        });
        expect(Reflect.ownKeys(parsed)).toEqual([
            'status',
            'requestId',
            'result',
        ]);
        expect(parsed).not.toBe(second);
        expect(parsed.result).not.toBe(second.result);
        expect(parsed.result.analysis).not.toBe(analysis);
        expect(parsed.result.contextTypes).not.toBe(wire.result.contextTypes);
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.result)).toBe(true);
        expect(Object.isFrozen(parsed.result.analysis)).toBe(true);
        expect(Object.isFrozen(parsed.result.contextTypes)).toBe(true);

        analysis.details.tags[0] = 'mutated';
        wire.result.contextTypes[0] = cultural;
        expect(parsed.result.analysis.details.tags).toEqual(['safe']);
        expect(parsed.result.contextTypes).toEqual([linguistic, historical]);
    });

    test('parses failure into an exact frozen local result', () => {
        const { request, wire } = createFailureWire(
            MessageSenderRoles.SIDEPANEL
        );

        const parsed = parseAnalyzeContextResponseMessage(
            wire,
            request,
            MessageSenderRoles.SIDEPANEL
        );

        expect(parsed).toEqual({
            status: 'failure',
            requestId: 'analysis-request-1',
            error: 'Analysis failed',
            shouldRetry: true,
        });
        expect(Reflect.ownKeys(parsed)).toEqual([
            'status',
            'requestId',
            'error',
            'shouldRetry',
        ]);
        expect(Object.isFrozen(parsed)).toBe(true);
    });

    test.each([
        ['requestId', (wire) => (wire.requestId = 'wrong-request')],
        ['contextType', (wire) => (wire.result.contextType = historical)],
        ['contextTypes order', (wire) => wire.result.contextTypes.reverse()],
        ['isStructured', (wire) => (wire.result.isStructured = false)],
        ['success flag', (wire) => (wire.success = false)],
        ['outer extra', (wire) => (wire.extra = true)],
        ['result extra', (wire) => (wire.result.extra = true)],
        ['missing result key', (wire) => delete wire.result.analysis],
    ])('rejects invalid success %s', (_label, mutateWire) => {
        const { request, wire } = createMutableSuccessWire(
            MessageSenderRoles.CONTENT,
            [cultural, linguistic]
        );
        mutateWire(wire);

        expect(
            parseAnalyzeContextResponseMessage(
                wire,
                request,
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
    });

    test.each([
        ['requestId', (wire) => (wire.requestId = 'wrong-request')],
        ['error', (wire) => (wire.error = ' Analysis failed')],
        ['shouldRetry', (wire) => (wire.shouldRetry = 1)],
        ['success flag', (wire) => (wire.success = true)],
        ['extra', (wire) => (wire.extra = true)],
        ['missing', (wire) => delete wire.error],
    ])('rejects a failure with invalid %s', (_label, mutateWire) => {
        const { request, wire } = createFailureWire();
        mutateWire(wire);

        expect(
            parseAnalyzeContextResponseMessage(
                wire,
                request,
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
    });

    test('rejects role mismatch and success/failure cross-shapes', () => {
        const { request, wire } = createMutableSuccessWire(
            MessageSenderRoles.CONTENT,
            [cultural]
        );
        const failure = createFailureWire().wire;
        failure.result = wire.result;

        expect(
            parseAnalyzeContextResponseMessage(
                wire,
                request,
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
        expect(
            parseAnalyzeContextResponseMessage(
                failure,
                request,
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
    });

    test('requires exact success and failure builder inputs', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);
        const analysis = createAnalysis();
        let getterCalls = 0;
        const accessor = {};
        Object.defineProperty(accessor, 'analysis', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return analysis;
            },
        });
        const nonEnumerable = {};
        Object.defineProperty(nonEnumerable, 'analysis', {
            value: analysis,
        });

        for (const input of [
            {},
            { analysis, extra: true },
            Object.assign(Object.create({}), { analysis }),
            accessor,
            nonEnumerable,
        ]) {
            expect(() =>
                buildAnalyzeContextSuccessResponse(
                    MessageSenderRoles.CONTENT,
                    request,
                    input
                )
            ).toThrow(TypeError);
        }
        const symbolInput = { analysis };
        symbolInput[Symbol('extra')] = true;
        expect(() =>
            buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.CONTENT,
                request,
                symbolInput
            )
        ).toThrow(TypeError);

        for (const failure of [
            {},
            { error: 'Failed', shouldRetry: false, extra: true },
            { error: '', shouldRetry: false },
            { error: ' Failed', shouldRetry: false },
            { error: 'Failed ', shouldRetry: false },
            { error: String.fromCharCode(0xd800), shouldRetry: false },
            { error: 'a'.repeat(513), shouldRetry: false },
            { error: 'é'.repeat(257), shouldRetry: false },
            { error: 'Failed', shouldRetry: 0 },
        ]) {
            expect(() =>
                buildAnalyzeContextFailureResponse(
                    MessageSenderRoles.CONTENT,
                    request,
                    failure
                )
            ).toThrow(TypeError);
        }
        expect(getterCalls).toBe(0);
    });

    test('rejects hostile failure inputs without invoking accessors', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);
        let getterCalls = 0;
        const accessor = { shouldRetry: false };
        Object.defineProperty(accessor, 'error', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'Failed';
            },
        });
        const nonEnumerable = { shouldRetry: false };
        Object.defineProperty(nonEnumerable, 'error', { value: 'Failed' });
        const symbolInput = { error: 'Failed', shouldRetry: false };
        symbolInput[Symbol('extra')] = true;

        for (const failure of [
            accessor,
            nonEnumerable,
            symbolInput,
            Object.assign(Object.create({}), {
                error: 'Failed',
                shouldRetry: false,
            }),
        ]) {
            expect(() =>
                buildAnalyzeContextFailureResponse(
                    MessageSenderRoles.CONTENT,
                    request,
                    failure
                )
            ).toThrow(TypeError);
        }
        expect(getterCalls).toBe(0);
    });

    test('accepts and preserves null-prototype analysis snapshots', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);
        const analysis = Object.assign(Object.create(null), {
            fact: 'value',
        });

        const response = buildAnalyzeContextSuccessResponse(
            MessageSenderRoles.CONTENT,
            request,
            { analysis }
        );
        const parsed = parseAnalyzeContextResponseMessage(
            response,
            request,
            MessageSenderRoles.CONTENT
        );

        expect(Object.getPrototypeOf(response.result.analysis)).toBeNull();
        expect(Object.getPrototypeOf(parsed.result.analysis)).toBeNull();
        expect(parsed.result.analysis.fact).toBe('value');
        expect(Object.isFrozen(parsed.result.analysis)).toBe(true);
    });

    test('rejects hostile response records without accessors', () => {
        const createWire = () =>
            createMutableSuccessWire(MessageSenderRoles.CONTENT, [cultural]);
        let getterCalls = 0;

        const outerAccessor = createWire();
        Object.defineProperty(outerAccessor.wire, 'requestId', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'analysis-request-1';
            },
        });
        const resultAccessor = createWire();
        Object.defineProperty(resultAccessor.wire.result, 'contextType', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return cultural;
            },
        });
        const outerSymbol = createWire();
        outerSymbol.wire[Symbol('extra')] = true;
        const resultSymbol = createWire();
        resultSymbol.wire.result[Symbol('extra')] = true;
        const outerExotic = createWire();
        Object.setPrototypeOf(outerExotic.wire, { inherited: true });
        const resultExotic = createWire();
        Object.setPrototypeOf(resultExotic.wire.result, { inherited: true });
        const outerNonEnumerable = createWire();
        Object.defineProperty(outerNonEnumerable.wire, 'requestId', {
            enumerable: false,
            value: 'analysis-request-1',
        });

        for (const { request, wire } of [
            outerAccessor,
            resultAccessor,
            outerSymbol,
            resultSymbol,
            outerExotic,
            resultExotic,
            outerNonEnumerable,
        ]) {
            expect(
                parseAnalyzeContextResponseMessage(
                    wire,
                    request,
                    MessageSenderRoles.CONTENT
                )
            ).toBeNull();
        }
        expect(getterCalls).toBe(0);
    });

    test('requires a role-matched valid expected request', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);

        expect(() =>
            buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.SIDEPANEL,
                request,
                { analysis: createAnalysis() }
            )
        ).toThrow(TypeError);
        expect(() =>
            buildAnalyzeContextFailureResponse(
                MessageSenderRoles.SIDEPANEL,
                request,
                { error: 'Failed', shouldRetry: false }
            )
        ).toThrow(TypeError);
    });

    test.each([
        null,
        [],
        'analysis',
        new Date(0),
        Object.create({ inherited: true }),
    ])('rejects non-record analysis %p', (analysis) => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);

        expect(() =>
            buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.CONTENT,
                request,
                { analysis }
            )
        ).toThrow(TypeError);
    });

    test('rejects analysis accessors', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);
        let getterCalls = 0;
        const analysis = {};
        Object.defineProperty(analysis, 'secret', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'secret';
            },
        });

        expect(() =>
            buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.CONTENT,
                request,
                { analysis }
            )
        ).toThrow(TypeError);
        expect(getterCalls).toBe(0);

        const { wire } = createMutableSuccessWire(MessageSenderRoles.CONTENT, [
            cultural,
        ]);
        wire.result.analysis = analysis;
        expect(
            parseAnalyzeContextResponseMessage(
                wire,
                request,
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
        expect(getterCalls).toBe(0);
    });

    test('contains response proxy traps', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);
        const revoked = Proxy.revocable(
            createMutableSuccessWire(MessageSenderRoles.CONTENT, [cultural])
                .wire,
            {}
        );
        revoked.revoke();
        const throwing = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error('hostile response trap');
                },
            }
        );

        for (const message of [revoked.proxy, throwing]) {
            expect(() =>
                parseAnalyzeContextResponseMessage(
                    message,
                    request,
                    MessageSenderRoles.CONTENT
                )
            ).not.toThrow();
            expect(
                parseAnalyzeContextResponseMessage(
                    message,
                    request,
                    MessageSenderRoles.CONTENT
                )
            ).toBeNull();
        }
    });

    test('accepts a transparent analysis proxy without retaining it', () => {
        const request = createExpectedRequest(MessageSenderRoles.CONTENT);
        const rawAnalysis = createAnalysis();
        const analysis = new Proxy(rawAnalysis, {});

        const response = buildAnalyzeContextSuccessResponse(
            MessageSenderRoles.CONTENT,
            request,
            { analysis }
        );

        expect(response.result.analysis).toEqual(createAnalysis());
        expect(response.result.analysis).not.toBe(rawAnalysis);
        rawAnalysis.summary = 'mutated';
        expect(response.result.analysis.summary).toBe('Contextual analysis');
    });
});

describe('extension message sender classification', () => {
    test('classifies the exact background sender into a frozen detached role', () => {
        const sender = {
            id: EXTENSION_ID,
            url: `${EXTENSION_ORIGIN}/background.js`,
            futureChromeField: { ignored: true },
        };

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(MessageSenderRoles).toEqual({
            BACKGROUND: 'background',
            CONTENT: 'content',
            OPTIONS: 'options',
            POPUP: 'popup',
            SIDEPANEL: 'sidepanel',
        });
        expect(Object.isFrozen(MessageSenderRoles)).toBe(true);
        expect(identity).toEqual({ role: MessageSenderRoles.BACKGROUND });
        expect(Object.keys(identity)).toEqual(['role']);
        expect(Object.isFrozen(identity)).toBe(true);

        sender.url = `${EXTENSION_ORIGIN}/popup/popup.html`;
        sender.futureChromeField.ignored = false;
        expect(identity).toEqual({ role: MessageSenderRoles.BACKGROUND });
    });

    test.each(
        [
            ['background.js', MessageSenderRoles.BACKGROUND],
            ['sidepanel/sidepanel.html', MessageSenderRoles.SIDEPANEL],
            ['popup/popup.html', MessageSenderRoles.POPUP],
            ['options/options.html', MessageSenderRoles.OPTIONS],
        ].flatMap(([path, role]) => [
            [path, 'absent', role, false],
            [path, 'null', role, true],
        ])
    )(
        'classifies the exact %s sender with a %s tab',
        (path, _tabLabel, role, includeNullTab) => {
            const sender = {
                id: EXTENSION_ID,
                origin: EXTENSION_ORIGIN,
                url: `${EXTENSION_ORIGIN}/${path}`,
            };
            if (includeNullTab) sender.tab = null;

            const identity = classifyExtensionMessageSender(
                sender,
                createRuntime()
            );

            expect(identity).toEqual({ role });
            expect(Object.keys(identity)).toEqual(['role']);
            expect(Object.isFrozen(identity)).toBe(true);
        }
    );

    test('classifies an exact options sender carried by its own extension tab', () => {
        const optionsUrl = `${EXTENSION_ORIGIN}/options/options.html`;
        const sender = {
            id: EXTENSION_ID,
            origin: EXTENSION_ORIGIN,
            tab: {
                active: false,
                futureChromeField: 'ignored',
                id: 71,
                url: optionsUrl,
                windowId: 9,
            },
            url: optionsUrl,
        };

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(identity).toEqual({ role: MessageSenderRoles.OPTIONS });
    });

    test.each([
        ['background.js', MessageSenderRoles.BACKGROUND],
        ['sidepanel/sidepanel.html', MessageSenderRoles.SIDEPANEL],
        ['popup/popup.html', MessageSenderRoles.POPUP],
    ])('rejects a non-null tab on the exact %s sender', (path, role) => {
        const sender = {
            id: EXTENSION_ID,
            tab: { url: `${EXTENSION_ORIGIN}/${path}` },
            url: `${EXTENSION_ORIGIN}/${path}`,
        };

        expect(role).toBeDefined();
        expect(
            classifyExtensionMessageSender(sender, createRuntime())
        ).toBeNull();
    });

    test.each([
        ['wrong extension id', { id: 'stale-extension-id' }],
        ['query drift', { url: `${EXTENSION_ORIGIN}/background.js?x=1` }],
        ['hash drift', { url: `${EXTENSION_ORIGIN}/background.js#x` }],
        ['generic extension page', { url: `${EXTENSION_ORIGIN}/other.html` }],
        ['foreign origin', { origin: 'chrome-extension://other-extension' }],
    ])('rejects an extension sender with %s', (_label, replacement) => {
        const sender = {
            id: EXTENSION_ID,
            origin: EXTENSION_ORIGIN,
            url: `${EXTENSION_ORIGIN}/background.js`,
            ...replacement,
        };

        expect(
            classifyExtensionMessageSender(sender, createRuntime())
        ).toBeNull();
    });

    test.each([
        ['missing', {}],
        ['inherited', Object.create({ id: EXTENSION_ID })],
    ])('rejects an extension sender with a %s id', (_label, senderBase) => {
        const sender = Object.assign(senderBase, {
            url: `${EXTENSION_ORIGIN}/background.js`,
        });

        expect(
            classifyExtensionMessageSender(sender, createRuntime())
        ).toBeNull();
    });

    test.each([
        ['missing', {}],
        [
            'inherited',
            Object.create({ url: `${EXTENSION_ORIGIN}/background.js` }),
        ],
    ])('rejects an extension sender with a %s url', (_label, senderBase) => {
        const sender = Object.assign(senderBase, { id: EXTENSION_ID });

        expect(
            classifyExtensionMessageSender(sender, createRuntime())
        ).toBeNull();
    });

    test.each(['id', 'url', 'origin'])(
        'rejects an own %s accessor without invoking it',
        (key) => {
            const sender = {
                id: EXTENSION_ID,
                origin: EXTENSION_ORIGIN,
                url: `${EXTENSION_ORIGIN}/background.js`,
            };
            let getterCalls = 0;
            Object.defineProperty(sender, key, {
                configurable: true,
                enumerable: true,
                get() {
                    getterCalls += 1;
                    return sender[key];
                },
            });

            expect(() =>
                classifyExtensionMessageSender(sender, createRuntime())
            ).not.toThrow();
            expect(
                classifyExtensionMessageSender(sender, createRuntime())
            ).toBeNull();
            expect(getterCalls).toBe(0);
        }
    );

    test.each([
        ['mismatched', { url: `${EXTENSION_ORIGIN}/popup/popup.html` }],
        [
            'inherited',
            Object.create({
                url: `${EXTENSION_ORIGIN}/options/options.html`,
            }),
        ],
    ])('rejects an options sender with a %s tab url', (_label, tab) => {
        const optionsUrl = `${EXTENSION_ORIGIN}/options/options.html`;

        expect(
            classifyExtensionMessageSender(
                {
                    id: EXTENSION_ID,
                    tab,
                    url: optionsUrl,
                },
                createRuntime()
            )
        ).toBeNull();
    });

    test('rejects an options tab url accessor without invoking it', () => {
        const optionsUrl = `${EXTENSION_ORIGIN}/options/options.html`;
        let getterCalls = 0;
        const tab = {};
        Object.defineProperty(tab, 'url', {
            get() {
                getterCalls += 1;
                return optionsUrl;
            },
        });

        expect(
            classifyExtensionMessageSender(
                { id: EXTENSION_ID, tab, url: optionsUrl },
                createRuntime()
            )
        ).toBeNull();
        expect(getterCalls).toBe(0);
    });

    test('ignores unrelated extension sender and options-tab accessors', () => {
        const optionsUrl = `${EXTENSION_ORIGIN}/options/options.html`;
        let getterCalls = 0;
        const sender = {
            id: EXTENSION_ID,
            tab: { url: optionsUrl },
            url: optionsUrl,
        };
        Object.defineProperty(sender, 'futureChromeField', {
            get() {
                getterCalls += 1;
                throw new Error('must not inspect unrelated sender fields');
            },
        });
        Object.defineProperty(sender.tab, 'futureChromeField', {
            get() {
                getterCalls += 1;
                throw new Error('must not inspect unrelated tab fields');
            },
        });

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(identity).toEqual({ role: MessageSenderRoles.OPTIONS });
        expect(getterCalls).toBe(0);
    });

    test('keeps extension-page roles lifecycle-independent', () => {
        const sender = {
            id: EXTENSION_ID,
            url: `${EXTENSION_ORIGIN}/background.js`,
        };
        let getterCalls = 0;
        Object.defineProperty(sender, 'documentLifecycle', {
            get() {
                getterCalls += 1;
                throw new Error('extension roles must not inspect lifecycle');
            },
        });

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(identity).toEqual({ role: MessageSenderRoles.BACKGROUND });
        expect(getterCalls).toBe(0);
    });

    test('classifies a top-frame active content sender into a frozen detached identity', () => {
        const senderUrl = 'https://www.netflix.com/watch/80123456';
        const tabUrl = 'https://www.netflix.com/watch/80123456?track=from-tab';
        const sender = {
            documentId: 'document-1',
            documentLifecycle: 'active',
            frameId: 0,
            futureChromeField: { ignored: true },
            id: EXTENSION_ID,
            origin: 'https://www.netflix.com',
            tab: {
                active: true,
                futureChromeField: { ignored: true },
                id: 0,
                url: tabUrl,
                windowId: 4,
            },
            url: senderUrl,
        };

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(identity).toEqual({
            role: MessageSenderRoles.CONTENT,
            platform: 'netflix',
            tabId: 0,
            windowId: 4,
            documentId: 'document-1',
            documentLifecycle: 'active',
            origin: 'https://www.netflix.com',
            senderUrl,
            tabUrl,
            frameId: 0,
        });
        expect(Object.keys(identity)).toEqual([
            'role',
            'platform',
            'tabId',
            'windowId',
            'documentId',
            'documentLifecycle',
            'origin',
            'senderUrl',
            'tabUrl',
            'frameId',
        ]);
        expect(Object.isFrozen(identity)).toBe(true);

        sender.documentId = 'mutated-document';
        sender.documentLifecycle = 'cached';
        sender.tab.url = 'https://example.com/';
        sender.futureChromeField.ignored = false;
        expect(identity).toEqual({
            role: MessageSenderRoles.CONTENT,
            platform: 'netflix',
            tabId: 0,
            windowId: 4,
            documentId: 'document-1',
            documentLifecycle: 'active',
            origin: 'https://www.netflix.com',
            senderUrl,
            tabUrl,
            frameId: 0,
        });
    });

    test.each([
        ['absent', false],
        ['null', true],
    ])(
        'classifies a Disney+ content sender with %s optional origin',
        (_label, includeNullOrigin) => {
            const sender = createContentSender();
            sender.tab.id = 8;
            sender.tab.url = 'https://www.disneyplus.com/video/abc?tab=1';
            sender.tab.windowId = 0;
            sender.url = 'https://www.disneyplus.com/browse?sender=1';
            if (includeNullOrigin) sender.origin = null;
            else delete sender.origin;

            expect(
                classifyExtensionMessageSender(sender, createRuntime())
            ).toEqual({
                role: MessageSenderRoles.CONTENT,
                platform: 'disneyplus',
                tabId: 8,
                windowId: 0,
                documentId: 'document-1',
                documentLifecycle: 'active',
                origin: 'https://www.disneyplus.com',
                senderUrl: 'https://www.disneyplus.com/browse?sender=1',
                tabUrl: 'https://www.disneyplus.com/video/abc?tab=1',
                frameId: 0,
            });
        }
    );

    test('accepts the exact platform hostname', () => {
        const sender = createContentSender();
        sender.origin = 'https://netflix.com';
        sender.url = 'https://netflix.com/browse';
        sender.tab.url = 'https://netflix.com/watch/1';

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(identity).toEqual({
            role: MessageSenderRoles.CONTENT,
            platform: 'netflix',
            tabId: 7,
            windowId: 3,
            documentId: 'document-1',
            documentLifecycle: 'active',
            origin: 'https://netflix.com',
            senderUrl: 'https://netflix.com/browse',
            tabUrl: 'https://netflix.com/watch/1',
            frameId: 0,
        });
    });

    test.each([
        ['an absent tab', (sender) => delete sender.tab],
        ['a null tab', (sender) => (sender.tab = null)],
        ['a non-object tab', (sender) => (sender.tab = 'tab')],
        ['an empty document id', (sender) => (sender.documentId = '')],
        ['a non-string document id', (sender) => (sender.documentId = 1)],
        [
            'a missing document lifecycle',
            (sender) => delete sender.documentLifecycle,
        ],
        [
            'a cached document lifecycle',
            (sender) => (sender.documentLifecycle = 'cached'),
        ],
        [
            'a prerender document lifecycle',
            (sender) => (sender.documentLifecycle = 'prerender'),
        ],
        [
            'a pending-deletion document lifecycle',
            (sender) => (sender.documentLifecycle = 'pending_deletion'),
        ],
        [
            'a non-string document lifecycle',
            (sender) => (sender.documentLifecycle = null),
        ],
        ['a subframe', (sender) => (sender.frameId = 1)],
        ['an inactive tab', (sender) => (sender.tab.active = false)],
        ['a negative tab id', (sender) => (sender.tab.id = -1)],
        ['a fractional tab id', (sender) => (sender.tab.id = 1.5)],
        [
            'an unsafe tab id',
            (sender) => (sender.tab.id = Number.MAX_SAFE_INTEGER + 1),
        ],
        ['a negative window id', (sender) => (sender.tab.windowId = -1)],
        ['a fractional window id', (sender) => (sender.tab.windowId = 1.5)],
        [
            'an unsafe window id',
            (sender) => (sender.tab.windowId = Number.MAX_SAFE_INTEGER + 1),
        ],
    ])('rejects a content sender with %s', (_label, mutateSender) => {
        const sender = createContentSender();
        mutateSender(sender);

        expect(
            classifyExtensionMessageSender(sender, createRuntime())
        ).toBeNull();
    });

    test('rejects a non-enumerable active document lifecycle', () => {
        const sender = createContentSender();
        Object.defineProperty(sender, 'documentLifecycle', {
            configurable: true,
            enumerable: false,
            value: 'active',
            writable: true,
        });

        expect(
            classifyExtensionMessageSender(sender, createRuntime())
        ).toBeNull();
    });

    test.each([
        ['an HTTP sender URL', 'sender', 'url', 'http://netflix.com/'],
        ['an HTTP tab URL', 'tab', 'url', 'http://netflix.com/'],
        [
            'sender URL username',
            'sender',
            'url',
            'https://user@www.netflix.com/watch/1',
        ],
        [
            'tab URL password',
            'tab',
            'url',
            'https://:secret@www.netflix.com/watch/1',
        ],
        [
            'sender URL port',
            'sender',
            'url',
            'https://www.netflix.com:444/watch/1',
        ],
        ['tab URL port', 'tab', 'url', 'https://www.netflix.com:444/watch/1'],
        [
            'sender hostname trailing dot',
            'sender',
            'url',
            'https://www.netflix.com./watch/1',
        ],
        [
            'tab hostname trailing dot',
            'tab',
            'url',
            'https://www.netflix.com./watch/1',
        ],
        [
            'hostname suffix lookalike',
            'sender',
            'url',
            'https://www.netflix.com.attacker.example/',
        ],
        [
            'hostname prefix lookalike',
            'sender',
            'url',
            'https://evilnetflix.com/',
        ],
        ['cross-platform tab', 'tab', 'url', 'https://www.disneyplus.com/'],
        [
            'same-platform cross-origin tab',
            'tab',
            'url',
            'https://help.netflix.com/',
        ],
        [
            'mismatched declared origin',
            'sender',
            'origin',
            'https://help.netflix.com',
        ],
        ['a non-string sender URL', 'sender', 'url', null],
        ['a non-string tab URL', 'tab', 'url', null],
        ['a malformed sender URL', 'sender', 'url', 'not a url'],
    ])('rejects a content sender with %s', (_label, targetName, key, value) => {
        const sender = createContentSender();
        const target = targetName === 'sender' ? sender : sender.tab;
        target[key] = value;

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(identity).toBeNull();
    });

    test.each(
        [
            ['sender', 'id'],
            ['sender', 'url'],
            ['sender', 'tab'],
            ['sender', 'documentId'],
            ['sender', 'documentLifecycle'],
            ['sender', 'frameId'],
            ['tab', 'id'],
            ['tab', 'windowId'],
            ['tab', 'active'],
            ['tab', 'url'],
        ].flatMap(([targetName, key]) => [
            [targetName, key, 'missing', false],
            [targetName, key, 'inherited', true],
        ])
    )(
        'rejects a content sender with %s.%s %s',
        (targetName, key, _mode, makeInherited) => {
            const sender = createContentSender();
            const target = targetName === 'sender' ? sender : sender.tab;
            const inheritedValue = target[key];
            delete target[key];
            if (makeInherited) {
                Object.setPrototypeOf(target, { [key]: inheritedValue });
            }

            expect(
                classifyExtensionMessageSender(sender, createRuntime())
            ).toBeNull();
        }
    );

    test.each([
        ['sender', 'id'],
        ['sender', 'url'],
        ['sender', 'tab'],
        ['sender', 'documentId'],
        ['sender', 'documentLifecycle'],
        ['sender', 'frameId'],
        ['tab', 'id'],
        ['tab', 'windowId'],
        ['tab', 'active'],
        ['tab', 'url'],
    ])(
        'rejects a content sender with a %s.%s accessor without invoking it',
        (targetName, key) => {
            const sender = createContentSender();
            const target = targetName === 'sender' ? sender : sender.tab;
            const originalValue = target[key];
            let getterCalls = 0;
            Object.defineProperty(target, key, {
                configurable: true,
                enumerable: true,
                get() {
                    getterCalls += 1;
                    return originalValue;
                },
            });

            expect(
                classifyExtensionMessageSender(sender, createRuntime())
            ).toBeNull();
            expect(getterCalls).toBe(0);
        }
    );

    test('ignores unrelated content sender and tab accessors', () => {
        const sender = createContentSender();
        let getterCalls = 0;
        for (const target of [sender, sender.tab]) {
            Object.defineProperty(target, 'futureChromeField', {
                get() {
                    getterCalls += 1;
                    throw new Error('must not inspect unrelated fields');
                },
            });
        }

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(identity).toEqual({
            role: MessageSenderRoles.CONTENT,
            platform: 'netflix',
            tabId: 7,
            windowId: 3,
            documentId: 'document-1',
            documentLifecycle: 'active',
            origin: 'https://www.netflix.com',
            senderUrl: 'https://www.netflix.com/watch/80123456?sender=1',
            tabUrl: 'https://www.netflix.com/watch/80123456?tab=1',
            frameId: 0,
        });
        expect(getterCalls).toBe(0);
    });

    test('classifies faithful transparent proxies from only known descriptors', () => {
        const rawSender = createContentSender();
        const rawTab = rawSender.tab;
        const senderDescriptorKeys = [];
        const tabDescriptorKeys = [];
        const createDescriptorOnlyProxy = (target, descriptorKeys) =>
            new Proxy(target, {
                get() {
                    throw new Error('must not read properties directly');
                },
                getOwnPropertyDescriptor(proxyTarget, key) {
                    descriptorKeys.push(key);
                    return Reflect.getOwnPropertyDescriptor(proxyTarget, key);
                },
                ownKeys() {
                    throw new Error('must not enumerate Chrome records');
                },
            });
        rawSender.tab = createDescriptorOnlyProxy(rawTab, tabDescriptorKeys);
        const sender = createDescriptorOnlyProxy(
            rawSender,
            senderDescriptorKeys
        );

        const identity = classifyExtensionMessageSender(
            sender,
            createRuntime()
        );

        expect(identity).toEqual({
            role: MessageSenderRoles.CONTENT,
            platform: 'netflix',
            tabId: 7,
            windowId: 3,
            documentId: 'document-1',
            documentLifecycle: 'active',
            origin: 'https://www.netflix.com',
            senderUrl: 'https://www.netflix.com/watch/80123456?sender=1',
            tabUrl: 'https://www.netflix.com/watch/80123456?tab=1',
            frameId: 0,
        });
        expect(senderDescriptorKeys).toEqual([
            'id',
            'url',
            'origin',
            'tab',
            'documentId',
            'documentLifecycle',
            'frameId',
        ]);
        expect(tabDescriptorKeys).toEqual(['id', 'windowId', 'active', 'url']);
        expect(Object.isFrozen(identity)).toBe(true);

        rawSender.documentId = 'mutated';
        rawTab.id = 99;
        expect(identity.documentId).toBe('document-1');
        expect(identity.tabId).toBe(7);
    });

    test.each(['sender', 'tab'])(
        'fails closed when a %s descriptor trap throws',
        (targetName) => {
            const rawSender = createContentSender();
            const throwingProxy = (target) =>
                new Proxy(target, {
                    getOwnPropertyDescriptor() {
                        throw new Error('hostile descriptor trap');
                    },
                });
            const sender =
                targetName === 'sender'
                    ? throwingProxy(rawSender)
                    : {
                          ...rawSender,
                          tab: throwingProxy(rawSender.tab),
                      };
            const applicationState = { actions: 0 };

            expect(() =>
                classifyExtensionMessageSender(sender, createRuntime())
            ).not.toThrow();
            expect(
                classifyExtensionMessageSender(sender, createRuntime())
            ).toBeNull();
            expect(applicationState).toEqual({ actions: 0 });
        }
    );

    test('contains a document lifecycle descriptor trap', () => {
        const sender = new Proxy(createContentSender(), {
            getOwnPropertyDescriptor(target, key) {
                if (key === 'documentLifecycle') {
                    throw new Error('hostile lifecycle descriptor trap');
                }
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });

        expect(() =>
            classifyExtensionMessageSender(sender, createRuntime())
        ).not.toThrow();
        expect(
            classifyExtensionMessageSender(sender, createRuntime())
        ).toBeNull();
    });

    test('fails closed for a revoked sender proxy', () => {
        const revocable = Proxy.revocable(createContentSender(), {});
        revocable.revoke();

        expect(() =>
            classifyExtensionMessageSender(revocable.proxy, createRuntime())
        ).not.toThrow();
        expect(
            classifyExtensionMessageSender(revocable.proxy, createRuntime())
        ).toBeNull();
    });

    test('fails closed when a proxy mutates a required value during inspection', () => {
        const rawSender = createContentSender();
        const sender = new Proxy(rawSender, {
            getOwnPropertyDescriptor(target, key) {
                if (key === 'url') target.url = 'https://attacker.example/';
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
        const applicationState = { actions: 0 };

        expect(() =>
            classifyExtensionMessageSender(sender, createRuntime())
        ).not.toThrow();
        expect(
            classifyExtensionMessageSender(sender, createRuntime())
        ).toBeNull();
        expect(applicationState).toEqual({ actions: 0 });
    });

    test.each([
        ['manifest lookup', 'getManifest'],
        ['URL resolution', 'getURL'],
    ])('fails closed on runtime %s failure', (_label, failingMethod) => {
        const runtime = createRuntime();
        runtime[failingMethod] = () => {
            throw new Error('runtime failure');
        };

        expect(() =>
            classifyExtensionMessageSender(createContentSender(), runtime)
        ).not.toThrow();
        expect(
            classifyExtensionMessageSender(createContentSender(), runtime)
        ).toBeNull();
    });

    test('fails closed when the runtime manifest lacks an endpoint', () => {
        const runtime = createRuntime();
        runtime.getManifest = () => ({});

        const identity = classifyExtensionMessageSender(
            createContentSender(),
            runtime
        );

        expect(identity).toBeNull();
    });
});

describe('side-panel registration protocol', () => {
    test('builds the exact registration wire shape and parses a detached frozen binding', () => {
        const binding = { registrationId: 17, tabId: 23, windowId: 5 };

        const message = buildSidePanelRegistrationMessage(binding, 41);

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: binding,
            source: 'sidepanel',
            timestamp: 41,
        });
        expect(Object.getPrototypeOf(message)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(message.data)).toBe(Object.prototype);
        expect(message.data).not.toBe(binding);

        const parsed = parseSidePanelRegistrationMessage(message);
        expect(parsed).toEqual(binding);
        expect(parsed).not.toBe(binding);
        expect(parsed).not.toBe(message.data);
        expect(Object.isFrozen(parsed)).toBe(true);

        binding.registrationId = 99;
        message.data.tabId = 99;
        expect(parsed).toEqual({ registrationId: 17, tabId: 23, windowId: 5 });
    });

    test('rejects a registration envelope with an extra own key', () => {
        const message = buildSidePanelRegistrationMessage(
            { registrationId: 17, tabId: 23, windowId: 5 },
            41
        );
        message.extra = true;

        expect(() => parseSidePanelRegistrationMessage(message)).not.toThrow();
        expect(parseSidePanelRegistrationMessage(message)).toBeNull();
    });

    test('rejects registration data with an extra own key', () => {
        const message = buildSidePanelRegistrationMessage(
            { registrationId: 17, tabId: 23, windowId: 5 },
            41
        );
        message.data.extra = true;

        expect(parseSidePanelRegistrationMessage(message)).toBeNull();
    });

    test('rejects a registration envelope wrapped in a transparent proxy', () => {
        const message = buildSidePanelRegistrationMessage(
            { registrationId: 17, tabId: 23, windowId: 5 },
            41
        );

        expect(
            parseSidePanelRegistrationMessage(new Proxy(message, {}))
        ).toBeNull();
    });

    test.each([
        ['registrationId', 0],
        ['registrationId', -1],
        ['registrationId', 1.5],
        ['registrationId', Number.MAX_SAFE_INTEGER + 1],
        ['tabId', -1],
        ['windowId', -1],
        ['windowId', '5'],
    ])('rejects an invalid %s binding coordinate', (key, value) => {
        const message = buildSidePanelRegistrationMessage(
            { registrationId: 17, tabId: 23, windowId: 5 },
            41
        );
        message.data[key] = value;

        expect(parseSidePanelRegistrationMessage(message)).toBeNull();
    });

    test.each([
        ['action', MessageActions.SIDEPANEL_BINDING_CONFIRMED],
        ['source', 'background'],
        ['source', new String('sidepanel')],
        ['timestamp', -1],
        ['timestamp', 1.5],
        ['timestamp', Number.MAX_SAFE_INTEGER + 1],
        ['timestamp', '41'],
    ])('rejects an invalid registration envelope %s', (key, value) => {
        const message = buildSidePanelRegistrationMessage(
            { registrationId: 17, tabId: 23, windowId: 5 },
            41
        );
        message[key] = value;

        expect(parseSidePanelRegistrationMessage(message)).toBeNull();
    });

    test('refuses to build a registration with an invalid timestamp', () => {
        expect(() =>
            buildSidePanelRegistrationMessage(
                { registrationId: 17, tabId: 23, windowId: 5 },
                -1
            )
        ).toThrow(TypeError);
    });

    test('refuses to build a registration with an invalid binding', () => {
        expect(() =>
            buildSidePanelRegistrationMessage(
                { registrationId: 0, tabId: 23, windowId: 5 },
                41
            )
        ).toThrow(TypeError);
    });
});

describe('side-panel binding-confirmation protocol', () => {
    test('builds the exact confirmation wire shape and parses a detached frozen binding', () => {
        const binding = { registrationId: 17, tabId: 23, windowId: 5 };

        const message = buildSidePanelBindingConfirmationMessage(binding);

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_BINDING_CONFIRMED,
            data: binding,
        });
        expect(Object.getPrototypeOf(message)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(message.data)).toBe(Object.prototype);
        expect(message.data).not.toBe(binding);

        const parsed = parseSidePanelBindingConfirmationMessage(message);
        expect(parsed).toEqual(binding);
        expect(parsed).not.toBe(binding);
        expect(parsed).not.toBe(message.data);
        expect(Object.isFrozen(parsed)).toBe(true);

        binding.registrationId = 99;
        message.data.tabId = 99;
        expect(parsed).toEqual({ registrationId: 17, tabId: 23, windowId: 5 });
    });

    test('rejects a confirmation with the wrong action', () => {
        const message = buildSidePanelBindingConfirmationMessage({
            registrationId: 17,
            tabId: 23,
            windowId: 5,
        });
        message.action = MessageActions.SIDEPANEL_REGISTER;

        expect(parseSidePanelBindingConfirmationMessage(message)).toBeNull();
    });

    test('rejects a confirmation envelope with an extra own key', () => {
        const message = buildSidePanelBindingConfirmationMessage({
            registrationId: 17,
            tabId: 23,
            windowId: 5,
        });
        message.extra = true;

        expect(parseSidePanelBindingConfirmationMessage(message)).toBeNull();
    });

    test('refuses to build a confirmation with an invalid binding', () => {
        expect(() =>
            buildSidePanelBindingConfirmationMessage({
                registrationId: 0,
                tabId: 23,
                windowId: 5,
            })
        ).toThrow(TypeError);
    });
});

describe.each([
    [
        'registration',
        () =>
            buildSidePanelRegistrationMessage(
                { registrationId: 17, tabId: 23, windowId: 5 },
                41
            ),
        parseSidePanelRegistrationMessage,
    ],
    [
        'binding confirmation',
        () =>
            buildSidePanelBindingConfirmationMessage({
                registrationId: 17,
                tabId: 23,
                windowId: 5,
            }),
        parseSidePanelBindingConfirmationMessage,
    ],
])('%s hostile-record handling', (_label, createMessage, parseMessage) => {
    test('accepts null-prototype records and still returns an ordinary detached value', () => {
        const original = createMessage();
        const data = Object.assign(Object.create(null), original.data);
        const message = Object.assign(Object.create(null), original, { data });

        const parsed = parseMessage(message);

        expect(parsed).toEqual({ registrationId: 17, tabId: 23, windowId: 5 });
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        expect(Object.isFrozen(parsed)).toBe(true);
    });

    test.each(['envelope', 'data'])(
        'rejects an extra symbol key on the %s',
        (target) => {
            const message = createMessage();
            const record = target === 'envelope' ? message : message.data;
            record[Symbol('extra')] = true;

            expect(() => parseMessage(message)).not.toThrow();
            expect(parseMessage(message)).toBeNull();
        }
    );

    test.each(['envelope', 'data'])(
        'rejects an accessor on the %s without invoking it',
        (target) => {
            const message = createMessage();
            const record = target === 'envelope' ? message : message.data;
            const key = target === 'envelope' ? 'action' : 'registrationId';
            let getterCalls = 0;
            Object.defineProperty(record, key, {
                configurable: true,
                enumerable: true,
                get() {
                    getterCalls += 1;
                    return target === 'envelope'
                        ? MessageActions.SIDEPANEL_REGISTER
                        : 17;
                },
            });

            expect(() => parseMessage(message)).not.toThrow();
            expect(parseMessage(message)).toBeNull();
            expect(getterCalls).toBe(0);
        }
    );

    test.each([
        [
            'custom-prototype envelope',
            (message) => Object.assign(Object.create({}), message),
        ],
        ['sparse-array envelope', (message) => Object.assign([], message)],
        [
            'transparent-proxy data',
            (message) => {
                message.data = new Proxy(message.data, {});
                return message;
            },
        ],
        [
            'throwing-reflection envelope',
            (message) =>
                new Proxy(message, {
                    ownKeys() {
                        throw new Error('reflection denied');
                    },
                }),
        ],
    ])('rejects a %s without throwing', (_case, mutateMessage) => {
        const message = mutateMessage(createMessage());

        expect(() => parseMessage(message)).not.toThrow();
        expect(parseMessage(message)).toBeNull();
    });

    test('rejects a missing binding key', () => {
        const message = createMessage();
        delete message.data.windowId;

        expect(parseMessage(message)).toBeNull();
    });
});

describe('side-panel word intent protocol', () => {
    test('builds and parses the only accepted detached frozen wire shape', () => {
        const input = { autoOpen: true, pauseVideo: false };

        const message = buildSidePanelWordIntentMessage(input);
        const parsed = parseSidePanelWordIntentMessage(message);

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_WORD_SELECTED,
            options: input,
        });
        expect(Object.keys(message)).toEqual(['action', 'options']);
        expect(Object.keys(message.options)).toEqual([
            'autoOpen',
            'pauseVideo',
        ]);
        expect(parsed).toEqual(message);
        expect(parsed).not.toBe(message);
        expect(parsed.options).not.toBe(message.options);
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(parsed.options)).toBe(Object.prototype);
        expect(Object.isFrozen(message)).toBe(true);
        expect(Object.isFrozen(message.options)).toBe(true);
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.options)).toBe(true);

        input.autoOpen = false;
        expect(message.options).toEqual({
            autoOpen: true,
            pauseVideo: false,
        });
    });

    test.each([
        ['missing option', { autoOpen: true }],
        ['extra option', { autoOpen: true, pauseVideo: false, force: true }],
        ['non-boolean autoOpen', { autoOpen: 1, pauseVideo: false }],
        ['non-boolean pauseVideo', { autoOpen: true, pauseVideo: null }],
    ])('rejects %s', (_label, options) => {
        expect(() => buildSidePanelWordIntentMessage(options)).toThrow(
            TypeError
        );
        expect(
            parseSidePanelWordIntentMessage({
                action: MessageActions.SIDEPANEL_WORD_SELECTED,
                options,
            })
        ).toBeNull();
    });

    test.each([
        [
            'extra envelope field',
            {
                action: MessageActions.SIDEPANEL_WORD_SELECTED,
                options: { autoOpen: true, pauseVideo: false },
                word: 'private',
            },
        ],
        [
            'wrong action',
            {
                action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                options: { autoOpen: true, pauseVideo: false },
            },
        ],
        [
            'custom prototype',
            Object.assign(Object.create({}), {
                action: MessageActions.SIDEPANEL_WORD_SELECTED,
                options: { autoOpen: true, pauseVideo: false },
            }),
        ],
    ])('rejects an envelope with %s', (_label, message) => {
        expect(parseSidePanelWordIntentMessage(message)).toBeNull();
    });

    test('rejects accessors and throwing reflection without invoking accessors', () => {
        let getterCalls = 0;
        const accessorMessage = {
            action: MessageActions.SIDEPANEL_WORD_SELECTED,
            options: { autoOpen: true, pauseVideo: false },
        };
        Object.defineProperty(accessorMessage.options, 'autoOpen', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return true;
            },
        });
        const throwingMessage = new Proxy(accessorMessage, {
            ownKeys() {
                throw new Error('reflection denied');
            },
        });

        expect(() =>
            parseSidePanelWordIntentMessage(accessorMessage)
        ).not.toThrow();
        expect(parseSidePanelWordIntentMessage(accessorMessage)).toBeNull();
        expect(() =>
            parseSidePanelWordIntentMessage(throwingMessage)
        ).not.toThrow();
        expect(parseSidePanelWordIntentMessage(throwingMessage)).toBeNull();
        expect(getterCalls).toBe(0);
    });
});

describe('side-panel content selection snapshot protocol', () => {
    test('builds and parses one exact detached deeply frozen occurrence snapshot', () => {
        const input = {
            lifecycleGeneration: 3,
            selectionRevision: 5,
            renderRevision: 7,
            reason: 'toggle',
            entries: [
                { wordIndex: 1, word: 'echo' },
                { wordIndex: 4, word: 'echo' },
            ],
        };

        const message = buildSidePanelContentSelectionSnapshotMessage(input);
        const parsed = parseSidePanelContentSelectionSnapshotMessage(message);

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: input,
        });
        expect(Object.keys(message)).toEqual(['action', 'data']);
        expect(Object.keys(message.data)).toEqual([
            'lifecycleGeneration',
            'selectionRevision',
            'renderRevision',
            'reason',
            'entries',
        ]);
        expect(parsed).toEqual(input);
        expect(parsed).not.toBe(input);
        expect(parsed.entries).not.toBe(input.entries);
        expect(parsed.entries[0]).not.toBe(input.entries[0]);
        for (const value of [
            message,
            message.data,
            message.data.entries,
            ...message.data.entries,
            parsed,
            parsed.entries,
            ...parsed.entries,
        ]) {
            expect(Object.isFrozen(value)).toBe(true);
        }

        input.lifecycleGeneration = 99;
        input.entries[0].word = 'mutated';
        expect(parsed).toEqual({
            lifecycleGeneration: 3,
            selectionRevision: 5,
            renderRevision: 7,
            reason: 'toggle',
            entries: [
                { wordIndex: 1, word: 'echo' },
                { wordIndex: 4, word: 'echo' },
            ],
        });
    });

    test('uses one fixed accepted or rejected receipt with no selection data', () => {
        const accepted =
            buildSidePanelContentSelectionSnapshotResponse('accepted');
        const rejected =
            buildSidePanelContentSelectionSnapshotResponse('rejected');

        expect(accepted).toEqual({ success: true });
        expect(rejected).toEqual({ success: false });
        expect(
            parseSidePanelContentSelectionSnapshotResponse(accepted)
        ).toEqual({ status: 'accepted' });
        expect(
            parseSidePanelContentSelectionSnapshotResponse(rejected)
        ).toEqual({ status: 'rejected' });
        expect(Object.isFrozen(accepted)).toBe(true);
        expect(
            Object.isFrozen(
                parseSidePanelContentSelectionSnapshotResponse(accepted)
            )
        ).toBe(true);
        expect(
            parseSidePanelContentSelectionSnapshotResponse({
                success: true,
                data: [],
            })
        ).toBeNull();
        expect(() =>
            buildSidePanelContentSelectionSnapshotResponse('unknown')
        ).toThrow(TypeError);
    });

    test('accepts null-prototype data and entries but returns ordinary detached records', () => {
        const entry = Object.assign(Object.create(null), {
            wordIndex: 0,
            word: 'bonjour',
        });
        const input = Object.assign(Object.create(null), {
            lifecycleGeneration: 1,
            selectionRevision: 1,
            renderRevision: 1,
            reason: 'toggle',
            entries: [entry],
        });
        const wire = Object.assign(Object.create(null), {
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: input,
        });

        const built = buildSidePanelContentSelectionSnapshotMessage(input);
        const parsed = parseSidePanelContentSelectionSnapshotMessage(wire);

        for (const value of [
            built,
            built.data,
            built.data.entries[0],
            parsed,
            parsed.entries[0],
        ]) {
            expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
            expect(Object.isFrozen(value)).toBe(true);
        }
        expect(parsed).toEqual(built.data);
    });

    test.each([
        ['lifecycleGeneration', 0],
        ['selectionRevision', 0],
        ['renderRevision', 0],
        ['lifecycleGeneration', -1],
        ['selectionRevision', 1.5],
        ['renderRevision', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects invalid positive identity %s=%p', (key, value) => {
        const input = {
            lifecycleGeneration: 1,
            selectionRevision: 1,
            renderRevision: 1,
            reason: 'toggle',
            entries: [{ wordIndex: 0, word: 'bonjour' }],
            [key]: value,
        };

        expect(() =>
            buildSidePanelContentSelectionSnapshotMessage(input)
        ).toThrow(TypeError);
        expect(
            parseSidePanelContentSelectionSnapshotMessage({
                action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                data: input,
            })
        ).toBeNull();
    });

    test.each([
        ['toggle', 'empty', [], true],
        ['toggle', 'nonempty', [{ wordIndex: 0, word: 'bonjour' }], true],
        ['add', 'empty', [], false],
        ['add', 'nonempty', [{ wordIndex: 0, word: 'bonjour' }], true],
        ['remove', 'empty', [], true],
        ['remove', 'nonempty', [{ wordIndex: 0, word: 'bonjour' }], true],
        ['restore', 'empty', [], false],
        ['restore', 'nonempty', [{ wordIndex: 0, word: 'bonjour' }], true],
        ['clear', 'empty', [], true],
        ['clear', 'nonempty', [{ wordIndex: 0, word: 'bonjour' }], false],
        ['subtitle-change', 'empty', [], true],
        [
            'subtitle-change',
            'nonempty',
            [{ wordIndex: 0, word: 'bonjour' }],
            false,
        ],
    ])('%s with %s entries', (reason, _entryShape, entries, accepted) => {
        const input = {
            lifecycleGeneration: 1,
            selectionRevision: 1,
            renderRevision: 1,
            reason,
            entries,
        };
        const wire = {
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: input,
        };

        if (accepted) {
            expect(() =>
                buildSidePanelContentSelectionSnapshotMessage(input)
            ).not.toThrow();
            expect(
                parseSidePanelContentSelectionSnapshotMessage(wire)
            ).not.toBeNull();
            return;
        }

        expect(() =>
            buildSidePanelContentSelectionSnapshotMessage(input)
        ).toThrow(TypeError);
        expect(parseSidePanelContentSelectionSnapshotMessage(wire)).toBeNull();
    });

    test('enforces occurrence ordering and the 64-entry boundary', () => {
        const createInput = (entries) => ({
            lifecycleGeneration: 1,
            selectionRevision: 1,
            renderRevision: 1,
            reason: 'restore',
            entries,
        });
        const sixtyFour = Array.from({ length: 64 }, (_, wordIndex) => ({
            wordIndex,
            word: wordIndex === 0 || wordIndex === 63 ? 'echo' : 'a',
        }));
        const sixtyFive = [...sixtyFour, { wordIndex: 64, word: 'overflow' }];

        expect(() =>
            buildSidePanelContentSelectionSnapshotMessage(
                createInput(sixtyFour)
            )
        ).not.toThrow();
        expect(() =>
            buildSidePanelContentSelectionSnapshotMessage(
                createInput(sixtyFive)
            )
        ).toThrow(TypeError);
        for (const entries of [
            [
                { wordIndex: 1, word: 'a' },
                { wordIndex: 1, word: 'b' },
            ],
            [
                { wordIndex: 2, word: 'a' },
                { wordIndex: 1, word: 'b' },
            ],
        ]) {
            expect(() =>
                buildSidePanelContentSelectionSnapshotMessage(
                    createInput(entries)
                )
            ).toThrow(TypeError);
        }
    });

    test('enforces word Unicode byte and joined-code-unit boundaries', () => {
        const createInput = (entries) => ({
            lifecycleGeneration: 1,
            selectionRevision: 1,
            renderRevision: 1,
            reason: 'restore',
            entries,
        });
        for (const word of [
            'a'.repeat(256),
            'é'.repeat(128),
            '😀'.repeat(64),
        ]) {
            expect(() =>
                buildSidePanelContentSelectionSnapshotMessage(
                    createInput([{ wordIndex: 0, word }])
                )
            ).not.toThrow();
        }
        for (const word of [
            '',
            'a'.repeat(257),
            'é'.repeat(129),
            '😀'.repeat(65),
            '\ud800',
            '\udc00',
        ]) {
            expect(() =>
                buildSidePanelContentSelectionSnapshotMessage(
                    createInput([{ wordIndex: 0, word }])
                )
            ).toThrow(TypeError);
        }

        expect(() =>
            buildSidePanelContentSelectionSnapshotMessage(
                createInput([
                    { wordIndex: 0, word: 'a'.repeat(250) },
                    { wordIndex: 1, word: 'b'.repeat(249) },
                ])
            )
        ).not.toThrow();
        expect(() =>
            buildSidePanelContentSelectionSnapshotMessage(
                createInput([
                    { wordIndex: 0, word: 'a'.repeat(250) },
                    { wordIndex: 1, word: 'b'.repeat(250) },
                ])
            )
        ).toThrow(TypeError);
    });

    test('rejects non-exact hostile snapshot records and arrays without invoking accessors', () => {
        const createWire = () => ({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                lifecycleGeneration: 1,
                selectionRevision: 1,
                renderRevision: 1,
                reason: 'toggle',
                entries: [{ wordIndex: 0, word: 'bonjour' }],
            },
        });
        let getterCalls = 0;
        const cases = [];

        for (const targetName of ['envelope', 'data', 'entry']) {
            const extra = createWire();
            const extraTarget =
                targetName === 'envelope'
                    ? extra
                    : targetName === 'data'
                      ? extra.data
                      : extra.data.entries[0];
            extraTarget.extra = true;
            cases.push(extra);

            const symbol = createWire();
            const symbolTarget =
                targetName === 'envelope'
                    ? symbol
                    : targetName === 'data'
                      ? symbol.data
                      : symbol.data.entries[0];
            symbolTarget[Symbol('extra')] = true;
            cases.push(symbol);

            const accessor = createWire();
            const accessorTarget =
                targetName === 'envelope'
                    ? accessor
                    : targetName === 'data'
                      ? accessor.data
                      : accessor.data.entries[0];
            const key =
                targetName === 'envelope'
                    ? 'action'
                    : targetName === 'data'
                      ? 'reason'
                      : 'word';
            Object.defineProperty(accessorTarget, key, {
                configurable: true,
                enumerable: true,
                get() {
                    getterCalls += 1;
                    return targetName === 'envelope'
                        ? MessageActions.SIDEPANEL_SELECTION_SYNC
                        : targetName === 'data'
                          ? 'toggle'
                          : 'bonjour';
                },
            });
            cases.push(accessor);

            const nonEnumerable = createWire();
            const nonEnumerableTarget =
                targetName === 'envelope'
                    ? nonEnumerable
                    : targetName === 'data'
                      ? nonEnumerable.data
                      : nonEnumerable.data.entries[0];
            Object.defineProperty(nonEnumerableTarget, key, {
                configurable: true,
                enumerable: false,
                value:
                    targetName === 'envelope'
                        ? MessageActions.SIDEPANEL_SELECTION_SYNC
                        : targetName === 'data'
                          ? 'toggle'
                          : 'bonjour',
                writable: true,
            });
            cases.push(nonEnumerable);

            const exotic = createWire();
            const exoticTarget =
                targetName === 'envelope'
                    ? exotic
                    : targetName === 'data'
                      ? exotic.data
                      : exotic.data.entries[0];
            Object.setPrototypeOf(exoticTarget, { inherited: true });
            cases.push(exotic);
        }

        const sparse = createWire();
        sparse.data.entries = new Array(1);
        cases.push(sparse);
        const extraArrayKey = createWire();
        extraArrayKey.data.entries.extra = true;
        cases.push(extraArrayKey);
        const symbolArrayKey = createWire();
        symbolArrayKey.data.entries[Symbol('extra')] = true;
        cases.push(symbolArrayKey);
        const nonEnumerableIndex = createWire();
        Object.defineProperty(nonEnumerableIndex.data.entries, 0, {
            configurable: true,
            enumerable: false,
            value: { wordIndex: 0, word: 'bonjour' },
            writable: true,
        });
        cases.push(nonEnumerableIndex);
        const exoticArray = createWire();
        Object.setPrototypeOf(exoticArray.data.entries, null);
        cases.push(exoticArray);

        for (const message of cases) {
            expect(() =>
                parseSidePanelContentSelectionSnapshotMessage(message)
            ).not.toThrow();
            expect(
                parseSidePanelContentSelectionSnapshotMessage(message)
            ).toBeNull();
        }
        expect(getterCalls).toBe(0);

        expect(() =>
            buildSidePanelContentSelectionSnapshotMessage({
                ...createWire().data,
                timestamp: 1,
            })
        ).toThrow(TypeError);
    });
});

describe('side-panel bound selection state protocol', () => {
    test('projects only a matching binding and opaque occurrence owner state', () => {
        const binding = { registrationId: 2, tabId: 7, windowId: 3 };
        const selection = {
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            reason: 'restore',
            entries: [{ wordIndex: 4, word: 'echo' }],
        };

        const message = buildSidePanelSelectionStateMessage(binding, selection);
        const parsed = parseSidePanelSelectionStateMessage(message, binding);

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: { binding, selection },
        });
        expect(parsed).toEqual({ binding, selection });
        expect(parsed.binding).not.toBe(binding);
        expect(parsed.selection).not.toBe(selection);
        expect(parsed.selection.entries).not.toBe(selection.entries);
        for (const value of [
            message,
            message.data,
            message.data.binding,
            message.data.selection,
            message.data.selection.entries,
            message.data.selection.entries[0],
            parsed,
            parsed.binding,
            parsed.selection,
            parsed.selection.entries,
            parsed.selection.entries[0],
        ]) {
            expect(Object.isFrozen(value)).toBe(true);
        }

        expect(
            parseSidePanelSelectionStateMessage(message, {
                registrationId: 3,
                tabId: 7,
                windowId: 3,
            })
        ).toBeNull();
        expect(
            parseSidePanelContentSelectionSnapshotMessage(message)
        ).toBeNull();
    });

    test('uses a bound null state without exposing document or lifecycle identity', () => {
        const binding = { registrationId: 2, tabId: 7, windowId: 3 };
        const message = buildSidePanelSelectionStateMessage(binding, null);

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: { binding, selection: null },
        });
        expect(parseSidePanelSelectionStateMessage(message, binding)).toEqual({
            binding,
            selection: null,
        });
        expect(Object.keys(message.data)).toEqual(['binding', 'selection']);
        expect(Object.isFrozen(message.data)).toBe(true);
        expect(Object.isFrozen(message.data.binding)).toBe(true);
    });

    test('rejects non-enumerable bindings and forbidden projection fields', () => {
        const binding = { registrationId: 2, tabId: 7, windowId: 3 };
        Object.defineProperty(binding, 'registrationId', {
            configurable: true,
            enumerable: false,
            value: 2,
            writable: true,
        });
        expect(() =>
            buildSidePanelSelectionStateMessage(binding, null)
        ).toThrow(TypeError);

        const validBinding = { registrationId: 2, tabId: 7, windowId: 3 };
        const message = {
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: validBinding,
                selection: null,
                documentId: 'forbidden',
            },
        };
        expect(
            parseSidePanelSelectionStateMessage(message, validBinding)
        ).toBeNull();
    });
});

describe('side-panel selection republish protocol', () => {
    test('correlates one requestId-only freshness poke and acknowledgement', () => {
        const request = buildSidePanelSelectionRepublishRequestMessage(9);
        const parsedRequest =
            parseSidePanelSelectionRepublishRequestMessage(request);
        const acknowledgement =
            buildSidePanelSelectionRepublishAck(parsedRequest);

        expect(request).toEqual({
            action: MessageActions.SIDEPANEL_GET_STATE,
            data: { requestId: 9 },
        });
        expect(parsedRequest).toEqual({ requestId: 9 });
        expect(acknowledgement).toEqual({ requestId: 9 });
        expect(
            parseSidePanelSelectionRepublishAck(acknowledgement, parsedRequest)
        ).toEqual({ requestId: 9 });
        expect(
            parseSidePanelSelectionRepublishAck(
                { requestId: 10 },
                parsedRequest
            )
        ).toBeNull();
        for (const value of [
            request,
            request.data,
            parsedRequest,
            acknowledgement,
        ]) {
            expect(Object.isFrozen(value)).toBe(true);
        }
    });

    test('rejects invalid IDs, extra fields, and accessors without invoking them', () => {
        for (const requestId of [
            0,
            -1,
            1.5,
            Number.MAX_SAFE_INTEGER + 1,
            '9',
        ]) {
            expect(() =>
                buildSidePanelSelectionRepublishRequestMessage(requestId)
            ).toThrow(TypeError);
        }

        const expected = { requestId: 9 };
        expect(
            parseSidePanelSelectionRepublishRequestMessage({
                action: MessageActions.SIDEPANEL_GET_STATE,
                data: { requestId: 9 },
                source: 'background',
            })
        ).toBeNull();
        expect(
            parseSidePanelSelectionRepublishAck(
                { requestId: 9, success: true },
                expected
            )
        ).toBeNull();

        let getterCalls = 0;
        const accessorAck = {};
        Object.defineProperty(accessorAck, 'requestId', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return 9;
            },
        });
        expect(() =>
            parseSidePanelSelectionRepublishAck(accessorAck, expected)
        ).not.toThrow();
        expect(
            parseSidePanelSelectionRepublishAck(accessorAck, expected)
        ).toBeNull();
        expect(getterCalls).toBe(0);
    });
});

describe('side-panel occurrence removal request protocol', () => {
    test('binds one occurrence removal to the exact panel and selection owner', () => {
        const input = {
            binding: { registrationId: 2, tabId: 7, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 4,
        };

        const message = buildSidePanelSelectionRemovalRequestMessage(input);
        const parsed = parseSidePanelSelectionRemovalRequestMessage(message);

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_UPDATE_STATE,
            data: input,
        });
        expect(parsed).toEqual(input);
        expect(parsed).not.toBe(input);
        expect(parsed.binding).not.toBe(input.binding);
        for (const value of [
            message,
            message.data,
            message.data.binding,
            parsed,
            parsed.binding,
        ]) {
            expect(Object.isFrozen(value)).toBe(true);
        }

        input.binding.registrationId = 99;
        input.wordIndex = 99;
        expect(parsed).toEqual({
            binding: { registrationId: 2, tabId: 7, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 4,
        });
    });

    test.each([
        ['requestId', 0],
        ['selectionOwnerGeneration', 0],
        ['selectionRevision', 0],
        ['renderRevision', 0],
        ['wordIndex', -1],
        ['wordIndex', 1.5],
        ['requestId', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects invalid removal coordinate %s=%p', (key, value) => {
        const input = {
            binding: { registrationId: 2, tabId: 7, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 0,
            [key]: value,
        };

        expect(() =>
            buildSidePanelSelectionRemovalRequestMessage(input)
        ).toThrow(TypeError);
        expect(
            parseSidePanelSelectionRemovalRequestMessage({
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                data: input,
            })
        ).toBeNull();
    });

    test('rejects free-text state replacement and envelope metadata', () => {
        const data = {
            binding: { registrationId: 2, tabId: 7, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 0,
        };
        expect(
            parseSidePanelSelectionRemovalRequestMessage({
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                data: { ...data, selectedWords: ['forbidden'] },
            })
        ).toBeNull();
        expect(
            parseSidePanelSelectionRemovalRequestMessage({
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                data,
                timestamp: 1,
            })
        ).toBeNull();
    });
});

describe('side-panel occurrence removal command protocol', () => {
    test('derives one exact content command without panel or document identity', () => {
        const removal = {
            binding: { registrationId: 2, tabId: 7, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 4,
        };

        const message = buildSidePanelSelectionRemovalCommandMessage(
            removal,
            13
        );
        const parsed = parseSidePanelSelectionRemovalCommandMessage(message);

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_UPDATE_STATE,
            data: {
                requestId: 9,
                lifecycleGeneration: 13,
                selectionRevision: 5,
                renderRevision: 7,
                wordIndex: 4,
            },
        });
        expect(parsed).toEqual(message.data);
        expect(Object.isFrozen(message)).toBe(true);
        expect(Object.isFrozen(message.data)).toBe(true);
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(
            parseSidePanelSelectionRemovalRequestMessage(message)
        ).toBeNull();
        expect(
            parseSidePanelSelectionRemovalCommandMessage(
                buildSidePanelSelectionRemovalRequestMessage(removal)
            )
        ).toBeNull();
    });

    test('correlates fixed applied and rejected content responses', () => {
        const command = {
            requestId: 9,
            lifecycleGeneration: 13,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 4,
        };
        const applied = buildSidePanelSelectionRemovalCommandResponse(
            command,
            'applied'
        );
        const rejected = buildSidePanelSelectionRemovalCommandResponse(
            command,
            'rejected'
        );

        expect(applied).toEqual({ success: true, requestId: 9 });
        expect(rejected).toEqual({ success: false, requestId: 9 });
        expect(
            parseSidePanelSelectionRemovalCommandResponse(applied, command)
        ).toEqual({ requestId: 9, status: 'applied' });
        expect(
            parseSidePanelSelectionRemovalCommandResponse(rejected, command)
        ).toEqual({ requestId: 9, status: 'rejected' });
        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                { success: true, requestId: 10 },
                command
            )
        ).toBeNull();
        expect(() =>
            buildSidePanelSelectionRemovalCommandResponse(command, 'unknown')
        ).toThrow(TypeError);
    });

    test('requires a positive lifecycle and exact response data properties', () => {
        const removal = {
            binding: { registrationId: 2, tabId: 7, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 0,
        };
        for (const lifecycleGeneration of [
            0,
            -1,
            1.5,
            Number.MAX_SAFE_INTEGER + 1,
        ]) {
            expect(() =>
                buildSidePanelSelectionRemovalCommandMessage(
                    removal,
                    lifecycleGeneration
                )
            ).toThrow(TypeError);
        }

        const command = {
            requestId: 9,
            lifecycleGeneration: 13,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 0,
        };
        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                { success: true, requestId: 9, error: 'forbidden' },
                command
            )
        ).toBeNull();
        expect(
            parseSidePanelSelectionRemovalCommandMessage({
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                data: { ...command, documentId: 'forbidden' },
            })
        ).toBeNull();
    });
});

describe('side-panel occurrence removal result protocol', () => {
    test('correlates the terminal result to the expected binding request and owner', () => {
        const removal = {
            binding: { registrationId: 2, tabId: 7, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 4,
        };
        const message = buildSidePanelSelectionRemovalResultMessage(
            removal,
            'applied'
        );

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_UPDATE_STATE,
            data: {
                binding: removal.binding,
                requestId: 9,
                selectionOwnerGeneration: 11,
                status: 'applied',
            },
        });
        expect(
            parseSidePanelSelectionRemovalResultMessage(message, removal)
        ).toEqual(message.data);

        for (const key of ['requestId', 'selectionOwnerGeneration', 'status']) {
            const forged = {
                ...message,
                data: { ...message.data },
            };
            forged.data[key] =
                key === 'status' ? 'unknown' : forged.data[key] + 1;
            expect(
                parseSidePanelSelectionRemovalResultMessage(forged, removal)
            ).toBeNull();
        }
        const wrongBinding = {
            ...message,
            data: {
                ...message.data,
                binding: { ...message.data.binding, registrationId: 3 },
            },
        };
        expect(
            parseSidePanelSelectionRemovalResultMessage(wrongBinding, removal)
        ).toBeNull();
    });

    test('uses only fixed deeply frozen terminal result fields', () => {
        const removal = {
            binding: { registrationId: 2, tabId: 7, windowId: 3 },
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 4,
        };
        const message = buildSidePanelSelectionRemovalResultMessage(
            removal,
            'rejected'
        );
        const parsed = parseSidePanelSelectionRemovalResultMessage(
            message,
            removal
        );

        expect(parsed).toEqual({
            binding: removal.binding,
            requestId: 9,
            selectionOwnerGeneration: 11,
            status: 'rejected',
        });
        for (const value of [
            message,
            message.data,
            message.data.binding,
            parsed,
            parsed.binding,
        ]) {
            expect(Object.isFrozen(value)).toBe(true);
        }
        expect(
            parseSidePanelSelectionRemovalResultMessage(
                {
                    ...message,
                    data: { ...message.data, error: 'forbidden' },
                },
                removal
            )
        ).toBeNull();
        expect(() =>
            buildSidePanelSelectionRemovalResultMessage(removal, 'unknown')
        ).toThrow(TypeError);
    });
});

describe('side-panel selection protocol hostile input isolation', () => {
    test('copies null-prototype bindings and command records into ordinary values', () => {
        const binding = Object.assign(Object.create(null), {
            registrationId: 2,
            tabId: 7,
            windowId: 3,
        });
        const removal = Object.assign(Object.create(null), {
            binding,
            requestId: 9,
            selectionOwnerGeneration: 11,
            selectionRevision: 5,
            renderRevision: 7,
            wordIndex: 4,
        });
        const request = buildSidePanelSelectionRemovalRequestMessage(removal);
        const parsedRequest =
            parseSidePanelSelectionRemovalRequestMessage(request);
        const command = buildSidePanelSelectionRemovalCommandMessage(
            parsedRequest,
            13
        );
        const parsedCommand =
            parseSidePanelSelectionRemovalCommandMessage(command);
        const response = Object.assign(Object.create(null), {
            success: true,
            requestId: 9,
        });
        const parsedResponse = parseSidePanelSelectionRemovalCommandResponse(
            response,
            parsedCommand
        );

        for (const value of [
            request,
            request.data,
            request.data.binding,
            parsedRequest,
            parsedRequest.binding,
            command,
            command.data,
            parsedCommand,
            parsedResponse,
        ]) {
            expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
            expect(Object.isFrozen(value)).toBe(true);
        }
    });

    test.each([
        ['snapshot', parseSidePanelContentSelectionSnapshotMessage, []],
        [
            'snapshot receipt',
            parseSidePanelContentSelectionSnapshotResponse,
            [],
        ],
        [
            'state',
            parseSidePanelSelectionStateMessage,
            [{ registrationId: 2, tabId: 7, windowId: 3 }],
        ],
        [
            'republish request',
            parseSidePanelSelectionRepublishRequestMessage,
            [],
        ],
        [
            'republish acknowledgement',
            parseSidePanelSelectionRepublishAck,
            [{ requestId: 9 }],
        ],
        ['removal request', parseSidePanelSelectionRemovalRequestMessage, []],
        ['removal command', parseSidePanelSelectionRemovalCommandMessage, []],
        [
            'removal response',
            parseSidePanelSelectionRemovalCommandResponse,
            [
                {
                    requestId: 9,
                    lifecycleGeneration: 13,
                    selectionRevision: 5,
                    renderRevision: 7,
                    wordIndex: 4,
                },
            ],
        ],
        [
            'removal result',
            parseSidePanelSelectionRemovalResultMessage,
            [
                {
                    binding: { registrationId: 2, tabId: 7, windowId: 3 },
                    requestId: 9,
                    selectionOwnerGeneration: 11,
                    selectionRevision: 5,
                    renderRevision: 7,
                    wordIndex: 4,
                },
            ],
        ],
    ])(
        'the %s parser returns null without throwing',
        (_label, parser, rest) => {
            for (const value of [
                null,
                undefined,
                1,
                [],
                Object.create({ inherited: true }),
            ]) {
                expect(() => parser(value, ...rest)).not.toThrow();
                expect(parser(value, ...rest)).toBeNull();
            }

            const revoked = Proxy.revocable({}, {});
            revoked.revoke();
            expect(() => parser(revoked.proxy, ...rest)).not.toThrow();
            expect(parser(revoked.proxy, ...rest)).toBeNull();
        }
    );
});
