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

    it('projects canonical values and defaults invalid or deleted settings', () => {
        const callback = jest.fn();
        configService.onChanged(callback);
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange(
            {
                targetLanguage: { newValue: 'EN-us' },
                openaiBaseUrl: {
                    newValue: 'https://API.OPENAI.COM:443/v1///',
                },
                aiContextTimeout: { newValue: 5000.5 },
                aiContextRetryDelay: { newValue: Number.POSITIVE_INFINITY },
                aiContextMandatoryDelay: {},
                debugMode: { newValue: true },
                unknownSetting: { newValue: true },
            },
            'sync'
        );

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({
            targetLanguage: 'en-US',
            openaiBaseUrl: 'https://api.openai.com/v1',
            aiContextTimeout: getDefaultValue('aiContextTimeout'),
            aiContextRetryDelay: getDefaultValue('aiContextRetryDelay'),
            aiContextMandatoryDelay: getDefaultValue('aiContextMandatoryDelay'),
        });
        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('detaches collection changes from storage records and between listeners', () => {
        const storedContextTypes = ['cultural'];
        let firstProjection;
        configService.onChanged((changes) => {
            firstProjection = changes;
            changes.aiContextTypes[0] = 'listener-mutation';
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

    it('updates logging directly from the projected value without storage I/O', () => {
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

    it('snapshots dispatch while isolating throws, unsubscribe, and additions', () => {
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
            throw new Error('listener failed');
        });
        configService.onChanged(throwingCallback);
        const stableCallback = jest.fn(() => calls.push('stable'));
        configService.onChanged(stableCallback);
        const emitStorageChange = installLiveChangeListener();

        expect(() =>
            emitStorageChange({ subtitlesEnabled: { newValue: false } }, 'sync')
        ).not.toThrow();
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
    });

    it('isolates an async listener rejection and continues later dispatches', async () => {
        let rejectNextCall = true;
        const asyncCallback = jest.fn(async () => {
            if (rejectNextCall) {
                rejectNextCall = false;
                throw new Error('async listener failed');
            }
        });
        const stableCallback = jest.fn();
        configService.onChanged(asyncCallback);
        configService.onChanged(stableCallback);
        const errorLog = jest.spyOn(configService.logger, 'error');
        const emitStorageChange = installLiveChangeListener();

        emitStorageChange({ subtitlesEnabled: { newValue: false } }, 'sync');
        await Promise.resolve();
        await Promise.resolve();

        expect(stableCallback).toHaveBeenCalledTimes(1);
        expect(errorLog).toHaveBeenCalledTimes(1);

        emitStorageChange({ subtitlesEnabled: { newValue: true } }, 'sync');
        await Promise.resolve();

        expect(asyncCallback).toHaveBeenCalledTimes(2);
        expect(stableCallback).toHaveBeenCalledTimes(2);
        expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('does not repair projected changes or trigger recursive storage events', () => {
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
