import { jest } from '@jest/globals';

function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

const formatterLoad = createDeferred();
const initializeInteractiveSubtitles = jest.fn();
const formatInteractiveSubtitleText = jest.fn();
const attachInteractiveEventListeners = jest.fn();
const setInteractiveEnabled = jest.fn();
const formatterLifecycles = [];
let activeFormatterLifecycle = null;
let onLifecycleBegin = null;

const beginInteractiveLifecycle = jest.fn(
    ({
        publishWordIntent = null,
        resolveOriginalWordBindingSnapshot = null,
    } = {}) => {
        const lifecycle = {
            publishWordIntent:
                typeof publishWordIntent === 'function'
                    ? publishWordIntent
                    : null,
            resolveOriginalWordBindingSnapshot:
                typeof resolveOriginalWordBindingSnapshot === 'function'
                    ? resolveOriginalWordBindingSnapshot
                    : null,
            active: true,
            cleanup: null,
        };
        activeFormatterLifecycle = lifecycle;
        let cleaned = false;
        lifecycle.cleanup = jest.fn(() => {
            if (cleaned) return;
            cleaned = true;
            lifecycle.active = false;
            if (activeFormatterLifecycle === lifecycle) {
                activeFormatterLifecycle = null;
            }
        });
        formatterLifecycles.push(lifecycle);
        onLifecycleBegin?.(lifecycle);
        return lifecycle.cleanup;
    }
);

function publishFromFormatter(intent) {
    if (
        activeFormatterLifecycle?.active &&
        activeFormatterLifecycle.publishWordIntent
    ) {
        activeFormatterLifecycle.publishWordIntent(intent);
    }
}

function getWindowDataValues() {
    return Reflect.ownKeys(window)
        .map((key) => Object.getOwnPropertyDescriptor(window, key))
        .filter((descriptor) => descriptor && 'value' in descriptor)
        .map((descriptor) => descriptor.value);
}

jest.unstable_mockModule(
    '../../shared/interactiveSubtitleFormatter.js',
    async () => {
        await formatterLoad.promise;
        return {
            initializeInteractiveSubtitles,
            formatInteractiveSubtitleText,
            attachInteractiveEventListeners,
            setInteractiveEnabled,
            beginInteractiveLifecycle,
        };
    }
);

const { initializeInteractiveSubtitleFeatures } =
    await import('../../shared/subtitleUtilities.js');

