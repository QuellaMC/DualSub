import { jest } from '@jest/globals';

const microsoftTranslate = jest.fn();
const googleTranslate = jest.fn();
const deeplTranslate = jest.fn();
const openAITranslate = jest.fn();
const vertexTranslate = jest.fn();
const configGet = jest.fn();
const configSet = jest.fn();
const configOnChanged = jest.fn();
const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
};

jest.unstable_mockModule(
    '../../translation_providers/microsoftTranslateEdgeAuth.js',
    () => ({ translate: microsoftTranslate })
);
jest.unstable_mockModule(
    '../../translation_providers/googleTranslate.js',
    () => ({ translate: googleTranslate })
);
jest.unstable_mockModule(
    '../../translation_providers/deeplTranslate.js',
    () => ({ translate: deeplTranslate })
);
jest.unstable_mockModule(
    '../../translation_providers/openaiCompatibleTranslate.js',
    () => ({ translate: openAITranslate })
);
jest.unstable_mockModule(
    '../../translation_providers/geminiVertexTranslate.js',
    () => ({ translate: vertexTranslate })
);
jest.unstable_mockModule('../../services/configService.js', () => ({
    configService: {
        get: configGet,
        set: configSet,
        onChanged: configOnChanged,
    },
}));
jest.unstable_mockModule('../utils/loggingManager.js', () => ({
    loggingManager: {
        createLogger: () => logger,
    },
}));

const providerMocks = [
    microsoftTranslate,
    googleTranslate,
    deeplTranslate,
    openAITranslate,
    vertexTranslate,
];
const loggerMocks = Object.values(logger);

describe('TranslationService public behavior', () => {
    let configListener;

    beforeEach(() => {
        jest.resetModules();
        jest.useRealTimers();
        for (const mock of [
            ...providerMocks,
            ...loggerMocks,
            configGet,
            configSet,
            configOnChanged,
        ]) {
            mock.mockReset();
        }
        microsoftTranslate.mockResolvedValue('translated');
        configGet.mockImplementation(async (key) => {
            if (key === 'selectedProvider') return 'microsoft_edge_auth';
            if (key === 'translationDelay') return 0;
            return undefined;
        });
        configOnChanged.mockImplementation((listener) => {
            configListener = listener;
            return () => {};
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    async function loadService() {
        const { translationProviders } =
            await import('./translationService.js');
        await translationProviders.initialize();
        return translationProviders;
    }

    test('caches per provider and follows provider config changes', async () => {
        const service = await loadService();
        microsoftTranslate.mockResolvedValue('hola-microsoft');
        deeplTranslate.mockResolvedValue('hola-deepl');

        await expect(service.translate('hello', 'en', 'es')).resolves.toBe(
            'hola-microsoft'
        );
        await expect(service.translate('hello', 'en', 'es')).resolves.toBe(
            'hola-microsoft'
        );
        expect(microsoftTranslate).toHaveBeenCalledTimes(1);

        configListener({ selectedProvider: 'deepl' });
        await expect(service.translate('hello', 'en', 'es')).resolves.toBe(
            'hola-deepl'
        );
        expect(deeplTranslate).toHaveBeenCalledTimes(1);
    });

    test('applies live pacing without waiting for an earlier response', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(10_000);
        let resolveFirst;
        microsoftTranslate.mockImplementation((text) => {
            if (text === 'first') {
                return new Promise((resolve) => {
                    resolveFirst = resolve;
                });
            }
            return Promise.resolve(`translated:${text}`);
        });
        const service = await loadService();

        const first = service.translate('first', 'en', 'es');
        await jest.advanceTimersByTimeAsync(0);
        expect(microsoftTranslate).toHaveBeenCalledTimes(1);

        configListener({ translationDelay: 1000 });
        const second = service.translate('second', 'en', 'es');
        await jest.advanceTimersByTimeAsync(999);
        expect(microsoftTranslate).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        await expect(second).resolves.toBe('translated:second');

        resolveFirst('translated:first');
        await expect(first).resolves.toBe('translated:first');
    });

    test('retries a transient provider failure', async () => {
        jest.useFakeTimers();
        microsoftTranslate
            .mockRejectedValueOnce(new TypeError('network unavailable'))
            .mockResolvedValue('hola');
        const service = await loadService();

        const result = service.translate('retry-once', 'en', 'es');
        await jest.runAllTimersAsync();

        await expect(result).resolves.toBe('hola');
        expect(microsoftTranslate).toHaveBeenCalledTimes(2);
    });

    test('stops after two retries', async () => {
        jest.useFakeTimers();
        microsoftTranslate.mockRejectedValue(
            new TypeError('network unavailable')
        );
        const service = await loadService();

        const result = service.translate('retry-limit', 'en', 'es');
        const rejection = expect(result).rejects.toThrow();
        await jest.runAllTimersAsync();
        await rejection;

        expect(microsoftTranslate).toHaveBeenCalledTimes(3);
    });

    test('rejects an in-flight result after credential rotation', async () => {
        const secret = 'PRIVATE_ROTATED_CREDENTIAL';
        let resolveTranslation;
        microsoftTranslate.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveTranslation = resolve;
                })
        );
        const service = await loadService();

        const stale = service.translate('credential-change', 'en', 'es');
        await new Promise((resolve) => setTimeout(resolve, 0));
        configListener({ openaiCompatibleApiKey: secret });
        resolveTranslation('stale');

        await expect(stale).rejects.toThrow(/configuration changed/i);
        expect(
            JSON.stringify(loggerMocks.map((mock) => mock.mock.calls))
        ).not.toContain(secret);

        microsoftTranslate.mockResolvedValue('fresh');
        await expect(
            service.translate('credential-change', 'en', 'es')
        ).resolves.toBe('fresh');
        expect(microsoftTranslate).toHaveBeenCalledTimes(2);
    });

    test('enforces the provider character window', async () => {
        jest.useFakeTimers();
        microsoftTranslate.mockResolvedValue('ok');
        const service = await loadService();

        await expect(
            service.translate('x'.repeat(33_300), 'en', 'es')
        ).resolves.toBe('ok');
        const limited = service.translate('x', 'en', 'es');
        const rejection = expect(limited).rejects.toThrow(/rate limit/i);
        await jest.runAllTimersAsync();
        await rejection;

        expect(microsoftTranslate).toHaveBeenCalledTimes(1);
    });
});
