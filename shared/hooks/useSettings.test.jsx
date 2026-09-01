import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

const configService = {
    get: jest.fn(),
    getAll: jest.fn(),
    getMultiple: jest.fn(),
    onChanged: jest.fn(),
    readAllResultStrict: jest.fn(),
    readMultipleResultStrict: jest.fn(),
    set: jest.fn(),
    setMultiple: jest.fn(),
};
const isSensitiveAccessExplicitlyEnabled = jest.fn();

jest.unstable_mockModule('../../services/configService.js', () => ({
    configService,
    isSensitiveAccessExplicitlyEnabled,
}));

const { useSettings } = await import('./useSettings.js');

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

async function waitUntilReady(result) {
    await waitFor(() => {
        expect(result.current.initialLoadStatus).toBe('ready');
    });
}

describe('useSettings', () => {
    let changeListeners;
    let unsubscribe;
    let consoleError;

    beforeEach(() => {
        changeListeners = [];
        unsubscribe = jest.fn();
        consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        isSensitiveAccessExplicitlyEnabled
            .mockReset()
            .mockImplementation(
                (options) =>
                    Object.hasOwn(options, 'includeSensitive') &&
                    options.includeSensitive === true
            );
        configService.get.mockReset();
        configService.getAll.mockReset();
        configService.getMultiple.mockReset();
        configService.onChanged.mockReset().mockImplementation((listener) => {
            changeListeners.push(listener);
            return unsubscribe;
        });
        configService.readAllResultStrict
            .mockReset()
            .mockResolvedValue({ values: { model: 'initial' } });
        configService.readMultipleResultStrict
            .mockReset()
            .mockImplementation(async (requestedKeys) => ({
                values: Object.fromEntries(
                    requestedKeys.map((key) => [key, `${key}-initial`])
                ),
            }));
        configService.set
            .mockReset()
            .mockImplementation(async (_key, value) => value);
        configService.setMultiple
            .mockReset()
            .mockImplementation(async (updates) => ({ ...updates }));
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    describe('strict reads and projections', () => {
        test('loads a normalized key projection and exposes the public contract', async () => {
            configService.readMultipleResultStrict.mockResolvedValue({
                values: { targetLanguage: 'fr' },
            });

            const { result } = renderHook(() => useSettings('targetLanguage'));

            expect(result.current.loading).toBe(true);
            expect(result.current.initialLoadStatus).toBe('loading');
            expect(result.current.settings).toEqual({});

            await waitUntilReady(result);

            expect(result.current).toEqual(
                expect.objectContaining({
                    settings: { targetLanguage: 'fr' },
                    loading: false,
                    initialLoadStatus: 'ready',
                    error: null,
                    updateSetting: expect.any(Function),
                    updateSettings: expect.any(Function),
                })
            );
            expect(configService.readMultipleResultStrict).toHaveBeenCalledWith(
                ['targetLanguage'],
                { includeSensitive: false }
            );
            expect(configService.onChanged).toHaveBeenCalledWith(
                expect.any(Function),
                { includeSensitive: false }
            );
            expect(configService.get).not.toHaveBeenCalled();
            expect(configService.getMultiple).not.toHaveBeenCalled();
            expect(configService.getAll).not.toHaveBeenCalled();
        });

        test('uses the strict all-settings projection with explicit sensitive access', async () => {
            configService.readAllResultStrict.mockResolvedValue({
                values: { model: 'gpt', apiKey: 'secret' },
            });

            const { result } = renderHook(() =>
                useSettings(undefined, { includeSensitive: true })
            );
            await waitUntilReady(result);

            expect(result.current.settings).toEqual({
                model: 'gpt',
                apiKey: 'secret',
            });
            expect(configService.readAllResultStrict).toHaveBeenCalledWith({
                includeSensitive: true,
            });
            expect(configService.onChanged).toHaveBeenCalledWith(
                expect.any(Function),
                { includeSensitive: true }
            );
        });

        test('fails closed when a strict projected read is incomplete', async () => {
            configService.readMultipleResultStrict.mockResolvedValue({
                values: { first: 1 },
            });

            const { result } = renderHook(() =>
                useSettings(['first', 'second'])
            );
            await waitFor(() => {
                expect(result.current.initialLoadStatus).toBe('unavailable');
            });

            expect(result.current.loading).toBe(false);
            expect(result.current.settings).toEqual({});
            expect(result.current.error).toEqual(
                new TypeError('Unable to validate loaded settings.')
            );
            expect(consoleError.mock.calls).toEqual([
                ['Settings initial load failed.'],
            ]);
        });

        test('does not reload equivalent string and singleton-array projections', async () => {
            configService.readMultipleResultStrict.mockResolvedValue({
                values: { model: 'initial' },
            });
            const { result, rerender } = renderHook(
                ({ watched }) => useSettings(watched),
                { initialProps: { watched: 'model' } }
            );
            await waitUntilReady(result);

            rerender({ watched: ['model'] });

            expect(result.current.settings).toEqual({ model: 'initial' });
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1);
            expect(configService.onChanged).toHaveBeenCalledTimes(1);
        });

        test('projects new keys immediately and ignores an old load result', async () => {
            const oldLoad = createDeferred();
            configService.readMultipleResultStrict.mockImplementation(
                async ([key]) => {
                    if (key === 'oldKey') {
                        return oldLoad.promise;
                    }
                    return { values: { newKey: 'new-value' } };
                }
            );
            const { result, rerender } = renderHook(
                ({ watched }) => useSettings(watched),
                { initialProps: { watched: ['oldKey'] } }
            );

            rerender({ watched: ['newKey'] });
            expect(result.current.settings).toEqual({});
            expect(result.current.loading).toBe(true);
            await waitUntilReady(result);
            expect(result.current.settings).toEqual({
                newKey: 'new-value',
            });

            await act(async () => {
                oldLoad.resolve({ values: { oldKey: 'stale-value' } });
                await oldLoad.promise;
            });

            expect(result.current.settings).toEqual({
                newKey: 'new-value',
            });
            expect(unsubscribe).toHaveBeenCalled();
        });

        test('clears privileged values while sensitivity changes and reloads them on the new scope', async () => {
            configService.readMultipleResultStrict.mockImplementation(
                async (_keys, { includeSensitive }) => ({
                    values: {
                        apiKey: includeSensitive ? 'secret' : 'public-value',
                    },
                })
            );
            const { result, rerender } = renderHook(
                ({ sensitive }) =>
                    useSettings(['apiKey'], {
                        includeSensitive: sensitive,
                    }),
                { initialProps: { sensitive: true } }
            );
            await waitUntilReady(result);
            expect(result.current.settings).toEqual({ apiKey: 'secret' });

            rerender({ sensitive: false });

            expect(result.current.loading).toBe(true);
            expect(result.current.settings).toEqual({});
            expect(result.current.error).toBeNull();
            await waitUntilReady(result);
            expect(result.current.settings).toEqual({
                apiKey: 'public-value',
            });
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenLastCalledWith(['apiKey'], { includeSensitive: false });
        });
    });

    describe('serialized optimistic writes', () => {
        test('serializes rapid writes and keeps only the newest pending value visible', async () => {
            configService.readMultipleResultStrict.mockResolvedValue({
                values: { model: 'initial' },
            });
            const firstWrite = createDeferred();
            const secondWrite = createDeferred();
            const writes = [];
            configService.set.mockImplementation((key, value) => {
                const deferred = writes.length === 0 ? firstWrite : secondWrite;
                writes.push({ key, value });
                return deferred.promise.then(() => `canonical-${value}`);
            });
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            let olderPromise;
            let newestPromise;
            await act(async () => {
                olderPromise = result.current.updateSetting('model', 'older');
                newestPromise = result.current.updateSetting('model', 'newest');
                await Promise.resolve();
            });

            expect(result.current.settings.model).toBe('newest');
            expect(writes).toEqual([{ key: 'model', value: 'older' }]);

            await act(async () => {
                firstWrite.resolve();
                await olderPromise;
            });
            await waitFor(() => expect(writes).toHaveLength(2));
            expect(result.current.settings.model).toBe('newest');

            await act(async () => {
                secondWrite.resolve();
                await newestPromise;
            });

            expect(writes).toEqual([
                { key: 'model', value: 'older' },
                { key: 'model', value: 'newest' },
            ]);
            expect(result.current.settings.model).toBe('canonical-newest');
        });

        test('rolls a failed single write back and confirms storage before rejecting', async () => {
            const writeError = new Error('storage unavailable');
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { language: 'fr' } })
                .mockResolvedValueOnce({ values: { language: 'fr' } });
            configService.set.mockRejectedValue(writeError);
            const { result } = renderHook(() => useSettings(['language']));
            await waitUntilReady(result);

            let updatePromise;
            act(() => {
                updatePromise = result.current.updateSetting('language', 'en');
            });
            expect(result.current.settings.language).toBe('en');

            await act(async () => {
                await expect(updatePromise).rejects.toBe(writeError);
            });

            expect(result.current.settings.language).toBe('fr');
            expect(result.current.error).toBe(writeError);
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenLastCalledWith(['language'], {
                includeSensitive: false,
            });
            expect(consoleError.mock.calls).toEqual([
                ['Settings update failed.'],
            ]);
        });

        test('does not let an older failure remove a newer pending value', async () => {
            const firstWrite = createDeferred();
            const secondWrite = createDeferred();
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { model: 'initial' } })
                .mockResolvedValue({ values: { model: 'initial' } });
            configService.set
                .mockImplementationOnce(() => firstWrite.promise)
                .mockImplementationOnce(async () => {
                    await secondWrite.promise;
                    return 'canonical-newest';
                });
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            const failure = new Error('first failed');
            let firstPromise;
            let secondPromise;
            act(() => {
                firstPromise = result.current.updateSetting('model', 'older');
                secondPromise = result.current.updateSetting('model', 'newest');
            });
            const firstRejection = expect(firstPromise).rejects.toBe(failure);
            expect(result.current.settings.model).toBe('newest');

            await act(async () => {
                firstWrite.reject(failure);
                await firstRejection;
            });
            expect(result.current.settings.model).toBe('newest');

            await act(async () => {
                secondWrite.resolve();
                await secondPromise;
            });
            expect(result.current.settings.model).toBe('canonical-newest');
            expect(result.current.error).toBeNull();
        });

        test('snapshots and promotes canonical batch values', async () => {
            configService.readMultipleResultStrict.mockResolvedValue({
                values: { first: 'a', second: 'b' },
            });
            const batchWrite = createDeferred();
            configService.setMultiple.mockImplementation(async (updates) => {
                await batchWrite.promise;
                return {
                    first: updates.first.toUpperCase(),
                    second: updates.second.toUpperCase(),
                };
            });
            const { result } = renderHook(() =>
                useSettings(['first', 'second'])
            );
            await waitUntilReady(result);

            const updates = { first: 'c', second: 'd' };
            let updatePromise;
            act(() => {
                updatePromise = result.current.updateSettings(updates);
            });
            updates.first = 'mutated';
            expect(result.current.settings).toEqual({
                first: 'c',
                second: 'd',
            });

            await act(async () => {
                batchWrite.resolve();
                await updatePromise;
            });

            expect(configService.setMultiple).toHaveBeenCalledWith({
                first: 'c',
                second: 'd',
            });
            expect(result.current.settings).toEqual({
                first: 'C',
                second: 'D',
            });
        });

        test('reconciles partial batch persistence and still rejects the public call', async () => {
            const partialFailure = Object.assign(
                new Error('one storage area failed'),
                {
                    partialFailure: true,
                    successful: [{ area: 'sync', keys: ['syncValue'] }],
                    failed: [{ area: 'local', keys: ['localValue'] }],
                }
            );
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({
                    values: { syncValue: 'old-sync', localValue: 'old-local' },
                })
                .mockResolvedValueOnce({
                    values: { syncValue: 'new-sync', localValue: 'old-local' },
                });
            configService.setMultiple.mockRejectedValue(partialFailure);
            const { result } = renderHook(() =>
                useSettings(['syncValue', 'localValue'])
            );
            await waitUntilReady(result);

            let updatePromise;
            act(() => {
                updatePromise = result.current.updateSettings({
                    syncValue: 'new-sync',
                    localValue: 'new-local',
                });
            });
            expect(result.current.settings).toEqual({
                syncValue: 'new-sync',
                localValue: 'new-local',
            });

            await act(async () => {
                await expect(updatePromise).rejects.toBe(partialFailure);
            });

            expect(result.current.settings).toEqual({
                syncValue: 'new-sync',
                localValue: 'old-local',
            });
            expect(result.current.error).toBe(partialFailure);
        });

        test('keeps the rollback snapshot and original error if failure readback also fails', async () => {
            const writeError = new Error('write-secret');
            const readError = new Error('read-secret');
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { model: 'initial' } })
                .mockRejectedValueOnce(readError);
            configService.set.mockRejectedValue(writeError);
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            await act(async () => {
                await expect(
                    result.current.updateSetting('model', 'optimistic')
                ).rejects.toBe(writeError);
            });

            expect(result.current.settings.model).toBe('initial');
            expect(result.current.error).toBe(writeError);
            expect(consoleError.mock.calls).toEqual([
                ['Settings update failed.'],
                ['Settings reconciliation failed.'],
            ]);
            expect(consoleError.mock.calls.flat()).not.toContain(
                writeError.message
            );
            expect(consoleError.mock.calls.flat()).not.toContain(
                readError.message
            );
        });

        test('does not block a later write on optional failure readback', async () => {
            const failedReadback = createDeferred();
            const firstError = new Error('first write failed');
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { model: 'initial' } })
                .mockImplementationOnce(() => failedReadback.promise);
            configService.set
                .mockRejectedValueOnce(firstError)
                .mockResolvedValueOnce('canonical-newest');
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            let firstPromise;
            let secondPromise;
            act(() => {
                firstPromise = result.current.updateSetting('model', 'older');
                secondPromise = result.current.updateSetting('model', 'newest');
            });

            await act(async () => {
                await expect(firstPromise).rejects.toBe(firstError);
                await secondPromise;
            });
            expect(configService.set).toHaveBeenCalledTimes(2);
            expect(result.current.settings.model).toBe('canonical-newest');

            await act(async () => {
                failedReadback.resolve({ values: { model: 'initial' } });
                await failedReadback.promise;
            });
            expect(result.current.settings.model).toBe('canonical-newest');
        });
    });

    describe('storage events and lifecycle', () => {
        test('uses a subscription event to strictly refresh only watched keys', async () => {
            const eventRead = createDeferred();
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { model: 'initial' } })
                .mockImplementationOnce(() => eventRead.promise);
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            act(() => {
                changeListeners[0]({ model: 'external', ignored: true });
            });
            expect(result.current.settings.model).toBe('initial');

            await act(async () => {
                eventRead.resolve({ values: { model: 'external' } });
                await eventRead.promise;
            });
            await waitFor(() => {
                expect(result.current.settings.model).toBe('external');
            });
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenLastCalledWith(['model'], { includeSensitive: false });
        });

        test('never renders a stale storage echo over a successful write', async () => {
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { model: 'initial' } })
                .mockResolvedValue({ values: { model: 'newest' } });
            configService.set.mockResolvedValue('newest');
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            await act(async () => {
                await result.current.updateSetting('model', 'newest');
            });
            expect(result.current.settings.model).toBe('newest');

            act(() => {
                changeListeners[0]({ model: 'initial' });
            });
            expect(result.current.settings.model).toBe('newest');
            await waitFor(() => {
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(2);
            });
            expect(result.current.settings.model).toBe('newest');
        });

        test('waits only for the overlapping write before checking its storage echo', async () => {
            const pendingWrite = createDeferred();
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { model: 'initial' } })
                .mockResolvedValueOnce({ values: { model: 'newest' } });
            configService.set.mockImplementation(async () => {
                await pendingWrite.promise;
                return 'newest';
            });
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            let updatePromise;
            act(() => {
                updatePromise = result.current.updateSetting('model', 'newest');
            });
            act(() => {
                changeListeners[0]({ model: 'initial' });
            });

            expect(result.current.settings.model).toBe('newest');
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(1);

            await act(async () => {
                pendingWrite.resolve();
                await updatePromise;
            });
            await waitFor(() => {
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(2);
            });
            expect(result.current.settings.model).toBe('newest');
        });

        test('keeps the confirmed value and publishes a fixed error when event readback fails', async () => {
            const storageError = new Error('private storage detail');
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { model: 'initial' } })
                .mockRejectedValueOnce(storageError)
                .mockResolvedValueOnce({ values: { model: 'recovered' } });
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            act(() => {
                changeListeners[0]({ model: 'uncertain' });
            });
            await waitFor(() => {
                expect(result.current.error?.message).toBe(
                    'Unable to confirm persisted settings after a storage update.'
                );
            });
            expect(result.current.settings.model).toBe('initial');
            expect(consoleError.mock.calls).toEqual([
                ['Settings reconciliation failed.'],
            ]);
            expect(consoleError.mock.calls.flat()).not.toContain(
                storageError.message
            );

            act(() => {
                changeListeners[0]({ model: 'recovered' });
            });
            await waitFor(() => {
                expect(result.current.settings.model).toBe('recovered');
                expect(result.current.error).toBeNull();
            });
        });

        test('does not let an older event proof clear a newer event failure', async () => {
            const olderRead = createDeferred();
            const newerFailure = new Error('newer read failed');
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { model: 'initial' } })
                .mockImplementationOnce(() => olderRead.promise)
                .mockRejectedValueOnce(newerFailure);
            const { result } = renderHook(() => useSettings(['model']));
            await waitUntilReady(result);

            act(() => {
                changeListeners[0]({ model: 'older-event' });
            });
            await waitFor(() => {
                expect(
                    configService.readMultipleResultStrict
                ).toHaveBeenCalledTimes(2);
            });

            act(() => {
                changeListeners[0]({ model: 'newer-event' });
            });
            await waitFor(() => {
                expect(result.current.error?.message).toBe(
                    'Unable to confirm persisted settings after a storage update.'
                );
            });

            await act(async () => {
                olderRead.resolve({ values: { model: 'older-event' } });
                await olderRead.promise;
            });

            expect(result.current.settings.model).toBe('initial');
            expect(result.current.error?.message).toBe(
                'Unable to confirm persisted settings after a storage update.'
            );
            expect(consoleError.mock.calls).toEqual([
                ['Settings reconciliation failed.'],
            ]);
        });

        test('does not clear key A uncertainty when a write proves only key B', async () => {
            const readFailure = new Error('A cannot be confirmed');
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { first: 'a', second: 'b' } })
                .mockRejectedValueOnce(readFailure);
            configService.set.mockResolvedValue('new-b');
            const { result } = renderHook(() =>
                useSettings(['first', 'second'])
            );
            await waitUntilReady(result);

            act(() => {
                changeListeners[0]({ first: 'uncertain-a' });
            });
            await waitFor(() => {
                expect(result.current.error).not.toBeNull();
            });

            await act(async () => {
                await result.current.updateSetting('second', 'new-b');
            });

            expect(result.current.settings).toEqual({
                first: 'a',
                second: 'new-b',
            });
            expect(result.current.error?.message).toBe(
                'Unable to confirm persisted settings after a storage update.'
            );
        });

        test('refreshes key B while an unrelated key A write is hung', async () => {
            const hungWrite = createDeferred();
            configService.readMultipleResultStrict
                .mockResolvedValueOnce({ values: { first: 'a', second: 'b' } })
                .mockResolvedValueOnce({ values: { second: 'external-b' } });
            configService.set.mockReturnValue(hungWrite.promise);
            const { result, unmount } = renderHook(() =>
                useSettings(['first', 'second'])
            );
            await waitUntilReady(result);

            act(() => {
                void result.current.updateSetting('first', 'pending-a');
            });
            act(() => {
                changeListeners[0]({ second: 'external-b' });
            });

            await waitFor(() => {
                expect(result.current.settings).toEqual({
                    first: 'pending-a',
                    second: 'external-b',
                });
            });
            expect(configService.set).toHaveBeenCalledTimes(1);
            expect(
                configService.readMultipleResultStrict
            ).toHaveBeenCalledTimes(2);
            unmount();
        });

        test('does not let initial loading overwrite a newer write', async () => {
            const initialLoad = createDeferred();
            configService.readMultipleResultStrict.mockReturnValue(
                initialLoad.promise
            );
            configService.set.mockResolvedValue('newest');
            const { result } = renderHook(() => useSettings(['model']));

            await act(async () => {
                await result.current.updateSetting('model', 'newest');
            });
            expect(result.current.settings.model).toBe('newest');

            await act(async () => {
                initialLoad.resolve({ values: { model: 'stale' } });
                await initialLoad.promise;
            });
            await waitUntilReady(result);
            expect(result.current.settings.model).toBe('newest');
        });

        test('does not let initial loading clear a newer write error', async () => {
            const initialLoad = createDeferred();
            const writeError = new Error('write failed');
            configService.readMultipleResultStrict
                .mockImplementationOnce(() => initialLoad.promise)
                .mockResolvedValueOnce({ values: { model: 'initial' } });
            configService.set.mockRejectedValue(writeError);
            const { result } = renderHook(() => useSettings(['model']));

            await act(async () => {
                await expect(
                    result.current.updateSetting('model', 'optimistic')
                ).rejects.toBe(writeError);
            });
            expect(result.current.error).toBe(writeError);

            await act(async () => {
                initialLoad.resolve({ values: { model: 'stale' } });
                await initialLoad.promise;
            });
            await waitUntilReady(result);

            expect(result.current.settings.model).toBe('initial');
            expect(result.current.error).toBe(writeError);
        });

        test('ignores an old subscription read after the projection changes', async () => {
            const oldEventRead = createDeferred();
            configService.readMultipleResultStrict.mockImplementation(
                async ([key]) => {
                    if (key === 'first') {
                        return { values: { first: 'first-value' } };
                    }
                    return { values: { second: 'second-value' } };
                }
            );
            const { result, rerender } = renderHook(
                ({ watched }) => useSettings([watched]),
                { initialProps: { watched: 'first' } }
            );
            await waitUntilReady(result);
            configService.readMultipleResultStrict.mockImplementationOnce(
                () => oldEventRead.promise
            );
            const oldListener = changeListeners[0];

            await act(async () => {
                oldListener({ first: 'external-first' });
                await Promise.resolve();
            });
            rerender({ watched: 'second' });
            await waitUntilReady(result);

            await act(async () => {
                oldEventRead.resolve({
                    values: { first: 'external-first' },
                });
                await oldEventRead.promise;
            });

            expect(result.current.settings).toEqual({
                second: 'second-value',
            });
        });

        test('unsubscribes, ignores pending reads, and still permits persistence after unmount', async () => {
            const initialLoad = createDeferred();
            configService.readMultipleResultStrict.mockReturnValue(
                initialLoad.promise
            );
            configService.set.mockResolvedValue('persisted');
            const { result, unmount } = renderHook(() =>
                useSettings(['model'])
            );
            const updateSetting = result.current.updateSetting;

            unmount();
            expect(unsubscribe).toHaveBeenCalledTimes(1);

            await expect(updateSetting('model', 'persisted')).resolves.toBe(
                true
            );
            expect(configService.set).toHaveBeenCalledWith(
                'model',
                'persisted'
            );

            initialLoad.resolve({ values: { model: 'late' } });
            await initialLoad.promise;
            expect(consoleError).not.toHaveBeenCalled();
        });

        test('marks the request unavailable when subscription setup fails', async () => {
            configService.readMultipleResultStrict.mockResolvedValue({
                values: { model: 'initial' },
            });
            configService.onChanged.mockImplementation(() => {
                throw new Error('listener registration failed');
            });
            const { result } = renderHook(() => useSettings(['model']));

            await waitFor(() => {
                expect(result.current.initialLoadStatus).toBe('unavailable');
            });

            expect(result.current.settings).toEqual({});
            expect(result.current.error?.message).toBe(
                'Unable to confirm persisted settings after a storage update.'
            );
            expect(consoleError.mock.calls).toEqual([
                ['Settings subscription failed.'],
            ]);
        });
    });
});