describe('subtitle utility interactive lifecycle binding', () => {
    beforeEach(() => {
        global.chrome = {
            runtime: {
                getURL: jest.fn(
                    () =>
                        new URL(
                            '../../shared/interactiveSubtitleFormatter.js',
                            import.meta.url
                        ).href
                ),
            },
        };
        activeFormatterLifecycle = null;
        onLifecycleBegin = null;
        formatterLifecycles.length = 0;
        jest.clearAllMocks();
        delete window.dualsub_formatInteractiveSubtitleText;
        delete window.dualsub_attachInteractiveEventListeners;
        delete window.dualsub_setInteractiveEnabled;
    });

    afterEach(() => {
        activeFormatterLifecycle?.cleanup();
        activeFormatterLifecycle = null;
        onLifecycleBegin = null;
    });

    test('deferred stale publisher bridge', async () => {
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        let firstCurrent = true;
        let secondCurrent = true;

        const firstInitialization = initializeInteractiveSubtitleFeatures(
            { enabled: true, platform: 'netflix' },
            () => firstCurrent,
            firstPublisher
        );
        const secondInitialization = initializeInteractiveSubtitleFeatures(
            { enabled: true, platform: 'netflix' },
            () => secondCurrent,
            secondPublisher
        );
        firstCurrent = false;
        formatterLoad.resolve();

        const [cleanupFirst, cleanupSecond] = await Promise.all([
            firstInitialization,
            secondInitialization,
        ]);

        expect(chrome.runtime.getURL).toHaveBeenCalledTimes(1);
        expect(beginInteractiveLifecycle).toHaveBeenCalledTimes(1);
        const lifecycleOptions = beginInteractiveLifecycle.mock.calls[0][0];
        expect(Object.keys(lifecycleOptions)).toEqual([
            'publishWordIntent',
            'resolveOriginalWordBindingSnapshot',
        ]);
        expect(lifecycleOptions.publishWordIntent).toEqual(
            expect.any(Function)
        );
        expect(lifecycleOptions.publishWordIntent).not.toBe(secondPublisher);
        expect(lifecycleOptions.resolveOriginalWordBindingSnapshot).toEqual(
            expect.any(Function)
        );
        expect(initializeInteractiveSubtitles).toHaveBeenCalledTimes(1);
        const initializedConfig =
            initializeInteractiveSubtitles.mock.calls[0][0];
        expect(initializedConfig).toEqual(
            expect.objectContaining({
                enabled: true,
                platform: 'netflix',
                clickableWords: true,
                highlightOnHover: true,
            })
        );
        expect(initializedConfig).not.toHaveProperty('publishWordIntent');
        expect(Object.values(initializedConfig)).not.toContain(secondPublisher);
        expect(Object.values(initializedConfig)).not.toContain(
            lifecycleOptions.resolveOriginalWordBindingSnapshot
        );
        expect(window.dualsub_formatInteractiveSubtitleText).toBe(
            formatInteractiveSubtitleText
        );
        expect(window.dualsub_attachInteractiveEventListeners).toBe(
            attachInteractiveEventListeners
        );
        expect(window.dualsub_setInteractiveEnabled).toBe(
            setInteractiveEnabled
        );
        expect(getWindowDataValues()).not.toContain(firstPublisher);
        expect(getWindowDataValues()).not.toContain(secondPublisher);
        expect(getWindowDataValues()).not.toContain(
            lifecycleOptions.resolveOriginalWordBindingSnapshot
        );

        const wordIntent = Object.freeze({
            action: 'toggle',
            renderRevision: 7,
            wordIndex: 0,
        });
        publishFromFormatter(wordIntent);
        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).toHaveBeenCalledTimes(1);
        expect(secondPublisher).toHaveBeenCalledWith(wordIntent);

        cleanupFirst();
        expect(formatterLifecycles[0].cleanup).not.toHaveBeenCalled();
        cleanupSecond();
        cleanupSecond();
        expect(formatterLifecycles[0].cleanup).toHaveBeenCalledTimes(1);
        publishFromFormatter(wordIntent);
        expect(secondPublisher).toHaveBeenCalledTimes(1);

        secondCurrent = false;
    });

    test('omitted and nonfunction publishers remain inert', async () => {
        const trap = jest.fn(() => {
            throw new Error('NONFUNCTION_PUBLISHER_ACCESSED');
        });
        const nonFunctionPublisher = new Proxy(
            {},
            {
                get: trap,
                getOwnPropertyDescriptor: trap,
                getPrototypeOf: trap,
                has: trap,
                ownKeys: trap,
            }
        );
        const config = { enabled: true, platform: 'netflix' };

        const omittedCleanup = await initializeInteractiveSubtitleFeatures(
            config,
            () => true
        );
        publishFromFormatter({ action: 'toggle' });
        omittedCleanup();
        const nonFunctionCleanup = await initializeInteractiveSubtitleFeatures(
            config,
            () => true,
            nonFunctionPublisher
        );
        publishFromFormatter({ action: 'toggle' });

        expect(beginInteractiveLifecycle.mock.calls[0][0]).toEqual({
            publishWordIntent: null,
            resolveOriginalWordBindingSnapshot: expect.any(Function),
        });
        const nonFunctionOptions = beginInteractiveLifecycle.mock.calls[1][0];
        const optionKeys = Object.keys(nonFunctionOptions);
        expect(optionKeys).toEqual([
            'publishWordIntent',
            'resolveOriginalWordBindingSnapshot',
        ]);
        expect(nonFunctionOptions.publishWordIntent).toBeNull();
        expect(nonFunctionOptions.resolveOriginalWordBindingSnapshot).toEqual(
            expect.any(Function)
        );
        expect(trap).not.toHaveBeenCalled();
        const initializedConfigs = initializeInteractiveSubtitles.mock.calls;
        for (const [initializedConfig] of initializedConfigs) {
            expect(initializedConfig).not.toHaveProperty('publishWordIntent');
            expect(Object.values(initializedConfig)).not.toContain(
                nonFunctionPublisher
            );
        }
        expect(getWindowDataValues()).not.toContain(nonFunctionPublisher);

        nonFunctionCleanup();
        nonFunctionCleanup();
        expect(formatterLifecycles[1].cleanup).toHaveBeenCalledTimes(1);
    });

    test('supersession revokes only the stale capability', async () => {
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        let secondInitialization = null;
        onLifecycleBegin = () => {
            onLifecycleBegin = null;
            secondInitialization = initializeInteractiveSubtitleFeatures(
                { enabled: true, platform: 'netflix' },
                () => true,
                secondPublisher
            );
        };

        const firstInitialization = initializeInteractiveSubtitleFeatures(
            { enabled: true, platform: 'netflix' },
            () => true,
            firstPublisher
        );
        const cleanupFirst = await firstInitialization;
        const cleanupSecond = await secondInitialization;

        const firstOptions = beginInteractiveLifecycle.mock.calls[0][0];
        const secondOptions = beginInteractiveLifecycle.mock.calls[1][0];
        for (const [options, publisher] of [
            [firstOptions, firstPublisher],
            [secondOptions, secondPublisher],
        ]) {
            expect(options.publishWordIntent).toEqual(expect.any(Function));
            expect(options.publishWordIntent).not.toBe(publisher);
            expect(options.resolveOriginalWordBindingSnapshot).toEqual(
                expect.any(Function)
            );
        }
        expect(formatterLifecycles[0].cleanup).toHaveBeenCalledTimes(1);
        expect(formatterLifecycles[1].cleanup).not.toHaveBeenCalled();

        const wordIntent = Object.freeze({ action: 'toggle', wordIndex: 0 });
        publishFromFormatter(wordIntent);
        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).toHaveBeenCalledWith(wordIntent);

        cleanupFirst();
        cleanupFirst();
        expect(formatterLifecycles[0].cleanup).toHaveBeenCalledTimes(1);
        publishFromFormatter(wordIntent);
        expect(secondPublisher).toHaveBeenCalledTimes(2);

        cleanupSecond();
        cleanupSecond();
        expect(formatterLifecycles[1].cleanup).toHaveBeenCalledTimes(1);
        publishFromFormatter(wordIntent);
        expect(secondPublisher).toHaveBeenCalledTimes(2);

        const initializedConfigs = initializeInteractiveSubtitles.mock.calls;
        for (const [initializedConfig] of initializedConfigs) {
            expect(initializedConfig).not.toHaveProperty('publishWordIntent');
            expect(Object.values(initializedConfig)).not.toContain(
                firstPublisher
            );
            expect(Object.values(initializedConfig)).not.toContain(
                secondPublisher
            );
        }
        expect(getWindowDataValues()).not.toContain(firstPublisher);
        expect(getWindowDataValues()).not.toContain(secondPublisher);
    });
});
