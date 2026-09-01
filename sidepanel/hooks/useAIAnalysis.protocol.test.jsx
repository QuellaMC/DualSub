import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

const sendRuntimeMessageWithRetry = jest.fn();
const useSettings = jest.fn(() => settingsState);
const contextState = {};
const settingsState = {};

jest.unstable_mockModule('./SidePanelContext.jsx', () => ({
    useSidePanelContext: () => contextState,
}));
jest.unstable_mockModule('./useSettings.js', () => ({
    useSettings,
}));
jest.unstable_mockModule('../../content_scripts/shared/messaging.js', () => ({
    sendRuntimeMessageWithRetry,
}));

const { useAIAnalysis } = await import('./useAIAnalysis.js');

function createCanonicalSuccess(_message, analysis) {
    return {
        success: true,
        result: { analysis },
    };
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('useAIAnalysis side-panel protocol', () => {
    beforeEach(() => {
        Object.assign(contextState, {
            activeTabId: 7,
            analysisResult: null,
            error: null,
            isAnalyzing: false,
            selection: {
                selectionOwnerGeneration: 3,
                selectionRevision: 4,
                renderRevision: 5,
                reason: 'add',
                entries: [
                    { wordIndex: 1, word: 'very' },
                    { wordIndex: 2, word: 'very' },
                    { wordIndex: 3, word: 'good' },
                ],
            },
            selectedWords: ['very', 'very', 'good'],
            targetLanguage: 'legacy-context-language',
            updateTabState: jest.fn(),
        });
        Object.assign(settingsState, {
            error: null,
            loading: false,
            settings: {
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                aiContextTypes: ['cultural'],
                targetLanguage: 'es',
            },
        });
        chrome.i18n = {
            getMessage: jest.fn((key) => key),
        };
    });

    test('requests target language through the authoritative settings projection', () => {
        renderHook(() => useAIAnalysis());

        expect(useSettings).toHaveBeenCalledWith([
            'aiContextEnabled',
            'aiContextProvider',
            'aiContextTypes',
            'targetLanguage',
        ]);
    });

    test.each([
        ['loading', { loading: true }],
        ['failure', { error: new Error('settings unavailable') }],
    ])(
        'does not dispatch while settings are in %s state',
        async (_label, state) => {
            Object.assign(settingsState, state);
            const { result } = renderHook(() => useAIAnalysis());

            await act(async () => {
                expect(await result.current.analyzeWords()).toBeNull();
            });

            expect(sendRuntimeMessageWithRetry).not.toHaveBeenCalled();
        }
    );

    test('uses the latest authoritative target language on the first permitted request', async () => {
        settingsState.loading = true;
        const { result, rerender } = renderHook(() => useAIAnalysis());

        await act(async () => {
            expect(await result.current.analyzeWords()).toBeNull();
        });
        expect(sendRuntimeMessageWithRetry).not.toHaveBeenCalled();

        settingsState.loading = false;
        settingsState.settings = {
            ...settingsState.settings,
            targetLanguage: 'fr',
        };
        sendRuntimeMessageWithRetry.mockImplementation((message) =>
            Promise.resolve(
                createCanonicalSuccess(message, { definition: 'fresh' })
            )
        );
        rerender();

        await act(async () => {
            await result.current.analyzeWords();
        });

        expect(
            sendRuntimeMessageWithRetry.mock.calls[0][0].targetLanguage
        ).toBe('fr');
    });

    test('clears active results and revokes in-flight work when authoritative target language changes', async () => {
        const pending = createDeferred();
        let dispatchedRequest;
        let dispatchOptions;
        contextState.analysisResult = { definition: 'old-language result' };
        contextState.error = 'old-language error';
        sendRuntimeMessageWithRetry.mockImplementation((message, options) => {
            dispatchedRequest = message;
            dispatchOptions = options;
            return pending.promise;
        });
        const { result, rerender } = renderHook(() => useAIAnalysis());

        let analysisPromise;
        await act(async () => {
            analysisPromise = result.current.analyzeWords();
            await Promise.resolve();
        });
        expect(dispatchOptions.canDispatch()).toBe(true);
        contextState.updateTabState.mockClear();

        settingsState.settings = {
            ...settingsState.settings,
            targetLanguage: 'fr',
        };
        rerender();
        await act(async () => Promise.resolve());

        expect(dispatchOptions.canDispatch()).toBe(false);
        expect(contextState.updateTabState).toHaveBeenCalledWith(7, {
            analysisResult: null,
            error: null,
        });

        await act(async () => {
            pending.resolve(
                createCanonicalSuccess(dispatchedRequest, {
                    definition: 'stale result',
                })
            );
            expect(await analysisPromise).toBeNull();
        });
        expect(contextState.updateTabState).not.toHaveBeenCalledWith(7, {
            analysisResult: { definition: 'stale result' },
            error: null,
        });
    });

    test('sends one exact singleton request and commits only its correlated detached success', async () => {
        const analysis = {
            definition: 'intensified phrase',
            details: { source: 'trusted response' },
        };
        let dispatchedRequest;
        let dispatchOptions;
        sendRuntimeMessageWithRetry.mockImplementation((message, options) => {
            dispatchedRequest = message;
            dispatchOptions = options;
            return Promise.resolve(createCanonicalSuccess(message, analysis));
        });
        const { result } = renderHook(() => useAIAnalysis());

        let returnedAnalysis;
        await act(async () => {
            returnedAnalysis = await result.current.analyzeWords();
        });

        expect(dispatchedRequest).toEqual({
            action: 'analyzeContext',
            text: 'very very good',
            contextTypes: ['cultural'],
            targetLanguage: 'es',
            requestId: expect.stringMatching(/^sidepanel-\d+-1$/),
        });
        expect(Reflect.ownKeys(dispatchedRequest)).toEqual([
            'action',
            'text',
            'contextTypes',
            'targetLanguage',
            'requestId',
        ]);
        expect(Object.isFrozen(dispatchedRequest)).toBe(true);
        expect(Object.isFrozen(dispatchedRequest.contextTypes)).toBe(true);
        expect(dispatchOptions).toEqual({
            retries: 0,
            canDispatch: expect.any(Function),
        });
        expect(dispatchOptions.canDispatch()).toBe(false);
        expect(returnedAnalysis).toEqual(analysis);
        expect(returnedAnalysis).not.toBe(analysis);
        expect(returnedAnalysis.details).not.toBe(analysis.details);
        analysis.definition = 'mutated';
        analysis.details.source = 'mutated';
        expect(returnedAnalysis).toEqual({
            definition: 'intensified phrase',
            details: { source: 'trusted response' },
        });
        expect(contextState.updateTabState).toHaveBeenCalledWith(7, {
            analysisResult: returnedAnalysis,
            error: null,
        });
        expect(sendRuntimeMessageWithRetry).toHaveBeenCalledTimes(1);
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('preserves an exact multi-type subset without adding a synthetic context type', async () => {
        settingsState.settings.aiContextTypes = ['cultural', 'linguistic'];
        sendRuntimeMessageWithRetry.mockImplementation((message) =>
            Promise.resolve(
                createCanonicalSuccess(message, {
                    definition: 'combined result',
                })
            )
        );
        const { result } = renderHook(() => useAIAnalysis());

        await act(async () => {
            await result.current.analyzeWords(['first', 'first']);
        });

        const message = sendRuntimeMessageWithRetry.mock.calls[0][0];
        expect(message).toEqual({
            action: 'analyzeContext',
            text: 'first first',
            contextTypes: ['cultural', 'linguistic'],
            targetLanguage: 'es',
            requestId: expect.stringMatching(/^sidepanel-\d+-1$/),
        });
        expect(message).not.toHaveProperty('contextType');
        expect(Object.isFrozen(message)).toBe(true);
        expect(Object.isFrozen(message.contextTypes)).toBe(true);
    });

    test.each([
        [
            'outer extra field',
            (message) => ({
                ...createCanonicalSuccess(message, { definition: 'extra' }),
                extra: true,
            }),
        ],
        [
            'result extra field',
            (message) => {
                const response = createCanonicalSuccess(message, {
                    definition: 'extra',
                });
                response.result.extra = true;
                return response;
            },
        ],
        [
            'non-record analysis',
            (message) => createCanonicalSuccess(message, 'invalid'),
        ],
    ])('rejects a %s with one generic local failure', async (_label, reply) => {
        sendRuntimeMessageWithRetry.mockImplementation((message) =>
            Promise.resolve(reply(message))
        );
        const { result } = renderHook(() => useAIAnalysis());

        let returnedAnalysis;
        await act(async () => {
            returnedAnalysis = await result.current.analyzeWords(['word']);
        });

        expect(returnedAnalysis).toBeNull();
        expect(contextState.updateTabState).toHaveBeenCalledWith(7, {
            error: 'sidepanelErrorGeneric',
        });
        expect(contextState.updateTabState).not.toHaveBeenCalledWith(
            7,
            expect.objectContaining({
                analysisResult: expect.objectContaining({
                    definition: expect.any(String),
                }),
            })
        );
        expect(sendRuntimeMessageWithRetry).toHaveBeenCalledTimes(1);
    });

    test.each([
        [
            'canonical failure',
            (_message, secret) =>
                Promise.resolve({
                    success: false,
                    error: secret,
                    shouldRetry: true,
                }),
        ],
        [
            'transport exception',
            (_message, secret) => Promise.reject(new Error(secret)),
        ],
    ])(
        'does not expose or redispatch a secret from a %s',
        async (_label, createReply) => {
            const secret = 'secret-provider-endpoint-and-key';
            sendRuntimeMessageWithRetry.mockImplementation((message) =>
                createReply(message, secret)
            );
            const { result } = renderHook(() => useAIAnalysis());

            let returnedAnalysis;
            await act(async () => {
                returnedAnalysis = await result.current.analyzeWords(['word']);
            });

            expect(returnedAnalysis).toBeNull();
            expect(contextState.updateTabState).toHaveBeenCalledWith(7, {
                error: 'sidepanelErrorGeneric',
            });
            expect(sendRuntimeMessageWithRetry).toHaveBeenCalledTimes(1);
            expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
            expect(
                JSON.stringify([
                    ...console.error.mock.calls,
                    ...console.warn.mock.calls,
                    ...contextState.updateTabState.mock.calls,
                ])
            ).not.toContain(secret);
        }
    );

    test('invalidates dispatch authority and ignores a late success after configuration changes', async () => {
        const pending = createDeferred();
        let dispatchedRequest;
        let dispatchOptions;
        sendRuntimeMessageWithRetry.mockImplementation((message, options) => {
            dispatchedRequest = message;
            dispatchOptions = options;
            return pending.promise;
        });
        const { result, rerender } = renderHook(() => useAIAnalysis());

        let analysisPromise;
        await act(async () => {
            analysisPromise = result.current.analyzeWords(['word']);
            await Promise.resolve();
        });
        expect(sendRuntimeMessageWithRetry).toHaveBeenCalledTimes(1);
        expect(dispatchOptions.canDispatch()).toBe(true);

        settingsState.settings = {
            ...settingsState.settings,
            aiContextProvider: 'gemini',
        };
        rerender();
        await act(async () => Promise.resolve());

        expect(dispatchOptions.canDispatch()).toBe(false);
        await act(async () => {
            pending.resolve(
                createCanonicalSuccess(dispatchedRequest, {
                    definition: 'obsolete result',
                })
            );
            expect(await analysisPromise).toBeNull();
        });
        expect(contextState.updateTabState).not.toHaveBeenCalledWith(7, {
            analysisResult: { definition: 'obsolete result' },
            error: null,
        });
        expect(sendRuntimeMessageWithRetry).toHaveBeenCalledTimes(1);
    });

    test('invalidates a pending request when canonical occurrence authority changes without changing words', async () => {
        const pending = createDeferred();
        let dispatchedRequest;
        let dispatchOptions;
        sendRuntimeMessageWithRetry.mockImplementation((message, options) => {
            dispatchedRequest = message;
            dispatchOptions = options;
            return pending.promise;
        });
        const { result, rerender } = renderHook(() => useAIAnalysis());

        let analysisPromise;
        await act(async () => {
            analysisPromise = result.current.analyzeWords();
            await Promise.resolve();
        });
        expect(sendRuntimeMessageWithRetry).toHaveBeenCalledTimes(1);
        expect(dispatchOptions.canDispatch()).toBe(true);

        contextState.selection = {
            selectionOwnerGeneration: 3,
            selectionRevision: 6,
            renderRevision: 7,
            reason: 'toggle',
            entries: [
                { wordIndex: 8, word: 'very' },
                { wordIndex: 9, word: 'very' },
                { wordIndex: 10, word: 'good' },
            ],
        };
        contextState.selectedWords = ['very', 'very', 'good'];
        rerender();
        await act(async () => Promise.resolve());

        expect(dispatchOptions.canDispatch()).toBe(false);
        await act(async () => {
            pending.resolve(
                createCanonicalSuccess(dispatchedRequest, {
                    definition: 'stale occurrence result',
                })
            );
            expect(await analysisPromise).toBeNull();
        });
        expect(contextState.updateTabState).not.toHaveBeenCalledWith(7, {
            analysisResult: { definition: 'stale occurrence result' },
            error: null,
        });
        expect(sendRuntimeMessageWithRetry).toHaveBeenCalledTimes(1);
    });
});
