import { jest } from '@jest/globals';
import { Suspense, startTransition, useLayoutEffect, useState } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';

const configService = {
    getAll: jest.fn().mockResolvedValue({ openaiModel: 'initial' }),
    get: jest.fn(),
    getMultiple: jest.fn(),
    onChanged: jest.fn().mockReturnValue(() => {}),
    readAllResultStrict: jest.fn(),
    readMultipleResultStrict: jest.fn(),
    set: jest.fn(),
    setMultiple: jest.fn(),
};
const isSensitiveAccessExplicitlyEnabled = jest.fn().mockReturnValue(false);

jest.unstable_mockModule('../../services/configService.js', () => ({
    configService,
    isSensitiveAccessExplicitlyEnabled,
}));

const { useSettings } = await import('./useSettings.js');

const SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE =
    'Unable to validate loaded settings.';

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function resolveSingleWriteAfter(deferred) {
    return async (_key, value) => {
        await deferred.promise;
        return value;
    };
}

function resolveBatchWriteAfter(deferred) {
    return async (updates) => {
        await deferred.promise;
        return Object.fromEntries(Object.entries(updates));
    };
}

function mockUnkeyedInitialValues(values) {
    configService.readAllResultStrict.mockResolvedValue({ values });
}

function mockUnkeyedInitialRead(readValues) {
    configService.readAllResultStrict.mockImplementation(async () => ({
        values: await readValues(),
    }));
}

function queueProjectedInitialValues(values) {
    configService.readMultipleResultStrict.mockResolvedValueOnce({ values });
}

function queueProjectedInitialRead(readValues) {
    configService.readMultipleResultStrict.mockImplementationOnce(
        async (requestedKeys) => ({ values: await readValues(requestedKeys) })
    );
}

function mockProjectedReads(readValues) {
    configService.readMultipleResultStrict.mockImplementation(
        async (requestedKeys) => ({ values: await readValues(requestedKeys) })
    );
}

function expectOnlyNormalizedInitialLoadErrorLog(
    consoleError,
    forbiddenTexts = []
) {
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toEqual([
        'Settings initial load failed.',
    ]);

    const representations = consoleError.mock.calls.flat();
    for (const forbiddenText of forbiddenTexts) {
        for (const representation of representations) {
            expect(representation).not.toContain(forbiddenText);
        }
    }
}

function expectOnlyFixedLog(consoleError, message) {
    expect(consoleError.mock.calls).toEqual([[message]]);
}

function createHostileDelegatedError(secretLabel) {
    const getterReads = jest.fn();
    const delegatedError = {};
    for (const key of [
        'name',
        'message',
        'stack',
        'toString',
        'toJSON',
        Symbol.toPrimitive,
    ]) {
        Object.defineProperty(delegatedError, key, {
            configurable: true,
            get() {
                getterReads(key);
                throw new Error(`must not inspect ${secretLabel}`);
            },
        });
    }
    return { delegatedError, getterReads };
}

function createPrototypeSensitiveSettings(label) {
    return JSON.parse(
        `{"__proto__":{"polluted":"${label}"},"constructor":"${label}-constructor","toString":"${label}-toString"}`
    );
}

