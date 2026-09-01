import { MessageActions } from '../constants/messageActions.js';
import {
    buildAnalyzeContextFailureResponse,
    buildAnalyzeContextRequestMessage,
    buildAnalyzeContextSuccessResponse,
    buildConfigChangedRequestMessage,
    buildContentControlResponseMessage,
    buildLoggingLevelChangedRequestMessage,
    buildSidePanelBindingConfirmationMessage,
    buildSidePanelContentSelectionSnapshotMessage,
    buildSidePanelContentSelectionSnapshotResponse,
    buildSidePanelForceBindTabMessage,
    buildSidePanelPauseVideoRequestMessage,
    buildSidePanelRegistrationMessage,
    buildSidePanelSelectionRemovalCommandMessage,
    buildSidePanelSelectionRemovalCommandResponse,
    buildSidePanelSelectionRemovalRequestMessage,
    buildSidePanelSelectionRemovalResultMessage,
    buildSidePanelSelectionRepublishAck,
    buildSidePanelSelectionRepublishRequestMessage,
    buildSidePanelSelectionStateMessage,
    buildSidePanelTabActivatedMessage,
    buildSidePanelWordIntentMessage,
    buildTranslationFailureResponse,
    buildTranslationRequestMessage,
    buildTranslationSuccessResponse,
    classifyExtensionMessageSender,
    MessageSenderRoles,
    parseAnalyzeContextRequestMessage,
    parseAnalyzeContextResponseMessage,
    parseConfigChangedRequestMessage,
    parseContentControlResponseMessage,
    parseLoggingLevelChangedRequestMessage,
    parseSidePanelBindingConfirmationMessage,
    parseSidePanelContentSelectionSnapshotMessage,
    parseSidePanelContentSelectionSnapshotResponse,
    parseSidePanelForceBindTabMessage,
    parseSidePanelPauseVideoRequestMessage,
    parseSidePanelRegistrationMessage,
    parseSidePanelSelectionRemovalCommandMessage,
    parseSidePanelSelectionRemovalCommandResponse,
    parseSidePanelSelectionRemovalRequestMessage,
    parseSidePanelSelectionRemovalResultMessage,
    parseSidePanelSelectionRepublishAck,
    parseSidePanelSelectionRepublishRequestMessage,
    parseSidePanelSelectionStateMessage,
    parseSidePanelTabActivatedMessage,
    parseSidePanelWordIntentMessage,
    parseTranslationRequestMessage,
    parseTranslationResponseMessage,
    readProtocolMessageAction,
} from './messageProtocol.js';

const translationInput = Object.freeze({
    text: 'Bonjour',
    targetLang: 'en-US',
    cueStart: 12.5,
    cueVideoId: 'video-1',
});

const contentAnalysisInput = Object.freeze({
    text: 'faire le point',
    contextTypes: Object.freeze(['cultural', 'linguistic']),
    language: 'fr',
    targetLanguage: 'en-US',
    platform: 'netflix',
    requestId: 'content-1',
});

const sidePanelAnalysisInput = Object.freeze({
    text: 'faire le point',
    contextTypes: Object.freeze(['linguistic']),
    targetLanguage: 'en-US',
    requestId: 'sidepanel-1',
});

const binding = Object.freeze({
    registrationId: 7,
    tabId: 12,
    windowId: 3,
});

const contentSelection = Object.freeze({
    lifecycleGeneration: 2,
    selectionRevision: 4,
    renderRevision: 5,
    reason: 'add',
    entries: Object.freeze([
        Object.freeze({ wordIndex: 1, word: 'bonjour' }),
        Object.freeze({ wordIndex: 4, word: 'monde' }),
    ]),
});

const selectionState = Object.freeze({
    selectionOwnerGeneration: 9,
    selectionRevision: 4,
    renderRevision: 5,
    reason: 'add',
    entries: contentSelection.entries,
});

const removalInput = Object.freeze({
    binding,
    requestId: 11,
    selectionOwnerGeneration: 9,
    selectionRevision: 4,
    renderRevision: 5,
    wordIndex: 1,
});

function withExtra(record) {
    return { ...record, extra: true };
}

function createRuntime() {
    const id = 'dualsub-extension';
    return {
        id,
        getManifest: () => ({
            action: { default_popup: 'popup.html' },
            background: { service_worker: 'background.js' },
            options_ui: { page: 'options.html' },
            side_panel: { default_path: 'sidepanel.html' },
        }),
        getURL: (path) => `chrome-extension://${id}/${path}`,
    };
}

