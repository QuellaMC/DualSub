import { jest } from '@jest/globals';

let resolveFormatterLoad;
const formatterLoad = new Promise((resolve) => {
    resolveFormatterLoad = resolve;
});
const initializeInteractiveSubtitles = jest.fn();
const formatInteractiveSubtitleText = jest.fn();
const attachInteractiveEventListeners = jest.fn();
const setInteractiveEnabled = jest.fn();
let activeLifecycle = null;

const beginInteractiveLifecycle = jest.fn(
    ({ publishWordIntent, resolveOriginalWordBindingSnapshot }) => {
        const lifecycle = {
            publishWordIntent,
            resolveOriginalWordBindingSnapshot,
            cleanup: null,
        };
        let cleaned = false;
        lifecycle.cleanup = jest.fn(() => {
            if (cleaned) return;
            cleaned = true;
            if (activeLifecycle === lifecycle) activeLifecycle = null;
        });
        activeLifecycle = lifecycle;
        return lifecycle.cleanup;
    }
);

jest.unstable_mockModule(
    '../../shared/interactiveSubtitleFormatter.js',
    async () => {
        await formatterLoad;
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

describe('subtitle interactive lifecycle binding', () => {
    afterEach(() => activeLifecycle?.cleanup());

    test('only the newest concurrent initialization can publish word intents', async () => {
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
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        let firstCurrent = true;

        const firstInitialization = initializeInteractiveSubtitleFeatures(
            { platform: 'netflix' },
            () => firstCurrent,
            firstPublisher
        );
        const secondInitialization = initializeInteractiveSubtitleFeatures(
            { platform: 'netflix' },
            () => true,
            secondPublisher
        );
        firstCurrent = false;
        resolveFormatterLoad();
        const [firstCleanup, secondCleanup] = await Promise.all([
            firstInitialization,
            secondInitialization,
        ]);

        expect(chrome.runtime.getURL).toHaveBeenCalledTimes(1);
        expect(initializeInteractiveSubtitles).toHaveBeenCalledTimes(1);
        expect(beginInteractiveLifecycle).toHaveBeenCalledTimes(1);
        expect(activeLifecycle.publishWordIntent).toEqual(expect.any(Function));
        expect(activeLifecycle.resolveOriginalWordBindingSnapshot).toEqual(
            expect.any(Function)
        );

        const intent = Object.freeze({
            action: 'toggle',
            renderRevision: 7,
            wordIndex: 0,
        });
        activeLifecycle.publishWordIntent(intent);
        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).toHaveBeenCalledWith(intent);

        firstCleanup();
        expect(activeLifecycle).not.toBeNull();
        secondCleanup();
        secondCleanup();
        expect(activeLifecycle).toBeNull();
    });
});
