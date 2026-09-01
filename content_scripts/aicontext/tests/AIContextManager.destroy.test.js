import { jest } from '@jest/globals';

const modalInitialize = jest.fn();
const modalDestroy = jest.fn();
const modalSetLogger = jest.fn();
const modalApplySelection = jest.fn(() => true);
const providerInitialize = jest.fn();
const providerDestroy = jest.fn();

jest.unstable_mockModule('../ui/modal.js', () => ({
    AIContextModal: class {
        constructor(config) {
            this.config = config;
        }

        setLogger(logger) {
            modalSetLogger(logger);
        }

        initialize() {
            return modalInitialize();
        }

        applySelectionSnapshot(snapshot) {
            return modalApplySelection(snapshot);
        }

        destroy() {
            return modalDestroy();
        }
    },
}));

jest.unstable_mockModule('../providers/AIContextProvider.js', () => ({
    AIContextProvider: class {
        initialize() {
            return providerInitialize();
        }

        destroy() {
            return providerDestroy();
        }
    },
}));

const { AIContextManager } = await import('../core/AIContextManager.js');
const { createAIContextChannel } = await import('../core/AIContextChannel.js');
const { EVENT_TYPES } = await import('../core/constants.js');

function deferred() {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

function createManager(platform = 'netflix') {
    return new AIContextManager(platform, {
        analysisAuthority: {
            channel: createAIContextChannel({ lifecycleGeneration: 1 }),
            allocateRequestId: jest.fn(() => 1),
            getSelectionSnapshot: jest.fn(() => null),
            clearSelection: jest.fn(() => true),
        },
        contentScript: {},
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    modalInitialize.mockResolvedValue(true);
    modalDestroy.mockResolvedValue(undefined);
    providerInitialize.mockResolvedValue(true);
    providerDestroy.mockResolvedValue(undefined);
});

describe('AIContextManager lifecycle', () => {
    test('single-flights initialization and exposes only production features', async () => {
        const manager = createManager();
        const initialized = jest.fn();
        document.addEventListener(EVENT_TYPES.SYSTEM_INITIALIZED, initialized);

        const first = manager.initialize();
        expect(manager.initialize()).toBe(first);
        expect(await first).toBe(true);

        expect(manager.initialized).toBe(true);
        expect(manager.getModal()).not.toBeNull();
        expect(manager.getProvider()).not.toBeNull();
        expect(manager.getTextHandler()).toBeNull();
        expect(manager.getEnabledFeatures()).toEqual(['contextModal']);
        expect(await manager.enableFeature('interactiveSubtitles')).toBe(true);
        expect(await manager.enableFeature('textSelection')).toBe(false);
        expect(initialized).toHaveBeenCalledTimes(1);
        expect(modalInitialize).toHaveBeenCalledTimes(1);
        expect(providerInitialize).toHaveBeenCalledTimes(1);

        document.removeEventListener(
            EVENT_TYPES.SYSTEM_INITIALIZED,
            initialized
        );
        await manager.destroy();
    });

    test('shares one destroy promise and destroys each owned component once', async () => {
        const manager = createManager();
        await manager.initialize();

        const first = manager.destroy();
        expect(manager.destroy()).toBe(first);
        await first;

        expect(modalDestroy).toHaveBeenCalledTimes(1);
        expect(providerDestroy).toHaveBeenCalledTimes(1);
        expect(manager.initialized).toBe(false);
        expect(manager.getModal()).toBeNull();
        expect(manager.getProvider()).toBeNull();
        expect(await manager.enableFeature('contextModal')).toBe(false);
    });

    test('destroy during modal startup prevents provider creation and late commit', async () => {
        const modalReady = deferred();
        modalInitialize.mockReturnValue(modalReady.promise);
        const manager = createManager();

        const initialization = manager.initialize();
        await Promise.resolve();
        const destruction = manager.destroy();
        modalReady.resolve(true);

        expect(await initialization).toBe(false);
        await destruction;
        expect(providerInitialize).not.toHaveBeenCalled();
        expect(modalDestroy).toHaveBeenCalledTimes(1);
        expect(manager.initialized).toBe(false);
    });

    test('failed provider startup rolls back the initialized modal and provider', async () => {
        providerInitialize.mockResolvedValue(false);
        const manager = createManager();

        expect(await manager.initialize()).toBe(false);

        expect(manager.initialized).toBe(false);
        expect(modalDestroy).toHaveBeenCalledTimes(1);
        expect(providerDestroy).toHaveBeenCalledTimes(1);
    });

    test('invalid platform or authority fails closed without creating components', async () => {
        const unsupported = createManager('unsupported');
        const missingAuthority = new AIContextManager('netflix');

        expect(await unsupported.initialize()).toBe(false);
        expect(await missingAuthority.initialize()).toBe(false);
        expect(modalInitialize).not.toHaveBeenCalled();
        expect(providerInitialize).not.toHaveBeenCalled();
    });
});
