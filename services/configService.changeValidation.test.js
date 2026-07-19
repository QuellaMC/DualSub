import { jest } from '@jest/globals';
import { getDefaultValue } from '../config/configSchema.js';
import { configService } from './configService.js';

describe('ConfigService live change projection', () => {
    beforeEach(() => {
        configService.changeListeners.clear();
        configService.changeListenerInitialized = false;
    });

    afterEach(() => {
        configService.changeListeners.clear();
        jest.restoreAllMocks();
    });

    function installLiveChangeListener() {
        configService.initializeChangeListener();
        return chrome.storage.onChanged.addListener.mock.calls.at(-1)[0];
    }

    it('projects bounded defaults for invalid, fractional, and deleted AI numeric settings', () => {
        const callback = jest.fn();
        configService.onChanged(callback);
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(
            {
                aiContextTimeout: { newValue: 5000.5 },
                aiContextRetryDelay: { newValue: Number.POSITIVE_INFINITY },
                aiContextMandatoryDelay: {},
            },
            'sync'
        );

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({
            aiContextTimeout: getDefaultValue('aiContextTimeout'),
            aiContextRetryDelay: getDefaultValue('aiContextRetryDelay'),
            aiContextMandatoryDelay: getDefaultValue('aiContextMandatoryDelay'),
        });
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('projects normalized language and provider URL values', () => {
        const callback = jest.fn();
        configService.onChanged(callback);
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(
            {
                targetLanguage: { newValue: 'EN-us' },
                openaiBaseUrl: {
                    newValue: 'https://API.OPENAI.COM:443/v1///',
                },
            },
            'sync'
        );

        expect(callback).toHaveBeenCalledWith({
            targetLanguage: 'en-US',
            openaiBaseUrl: 'https://api.openai.com/v1',
        });
    });

    it('detaches collection changes from storage records and between listeners', () => {
        const storedContextTypes = ['cultural'];
        let firstProjection;
        configService.onChanged((changes) => {
            firstProjection = changes;
            changes.aiContextTypes[0] = 'attacker-mutated';
        });
        const secondCallback = jest.fn();
        configService.onChanged(secondCallback);
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(
            { aiContextTypes: { newValue: storedContextTypes } },
            'sync'
        );

        expect(storedContextTypes).toEqual(['cultural']);
        expect(firstProjection.aiContextTypes).not.toBe(storedContextTypes);
        expect(secondCallback).toHaveBeenCalledWith({
            aiContextTypes: ['cultural'],
        });
        expect(secondCallback.mock.calls[0][0].aiContextTypes).not.toBe(
            firstProjection.aiContextTypes
        );
    });

    it('keeps sensitive raw values out of default listeners and logs', () => {
        const canary = 'sensitive-live-change-canary';
        const rawSensitiveValue = { nested: [canary] };
        const defaultCallback = jest.fn();
        const sensitiveCallback = jest.fn();
        configService.onChanged(defaultCallback);
        configService.onChanged(sensitiveCallback, { includeSensitive: true });
        const debugLog = jest.spyOn(configService.logger, 'debug');
        const errorLog = jest.spyOn(configService.logger, 'error');
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(
            {
                openaiApiKey: { newValue: rawSensitiveValue },
                debugMode: { newValue: true },
            },
            'local'
        );

        expect(defaultCallback).toHaveBeenCalledWith({ debugMode: true });
        expect(defaultCallback.mock.calls[0][0]).not.toHaveProperty(
            'openaiApiKey'
        );
        expect(sensitiveCallback).toHaveBeenCalledWith({
            openaiApiKey: getDefaultValue('openaiApiKey'),
            debugMode: true,
        });
        expect(JSON.stringify(defaultCallback.mock.calls)).not.toContain(
            canary
        );
        expect(JSON.stringify(debugLog.mock.calls)).not.toContain(canary);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(canary);
    });

    it('requires an exact own sensitive-listener opt-in without reading accessors', () => {
        const inheritedOptions = Object.create({ includeSensitive: true });
        let optionAccessorReads = 0;
        const accessorOptions = {};
        Object.defineProperty(accessorOptions, 'includeSensitive', {
            get() {
                optionAccessorReads += 1;
                return true;
            },
        });
        const inheritedCallback = jest.fn();
        const accessorCallback = jest.fn();
        const optedInCallback = jest.fn();
        configService.onChanged(inheritedCallback, inheritedOptions);
        configService.onChanged(accessorCallback, accessorOptions);
        configService.onChanged(optedInCallback, { includeSensitive: true });
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(
            {
                openaiApiKey: { newValue: 'explicit-secret' },
                debugMode: { newValue: false },
            },
            'local'
        );

        expect(inheritedCallback).toHaveBeenCalledWith({ debugMode: false });
        expect(accessorCallback).toHaveBeenCalledWith({ debugMode: false });
        expect(optedInCallback).toHaveBeenCalledWith({
            openaiApiKey: 'explicit-secret',
            debugMode: false,
        });
        expect(optionAccessorReads).toBe(0);
    });

    it('gives each listener a fresh collection default after deletion', () => {
        const expectedDefault = getDefaultValue('aiContextTypes');
        let firstProjection;
        configService.onChanged((changes) => {
            firstProjection = changes;
            changes.aiContextTypes.length = 0;
        });
        const secondCallback = jest.fn();
        configService.onChanged(secondCallback);
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange({ aiContextTypes: {} }, 'sync');

        expect(firstProjection.aiContextTypes).not.toBe(expectedDefault);
        expect(secondCallback).toHaveBeenCalledWith({
            aiContextTypes: expectedDefault,
        });
        expect(secondCallback.mock.calls[0][0].aiContextTypes).not.toBe(
            firstProjection.aiContextTypes
        );
    });

    it('ignores raw enumeration, prototype, getter, proxy-error, and cross-scope traps', () => {
        const secret = 'hostile-live-change-object-canary';
        let ownKeysReads = 0;
        let prototypeReads = 0;
        let rawValueReads = 0;
        let inheritedGetterReads = 0;
        let unknownGetterReads = 0;
        let wrongAreaDescriptorReads = 0;
        let wrongAreaGetterReads = 0;

        const inheritedChanges = {};
        Object.defineProperty(inheritedChanges, 'originalLanguage', {
            enumerable: true,
            get() {
                inheritedGetterReads += 1;
                throw new Error(secret);
            },
        });
        const target = Object.create(inheritedChanges);
        target.targetLanguage = { newValue: 'EN-us' };
        Object.defineProperty(target, 'unknownSetting', {
            enumerable: true,
            get() {
                unknownGetterReads += 1;
                throw new Error(secret);
            },
        });
        Object.defineProperty(target, 'debugMode', {
            enumerable: true,
            get() {
                wrongAreaGetterReads += 1;
                throw new Error(secret);
            },
        });
        const changes = new Proxy(target, {
            ownKeys() {
                ownKeysReads += 1;
                throw new Error(secret);
            },
            getPrototypeOf() {
                prototypeReads += 1;
                throw new Error(secret);
            },
            get() {
                rawValueReads += 1;
                throw new Error(secret);
            },
            getOwnPropertyDescriptor(object, key) {
                if (key === 'debugMode') {
                    wrongAreaDescriptorReads += 1;
                    throw new Error(secret);
                }
                if (key === 'uiLanguage') throw new Error(secret);
                return Reflect.getOwnPropertyDescriptor(object, key);
            },
        });
        const callback = jest.fn();
        configService.onChanged(callback);
        const debugLog = jest.spyOn(configService.logger, 'debug');
        const errorLog = jest.spyOn(configService.logger, 'error');
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(changes, 'sync');

        expect(callback).toHaveBeenCalledWith({ targetLanguage: 'en-US' });
        expect(ownKeysReads).toBe(0);
        expect(prototypeReads).toBe(0);
        expect(rawValueReads).toBe(0);
        expect(inheritedGetterReads).toBe(0);
        expect(unknownGetterReads).toBe(0);
        expect(wrongAreaDescriptorReads).toBe(0);
        expect(wrongAreaGetterReads).toBe(0);
        expect(JSON.stringify(debugLog.mock.calls)).not.toContain(secret);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('emits nothing for unknown, inherited, or wrong-area changes', () => {
        let inheritedGetterReads = 0;
        let unknownGetterReads = 0;
        let wrongAreaGetterReads = 0;
        const prototype = {};
        Object.defineProperty(prototype, 'targetLanguage', {
            enumerable: true,
            get() {
                inheritedGetterReads += 1;
                return { newValue: 'EN-us' };
            },
        });
        const changes = Object.create(prototype);
        Object.defineProperty(changes, 'unknownSetting', {
            enumerable: true,
            get() {
                unknownGetterReads += 1;
                return { newValue: 'unknown' };
            },
        });
        Object.defineProperty(changes, 'debugMode', {
            enumerable: true,
            get() {
                wrongAreaGetterReads += 1;
                return { newValue: true };
            },
        });
        const callback = jest.fn();
        configService.onChanged(callback);
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(changes, 'sync');

        expect(callback).not.toHaveBeenCalled();
        expect(inheritedGetterReads).toBe(0);
        expect(unknownGetterReads).toBe(0);
        expect(wrongAreaGetterReads).toBe(0);
    });

    it('uses fresh defaults without invoking record or newValue accessors', () => {
        const secret = 'hostile-live-change-record-canary';
        let recordAccessorReads = 0;
        let newValueAccessorReads = 0;
        let proxyValueReads = 0;
        const changes = {};
        Object.defineProperty(changes, 'aiContextRetryDelay', {
            enumerable: true,
            get() {
                recordAccessorReads += 1;
                throw new Error(secret);
            },
        });
        const accessorRecord = {};
        Object.defineProperty(accessorRecord, 'newValue', {
            enumerable: true,
            get() {
                newValueAccessorReads += 1;
                throw new Error(secret);
            },
        });
        changes.aiContextTimeout = accessorRecord;
        changes.aiContextMandatoryDelay = new Proxy(
            {},
            {
                getOwnPropertyDescriptor() {
                    throw new Error(secret);
                },
                get() {
                    proxyValueReads += 1;
                    throw new Error(secret);
                },
            }
        );
        const callback = jest.fn();
        configService.onChanged(callback);
        const errorLog = jest.spyOn(configService.logger, 'error');
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(changes, 'sync');

        expect(callback).toHaveBeenCalledWith({
            aiContextTimeout: getDefaultValue('aiContextTimeout'),
            aiContextMandatoryDelay: getDefaultValue('aiContextMandatoryDelay'),
            aiContextRetryDelay: getDefaultValue('aiContextRetryDelay'),
        });
        expect(recordAccessorReads).toBe(0);
        expect(newValueAccessorReads).toBe(0);
        expect(proxyValueReads).toBe(0);
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
    });

    it('updates logging directly from the canonical projected value exactly once', () => {
        const updateLevel = jest
            .spyOn(configService.logger, 'updateLevel')
            .mockResolvedValue();
        const callback = jest.fn();
        configService.onChanged(callback);
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange({ loggingLevel: { newValue: 3.5 } }, 'sync');

        expect(callback).toHaveBeenCalledWith({
            loggingLevel: getDefaultValue('loggingLevel'),
        });
        expect(updateLevel).toHaveBeenCalledTimes(1);
        expect(updateLevel).toHaveBeenCalledWith(
            getDefaultValue('loggingLevel')
        );
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('updates logging directly from the default when the setting is deleted', () => {
        const updateLevel = jest
            .spyOn(configService.logger, 'updateLevel')
            .mockResolvedValue();
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange({ loggingLevel: {} }, 'sync');

        expect(updateLevel).toHaveBeenCalledTimes(1);
        expect(updateLevel).toHaveBeenCalledWith(
            getDefaultValue('loggingLevel')
        );
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('rejects a non-callable listener without coercing it', () => {
        let coercionReads = 0;
        const callback = {};
        Object.defineProperty(callback, Symbol.toPrimitive, {
            get() {
                coercionReads += 1;
                throw new Error('listener-coercion-must-not-run');
            },
        });

        expect(() => configService.onChanged(callback)).toThrow(
            'ConfigService onChanged requires a callable callback'
        );
        expect(coercionReads).toBe(0);
        expect(configService.changeListeners.size).toBe(0);
    });

    it('snapshots dispatch while isolating throws, self-unsubscribe, and listener additions', () => {
        const callbackError = 'live-listener-error-must-not-leak';
        const calls = [];
        const lateCallback = jest.fn(() => calls.push('late'));
        let unsubscribeSelf;
        unsubscribeSelf = configService.onChanged(() => {
            calls.push('self');
            unsubscribeSelf();
            configService.onChanged(lateCallback);
        });
        const throwingCallback = jest.fn(() => {
            calls.push('throwing');
            throw new Error(callbackError);
        });
        configService.onChanged(throwingCallback);
        const stableCallback = jest.fn(() => calls.push('stable'));
        configService.onChanged(stableCallback);
        const errorLog = jest.spyOn(configService.logger, 'error');
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange({ subtitlesEnabled: { newValue: false } }, 'sync');

        expect(calls).toEqual(['self', 'throwing', 'stable']);
        expect(lateCallback).not.toHaveBeenCalled();

        emitStorageChange({ subtitlesEnabled: { newValue: true } }, 'sync');

        expect(calls).toEqual([
            'self',
            'throwing',
            'stable',
            'throwing',
            'stable',
            'late',
        ]);
        expect(throwingCallback).toHaveBeenCalledTimes(2);
        expect(stableCallback).toHaveBeenCalledTimes(2);
        expect(lateCallback).toHaveBeenCalledTimes(1);
        expect(errorLog).toHaveBeenCalledWith(
            'Error in change listener callback',
            null,
            expect.objectContaining({
                areaName: 'sync',
                changedKeys: ['subtitlesEnabled'],
                category: 'callback-error',
            })
        );
    });

    it('isolates an async rejection and keeps the listener for a later successful event', async () => {
        const rejectionCanary = 'async-listener-rejection-must-not-leak';
        let rejectNextCall = true;
        const asyncCallback = jest.fn(async () => {
            if (rejectNextCall) {
                rejectNextCall = false;
                throw new Error(rejectionCanary);
            }
        });
        const stableCallback = jest.fn();
        configService.onChanged(asyncCallback);
        configService.onChanged(stableCallback);
        const errorLog = jest.spyOn(configService.logger, 'error');
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange({ subtitlesEnabled: { newValue: false } }, 'sync');
        expect(stableCallback).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        await Promise.resolve();

        expect(errorLog).toHaveBeenCalledWith(
            'Error in change listener callback',
            null,
            expect.objectContaining({
                areaName: 'sync',
                changedKeys: ['subtitlesEnabled'],
                category: 'callback-error',
            })
        );

        emitStorageChange({ subtitlesEnabled: { newValue: true } }, 'sync');
        await Promise.resolve();

        expect(asyncCallback).toHaveBeenCalledTimes(2);
        expect(stableCallback).toHaveBeenCalledTimes(2);
        expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('guards a hostile then accessor returned by a listener', async () => {
        const thenCanary = 'listener-then-accessor-must-not-leak';
        let thenAccessorReads = 0;
        const hostileResult = {};
        Object.defineProperty(hostileResult, 'then', {
            get() {
                thenAccessorReads += 1;
                throw new Error(thenCanary);
            },
        });
        configService.onChanged(() => hostileResult);
        const stableCallback = jest.fn();
        configService.onChanged(stableCallback);
        const errorLog = jest.spyOn(configService.logger, 'error');
        const emitStorageChange = installLiveChangeListener();

        expect(() =>
            emitStorageChange({ subtitlesEnabled: { newValue: false } }, 'sync')
        ).not.toThrow();
        expect(stableCallback).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        await Promise.resolve();

        expect(thenAccessorReads).toBe(1);
        expect(errorLog).toHaveBeenCalledWith(
            'Error in change listener callback',
            null,
            expect.objectContaining({ category: 'callback-error' })
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(thenCanary);
    });

    it('logs synchronous and asynchronous logging updater failures safely', async () => {
        const failureCanary = 'logging-update-failure-must-not-leak';
        const updateLevel = jest
            .spyOn(configService.logger, 'updateLevel')
            .mockImplementationOnce(() => {
                throw new Error(failureCanary);
            })
            .mockRejectedValueOnce(new Error(failureCanary));
        const errorLog = jest.spyOn(configService.logger, 'error');
        const emitStorageChange = installLiveChangeListener();

        expect(() =>
            emitStorageChange({ loggingLevel: { newValue: 4 } }, 'sync')
        ).not.toThrow();
        expect(() =>
            emitStorageChange({ loggingLevel: { newValue: 2 } }, 'sync')
        ).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();

        expect(updateLevel).toHaveBeenNthCalledWith(1, 4);
        expect(updateLevel).toHaveBeenNthCalledWith(2, 2);
        expect(errorLog).toHaveBeenCalledTimes(2);
        expect(errorLog).toHaveBeenLastCalledWith(
            'Failed to update logging level after change',
            null,
            {
                areaName: 'sync',
                changedKey: 'loggingLevel',
                category: 'update-failed',
            }
        );
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
            failureCanary
        );
    });

    it('does not repair live changes or trigger recursive storage events', () => {
        const callback = jest.fn();
        configService.onChanged(callback);
        const emitStorageChange = installLiveChangeListener();
        chrome.storage.sync.set.mockImplementation((_values, done) => {
            emitStorageChange(
                { aiContextTimeout: { newValue: 30000 } },
                'sync'
            );
            done?.();
        });

        emitStorageChange({ aiContextTimeout: { newValue: -1 } }, 'sync');

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({
            aiContextTimeout: getDefaultValue('aiContextTimeout'),
        });
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
});