function createContentSender(overrides = {}) {
    return {
        id: 'dualsub-extension',
        url: 'https://www.netflix.com/watch/1',
        origin: 'https://www.netflix.com',
        documentId: 'document-1',
        documentLifecycle: 'active',
        frameId: 0,
        tab: {
            id: 12,
            windowId: 3,
            active: true,
            url: 'https://www.netflix.com/watch/1',
        },
        ...overrides,
    };
}

describe('message route boundaries', () => {
    test.each(Object.values(MessageActions))(
        'reads the known %s action',
        (action) => {
            expect(readProtocolMessageAction({ action })).toBe(action);
        }
    );

    test.each([null, {}, { action: 'unknown' }, { action: 1 }])(
        'rejects an unknown action %#',
        (message) => {
            expect(readProtocolMessageAction(message)).toBeNull();
        }
    );

    test('authorizes config, logging, and pause routes by role', () => {
        const config = buildConfigChangedRequestMessage({ enabled: true });
        const logging = buildLoggingLevelChangedRequestMessage(2);
        const pause = buildSidePanelPauseVideoRequestMessage();

        expect(
            parseConfigChangedRequestMessage(config, MessageSenderRoles.POPUP)
        ).not.toBeNull();
        expect(
            parseConfigChangedRequestMessage(config, MessageSenderRoles.CONTENT)
        ).toBeNull();
        expect(
            parseLoggingLevelChangedRequestMessage(
                logging,
                MessageSenderRoles.BACKGROUND
            )
        ).not.toBeNull();
        expect(
            parseLoggingLevelChangedRequestMessage(
                logging,
                MessageSenderRoles.POPUP
            )
        ).toBeNull();
        expect(
            parseSidePanelPauseVideoRequestMessage(
                pause,
                MessageSenderRoles.BACKGROUND
            )
        ).not.toBeNull();
        expect(
            parseSidePanelPauseVideoRequestMessage(
                pause,
                MessageSenderRoles.SIDEPANEL
            )
        ).toBeNull();
    });

    test('rejects extra wire fields at the inbound boundary', () => {
        expect(
            parseConfigChangedRequestMessage(
                withExtra(buildConfigChangedRequestMessage({ enabled: true })),
                MessageSenderRoles.POPUP
            )
        ).toBeNull();
        expect(
            parseLoggingLevelChangedRequestMessage(
                withExtra(buildLoggingLevelChangedRequestMessage(2)),
                MessageSenderRoles.BACKGROUND
            )
        ).toBeNull();
    });
});

describe('sender authorization', () => {
    test.each([
        ['background', 'background.js', MessageSenderRoles.BACKGROUND],
        ['popup', 'popup.html', MessageSenderRoles.POPUP],
        ['side panel', 'sidepanel.html', MessageSenderRoles.SIDEPANEL],
        ['options', 'options.html', MessageSenderRoles.OPTIONS],
    ])('classifies an extension %s sender', (_label, path, role) => {
        const runtime = createRuntime();
        expect(
            classifyExtensionMessageSender(
                { id: runtime.id, url: runtime.getURL(path) },
                runtime
            )
        ).toEqual({ role });
    });

    test('classifies an active top-frame supported content sender', () => {
        const result = classifyExtensionMessageSender(
            createContentSender(),
            createRuntime()
        );

        expect(result).toMatchObject({
            role: MessageSenderRoles.CONTENT,
            platform: 'netflix',
            tabId: 12,
            windowId: 3,
            documentId: 'document-1',
            frameId: 0,
        });
        expect(Object.isFrozen(result)).toBe(true);
    });

    test.each([
        ['wrong extension', { id: 'other-extension' }],
        ['subframe', { frameId: 1 }],
        ['inactive document', { documentLifecycle: 'cached' }],
        [
            'unsupported site',
            {
                url: 'https://example.com/watch/1',
                origin: 'https://example.com',
                tab: {
                    id: 12,
                    windowId: 3,
                    active: true,
                    url: 'https://example.com/watch/1',
                },
            },
        ],
        [
            'tab mismatch',
            {
                tab: {
                    id: 12,
                    windowId: 3,
                    active: true,
                    url: 'https://www.disneyplus.com/video/1',
                },
            },
        ],
    ])('rejects a %s sender', (_label, overrides) => {
        expect(
            classifyExtensionMessageSender(
                createContentSender(overrides),
                createRuntime()
            )
        ).toBeNull();
    });
});