function expectPrototypeSafeSettings(settings, label) {
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
    expect(settings.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(
        Object.getOwnPropertyDescriptor(settings, '__proto__')?.value
    ).toEqual({ polluted: label });
    expect(
        Object.getOwnPropertyDescriptor(settings, 'constructor')?.value
    ).toBe(`${label}-constructor`);
    expect(Object.getOwnPropertyDescriptor(settings, 'toString')?.value).toBe(
        `${label}-toString`
    );
}

describe('useSettings write ordering', () => {
    beforeEach(() => {
        isSensitiveAccessExplicitlyEnabled.mockReset().mockReturnValue(false);
        configService.getAll.mockReset().mockResolvedValue({
            openaiModel: 'initial',
        });
        configService.get.mockReset();
        configService.getMultiple.mockReset();
        configService.onChanged.mockReset().mockReturnValue(() => {});
        configService.readAllResultStrict
            .mockReset()
            .mockResolvedValue({ values: { openaiModel: 'initial' } });
        configService.readMultipleResultStrict
            .mockReset()
            .mockResolvedValue({ values: {} });
        configService.set
            .mockReset()
            .mockImplementation(async (_key, value) => value);
        configService.setMultiple
            .mockReset()
            .mockImplementation(async (updates) => ({ ...updates }));
    });

    test('promotes the canonical single-write result without a storage event', async () => {
        queueProjectedInitialValues({ targetLanguage: 'fr' });
        configService.set.mockResolvedValue('en-US');
        const { result } = renderHook(() => useSettings(['targetLanguage']));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateSetting('targetLanguage', 'EN-us');
        });

        expect(configService.set).toHaveBeenCalledWith(
            'targetLanguage',
            'EN-us'
        );
        expect(result.current.settings).toEqual({ targetLanguage: 'en-US' });
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
    });

    test('reconciles an unconfirmed single-write result without retaining raw input', async () => {
        const persistedReadback = createDeferred();
        queueProjectedInitialValues({ targetLanguage: 'fr' });
        configService.readMultipleResultStrict.mockImplementationOnce(
            async () => ({ values: await persistedReadback.promise })
        );
        configService.set.mockResolvedValue(undefined);
        const { result } = renderHook(() => useSettings(['targetLanguage']));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        await act(async () => {
            updateResult = await result.current.updateSetting(
                'targetLanguage',
                'EN-us'
            );
        });

        expect(updateResult).toBe(true);
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(2);
        expect(configService.readMultipleResultStrict).toHaveBeenLastCalledWith(
            ['targetLanguage'],
            { includeSensitive: false }
        );
        expect(result.current.settings).toEqual({ targetLanguage: 'fr' });

        await act(async () => {
            persistedReadback.resolve({ targetLanguage: 'en-US' });
            await persistedReadback.promise;
        });
        await waitFor(() =>
            expect(result.current.settings).toEqual({
                targetLanguage: 'en-US',
            })
        );
    });

    test('promotes the canonical batch result without a storage event', async () => {
        queueProjectedInitialValues({
            targetLanguage: 'fr',
            openaiCompatibleBaseUrl: 'https://old.example.test/v1',
        });
        configService.setMultiple.mockResolvedValue({
            targetLanguage: 'en-US',
            openaiCompatibleBaseUrl: 'https://models.example.test/v1',
        });
        const { result } = renderHook(() =>
            useSettings(['targetLanguage', 'openaiCompatibleBaseUrl'])
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateSettings({
                targetLanguage: 'EN-us',
                openaiCompatibleBaseUrl:
                    'https://MODELS.EXAMPLE.TEST:443/v1///',
            });
        });

        expect(configService.setMultiple).toHaveBeenCalledWith({
            targetLanguage: 'EN-us',
            openaiCompatibleBaseUrl: 'https://MODELS.EXAMPLE.TEST:443/v1///',
        });
        expect(result.current.settings).toEqual({
            targetLanguage: 'en-US',
            openaiCompatibleBaseUrl: 'https://models.example.test/v1',
        });
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['an undefined result', undefined],
        ['an incomplete projection', { targetLanguage: 'en-US' }],
    ])(
        'reconciles %s without retaining raw batch inputs',
        async (_label, writeResult) => {
            const persistedReadback = createDeferred();
            queueProjectedInitialValues({
                targetLanguage: 'fr',
                openaiCompatibleBaseUrl: 'https://old.example.test/v1',
            });
            configService.readMultipleResultStrict.mockImplementationOnce(
                async () => ({ values: await persistedReadback.promise })
            );
            configService.setMultiple.mockResolvedValue(writeResult);
            const { result } = renderHook(() =>
                useSettings(['targetLanguage', 'openaiCompatibleBaseUrl'])
            );
            await waitFor(() => expect(result.current.loading).toBe(false));

            let updateResult;
            await act(async () => {
                updateResult = await result.current.updateSettings({
                    targetLanguage: 'EN-us',
                    openaiCompatibleBaseUrl:
                        'https://MODELS.EXAMPLE.TEST:443/v1///',
                });
            });

            expect(updateResult).toBe(true);
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2);
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenLastCalledWith(
                ['targetLanguage', 'openaiCompatibleBaseUrl'],
                { includeSensitive: false }
            );
            expect(result.current.settings).toEqual({
                targetLanguage: 'fr',
                openaiCompatibleBaseUrl: 'https://old.example.test/v1',
            });

            await act(async () => {
                persistedReadback.resolve({
                    targetLanguage: 'en-US',
                    openaiCompatibleBaseUrl: 'https://models.example.test/v1',
                });
                await persistedReadback.promise;
            });
            await waitFor(() =>
                expect(result.current.settings).toEqual({
                    targetLanguage: 'en-US',
                    openaiCompatibleBaseUrl: 'https://models.example.test/v1',
                })
            );
        }
    );

    test('publishes an unkeyed strict-read failure instead of accepting legacy defaults as authority', async () => {
        const strictReadError = new Error('storage unavailable');
        configService.readAllResultStrict.mockRejectedValue(strictReadError);
        configService.getAll.mockResolvedValue({ subtitlesEnabled: true });

        const { result } = renderHook(() => useSettings());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(configService.readAllResultStrict).toHaveBeenCalledWith({
            includeSensitive: false,
        });
        expect(configService.onChanged).toHaveBeenCalledWith(
            expect.any(Function),
            { includeSensitive: false }
        );
        expect(configService.getAll).not.toHaveBeenCalled();
        expect(result.current.settings).toEqual({});
        expect(result.current.initialLoadStatus).toBe('unavailable');
        expect(result.current.error).toBe(strictReadError);
    });

    test.each([
        {
            label: 'string',
            requestedKeys: 'uiLanguage',
            strictKeys: ['uiLanguage'],
            values: { uiLanguage: 'fr' },
        },
        {
            label: 'array',
            requestedKeys: ['uiLanguage', 'debugMode'],
            strictKeys: ['uiLanguage', 'debugMode'],
            values: { uiLanguage: 'fr', debugMode: true },
        },
        {
            label: 'empty-array',
            requestedKeys: [],
            strictKeys: [],
            values: {},
        },
    ])(
        'loads a $label projection through exact strict acquisition without legacy getters',
        async ({ requestedKeys, strictKeys, values }) => {
            configService.get.mockResolvedValue('legacy-string-value');
            configService.getMultiple.mockResolvedValue({
                uiLanguage: 'legacy-array-value',
                debugMode: false,
            });
            configService.readMultipleResultStrict.mockResolvedValue({
                values,
            });

            const { result } = renderHook(() => useSettings(requestedKeys));

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(configService.readMultipleResultStrict.mock.calls).toEqual([
                [strictKeys, { includeSensitive: false }],
            ]);
            expect(configService.readAllResultStrict).not.toHaveBeenCalled();
            expect(configService.get).not.toHaveBeenCalled();
            expect(configService.getMultiple).not.toHaveBeenCalled();
            expect(configService.getAll).not.toHaveBeenCalled();
            expect(result.current.settings).toEqual(values);
            expect(result.current.initialLoadStatus).toBe('ready');
            expect(result.current.error).toBeNull();
        }
    );

    test('treats normalized sensitivity as request identity without reloading an equivalent permission', async () => {
        const sensitiveLoad = createDeferred();
        const publicOptions = {};
        const sensitiveOptions = {};
        const equivalentSensitiveOptions = {};
        const firstUnsubscribe = jest.fn();
        const secondUnsubscribe = jest.fn();
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) =>
                candidate === sensitiveOptions ||
                candidate === equivalentSensitiveOptions
        );
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { uiLanguage: 'public' } })
            .mockImplementationOnce(async () => ({
                values: await sensitiveLoad.promise,
            }));
        configService.onChanged
            .mockReturnValueOnce(firstUnsubscribe)
            .mockReturnValueOnce(secondUnsubscribe);

        const { result, rerender } = renderHook(
            ({ settingsOptions }) =>
                useSettings(['uiLanguage'], settingsOptions),
            { initialProps: { settingsOptions: publicOptions } }
        );
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenLastCalledWith(
            ['uiLanguage'],
            { includeSensitive: false }
        );
        expect(configService.onChanged).toHaveBeenLastCalledWith(
            expect.any(Function),
            { includeSensitive: false }
        );

        rerender({ settingsOptions: sensitiveOptions });

        expect(result.current.loading).toBe(true);
        expect(result.current.initialLoadStatus).toBe('loading');
        expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        expect(configService.readMultipleResultStrict).toHaveBeenLastCalledWith(
            ['uiLanguage'],
            { includeSensitive: true }
        );
        expect(configService.onChanged).toHaveBeenLastCalledWith(
            expect.any(Function),
            { includeSensitive: true }
        );

        rerender({ settingsOptions: equivalentSensitiveOptions });
        expect(result.current.initialLoadStatus).toBe('loading');
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(2);
        expect(configService.onChanged).toHaveBeenCalledTimes(2);
        expect(secondUnsubscribe).not.toHaveBeenCalled();

        await act(async () => {
            sensitiveLoad.resolve({ uiLanguage: 'sensitive' });
        });
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );
        expect(result.current.settings).toEqual({ uiLanguage: 'sensitive' });
    });

    test.each(['ready', 'unavailable'])(
        'scrubs privileged authority and pending values before a public request becomes %s',
        async (publicOutcome) => {
            const sensitiveOptions = {};
            const publicOptions = {};
            const publicLoad = createDeferred();
            const privilegedWrite = createDeferred();
            const publicError = new Error('public strict read failed');
            const listeners = [];
            const firstUnsubscribe = jest.fn();
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            let setSettingsOptions;
            let currentHookState;
            let firedOldListenerAtPublicLayout = false;
            isSensitiveAccessExplicitlyEnabled.mockImplementation(
                (candidate) => candidate === sensitiveOptions
            );
            configService.readAllResultStrict
                .mockResolvedValueOnce({
                    values: {
                        secretSetting: 'privileged-authority',
                        uiLanguage: 'en',
                    },
                })
                .mockImplementationOnce(async () => ({
                    values: await publicLoad.promise,
                }));
            configService.set.mockImplementation(
                resolveSingleWriteAfter(privilegedWrite)
            );
            configService.onChanged.mockImplementation((listener) => {
                listeners.push(listener);
                return listeners.length === 1 ? firstUnsubscribe : () => {};
            });

            function PermissionProbe() {
                const [settingsOptions, setOptions] =
                    useState(sensitiveOptions);
                setSettingsOptions = setOptions;
                currentHookState = useSettings(undefined, settingsOptions);
                useLayoutEffect(() => {
                    if (
                        settingsOptions === publicOptions &&
                        !firedOldListenerAtPublicLayout
                    ) {
                        firedOldListenerAtPublicLayout = true;
                        listeners[0]({
                            secretSetting: 'old-listener-secret',
                        });
                    }
                }, [settingsOptions]);
                return (
                    <output data-testid="permission-settings">
                        {JSON.stringify({
                            settings: currentHookState.settings,
                            status: currentHookState.initialLoadStatus,
                        })}
                    </output>
                );
            }

            try {
                const view = render(<PermissionProbe />);
                await waitFor(() =>
                    expect(
                        JSON.parse(
                            view.getByTestId('permission-settings').textContent
                        )
                    ).toEqual({
                        settings: {
                            secretSetting: 'privileged-authority',
                            uiLanguage: 'en',
                        },
                        status: 'ready',
                    })
                );

                let writeResult;
                act(() => {
                    writeResult = currentHookState.updateSetting(
                        'secretSetting',
                        'privileged-pending'
                    );
                });
                await waitFor(() =>
                    expect(configService.set).toHaveBeenCalledTimes(1)
                );
                expect(currentHookState.settings.secretSetting).toBe(
                    'privileged-pending'
                );

                act(() => {
                    setSettingsOptions(publicOptions);
                });
                expect(firedOldListenerAtPublicLayout).toBe(true);
                expect(
                    JSON.parse(
                        view.getByTestId('permission-settings').textContent
                    )
                ).toEqual({ settings: {}, status: 'loading' });
                expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
                expect(
                    configService.readMultipleResultStrict
                ).not.toHaveBeenCalled();

                await act(async () => {
                    privilegedWrite.resolve();
                    await writeResult;
                });
                expect(currentHookState.settings).toEqual({});
                expect(currentHookState.initialLoadStatus).toBe('loading');

                act(() => {
                    if (publicOutcome === 'ready') {
                        publicLoad.resolve({ uiLanguage: 'public-authority' });
                    } else {
                        publicLoad.reject(publicError);
                    }
                });
                await waitFor(() =>
                    expect(currentHookState.initialLoadStatus).toBe(
                        publicOutcome
                    )
                );
                expect(currentHookState.settings).toEqual(
                    publicOutcome === 'ready'
                        ? { uiLanguage: 'public-authority' }
                        : {}
                );
                expect(currentHookState.settings.secretSetting).toBeUndefined();
                expect(configService.readAllResultStrict.mock.calls).toEqual([
                    [{ includeSensitive: true }],
                    [{ includeSensitive: false }],
                ]);
            } finally {
                consoleError.mockRestore();
            }
        }
    );

    test('masks a hostile privileged error in the immediate public transition render', async () => {
        const sensitiveOptions = {};
        const publicOptions = {};
        const publicLoad = createDeferred();
        const renderSnapshots = [];
        const { delegatedError, getterReads } = createHostileDelegatedError(
            'privileged-render-secret'
        );
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) => candidate === sensitiveOptions
        );
        configService.readAllResultStrict
            .mockRejectedValueOnce(delegatedError)
            .mockImplementationOnce(async () => ({
                values: await publicLoad.promise,
            }));
        try {
            const { result, rerender } = renderHook(
                ({ settingsOptions }) => {
                    const hookState = useSettings(undefined, settingsOptions);
                    renderSnapshots.push({
                        settingsOptions,
                        settings: hookState.settings,
                        error: hookState.error,
                        status: hookState.initialLoadStatus,
                    });
                    return hookState;
                },
                { initialProps: { settingsOptions: sensitiveOptions } }
            );
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('unavailable')
            );
            expect(result.current.error).toBe(delegatedError);

            const publicRenderStart = renderSnapshots.length;
            rerender({ settingsOptions: publicOptions });

            const immediatePublicRender = renderSnapshots
                .slice(publicRenderStart)
                .find((snapshot) => snapshot.settingsOptions === publicOptions);
            expect(immediatePublicRender).toEqual({
                settingsOptions: publicOptions,
                settings: {},
                error: null,
                status: 'loading',
            });
            expect(result.current.settings).toEqual({});
            expect(result.current.error).toBeNull();
            expect(result.current.initialLoadStatus).toBe('loading');
            expect(getterReads).not.toHaveBeenCalled();

            act(() => {
                publicLoad.resolve({ uiLanguage: 'public-authority' });
            });
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    test('rethrows a stale hostile privileged failure without publishing it to the public generation', async () => {
        const sensitiveOptions = {};
        const publicOptions = {};
        const blockingWrite = createDeferred();
        const stalePrivilegedWrite = createDeferred();
        const publicLoad = createDeferred();
        const publicError = new Error('public load unavailable');
        const { delegatedError, getterReads } = createHostileDelegatedError(
            'stale-privileged-write-secret'
        );
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) => candidate === sensitiveOptions
        );
        configService.readAllResultStrict
            .mockResolvedValueOnce({
                values: { secretSetting: 'privileged-authority' },
            })
            .mockImplementationOnce(async () => ({
                values: await publicLoad.promise,
            }));
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(blockingWrite))
            .mockImplementationOnce(
                resolveSingleWriteAfter(stalePrivilegedWrite)
            );
        try {
            const { result, rerender } = renderHook(
                ({ settingsOptions }) =>
                    useSettings(undefined, settingsOptions),
                { initialProps: { settingsOptions: sensitiveOptions } }
            );
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );

            let blockingResult;
            let staleResult;
            act(() => {
                blockingResult = result.current.updateSetting(
                    'blockingSetting',
                    'privileged-blocker'
                );
                staleResult = result.current.updateSetting(
                    'secretSetting',
                    'privileged-pending'
                );
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(1)
            );

            rerender({ settingsOptions: publicOptions });
            act(() => {
                publicLoad.reject(publicError);
            });
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('unavailable')
            );
            expect(result.current.error).toBe(publicError);

            await act(async () => {
                blockingWrite.resolve();
                await blockingResult;
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(2)
            );

            const staleRejection =
                expect(staleResult).rejects.toBe(delegatedError);
            stalePrivilegedWrite.reject(delegatedError);
            await act(async () => {
                await staleRejection;
            });

            expect(result.current.settings).toEqual({});
            expect(result.current.initialLoadStatus).toBe('unavailable');
            expect(result.current.error).toBe(publicError);
            expect(consoleError.mock.calls).toEqual([
                ['Settings initial load failed.'],
                ['Settings update failed.'],
            ]);
            expect(getterReads).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    test('does not let a queued stale privileged success clear a newer public error', async () => {
        const sensitiveOptions = {};
        const publicOptions = {};
        const blockingWrite = createDeferred();
        const stalePrivilegedWrite = createDeferred();
        const publicLoad = createDeferred();
        const publicError = new Error('newer public load unavailable');
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) => candidate === sensitiveOptions
        );
        configService.readAllResultStrict
            .mockResolvedValueOnce({
                values: { secretSetting: 'privileged-authority' },
            })
            .mockImplementationOnce(async () => ({
                values: await publicLoad.promise,
            }));
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(blockingWrite))
            .mockImplementationOnce(
                resolveSingleWriteAfter(stalePrivilegedWrite)
            );
        try {
            const { result, rerender } = renderHook(
                ({ settingsOptions }) =>
                    useSettings(undefined, settingsOptions),
                { initialProps: { settingsOptions: sensitiveOptions } }
            );
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );

            let blockingResult;
            let staleResult;
            act(() => {
                blockingResult = result.current.updateSetting(
                    'blockingSetting',
                    'privileged-blocker'
                );
                staleResult = result.current.updateSetting(
                    'secretSetting',
                    'privileged-pending'
                );
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(1)
            );

            rerender({ settingsOptions: publicOptions });
            act(() => {
                publicLoad.reject(publicError);
            });
            await waitFor(() => expect(result.current.error).toBe(publicError));

            await act(async () => {
                blockingWrite.resolve();
                await blockingResult;
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(2)
            );
            await act(async () => {
                stalePrivilegedWrite.resolve();
                await staleResult;
            });

            expect(result.current.settings).toEqual({});
            expect(result.current.initialLoadStatus).toBe('unavailable');
            expect(result.current.error).toBe(publicError);
        } finally {
            consoleError.mockRestore();
        }
    });

    test('ignores a privileged event readback that settles after public revocation', async () => {
        const sensitiveOptions = {};
        const publicOptions = {};
        const privilegedReadback = createDeferred();
        const publicLoad = createDeferred();
        const listeners = [];
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) => candidate === sensitiveOptions
        );
        configService.readAllResultStrict
            .mockResolvedValueOnce({
                values: { secretSetting: 'initial-secret' },
            })
            .mockImplementationOnce(async () => ({
                values: await publicLoad.promise,
            }));
        configService.readMultipleResultStrict.mockImplementation(
            () => privilegedReadback.promise
        );
        configService.onChanged.mockImplementation((listener) => {
            listeners.push(listener);
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ settingsOptions }) => useSettings(undefined, settingsOptions),
            { initialProps: { settingsOptions: sensitiveOptions } }
        );
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );

        act(() => {
            listeners[0]({ secretSetting: 'privileged-event' });
        });
        await waitFor(() =>
            expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
                ['secretSetting'],
                { includeSensitive: true }
            )
        );

        rerender({ settingsOptions: publicOptions });
        expect(result.current.settings).toEqual({});
        expect(result.current.initialLoadStatus).toBe('loading');
        act(() => {
            publicLoad.resolve({ uiLanguage: 'public-authority' });
        });
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );

        await act(async () => {
            privilegedReadback.resolve({
                values: { secretSetting: 'stale-privileged-proof' },
            });
            await privilegedReadback.promise;
        });
        expect(result.current.settings).toEqual({
            uiLanguage: 'public-authority',
        });
        expect(result.current.error).toBeNull();
    });

    test('does not let an old privileged pending write defer or overwrite a public event', async () => {
        const sensitiveOptions = {};
        const publicOptions = {};
        const privilegedWrite = createDeferred();
        const listeners = [];
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) => candidate === sensitiveOptions
        );
        configService.readAllResultStrict
            .mockResolvedValueOnce({
                values: { sharedSetting: 'privileged-authority' },
            })
            .mockResolvedValueOnce({
                values: { sharedSetting: 'public-authority' },
            });
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { sharedSetting: 'public-event' },
        });
        configService.set.mockImplementation(
            resolveSingleWriteAfter(privilegedWrite)
        );
        configService.onChanged.mockImplementation((listener) => {
            listeners.push(listener);
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ settingsOptions }) => useSettings(undefined, settingsOptions),
            { initialProps: { settingsOptions: sensitiveOptions } }
        );
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );

        let writeResult;
        act(() => {
            writeResult = result.current.updateSetting(
                'sharedSetting',
                'privileged-pending'
            );
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        rerender({ settingsOptions: publicOptions });
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );
        expect(result.current.settings.sharedSetting).toBe('public-authority');

        act(() => {
            listeners[1]({ sharedSetting: 'public-event' });
        });
        await waitFor(() =>
            expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
                ['sharedSetting'],
                { includeSensitive: false }
            )
        );
        expect(result.current.settings.sharedSetting).toBe('public-event');

        await act(async () => {
            privilegedWrite.resolve();
            await writeResult;
        });
        expect(result.current.settings.sharedSetting).toBe('public-event');
    });

    test('does not let a queued privileged write hide public reconciliation uncertainty', async () => {
        const sensitiveOptions = {};
        const publicOptions = {};
        const blockingWrite = createDeferred();
        const queuedPrivilegedWrite = createDeferred();
        const publicReadback = createDeferred();
        const listeners = [];
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) => candidate === sensitiveOptions
        );
        configService.readAllResultStrict
            .mockResolvedValueOnce({
                values: { sharedSetting: 'privileged-authority' },
            })
            .mockResolvedValueOnce({
                values: { sharedSetting: 'public-authority' },
            });
        configService.readMultipleResultStrict.mockImplementation(
            () => publicReadback.promise
        );
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(blockingWrite))
            .mockImplementationOnce(
                resolveSingleWriteAfter(queuedPrivilegedWrite)
            );
        configService.onChanged.mockImplementation((listener) => {
            listeners.push(listener);
            return () => {};
        });
        try {
            const { result, rerender } = renderHook(
                ({ settingsOptions }) =>
                    useSettings(undefined, settingsOptions),
                { initialProps: { settingsOptions: sensitiveOptions } }
            );
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );

            let blockingResult;
            let queuedResult;
            act(() => {
                blockingResult = result.current.updateSetting(
                    'blockingSetting',
                    'privileged-blocker'
                );
                queuedResult = result.current.updateSetting(
                    'sharedSetting',
                    'privileged-pending'
                );
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(1)
            );

            rerender({ settingsOptions: publicOptions });
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );
            act(() => {
                listeners[1]({ sharedSetting: 'public-event' });
            });
            await waitFor(() =>
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalled()
            );

            await act(async () => {
                blockingWrite.resolve();
                await blockingResult;
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(2)
            );

            act(() => {
                publicReadback.reject(new Error('public readback failed'));
            });
            await waitFor(() =>
                expect(result.current.error).toMatchObject({
                    message:
                        'Unable to confirm persisted settings after a storage update.',
                })
            );
            expectOnlyFixedLog(consoleError, 'Settings reconciliation failed.');

            await act(async () => {
                queuedPrivilegedWrite.resolve();
                await queuedResult;
            });
            expect(result.current.settings.sharedSetting).toBe('public-event');
            expect(result.current.error).toMatchObject({
                message:
                    'Unable to confirm persisted settings after a storage update.',
            });
        } finally {
            consoleError.mockRestore();
        }
    });

    test.each(['success', 'failure'])(
        'does not inspect or publish a stale privileged initial %s',
        async (staleOutcome) => {
            const sensitiveOptions = {};
            const publicOptions = {};
            const privilegedLoad = createDeferred();
            const publicLoad = createDeferred();
            const staleError = new Error('stale privileged failure');
            const descriptorReads = jest.fn();
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            isSensitiveAccessExplicitlyEnabled.mockImplementation(
                (candidate) => candidate === sensitiveOptions
            );
            configService.readAllResultStrict.mockImplementation(
                ({ includeSensitive }) =>
                    includeSensitive
                        ? privilegedLoad.promise
                        : publicLoad.promise
            );
            try {
                const { result, rerender } = renderHook(
                    ({ settingsOptions }) =>
                        useSettings(undefined, settingsOptions),
                    { initialProps: { settingsOptions: sensitiveOptions } }
                );
                await waitFor(() =>
                    expect(
                        configService.readAllResultStrict
                    ).toHaveBeenCalledTimes(1)
                );

                rerender({ settingsOptions: publicOptions });
                expect(result.current.initialLoadStatus).toBe('loading');
                await waitFor(() =>
                    expect(
                        configService.readAllResultStrict
                    ).toHaveBeenCalledTimes(2)
                );

                await act(async () => {
                    if (staleOutcome === 'success') {
                        privilegedLoad.resolve(
                            new Proxy(
                                {
                                    values: {
                                        secretSetting: 'stale-secret',
                                    },
                                },
                                {
                                    getOwnPropertyDescriptor() {
                                        descriptorReads();
                                        throw new Error(
                                            'stale result must not be inspected'
                                        );
                                    },
                                }
                            )
                        );
                        await privilegedLoad.promise;
                    } else {
                        const staleRejection = expect(
                            privilegedLoad.promise
                        ).rejects.toBe(staleError);
                        privilegedLoad.reject(staleError);
                        await staleRejection;
                    }
                });
                expect(result.current.initialLoadStatus).toBe('loading');
                expect(result.current.settings).toEqual({});
                expect(result.current.error).toBeNull();
                expect(descriptorReads).not.toHaveBeenCalled();
                expect(consoleError).not.toHaveBeenCalled();

                act(() => {
                    publicLoad.resolve({
                        values: { uiLanguage: 'public-authority' },
                    });
                });
                await waitFor(() =>
                    expect(result.current.initialLoadStatus).toBe('ready')
                );
                expect(result.current.settings).toEqual({
                    uiLanguage: 'public-authority',
                });
            } finally {
                consoleError.mockRestore();
            }
        }
    );

    test('uses a fresh authority generation when permission returns after revocation', async () => {
        const sensitiveOptions = {};
        const publicOptions = {};
        const oldPrivilegedWrite = createDeferred();
        const newPrivilegedLoad = createDeferred();
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) => candidate === sensitiveOptions
        );
        configService.readAllResultStrict
            .mockResolvedValueOnce({
                values: { secretSetting: 'old-privileged-authority' },
            })
            .mockResolvedValueOnce({
                values: { uiLanguage: 'public-authority' },
            })
            .mockImplementationOnce(async () => ({
                values: await newPrivilegedLoad.promise,
            }));
        configService.set.mockImplementation(
            resolveSingleWriteAfter(oldPrivilegedWrite)
        );
        const { result, rerender } = renderHook(
            ({ settingsOptions }) => useSettings(undefined, settingsOptions),
            { initialProps: { settingsOptions: sensitiveOptions } }
        );
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );

        let writeResult;
        act(() => {
            writeResult = result.current.updateSetting(
                'secretSetting',
                'old-privileged-pending'
            );
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        rerender({ settingsOptions: publicOptions });
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );
        expect(result.current.settings).toEqual({
            uiLanguage: 'public-authority',
        });

        rerender({ settingsOptions: sensitiveOptions });
        expect(result.current.initialLoadStatus).toBe('loading');
        expect(result.current.settings).toEqual({});

        await act(async () => {
            oldPrivilegedWrite.resolve();
            await writeResult;
        });
        expect(result.current.settings).toEqual({});
        expect(result.current.initialLoadStatus).toBe('loading');

        act(() => {
            newPrivilegedLoad.resolve({
                secretSetting: 'new-privileged-authority',
            });
        });
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );
        expect(result.current.settings).toEqual({
            secretSetting: 'new-privileged-authority',
        });
    });

    test('treats an empty string as an invalid projected key and fails closed', async () => {
        configService.readMultipleResultStrict.mockResolvedValue({
            values: {},
        });

        const { result } = renderHook(() => useSettings(''));

        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('unavailable')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            [''],
            { includeSensitive: false }
        );
        expect(configService.readAllResultStrict).not.toHaveBeenCalled();
        expect(result.current.loading).toBe(false);
        expect(result.current.settings).toEqual({});
        expect(result.current.error).toBeInstanceOf(TypeError);
    });

    test('treats string, singleton-array, and fresh equivalent arrays as one normalized request', async () => {
        const unsubscribe = jest.fn();
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { uiLanguage: 'fr' },
        });
        configService.onChanged.mockReturnValue(unsubscribe);
        const firstOptions = {};
        const secondOptions = {};

        const { result, rerender } = renderHook(
            ({ watchedKeys, settingsOptions }) =>
                useSettings(watchedKeys, settingsOptions),
            {
                initialProps: {
                    watchedKeys: 'uiLanguage',
                    settingsOptions: firstOptions,
                },
            }
        );
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );

        rerender({
            watchedKeys: ['uiLanguage'],
            settingsOptions: secondOptions,
        });
        rerender({
            watchedKeys: [...['uiLanguage']],
            settingsOptions: {},
        });

        expect(result.current.initialLoadStatus).toBe('ready');
        expect(result.current.settings).toEqual({ uiLanguage: 'fr' });
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['uiLanguage'], { includeSensitive: false }],
        ]);
        expect(configService.onChanged).toHaveBeenCalledTimes(1);
        expect(unsubscribe).not.toHaveBeenCalled();
    });

    test('treats ordered normalized keys as request identity', async () => {
        const reorderedLoad = createDeferred();
        const firstUnsubscribe = jest.fn();
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({
                values: { uiLanguage: 'en', debugMode: false },
            })
            .mockImplementationOnce(async () => ({
                values: await reorderedLoad.promise,
            }));
        configService.onChanged.mockReturnValueOnce(firstUnsubscribe);
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            {
                initialProps: {
                    watchedKeys: ['uiLanguage', 'debugMode'],
                },
            }
        );
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );

        rerender({ watchedKeys: ['debugMode', 'uiLanguage'] });

        expect(result.current.initialLoadStatus).toBe('loading');
        expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        expect(configService.readMultipleResultStrict).toHaveBeenLastCalledWith(
            ['debugMode', 'uiLanguage'],
            { includeSensitive: false }
        );

        act(() => {
            reorderedLoad.resolve({ debugMode: true, uiLanguage: 'fr' });
        });
        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );
        expect(Object.keys(result.current.settings)).toEqual([
            'debugMode',
            'uiLanguage',
        ]);
    });

    test('normalizes null and undefined as unkeyed while keeping empty string and empty projection distinct', async () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        configService.readAllResultStrict.mockResolvedValue({
            values: { uiLanguage: 'en' },
        });
        configService.readMultipleResultStrict.mockResolvedValue({
            values: {},
        });
        try {
            const { result, rerender } = renderHook(
                ({ watchedKeys }) => useSettings(watchedKeys),
                { initialProps: { watchedKeys: undefined } }
            );
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );

            rerender({ watchedKeys: null });
            expect(result.current.initialLoadStatus).toBe('ready');
            expect(configService.readAllResultStrict).toHaveBeenCalledTimes(1);

            rerender({ watchedKeys: '' });
            expect(result.current.initialLoadStatus).toBe('loading');
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('unavailable')
            );

            rerender({ watchedKeys: [] });
            expect(result.current.initialLoadStatus).toBe('loading');
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );
            expect(configService.readMultipleResultStrict.mock.calls).toEqual([
                [[''], { includeSensitive: false }],
                [[], { includeSensitive: false }],
            ]);
            expect(result.current.settings).toEqual({});
        } finally {
            consoleError.mockRestore();
        }
    });

    test('delegates opaque options to the normalizer without inspecting them', async () => {
        const options = new Proxy(
            {},
            {
                get() {
                    throw new Error('hook must not read options');
                },
                ownKeys() {
                    throw new Error('hook must not enumerate options');
                },
                getOwnPropertyDescriptor() {
                    throw new Error('hook must not inspect option descriptors');
                },
            }
        );
        isSensitiveAccessExplicitlyEnabled.mockImplementation(
            (candidate) => candidate === options
        );
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { uiLanguage: 'fr' },
        });

        const { result } = renderHook(() =>
            useSettings(['uiLanguage'], options)
        );

        await waitFor(() =>
            expect(result.current.initialLoadStatus).toBe('ready')
        );
        expect(isSensitiveAccessExplicitlyEnabled.mock.calls[0][0]).toBe(
            options
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            ['uiLanguage'],
            { includeSensitive: true }
        );
        expect(configService.onChanged).toHaveBeenCalledWith(
            expect.any(Function),
            { includeSensitive: true }
        );
    });

    test.each([
        ['false', false],
        ['zero', 0],
        ['empty string', ''],
        ['null', null],
        ['undefined', undefined],
    ])(
        'normalizes a falsy initial rejection (%s) to a generic unavailable error',
        async (_label, rejectionReason) => {
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            configService.readAllResultStrict.mockRejectedValue(
                rejectionReason
            );
            try {
                const { result } = renderHook(() => useSettings());

                await waitFor(() =>
                    expect(result.current.initialLoadStatus).toBe('unavailable')
                );
                expect(result.current.loading).toBe(false);
                expect(result.current.error).toBeInstanceOf(Error);
                expect(result.current.error.message).toBe(
                    SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE
                );
                expectOnlyFixedLog(
                    consoleError,
                    'Settings initial load failed.'
                );
            } finally {
                consoleError.mockRestore();
            }
        }
    );

    test('does not retry an unavailable equivalent request but remounting recovers', async () => {
        const loadError = new Error('first mount unavailable');
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(loadError)
            .mockResolvedValueOnce({ values: { uiLanguage: 'fr' } });
        try {
            const firstMount = renderHook(
                ({ watchedKeys, settingsOptions }) =>
                    useSettings(watchedKeys, settingsOptions),
                {
                    initialProps: {
                        watchedKeys: ['uiLanguage'],
                        settingsOptions: {},
                    },
                }
            );
            await waitFor(() =>
                expect(firstMount.result.current.initialLoadStatus).toBe(
                    'unavailable'
                )
            );

            firstMount.rerender({
                watchedKeys: [...['uiLanguage']],
                settingsOptions: {},
            });
            expect(firstMount.result.current.initialLoadStatus).toBe(
                'unavailable'
            );
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1);
            firstMount.unmount();

            const secondMount = renderHook(() =>
                useSettings(['uiLanguage'], {})
            );
            expect(secondMount.result.current.initialLoadStatus).toBe(
                'loading'
            );
            await waitFor(() =>
                expect(secondMount.result.current.initialLoadStatus).toBe(
                    'ready'
                )
            );
            expect(secondMount.result.current.settings).toEqual({
                uiLanguage: 'fr',
            });
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2);
        } finally {
            consoleError.mockRestore();
        }
    });

    test('events, reconciliation, and both write APIs never promote an unavailable initial request', async () => {
        const loadError = new Error('initial storage unavailable');
        let storageChangeListener;
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        configService.readAllResultStrict.mockRejectedValue(loadError);
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { uiLanguage: 'event-confirmed' },
        });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        try {
            const { result } = renderHook(() => useSettings());
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('unavailable')
            );

            act(() => {
                storageChangeListener({ uiLanguage: 'event-confirmed' });
            });
            expect(result.current.initialLoadStatus).toBe('unavailable');
            await waitFor(() =>
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalled()
            );
            await act(async () => {
                await Promise.resolve();
            });
            expect(result.current.initialLoadStatus).toBe('unavailable');

            await act(async () => {
                await result.current.updateSetting('debugMode', true);
            });
            expect(result.current.initialLoadStatus).toBe('unavailable');
            expect(result.current.settings.debugMode).toBe(true);

            await act(async () => {
                await result.current.updateSettings({
                    uiLanguage: 'fr',
                    subtitleFontSize: 1.2,
                });
            });
            expect(result.current.initialLoadStatus).toBe('unavailable');
            expect(result.current.settings).toMatchObject({
                uiLanguage: 'fr',
                debugMode: true,
                subtitleFontSize: 1.2,
            });
        } finally {
            consoleError.mockRestore();
        }
    });

    test('logs only the fixed initial string for a hostile delegated rejection', async () => {
        const { delegatedError, getterReads } =
            createHostileDelegatedError('initial-secret');
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        configService.readAllResultStrict.mockRejectedValue(delegatedError);
        try {
            const { result } = renderHook(() => useSettings());

            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('unavailable')
            );
            expect(result.current.error).toBe(delegatedError);
            expectOnlyFixedLog(consoleError, 'Settings initial load failed.');
            expect(getterReads).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    test('logs only the fixed reconciliation string for a hostile delegated rejection', async () => {
        const { delegatedError, getterReads } = createHostileDelegatedError(
            'reconciliation-secret'
        );
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        let storageChangeListener;
        configService.readMultipleResultStrict.mockRejectedValue(
            delegatedError
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        try {
            const { result } = renderHook(() => useSettings());
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );

            act(() => {
                storageChangeListener({ openaiModel: 'event-value' });
            });
            await waitFor(() =>
                expect(result.current.error).toMatchObject({
                    message:
                        'Unable to confirm persisted settings after a storage update.',
                })
            );
            expectOnlyFixedLog(consoleError, 'Settings reconciliation failed.');
            expect(getterReads).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    test('preserves and rethrows a hostile single-write rejection while logging only the fixed string', async () => {
        const { delegatedError, getterReads } = createHostileDelegatedError(
            'single-write-secret'
        );
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        configService.set.mockRejectedValue(delegatedError);
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { openaiModel: 'initial' },
        });
        try {
            const { result } = renderHook(() => useSettings());
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );

            await act(async () => {
                await expect(
                    result.current.updateSetting('openaiModel', 'secret-value')
                ).rejects.toBe(delegatedError);
            });
            expect(result.current.error).toBe(delegatedError);
            expect(result.current.settings.openaiModel).toBe('initial');
            expectOnlyFixedLog(consoleError, 'Settings update failed.');
            expect(getterReads).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    test('fails closed on hostile batch metadata, preserves the rejection, and logs only the fixed string', async () => {
        const { delegatedError, getterReads } =
            createHostileDelegatedError('batch-write-secret');
        for (const key of ['successful', 'failed', 'validationErrors']) {
            Object.defineProperty(delegatedError, key, {
                configurable: true,
                get() {
                    getterReads(key);
                    throw new Error('must not inspect batch metadata');
                },
            });
        }
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        mockUnkeyedInitialValues({ uiLanguage: 'en', debugMode: false });
        configService.setMultiple.mockRejectedValue(delegatedError);
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { uiLanguage: 'en', debugMode: false },
        });
        try {
            const { result } = renderHook(() => useSettings());
            await waitFor(() =>
                expect(result.current.initialLoadStatus).toBe('ready')
            );

            await act(async () => {
                await expect(
                    result.current.updateSettings({
                        uiLanguage: 'secret-language',
                        debugMode: true,
                    })
                ).rejects.toBe(delegatedError);
            });
            expect(result.current.error).toBe(delegatedError);
            expect(result.current.settings).toMatchObject({
                uiLanguage: 'en',
                debugMode: false,
            });
            expectOnlyFixedLog(consoleError, 'Settings batch update failed.');
            expect(getterReads).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    test('does not inspect authority metadata or brand-like getters on a strict result', async () => {
        const metadataReads = [];
        const readResult = {
            values: { uiLanguage: 'fr' },
        };
        for (const key of [
            'ok',
            'degraded',
            'areas',
            'sources',
            'failedAreas',
            'displayFallbacks',
            'brand',
            'constructor',
        ]) {
            Object.defineProperty(readResult, key, {
                get() {
                    metadataReads.push(key);
                    throw new Error(`must not inspect ${key}`);
                },
            });
        }

        configService.readMultipleResultStrict.mockResolvedValue(readResult);
        const { result } = renderHook(() => useSettings(['uiLanguage']));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.settings).toEqual({ uiLanguage: 'fr' });
        expect(result.current.error).toBeNull();
        expect(metadataReads).toEqual([]);
    });

    test('accepts a schema default supplied in values by a successful strict read', async () => {
        let provenanceReads = 0;
        const readResult = {
            values: { subtitlesEnabled: true },
        };
        Object.defineProperty(readResult, 'sources', {
            get() {
                provenanceReads += 1;
                throw new Error('must not inspect service provenance');
            },
        });
        configService.readMultipleResultStrict.mockResolvedValue(readResult);

        const { result } = renderHook(() => useSettings(['subtitlesEnabled']));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.settings).toEqual({ subtitlesEnabled: true });
        expect(result.current.error).toBeNull();
        expect(provenanceReads).toBe(0);
    });

    test('rejects an incomplete projected strict result without applying partial authority', async () => {
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { uiLanguage: 'fr' },
        });

        const { result } = renderHook(() =>
            useSettings(['uiLanguage', 'debugMode'])
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.settings).toEqual({});
        expect(result.current.error).toBeInstanceOf(TypeError);
        expect(result.current.error.message).toBe(
            SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE
        );
    });

    test('normalizes a hostile strict-result trap without exposing its thrown text', async () => {
        const hostileReadResult = new Proxy(
            { values: { uiLanguage: 'must-not-load' } },
            {
                getOwnPropertyDescriptor() {
                    throw new Error('PRIVATE_RESULT_TRAP');
                },
            }
        );
        configService.readMultipleResultStrict.mockResolvedValue(
            hostileReadResult
        );
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        try {
            const { result } = renderHook(() => useSettings(['uiLanguage']));

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.settings).toEqual({});
            expect(result.current.error).toBeInstanceOf(TypeError);
            expect(result.current.error.message).toBe(
                SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE
            );
            expectOnlyNormalizedInitialLoadErrorLog(consoleError, [
                'PRIVATE_RESULT_TRAP',
                'must-not-load',
            ]);
        } finally {
            consoleError.mockRestore();
        }
    });

    test.each([
        {
            label: 'a primitive result',
            requestedKeys: ['uiLanguage'],
            createShape: () => ({ readResult: 42, accessorReads: () => 0 }),
        },
        {
            label: 'missing own values',
            requestedKeys: ['uiLanguage'],
            createShape: () => ({ readResult: {}, accessorReads: () => 0 }),
        },
        {
            label: 'an outer values accessor',
            requestedKeys: ['uiLanguage'],
            createShape: () => {
                let reads = 0;
                const readResult = {};
                Object.defineProperty(readResult, 'values', {
                    enumerable: true,
                    get() {
                        reads += 1;
                        return { uiLanguage: 'must-not-load' };
                    },
                });
                return { readResult, accessorReads: () => reads };
            },
        },
        {
            label: 'null values',
            requestedKeys: ['uiLanguage'],
            createShape: () => ({
                readResult: { values: null },
                accessorReads: () => 0,
            }),
        },
        {
            label: 'array values',
            requestedKeys: ['uiLanguage'],
            createShape: () => ({
                readResult: { values: ['must-not-load'] },
                accessorReads: () => 0,
            }),
        },
        {
            label: 'an inherited requested value',
            requestedKeys: ['uiLanguage'],
            createShape: () => ({
                readResult: {
                    values: Object.create({ uiLanguage: 'must-not-load' }),
                },
                accessorReads: () => 0,
            }),
        },
        {
            label: 'a requested value accessor',
            requestedKeys: ['uiLanguage'],
            createShape: () => {
                let reads = 0;
                const values = {};
                Object.defineProperty(values, 'uiLanguage', {
                    enumerable: true,
                    get() {
                        reads += 1;
                        return 'must-not-load';
                    },
                });
                return {
                    readResult: { values },
                    accessorReads: () => reads,
                };
            },
        },
        {
            label: 'a revoked values proxy',
            requestedKeys: ['uiLanguage'],
            createShape: () => {
                const { proxy, revoke } = Proxy.revocable(
                    { uiLanguage: 'must-not-load' },
                    {}
                );
                revoke();
                return {
                    readResult: { values: proxy },
                    accessorReads: () => 0,
                };
            },
        },
        {
            label: 'an unkeyed returned-value accessor',
            requestedKeys: null,
            createShape: () => {
                let reads = 0;
                const values = {};
                Object.defineProperty(values, 'uiLanguage', {
                    enumerable: true,
                    get() {
                        reads += 1;
                        return 'must-not-load';
                    },
                });
                return {
                    readResult: { values },
                    accessorReads: () => reads,
                };
            },
        },
    ])(
        'fails closed for $label without invoking accessors',
        async ({ requestedKeys, createShape }) => {
            const { readResult, accessorReads } = createShape();
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            if (requestedKeys === null) {
                configService.readAllResultStrict.mockResolvedValue(readResult);
            } else {
                configService.readMultipleResultStrict.mockResolvedValue(
                    readResult
                );
            }

            try {
                const { result } = renderHook(() => useSettings(requestedKeys));

                await waitFor(() => expect(result.current.loading).toBe(false));
                expect(result.current.settings).toEqual({});
                expect(result.current.error).toBeInstanceOf(TypeError);
                expect(result.current.error.message).toBe(
                    SETTINGS_LOAD_VALIDATION_ERROR_MESSAGE
                );
                expect(accessorReads()).toBe(0);
                expectOnlyNormalizedInitialLoadErrorLog(consoleError, [
                    'must-not-load',
                ]);
            } finally {
                consoleError.mockRestore();
            }
        }
    );

    test('serializes rapid writes and keeps the newest input rendered and persisted', async () => {
        const pendingWrites = [];
        let storageChangeListener;
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        configService.set.mockImplementation(
            (key, value) =>
                new Promise((resolve) => {
                    pendingWrites.push({
                        key,
                        value,
                        resolve: () => resolve(value),
                    });
                })
        );
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { openaiModel: 'newest-value' },
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let firstWrite;
        let secondWrite;
        await act(async () => {
            firstWrite = result.current.updateSetting(
                'openaiModel',
                'older-value'
            );
            secondWrite = result.current.updateSetting(
                'openaiModel',
                'newest-value'
            );
            await Promise.resolve();
        });

        expect(result.current.settings.openaiModel).toBe('newest-value');
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();
        expect(pendingWrites).toHaveLength(1);
        expect(pendingWrites[0]).toMatchObject({ value: 'older-value' });

        await act(async () => {
            pendingWrites[0].resolve();
            await firstWrite;
        });
        await waitFor(() => expect(pendingWrites).toHaveLength(2));
        expect(pendingWrites[1]).toMatchObject({ value: 'newest-value' });

        act(() => {
            storageChangeListener({ openaiModel: 'older-value' });
        });
        expect(result.current.settings.openaiModel).toBe('newest-value');
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        await act(async () => {
            pendingWrites[1].resolve();
            await secondWrite;
        });

        expect(configService.set.mock.calls).toEqual([
            ['openaiModel', 'older-value'],
            ['openaiModel', 'newest-value'],
        ]);
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('newest-value')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
    });

    test('strictly reconciles a delayed prior value after the pending write succeeds', async () => {
        const confirmedWrite = createDeferred();
        const pendingWrite = createDeferred();
        const strictRead = createDeferred();
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(confirmedWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(pendingWrite));
        configService.readMultipleResultStrict.mockImplementation(
            () => strictRead.promise
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let confirmedResult;
        let pendingResult;
        act(() => {
            confirmedResult = result.current.updateSetting('openaiModel', 'B');
            pendingResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        await act(async () => {
            confirmedWrite.resolve();
            await confirmedResult;
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        expect(result.current.settings.openaiModel).toBe('C');
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        await act(async () => {
            pendingWrite.resolve();
            await pendingResult;
        });
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            ['openaiModel'],
            { includeSensitive: false }
        );

        await act(async () => {
            strictRead.resolve({ values: { openaiModel: 'C' } });
            await strictRead.promise;
        });
        expect(result.current.settings.openaiModel).toBe('C');
    });

    test('strictly reconciles a prior local-write echo delivered after every write settles', async () => {
        const strictRead = createDeferred();
        let storageChangeListener;
        configService.readMultipleResultStrict.mockImplementation(
            () => strictRead.promise
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateSetting('openaiModel', 'B');
        });
        await act(async () => {
            await result.current.updateSetting('openaiModel', 'C');
        });
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        expect(result.current.settings.openaiModel).toBe('B');
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
        ]);

        await act(async () => {
            strictRead.resolve({
                ok: true,
                degraded: false,
                failedAreas: [],
                values: { openaiModel: 'C' },
            });
            await strictRead.promise;
        });
        expect(result.current.settings.openaiModel).toBe('C');
    });

    test('defers an event read until its captured write persists so a pre-settlement B cannot beat C', async () => {
        const pendingWrite = createDeferred();
        let persistedValue = 'A';
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(async (_key, value) => {
                persistedValue = value;
                return value;
            })
            .mockImplementationOnce(async (_key, value) => {
                await pendingWrite.promise;
                persistedValue = value;
                return value;
            });
        configService.readMultipleResultStrict.mockImplementation(() =>
            Promise.resolve({ values: { openaiModel: persistedValue } })
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateSetting('openaiModel', 'B');
        });
        let latestResult;
        act(() => {
            latestResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        expect(persistedValue).toBe('B');

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        expect(result.current.settings.openaiModel).toBe('C');
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        await act(async () => {
            pendingWrite.resolve();
            await latestResult;
        });
        expect(persistedValue).toBe('C');
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1)
        );
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('C')
        );
    });

    test('keeps a genuine external post-settlement value when strict storage confirms it', async () => {
        let persistedValue = 'A';
        let storageChangeListener;
        configService.set.mockImplementation(async (_key, value) => {
            persistedValue = value;
            return value;
        });
        configService.readMultipleResultStrict.mockImplementation(() =>
            Promise.resolve({ values: { openaiModel: persistedValue } })
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateSetting('openaiModel', 'C');
        });
        persistedValue = 'B';
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });

        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('B')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
    });

    test('strictly checks an echo older than nine successful writes without bounded history', async () => {
        let storageChangeListener;
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { openaiModel: 'V10' },
        });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        for (let index = 1; index <= 10; index += 1) {
            await act(async () => {
                await result.current.updateSetting('openaiModel', `V${index}`);
            });
        }
        act(() => {
            storageChangeListener({ openaiModel: 'V1' });
        });
        expect(result.current.settings.openaiModel).toBe('V1');
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('V10')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
    });

    test('keeps the delayed event when strict storage confirms its value', async () => {
        const confirmedWrite = createDeferred();
        const pendingWrite = createDeferred();
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(confirmedWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(pendingWrite));
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { openaiModel: 'B' },
        });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let confirmedResult;
        let pendingResult;
        act(() => {
            confirmedResult = result.current.updateSetting('openaiModel', 'B');
            pendingResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        await act(async () => {
            confirmedWrite.resolve();
            await confirmedResult;
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });

        await act(async () => {
            pendingWrite.resolve();
            await pendingResult;
        });
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('B')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
    });

    test('strictly reconciles an ambiguous event after the pending write fails', async () => {
        const confirmedWrite = createDeferred();
        const pendingWrite = createDeferred();
        const writeError = new Error('pending C failed');
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(confirmedWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(pendingWrite));
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { openaiModel: 'B' },
        });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let confirmedResult;
        let pendingResult;
        act(() => {
            confirmedResult = result.current.updateSetting('openaiModel', 'B');
            pendingResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        await act(async () => {
            confirmedWrite.resolve();
            await confirmedResult;
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        const rejection = expect(pendingResult).rejects.toBe(writeError);
        pendingWrite.reject(writeError);
        await act(async () => {
            await rejection;
        });
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('B')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(2);
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['openaiModel'], { includeSensitive: false }],
        ]);
        expect(result.current.error).toBe(writeError);
    });

    test.each(['before-event', 'after-event'])(
        'issues one event read with no terminal duplicate when D is invoked %s',
        async (dOrder) => {
            const writes = [
                createDeferred(),
                createDeferred(),
                createDeferred(),
            ];
            let storageChangeListener;
            configService.set
                .mockImplementationOnce(resolveSingleWriteAfter(writes[0]))
                .mockImplementationOnce(resolveSingleWriteAfter(writes[1]))
                .mockImplementationOnce(resolveSingleWriteAfter(writes[2]));
            configService.readMultipleResultStrict.mockResolvedValue({
                values: {
                    openaiModel: dOrder === 'before-event' ? 'D' : 'B',
                },
            });
            configService.onChanged.mockImplementation((listener) => {
                storageChangeListener = listener;
                return () => {};
            });
            const { result } = renderHook(() => useSettings());
            await waitFor(() => expect(result.current.loading).toBe(false));

            let confirmedResult;
            let pendingResult;
            act(() => {
                confirmedResult = result.current.updateSetting(
                    'openaiModel',
                    'B'
                );
                pendingResult = result.current.updateSetting(
                    'openaiModel',
                    'C'
                );
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(1)
            );
            await act(async () => {
                writes[0].resolve();
                await confirmedResult;
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(2)
            );

            let latestResult;
            if (dOrder === 'before-event') {
                act(() => {
                    latestResult = result.current.updateSetting(
                        'openaiModel',
                        'D'
                    );
                    storageChangeListener({ openaiModel: 'B' });
                });
            } else {
                act(() => {
                    storageChangeListener({ openaiModel: 'B' });
                    latestResult = result.current.updateSetting(
                        'openaiModel',
                        'D'
                    );
                });
            }
            expect(result.current.settings.openaiModel).toBe('D');

            await act(async () => {
                writes[1].resolve();
                await pendingResult;
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(3)
            );
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(dOrder === 'before-event' ? 0 : 1);

            await act(async () => {
                writes[2].resolve();
                await latestResult;
            });
            await waitFor(() =>
                expect(result.current.settings.openaiModel).toBe('D')
            );
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1);
        }
    );

    test('waits for every exact token captured by one multi-key event before one bulk read', async () => {
        const firstWrite = createDeferred();
        const secondWrite = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            subtitleFontSize: 1.1,
        });
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(firstWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(secondWrite));
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { uiLanguage: 'es', subtitleFontSize: 1.5 },
        });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let firstResult;
        let secondResult;
        act(() => {
            firstResult = result.current.updateSetting('uiLanguage', 'es');
            secondResult = result.current.updateSetting(
                'subtitleFontSize',
                1.5
            );
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({
                uiLanguage: 'en',
                subtitleFontSize: 1.1,
            });
        });
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        await act(async () => {
            firstWrite.resolve();
            await firstResult;
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        await act(async () => {
            secondWrite.resolve();
            await secondResult;
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1)
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            ['uiLanguage', 'subtitleFontSize'],
            { includeSensitive: false }
        );
    });

    test('lets a later-started write outrank a stale read deferred by an earlier token', async () => {
        const firstWrite = createDeferred();
        const laterWrite = createDeferred();
        const strictRead = createDeferred();
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(firstWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(laterWrite));
        configService.readMultipleResultStrict.mockImplementation(
            () => strictRead.promise
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let firstResult;
        let laterResult;
        act(() => {
            firstResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
            laterResult = result.current.updateSetting('openaiModel', 'D');
        });
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        await act(async () => {
            firstWrite.resolve();
            await firstResult;
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1)
        );
        await act(async () => {
            laterWrite.resolve();
            await laterResult;
        });
        expect(result.current.settings.openaiModel).toBe('D');

        await act(async () => {
            strictRead.resolve({ values: { openaiModel: 'B' } });
            await strictRead.promise;
        });
        expect(result.current.settings.openaiModel).toBe('D');
    });

    test('leaves a pending value visible and does not read while its captured token never settles', async () => {
        const neverSettlingWrite = createDeferred();
        let storageChangeListener;
        configService.set.mockImplementation(
            resolveSingleWriteAfter(neverSettlingWrite)
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, unmount } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            void result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.settings.openaiModel).toBe('C');
        expect(result.current.error).toBeNull();
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();
        unmount();
    });

    test('keeps a later storage event authoritative while strict readback is pending', async () => {
        const pendingWrite = createDeferred();
        const firstStrictRead = createDeferred();
        const secondStrictRead = createDeferred();
        let storageChangeListener;
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        configService.readMultipleResultStrict
            .mockImplementationOnce(() => firstStrictRead.promise)
            .mockImplementationOnce(() => secondStrictRead.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
        expect(result.current.settings.openaiModel).toBe('B');

        act(() => {
            storageChangeListener({ openaiModel: 'D' });
        });
        expect(result.current.settings.openaiModel).toBe('D');
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(2);
        await act(async () => {
            firstStrictRead.resolve({ values: { openaiModel: 'B' } });
            await firstStrictRead.promise;
        });
        expect(result.current.settings.openaiModel).toBe('D');
        await act(async () => {
            secondStrictRead.resolve({ values: { openaiModel: 'D' } });
            await secondStrictRead.promise;
        });
        expect(result.current.settings.openaiModel).toBe('D');
    });

    test('surfaces a fixed strict-read failure without blocking or overriding a newer write error', async () => {
        const ambiguousWrite = createDeferred();
        const laterWrite = createDeferred();
        const strictRead = createDeferred();
        const laterWriteError = new Error('newer D failed');
        const strictError = new Error('secret-key persisted-secret-value');
        strictError.result = {
            displayFallbacks: { openaiModel: 'must-not-apply' },
        };
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(ambiguousWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(laterWrite));
        configService.readMultipleResultStrict.mockImplementation(
            () => strictRead.promise
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let ambiguousResult;
        act(() => {
            ambiguousResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await act(async () => {
            ambiguousWrite.resolve();
            await ambiguousResult;
        });
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);

        await act(async () => {
            strictRead.reject(strictError);
            await expect(strictRead.promise).rejects.toBe(strictError);
        });
        await waitFor(() =>
            expect(result.current.error).toMatchObject({
                message:
                    'Unable to confirm persisted settings after a storage update.',
            })
        );
        expect(consoleError).toHaveBeenCalledWith(
            'Settings reconciliation failed.'
        );
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
            'persisted-secret-value'
        );

        let laterResult;
        act(() => {
            laterResult = result.current.updateSetting('openaiModel', 'D');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        const laterRejection =
            expect(laterResult).rejects.toBe(laterWriteError);
        laterWrite.reject(laterWriteError);
        await act(async () => {
            await laterRejection;
        });
        expect(result.current.settings.openaiModel).toBe('B');
        expect(result.current.settings.openaiModel).not.toBe('must-not-apply');
        expect(result.current.error).toBe(laterWriteError);
        consoleError.mockRestore();
    });

    test('does not replace an already-published newer write error when strict readback later fails', async () => {
        const ambiguousWrite = createDeferred();
        const laterWrite = createDeferred();
        const strictRead = createDeferred();
        const laterWriteError = new Error('newer D failed first');
        const strictError = new Error('older reconciliation failed later');
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(ambiguousWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(laterWrite));
        configService.readMultipleResultStrict.mockImplementation(
            () => strictRead.promise
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let ambiguousResult;
        act(() => {
            ambiguousResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await act(async () => {
            ambiguousWrite.resolve();
            await ambiguousResult;
        });

        let laterResult;
        act(() => {
            laterResult = result.current.updateSetting('openaiModel', 'D');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        const laterRejection =
            expect(laterResult).rejects.toBe(laterWriteError);
        laterWrite.reject(laterWriteError);
        await act(async () => {
            await laterRejection;
        });
        expect(result.current.error).toBe(laterWriteError);

        strictRead.reject(strictError);
        await expect(strictRead.promise).rejects.toBe(strictError);
        await waitFor(() =>
            expect(consoleError).toHaveBeenCalledWith(
                'Settings reconciliation failed.'
            )
        );
        expect(result.current.error).toBe(laterWriteError);
        consoleError.mockRestore();
    });

    test('clears an older event-reconciliation error after a newer event strict read succeeds', async () => {
        const firstReadError = new Error('first event read failed');
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(firstReadError)
            .mockResolvedValueOnce({ values: { openaiModel: 'C' } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await waitFor(() =>
            expect(result.current.error).toMatchObject({
                message:
                    'Unable to confirm persisted settings after a storage update.',
            })
        );

        act(() => {
            storageChangeListener({ openaiModel: 'C' });
        });
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('C')
        );
        await waitFor(() => expect(result.current.error).toBeNull());
    });

    test('does not clear unresolved key A when a newer event strictly proves only disjoint key B', async () => {
        const disjointRead = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(new Error('uiLanguage read failed'))
            .mockImplementationOnce(() => disjointRead.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());
        const unresolvedUiLanguageError = result.current.error;

        act(() => {
            storageChangeListener({ debugMode: true });
        });
        await act(async () => {
            disjointRead.resolve({ values: { debugMode: true } });
            await disjointRead.promise;
        });
        expect(result.current.settings.debugMode).toBe(true);
        expect(result.current.error).toBe(unresolvedUiLanguageError);
    });

    test('does not clear unresolved key A when a newer local write proves only disjoint key B', async () => {
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.readMultipleResultStrict.mockRejectedValueOnce(
            new Error('uiLanguage read failed')
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());
        const unresolvedUiLanguageError = result.current.error;

        await act(async () => {
            await result.current.updateSetting('debugMode', true);
        });
        expect(result.current.settings.debugMode).toBe(true);
        expect(result.current.error).toBe(unresolvedUiLanguageError);
    });

    test('resurfaces unresolved key A after a disjoint key B write error recovers', async () => {
        const writeError = new Error('debugMode write failed');
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(new Error('uiLanguage read failed'))
            .mockResolvedValue({ values: { debugMode: false } });
        configService.set
            .mockRejectedValueOnce(writeError)
            .mockImplementationOnce(async (_key, value) => value);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() =>
            expect(result.current.error).toMatchObject({
                message:
                    'Unable to confirm persisted settings after a storage update.',
            })
        );

        await act(async () => {
            await expect(
                result.current.updateSetting('debugMode', true)
            ).rejects.toBe(writeError);
        });
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            await result.current.updateSetting('debugMode', true);
        });
        expect(result.current.settings.uiLanguage).toBe('es');
        expect(result.current.error).toMatchObject({
            message:
                'Unable to confirm persisted settings after a storage update.',
        });
    });

    test('records hidden key A uncertainty under a key B write error and resurfaces it after recovery', async () => {
        const writeError = new Error('debugMode write failed first');
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { debugMode: false } })
            .mockRejectedValueOnce(new Error('uiLanguage read failed'));
        configService.set
            .mockRejectedValueOnce(writeError)
            .mockImplementationOnce(async (_key, value) => value);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSetting('debugMode', true)
            ).rejects.toBe(writeError);
        });
        expect(result.current.error).toBe(writeError);

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            await result.current.updateSetting('debugMode', true);
        });
        expect(result.current.settings.uiLanguage).toBe('es');
        expect(result.current.error).toMatchObject({
            message:
                'Unable to confirm persisted settings after a storage update.',
        });
    });

    test('lets a successful write clear its own older uncertainty despite a newer disjoint reconciliation failure', async () => {
        const delayedWrite = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.set.mockImplementationOnce(
            resolveSingleWriteAfter(delayedWrite)
        );
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(new Error('debugMode read failed'))
            .mockRejectedValueOnce(new Error('uiLanguage read failed'))
            .mockResolvedValueOnce({ values: { uiLanguage: 'fr' } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ debugMode: true });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());

        let writeResult;
        act(() => {
            writeResult = result.current.updateSetting('debugMode', false);
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );

        await act(async () => {
            delayedWrite.resolve();
            await writeResult;
        });
        expect(result.current.error).not.toBeNull();

        act(() => {
            storageChangeListener({ uiLanguage: 'fr' });
        });
        await waitFor(() => expect(result.current.error).toBeNull());
    });

    test('clears hidden uncertainty with a strict proof without clearing a visible write error', async () => {
        const writeError = new Error('debugMode remains failed');
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.set
            .mockRejectedValueOnce(writeError)
            .mockImplementationOnce(async (_key, value) => value);
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { debugMode: false } })
            .mockRejectedValueOnce(new Error('uiLanguage read failed'))
            .mockResolvedValueOnce({ values: { uiLanguage: 'fr' } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSetting('debugMode', true)
            ).rejects.toBe(writeError);
        });
        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        expect(result.current.error).toBe(writeError);

        act(() => {
            storageChangeListener({ uiLanguage: 'fr' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(3)
        );
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            await result.current.updateSetting('debugMode', true);
        });
        expect(result.current.error).toBeNull();
    });

    test('clears same-key reconciliation uncertainty after a newer local write succeeds', async () => {
        let storageChangeListener;
        mockUnkeyedInitialValues({ uiLanguage: 'en' });
        configService.readMultipleResultStrict.mockRejectedValueOnce(
            new Error('uiLanguage event read failed')
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());

        await act(async () => {
            await result.current.updateSetting('uiLanguage', 'fr');
        });
        expect(result.current.settings.uiLanguage).toBe('fr');
        expect(result.current.error).toBeNull();
    });

    test('keeps a write error visible when projection cleanup drops hidden disjoint uncertainty', async () => {
        const writeError = new Error('debugMode write still failed');
        const projectedLoad = createDeferred();
        let storageChangeListener;
        configService.set.mockRejectedValueOnce(writeError);
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({
                values: { uiLanguage: 'en', debugMode: false },
            })
            .mockRejectedValueOnce(new Error('uiLanguage read failed'))
            .mockResolvedValueOnce({ values: { debugMode: false } })
            .mockImplementationOnce(async () => ({
                values: await projectedLoad.promise,
            }));
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            {
                initialProps: {
                    watchedKeys: ['uiLanguage', 'debugMode'],
                },
            }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());
        await act(async () => {
            await expect(
                result.current.updateSetting('debugMode', true)
            ).rejects.toBe(writeError);
        });
        expect(result.current.error).toBe(writeError);

        rerender({ watchedKeys: ['debugMode'] });
        expect(result.current.loading).toBe(true);
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            projectedLoad.resolve({ debugMode: false });
            await projectedLoad.promise;
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
    });

    test('does not mutate visible operation error state when hidden proof settles after unmount', async () => {
        const writeError = new Error('debugMode write failed before unmount');
        const hiddenProof = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.set.mockRejectedValueOnce(writeError);
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { debugMode: false } })
            .mockRejectedValueOnce(new Error('uiLanguage read failed'))
            .mockImplementationOnce(() => hiddenProof.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, unmount } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSetting('debugMode', true)
            ).rejects.toBe(writeError);
        });
        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        act(() => {
            storageChangeListener({ uiLanguage: 'fr' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(3)
        );
        expect(result.current.error).toBe(writeError);

        unmount();
        hiddenProof.resolve({ values: { uiLanguage: 'fr' } });
        await hiddenProof.promise;
        expect(result.current.error).toBe(writeError);
    });

    test('uses every successful strict read as proof while preserving a visible write error', async () => {
        const writeError = new Error('uiLanguage write failed');
        const standaloneRead = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.set
            .mockRejectedValueOnce(writeError)
            .mockImplementationOnce(async (_key, value) => value);
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(new Error('event read failed'))
            .mockImplementationOnce(() => standaloneRead.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());
        await act(async () => {
            await expect(
                result.current.updateSetting('uiLanguage', 'fr')
            ).rejects.toBe(writeError);
        });
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            standaloneRead.resolve({ values: { uiLanguage: 'en' } });
            await standaloneRead.promise;
        });
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            await result.current.updateSetting('debugMode', true);
        });
        expect(result.current.error).toBeNull();
    });

    test('uses structured batch success metadata to resolve only confirmed hidden keys', async () => {
        const writeError = new Error('partial batch write failed');
        writeError.successful = [{ area: 'sync', keys: ['uiLanguage'] }];
        writeError.failed = [{ area: 'local', keys: ['debugMode'] }];
        const neverSettlingRead = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
            subtitleFontSize: 1.1,
        });
        configService.setMultiple.mockRejectedValueOnce(writeError);
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(new Error('combined event read failed'))
            .mockImplementationOnce(() => neverSettlingRead.promise)
            .mockResolvedValueOnce({ values: { debugMode: false } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es', debugMode: true });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());

        await act(async () => {
            await expect(
                result.current.updateSettings({
                    uiLanguage: 'fr',
                    debugMode: false,
                })
            ).rejects.toBe(writeError);
        });
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            await result.current.updateSetting('subtitleFontSize', 1.2);
        });
        expect(result.current.error).toMatchObject({
            message:
                'Unable to confirm persisted settings after a storage update.',
        });

        act(() => {
            storageChangeListener({ debugMode: false });
        });
        await waitFor(() => expect(result.current.error).toBeNull());
    });

    test('keeps reconciliation provenance hidden under a load error and resurfaces it after load recovery', async () => {
        const loadError = new Error('new projection load failed');
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockRejectedValueOnce(new Error('uiLanguage read failed'))
            .mockRejectedValueOnce(loadError)
            .mockResolvedValueOnce({
                values: { uiLanguage: 'fr', subtitleFontSize: 1.2 },
            });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['uiLanguage'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());

        rerender({ watchedKeys: ['uiLanguage', 'debugMode'] });
        await waitFor(() => expect(result.current.error).toBe(loadError));
        expect(result.current.initialLoadStatus).toBe('unavailable');

        rerender({ watchedKeys: ['uiLanguage', 'subtitleFontSize'] });
        expect(result.current.initialLoadStatus).toBe('loading');
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.initialLoadStatus).toBe('ready');
        expect(result.current.error).toMatchObject({
            message:
                'Unable to confirm persisted settings after a storage update.',
        });
    });

    test('lets a newer write success clear an older load error published while the write is pending', async () => {
        const olderLoad = createDeferred();
        const newerWrite = createDeferred();
        const loadError = new Error('older load failed');
        mockUnkeyedInitialRead(() => olderLoad.promise);
        configService.set.mockImplementation(
            resolveSingleWriteAfter(newerWrite)
        );
        const { result } = renderHook(() => useSettings());

        let writeResult;
        act(() => {
            writeResult = result.current.updateSetting('openaiModel', 'saved');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        await act(async () => {
            olderLoad.reject(loadError);
            await expect(olderLoad.promise).rejects.toBe(loadError);
        });
        await waitFor(() => expect(result.current.error).toBe(loadError));
        expect(result.current.initialLoadStatus).toBe('unavailable');

        await act(async () => {
            newerWrite.resolve();
            await writeResult;
        });
        expect(result.current.error).toBeNull();
        expect(result.current.initialLoadStatus).toBe('unavailable');
    });

    test('ignores an older load failure that settles after a newer write success', async () => {
        const olderLoad = createDeferred();
        const loadError = new Error('obsolete load failed late');
        mockUnkeyedInitialRead(() => olderLoad.promise);
        const { result } = renderHook(() => useSettings());

        await act(async () => {
            await result.current.updateSetting('openaiModel', 'saved');
        });
        expect(result.current.error).toBeNull();

        await act(async () => {
            olderLoad.reject(loadError);
            await expect(olderLoad.promise).rejects.toBe(loadError);
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.initialLoadStatus).toBe('unavailable');
        expect(result.current.error).toBeNull();
    });

    test('lets a newer projection-load success clear an older write error published while loading', async () => {
        const olderWrite = createDeferred();
        const newerLoad = createDeferred();
        const writeError = new Error('older write failed');
        configService.set.mockImplementation(() => olderWrite.promise);
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: null } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let writeResult;
        act(() => {
            writeResult = result.current.updateSetting(
                'openaiModel',
                'unsaved'
            );
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        queueProjectedInitialRead(() => newerLoad.promise);
        rerender({ watchedKeys: ['uiLanguage'] });
        expect(result.current.loading).toBe(true);

        const writeRejection = expect(writeResult).rejects.toBe(writeError);
        await act(async () => {
            olderWrite.reject(writeError);
            await writeRejection;
        });
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            newerLoad.resolve({ uiLanguage: 'en' });
            await newerLoad.promise;
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
    });

    test('does not let an older write failure replace a newer projection-load error', async () => {
        const olderWrite = createDeferred();
        const newerLoad = createDeferred();
        const writeError = new Error('older write failed late');
        const loadError = new Error('newer projection load failed');
        configService.set.mockImplementation(() => olderWrite.promise);
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: null } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let writeResult;
        act(() => {
            writeResult = result.current.updateSetting(
                'openaiModel',
                'unsaved'
            );
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        queueProjectedInitialRead(() => newerLoad.promise);
        rerender({ watchedKeys: ['uiLanguage'] });
        await act(async () => {
            newerLoad.reject(loadError);
            await expect(newerLoad.promise).rejects.toBe(loadError);
        });
        await waitFor(() => expect(result.current.error).toBe(loadError));

        const writeRejection = expect(writeResult).rejects.toBe(writeError);
        await act(async () => {
            olderWrite.reject(writeError);
            await writeRejection;
        });
        expect(result.current.error).toBe(loadError);
    });

    test('drops reconciliation provenance for keys removed from the committed projection', async () => {
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockRejectedValueOnce(new Error('uiLanguage read failed'))
            .mockResolvedValueOnce({ values: { debugMode: false } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['uiLanguage'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());

        rerender({ watchedKeys: ['debugMode'] });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.settings).toEqual({ debugMode: false });
        expect(result.current.error).toBeNull();
    });

    test('retains reconciliation provenance when switching to the unkeyed all-settings projection', async () => {
        let storageChangeListener;
        queueProjectedInitialValues({ uiLanguage: 'en' });
        configService.readAllResultStrict.mockResolvedValueOnce({
            values: {
                uiLanguage: 'es',
                debugMode: false,
            },
        });
        configService.readMultipleResultStrict.mockRejectedValueOnce(
            new Error('uiLanguage read failed')
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['uiLanguage'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());
        const reconciliationError = result.current.error;

        rerender({ watchedKeys: null });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe(reconciliationError);
    });

    test('intersects multi-key reconciliation provenance with each committed projection', async () => {
        let storageChangeListener;
        const readProjectedValues = (requestedKeys) =>
            Object.fromEntries(
                requestedKeys.map((key) => [
                    key,
                    key === 'uiLanguage'
                        ? 'en'
                        : key === 'debugMode'
                          ? false
                          : 1.1,
                ])
            );
        configService.readMultipleResultStrict
            .mockImplementationOnce(async (requestedKeys) => ({
                values: readProjectedValues(requestedKeys),
            }))
            .mockRejectedValueOnce(new Error('combined read failed'))
            .mockImplementation(async (requestedKeys) => ({
                values: readProjectedValues(requestedKeys),
            }));
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            {
                initialProps: {
                    watchedKeys: ['uiLanguage', 'debugMode'],
                },
            }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es', debugMode: true });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());

        rerender({ watchedKeys: ['debugMode'] });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).not.toBeNull();

        rerender({ watchedKeys: ['subtitleFontSize'] });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
    });

    test('does not let an old projection failure repopulate a key after drop and re-add', async () => {
        const oldProjectionRead = createDeferred();
        const readdedProjectionLoad = createDeferred();
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockImplementationOnce(() => oldProjectionRead.promise)
            .mockResolvedValueOnce({ values: { debugMode: false } })
            .mockImplementationOnce(async () => ({
                values: await readdedProjectionLoad.promise,
            }));
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['uiLanguage'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );

        rerender({ watchedKeys: ['debugMode'] });
        await waitFor(() => expect(result.current.loading).toBe(false));
        rerender({ watchedKeys: ['uiLanguage'] });
        expect(result.current.loading).toBe(true);

        await act(async () => {
            oldProjectionRead.reject(new Error('obsolete uiLanguage read'));
            await expect(oldProjectionRead.promise).rejects.toThrow(
                'obsolete uiLanguage read'
            );
        });
        expect(result.current.error).toBeNull();

        await act(async () => {
            readdedProjectionLoad.resolve({ uiLanguage: 'fr' });
            await readdedProjectionLoad.promise;
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        consoleError.mockRestore();
    });

    test('does not let an old projection success overwrite a dropped and re-added key', async () => {
        const oldProjectionRead = createDeferred();
        const readdedProjectionLoad = createDeferred();
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockImplementationOnce(() => oldProjectionRead.promise)
            .mockResolvedValueOnce({ values: { debugMode: false } })
            .mockImplementationOnce(async () => ({
                values: await readdedProjectionLoad.promise,
            }));
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['uiLanguage'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'event-before-drop' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );

        rerender({ watchedKeys: ['debugMode'] });
        await waitFor(() => expect(result.current.loading).toBe(false));
        rerender({ watchedKeys: ['uiLanguage'] });
        expect(result.current.loading).toBe(true);
        expect(result.current.settings.uiLanguage).toBe('event-before-drop');

        await act(async () => {
            oldProjectionRead.resolve({
                values: { uiLanguage: 'stale-old-proof' },
            });
            await oldProjectionRead.promise;
        });
        expect(result.current.loading).toBe(true);
        expect(result.current.settings.uiLanguage).toBe('event-before-drop');
        expect(result.current.error).toBeNull();

        await act(async () => {
            readdedProjectionLoad.resolve({ uiLanguage: 'new-authority' });
            await readdedProjectionLoad.promise;
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.settings.uiLanguage).toBe('new-authority');
    });

    test('ignores an old multi-key success after the full request identity changes', async () => {
        const oldProjectionRead = createDeferred();
        const intermediateProjectionLoad = createDeferred();
        const readdedProjectionLoad = createDeferred();
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({
                values: { uiLanguage: 'en', debugMode: false },
            })
            .mockImplementationOnce(() => oldProjectionRead.promise)
            .mockImplementationOnce(() => intermediateProjectionLoad.promise)
            .mockImplementationOnce(async () => ({
                values: await readdedProjectionLoad.promise,
            }));
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            {
                initialProps: {
                    watchedKeys: ['uiLanguage', 'debugMode'],
                },
            }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({
                uiLanguage: 'event-before-drop',
                debugMode: true,
            });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );

        rerender({ watchedKeys: ['debugMode'] });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(3)
        );
        rerender({ watchedKeys: ['uiLanguage', 'debugMode'] });
        expect(result.current.loading).toBe(true);
        expect(result.current.settings.debugMode).toBe(true);

        await act(async () => {
            oldProjectionRead.resolve({
                values: {
                    uiLanguage: 'stale-old-proof',
                    debugMode: false,
                },
            });
            await oldProjectionRead.promise;
        });
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'event-before-drop',
            debugMode: true,
        });
        expect(result.current.error).toBeNull();

        await act(async () => {
            readdedProjectionLoad.resolve({
                uiLanguage: 'new-authority',
                debugMode: false,
            });
            await readdedProjectionLoad.promise;
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.settings.uiLanguage).toBe('new-authority');
        intermediateProjectionLoad.resolve({ values: { debugMode: false } });
        await intermediateProjectionLoad.promise;
    });

    test('ignores an invalid old strict projection after the full request identity changes', async () => {
        const oldProjectionRead = createDeferred();
        const intermediateProjectionLoad = createDeferred();
        const readdedProjectionLoad = createDeferred();
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({
                values: { uiLanguage: 'en', debugMode: false },
            })
            .mockImplementationOnce(() => oldProjectionRead.promise)
            .mockImplementationOnce(() => intermediateProjectionLoad.promise)
            .mockImplementationOnce(async () => ({
                values: await readdedProjectionLoad.promise,
            }));
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            {
                initialProps: {
                    watchedKeys: ['uiLanguage', 'debugMode'],
                },
            }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({
                uiLanguage: 'event-before-drop',
                debugMode: true,
            });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        rerender({ watchedKeys: ['debugMode'] });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(3)
        );
        rerender({ watchedKeys: ['uiLanguage', 'debugMode'] });

        await act(async () => {
            // The entire read belongs to an obsolete request token, so its
            // hostile/incomplete shape is neither inspected nor surfaced.
            oldProjectionRead.resolve({ values: { debugMode: false } });
            await oldProjectionRead.promise;
        });
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'event-before-drop',
            debugMode: true,
        });
        expect(result.current.error).toBeNull();
        expect(consoleError).not.toHaveBeenCalled();

        await act(async () => {
            readdedProjectionLoad.resolve({
                uiLanguage: 'new-authority',
                debugMode: true,
            });
            await readdedProjectionLoad.promise;
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        intermediateProjectionLoad.resolve({ values: { debugMode: false } });
        await intermediateProjectionLoad.promise;
        consoleError.mockRestore();
    });

    test('does not apply an old event success after unmount', async () => {
        const oldProjectionRead = createDeferred();
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockImplementationOnce(() => oldProjectionRead.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, unmount } = renderHook(() =>
            useSettings(['uiLanguage'])
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ uiLanguage: 'event-before-unmount' });
        });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        expect(result.current.settings.uiLanguage).toBe('event-before-unmount');
        unmount();

        oldProjectionRead.resolve({
            values: { uiLanguage: 'must-not-apply' },
        });
        await oldProjectionRead.promise;
        expect(result.current.settings.uiLanguage).toBe('event-before-unmount');
        expect(result.current.error).toBeNull();
    });

    test('clears unresolved A and B only when one newer strict read proves both keys', async () => {
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            subtitleFontSize: 1.1,
        });
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(new Error('combined read failed'))
            .mockResolvedValueOnce({
                values: { uiLanguage: 'fr', subtitleFontSize: 1.6 },
            });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({
                uiLanguage: 'es',
                subtitleFontSize: 1.5,
            });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());

        act(() => {
            storageChangeListener({
                uiLanguage: 'fr',
                subtitleFontSize: 1.6,
            });
        });
        await waitFor(() => expect(result.current.error).toBeNull());
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'fr',
            subtitleFontSize: 1.6,
        });
    });

    test('keeps reconciliation error until strict successes cover the full failed-key intersection', async () => {
        const uiLanguageRead = createDeferred();
        const fontSizeRead = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            subtitleFontSize: 1.1,
        });
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(new Error('combined read failed'))
            .mockImplementationOnce(() => uiLanguageRead.promise)
            .mockImplementationOnce(() => fontSizeRead.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({
                uiLanguage: 'es',
                subtitleFontSize: 1.5,
            });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());
        const combinedError = result.current.error;

        act(() => {
            storageChangeListener({ uiLanguage: 'fr' });
        });
        await act(async () => {
            uiLanguageRead.resolve({ values: { uiLanguage: 'fr' } });
            await uiLanguageRead.promise;
        });
        expect(result.current.settings.uiLanguage).toBe('fr');
        expect(result.current.error).toBe(combinedError);

        act(() => {
            storageChangeListener({ subtitleFontSize: 1.6 });
        });
        await act(async () => {
            fontSizeRead.resolve({ values: { subtitleFontSize: 1.6 } });
            await fontSizeRead.promise;
        });
        await waitFor(() => expect(result.current.error).toBeNull());
    });

    test('does not clear an older write error when a newer event strict read succeeds', async () => {
        const writeError = new Error('local write failed');
        const failureRead = createDeferred();
        let storageChangeListener;
        configService.set.mockRejectedValue(writeError);
        configService.readMultipleResultStrict
            .mockImplementationOnce(() => failureRead.promise)
            .mockResolvedValueOnce({ values: { openaiModel: 'external' } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSetting('openaiModel', 'local')
            ).rejects.toBe(writeError);
        });
        expect(result.current.error).toBe(writeError);

        act(() => {
            storageChangeListener({ openaiModel: 'external' });
        });
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('external')
        );
        expect(result.current.error).toBe(writeError);
    });

    test('does not let an older delayed success clear a newer reconciliation error', async () => {
        const olderRead = createDeferred();
        const newerReadError = new Error('newer event read failed');
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockImplementationOnce(() => olderRead.promise)
            .mockRejectedValueOnce(newerReadError);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
            storageChangeListener({ openaiModel: 'C' });
        });
        await waitFor(() =>
            expect(result.current.error).toMatchObject({
                message:
                    'Unable to confirm persisted settings after a storage update.',
            })
        );
        const newerReconciliationError = result.current.error;

        await act(async () => {
            olderRead.resolve({ values: { openaiModel: 'B' } });
            await olderRead.promise;
        });
        expect(result.current.settings.openaiModel).toBe('C');
        expect(result.current.error).toBe(newerReconciliationError);
    });

    test('does not let an older delayed success clear a newer write error', async () => {
        const olderRead = createDeferred();
        const failureRead = createDeferred();
        const writeError = new Error('newer local write failed');
        let storageChangeListener;
        configService.set.mockRejectedValue(writeError);
        configService.readMultipleResultStrict
            .mockImplementationOnce(() => olderRead.promise)
            .mockImplementationOnce(() => failureRead.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await act(async () => {
            await expect(
                result.current.updateSetting('openaiModel', 'D')
            ).rejects.toBe(writeError);
        });
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            olderRead.resolve({ values: { openaiModel: 'B' } });
            await olderRead.promise;
        });
        expect(result.current.error).toBe(writeError);
    });

    test('does not clear reconciliation error state after unmount', async () => {
        const laterSuccessfulRead = createDeferred();
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockRejectedValueOnce(new Error('first event read failed'))
            .mockImplementationOnce(() => laterSuccessfulRead.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, unmount } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await waitFor(() => expect(result.current.error).not.toBeNull());
        const reconciliationError = result.current.error;
        act(() => {
            storageChangeListener({ openaiModel: 'C' });
        });
        unmount();

        laterSuccessfulRead.resolve({ values: { openaiModel: 'C' } });
        await laterSuccessfulRead.promise;
        expect(result.current.error).toBe(reconciliationError);
    });

    test('keeps a hung strict read nonblocking and leaves the provisional event as rollback authority', async () => {
        const ambiguousWrite = createDeferred();
        const laterWrite = createDeferred();
        const neverSettlingRead = createDeferred();
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(ambiguousWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(laterWrite));
        configService.readMultipleResultStrict.mockImplementation(
            () => neverSettlingRead.promise
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let ambiguousResult;
        act(() => {
            ambiguousResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await act(async () => {
            ambiguousWrite.resolve();
            await ambiguousResult;
        });
        expect(result.current.settings.openaiModel).toBe('B');
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);

        let laterResult;
        act(() => {
            laterResult = result.current.updateSetting('openaiModel', 'D');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        expect(result.current.settings.openaiModel).toBe('D');
        await act(async () => {
            laterWrite.resolve();
            await laterResult;
        });

        expect(result.current.settings.openaiModel).toBe('D');
        expect(result.current.settings.openaiModel).not.toBe('initial');
        expect(result.current.error).toBeNull();
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
    });

    test('issues one strict read for each separate sync and local event', async () => {
        const pendingWrite = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple.mockImplementation(
            resolveBatchWriteAfter(pendingWrite)
        );
        configService.readMultipleResultStrict.mockResolvedValue({
            values: { uiLanguage: 'es', debugMode: true },
        });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSettings({
                uiLanguage: 'es',
                debugMode: true,
            });
        });
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(1)
        );

        act(() => {
            // Chrome dispatches sync and local storage changes separately.
            storageChangeListener({ uiLanguage: 'en' });
            storageChangeListener({ debugMode: false });
        });
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'es',
            debugMode: true,
        });
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });
        await waitFor(() =>
            expect(result.current.settings).toMatchObject({
                uiLanguage: 'es',
                debugMode: true,
            })
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(2);
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['uiLanguage'], { includeSensitive: false }],
            [['debugMode'], { includeSensitive: false }],
        ]);
    });

    test('treats a nominal strict result missing one requested key as wholly uncertain', async () => {
        const pendingWrite = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            subtitleFontSize: 1.1,
        });
        configService.setMultiple.mockImplementation(
            resolveBatchWriteAfter(pendingWrite)
        );
        configService.readMultipleResultStrict.mockResolvedValue({
            ok: true,
            degraded: false,
            failedAreas: [],
            values: { uiLanguage: 'must-not-partially-apply' },
        });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSettings({
                uiLanguage: 'es',
                subtitleFontSize: 1.5,
            });
        });
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(1)
        );
        act(() => {
            // Both keys live in sync storage, so Chrome can report them in one
            // callback and the hook must validate the whole projection once.
            storageChangeListener({
                uiLanguage: 'en',
                subtitleFontSize: 1.1,
            });
        });

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });
        await waitFor(() =>
            expect(result.current.error).toMatchObject({
                message:
                    'Unable to confirm persisted settings after a storage update.',
            })
        );
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'en',
            subtitleFontSize: 1.1,
        });
        expect(result.current.settings.uiLanguage).not.toBe(
            'must-not-partially-apply'
        );
        expect(console.error).toHaveBeenCalledWith(
            'Settings reconciliation failed.'
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            ['uiLanguage', 'subtitleFontSize'],
            { includeSensitive: false }
        );
    });

    test.each([
        [
            'inherited requested key',
            () => ({
                readResult: {
                    values: Object.create({
                        openaiModel: 'must-not-inherit',
                    }),
                },
            }),
        ],
        [
            'requested-key accessor',
            () => {
                const forbiddenAccess = jest.fn(
                    () => 'must-not-call-key-getter'
                );
                const values = {};
                Object.defineProperty(values, 'openaiModel', {
                    get: forbiddenAccess,
                    enumerable: true,
                });
                return { readResult: { values }, forbiddenAccess };
            },
        ],
        [
            'values accessor',
            () => {
                const forbiddenAccess = jest.fn(() => ({
                    openaiModel: 'must-not-call-values-getter',
                }));
                const readResult = {};
                Object.defineProperty(readResult, 'values', {
                    get: forbiddenAccess,
                    enumerable: true,
                });
                return { readResult, forbiddenAccess };
            },
        ],
        [
            'array values container',
            () => {
                const values = [];
                Object.defineProperty(values, 'openaiModel', {
                    value: 'must-not-array',
                    enumerable: true,
                });
                return { readResult: { values } };
            },
        ],
        [
            'hostile property-descriptor proxy',
            () => ({
                readResult: {
                    values: new Proxy(
                        {},
                        {
                            getOwnPropertyDescriptor() {
                                throw new Error(
                                    'hostile-secret-descriptor-failure'
                                );
                            },
                        }
                    ),
                },
            }),
        ],
    ])(
        'treats a strict result with a %s as uncertain without invoking accessors',
        async (_label, createHostileResult) => {
            let storageChangeListener;
            const { readResult, forbiddenAccess } = createHostileResult();
            configService.readMultipleResultStrict.mockResolvedValue(
                readResult
            );
            configService.onChanged.mockImplementation((listener) => {
                storageChangeListener = listener;
                return () => {};
            });
            const { result } = renderHook(() => useSettings());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => {
                storageChangeListener({ openaiModel: 'B' });
            });
            await waitFor(() =>
                expect(result.current.error).toMatchObject({
                    message:
                        'Unable to confirm persisted settings after a storage update.',
                })
            );

            expect(result.current.settings.openaiModel).toBe('B');
            expect(result.current.settings.openaiModel).not.toBe('initial');
            if (forbiddenAccess) {
                expect(forbiddenAccess).not.toHaveBeenCalled();
            }
            expect(console.error).toHaveBeenCalledWith(
                'Settings reconciliation failed.'
            );
            expect(JSON.stringify(console.error.mock.calls)).not.toContain(
                'hostile-secret'
            );
        }
    );

    test('does not read for an event semantically equal to current authority with no pending conflict', async () => {
        let storageChangeListener;
        mockUnkeyedInitialValues({
            subtitleBlacklist: {
                disneyplus: ['forced=yes'],
                netflix: [],
                generic: [],
            },
        });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({
                subtitleBlacklist: {
                    disneyplus: ['forced=yes'],
                    netflix: [],
                    generic: [],
                },
            });
        });

        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();
        expect(result.current.settings.subtitleBlacklist).toEqual({
            disneyplus: ['forced=yes'],
            netflix: [],
            generic: [],
        });
    });

    test('does not launch a deferred event readback after its request token becomes stale', async () => {
        const pendingWrite = createDeferred();
        let storageChangeListener;
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });

        rerender({ watchedKeys: ['uiLanguage'] });
        await waitFor(() =>
            expect(result.current.settings).toEqual({ uiLanguage: 'en' })
        );
        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['uiLanguage'], { includeSensitive: false }],
        ]);
        expect(result.current.settings).toEqual({ uiLanguage: 'en' });
    });

    test('strictly checks a delayed echo after a projection reset keeps the key watched', async () => {
        const strictRead = createDeferred();
        let persistedValue = 'A';
        let storageChangeListener;
        const readProjectedValues = (requestedKeys) =>
            Object.fromEntries(
                requestedKeys.map((key) => [
                    key,
                    key === 'openaiModel' ? persistedValue : 'en',
                ])
            );
        configService.set.mockImplementation(async (_key, value) => {
            persistedValue = value;
            return value;
        });
        configService.readMultipleResultStrict
            .mockImplementationOnce(async (requestedKeys) => ({
                values: readProjectedValues(requestedKeys),
            }))
            .mockImplementationOnce(async (requestedKeys) => ({
                values: readProjectedValues(requestedKeys),
            }))
            .mockImplementationOnce(() => strictRead.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateSetting('openaiModel', 'B');
            await result.current.updateSetting('openaiModel', 'C');
        });
        rerender({ watchedKeys: ['openaiModel', 'uiLanguage'] });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.settings.openaiModel).toBe('C');

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        expect(result.current.settings.openaiModel).toBe('B');
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(3);
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['openaiModel', 'uiLanguage'], { includeSensitive: false }],
            [['openaiModel'], { includeSensitive: false }],
        ]);
        await act(async () => {
            strictRead.resolve({ values: { openaiModel: 'C' } });
            await strictRead.promise;
        });
        expect(result.current.settings.openaiModel).toBe('C');
    });

    test('skips a deferred event read when its captured token settles after unmount', async () => {
        const pendingWrite = createDeferred();
        let storageChangeListener;
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, unmount } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();
        unmount();

        pendingWrite.resolve();
        await updateResult;
        await Promise.resolve();
        expect(configService.readMultipleResultStrict).not.toHaveBeenCalled();
    });

    test('reconciles a second ambiguity after readback becomes the authority source', async () => {
        const firstWrite = createDeferred();
        const secondWrite = createDeferred();
        let storageChangeListener;
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(firstWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(secondWrite));
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'B' } })
            .mockResolvedValueOnce({ values: { openaiModel: 'D' } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let firstResult;
        act(() => {
            firstResult = result.current.updateSetting('openaiModel', 'C');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await act(async () => {
            firstWrite.resolve();
            await firstResult;
        });
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('B')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);

        let secondResult;
        act(() => {
            secondResult = result.current.updateSetting('openaiModel', 'D');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));
        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await act(async () => {
            secondWrite.resolve();
            await secondResult;
        });
        await waitFor(() =>
            expect(result.current.settings.openaiModel).toBe('D')
        );
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(2);
    });

    test.each([
        ['array', 'aiContextTypes', ['cultural', 'linguistic']],
        [
            'object',
            'subtitleBlacklist',
            { disneyplus: ['forced=yes'], netflix: [], generic: [] },
        ],
    ])(
        'strictly verifies a structured-cloned pending %s event exactly once',
        async (_label, key, pendingValue) => {
            const pendingWrite = createDeferred();
            let storageChangeListener;
            mockUnkeyedInitialValues({ [key]: null });
            configService.set.mockImplementation(
                resolveSingleWriteAfter(pendingWrite)
            );
            configService.readMultipleResultStrict.mockResolvedValue({
                values: { [key]: pendingValue },
            });
            configService.onChanged.mockImplementation((listener) => {
                storageChangeListener = listener;
                return () => {};
            });
            const { result } = renderHook(() => useSettings());
            await waitFor(() => expect(result.current.loading).toBe(false));

            let updateResult;
            act(() => {
                updateResult = result.current.updateSetting(key, pendingValue);
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(1)
            );
            act(() => {
                storageChangeListener({
                    [key]: JSON.parse(JSON.stringify(pendingValue)),
                });
            });
            await act(async () => {
                pendingWrite.resolve();
                await updateResult;
            });

            expect(result.current.settings[key]).toEqual(pendingValue);
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1);
        }
    );

    test.each([
        {
            label: 'array',
            key: 'aiContextTypes',
            initialValue: ['historical'],
            confirmedValue: ['cultural'],
            latestValue: ['cultural', 'linguistic'],
        },
        {
            label: 'object',
            key: 'subtitleBlacklist',
            initialValue: { netflix: ['initial'] },
            confirmedValue: { netflix: ['confirmed'] },
            latestValue: { netflix: ['latest'] },
        },
    ])(
        'recognizes a delayed cloned $label echo while the latest structured write settles',
        async ({ key, initialValue, confirmedValue, latestValue }) => {
            const pendingWrites = [];
            let storageChangeListener;
            mockUnkeyedInitialValues({ [key]: initialValue });
            configService.set.mockImplementation(
                (_key, value) =>
                    new Promise((resolve) => {
                        pendingWrites.push({
                            resolve: () => resolve(value),
                        });
                    })
            );
            configService.readMultipleResultStrict.mockResolvedValue({
                values: { [key]: latestValue },
            });
            configService.onChanged.mockImplementation((listener) => {
                storageChangeListener = listener;
                return () => {};
            });
            const { result } = renderHook(() => useSettings());
            await waitFor(() => expect(result.current.loading).toBe(false));

            let confirmedResult;
            let latestResult;
            act(() => {
                confirmedResult = result.current.updateSetting(
                    key,
                    confirmedValue
                );
                latestResult = result.current.updateSetting(key, latestValue);
            });
            await waitFor(() => expect(pendingWrites).toHaveLength(1));

            await act(async () => {
                pendingWrites[0].resolve();
                await confirmedResult;
            });
            await waitFor(() => expect(pendingWrites).toHaveLength(2));

            act(() => {
                storageChangeListener({
                    [key]: JSON.parse(JSON.stringify(confirmedValue)),
                });
            });
            expect(result.current.settings[key]).toEqual(latestValue);
            expect(
                configService.readMultipleResultStrict
            ).not.toHaveBeenCalled();

            await act(async () => {
                pendingWrites[1].resolve();
                await latestResult;
            });
            await waitFor(() =>
                expect(result.current.settings[key]).toEqual(latestValue)
            );
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1);
        }
    );

    test('keeps unkeyed prototype-sensitive settings safe through every state transition', async () => {
        const pendingWrite = createDeferred();
        const pendingReadback = createDeferred();
        const writeError = new Error('prototype-sensitive update failed');
        writeError.completeFailure = true;
        writeError.failed = [
            {
                area: 'sync',
                keys: ['__proto__', 'constructor', 'toString'],
            },
        ];
        let storageChangeListener;
        mockUnkeyedInitialValues(createPrototypeSensitiveSettings('load'));
        configService.readMultipleResultStrict.mockImplementation(
            () => pendingReadback.promise
        );
        configService.setMultiple.mockImplementation(
            () => pendingWrite.promise
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expectPrototypeSafeSettings(result.current.settings, 'load');

        act(() => {
            storageChangeListener(createPrototypeSensitiveSettings('event'));
        });
        expectPrototypeSafeSettings(result.current.settings, 'event');

        let updateResult;
        act(() => {
            updateResult = result.current.updateSettings(
                createPrototypeSensitiveSettings('optimistic')
            );
        });
        expectPrototypeSafeSettings(result.current.settings, 'optimistic');
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(1)
        );

        const rejection = expect(updateResult).rejects.toBe(writeError);
        pendingWrite.reject(writeError);
        await act(async () => {
            await rejection;
        });
        expectPrototypeSafeSettings(result.current.settings, 'event');

        act(() => {
            pendingReadback.resolve({
                values: createPrototypeSensitiveSettings('readback'),
            });
        });
        await waitFor(() =>
            expect(
                Object.getOwnPropertyDescriptor(
                    result.current.settings,
                    '__proto__'
                )?.value
            ).toEqual({ polluted: 'readback' })
        );
        expectPrototypeSafeSettings(result.current.settings, 'readback');
    });

    test('snapshots prototype-sensitive batch bindings before a queued caller mutation', async () => {
        const blockingWrite = createDeferred();
        mockUnkeyedInitialValues({
            openaiModel: 'A',
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.set.mockImplementation(
            resolveSingleWriteAfter(blockingWrite)
        );
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        const callerUpdates = createPrototypeSensitiveSettings('snapshot');
        callerUpdates.uiLanguage = 'es';
        let blockingResult;
        let queuedResult;
        act(() => {
            blockingResult = result.current.updateSetting('openaiModel', 'B');
            queuedResult = result.current.updateSettings(callerUpdates);

            delete callerUpdates.uiLanguage;
            callerUpdates.__proto__ = { polluted: 'mutated-binding' };
            callerUpdates.constructor = 'mutated-constructor';
            callerUpdates.toString = 'mutated-toString';
            callerUpdates.debugMode = true;
        });

        expect(result.current.settings.uiLanguage).toBe('es');
        expect(result.current.settings.debugMode).toBe(false);
        expectPrototypeSafeSettings(result.current.settings, 'snapshot');
        expect(configService.setMultiple).not.toHaveBeenCalled();

        await act(async () => {
            blockingWrite.resolve();
            await blockingResult;
        });
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(1)
        );

        const persistedUpdates = configService.setMultiple.mock.calls[0][0];
        expect(Object.keys(persistedUpdates)).toEqual([
            '__proto__',
            'constructor',
            'toString',
            'uiLanguage',
        ]);
        expect(persistedUpdates.uiLanguage).toBe('es');
        expect(persistedUpdates.debugMode).toBeUndefined();
        expectPrototypeSafeSettings(persistedUpdates, 'snapshot');

        await act(async () => {
            await queuedResult;
        });
        expect(result.current.settings.uiLanguage).toBe('es');
        expect(result.current.settings.debugMode).toBe(false);
        expectPrototypeSafeSettings(result.current.settings, 'snapshot');
    });

    test('rolls the latest failed write back to the last confirmed value', async () => {
        const writeError = new Error('storage write failed');
        configService.set.mockRejectedValue(writeError);
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSetting('openaiModel', 'new-value')
            ).rejects.toBe(writeError);
        });

        expect(result.current.settings.openaiModel).toBe('initial');
        expect(result.current.error).toBe(writeError);
    });

    test('does not let an older failed write clobber a newer pending value', async () => {
        const olderWrite = createDeferred();
        const newerWrite = createDeferred();
        const olderError = new Error('older write failed');
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(olderWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(newerWrite));
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let olderResult;
        let newerResult;
        await act(async () => {
            olderResult = result.current.updateSetting('openaiModel', 'B');
            newerResult = result.current.updateSetting('openaiModel', 'C');
            await Promise.resolve();
        });
        expect(result.current.settings.openaiModel).toBe('C');

        const olderRejection = expect(olderResult).rejects.toBe(olderError);
        olderWrite.reject(olderError);
        await act(async () => {
            await olderRejection;
        });

        expect(result.current.settings.openaiModel).toBe('C');
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));

        await act(async () => {
            newerWrite.resolve();
            await newerResult;
        });
        expect(result.current.settings.openaiModel).toBe('C');
        expect(result.current.error).toBeNull();
    });

    test('restores the last successful write when the newer write fails', async () => {
        const olderWrite = createDeferred();
        const newerWrite = createDeferred();
        const newerError = new Error('newer write failed');
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(olderWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(newerWrite));
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let olderResult;
        let newerResult;
        await act(async () => {
            olderResult = result.current.updateSetting('openaiModel', 'B');
            newerResult = result.current.updateSetting('openaiModel', 'C');
            await Promise.resolve();
        });

        await act(async () => {
            olderWrite.resolve();
            await olderResult;
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));

        const newerRejection = expect(newerResult).rejects.toBe(newerError);
        newerWrite.reject(newerError);
        await act(async () => {
            await newerRejection;
        });

        expect(result.current.settings.openaiModel).toBe('B');
        expect(result.current.error).toBe(newerError);
    });

    test('restores the original value when consecutive writes both fail', async () => {
        const olderWrite = createDeferred();
        const newerWrite = createDeferred();
        const olderError = new Error('older write failed');
        const newerError = new Error('newer write failed');
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(olderWrite))
            .mockImplementationOnce(resolveSingleWriteAfter(newerWrite));
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let olderResult;
        let newerResult;
        await act(async () => {
            olderResult = result.current.updateSetting('openaiModel', 'B');
            newerResult = result.current.updateSetting('openaiModel', 'C');
            await Promise.resolve();
        });

        const olderRejection = expect(olderResult).rejects.toBe(olderError);
        olderWrite.reject(olderError);
        await act(async () => {
            await olderRejection;
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(2));

        const newerRejection = expect(newerResult).rejects.toBe(newerError);
        newerWrite.reject(newerError);
        await act(async () => {
            await newerRejection;
        });

        expect(result.current.settings.openaiModel).toBe('initial');
        expect(result.current.error).toBe(newerError);
    });

    test('tracks storage changes as confirmed while a newer pending value stays visible', async () => {
        const pendingWrite = createDeferred();
        const writeError = new Error('pending write failed');
        let storageChangeListener;
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        await act(async () => {
            updateResult = result.current.updateSetting(
                'openaiModel',
                'pending'
            );
            await Promise.resolve();
        });

        act(() => {
            storageChangeListener({ openaiModel: 'confirmed-elsewhere' });
        });
        expect(result.current.settings.openaiModel).toBe('pending');

        const rejection = expect(updateResult).rejects.toBe(writeError);
        pendingWrite.reject(writeError);
        await act(async () => {
            await rejection;
        });

        expect(result.current.settings.openaiModel).toBe('confirmed-elsewhere');
    });

    test('reconciles a partially failed multi-area update from persisted values', async () => {
        const writeError = new Error('local storage failed');
        writeError.partialFailure = true;
        writeError.successful = [{ area: 'sync', keys: ['uiLanguage'] }];
        writeError.failed = [{ area: 'local', keys: ['debugMode'] }];
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple.mockRejectedValue(writeError);
        configService.readMultipleResultStrict.mockResolvedValue({
            values: {
                uiLanguage: 'es',
                debugMode: false,
            },
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSettings({
                    uiLanguage: 'es',
                    debugMode: true,
                })
            ).rejects.toBe(writeError);
        });

        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            ['uiLanguage', 'debugMode'],
            { includeSensitive: false }
        );
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'es',
            debugMode: false,
        });
        expect(result.current.error).toBe(writeError);
    });

    test('retains prior authority when partial-success readback fails', async () => {
        const writeError = new Error('partial storage write failed');
        writeError.partialFailure = true;
        writeError.successful = [{ area: 'sync', keys: ['uiLanguage'] }];
        writeError.failed = [{ area: 'local', keys: ['debugMode'] }];
        const readError = new Error('storage readback failed');
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple.mockRejectedValue(writeError);
        configService.readMultipleResultStrict.mockRejectedValue(readError);
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSettings({
                    uiLanguage: 'es',
                    debugMode: true,
                })
            ).rejects.toBe(writeError);
        });

        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            ['uiLanguage', 'debugMode'],
            { includeSensitive: false }
        );
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'en',
            debugMode: false,
        });
        expect(result.current.error).toBe(writeError);
    });

    test('never promotes raw input for a normalized partial batch success without readback proof', async () => {
        const writeError = new Error('partial storage write failed');
        writeError.partialFailure = true;
        writeError.successful = [{ area: 'sync', keys: ['targetLanguage'] }];
        writeError.failed = [{ area: 'local', keys: ['debugMode'] }];
        const readError = new Error('storage readback failed');
        mockUnkeyedInitialValues({
            targetLanguage: 'fr',
            debugMode: false,
        });
        configService.setMultiple.mockRejectedValue(writeError);
        configService.readMultipleResultStrict.mockRejectedValue(readError);
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSettings({
                    targetLanguage: 'EN-us',
                    debugMode: true,
                })
            ).rejects.toBe(writeError);
        });

        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            ['targetLanguage', 'debugMode'],
            { includeSensitive: false }
        );
        expect(result.current.settings).toMatchObject({
            targetLanguage: 'fr',
            debugMode: false,
        });
        expect(result.current.error).toBe(writeError);
    });

    test('removes every unconfirmed optimistic batch value before optional readback settles', async () => {
        const writeError = new Error('partial storage write failed');
        writeError.partialFailure = true;
        writeError.successful = [{ area: 'sync', keys: ['uiLanguage'] }];
        writeError.failed = [{ area: 'local', keys: ['debugMode'] }];
        const readback = createDeferred();
        const readError = new Error('storage readback failed');
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple.mockRejectedValue(writeError);
        configService.readMultipleResultStrict.mockImplementation(
            () => readback.promise
        );
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSettings({
                uiLanguage: 'es',
                debugMode: true,
            });
        });
        const rejection = expect(updateResult).rejects.toBe(writeError);
        await waitFor(() =>
            expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
                ['uiLanguage', 'debugMode'],
                { includeSensitive: false }
            )
        );

        expect(result.current.settings).toMatchObject({
            uiLanguage: 'en',
            debugMode: false,
        });
        expect(result.current.error).toBe(writeError);

        await act(async () => {
            await rejection;
        });
        await act(async () => {
            readback.reject(readError);
            await Promise.resolve();
        });
    });

    test('does not block later writes on optional failed-batch readback', async () => {
        const writeError = new Error('batch write failed');
        writeError.completeFailure = true;
        writeError.failed = [{ area: 'sync', keys: ['uiLanguage'] }];
        const readback = createDeferred();
        const laterWrite = createDeferred();
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
        });
        configService.setMultiple.mockRejectedValue(writeError);
        configService.readMultipleResultStrict.mockImplementation(
            () => readback.promise
        );
        configService.set.mockImplementation(
            resolveSingleWriteAfter(laterWrite)
        );
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let failedResult;
        let laterResult;
        act(() => {
            failedResult = result.current.updateSettings({ uiLanguage: 'es' });
            laterResult = result.current.updateSetting('uiLanguage', 'fr');
        });
        const failedRejection = expect(failedResult).rejects.toBe(writeError);
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(configService.set).toHaveBeenCalledWith('uiLanguage', 'fr');

        await act(async () => {
            laterWrite.resolve();
            await failedRejection;
            await laterResult;
        });
        act(() => {
            readback.resolve({ values: { uiLanguage: 'en' } });
        });
        await waitFor(() =>
            expect(result.current.settings).toMatchObject({
                uiLanguage: 'fr',
            })
        );
    });

    test('rolls unknown batch outcomes back when reconciliation readback fails', async () => {
        const writeError = new Error('unstructured storage failure');
        const readError = new Error('storage readback failed');
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple.mockRejectedValue(writeError);
        configService.readMultipleResultStrict.mockRejectedValue(readError);
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSettings({
                    uiLanguage: 'es',
                    debugMode: true,
                })
            ).rejects.toBe(writeError);
        });

        expect(result.current.settings).toMatchObject({
            uiLanguage: 'en',
            debugMode: false,
        });
        expect(result.current.error).toBe(writeError);
    });

    test('fails validation metadata closed when reconciliation readback fails', async () => {
        const writeError = new Error('validation failed');
        writeError.validationErrors = [
            { key: 'debugMode', type: 'invalid_value' },
        ];
        const readError = new Error('storage readback failed');
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple.mockRejectedValue(writeError);
        configService.readMultipleResultStrict.mockRejectedValue(readError);
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(
                result.current.updateSettings({
                    uiLanguage: 'es',
                    debugMode: 'invalid',
                })
            ).rejects.toBe(writeError);
        });

        expect(result.current.settings).toMatchObject({
            uiLanguage: 'en',
            debugMode: false,
        });
        expect(result.current.error).toBe(writeError);
    });

    test('does not let a readback overwrite a newer storage event', async () => {
        const writeError = new Error('storage write failed');
        writeError.completeFailure = true;
        writeError.failed = [
            { area: 'sync', keys: ['uiLanguage'] },
            { area: 'local', keys: ['debugMode'] },
        ];
        const readback = createDeferred();
        const eventReadback = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple.mockRejectedValue(writeError);
        configService.readMultipleResultStrict
            .mockImplementationOnce(() => readback.promise)
            .mockImplementationOnce(() => eventReadback.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSettings({
                uiLanguage: 'es',
                debugMode: true,
            });
        });
        const rejection = expect(updateResult).rejects.toBe(writeError);
        await waitFor(() =>
            expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
                ['uiLanguage', 'debugMode'],
                { includeSensitive: false }
            )
        );

        act(() => {
            readback.resolve({
                values: {
                    uiLanguage: 'stale-readback',
                    debugMode: false,
                },
            });
            // This event occurs after the readback resolves but before its
            // promise continuation runs.
            storageChangeListener({ uiLanguage: 'event-wins' });
        });
        await act(async () => {
            await rejection;
        });

        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(2);
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'event-wins',
            debugMode: false,
        });
        await act(async () => {
            eventReadback.resolve({
                values: {
                    uiLanguage: 'event-wins',
                },
            });
            await eventReadback.promise;
        });
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'event-wins',
            debugMode: false,
        });
        expect(result.current.error).toBe(writeError);
    });

    test('does not let initial loading overwrite a newer storage event', async () => {
        const initialLoad = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialRead(() => initialLoad.promise);
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());

        act(() => {
            storageChangeListener({ openaiModel: 'event-wins' });
        });
        expect(result.current.settings.openaiModel).toBe('event-wins');

        act(() => {
            initialLoad.resolve({ openaiModel: 'stale-load' });
        });
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.settings.openaiModel).toBe('event-wins');
    });

    test('does not let initial loading overwrite a successful newer write', async () => {
        const initialLoad = createDeferred();
        mockUnkeyedInitialRead(() => initialLoad.promise);
        const { result } = renderHook(() => useSettings());

        await act(async () => {
            await expect(
                result.current.updateSetting('openaiModel', 'write-wins')
            ).resolves.toBe(true);
        });
        expect(result.current.settings.openaiModel).toBe('write-wins');

        act(() => {
            initialLoad.resolve({ openaiModel: 'stale-load' });
        });
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.settings.openaiModel).toBe('write-wins');
    });

    test('does not let initial loading clear a newer write error', async () => {
        const initialLoad = createDeferred();
        const writeError = new Error('newer write failed');
        mockUnkeyedInitialRead(() => initialLoad.promise);
        configService.set.mockRejectedValue(writeError);
        const { result } = renderHook(() => useSettings());

        await act(async () => {
            await expect(
                result.current.updateSetting('openaiModel', 'unsaved')
            ).rejects.toBe(writeError);
        });
        expect(result.current.error).toBe(writeError);

        act(() => {
            initialLoad.resolve({ openaiModel: 'loaded-value' });
        });
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.settings.openaiModel).toBe('loaded-value');
        expect(result.current.error).toBe(writeError);
    });

    test('does not let older write success clear a newer projection-load error', async () => {
        const pendingWrite = createDeferred();
        const loadError = new Error('newer projection load failed');
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: null } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'B');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        configService.readMultipleResultStrict.mockRejectedValue(loadError);
        rerender({ watchedKeys: ['uiLanguage'] });
        await waitFor(() => expect(result.current.error).toBe(loadError));

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });

        expect(result.current.error).toBe(loadError);
    });

    test('does not re-add an unwatched key when its pending write succeeds', async () => {
        const pendingWrite = createDeferred();
        mockProjectedReads((requestedKeys) =>
            Promise.resolve(
                requestedKeys.includes('openaiModel')
                    ? { openaiModel: 'A' }
                    : { uiLanguage: 'en' }
            )
        );
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'B');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        rerender({ watchedKeys: ['uiLanguage'] });
        await waitFor(() =>
            expect(result.current.settings).toEqual({ uiLanguage: 'en' })
        );
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['uiLanguage'], { includeSensitive: false }],
        ]);

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });

        expect(result.current.settings).toEqual({ uiLanguage: 'en' });
    });

    test('projects settings in the first render after watched keys change', async () => {
        const projectedLoad = createDeferred();
        const projectedRenderSettings = [];
        mockProjectedReads((requestedKeys) =>
            requestedKeys.includes('openaiModel')
                ? Promise.resolve({ openaiModel: 'A' })
                : projectedLoad.promise
        );
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => {
                const hook = useSettings(watchedKeys);
                if (watchedKeys.includes('uiLanguage')) {
                    projectedRenderSettings.push({ ...hook.settings });
                }
                return hook;
            },
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        rerender({ watchedKeys: ['uiLanguage'] });

        expect(projectedRenderSettings[0]).toEqual({});
        expect(projectedRenderSettings).not.toContainEqual({
            openaiModel: 'A',
        });

        act(() => {
            projectedLoad.resolve({ uiLanguage: 'en' });
        });
        await waitFor(() =>
            expect(result.current.settings).toEqual({ uiLanguage: 'en' })
        );
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['uiLanguage'], { includeSensitive: false }],
        ]);
    });

    test('never exposes a storage event queued across a projection change', async () => {
        const projectedLoad = createDeferred();
        const projectedRenderSettings = [];
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
            .mockResolvedValueOnce({
                values: { openaiModel: 'event-value' },
            })
            .mockImplementationOnce(async () => ({
                values: await projectedLoad.promise,
            }));
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => {
                const hook = useSettings(watchedKeys);
                if (watchedKeys.includes('uiLanguage')) {
                    projectedRenderSettings.push({ ...hook.settings });
                }
                return hook;
            },
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            storageChangeListener({ openaiModel: 'event-value' });
            rerender({ watchedKeys: ['uiLanguage'] });
        });

        expect(projectedRenderSettings.length).toBeGreaterThan(0);
        for (const renderedSettings of projectedRenderSettings) {
            expect(renderedSettings).not.toHaveProperty('openaiModel');
        }

        act(() => {
            projectedLoad.resolve({ uiLanguage: 'en' });
        });
        await waitFor(() =>
            expect(result.current.settings).toEqual({ uiLanguage: 'en' })
        );
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['openaiModel'], { includeSensitive: false }],
            [['uiLanguage'], { includeSensitive: false }],
        ]);
    });

    test('does not re-add an unwatched key after failed-write readback', async () => {
        const pendingWrite = createDeferred();
        const writeError = new Error('projected write failed');
        writeError.completeFailure = true;
        writeError.failed = [{ area: 'sync', keys: ['openaiModel'] }];
        configService.setMultiple.mockImplementation(
            () => pendingWrite.promise
        );
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSettings({
                openaiModel: 'B',
            });
        });
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(1)
        );

        rerender({ watchedKeys: ['uiLanguage'] });
        await waitFor(() =>
            expect(result.current.settings).toEqual({ uiLanguage: 'en' })
        );

        const rejection = expect(updateResult).rejects.toBe(writeError);
        pendingWrite.reject(writeError);
        await act(async () => {
            await rejection;
        });

        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['uiLanguage'], { includeSensitive: false }],
            [['openaiModel'], { includeSensitive: false }],
        ]);
        expect(result.current.settings).toEqual({ uiLanguage: 'en' });
    });

    test('remembers a confirmed single write completed while its key is unwatched', async () => {
        const confirmedWrite = createDeferred();
        const reloadError = new Error('projected reload failed');
        const laterWriteError = new Error('later write failed');
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockRejectedValueOnce(reloadError)
            .mockResolvedValueOnce({ values: { openaiModel: 'B' } });
        configService.set
            .mockImplementationOnce(resolveSingleWriteAfter(confirmedWrite))
            .mockRejectedValueOnce(laterWriteError);
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let confirmedResult;
        act(() => {
            confirmedResult = result.current.updateSetting('openaiModel', 'B');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        rerender({ watchedKeys: ['uiLanguage'] });
        await waitFor(() =>
            expect(result.current.settings).toEqual({ uiLanguage: 'en' })
        );
        await act(async () => {
            confirmedWrite.resolve();
            await confirmedResult;
        });
        expect(result.current.settings).toEqual({ uiLanguage: 'en' });

        rerender({ watchedKeys: ['openaiModel'] });
        await waitFor(() => expect(result.current.error).toBe(reloadError));
        expect(result.current.settings).toEqual({ openaiModel: 'B' });

        await act(async () => {
            await expect(
                result.current.updateSetting('openaiModel', 'C')
            ).rejects.toBe(laterWriteError);
        });

        expect(result.current.settings).toEqual({ openaiModel: 'B' });
        expect(result.current.error).toBe(laterWriteError);
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(4);
        expect(configService.readMultipleResultStrict).toHaveBeenNthCalledWith(
            4,
            ['openaiModel'],
            { includeSensitive: false }
        );
    });

    test('keeps the last proven value until an unwatched partial success is read back', async () => {
        const batchWrite = createDeferred();
        const hungReload = createDeferred();
        const writeError = new Error('partial batch failure');
        writeError.partialFailure = true;
        writeError.successful = [{ area: 'sync', keys: ['openaiModel'] }];
        writeError.failed = [{ area: 'local', keys: ['debugMode'] }];
        const readError = new Error('batch readback failed');
        const laterWriteError = new Error('later write failed');
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockRejectedValueOnce(readError)
            .mockImplementationOnce(() => hungReload.promise)
            .mockResolvedValueOnce({ values: { openaiModel: 'B' } });
        configService.setMultiple.mockImplementation(() => batchWrite.promise);
        configService.set.mockRejectedValue(laterWriteError);
        const { result, rerender, unmount } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let batchResult;
        act(() => {
            batchResult = result.current.updateSettings({
                openaiModel: 'B',
                debugMode: true,
            });
        });
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(1)
        );

        rerender({ watchedKeys: ['uiLanguage'] });
        await waitFor(() =>
            expect(result.current.settings).toEqual({ uiLanguage: 'en' })
        );
        const batchRejection = expect(batchResult).rejects.toBe(writeError);
        batchWrite.reject(writeError);
        await act(async () => {
            await batchRejection;
        });
        expect(result.current.settings).toEqual({ uiLanguage: 'en' });

        rerender({ watchedKeys: ['openaiModel'] });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(4)
        );
        expect(result.current.loading).toBe(true);
        expect(result.current.settings).toEqual({ openaiModel: 'A' });

        await act(async () => {
            await expect(
                result.current.updateSetting('openaiModel', 'C')
            ).rejects.toBe(laterWriteError);
        });

        expect(result.current.settings).toEqual({ openaiModel: 'B' });
        expect(result.current.error).toBe(laterWriteError);
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['uiLanguage'], { includeSensitive: false }],
            [['openaiModel', 'debugMode'], { includeSensitive: false }],
            [['openaiModel'], { includeSensitive: false }],
            [['openaiModel'], { includeSensitive: false }],
        ]);
        unmount();
    });

    test.each(['hung', 'failed'])(
        'restores confirmed off-projection values when switching to an unkeyed %s load',
        async (loadOutcome) => {
            const unkeyedLoad = createDeferred();
            const reloadError = new Error('unkeyed reload failed');
            queueProjectedInitialValues({ openaiModel: 'A' });
            mockUnkeyedInitialRead(() =>
                loadOutcome === 'hung'
                    ? unkeyedLoad.promise
                    : Promise.reject(reloadError)
            );
            const { result, rerender, unmount } = renderHook(
                ({ watchedKeys }) => useSettings(watchedKeys),
                { initialProps: { watchedKeys: ['openaiModel'] } }
            );
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.updateSetting('uiLanguage', 'fr');
            });
            expect(result.current.settings).toEqual({ openaiModel: 'A' });

            rerender({ watchedKeys: null });
            expect(result.current.settings).toEqual({
                openaiModel: 'A',
                uiLanguage: 'fr',
            });

            if (loadOutcome === 'hung') {
                expect(result.current.loading).toBe(true);
                unmount();
            } else {
                await waitFor(() => expect(result.current.loading).toBe(false));
                expect(result.current.error).toBe(reloadError);
                expect(result.current.settings).toEqual({
                    openaiModel: 'A',
                    uiLanguage: 'fr',
                });
            }
        }
    );

    test('shows an off-projection pending value immediately after switching to unkeyed mode', async () => {
        const pendingWrite = createDeferred();
        const unkeyedLoad = createDeferred();
        queueProjectedInitialValues({ openaiModel: 'A' });
        mockUnkeyedInitialRead(() => unkeyedLoad.promise);
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        const { result, rerender, unmount } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('uiLanguage', 'fr');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));
        expect(result.current.settings).toEqual({ openaiModel: 'A' });

        rerender({ watchedKeys: null });
        expect(result.current.loading).toBe(true);
        expect(result.current.settings).toEqual({
            openaiModel: 'A',
            uiLanguage: 'fr',
        });

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });
        expect(result.current.settings).toEqual({
            openaiModel: 'A',
            uiLanguage: 'fr',
        });
        unmount();
    });

    test.each(['load-first', 'write-first'])(
        'write success beats a stale load started during it (%s)',
        async (completionOrder) => {
            const pendingWrite = createDeferred();
            const staleLoad = createDeferred();
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
                .mockImplementationOnce(async () => ({
                    values: await staleLoad.promise,
                }));
            configService.set.mockImplementation(
                resolveSingleWriteAfter(pendingWrite)
            );
            const { result, rerender } = renderHook(
                ({ watchedKeys }) => useSettings(watchedKeys),
                { initialProps: { watchedKeys: ['openaiModel'] } }
            );
            await waitFor(() => expect(result.current.loading).toBe(false));

            let updateResult;
            act(() => {
                updateResult = result.current.updateSetting('openaiModel', 'B');
            });
            await waitFor(() =>
                expect(configService.set).toHaveBeenCalledTimes(1)
            );

            rerender({
                watchedKeys: ['openaiModel', 'uiLanguage'],
            });
            await waitFor(() =>
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(2)
            );

            if (completionOrder === 'load-first') {
                act(() => {
                    staleLoad.resolve({
                        openaiModel: 'A',
                        uiLanguage: 'en',
                    });
                });
                await waitFor(() => expect(result.current.loading).toBe(false));
                await act(async () => {
                    pendingWrite.resolve();
                    await updateResult;
                });
            } else {
                await act(async () => {
                    pendingWrite.resolve();
                    await updateResult;
                });
                act(() => {
                    staleLoad.resolve({
                        openaiModel: 'A',
                        uiLanguage: 'en',
                    });
                });
                await waitFor(() => expect(result.current.loading).toBe(false));
            }

            expect(result.current.settings).toEqual({
                openaiModel: 'B',
                uiLanguage: 'en',
            });
        }
    );

    test('does not launch a deferred old-request event read after projection change', async () => {
        const pendingWrite = createDeferred();
        const staleLoad = createDeferred();
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
            .mockImplementationOnce(async () => ({
                values: await staleLoad.promise,
            }))
            .mockResolvedValueOnce({
                values: { openaiModel: 'event-wins' },
            });
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result, rerender } = renderHook(
            ({ watchedKeys }) => useSettings(watchedKeys),
            { initialProps: { watchedKeys: ['openaiModel'] } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'B');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        act(() => {
            storageChangeListener({ openaiModel: 'event-wins' });
        });
        rerender({ watchedKeys: ['openaiModel', 'uiLanguage'] });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        act(() => {
            staleLoad.resolve({
                openaiModel: 'A',
                uiLanguage: 'en',
            });
        });
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });

        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['openaiModel', 'uiLanguage'], { includeSensitive: false }],
        ]);

        expect(result.current.settings).toEqual({
            openaiModel: 'event-wins',
            uiLanguage: 'en',
        });
    });

    test('persists a setting invoked after unmount without changing hook state', async () => {
        const { result, unmount } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));
        const updateSetting = result.current.updateSetting;
        const renderedSettings = result.current.settings;

        unmount();
        await expect(
            updateSetting('openaiModel', 'post-unmount')
        ).resolves.toBe(true);

        expect(configService.set).toHaveBeenCalledWith(
            'openaiModel',
            'post-unmount'
        );
        expect(result.current.settings).toBe(renderedSettings);
        expect(result.current.error).toBeNull();
    });

    test('does not let single-write success overwrite a newer storage event', async () => {
        const pendingWrite = createDeferred();
        let storageChangeListener;
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'B');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        act(() => {
            storageChangeListener({ openaiModel: 'event-wins' });
        });
        expect(result.current.settings.openaiModel).toBe('B');

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });

        expect(result.current.settings.openaiModel).toBe('event-wins');
    });

    test('accepts a same-value storage event while a single write settles', async () => {
        const pendingWrite = createDeferred();
        let storageChangeListener;
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'B');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        act(() => {
            storageChangeListener({ openaiModel: 'B' });
        });
        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });

        expect(result.current.settings.openaiModel).toBe('B');
    });

    test('treats a repeated baseline event as newer than an in-flight write', async () => {
        const pendingWrite = createDeferred();
        let storageChangeListener;
        configService.set.mockImplementation(
            resolveSingleWriteAfter(pendingWrite)
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSetting('openaiModel', 'B');
        });
        await waitFor(() => expect(configService.set).toHaveBeenCalledTimes(1));

        act(() => {
            storageChangeListener({ openaiModel: 'initial' });
        });
        expect(result.current.settings.openaiModel).toBe('B');

        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });

        expect(result.current.settings.openaiModel).toBe('initial');
    });

    test('does not let batch-write success overwrite a newer storage event', async () => {
        const pendingWrite = createDeferred();
        let storageChangeListener;
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple.mockImplementation(
            resolveBatchWriteAfter(pendingWrite)
        );
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let updateResult;
        act(() => {
            updateResult = result.current.updateSettings({
                uiLanguage: 'es',
                debugMode: true,
            });
        });
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(1)
        );

        act(() => {
            storageChangeListener({ uiLanguage: 'event-wins' });
        });
        await act(async () => {
            pendingWrite.resolve();
            await updateResult;
        });

        expect(result.current.settings).toMatchObject({
            uiLanguage: 'event-wins',
            debugMode: true,
        });
    });

    test('reconciles failed batch keys without clobbering a disjoint batch', async () => {
        const olderWrite = createDeferred();
        const newerWrite = createDeferred();
        const olderError = new Error('older batch failed');
        olderError.completeFailure = true;
        olderError.failed = [{ area: 'sync', keys: ['uiLanguage'] }];
        const readError = new Error('readback failed');
        mockUnkeyedInitialValues({
            uiLanguage: 'en',
            debugMode: false,
        });
        configService.setMultiple
            .mockImplementationOnce(resolveBatchWriteAfter(olderWrite))
            .mockImplementationOnce(resolveBatchWriteAfter(newerWrite));
        configService.readMultipleResultStrict.mockRejectedValue(readError);
        const { result } = renderHook(() => useSettings());
        await waitFor(() => expect(result.current.loading).toBe(false));

        let olderResult;
        let newerResult;
        act(() => {
            olderResult = result.current.updateSettings({ uiLanguage: 'es' });
            newerResult = result.current.updateSettings({ debugMode: true });
        });
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(1)
        );
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'es',
            debugMode: true,
        });

        const olderRejection = expect(olderResult).rejects.toBe(olderError);
        olderWrite.reject(olderError);
        await act(async () => {
            await olderRejection;
        });
        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
        expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
            ['uiLanguage'],
            { includeSensitive: false }
        );
        expect(configService.getMultiple).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(configService.setMultiple).toHaveBeenCalledTimes(2)
        );

        expect(result.current.settings).toMatchObject({
            uiLanguage: 'en',
            debugMode: true,
        });

        await act(async () => {
            newerWrite.resolve();
            await newerResult;
        });
        expect(result.current.settings).toMatchObject({
            uiLanguage: 'en',
            debugMode: true,
        });
    });

    test('projects watched keys and cleans up its storage subscription', async () => {
        const unsubscribe = jest.fn();
        let storageChangeListener;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { uiLanguage: 'en' } })
            .mockResolvedValueOnce({ values: { uiLanguage: 'es' } });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return unsubscribe;
        });
        const { result, unmount } = renderHook(() =>
            useSettings(['uiLanguage'])
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(configService.readMultipleResultStrict).toHaveBeenCalledTimes(1);
        expect(configService.readMultipleResultStrict).toHaveBeenNthCalledWith(
            1,
            ['uiLanguage'],
            { includeSensitive: false }
        );
        act(() => {
            storageChangeListener({ uiLanguage: 'es' });
            storageChangeListener({ debugMode: true });
        });
        expect(result.current.settings).toEqual({ uiLanguage: 'es' });
        await waitFor(() =>
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2)
        );
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['uiLanguage'], { includeSensitive: false }],
            [['uiLanguage'], { includeSensitive: false }],
        ]);

        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    test.each(['success', 'failure'])(
        'reports a changed projection as loading on every pre-settlement render (%s)',
        async (outcome) => {
            const projectedLoad = createDeferred();
            const projectedError = new Error('projected load failed');
            const renderSequence = [];
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
                .mockImplementationOnce(async () => ({
                    values: await projectedLoad.promise,
                }));
            const { result, rerender } = renderHook(
                ({ watchedKeys }) => {
                    const hookState = useSettings(watchedKeys);
                    renderSequence.push({
                        projection: watchedKeys[0],
                        loading: hookState.loading,
                        initialLoadStatus: hookState.initialLoadStatus,
                    });
                    return hookState;
                },
                { initialProps: { watchedKeys: ['openaiModel'] } }
            );
            await waitFor(() => expect(result.current.loading).toBe(false));

            const changedProjectionStart = renderSequence.length;
            rerender({ watchedKeys: ['uiLanguage'] });
            expect(result.current.loading).toBe(true);
            await waitFor(() =>
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(2)
            );

            const preSettlementRenders = renderSequence
                .slice(changedProjectionStart)
                .filter(({ projection }) => projection === 'uiLanguage');
            expect(preSettlementRenders.length).toBeGreaterThan(0);
            expect(preSettlementRenders.every(({ loading }) => loading)).toBe(
                true
            );
            expect(
                preSettlementRenders.every(
                    ({ initialLoadStatus }) => initialLoadStatus === 'loading'
                )
            ).toBe(true);

            if (outcome === 'success') {
                act(() => {
                    projectedLoad.resolve({ uiLanguage: 'en' });
                });
                await waitFor(() => expect(result.current.loading).toBe(false));
                expect(result.current.initialLoadStatus).toBe('ready');
                expect(result.current.settings).toEqual({ uiLanguage: 'en' });
                expect(result.current.error).toBeNull();
            } else {
                act(() => {
                    projectedLoad.reject(projectedError);
                });
                await waitFor(() => expect(result.current.loading).toBe(false));
                expect(result.current.initialLoadStatus).toBe('unavailable');
                expect(result.current.settings).toEqual({});
                expect(result.current.error).toBe(projectedError);
            }
        }
    );

    test.each([
        { staleOutcome: 'success', currentOutcome: 'success' },
        { staleOutcome: 'failure', currentOutcome: 'failure' },
    ])(
        'keeps unresolved stale X $staleOutcome from settling current Y $currentOutcome',
        async ({ staleOutcome, currentOutcome }) => {
            const staleXLoad = createDeferred();
            const currentYLoad = createDeferred();
            const staleError = new Error('stale X projection failed');
            const currentError = new Error('current Y projection failed');
            const renderSequence = [];
            mockProjectedReads((requestedKeys) =>
                requestedKeys.includes('uiLanguage')
                    ? currentYLoad.promise
                    : staleXLoad.promise
            );
            const { result, rerender } = renderHook(
                ({ watchedKeys }) => {
                    const hookState = useSettings(watchedKeys);
                    renderSequence.push({
                        projection: watchedKeys[0],
                        loading: hookState.loading,
                        initialLoadStatus: hookState.initialLoadStatus,
                    });
                    return hookState;
                },
                { initialProps: { watchedKeys: ['openaiModel'] } }
            );
            await waitFor(() =>
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(1)
            );
            expect(result.current.loading).toBe(true);
            expect(result.current.initialLoadStatus).toBe('loading');

            const changedProjectionStart = renderSequence.length;
            rerender({ watchedKeys: ['uiLanguage'] });
            await waitFor(() =>
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(2)
            );
            expect(result.current.loading).toBe(true);
            expect(result.current.initialLoadStatus).toBe('loading');

            act(() => {
                if (staleOutcome === 'success') {
                    staleXLoad.resolve({ openaiModel: 'A' });
                } else {
                    staleXLoad.reject(staleError);
                }
            });
            await act(async () => {
                await Promise.resolve();
            });
            expect(result.current.loading).toBe(true);
            expect(result.current.initialLoadStatus).toBe('loading');
            expect(result.current.settings).toEqual({});
            expect(result.current.error).toBeNull();
            rerender({ watchedKeys: ['uiLanguage'], tick: 1 });
            expect(result.current.loading).toBe(true);
            const preSettlementYRenders = renderSequence
                .slice(changedProjectionStart)
                .filter(({ projection }) => projection === 'uiLanguage');
            expect(preSettlementYRenders.length).toBeGreaterThan(0);
            expect(preSettlementYRenders.every(({ loading }) => loading)).toBe(
                true
            );
            expect(
                preSettlementYRenders.every(
                    ({ initialLoadStatus }) => initialLoadStatus === 'loading'
                )
            ).toBe(true);

            act(() => {
                if (currentOutcome === 'success') {
                    currentYLoad.resolve({ uiLanguage: 'en' });
                } else {
                    currentYLoad.reject(currentError);
                }
            });
            await waitFor(() => expect(result.current.loading).toBe(false));
            if (currentOutcome === 'success') {
                expect(result.current.initialLoadStatus).toBe('ready');
                expect(result.current.settings).toEqual({ uiLanguage: 'en' });
                expect(result.current.error).toBeNull();
            } else {
                expect(result.current.initialLoadStatus).toBe('unavailable');
                expect(result.current.settings).toEqual({});
                expect(result.current.error).toBe(currentError);
            }
        }
    );

    test('keeps events scoped to the committed projection when a transition render is abandoned', async () => {
        const neverSettles = new Promise(() => {});
        let setWatchedKeys;
        let storageChangeListener;
        let suspendedRenderCount = 0;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
            .mockResolvedValueOnce({
                values: { openaiModel: 'event-wins' },
            });
        configService.onChanged.mockImplementation((listener) => {
            storageChangeListener = listener;
            return () => {};
        });

        function ProjectionProbe() {
            const [watchedKeys, setProjection] = useState(['openaiModel']);
            setWatchedKeys = setProjection;
            const hookState = useSettings(watchedKeys);
            if (watchedKeys[0] === 'uiLanguage') {
                suspendedRenderCount += 1;
                throw neverSettles;
            }
            return (
                <output data-testid="committed-settings">
                    {JSON.stringify(hookState.settings)}
                </output>
            );
        }

        const view = render(
            <Suspense fallback={<div>loading transition</div>}>
                <ProjectionProbe />
            </Suspense>
        );
        await waitFor(() =>
            expect(view.getByTestId('committed-settings').textContent).toBe(
                JSON.stringify({ openaiModel: 'A' })
            )
        );

        act(() => {
            startTransition(() => {
                setWatchedKeys(['uiLanguage']);
            });
        });
        await waitFor(() => expect(suspendedRenderCount).toBeGreaterThan(0));

        act(() => {
            storageChangeListener({ openaiModel: 'event-wins' });
        });
        await waitFor(() =>
            expect(view.getByTestId('committed-settings').textContent).toBe(
                JSON.stringify({ openaiModel: 'event-wins' })
            )
        );
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['openaiModel'], { includeSensitive: false }],
        ]);

        act(() => {
            setWatchedKeys(['openaiModel']);
        });
        await waitFor(() =>
            expect(view.getByTestId('committed-settings').textContent).toBe(
                JSON.stringify({ openaiModel: 'event-wins' })
            )
        );
    });

    test('commits the new projection before a caller layout effect fires an old subscription', async () => {
        const projectedLoad = createDeferred();
        let committedXListener;
        let setWatchedKeys;
        let firedAtYLayout = false;
        configService.readMultipleResultStrict
            .mockResolvedValueOnce({ values: { openaiModel: 'A' } })
            .mockImplementationOnce(async () => ({
                values: await projectedLoad.promise,
            }));
        configService.onChanged.mockImplementation((listener) => {
            committedXListener ??= listener;
            return () => {};
        });

        function ProjectionProbe() {
            const [watchedKeys, setProjection] = useState(['openaiModel']);
            setWatchedKeys = setProjection;
            const hookState = useSettings(watchedKeys);
            useLayoutEffect(() => {
                if (watchedKeys[0] === 'uiLanguage' && !firedAtYLayout) {
                    firedAtYLayout = true;
                    committedXListener({
                        openaiModel: 'must-stay-filtered',
                        uiLanguage: 'event-wins',
                    });
                }
            }, [watchedKeys]);
            return (
                <output data-testid="layout-race-settings">
                    {JSON.stringify({
                        settings: hookState.settings,
                        loading: hookState.loading,
                    })}
                </output>
            );
        }

        const view = render(<ProjectionProbe />);
        await waitFor(() =>
            expect(view.getByTestId('layout-race-settings').textContent).toBe(
                JSON.stringify({
                    settings: { openaiModel: 'A' },
                    loading: false,
                })
            )
        );

        act(() => {
            setWatchedKeys(['uiLanguage']);
        });
        expect(firedAtYLayout).toBe(true);
        await waitFor(() => {
            const rendered = JSON.parse(
                view.getByTestId('layout-race-settings').textContent
            );
            expect(rendered).toEqual({
                settings: {},
                loading: true,
            });
        });
        expect(configService.readMultipleResultStrict.mock.calls).toEqual([
            [['openaiModel'], { includeSensitive: false }],
            [['uiLanguage'], { includeSensitive: false }],
        ]);

        act(() => {
            projectedLoad.resolve({ uiLanguage: 'current-authority' });
        });
        await waitFor(() => {
            const rendered = JSON.parse(
                view.getByTestId('layout-race-settings').textContent
            );
            expect(rendered).toEqual({
                settings: { uiLanguage: 'current-authority' },
                loading: false,
            });
        });
    });

    test.each(['success', 'failure'])(
        'ignores stale X %s fired from the committing Y layout boundary',
        async (staleOutcome) => {
            const staleXLoad = createDeferred();
            const currentYLoad = createDeferred();
            const staleError = new Error('stale layout-boundary X failed');
            let setWatchedKeys;
            let firedAtYLayout = false;
            mockProjectedReads((requestedKeys) =>
                requestedKeys.includes('uiLanguage')
                    ? currentYLoad.promise
                    : staleXLoad.promise
            );

            function ProjectionProbe() {
                const [watchedKeys, setProjection] = useState(['openaiModel']);
                setWatchedKeys = setProjection;
                const hookState = useSettings(watchedKeys);
                useLayoutEffect(() => {
                    if (watchedKeys[0] === 'uiLanguage' && !firedAtYLayout) {
                        firedAtYLayout = true;
                        if (staleOutcome === 'success') {
                            staleXLoad.resolve({ openaiModel: 'stale-X' });
                        } else {
                            staleXLoad.reject(staleError);
                        }
                    }
                }, [watchedKeys]);
                return (
                    <output data-testid="layout-load-race-settings">
                        {JSON.stringify({
                            settings: hookState.settings,
                            loading: hookState.loading,
                            error: hookState.error?.message ?? null,
                        })}
                    </output>
                );
            }

            const view = render(<ProjectionProbe />);
            await waitFor(() =>
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(1)
            );

            act(() => {
                setWatchedKeys(['uiLanguage']);
            });
            expect(firedAtYLayout).toBe(true);
            await waitFor(() =>
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(2)
            );
            await act(async () => {
                await Promise.resolve();
            });
            expect(
                JSON.parse(
                    view.getByTestId('layout-load-race-settings').textContent
                )
            ).toEqual({ settings: {}, loading: true, error: null });

            act(() => {
                currentYLoad.resolve({ uiLanguage: 'current-Y' });
            });
            await waitFor(() =>
                expect(
                    JSON.parse(
                        view.getByTestId('layout-load-race-settings')
                            .textContent
                    )
                ).toEqual({
                    settings: { uiLanguage: 'current-Y' },
                    loading: false,
                    error: null,
                })
            );
        }
    );
});
