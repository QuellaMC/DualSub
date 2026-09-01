import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';

import { SelectionPersistenceManager } from '../utils/selectionPersistence.js';

function createCore({ privateAnalysis = false } = {}) {
    return {
        config: {
            privateAnalysis,
            onSelectionRestored: jest.fn(),
        },
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
        restoreSelectionState: jest.fn(() => true),
    };
}

describe('SelectionPersistenceManager restoration lifecycle', () => {
    let manager;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    });

    afterEach(() => {
        manager?.stopMonitoring();
        manager = null;
        jest.useRealTimers();
    });

    test('private mode coalesces subtitle changes into one canonical reapply', () => {
        const core = createCore({ privateAnalysis: true });
        manager = new SelectionPersistenceManager(core);
        manager.startMonitoring();

        document.dispatchEvent(
            new CustomEvent('dualsub-subtitle-content-changing', {
                detail: { type: 'original' },
            })
        );
        document.dispatchEvent(
            new CustomEvent('dualsub-subtitle-content-changing', {
                detail: { type: 'original' },
            })
        );
        jest.advanceTimersByTime(150);

        expect(core.config.onSelectionRestored).toHaveBeenCalledTimes(1);
        expect(core.restoreSelectionState).not.toHaveBeenCalled();
    });

    test('stopping monitoring cancels pending restoration authority', () => {
        const core = createCore({ privateAnalysis: true });
        manager = new SelectionPersistenceManager(core);
        manager.startMonitoring();
        document.dispatchEvent(
            new CustomEvent('dualsub-subtitle-content-changing', {
                detail: { type: 'original' },
            })
        );

        manager.stopMonitoring();
        jest.advanceTimersByTime(150);

        expect(core.config.onSelectionRestored).not.toHaveBeenCalled();
    });
});
