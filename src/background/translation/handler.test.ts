import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    TEST_EXTENSION_ID,
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { MessageRouter } from '@/messaging/router';
import { MAX_TRANSLATION_RETRY_AFTER_MS } from '@/messaging/contracts/translate';
import { markServiceReady } from '../readiness';
import {
    describeTranslationFailure,
    registerTranslationHandler,
} from './handler';
import { TranslationProviderError } from './providerError';
import { RateLimitExhaustedError } from './rateLimiter';
import {
    TranslationConfigurationChangedError,
    type TranslationOutcome,
} from './service';

const contentSender = {
    id: TEST_EXTENSION_ID,
    url: 'https://www.netflix.com/watch/81234567',
    documentId: 'doc-1',
    documentLifecycle: 'active',
    frameId: 0,
    tab: {
        id: 12,
        windowId: 3,
        active: true,
        url: 'https://www.netflix.com/watch/81234567',
    },
};

const sidepanelSender = {
    id: TEST_EXTENSION_ID,
    url: `${TEST_EXTENSION_ORIGIN}/sidepanel.html`,
};

const request = {
    action: 'translate',
    text: 'Hello there',
    targetLang: 'zh-CN',
    cueStart: 12.5,
    cueVideoId: '81234567',
};

function setup(translate: (text: string) => Promise<TranslationOutcome>) {
    const router = new MessageRouter();
    const service = { translate: vi.fn((text: string) => translate(text)) };
    registerTranslationHandler(router, service);
    return { router, service };
}

beforeAll(() => {
    installExtensionRuntimeIdentity();
});

describe('translate handler', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('parks a request until the translation service is ready', async () => {
        const { router, service } = setup(() =>
            Promise.resolve({ translatedText: '你好', cached: false })
        );
        let settled = false;
        const response = router.dispatch(request, contentSender);
        expect(response).toBeDefined();
        void response?.then(() => {
            settled = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);
        expect(service.translate).not.toHaveBeenCalled();

        markServiceReady('translation');
        await expect(response).resolves.toEqual({
            success: true,
            translatedText: '你好',
            cached: false,
            processingTime: 0,
        });
        expect(service.translate).toHaveBeenCalledWith(
            'Hello there',
            'auto',
            'zh-CN'
        );
    });

    it('reports cache hits and elapsed time', async () => {
        vi.setSystemTime(1000);
        const { router } = setup(async () => {
            vi.setSystemTime(1250);
            return Promise.resolve({ translatedText: '你好', cached: true });
        });
        await expect(router.dispatch(request, contentSender)).resolves.toEqual({
            success: true,
            translatedText: '你好',
            cached: true,
            processingTime: 250,
        });
    });

    it('clamps processing time to zero when the clock goes backwards', async () => {
        vi.setSystemTime(1000);
        const { router } = setup(async () => {
            vi.setSystemTime(500);
            return Promise.resolve({ translatedText: '你好', cached: false });
        });
        const response = (await router.dispatch(request, contentSender)) as {
            processingTime: number;
        };
        expect(response.processingTime).toBe(0);
    });

    it('answers a service failure with the retry hints only', async () => {
        vi.setSystemTime(10_000);
        const { router } = setup(() =>
            Promise.reject(new RateLimitExhaustedError(11_234))
        );
        await expect(router.dispatch(request, contentSender)).resolves.toEqual({
            success: false,
            retryable: true,
            retryAfter: 1234,
        });
    });

    it('never answers a sender outside the contract', () => {
        const { router, service } = setup(() =>
            Promise.resolve({ translatedText: '你好', cached: false })
        );
        expect(router.dispatch(request, sidepanelSender)).toBeUndefined();
        expect(service.translate).not.toHaveBeenCalled();
    });
});

describe('describeTranslationFailure', () => {
    const now = 50_000;

    it('marks provider failures by their own retry stance without a delay', () => {
        expect(
            describeTranslationFailure(
                new TranslationProviderError('google', 'x', {
                    code: 'AUTHENTICATION_ERROR',
                }),
                now
            )
        ).toEqual({ retryable: false, retryAfter: null });
        expect(
            describeTranslationFailure(
                new TranslationProviderError('google', 'x', {
                    code: 'UPSTREAM_ERROR',
                }),
                now
            )
        ).toEqual({ retryable: true, retryAfter: null });
    });

    it('derives retryAfter from a local reset time', () => {
        expect(
            describeTranslationFailure(
                new RateLimitExhaustedError(now + 2500),
                now
            )
        ).toEqual({ retryable: true, retryAfter: 2500 });
        expect(
            describeTranslationFailure(new RateLimitExhaustedError(null), now)
        ).toEqual({ retryable: true, retryAfter: null });
    });

    it('drops reset times in the past or beyond the cap', () => {
        expect(
            describeTranslationFailure(
                new RateLimitExhaustedError(now - 1),
                now
            )
        ).toEqual({ retryable: true, retryAfter: null });
        expect(
            describeTranslationFailure(
                new RateLimitExhaustedError(
                    now + MAX_TRANSLATION_RETRY_AFTER_MS + 1
                ),
                now
            )
        ).toEqual({ retryable: true, retryAfter: null });
        expect(
            describeTranslationFailure(
                new RateLimitExhaustedError(
                    now + MAX_TRANSLATION_RETRY_AFTER_MS
                ),
                now
            )
        ).toEqual({
            retryable: true,
            retryAfter: MAX_TRANSLATION_RETRY_AFTER_MS,
        });
    });

    it('treats a configuration change as retryable and anything else as final', () => {
        expect(
            describeTranslationFailure(
                new TranslationConfigurationChangedError(),
                now
            )
        ).toEqual({ retryable: true, retryAfter: null });
        expect(describeTranslationFailure(new Error('boom'), now)).toEqual({
            retryable: false,
            retryAfter: null,
        });
        expect(describeTranslationFailure('string', now)).toEqual({
            retryable: false,
            retryAfter: null,
        });
    });
});