describe('translation protocol', () => {
    test('builds and parses the semantic request', () => {
        const request = buildTranslationRequestMessage({
            ...translationInput,
            ignored: true,
        });

        expect(request).toEqual({
            action: MessageActions.TRANSLATE,
            ...translationInput,
        });
        expect(parseTranslationRequestMessage(request)).toEqual(request);
        expect(parseTranslationRequestMessage(withExtra(request))).toBeNull();
    });

    test.each([
        { ...translationInput, text: '' },
        { ...translationInput, targetLang: ' en ' },
        { ...translationInput, cueStart: -1 },
        { ...translationInput, cueVideoId: '' },
    ])('rejects invalid request values %#', (input) => {
        expect(() => buildTranslationRequestMessage(input)).toThrow(TypeError);
    });

    test('uses minimal response wires and reconstructs local cue context', () => {
        const request = buildTranslationRequestMessage(translationInput);
        const success = buildTranslationSuccessResponse(request, {
            translatedText: 'Hello',
            cached: true,
            processingTime: 8,
        });
        const failure = buildTranslationFailureResponse(request, {
            retryable: true,
            retryAfter: 100,
        });

        expect(success).toEqual({ translatedText: 'Hello' });
        expect(failure).toEqual({ error: 'Translation failed' });
        expect(parseTranslationResponseMessage(success, request)).toEqual({
            status: 'success',
            translatedText: 'Hello',
            cueVideoId: 'video-1',
        });
        expect(parseTranslationResponseMessage(failure, request)).toEqual({
            status: 'failure',
            error: 'Translation failed',
            cueVideoId: 'video-1',
        });
    });

    test('rejects malformed or expanded response wires', () => {
        const request = buildTranslationRequestMessage(translationInput);
        expect(
            parseTranslationResponseMessage(
                { translatedText: 'Hello', cached: false },
                request
            )
        ).toBeNull();
        expect(
            parseTranslationResponseMessage({ error: 'Other' }, request)
        ).toBeNull();
    });
});

