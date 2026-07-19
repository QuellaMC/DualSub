import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { SelectionPersistenceManager } from '../utils/selectionPersistence.js';

function createModalCore({
    onSelectionRestored = jest.fn(),
    restoreSelectionState = jest.fn(() => true),
} = {}) {
    return {
        config:
            onSelectionRestored === undefined ? {} : { onSelectionRestored },
        isAnalyzing: false,
        isVisible: true,
        selectedWords: new Set(),
        selectionPersistence: {
            isRestoring: false,
            lastManualSelectionTs: 0,
            lastRestoreAt: 0,
            lastSelectionState: { selectedWords: [] },
            pendingRestore: false,
            restorationTimeout: null,
        },
        restoreSelectionState,
    };
}

function startHarness(options) {
    const modalCore = createModalCore(options);
    const manager = new SelectionPersistenceManager(modalCore);
    manager.startMonitoring();
    return { manager, modalCore };
}

function scheduleEventRestoration(manager) {
    manager._scheduleRestorationDebounced('event');
    jest.advanceTimersByTime(150);
}

describe('SelectionPersistenceManager restoration ownership', () => {
    const activeManagers = [];

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
        document.body.innerHTML = '';
    });

    afterEach(() => {
        for (const manager of activeManagers.splice(0)) {
            manager.stopMonitoring();
        }
        jest.clearAllTimers();
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    function track(harness) {
        activeManagers.push(harness.manager);
        return harness;
    }

    test('does not duplicate the core-owned restoration notification', () => {
        const onSelectionRestored = jest.fn();
        const { manager, modalCore } = track(
            startHarness({ onSelectionRestored })
        );

        scheduleEventRestoration(manager);

        expect(modalCore.restoreSelectionState).toHaveBeenCalledTimes(1);
        expect(onSelectionRestored).not.toHaveBeenCalled();
    });

    test.each([false, undefined])(
        'does not notify when restoration returns %s',
        (restoreResult) => {
            const onSelectionRestored = jest.fn();
            const restoreSelectionState = jest.fn(() => restoreResult);
            const { manager } = track(
                startHarness({
                    onSelectionRestored,
                    restoreSelectionState,
                })
            );

            scheduleEventRestoration(manager);

            expect(restoreSelectionState).toHaveBeenCalledTimes(1);
            expect(onSelectionRestored).not.toHaveBeenCalled();
        }
    );

    test('contains a restoration throw and does not notify', () => {
        const failure = new Error('restore failed');
        const onSelectionRestored = jest.fn();
        const restoreSelectionState = jest.fn(() => {
            throw failure;
        });
        const { manager } = track(
            startHarness({ onSelectionRestored, restoreSelectionState })
        );

        expect(() => scheduleEventRestoration(manager)).not.toThrow();
        expect(restoreSelectionState).toHaveBeenCalledTimes(1);
        expect(onSelectionRestored).not.toHaveBeenCalled();
    });

    test('does not invoke a notification callback owned by modal core', () => {
        const onSelectionRestored = jest.fn(() => {
            throw new Error('notification failed');
        });
        const { manager, modalCore } = track(
            startHarness({ onSelectionRestored })
        );

        expect(() => scheduleEventRestoration(manager)).not.toThrow();
        expect(modalCore.restoreSelectionState).toHaveBeenCalledTimes(1);
        expect(onSelectionRestored).not.toHaveBeenCalled();
    });

    test('does not inspect or adopt the core notification return value', () => {
        const thenGetter = jest.fn(() => {
            throw new Error('then must not be read');
        });
        const returnedValue = {};
        Object.defineProperty(returnedValue, 'then', {
            configurable: true,
            get: thenGetter,
        });
        const onSelectionRestored = jest.fn(() => returnedValue);
        const { manager } = track(startHarness({ onSelectionRestored }));

        expect(() => scheduleEventRestoration(manager)).not.toThrow();
        expect(onSelectionRestored).not.toHaveBeenCalled();
        expect(thenGetter).not.toHaveBeenCalled();
    });

    test('stop before the timeout revokes restore and notification authority', () => {
        const onSelectionRestored = jest.fn();
        const { manager, modalCore } = track(
            startHarness({ onSelectionRestored })
        );

        manager._scheduleRestorationDebounced('event');
        manager.stopMonitoring();
        jest.advanceTimersByTime(150);

        expect(modalCore.restoreSelectionState).not.toHaveBeenCalled();
        expect(onSelectionRestored).not.toHaveBeenCalled();
        expect(modalCore.selectionPersistence.restorationTimeout).toBeNull();
    });

    test('stop and restart allows only the successor lifecycle to restore', () => {
        const onSelectionRestored = jest.fn();
        const { manager, modalCore } = track(
            startHarness({ onSelectionRestored })
        );

        manager._scheduleRestorationDebounced('event');
        manager.stopMonitoring();
        manager.startMonitoring();
        manager._scheduleRestorationDebounced('event');
        jest.advanceTimersByTime(150);

        expect(modalCore.restoreSelectionState).toHaveBeenCalledTimes(1);
        expect(onSelectionRestored).not.toHaveBeenCalled();
    });

    test('a successful restoration that replaces its lifecycle schedules only the successor restore', () => {
        const onSelectionRestored = jest.fn();
        let manager;
        const restoreSelectionState = jest
            .fn()
            .mockImplementationOnce(() => {
                manager.stopMonitoring();
                manager.startMonitoring();
                manager._scheduleRestorationDebounced('event');
                return true;
            })
            .mockReturnValueOnce(true);
        const harness = track(
            startHarness({ onSelectionRestored, restoreSelectionState })
        );
        manager = harness.manager;

        manager._scheduleRestorationDebounced('event');
        jest.advanceTimersByTime(150);
        expect(restoreSelectionState).toHaveBeenCalledTimes(1);
        expect(onSelectionRestored).not.toHaveBeenCalled();

        jest.advanceTimersByTime(150);
        expect(restoreSelectionState).toHaveBeenCalledTimes(2);
        expect(onSelectionRestored).not.toHaveBeenCalled();
    });

    test('rechecks lifecycle authority immediately before restoration', () => {
        const onSelectionRestored = jest.fn();
        const { manager, modalCore } = track(
            startHarness({ onSelectionRestored })
        );
        let didReenter = false;
        const savedState = { selectedWords: [] };
        Object.defineProperty(
            modalCore.selectionPersistence,
            'lastSelectionState',
            {
                configurable: true,
                get: () => {
                    if (!didReenter) {
                        didReenter = true;
                        manager.stopMonitoring();
                        manager.startMonitoring();
                    }
                    return savedState;
                },
            }
        );

        scheduleEventRestoration(manager);

        expect(didReenter).toBe(true);
        expect(modalCore.restoreSelectionState).not.toHaveBeenCalled();
        expect(onSelectionRestored).not.toHaveBeenCalled();
    });

    test('never reads the core-owned notification callback', () => {
        const onSelectionRestored = jest.fn();
        const { manager, modalCore } = track(startHarness());
        Object.defineProperty(modalCore.config, 'onSelectionRestored', {
            configurable: true,
            get: () => {
                manager.stopMonitoring();
                manager.startMonitoring();
                return onSelectionRestored;
            },
        });

        scheduleEventRestoration(manager);

        expect(modalCore.restoreSelectionState).toHaveBeenCalledTimes(1);
        expect(onSelectionRestored).not.toHaveBeenCalled();
    });

    test('successful restoration is unaffected when the callback is absent', () => {
        const { manager, modalCore } = track(
            startHarness({ onSelectionRestored: undefined })
        );

        expect(() => scheduleEventRestoration(manager)).not.toThrow();
        expect(modalCore.restoreSelectionState).toHaveBeenCalledTimes(1);
    });

    test('stop revokes an exact follow-up timeout installed by restoration', () => {
        const onSelectionRestored = jest.fn();
        let modalCore;
        const restoreSelectionState = jest
            .fn()
            .mockImplementationOnce(() => {
                const followUpTimeout = setTimeout(() => {
                    modalCore.selectionPersistence.restorationTimeout = null;
                    modalCore.restoreSelectionState();
                }, 100);
                modalCore.selectionPersistence.restorationTimeout =
                    followUpTimeout;
                return false;
            })
            .mockReturnValueOnce(true);
        const harness = track(
            startHarness({ onSelectionRestored, restoreSelectionState })
        );
        modalCore = harness.modalCore;

        scheduleEventRestoration(harness.manager);
        harness.manager.stopMonitoring();
        jest.advanceTimersByTime(100);

        expect(restoreSelectionState).toHaveBeenCalledTimes(1);
        expect(onSelectionRestored).not.toHaveBeenCalled();
        expect(modalCore.selectionPersistence.restorationTimeout).toBeNull();
    });

    test('stop clears its exact timeout without nulling a newer shared handle', () => {
        const { manager, modalCore } = track(startHarness());
        manager._scheduleRestorationDebounced('event');
        const ownedHandle = modalCore.selectionPersistence.restorationTimeout;
        const newerHandle = setTimeout(() => {}, 5000);
        modalCore.selectionPersistence.restorationTimeout = newerHandle;

        manager.stopMonitoring();
        jest.advanceTimersByTime(150);

        expect(ownedHandle).not.toBe(newerHandle);
        expect(modalCore.restoreSelectionState).not.toHaveBeenCalled();
        expect(modalCore.selectionPersistence.restorationTimeout).toBe(
            newerHandle
        );
    });
});
