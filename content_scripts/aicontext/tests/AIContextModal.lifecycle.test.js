import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { AIContextModalUI } from '../ui/modal-ui.js';
import { AIContextModal } from '../ui/modal.js';
import { AIContextModalEvents } from '../ui/modal-events.js';
import { ModalController } from '../ui/events/ModalController.js';

function createCore(configService) {
    return {
        contentScript: configService ? { configService } : null,
        contentElement: document.body,
        isVisible: true,
        _log: jest.fn(),
    };
}

function createTranslationResponse(messages = {}) {
    return {
        ok: true,
        json: jest.fn().mockResolvedValue(messages),
    };
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('AIContextModal lifecycle', () => {
    let originalFetch;
    let activeUis;

    beforeEach(() => {
        activeUis = [];
        originalFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue(createTranslationResponse());
    });

    afterEach(async () => {
        await Promise.all(activeUis.map((ui) => ui.destroy()));
        global.fetch = originalFetch;
        delete window.configService;
        document.body.innerHTML = '';
    });

    test('destroy owns the config language subscription and is canonical and idempotent', async () => {
        let onLanguageChanged;
        const unsubscribe = jest.fn();
        const configService = {
            get: jest.fn().mockResolvedValue('en'),
            onChanged: jest.fn((callback) => {
                onLanguageChanged = callback;
                return unsubscribe;
            }),
        };
        const ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        ui._refreshModalUI = jest.fn();

        await ui.initialize();
        const fetchCallsBeforeDestroy = global.fetch.mock.calls.length;

        const firstDestroy = ui.destroy();
        const secondDestroy = ui.destroy();

        expect(secondDestroy).toBe(firstDestroy);
        await firstDestroy;
        expect(unsubscribe).toHaveBeenCalledTimes(1);

        let terminalCoreReads = 0;
        ui.core = new Proxy(
            {},
            {
                get() {
                    terminalCoreReads += 1;
                    throw new Error('terminal config callback touched core');
                },
            }
        );
        await onLanguageChanged({ uiLanguage: 'fr' });
        expect(global.fetch).toHaveBeenCalledTimes(fetchCallsBeforeDestroy);
        expect(ui._refreshModalUI).not.toHaveBeenCalled();
        expect(terminalCoreReads).toBe(0);
        ui.core = null;
    });

    test('normal config initialization preserves method receivers and returned unsubscribe', async () => {
        let getReceiver;
        let onChangedReceiver;
        const unsubscribe = jest.fn();
        const configService = {
            get: jest.fn(function () {
                getReceiver = this;
                return Promise.resolve('en');
            }),
            onChanged: jest.fn(function () {
                onChangedReceiver = this;
                return unsubscribe;
            }),
        };
        const ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);

        await ui.initialize();

        expect(getReceiver).toBe(configService);
        expect(onChangedReceiver).toBe(configService);
        await ui.destroy();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    test('replacing the config language subscription revokes the old callback authority', async () => {
        let firstCallback;
        let secondCallback;
        const firstUnsubscribe = jest.fn();
        const secondUnsubscribe = jest.fn();
        const firstConfigService = {
            onChanged: jest.fn((callback) => {
                firstCallback = callback;
                return firstUnsubscribe;
            }),
        };
        const secondConfigService = {
            onChanged: jest.fn((callback) => {
                secondCallback = callback;
                return secondUnsubscribe;
            }),
        };
        const core = createCore(firstConfigService);
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        ui._loadTranslations = jest.fn().mockResolvedValue({});
        ui._refreshModalUI = jest.fn();

        ui._setupLanguageChangeListener();
        core.contentScript.configService = secondConfigService;
        ui._setupLanguageChangeListener();

        expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
        await firstCallback({ uiLanguage: 'fr' });
        expect(ui._loadTranslations).not.toHaveBeenCalled();

        await secondCallback({ uiLanguage: 'de' });
        expect(ui._loadTranslations).toHaveBeenCalledTimes(1);
        expect(ui._loadTranslations).toHaveBeenCalledWith(
            'de',
            expect.any(Function)
        );
        expect(ui._refreshModalUI).toHaveBeenCalledTimes(1);

        await ui.destroy();
        expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
        expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
    });

    test('newest config language load owns cache, language, and visible refresh', async () => {
        let onLanguageChanged;
        const configService = {
            onChanged: jest.fn((callback) => {
                onLanguageChanged = callback;
                return jest.fn();
            }),
        };
        const ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        ui._refreshModalUI = jest.fn();
        ui._setupLanguageChangeListener();
        const oldFetch = createDeferred();
        const newFetch = createDeferred();
        global.fetch = jest
            .fn()
            .mockReturnValueOnce(oldFetch.promise)
            .mockReturnValueOnce(newFetch.promise);

        const oldChange = onLanguageChanged({ uiLanguage: 'fr' });
        const newChange = onLanguageChanged({ uiLanguage: 'de' });
        const newResponse = createTranslationResponse({ title: 'new' });
        newFetch.resolve(newResponse);
        await newChange;

        expect(ui._currentLanguage).toBe('de');
        expect(ui._translationsCache).toEqual({ title: 'new' });
        expect(ui._refreshModalUI).toHaveBeenCalledTimes(1);

        const oldResponse = createTranslationResponse({ title: 'old' });
        oldFetch.resolve(oldResponse);
        await oldChange;

        expect(oldResponse.json).not.toHaveBeenCalled();
        expect(ui._currentLanguage).toBe('de');
        expect(ui._translationsCache).toEqual({ title: 'new' });
        expect(ui._refreshModalUI).toHaveBeenCalledTimes(1);
    });

    test('newest storage language load owns cache, language, and visible refresh', async () => {
        const ui = new AIContextModalUI(createCore(null));
        activeUis.push(ui);
        ui._refreshModalUI = jest.fn();
        ui._setupLanguageChangeListener();
        const onStorageChanged = ui._storageLanguageChangeListener;
        const oldFetch = createDeferred();
        const newFetch = createDeferred();
        global.fetch = jest
            .fn()
            .mockReturnValueOnce(oldFetch.promise)
            .mockReturnValueOnce(newFetch.promise);

        const oldChange = onStorageChanged(
            { uiLanguage: { newValue: 'fr' } },
            'sync'
        );
        const newChange = onStorageChanged(
            { uiLanguage: { newValue: 'de' } },
            'sync'
        );
        newFetch.resolve(createTranslationResponse({ title: 'new' }));
        await newChange;
        oldFetch.resolve(createTranslationResponse({ title: 'old' }));
        await oldChange;

        expect(ui._currentLanguage).toBe('de');
        expect(ui._translationsCache).toEqual({ title: 'new' });
        expect(ui._refreshModalUI).toHaveBeenCalledTimes(1);
    });

    test('manual reload supersedes an older initial language read', async () => {
        const initialLanguage = createDeferred();
        const configService = {
            get: jest.fn(() => initialLanguage.promise),
            onChanged: jest.fn(() => jest.fn()),
        };
        const ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        global.fetch = jest
            .fn()
            .mockResolvedValue(createTranslationResponse({ title: 'manual' }));

        const initialization = ui.initialize();
        await Promise.resolve();
        await ui.reloadTranslations('fr');
        initialLanguage.resolve('en');
        await initialization;

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(ui._currentLanguage).toBe('fr');
        expect(ui._translationsCache).toEqual({ title: 'manual' });
        expect(ui._languageInitialized).toBe(false);
    });

    test('superseded English fallback cannot replace a newer manual load', async () => {
        const ui = new AIContextModalUI(createCore(null));
        activeUis.push(ui);
        const oldFallback = createDeferred();
        const newFetch = createDeferred();
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({ ok: false })
            .mockReturnValueOnce(oldFallback.promise)
            .mockReturnValueOnce(newFetch.promise);

        const oldReload = ui.reloadTranslations('missing');
        await Promise.resolve();
        await Promise.resolve();
        expect(global.fetch).toHaveBeenCalledTimes(2);
        const newReload = ui.reloadTranslations('de');
        newFetch.resolve(createTranslationResponse({ title: 'new' }));
        await newReload;
        const oldFallbackResponse = createTranslationResponse({ title: 'old' });
        oldFallback.resolve(oldFallbackResponse);
        await oldReload;

        expect(oldFallbackResponse.json).not.toHaveBeenCalled();
        expect(ui._currentLanguage).toBe('de');
        expect(ui._translationsCache).toEqual({ title: 'new' });
    });

    test('reentrant config unsubscribe cannot leave duplicate language authorities', async () => {
        const callbacks = [];
        const currentUnsubscribe = jest.fn();
        let ui;
        let reentered = false;
        const firstUnsubscribe = jest.fn(() => {
            if (!reentered) {
                reentered = true;
                ui._setupLanguageChangeListener();
            }
        });
        const configService = {
            onChanged: jest.fn((callback) => {
                callbacks.push(callback);
                return callbacks.length === 1
                    ? firstUnsubscribe
                    : currentUnsubscribe;
            }),
        };
        ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        ui._loadTranslations = jest.fn().mockResolvedValue({});

        ui._setupLanguageChangeListener();
        ui._setupLanguageChangeListener();

        expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
        expect(configService.onChanged).toHaveBeenCalledTimes(2);
        await callbacks[0]({ uiLanguage: 'fr' });
        await callbacks[1]({ uiLanguage: 'de' });
        expect(ui._loadTranslations).toHaveBeenCalledTimes(1);

        await ui.destroy();
        expect(currentUnsubscribe).toHaveBeenCalledTimes(1);
    });

    test('reentrant config registration cleans only its superseded candidate', async () => {
        const callbacks = [];
        const outerUnsubscribe = jest.fn();
        const nestedUnsubscribe = jest.fn();
        let ui;
        let reentered = false;
        const configService = {
            onChanged: jest.fn((callback) => {
                callbacks.push(callback);
                if (!reentered) {
                    reentered = true;
                    ui._setupLanguageChangeListener();
                    return outerUnsubscribe;
                }
                return nestedUnsubscribe;
            }),
        };
        ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        ui._loadTranslations = jest.fn().mockResolvedValue({});

        ui._setupLanguageChangeListener();

        expect(configService.onChanged).toHaveBeenCalledTimes(2);
        expect(outerUnsubscribe).toHaveBeenCalledTimes(1);
        expect(nestedUnsubscribe).not.toHaveBeenCalled();
        await callbacks[0]({ uiLanguage: 'fr' });
        await callbacks[1]({ uiLanguage: 'de' });
        expect(ui._loadTranslations).toHaveBeenCalledTimes(1);

        await ui.destroy();
        expect(outerUnsubscribe).toHaveBeenCalledTimes(1);
        expect(nestedUnsubscribe).toHaveBeenCalledTimes(1);
    });

    test('reentrant storage registration preserves the newer listener handle', async () => {
        const callbacks = [];
        let ui;
        let reentered = false;
        chrome.storage.onChanged.addListener.mockImplementation((callback) => {
            callbacks.push(callback);
            if (!reentered) {
                reentered = true;
                ui._setupLanguageChangeListener();
            }
        });
        ui = new AIContextModalUI(createCore(null));
        activeUis.push(ui);
        ui._loadTranslations = jest.fn().mockResolvedValue({});

        ui._setupLanguageChangeListener();

        expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(2);
        expect(ui._storageLanguageChangeListener).toBe(callbacks[1]);
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(
            callbacks[0]
        );
        await callbacks[0]({ uiLanguage: { newValue: 'fr' } }, 'sync');
        await callbacks[1]({ uiLanguage: { newValue: 'de' } }, 'sync');
        expect(ui._loadTranslations).toHaveBeenCalledTimes(1);

        await ui.destroy();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(
            callbacks[1]
        );
    });

    test('UI destroy does not wait on its own canonical promise returned by unsubscribe', async () => {
        const ui = new AIContextModalUI(createCore(null));
        ui._configLanguageUnsubscribe = jest.fn(() => ui.destroy());

        const destruction = ui.destroy();
        let settled = false;
        destruction.then(() => {
            settled = true;
        });
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await Promise.resolve();
        }

        expect(settled).toBe(true);
        expect(ui.core).toBeNull();
    });

    test('listener replacement does not wait on destroy reentered by unsubscribe', async () => {
        const ui = new AIContextModalUI(createCore(null));
        ui._configLanguageUnsubscribe = jest.fn(() => ui.destroy());

        ui._setupLanguageChangeListener();
        const destruction = ui._destroyPromise;
        let settled = false;
        destruction.then(() => {
            settled = true;
        });
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await Promise.resolve();
        }

        expect(settled).toBe(true);
        expect(ui.core).toBeNull();
    });

    test('UI destroy joins async unsubscribe work that reenters during listener replacement', async () => {
        const cleanupWork = createDeferred();
        let destruction;
        const ui = new AIContextModalUI(createCore(null));
        ui._configLanguageUnsubscribe = jest.fn(() => {
            destruction = ui.destroy();
            return cleanupWork.promise;
        });

        ui._setupLanguageChangeListener();
        let settled = false;
        destruction.then(() => {
            settled = true;
        });
        try {
            for (let attempt = 0; attempt < 20; attempt += 1) {
                await Promise.resolve();
            }
            expect(settled).toBe(false);
            expect(ui.core).not.toBeNull();
        } finally {
            cleanupWork.resolve();
            await destruction;
        }

        expect(ui.core).toBeNull();
    });

    test('UI destroy joins a stale async candidate returned after registration reentrancy', async () => {
        const cleanupWork = createDeferred();
        let destruction;
        let ui;
        const configService = {
            onChanged: jest.fn(() => {
                destruction = ui.destroy();
                return () => cleanupWork.promise;
            }),
        };
        ui = new AIContextModalUI(createCore(configService));

        ui._setupLanguageChangeListener();
        let settled = false;
        destruction.then(() => {
            settled = true;
        });
        try {
            for (let attempt = 0; attempt < 20; attempt += 1) {
                await Promise.resolve();
            }
            expect(settled).toBe(false);
            expect(ui.core).not.toBeNull();
        } finally {
            cleanupWork.resolve();
            await destruction;
        }

        expect(ui.core).toBeNull();
    });

    test('UI destroy joins superseded async unsubscribe work already in flight', async () => {
        const cleanupWork = createDeferred();
        const firstUnsubscribe = jest.fn(() => cleanupWork.promise);
        const secondUnsubscribe = jest.fn();
        const firstConfigService = {
            onChanged: jest.fn(() => firstUnsubscribe),
        };
        const secondConfigService = {
            onChanged: jest.fn(() => secondUnsubscribe),
        };
        const core = createCore(firstConfigService);
        const ui = new AIContextModalUI(core);

        ui._setupLanguageChangeListener();
        core.contentScript.configService = secondConfigService;
        ui._setupLanguageChangeListener();
        const destruction = ui.destroy();
        let settled = false;
        destruction.then(() => {
            settled = true;
        });
        try {
            for (let attempt = 0; attempt < 20; attempt += 1) {
                await Promise.resolve();
            }
            expect(settled).toBe(false);
            expect(ui.core).not.toBeNull();
        } finally {
            cleanupWork.resolve();
            await destruction;
        }

        expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
        expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
        expect(ui.core).toBeNull();
    });

    test('config registration that throws after capture revokes the unowned callback authority', async () => {
        let capturedCallback;
        const configService = {
            onChanged: jest.fn((callback) => {
                capturedCallback = callback;
                throw new Error('synthetic partial config registration');
            }),
        };
        const ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        ui._loadTranslations = jest.fn().mockResolvedValue({});

        ui._setupLanguageChangeListener();
        await capturedCallback({ uiLanguage: 'fr' });

        expect(ui._loadTranslations).not.toHaveBeenCalled();
        expect(ui._configLanguageUnsubscribe).toBeNull();
    });

    test('storage registration that throws removes and revokes its exact candidate', async () => {
        let capturedCallback;
        const previousAddListenerImplementation =
            chrome.storage.onChanged.addListener.getMockImplementation();
        chrome.storage.onChanged.addListener.mockImplementation((callback) => {
            capturedCallback = callback;
            throw new Error('synthetic partial storage registration');
        });
        const ui = new AIContextModalUI(createCore(null));
        activeUis.push(ui);
        ui._loadTranslations = jest.fn().mockResolvedValue({});

        try {
            ui._setupLanguageChangeListener();
            await capturedCallback({ uiLanguage: { newValue: 'fr' } }, 'sync');

            expect(
                chrome.storage.onChanged.removeListener
            ).toHaveBeenCalledWith(capturedCallback);
            expect(ui._storageLanguageChangeListener).toBeNull();
            expect(ui._loadTranslations).not.toHaveBeenCalled();
        } finally {
            chrome.storage.onChanged.addListener.mockImplementation(
                previousAddListenerImplementation
            );
        }
    });

    test('registration reentrancy cannot log through core after terminal destroy', async () => {
        let ui;
        let terminalCoreLogs = 0;
        const configService = {
            onChanged: jest.fn(() => {
                ui.destroy();
                throw new Error('synthetic terminal registration failure');
            }),
        };
        const core = createCore(configService);
        core._log.mockImplementation(() => {
            if (ui?._destroyed) terminalCoreLogs += 1;
        });
        ui = new AIContextModalUI(core);

        ui._setupLanguageChangeListener();
        await ui.destroy();

        expect(terminalCoreLogs).toBe(0);
    });

    test('registration error metadata cannot destroy between the terminal guard and logging', async () => {
        let ui;
        let terminalCoreLogs = 0;
        const thrownValue = {};
        Object.defineProperty(thrownValue, 'message', {
            get() {
                ui.destroy();
                return 'synthetic getter-triggered destroy';
            },
        });
        const configService = {
            onChanged: jest.fn(() => {
                throw thrownValue;
            }),
        };
        const core = createCore(configService);
        core._log.mockImplementation(() => {
            if (ui?._destroyed) terminalCoreLogs += 1;
        });
        ui = new AIContextModalUI(core);

        ui._setupLanguageChangeListener();
        await ui.destroy();

        expect(terminalCoreLogs).toBe(0);
    });

    test('initialization error metadata cannot destroy between the terminal guard and logging', async () => {
        let ui;
        let terminalCoreLogs = 0;
        const thrownValue = {};
        Object.defineProperty(thrownValue, 'message', {
            get() {
                ui.destroy();
                return 'synthetic initialization getter-triggered destroy';
            },
        });
        const configService = {
            get: jest.fn(() => {
                throw thrownValue;
            }),
        };
        const core = createCore(configService);
        core._log.mockImplementation(() => {
            if (ui?._destroyed) terminalCoreLogs += 1;
        });
        ui = new AIContextModalUI(core);

        await ui._initializeLanguage();
        await ui.destroy();

        expect(terminalCoreLogs).toBe(0);
    });

    test('storage fallback replacement and destroy remove the exact listener identities', async () => {
        const ui = new AIContextModalUI(createCore(null));
        activeUis.push(ui);
        ui._loadTranslations = jest.fn().mockResolvedValue({});
        ui._refreshModalUI = jest.fn();

        ui._setupLanguageChangeListener();
        const firstListener =
            chrome.storage.onChanged.addListener.mock.calls.at(-1)[0];
        ui._setupLanguageChangeListener();
        const secondListener =
            chrome.storage.onChanged.addListener.mock.calls.at(-1)[0];

        expect(secondListener).not.toBe(firstListener);
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(
            firstListener
        );

        await firstListener({ uiLanguage: { newValue: 'fr' } }, 'sync');
        expect(ui._loadTranslations).not.toHaveBeenCalled();

        await secondListener({ uiLanguage: { newValue: 'de' } }, 'sync');
        expect(ui._loadTranslations).toHaveBeenCalledTimes(1);
        expect(ui._refreshModalUI).toHaveBeenCalledTimes(1);

        await ui.destroy();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(
            secondListener
        );
        let terminalCoreReads = 0;
        ui.core = new Proxy(
            {},
            {
                get() {
                    terminalCoreReads += 1;
                    throw new Error('terminal storage callback touched core');
                },
            }
        );
        await secondListener({ uiLanguage: { newValue: 'it' } }, 'sync');
        expect(ui._loadTranslations).toHaveBeenCalledTimes(1);
        expect(terminalCoreReads).toBe(0);
        ui.core = null;
    });

    test('storage fallback initialization retains fullscreen localization', async () => {
        chrome.storage.sync.get.mockResolvedValueOnce({ uiLanguage: 'es' });
        global.fetch = jest.fn().mockResolvedValue(
            createTranslationResponse({
                aiContextStartAnalysis: { message: 'Analizar ahora' },
            })
        );
        document.body.innerHTML =
            '<button id="dualsub-start-analysis">before</button>';
        const ui = new AIContextModalUI(createCore(null));
        activeUis.push(ui);

        await ui.initialize();
        const storageListener = ui._storageLanguageChangeListener;
        const fullscreenListener = ui._fullscreenChangeListener;
        document.dispatchEvent(new Event('fullscreenchange'));

        expect(ui._languageInitialized).toBe(true);
        expect(ui._currentLanguage).toBe('es');
        expect(storageListener).toEqual(expect.any(Function));
        expect(fullscreenListener).toEqual(expect.any(Function));
        expect(document.querySelector('button')).toHaveTextContent(
            'Analizar ahora'
        );

        await ui.destroy();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(
            storageListener
        );
    });

    test('destroy during the config read prevents every late initialization commit', async () => {
        const languageRead = createDeferred();
        const configService = {
            get: jest.fn().mockReturnValue(languageRead.promise),
            onChanged: jest.fn(() => jest.fn()),
        };
        const ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        const addDocumentListener = jest.spyOn(document, 'addEventListener');

        const initialization = ui.initialize();
        await Promise.resolve();
        await ui.destroy();
        languageRead.resolve('fr');
        await initialization;

        expect(ui._languageInitialized).toBe(false);
        expect(ui._currentLanguage).toBeNull();
        expect(configService.onChanged).not.toHaveBeenCalled();
        expect(addDocumentListener).not.toHaveBeenCalledWith(
            'fullscreenchange',
            expect.any(Function)
        );
    });

    test('destroy during translation loading prevents late cache and listener commits', async () => {
        const translationFetch = createDeferred();
        global.fetch = jest.fn().mockReturnValue(translationFetch.promise);
        const configService = {
            get: jest.fn().mockResolvedValue('en'),
            onChanged: jest.fn(() => jest.fn()),
        };
        const ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        const addDocumentListener = jest.spyOn(document, 'addEventListener');

        const initialization = ui.initialize();
        await Promise.resolve();
        await Promise.resolve();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(ui._currentLanguage).toBeNull();

        await ui.destroy();
        translationFetch.resolve(
            createTranslationResponse({ aiContextModalTitle: 'Late title' })
        );
        await initialization;

        expect(ui._languageInitialized).toBe(false);
        expect(ui._currentLanguage).toBeNull();
        expect(ui._translationsCache).toBeNull();
        expect(configService.onChanged).not.toHaveBeenCalled();
        expect(addDocumentListener).not.toHaveBeenCalledWith(
            'fullscreenchange',
            expect.any(Function)
        );
    });

    test('destroy while a language callback is loading prevents late language and DOM refresh', async () => {
        let onLanguageChanged;
        const callbackTranslationFetch = createDeferred();
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce(
                createTranslationResponse({ aiContextModalTitle: 'Initial' })
            )
            .mockReturnValueOnce(callbackTranslationFetch.promise);
        const configService = {
            get: jest.fn().mockResolvedValue('en'),
            onChanged: jest.fn((callback) => {
                onLanguageChanged = callback;
                return jest.fn();
            }),
        };
        const ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        ui._refreshModalUI = jest.fn();

        await ui.initialize();
        expect(ui._currentLanguage).toBe('en');
        expect(ui._translationsCache).toEqual({
            aiContextModalTitle: 'Initial',
        });

        const languageChange = onLanguageChanged({ uiLanguage: 'fr' });
        await Promise.resolve();
        expect(global.fetch).toHaveBeenCalledTimes(2);
        await ui.destroy();
        callbackTranslationFetch.resolve(
            createTranslationResponse({ aiContextModalTitle: 'Late' })
        );
        await languageChange;

        expect(ui._currentLanguage).toBeNull();
        expect(ui._translationsCache).toBeNull();
        expect(ui._refreshModalUI).not.toHaveBeenCalled();
    });

    test('UI destroy clears authority before hostile cleanup and removes fullscreen by identity', async () => {
        const hostileCleanupResult = {};
        Object.defineProperty(hostileCleanupResult, 'then', {
            get() {
                throw new Error('synthetic hostile then getter');
            },
        });
        let ui;
        let allHandlesWereClearedBeforeCleanup = false;
        const unsubscribe = jest.fn(() => {
            allHandlesWereClearedBeforeCleanup =
                ui._destroyed === true &&
                ui._configLanguageUnsubscribe === null &&
                ui._storageLanguageChangeListener === null &&
                ui._fullscreenChangeListener === null &&
                ui._onFullscreenChange === null;
            return hostileCleanupResult;
        });
        const configService = {
            get: jest.fn().mockResolvedValue('en'),
            onChanged: jest.fn(() => unsubscribe),
        };
        ui = new AIContextModalUI(createCore(configService));
        activeUis.push(ui);
        const removeDocumentListener = jest.spyOn(
            document,
            'removeEventListener'
        );

        await ui.initialize();
        const fullscreenListener = ui._fullscreenChangeListener;
        expect(fullscreenListener).toEqual(expect.any(Function));

        await expect(ui.destroy()).resolves.toBeUndefined();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(allHandlesWereClearedBeforeCleanup).toBe(true);
        expect(removeDocumentListener).toHaveBeenCalledWith(
            'fullscreenchange',
            fullscreenListener
        );
        expect(ui._fullscreenChangeListener).toBeNull();
        expect(ui._onFullscreenChange).toBeNull();

        let terminalCoreReads = 0;
        ui.core = new Proxy(
            {},
            {
                get() {
                    terminalCoreReads += 1;
                    throw new Error(
                        'terminal fullscreen callback touched core'
                    );
                },
            }
        );
        document.body.innerHTML =
            '<button id="dualsub-start-analysis">unchanged</button>';
        fullscreenListener();
        expect(document.querySelector('button')).toHaveTextContent('unchanged');
        expect(terminalCoreReads).toBe(0);
        ui.core = null;
    });

    test('UI destroy uses trusted promises, awaits async unsubscribe, and detaches retained state', async () => {
        const unsubscribeWork = createDeferred();
        const sensitiveFailure = 'sensitive-unsubscribe-marker';
        const unsubscribe = jest.fn(() => unsubscribeWork.promise);
        const configService = {
            get: jest.fn().mockResolvedValue('en'),
            onChanged: jest.fn(() => unsubscribe),
        };
        const core = createCore(configService);
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        await ui.initialize();

        const OriginalPromise = global.Promise;
        let destroyPromise;
        try {
            global.Promise = class PoisonedPromise {
                constructor() {
                    throw new Error('ambient Promise constructor used');
                }

                static resolve() {
                    throw new Error('ambient Promise.resolve used');
                }

                static allSettled() {
                    throw new Error('ambient Promise.allSettled used');
                }
            };

            destroyPromise = ui.destroy();
            let settled = false;
            destroyPromise.then(() => {
                settled = true;
            });
            await OriginalPromise.resolve();
            expect(settled).toBe(false);

            unsubscribeWork.reject(new Error(sensitiveFailure));
            await destroyPromise;
        } finally {
            global.Promise = OriginalPromise;
        }

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(ui.core).toBeNull();
        expect(ui._translationsCache).toBeNull();
        expect(ui._currentLanguage).toBeNull();
        expect(ui._languageInitialized).toBe(false);
        expect(JSON.stringify(core._log.mock.calls)).not.toContain(
            sensitiveFailure
        );
    });

    test('UI destroy isolates retry, storage, fullscreen, and config cleanup failures', async () => {
        const NativePromise = Promise;
        const core = createCore(null);
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        const terminalCleanup = jest.fn(() => {
            throw new Error('synthetic terminal cleanup failure');
        });
        const storageListener = jest.fn();
        const fullscreenListener = jest.fn();
        const configUnsubscribe = jest.fn(() =>
            NativePromise.reject(
                new Error('synthetic config unsubscribe failure')
            )
        );
        ui._terminalRetryActionCleanup = terminalCleanup;
        ui._storageLanguageChangeListener = storageListener;
        ui._fullscreenChangeListener = fullscreenListener;
        ui._onFullscreenChange = fullscreenListener;
        ui._configLanguageUnsubscribe = configUnsubscribe;
        const removeStorageListener = jest
            .spyOn(chrome.storage.onChanged, 'removeListener')
            .mockImplementation(() => {
                throw new Error('synthetic storage cleanup failure');
            });
        const removeDocumentListener = jest
            .spyOn(document, 'removeEventListener')
            .mockImplementation(() =>
                NativePromise.reject(
                    new Error('synthetic fullscreen cleanup failure')
                )
            );

        await expect(ui.destroy()).resolves.toBeUndefined();

        expect(terminalCleanup).toHaveBeenCalledTimes(1);
        expect(removeStorageListener).toHaveBeenCalledWith(storageListener);
        expect(removeDocumentListener).toHaveBeenCalledWith(
            'fullscreenchange',
            fullscreenListener
        );
        expect(configUnsubscribe).toHaveBeenCalledTimes(1);
        expect(ui.core).toBeNull();
    });

    test('UI destroy clears terminal actions and saved retry handlers become inert', async () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            ...createCore(null),
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        const onRetry = jest.fn();
        const onClose = jest.fn();
        const savedHandlers = [];
        const nativeAddEventListener =
            HTMLButtonElement.prototype.addEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'addEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (eventName === 'click') savedHandlers.push(handler);
            return nativeAddEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });

        ui.showTerminalRetryFailure({
            message: 'failed',
            error: 'invalid response',
            onRetry,
            onClose,
        });
        const stateCallsBeforeDestroy = core.setState.mock.calls.length;
        expect(savedHandlers).toHaveLength(2);

        await ui.destroy();
        for (const handler of savedHandlers) handler();
        for (const button of document.querySelectorAll('button')) {
            button.click();
        }

        expect(onRetry).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(core.setState).toHaveBeenCalledTimes(stateCallsBeforeDestroy);
        expect(ui._terminalRetryActionCleanup).toBeNull();
        expect(ui.core).toBeNull();
    });

    test.each([1, 2])(
        'terminal retry registration %s reentrancy cannot publish terminal UI',
        async (destroyingRegistration) => {
            document.body.innerHTML =
                '<div id="dualsub-analysis-results"></div>';
            const core = {
                ...createCore(null),
                setState: jest.fn(),
            };
            const ui = new AIContextModalUI(core);
            const onRetry = jest.fn();
            const onClose = jest.fn();
            let destruction;
            let clickRegistrationCount = 0;
            const registeredHandlers = new Set();
            const removedAfterRegistration = new Set();
            const savedHandlers = [];
            const nativeAddEventListener =
                HTMLButtonElement.prototype.addEventListener;
            const nativeRemoveEventListener =
                HTMLButtonElement.prototype.removeEventListener;
            jest.spyOn(
                HTMLButtonElement.prototype,
                'addEventListener'
            ).mockImplementation(function (eventName, handler, options) {
                if (eventName === 'click') {
                    clickRegistrationCount += 1;
                    savedHandlers.push(handler);
                    if (
                        clickRegistrationCount === destroyingRegistration &&
                        !destruction
                    ) {
                        destruction = ui.destroy();
                    }
                }
                const result = nativeAddEventListener.call(
                    this,
                    eventName,
                    handler,
                    options
                );
                if (eventName === 'click') registeredHandlers.add(handler);
                return result;
            });
            jest.spyOn(
                HTMLButtonElement.prototype,
                'removeEventListener'
            ).mockImplementation(function (eventName, handler, options) {
                if (eventName === 'click' && registeredHandlers.has(handler)) {
                    removedAfterRegistration.add(handler);
                }
                return nativeRemoveEventListener.call(
                    this,
                    eventName,
                    handler,
                    options
                );
            });

            ui.showTerminalRetryFailure({
                message: 'failed',
                error: 'invalid response',
                onRetry,
                onClose,
            });
            await destruction;
            for (const handler of savedHandlers) handler();

            expect(removedAfterRegistration).toEqual(registeredHandlers);
            expect(document.querySelector('.dualsub-error')).toBeNull();
            expect(core.setState).not.toHaveBeenCalled();
            expect(onRetry).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
            expect(ui.core).toBeNull();
        }
    );

    test.each([
        ['retry', 0],
        ['close', 1],
    ])(
        'a replaced terminal %s handler cannot clear or invoke across the newer action authority',
        (actionName, savedHandlerIndex) => {
            document.body.innerHTML =
                '<div id="dualsub-analysis-results"></div>';
            const core = {
                ...createCore(null),
                setState: jest.fn(),
            };
            const ui = new AIContextModalUI(core);
            activeUis.push(ui);
            const oldOnRetry = jest.fn();
            const oldOnClose = jest.fn();
            const newOnRetry = jest.fn();
            const newOnClose = jest.fn();
            const savedHandlers = [];
            const nativeAddEventListener =
                HTMLButtonElement.prototype.addEventListener;
            jest.spyOn(
                HTMLButtonElement.prototype,
                'addEventListener'
            ).mockImplementation(function (eventName, handler, options) {
                if (eventName === 'click') savedHandlers.push(handler);
                return nativeAddEventListener.call(
                    this,
                    eventName,
                    handler,
                    options
                );
            });

            ui.showTerminalRetryFailure({
                message: 'old failure',
                onRetry: oldOnRetry,
                onClose: oldOnClose,
            });
            ui.showTerminalRetryFailure({
                message: 'new failure',
                onRetry: newOnRetry,
                onClose: newOnClose,
            });
            const newerCleanup = ui._terminalRetryActionCleanup;

            savedHandlers[savedHandlerIndex]();

            expect(oldOnRetry).not.toHaveBeenCalled();
            expect(oldOnClose).not.toHaveBeenCalled();
            expect(ui._terminalRetryActionCleanup).toBe(newerCleanup);
            const currentButton = document.querySelector(
                actionName === 'retry'
                    ? '.dualsub-btn-primary'
                    : '.dualsub-btn-secondary'
            );
            currentButton.click();
            expect(
                actionName === 'retry' ? newOnRetry : newOnClose
            ).toHaveBeenCalledTimes(1);
        }
    );

    test('terminal action cleanup reentrancy cannot invoke a user callback after destroy', async () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            ...createCore(null),
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        const onRetry = jest.fn();
        const onClose = jest.fn();
        ui.showTerminalRetryFailure({
            message: 'failed',
            onRetry,
            onClose,
        });
        const retryButton = document.querySelector('.dualsub-btn-primary');
        let destruction;
        const nativeRemoveEventListener =
            HTMLButtonElement.prototype.removeEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'removeEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (eventName === 'click' && !destruction) {
                destruction = ui.destroy();
            }
            return nativeRemoveEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });

        retryButton.click();
        await destruction;

        expect(onRetry).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(ui.core).toBeNull();
    });

    test('terminal action cleanup attempts both exact removals when the first throws', async () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            ...createCore(null),
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        const onClose = jest.fn();
        ui.showTerminalRetryFailure({
            message: 'failed',
            onRetry: jest.fn(),
            onClose,
        });
        const retryButton = document.querySelector('.dualsub-btn-primary');
        const closeButton = document.querySelector('.dualsub-btn-secondary');
        let closeRemovalAttempts = 0;
        const nativeRemoveEventListener =
            HTMLButtonElement.prototype.removeEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'removeEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (eventName === 'click' && this === retryButton) {
                throw new Error('synthetic retry removal failure');
            }
            if (eventName === 'click' && this === closeButton) {
                closeRemovalAttempts += 1;
            }
            return nativeRemoveEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });

        await expect(ui.clearTerminalRetryActions()).resolves.toBeDefined();
        closeButton.click();

        expect(closeRemovalAttempts).toBe(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(ui._terminalRetryActionCleanup).toBeNull();
    });

    test('terminal action setup cleanup reentrancy preserves the newer render and callbacks', () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            ...createCore(null),
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        const innerOnRetry = jest.fn();
        const outerOnRetry = jest.fn();
        let staleDetailReads = 0;
        const outerDetails = {
            get message() {
                staleDetailReads += 1;
                return 'outer stale failure';
            },
            onRetry: outerOnRetry,
        };
        ui.showTerminalRetryFailure({
            message: 'initial failure',
            onRetry: jest.fn(),
        });
        const initialRetryButton = document.querySelector(
            '.dualsub-btn-primary'
        );
        let reentered = false;
        const nativeRemoveEventListener =
            HTMLButtonElement.prototype.removeEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'removeEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (
                eventName === 'click' &&
                this === initialRetryButton &&
                !reentered
            ) {
                reentered = true;
                ui.showTerminalRetryFailure({
                    message: 'inner newer failure',
                    onRetry: innerOnRetry,
                });
            }
            return nativeRemoveEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });

        ui.showTerminalRetryFailure(outerDetails);

        expect(staleDetailReads).toBe(0);
        expect(document.querySelector('.dualsub-error p').textContent).toBe(
            'inner newer failure'
        );
        document.querySelector('.dualsub-btn-primary').click();
        expect(innerOnRetry).toHaveBeenCalledTimes(1);
        expect(outerOnRetry).not.toHaveBeenCalled();
    });

    test('UI destroy revokes the standard error close action', async () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            ...createCore(null),
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        const closeRequest = jest.fn();
        document.addEventListener(
            'aicontext:modal:closeRequested',
            closeRequest
        );
        try {
            ui.showErrorState('failed');
            const closeButton = document.querySelector('.dualsub-error button');
            expect(closeButton).not.toBeNull();

            await ui.destroy();
            closeButton.click();

            expect(closeRequest).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener(
                'aicontext:modal:closeRequested',
                closeRequest
            );
        }
    });

    test('a replaced standard error close handler cannot act across the newer authority', () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            ...createCore(null),
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        const savedCloseHandlers = [];
        const nativeAddEventListener =
            HTMLButtonElement.prototype.addEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'addEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (eventName === 'click') savedCloseHandlers.push(handler);
            return nativeAddEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });
        const closeRequest = jest.fn();
        document.addEventListener(
            'aicontext:modal:closeRequested',
            closeRequest
        );

        try {
            ui.showErrorState('old failure');
            ui.showErrorState('new failure');
            const newerCleanup = ui._terminalRetryActionCleanup;
            expect(savedCloseHandlers).toHaveLength(2);

            savedCloseHandlers[0]();
            expect(closeRequest).not.toHaveBeenCalled();
            expect(ui._terminalRetryActionCleanup).toBe(newerCleanup);

            savedCloseHandlers[1]();
            expect(closeRequest).toHaveBeenCalledTimes(1);
            expect(ui._terminalRetryActionCleanup).toBeNull();
        } finally {
            document.removeEventListener(
                'aicontext:modal:closeRequested',
                closeRequest
            );
        }
    });

    test('a failed standard error registration revokes its saved close handler authority', () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            ...createCore(null),
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        let savedCloseHandler;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'addEventListener'
        ).mockImplementation(function (eventName, handler) {
            if (eventName === 'click') savedCloseHandler = handler;
            throw new Error('synthetic standard close registration failure');
        });
        const closeRequest = jest.fn();
        document.addEventListener(
            'aicontext:modal:closeRequested',
            closeRequest
        );

        try {
            ui.showErrorState('failed');
            savedCloseHandler();

            expect(closeRequest).not.toHaveBeenCalled();
            expect(core.setState).not.toHaveBeenCalled();
            expect(ui._terminalRetryActionCleanup).toBeNull();
        } finally {
            document.removeEventListener(
                'aicontext:modal:closeRequested',
                closeRequest
            );
        }
    });

    test.each([
        ['standard close', 'standard'],
        ['terminal retry', 'retry'],
        ['terminal close', 'close'],
    ])(
        '%s registration cannot invoke its callback before action publication',
        (_label, actionKind) => {
            document.body.innerHTML =
                '<div id="dualsub-analysis-results"></div>';
            const core = {
                ...createCore(null),
                setState: jest.fn(),
            };
            const ui = new AIContextModalUI(core);
            activeUis.push(ui);
            const onRetry = jest.fn();
            const onClose = jest.fn();
            const closeRequest = jest.fn();
            document.addEventListener(
                'aicontext:modal:closeRequested',
                closeRequest
            );
            const nativeAddEventListener =
                HTMLButtonElement.prototype.addEventListener;
            jest.spyOn(
                HTMLButtonElement.prototype,
                'addEventListener'
            ).mockImplementation(function (eventName, handler, options) {
                const shouldInvoke =
                    eventName === 'click' &&
                    (actionKind === 'standard' ||
                        (actionKind === 'retry' &&
                            this.classList.contains('dualsub-btn-primary')) ||
                        (actionKind === 'close' &&
                            this.classList.contains('dualsub-btn-secondary')));
                if (shouldInvoke) handler();
                return nativeAddEventListener.call(
                    this,
                    eventName,
                    handler,
                    options
                );
            });

            try {
                if (actionKind === 'standard') {
                    ui.showErrorState('failed');
                } else {
                    ui.showTerminalRetryFailure({
                        message: 'failed',
                        onRetry,
                        onClose,
                    });
                }

                expect(onRetry).not.toHaveBeenCalled();
                expect(onClose).not.toHaveBeenCalled();
                expect(closeRequest).not.toHaveBeenCalled();
                expect(core.setState).toHaveBeenCalledTimes(1);
                expect(document.querySelector('.dualsub-error')).not.toBeNull();
                expect(ui._terminalRetryActionCleanup).toEqual(
                    expect.any(Function)
                );

                const currentButton = document.querySelector(
                    actionKind === 'retry'
                        ? '.dualsub-btn-primary'
                        : '.dualsub-btn-secondary'
                );
                currentButton.click();
                expect(onRetry).toHaveBeenCalledTimes(
                    actionKind === 'retry' ? 1 : 0
                );
                expect(onClose).toHaveBeenCalledTimes(
                    actionKind === 'close' ? 1 : 0
                );
                expect(closeRequest).toHaveBeenCalledTimes(
                    actionKind === 'standard' ? 1 : 0
                );
            } finally {
                document.removeEventListener(
                    'aicontext:modal:closeRequested',
                    closeRequest
                );
            }
        }
    );

    test('error action registration reentrancy cannot publish terminal DOM or state', async () => {
        document.body.innerHTML = '<div id="dualsub-analysis-results"></div>';
        const core = {
            ...createCore(null),
            setState: jest.fn(),
        };
        const ui = new AIContextModalUI(core);
        let destruction;
        let registrationCompleted = false;
        let removalsAfterRegistration = 0;
        const nativeAddEventListener =
            HTMLButtonElement.prototype.addEventListener;
        const nativeRemoveEventListener =
            HTMLButtonElement.prototype.removeEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'addEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (eventName === 'click' && !destruction) {
                destruction = ui.destroy();
            }
            const result = nativeAddEventListener.call(
                this,
                eventName,
                handler,
                options
            );
            registrationCompleted = true;
            return result;
        });
        jest.spyOn(
            HTMLButtonElement.prototype,
            'removeEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (registrationCompleted && eventName === 'click') {
                removalsAfterRegistration += 1;
            }
            return nativeRemoveEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });

        ui.showErrorState('failed');
        await destruction;

        expect(removalsAfterRegistration).toBe(1);
        expect(document.querySelector('.dualsub-error')).toBeNull();
        expect(core.setState).not.toHaveBeenCalled();
        expect(ui.core).toBeNull();
    });

    test('UI destroy revokes deferred style movement before DOMContentLoaded', async () => {
        const originalHead = document.head;
        originalHead.remove();
        const core = createCore(null);
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: jest.fn().mockResolvedValue('body { color: red; }'),
        });
        const addDocumentListener = jest.spyOn(document, 'addEventListener');
        const removeDocumentListener = jest.spyOn(
            document,
            'removeEventListener'
        );
        let replacementHead;
        try {
            await ui._injectModalStyles();
            const registration = addDocumentListener.mock.calls
                .filter(([eventName]) => eventName === 'DOMContentLoaded')
                .at(-1);
            expect(registration).toBeDefined();
            const deferredHandler = registration[1];
            const style = document.getElementById('dualsub-modal-styles');

            await ui.destroy();
            const removedByDestroy = removeDocumentListener.mock.calls.some(
                ([eventName, handler]) =>
                    eventName === 'DOMContentLoaded' &&
                    handler === deferredHandler
            );
            replacementHead = document.createElement('head');
            document.documentElement.insertBefore(
                replacementHead,
                document.body
            );
            deferredHandler();

            expect({
                removedByDestroy,
                movedAfterDestroy: style.parentElement === replacementHead,
            }).toEqual({
                removedByDestroy: true,
                movedAfterDestroy: false,
            });
        } finally {
            document.getElementById('dualsub-modal-styles')?.remove();
            replacementHead?.remove();
            if (!originalHead.isConnected) {
                document.documentElement.insertBefore(
                    originalHead,
                    document.body
                );
            }
        }
    });

    test('style registration reentrancy cannot commit CSS state or terminal logging', async () => {
        const originalHead = document.head;
        originalHead.remove();
        let ui;
        let destruction;
        let terminalCoreLogs = 0;
        const core = createCore(null);
        core._log.mockImplementation(() => {
            if (ui?._destroyed) terminalCoreLogs += 1;
        });
        ui = new AIContextModalUI(core);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: jest.fn().mockResolvedValue(''),
        });
        const nativeAddEventListener = document.addEventListener;
        jest.spyOn(document, 'addEventListener').mockImplementation(
            function (eventName, handler, options) {
                if (eventName === 'DOMContentLoaded' && !destruction) {
                    destruction = ui.destroy();
                }
                return nativeAddEventListener.call(
                    this,
                    eventName,
                    handler,
                    options
                );
            }
        );
        try {
            await ui._injectModalStyles();
            await destruction;

            expect(ui.cssInjected).toBe(false);
            expect(terminalCoreLogs).toBe(0);
            expect(ui.core).toBeNull();
        } finally {
            document.getElementById('dualsub-modal-styles')?.remove();
            if (!originalHead.isConnected) {
                document.documentElement.insertBefore(
                    originalHead,
                    document.body
                );
            }
        }
    });

    test('UI destroy revokes deferred modal movement before DOMContentLoaded', async () => {
        const originalBody = document.body;
        const core = {
            ...createCore(null),
            markUiReady: jest.fn(),
            store: null,
        };
        const ui = new AIContextModalUI(core);
        activeUis.push(ui);
        ui._languageInitialized = true;
        ui._injectModalStyles = jest.fn().mockResolvedValue(undefined);
        ui._createModalHeader = jest.fn(() => document.createElement('div'));
        ui._createModalBody = jest.fn(() => document.createElement('div'));
        const addDocumentListener = jest.spyOn(document, 'addEventListener');
        const removeDocumentListener = jest.spyOn(
            document,
            'removeEventListener'
        );
        let replacementBody;
        originalBody.remove();
        try {
            await ui.createModalElement();
            const registration = addDocumentListener.mock.calls
                .filter(([eventName]) => eventName === 'DOMContentLoaded')
                .at(-1);
            expect(registration).toBeDefined();
            const deferredHandler = registration[1];
            const modalElement = core.element;

            await ui.destroy();
            const removedByDestroy = removeDocumentListener.mock.calls.some(
                ([eventName, handler]) =>
                    eventName === 'DOMContentLoaded' &&
                    handler === deferredHandler
            );
            replacementBody = document.createElement('body');
            document.documentElement.appendChild(replacementBody);
            deferredHandler();

            expect({
                removedByDestroy,
                movedAfterDestroy:
                    modalElement.parentElement === replacementBody,
            }).toEqual({
                removedByDestroy: true,
                movedAfterDestroy: false,
            });
        } finally {
            replacementBody?.remove();
            document.getElementById('dualsub-ui-root')?.remove();
            for (const body of document.querySelectorAll('body')) {
                if (body !== originalBody) body.remove();
            }
            if (!originalBody.isConnected) {
                document.documentElement.appendChild(originalBody);
            }
        }
    });

    test('modal registration reentrancy cannot publish terminal core references', async () => {
        const originalBody = document.body;
        let ui;
        let destruction;
        let terminalCoreLogs = 0;
        const core = {
            ...createCore(null),
            markUiReady: jest.fn(),
            store: null,
        };
        core._log.mockImplementation(() => {
            if (ui?._destroyed) terminalCoreLogs += 1;
        });
        ui = new AIContextModalUI(core);
        ui._languageInitialized = true;
        ui._injectModalStyles = jest.fn().mockResolvedValue(undefined);
        ui._createModalHeader = jest.fn(() => document.createElement('div'));
        ui._createModalBody = jest.fn(() => document.createElement('div'));
        const nativeAddEventListener = document.addEventListener;
        jest.spyOn(document, 'addEventListener').mockImplementation(
            function (eventName, handler, options) {
                if (eventName === 'DOMContentLoaded' && !destruction) {
                    destruction = ui.destroy();
                }
                return nativeAddEventListener.call(
                    this,
                    eventName,
                    handler,
                    options
                );
            }
        );
        originalBody.remove();
        try {
            await ui.createModalElement();
            await destruction;

            expect(core.element).toBeUndefined();
            expect(core.markUiReady).not.toHaveBeenCalled();
            expect(terminalCoreLogs).toBe(0);
            expect(ui.core).toBeNull();
        } finally {
            document.getElementById('dualsub-ui-root')?.remove();
            for (const body of document.querySelectorAll('body')) {
                if (body !== originalBody) body.remove();
            }
            if (!originalBody.isConnected) {
                document.documentElement.appendChild(originalBody);
            }
        }
    });

    test('external modal event listeners remove their exact tuples and saved handlers are inert', () => {
        const core = {
            element: document.body,
            contentElement: document.body,
            _log: jest.fn(),
        };
        const ui = {
            clearTerminalRetryActions: jest.fn(),
        };
        const events = new AIContextModalEvents(core, ui);
        events._handleWordSelectionEvent = jest.fn();
        events._handleAnalysisRequest = jest.fn();
        events._handleAnalysisResult = jest.fn();
        const removeDocumentListener = jest.spyOn(
            document,
            'removeEventListener'
        );

        events._setupExternalEvents();
        const records = [...events.boundHandlers.values()];
        events.removeEventListeners();

        for (const record of records) {
            expect(removeDocumentListener).toHaveBeenCalledWith(
                record.eventType,
                record.handler,
                record.options
            );
        }

        document.dispatchEvent(new CustomEvent('dualsub-word-selected'));
        document.dispatchEvent(new CustomEvent('dualsub-analyze-selection'));
        document.dispatchEvent(new CustomEvent('dualsub-context-result'));
        for (const record of records) {
            record.handler(new CustomEvent(record.eventType));
        }

        expect(events._handleWordSelectionEvent).not.toHaveBeenCalled();
        expect(events._handleAnalysisRequest).not.toHaveBeenCalled();
        expect(events._handleAnalysisResult).not.toHaveBeenCalled();
        expect(events.modalController).toBeNull();
    });

    test.each(['first', 'final'])(
        'event teardown survives a throwing %s lifecycle log',
        (throwingLog) => {
            const core = {
                element: document.body,
                contentElement: document.body,
                _log: jest.fn((_level, message) => {
                    if (
                        throwingLog === 'first' ||
                        message === 'Event listeners removed'
                    ) {
                        throw new Error('synthetic teardown log failure');
                    }
                }),
            };
            const ui = {
                clearTerminalRetryActions: jest.fn(),
            };
            const events = new AIContextModalEvents(core, ui);
            events.modalController = { retained: true };
            const handler = jest.fn();
            events._bindEvent('probe', document, 'd1-log-probe', handler);
            const record = events.boundHandlers.get('probe');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );

            expect(() => events.removeEventListeners()).not.toThrow();
            record.handler(new CustomEvent('d1-log-probe'));

            expect(record.active).toBe(false);
            expect(events.boundHandlers.size).toBe(0);
            expect(removeEventListener).toHaveBeenCalledWith(
                record.eventType,
                record.handler,
                record.options
            );
            expect(handler).not.toHaveBeenCalled();
            expect(events.core).toBeNull();
            expect(events.ui).toBeNull();
            expect(events.animations).toBeNull();
            expect(events.modalController).toBeNull();
        }
    );

    test('event teardown clears the exact post-open sync timer and its saved callback is terminal-inert', () => {
        const timerHandle = { kind: 'post-open-sync' };
        let savedCallback;
        const setTimeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay) => {
                expect(delay).toBe(16);
                savedCallback = callback;
                return timerHandle;
            });
        const clearTimeoutSpy = jest
            .spyOn(global, 'clearTimeout')
            .mockImplementation(() => {});
        const core = {
            element: document.body,
            contentElement: document.body,
            selectedWords: new Set(['word']),
            selectedWordsOrder: ['word:original:0'],
            selectedWordPositions: new Set(),
            selectionPersistence: {},
            isVisible: true,
            isAnalyzing: false,
            currentMode: 'selection',
            toggleWordSelection: jest.fn(),
            _updateSelectedText: jest.fn(),
            syncSelectionHighlights: jest.fn(),
            _log: jest.fn(),
        };
        const ui = {
            updateSelectionDisplay: jest.fn(),
            clearTerminalRetryActions: jest.fn(),
        };
        const events = new AIContextModalEvents(core, ui);
        events._pauseVideo = jest.fn();

        try {
            events._handleWordSelectionEvent({
                detail: {
                    word: 'word',
                    action: 'toggle',
                    position: 0,
                    element: null,
                    subtitleType: 'original',
                },
            });
            expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
            expect(savedCallback).toEqual(expect.any(Function));

            events.removeEventListeners();
            let terminalReads = 0;
            events.ui = new Proxy(
                {},
                {
                    get() {
                        terminalReads += 1;
                        return jest.fn();
                    },
                }
            );
            events.core = new Proxy(
                {},
                {
                    get() {
                        terminalReads += 1;
                        return jest.fn();
                    },
                }
            );
            savedCallback();

            expect(terminalReads).toBe(0);
            expect(clearTimeoutSpy).toHaveBeenCalledWith(timerHandle);
        } finally {
            setTimeoutSpy.mockRestore();
            clearTimeoutSpy.mockRestore();
        }
    });

    test('event teardown clears the exact dynamic-height timer and its saved callback is terminal-inert', () => {
        document.body.innerHTML = '<div id="dualsub-analysis-content"></div>';
        const timerHandle = { kind: 'dynamic-height' };
        let savedCallback;
        const setTimeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay) => {
                expect(delay).toBe(50);
                savedCallback = callback;
                return timerHandle;
            });
        const clearTimeoutSpy = jest
            .spyOn(global, 'clearTimeout')
            .mockImplementation(() => {});
        const core = {
            element: document.body,
            contentElement: document.body,
            currentRequest: 'request-1',
            isAnalyzing: true,
            setState: jest.fn(),
            _log: jest.fn(),
        };
        const ui = {
            clearTerminalRetryActions: jest.fn(),
        };
        const animations = {
            _applyDynamicModalHeight: jest.fn(),
        };
        const events = new AIContextModalEvents(core, ui, animations);
        events._enableWordInteractions = jest.fn();
        events._resetAnalysisButton = jest.fn();
        events._handleAnalysisComplete = jest.fn();
        events._getContextTypeTitle = jest.fn(() => 'General');
        events._formatAnalysisText = jest.fn(() => 'formatted');

        try {
            events._handleAnalysisResult({
                detail: {
                    requestId: 'request-1',
                    success: true,
                    result: {
                        analysis: 'result',
                        contextType: 'general',
                    },
                },
            });
            expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
            expect(savedCallback).toEqual(expect.any(Function));

            events.removeEventListeners();
            let terminalReads = 0;
            events.animations = new Proxy(
                {},
                {
                    get() {
                        terminalReads += 1;
                        return jest.fn();
                    },
                }
            );
            events.core = new Proxy(
                {},
                {
                    get() {
                        terminalReads += 1;
                        return jest.fn();
                    },
                }
            );
            savedCallback();

            expect(terminalReads).toBe(0);
            expect(clearTimeoutSpy).toHaveBeenCalledWith(timerHandle);
        } finally {
            setTimeoutSpy.mockRestore();
            clearTimeoutSpy.mockRestore();
        }
    });

    test('event teardown clears the exact retry timer and retry entry points are terminal-inert', () => {
        const timerHandle = { kind: 'retry' };
        let savedCallback;
        const setTimeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay) => {
                expect(delay).toBe(1000);
                savedCallback = callback;
                return timerHandle;
            });
        const clearTimeoutSpy = jest
            .spyOn(global, 'clearTimeout')
            .mockImplementation(() => {});
        const core = {
            element: document.body,
            contentElement: document.body,
            selectedText: 'selected text',
            selectedWords: new Set(['selected']),
            retryState: {
                currentAttempt: 1,
                maxRetries: 3,
                originalRequestData: { selectedText: 'selected text' },
            },
            prepareRetry: jest.fn(),
            _log: jest.fn(),
        };
        const ui = {
            clearTerminalRetryActions: jest.fn(),
        };
        const events = new AIContextModalEvents(core, ui);
        events._updateProcessingStateForRetry = jest.fn();
        events._showRetryNotification = jest.fn();
        events._dispatchAnalysisRequest = jest.fn();

        try {
            events._initiateRetry('request-1', null, 'invalid');
            expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
            expect(savedCallback).toEqual(expect.any(Function));

            events.removeEventListeners();
            let terminalReads = 0;
            events.core = new Proxy(
                {},
                {
                    get() {
                        terminalReads += 1;
                        return jest.fn();
                    },
                }
            );
            savedCallback();
            events._executeRetry();

            expect(events._dispatchAnalysisRequest).not.toHaveBeenCalled();
            expect(terminalReads).toBe(0);
            expect(clearTimeoutSpy).toHaveBeenCalledWith(timerHandle);
        } finally {
            setTimeoutSpy.mockRestore();
            clearTimeoutSpy.mockRestore();
        }
    });

    test.each(['clear', 'register'])(
        'reentrant timer %s preserves the newer same-key owner and revokes the stale schedule',
        (reentryPoint) => {
            const oldHandle = { kind: 'old' };
            const innerHandle = { kind: 'inner' };
            const outerHandle = { kind: 'outer' };
            const callbacks = new Map();
            const innerCallback = jest.fn();
            const outerCallback = jest.fn();
            let events;
            let reentered = false;
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementation((callback, delay) => {
                    callbacks.set(delay, callback);
                    if (
                        reentryPoint === 'register' &&
                        delay === 10 &&
                        !reentered
                    ) {
                        reentered = true;
                        events._scheduleOwnedTimer(
                            '_postOpenSync',
                            innerCallback,
                            5
                        );
                    }
                    return delay === 5 ? innerHandle : outerHandle;
                });
            const clearTimeoutSpy = jest
                .spyOn(global, 'clearTimeout')
                .mockImplementation((handle) => {
                    if (
                        reentryPoint === 'clear' &&
                        handle === oldHandle &&
                        !reentered
                    ) {
                        reentered = true;
                        events._scheduleOwnedTimer(
                            '_postOpenSync',
                            innerCallback,
                            5
                        );
                    }
                });
            events = new AIContextModalEvents(
                { _log: jest.fn() },
                { clearTerminalRetryActions: jest.fn() }
            );
            events._postOpenSync = oldHandle;

            try {
                events._scheduleOwnedTimer('_postOpenSync', outerCallback, 10);
                if (reentryPoint === 'clear') {
                    expect(setTimeoutSpy).not.toHaveBeenCalledWith(
                        expect.any(Function),
                        10
                    );
                }
                callbacks.get(5)();
                callbacks.get(10)?.();

                expect(innerCallback).toHaveBeenCalledTimes(1);
                expect(outerCallback).not.toHaveBeenCalled();
                expect(clearTimeoutSpy).toHaveBeenCalledWith(oldHandle);
                if (reentryPoint === 'register') {
                    expect(clearTimeoutSpy).toHaveBeenCalledWith(outerHandle);
                }
                expect(events._postOpenSync).toBeNull();
            } finally {
                events.removeEventListeners();
                setTimeoutSpy.mockRestore();
                clearTimeoutSpy.mockRestore();
            }
        }
    );

    test('reused timer handles cannot restore a replaced saved callback authority', () => {
        const sharedHandle = { kind: 'reused' };
        const savedCallbacks = [];
        const oldCallback = jest.fn();
        const newCallback = jest.fn();
        const setTimeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback) => {
                savedCallbacks.push(callback);
                return sharedHandle;
            });
        const clearTimeoutSpy = jest
            .spyOn(global, 'clearTimeout')
            .mockImplementation(() => {});
        const events = new AIContextModalEvents(
            { _log: jest.fn() },
            { clearTerminalRetryActions: jest.fn() }
        );

        try {
            events._scheduleOwnedTimer('_postOpenSync', oldCallback, 5);
            events._scheduleOwnedTimer('_postOpenSync', newCallback, 5);
            expect(savedCallbacks).toHaveLength(2);

            savedCallbacks[0]();
            expect(oldCallback).not.toHaveBeenCalled();
            expect(events._postOpenSync).toBe(sharedHandle);

            savedCallbacks[1]();
            expect(newCallback).toHaveBeenCalledTimes(1);
            expect(events._postOpenSync).toBeNull();
            expect(clearTimeoutSpy).toHaveBeenCalledWith(sharedHandle);
        } finally {
            events.removeEventListeners();
            setTimeoutSpy.mockRestore();
            clearTimeoutSpy.mockRestore();
        }
    });

    test('a stale reentrant timer registration cannot clear a reused handle owned by the newer schedule', () => {
        const sharedHandle = { kind: 'shared-reentrant' };
        const callbacks = new Map();
        const innerCallback = jest.fn();
        const outerCallback = jest.fn();
        let events;
        let reentered = false;
        const setTimeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay) => {
                callbacks.set(delay, callback);
                if (delay === 10 && !reentered) {
                    reentered = true;
                    events._scheduleOwnedTimer(
                        '_postOpenSync',
                        innerCallback,
                        5
                    );
                }
                return sharedHandle;
            });
        const clearTimeoutSpy = jest
            .spyOn(global, 'clearTimeout')
            .mockImplementation(() => {});
        events = new AIContextModalEvents(
            { _log: jest.fn() },
            { clearTerminalRetryActions: jest.fn() }
        );

        try {
            events._scheduleOwnedTimer('_postOpenSync', outerCallback, 10);

            expect(events._postOpenSync).toBe(sharedHandle);
            expect(clearTimeoutSpy).not.toHaveBeenCalledWith(sharedHandle);
            callbacks.get(10)();
            callbacks.get(5)();
            expect(outerCallback).not.toHaveBeenCalled();
            expect(innerCallback).toHaveBeenCalledTimes(1);
            expect(events._postOpenSync).toBeNull();
        } finally {
            events.removeEventListeners();
            setTimeoutSpy.mockRestore();
            clearTimeoutSpy.mockRestore();
        }
    });

    test('every modal event binding records its exact event type and options for removal', async () => {
        document.body.innerHTML = `
            <div id="modal-root">
                <button id="dualsub-modal-close"></button>
                <div id="dualsub-selected-words"></div>
                <button id="dualsub-start-analysis"></button>
                <button id="dualsub-pause-analysis"></button>
                <button id="dualsub-new-analysis"></button>
            </div>
        `;
        const modalRoot = document.getElementById('modal-root');
        const core = {
            element: modalRoot,
            contentElement: modalRoot,
            _log: jest.fn(),
        };
        const ui = {
            _getLocalizedMessage: jest.fn((key) => key),
            clearTerminalRetryActions: jest.fn(),
        };
        const events = new AIContextModalEvents(core, ui);
        const removeEventListener = jest.spyOn(
            EventTarget.prototype,
            'removeEventListener'
        );

        await events.setupEventListeners();
        const records = new Map(events.boundHandlers);

        expect(records.size).toBe(12);
        expect(records.get('global-click')).toMatchObject({
            eventType: 'click',
            options: true,
        });
        expect(records.get('overlay-mousedown')).toMatchObject({
            eventType: 'mousedown',
        });
        expect(records.get('keydown')).toMatchObject({
            eventType: 'keydown',
        });
        expect(records.get('analysis-request')).toMatchObject({
            eventType: 'dualsub-analyze-selection',
        });

        events.removeEventListeners();

        for (const { eventType, handler, options } of records.values()) {
            expect(removeEventListener).toHaveBeenCalledWith(
                eventType,
                handler,
                options
            );
        }
    });

    test('rebinding an event key revokes and removes the prior exact tuple', () => {
        document.body.innerHTML = '<div id="dualsub-selected-words"></div>';
        const selectedWordsElement = document.getElementById(
            'dualsub-selected-words'
        );
        const core = {
            element: document.body,
            contentElement: document.body,
            isAnalyzing: true,
            _log: jest.fn(),
        };
        const ui = {
            updateSelectionDisplay: jest.fn(),
            clearTerminalRetryActions: jest.fn(),
        };
        const events = new AIContextModalEvents(core, ui);
        const removeEventListener = jest.spyOn(
            selectedWordsElement,
            'removeEventListener'
        );

        events._disableWordRemoval();
        const firstRecord = events.boundHandlers.get('word-removal-blocker');
        events._disableWordRemoval();
        const secondRecord = events.boundHandlers.get('word-removal-blocker');
        const logCallsAfterReplacement = core._log.mock.calls.length;
        const staleEvent = {
            stopPropagation: jest.fn(),
            preventDefault: jest.fn(),
        };
        firstRecord.handler(staleEvent);
        expect(core._log).toHaveBeenCalledTimes(logCallsAfterReplacement);
        expect(staleEvent.stopPropagation).not.toHaveBeenCalled();
        expect(staleEvent.preventDefault).not.toHaveBeenCalled();
        events.removeEventListeners();

        expect(secondRecord).not.toBe(firstRecord);
        expect(removeEventListener).toHaveBeenCalledWith(
            'click',
            firstRecord.handler,
            true
        );
        expect(removeEventListener).toHaveBeenCalledWith(
            'click',
            secondRecord.handler,
            true
        );
        expect(selectedWordsElement._globalClickBlocker).toBeUndefined();
    });

    test('dynamic analysis button replacement removes every displaced exact tuple', () => {
        document.body.innerHTML = `
            <div>
                <button id="dualsub-start-analysis"></button>
            </div>
        `;
        const core = {
            element: document.body,
            contentElement: document.body,
            selectedWords: new Set(),
            _log: jest.fn(),
        };
        const ui = {
            _getLocalizedMessage: jest.fn((key) => key),
            clearTerminalRetryActions: jest.fn(),
        };
        const events = new AIContextModalEvents(core, ui);
        const removeEventListener = jest.spyOn(
            EventTarget.prototype,
            'removeEventListener'
        );

        events._setupAnalysisEvents();
        const initialStart = events.boundHandlers.get('start-analysis');
        events._bindEvent(
            'pause-analysis-active',
            initialStart.element,
            'click',
            jest.fn()
        );
        const dynamicPause = events.boundHandlers.get('pause-analysis-active');
        events._resetAnalysisButton();
        const replacementStart = events.boundHandlers.get('start-analysis');
        events.removeEventListeners();

        for (const record of [initialStart, dynamicPause, replacementStart]) {
            expect(removeEventListener).toHaveBeenCalledWith(
                record.eventType,
                record.handler,
                record.options
            );
        }
    });

    test('controller destroy removes exact cloned-button tuples and saved handlers are inert', async () => {
        document.body.innerHTML = `
            <div id="dualsub-modal-content">
                <button id="dualsub-start-analysis"></button>
                <div id="dualsub-selected-words"></div>
            </div>
        `;
        const contentElement = document.getElementById('dualsub-modal-content');
        const core = {
            contentElement,
            element: contentElement,
            selectedWords: new Set(['word']),
            selectedText: 'word',
            isAnalyzing: false,
            currentRequest: null,
            selectionPersistence: {},
            setAnalyzing: jest.fn((value) => {
                core.isAnalyzing = value;
            }),
            setState: jest.fn(),
            syncSelectionHighlights: jest.fn(),
            _log: jest.fn(),
        };
        const ui = {
            _getLocalizedMessage: jest.fn((key) => key),
            showProcessingState: jest.fn(),
            showInitialState: jest.fn(),
            updateSelectionDisplay: jest.fn(),
        };
        const animations = {
            showProcessingState: jest.fn(),
        };
        const controller = new ModalController(core, ui, animations);
        const addedHandlers = [];
        const nativeAddEventListener =
            HTMLButtonElement.prototype.addEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'addEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (eventName === 'click') {
                addedHandlers.push({ element: this, handler, options });
            }
            return nativeAddEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });
        const removeEventListener = jest.spyOn(
            HTMLButtonElement.prototype,
            'removeEventListener'
        );
        const analysisDispatch = jest.fn();
        const pauseDispatch = jest.fn();
        document.addEventListener(
            'dualsub-analyze-selection',
            analysisDispatch
        );
        document.addEventListener('aicontext:analysis:pause', pauseDispatch);
        try {
            controller.resetAnalysisButton();
            const startRecord = addedHandlers.at(-1);
            const startWork = controller.startAnalysis();
            const pauseRecord = addedHandlers.at(-1);
            expect(pauseRecord.handler).not.toBe(startRecord.handler);

            controller.destroy();
            const stateCallsAfterDestroy = core.setState.mock.calls.length;
            const uiCallsAfterDestroy =
                ui.showInitialState.mock.calls.length +
                ui.updateSelectionDisplay.mock.calls.length;
            const savedEvent = {
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            };
            startRecord.handler(savedEvent);
            pauseRecord.handler(savedEvent);
            await controller.startAnalysis();
            controller.pauseAnalysis();
            await startWork;

            expect(removeEventListener).toHaveBeenCalledWith(
                'click',
                startRecord.handler,
                startRecord.options
            );
            expect(removeEventListener).toHaveBeenCalledWith(
                'click',
                pauseRecord.handler,
                pauseRecord.options
            );
            expect(analysisDispatch).not.toHaveBeenCalled();
            expect(pauseDispatch).not.toHaveBeenCalled();
            expect(savedEvent.preventDefault).not.toHaveBeenCalled();
            expect(savedEvent.stopPropagation).not.toHaveBeenCalled();
            expect(core.setState).toHaveBeenCalledTimes(stateCallsAfterDestroy);
            expect(
                ui.showInitialState.mock.calls.length +
                    ui.updateSelectionDisplay.mock.calls.length
            ).toBe(uiCallsAfterDestroy);
            expect(controller.core).toBeNull();
            expect(controller.ui).toBeNull();
            expect(controller.animations).toBeNull();
            expect(controller.events).toBeNull();
        } finally {
            document.removeEventListener(
                'dualsub-analyze-selection',
                analysisDispatch
            );
            document.removeEventListener(
                'aicontext:analysis:pause',
                pauseDispatch
            );
        }
    });

    test('controller repeated button replacement removes the prior exact tuple', () => {
        document.body.innerHTML = `
            <div id="dualsub-modal-content">
                <button id="dualsub-start-analysis"></button>
            </div>
        `;
        const contentElement = document.getElementById('dualsub-modal-content');
        const core = {
            contentElement,
            selectedWords: new Set(),
        };
        const controller = new ModalController(
            core,
            { _getLocalizedMessage: jest.fn((key) => key) },
            null
        );
        const addedHandlers = [];
        const nativeAddEventListener =
            HTMLButtonElement.prototype.addEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'addEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (eventName === 'click') {
                addedHandlers.push({ element: this, handler, options });
            }
            return nativeAddEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });
        const removeEventListener = jest.spyOn(
            HTMLButtonElement.prototype,
            'removeEventListener'
        );

        controller.resetAnalysisButton();
        const firstRecord = addedHandlers.at(-1);
        controller.resetAnalysisButton();
        const staleEvent = {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        };
        const startAnalysis = jest
            .spyOn(controller, 'startAnalysis')
            .mockResolvedValue(undefined);
        firstRecord.handler(staleEvent);
        expect(startAnalysis).not.toHaveBeenCalled();
        expect(staleEvent.preventDefault).not.toHaveBeenCalled();
        expect(staleEvent.stopPropagation).not.toHaveBeenCalled();
        controller.destroy();

        expect(addedHandlers).toHaveLength(2);
        for (const record of addedHandlers) {
            expect(removeEventListener).toHaveBeenCalledWith(
                'click',
                record.handler,
                record.options
            );
        }
    });

    test('modal destroy awaits UI cleanup and isolates its failure before core cleanup', async () => {
        const cleanupOrder = [];
        const modal = new AIContextModal();
        modal.animations = {
            cleanup: jest.fn(() => cleanupOrder.push('animations')),
        };
        modal.events = {
            removeEventListeners: jest.fn(() => cleanupOrder.push('events')),
        };
        modal.controller = {
            destroy: jest.fn(() => cleanupOrder.push('controller')),
        };
        modal.ui = {
            destroy: jest.fn(async () => {
                cleanupOrder.push('ui');
                throw new Error('synthetic UI cleanup failure');
            }),
        };
        modal.core = {
            _log: jest.fn(),
            destroy: jest.fn(async () => cleanupOrder.push('core')),
        };

        await expect(modal.destroy()).resolves.toBeUndefined();

        expect(cleanupOrder).toEqual([
            'events',
            'controller',
            'animations',
            'ui',
            'core',
        ]);
        expect(modal.ui).toBeNull();
        expect(modal.controller).toBeNull();
        expect(modal.core).toBeNull();
    });

    test('modal destroy revokes event authority before awaiting animation cleanup', async () => {
        const animationCleanup = createDeferred();
        const core = {
            element: document.body,
            contentElement: document.body,
            _log: jest.fn(),
            destroy: jest.fn().mockResolvedValue(undefined),
        };
        const events = new AIContextModalEvents(core, {
            clearTerminalRetryActions: jest.fn(),
        });
        const handled = jest.fn();
        events._bindEvent('probe', document, 'd1-terminal-probe', handled);
        const modal = new AIContextModal();
        modal.core = core;
        modal.events = events;
        modal.animations = {
            cleanup: jest.fn(() => animationCleanup.promise),
        };
        modal.ui = {
            destroy: jest.fn().mockResolvedValue(undefined),
        };

        const destruction = modal.destroy();
        try {
            document.dispatchEvent(new CustomEvent('d1-terminal-probe'));
            expect(events._destroyed).toBe(true);
            expect(handled).not.toHaveBeenCalled();

            for (let attempt = 0; attempt < 20; attempt += 1) {
                if (modal.animations === null) break;
                await Promise.resolve();
            }
            document.dispatchEvent(new CustomEvent('d1-terminal-probe'));
            expect(handled).not.toHaveBeenCalled();
        } finally {
            animationCleanup.resolve();
            await destruction;
        }
    });

    test('modal destroy does not wait on its own canonical promise returned by an owner', async () => {
        const modal = new AIContextModal();
        modal.animations = {
            cleanup: jest.fn(() => modal.destroy()),
        };
        modal.events = { removeEventListeners: jest.fn() };
        modal.ui = { destroy: jest.fn() };
        modal.core = { _log: jest.fn(), destroy: jest.fn() };

        const destruction = modal.destroy();
        let settled = false;
        destruction.then(() => {
            settled = true;
        });
        for (let attempt = 0; attempt < 30; attempt += 1) {
            await Promise.resolve();
        }

        expect(settled).toBe(true);
    });

    test('modal destroy isolates every failing phase and still settles once', async () => {
        const modal = new AIContextModal();
        const showHandler = jest.fn();
        const closeHandler = jest.fn();
        const relayHandler = jest.fn();
        modal.coordinationHandlers = new Map([
            ['show-request', showHandler],
            ['close-request', closeHandler],
            ['close-relay', relayHandler],
        ]);
        const removeDocumentListener = jest
            .spyOn(document, 'removeEventListener')
            .mockImplementation((eventName) => {
                if (eventName === 'aicontext:modal:showRequested') {
                    throw new Error('synthetic coordination cleanup failure');
                }
            });
        const animationsCleanup = jest.fn(() => {
            throw new Error('synthetic animations cleanup failure');
        });
        const eventsCleanup = jest.fn(() =>
            Promise.reject(new Error('synthetic events cleanup failure'))
        );
        const uiCleanup = jest.fn(() =>
            Promise.reject(new Error('synthetic UI cleanup failure'))
        );
        const coreCleanup = jest.fn(() => {
            throw new Error('synthetic core cleanup failure');
        });
        modal.animations = { cleanup: animationsCleanup };
        modal.events = { removeEventListeners: eventsCleanup };
        modal.ui = { destroy: uiCleanup };
        modal.core = { _log: jest.fn(), destroy: coreCleanup };
        const consoleLog = jest.spyOn(console, 'log').mockImplementation();

        const destroyPromise = modal.destroy();
        await expect(destroyPromise).resolves.toBeUndefined();

        expect(modal.destroy()).toBe(destroyPromise);
        expect(removeDocumentListener).toHaveBeenCalledTimes(3);
        expect(animationsCleanup).toHaveBeenCalledTimes(1);
        expect(eventsCleanup).toHaveBeenCalledTimes(1);
        expect(uiCleanup).toHaveBeenCalledTimes(1);
        expect(coreCleanup).toHaveBeenCalledTimes(1);
        expect(modal.coordinationHandlers.size).toBe(0);
        expect(modal.animations).toBeNull();
        expect(modal.events).toBeNull();
        expect(modal.ui).toBeNull();
        expect(modal.core).toBeNull();
        expect(consoleLog).not.toHaveBeenCalled();
    });

    test('repeated modal initialization preserves one owned module graph', async () => {
        global.fetch = jest.fn((url) => {
            if (String(url).endsWith('/modal.css')) {
                return Promise.resolve({
                    ok: true,
                    text: jest.fn().mockResolvedValue(''),
                });
            }
            return Promise.resolve(createTranslationResponse());
        });
        const configService = {
            get: jest.fn().mockResolvedValue('en'),
            onChanged: jest.fn(() => jest.fn()),
        };
        const modal = new AIContextModal({
            contentScript: { configService },
        });

        await modal.initialize();
        const firstOwners = {
            ui: modal.ui,
            events: modal.events,
            animations: modal.animations,
            controller: modal.controller,
        };
        await modal.initialize();

        expect(modal.ui).toBe(firstOwners.ui);
        expect(modal.events).toBe(firstOwners.events);
        expect(modal.animations).toBe(firstOwners.animations);
        expect(modal.controller).toBe(firstOwners.controller);

        await modal.destroy();
        expect(firstOwners.events._destroyed).toBe(true);
        expect(firstOwners.ui.core).toBeNull();
        document.getElementById('dualsub-modal-styles')?.remove();
    });

    test('destroy during core initialization prevents publishing later modal owners', async () => {
        const coreInitialization = createDeferred();
        const modal = new AIContextModal();
        const core = {
            _log: jest.fn(),
            initialize: jest.fn(() => coreInitialization.promise),
            destroy: jest.fn().mockResolvedValue(undefined),
        };
        modal.core = core;
        const addDocumentListener = jest.spyOn(document, 'addEventListener');

        const initialization = modal.initialize();
        await Promise.resolve();
        const destruction = modal.destroy();
        coreInitialization.resolve();

        await expect(initialization).resolves.toBeUndefined();
        await destruction;
        expect(core.destroy).toHaveBeenCalledTimes(1);
        expect(modal.core).toBeNull();
        expect(modal.ui).toBeNull();
        expect(modal.events).toBeNull();
        expect(modal.animations).toBeNull();
        expect(addDocumentListener).not.toHaveBeenCalledWith(
            'aicontext:modal:showRequested',
            expect.any(Function)
        );
    });

    test('destroy during UI initialization prevents publishing downstream owners', async () => {
        const languageRead = createDeferred();
        const configService = {
            get: jest.fn(() => languageRead.promise),
            onChanged: jest.fn(() => jest.fn()),
        };
        const modal = new AIContextModal({
            contentScript: { configService },
        });
        const addDocumentListener = jest.spyOn(document, 'addEventListener');

        const initialization = modal.initialize();
        await Promise.resolve();
        await Promise.resolve();
        expect(configService.get).toHaveBeenCalledWith('uiLanguage');
        const retainedUi = modal.ui;
        expect(retainedUi).toBeInstanceOf(AIContextModalUI);

        const destruction = modal.destroy();
        languageRead.resolve('en');
        await expect(initialization).resolves.toBeUndefined();
        await destruction;

        expect(retainedUi.core).toBeNull();
        expect(modal.core).toBeNull();
        expect(modal.ui).toBeNull();
        expect(modal.events).toBeNull();
        expect(modal.animations).toBeNull();
        expect(addDocumentListener).not.toHaveBeenCalledWith(
            'aicontext:modal:showRequested',
            expect.any(Function)
        );
    });

    test('destroy during modal element creation prevents late DOM and owner publication', async () => {
        const cssFetch = createDeferred();
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce(createTranslationResponse())
            .mockReturnValueOnce(cssFetch.promise);
        const configService = {
            get: jest.fn().mockResolvedValue('en'),
            onChanged: jest.fn(() => jest.fn()),
        };
        const modal = new AIContextModal({
            contentScript: { configService },
        });

        const initialization = modal.initialize();
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if (global.fetch.mock.calls.length === 2) break;
            await Promise.resolve();
        }
        expect(global.fetch).toHaveBeenCalledTimes(2);
        const retainedUi = modal.ui;

        const destruction = modal.destroy();
        cssFetch.resolve({
            ok: true,
            text: jest.fn().mockResolvedValue('body { color: red; }'),
        });

        await expect(initialization).resolves.toBeUndefined();
        await destruction;
        expect(retainedUi.core).toBeNull();
        expect(document.getElementById('dualsub-modal-styles')).toBeNull();
        expect(document.getElementById('dualsub-context-modal')).toBeNull();
        expect(modal.core).toBeNull();
        expect(modal.ui).toBeNull();
        expect(modal.events).toBeNull();
        expect(modal.animations).toBeNull();
    });

    test('destroy during event setup prevents late coordination and controller publication', async () => {
        const eventSetup = createDeferred();
        const setupEventListeners = jest
            .spyOn(AIContextModalEvents.prototype, 'setupEventListeners')
            .mockReturnValue(eventSetup.promise);
        const removeEventListeners = jest.spyOn(
            AIContextModalEvents.prototype,
            'removeEventListeners'
        );
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce(createTranslationResponse())
            .mockResolvedValueOnce({
                ok: true,
                text: jest.fn().mockResolvedValue(''),
            });
        const configService = {
            get: jest.fn().mockResolvedValue('en'),
            onChanged: jest.fn(() => jest.fn()),
        };
        const modal = new AIContextModal({
            contentScript: { configService },
        });
        const addDocumentListener = jest.spyOn(document, 'addEventListener');

        const initialization = modal.initialize();
        for (let attempt = 0; attempt < 40; attempt += 1) {
            if (setupEventListeners.mock.calls.length === 1) break;
            await Promise.resolve();
        }
        expect(setupEventListeners).toHaveBeenCalledTimes(1);
        const retainedEvents = modal.events;

        const destruction = modal.destroy();
        eventSetup.resolve();
        await expect(initialization).resolves.toBeUndefined();
        await destruction;

        expect(removeEventListeners).toHaveBeenCalledTimes(1);
        expect(retainedEvents).toBeInstanceOf(AIContextModalEvents);
        expect(modal.controller).toBeNull();
        expect(modal.core).toBeNull();
        expect(modal.ui).toBeNull();
        expect(modal.events).toBeNull();
        expect(modal.animations).toBeNull();
        expect(addDocumentListener).not.toHaveBeenCalledWith(
            'aicontext:modal:showRequested',
            expect.any(Function)
        );
    });

    test('concurrent modal destroy calls share one teardown and one UI cleanup', async () => {
        const uiCleanup = createDeferred();
        const modal = new AIContextModal();
        modal.animations = { cleanup: jest.fn() };
        modal.events = { removeEventListeners: jest.fn() };
        const uiOwner = {
            destroy: jest.fn(() => uiCleanup.promise),
        };
        modal.ui = uiOwner;
        modal.core = {
            _log: jest.fn(),
            destroy: jest.fn().mockResolvedValue(undefined),
        };

        const firstDestroy = modal.destroy();
        const secondDestroy = modal.destroy();

        expect(secondDestroy).toBe(firstDestroy);
        for (let attempt = 0; attempt < 20; attempt += 1) {
            if (uiOwner.destroy.mock.calls.length === 1) break;
            await Promise.resolve();
        }
        expect(uiOwner.destroy).toHaveBeenCalledTimes(1);
        uiCleanup.resolve();
        await firstDestroy;

        expect(modal.core).toBeNull();
    });
});