describe('analyze-context protocol', () => {
    test.each([
        [MessageSenderRoles.CONTENT, contentAnalysisInput],
        [MessageSenderRoles.SIDEPANEL, sidePanelAnalysisInput],
    ])('builds and parses a %s request', (role, input) => {
        const request = buildAnalyzeContextRequestMessage(role, {
            ...input,
            ignored: true,
        });

        expect(request.action).toBe(MessageActions.ANALYZE_CONTEXT);
        expect(request.contextTypes).toEqual(input.contextTypes);
        expect(request).not.toHaveProperty('contextType');
        expect(parseAnalyzeContextRequestMessage(request, role)).toEqual(
            request
        );
        expect(
            parseAnalyzeContextRequestMessage(
                request,
                role === MessageSenderRoles.CONTENT
                    ? MessageSenderRoles.SIDEPANEL
                    : MessageSenderRoles.CONTENT
            )
        ).toBeNull();
        expect(
            parseAnalyzeContextRequestMessage(withExtra(request), role)
        ).toBeNull();
    });

    test('normalizes builder context types while requiring canonical inbound types', () => {
        const request = buildAnalyzeContextRequestMessage(
            MessageSenderRoles.CONTENT,
            {
                ...contentAnalysisInput,
                contextTypes: ['cultural', 'invalid', 'cultural'],
            }
        );
        expect(request.contextTypes).toEqual(['cultural']);

        expect(
            parseAnalyzeContextRequestMessage(
                { ...request, contextTypes: ['cultural', 'cultural'] },
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
    });

    test.each([
        [MessageSenderRoles.CONTENT, contentAnalysisInput],
        [MessageSenderRoles.SIDEPANEL, sidePanelAnalysisInput],
    ])('uses minimal %s response wires', (role, input) => {
        const request = buildAnalyzeContextRequestMessage(role, input);
        const analysis = { summary: 'An idiomatic phrase.' };
        const success = buildAnalyzeContextSuccessResponse(role, request, {
            analysis,
        });
        const failure = buildAnalyzeContextFailureResponse(role, request, {
            error: 'Context analysis failed',
            shouldRetry: false,
        });

        expect(success).toEqual({
            success: true,
            result: { analysis },
        });
        expect(success).not.toHaveProperty('requestId');
        expect(success.result).not.toHaveProperty('contextTypes');
        expect(failure).toEqual({
            success: false,
            error: 'Context analysis failed',
            shouldRetry: false,
        });

        expect(
            parseAnalyzeContextResponseMessage(success, request, role)
        ).toEqual({
            status: 'success',
            requestId: input.requestId,
            result: {
                analysis,
                contextType:
                    input.contextTypes.length === 1
                        ? input.contextTypes[0]
                        : 'combined',
                contextTypes: input.contextTypes,
                isStructured: true,
            },
        });
        expect(
            parseAnalyzeContextResponseMessage(failure, request, role)
        ).toEqual({
            status: 'failure',
            requestId: input.requestId,
            error: 'Context analysis failed',
            shouldRetry: false,
        });
    });

    test('detaches analysis data and rejects expanded response records', () => {
        const request = buildAnalyzeContextRequestMessage(
            MessageSenderRoles.CONTENT,
            contentAnalysisInput
        );
        const analysis = { nested: { value: 'before' } };
        const response = buildAnalyzeContextSuccessResponse(
            MessageSenderRoles.CONTENT,
            request,
            { analysis }
        );
        analysis.nested.value = 'after';

        expect(response.result.analysis.nested.value).toBe('before');
        expect(Object.isFrozen(response.result.analysis.nested)).toBe(true);
        expect(
            parseAnalyzeContextResponseMessage(
                withExtra(response),
                request,
                MessageSenderRoles.CONTENT
            )
        ).toBeNull();
    });
});

describe('content-control and readiness responses', () => {
    test.each([
        buildConfigChangedRequestMessage({ enabled: true }),
        buildLoggingLevelChangedRequestMessage(2),
        buildSidePanelPauseVideoRequestMessage(),
    ])('does not echo the request action', (request) => {
        const success = buildContentControlResponseMessage(request, {
            success: true,
        });
        const failure = buildContentControlResponseMessage(request, {
            success: false,
            error: 'Update failed',
        });

        expect(success).toEqual({ success: true });
        expect(failure).toEqual({ success: false, error: 'Update failed' });
        expect(parseContentControlResponseMessage(success, request)).toEqual({
            action: request.action,
            success: true,
        });
        expect(parseContentControlResponseMessage(failure, request)).toEqual({
            action: request.action,
            success: false,
            error: 'Update failed',
        });
    });

    test('preserves config snapshot semantics', () => {
        const changes = { enabled: true, nested: { size: 2 } };
        const request = buildConfigChangedRequestMessage(changes);
        changes.nested.size = 3;

        expect(request.changes).toEqual({
            enabled: true,
            nested: { size: 2 },
        });
        expect(Object.isFrozen(request.changes.nested)).toBe(true);
        expect(() => buildConfigChangedRequestMessage({})).toThrow(TypeError);
        expect(() =>
            buildConfigChangedRequestMessage({ invalid: Number.NaN })
        ).toThrow(TypeError);
    });
});

describe('side-panel word and selection snapshot protocol', () => {
    test('round-trips word intent options', () => {
        const message = buildSidePanelWordIntentMessage({
            autoOpen: true,
            pauseVideo: false,
            ignored: true,
        });

        expect(message).toEqual({
            action: MessageActions.SIDEPANEL_WORD_SELECTED,
            options: { autoOpen: true, pauseVideo: false },
        });
        expect(parseSidePanelWordIntentMessage(message)).toEqual(message);
        expect(parseSidePanelWordIntentMessage(withExtra(message))).toBeNull();
    });

    test('round-trips a bounded content selection', () => {
        const message = buildSidePanelContentSelectionSnapshotMessage({
            ...contentSelection,
            ignored: true,
        });
        const parsed = parseSidePanelContentSelectionSnapshotMessage(message);

        expect(parsed).toEqual(contentSelection);
        expect(Object.isFrozen(parsed.entries)).toBe(true);
        expect(
            parseSidePanelContentSelectionSnapshotMessage(withExtra(message))
        ).toBeNull();
    });

    test.each([
        { ...contentSelection, lifecycleGeneration: 0 },
        { ...contentSelection, reason: 'unknown' },
        { ...contentSelection, reason: 'clear' },
        {
            ...contentSelection,
            entries: [
                { wordIndex: 4, word: 'monde' },
                { wordIndex: 1, word: 'bonjour' },
            ],
        },
    ])('rejects an invalid selection snapshot %#', (snapshot) => {
        expect(() =>
            buildSidePanelContentSelectionSnapshotMessage(snapshot)
        ).toThrow(TypeError);
    });

    test.each([
        ['accepted', true],
        ['rejected', false],
    ])('round-trips a %s acknowledgement', (status, success) => {
        const response = buildSidePanelContentSelectionSnapshotResponse(status);
        expect(response).toEqual({ success });
        expect(
            parseSidePanelContentSelectionSnapshotResponse(response)
        ).toEqual({ status });
    });
});

describe('side-panel binding and state protocol', () => {
    test.each([selectionState, null])(
        'round-trips a selection state %#',
        (selection) => {
            const message = buildSidePanelSelectionStateMessage(
                binding,
                selection
            );
            expect(
                parseSidePanelSelectionStateMessage(message, binding)
            ).toEqual({ binding, selection });
            expect(
                parseSidePanelSelectionStateMessage(message, {
                    ...binding,
                    registrationId: 8,
                })
            ).toBeNull();
        }
    );

    test('keeps republish correlation in the request, not the direct response', () => {
        const request = buildSidePanelSelectionRepublishRequestMessage(17);
        const parsedRequest =
            parseSidePanelSelectionRepublishRequestMessage(request);
        const response = buildSidePanelSelectionRepublishAck(parsedRequest);

        expect(request.data).toEqual({ requestId: 17 });
        expect(response).toEqual({ success: true });
        expect(
            parseSidePanelSelectionRepublishAck(response, request.data)
        ).toEqual({ requestId: 17 });
        expect(
            parseSidePanelSelectionRepublishAck(
                { success: true, requestId: 17 },
                request.data
            )
        ).toBeNull();
    });

    test.each([
        [
            buildSidePanelTabActivatedMessage,
            parseSidePanelTabActivatedMessage,
            MessageActions.SIDEPANEL_TAB_ACTIVATED,
        ],
        [
            buildSidePanelForceBindTabMessage,
            parseSidePanelForceBindTabMessage,
            MessageActions.SIDEPANEL_FORCE_BIND_TAB,
        ],
    ])('round-trips a tab-binding message', (build, parse, action) => {
        const message = build({ tabId: 12, windowId: 3, ignored: true });
        expect(message).toEqual({
            action,
            data: { tabId: 12, windowId: 3 },
        });
        expect(parse(message)).toEqual({ tabId: 12, windowId: 3 });
    });

    test('round-trips registration and binding confirmation', () => {
        const registration = buildSidePanelRegistrationMessage(binding, 100);
        const confirmation = buildSidePanelBindingConfirmationMessage(binding);

        expect(parseSidePanelRegistrationMessage(registration)).toEqual(
            binding
        );
        expect(parseSidePanelBindingConfirmationMessage(confirmation)).toEqual(
            binding
        );
        expect(
            parseSidePanelRegistrationMessage(withExtra(registration))
        ).toBeNull();
    });
});

describe('side-panel removal protocol', () => {
    test('round-trips the asynchronous panel request', () => {
        const message = buildSidePanelSelectionRemovalRequestMessage({
            ...removalInput,
            ignored: true,
        });
        expect(parseSidePanelSelectionRemovalRequestMessage(message)).toEqual(
            removalInput
        );
    });

    test('does not echo direct command correlation in its response', () => {
        const command = buildSidePanelSelectionRemovalCommandMessage(
            removalInput,
            2
        );
        const parsedCommand =
            parseSidePanelSelectionRemovalCommandMessage(command);
        const response = buildSidePanelSelectionRemovalCommandResponse(
            parsedCommand,
            'applied'
        );

        expect(response).toEqual({ success: true });
        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                response,
                command.data
            )
        ).toEqual({ requestId: 11, status: 'applied' });
        expect(
            parseSidePanelSelectionRemovalCommandResponse(
                { success: true, requestId: 11 },
                command.data
            )
        ).toBeNull();
    });

    test.each(['applied', 'rejected'])(
        'keeps %s correlation on the asynchronous port result',
        (status) => {
            const result = buildSidePanelSelectionRemovalResultMessage(
                removalInput,
                status
            );
            expect(result.data).toMatchObject({
                binding,
                requestId: 11,
                selectionOwnerGeneration: 9,
                status,
            });
            expect(
                parseSidePanelSelectionRemovalResultMessage(
                    result,
                    removalInput
                )
            ).toEqual(result.data);
            expect(
                parseSidePanelSelectionRemovalResultMessage(result, {
                    ...removalInput,
                    requestId: 12,
                })
            ).toBeNull();
        }
    );
});
