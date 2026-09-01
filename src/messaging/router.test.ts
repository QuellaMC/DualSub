import { beforeAll, describe, expect, it } from 'vitest';
import {
    TEST_EXTENSION_ID,
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { MessageRouter, readEnvelopeAction } from './router';
import { translate } from './contracts/translate';
import { analyzeContext } from './contracts/analyzeContext';
import { sidePanelSelectionSync } from './contracts/selection';

const EXTENSION_ID = TEST_EXTENSION_ID;
const ORIGIN = TEST_EXTENSION_ORIGIN;

beforeAll(() => {
    installExtensionRuntimeIdentity();
});

const contentSender = {
    id: EXTENSION_ID,
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

const sidepanelSender = { id: EXTENSION_ID, url: `${ORIGIN}/sidepanel.html` };
const popupSender = { id: EXTENSION_ID, url: `${ORIGIN}/popup.html` };

const validTranslate = {
    action: 'translate',
    text: 'Hello there',
    targetLang: 'zh-CN',
    cueStart: 12.5,
    cueVideoId: '81234567',
};

function createRouter() {
    const router = new MessageRouter();
    router.handle(translate, (request) => ({
        success: true as const,
        translatedText: `[zh] ${request.text}`,
        cached: false,
        processingTime: 5,
    }));
    return router;
}

describe('readEnvelopeAction', () => {
    it('accepts a catalog action carried as an own enumerable string', () => {
        expect(readEnvelopeAction(validTranslate)).toBe('translate');
    });

    it.each([
        ['null', null],
        ['array', ['translate']],
        ['class instance', new Date()],
        ['unknown action', { action: 'notARealAction' }],
        ['non-string action', { action: 42 }],
        ['no keys', {}],
        [
            'too many keys',
            Object.fromEntries(
                Array.from({ length: 33 }, (_, i) => [`k${i}`, i])
            ),
        ],
    ])('rejects %s', (_label, message) => {
        expect(readEnvelopeAction(message)).toBeNull();
    });

    it('rejects non-enumerable and accessor action properties', () => {
        const hidden = {};
        Object.defineProperty(hidden, 'action', {
            value: 'translate',
            enumerable: false,
        });
        expect(readEnvelopeAction(hidden)).toBeNull();

        const trapped = {};
        Object.defineProperty(trapped, 'action', {
            enumerable: true,
            get: () => 'translate',
        });
        expect(readEnvelopeAction(trapped)).toBeNull();
    });
});

describe('MessageRouter.dispatch', () => {
    it('round-trips a valid request from an authorized sender', async () => {
        const response = await createRouter().dispatch(
            validTranslate,
            contentSender
        );
        expect(response).toEqual({
            success: true,
            translatedText: '[zh] Hello there',
            cached: false,
            processingTime: 5,
        });
    });

    it('ignores unregistered actions and malformed envelopes', () => {
        const router = createRouter();
        expect(router.dispatch({ action: 'fetchVTT' }, contentSender)).toBe(
            undefined
        );
        expect(router.dispatch('translate', contentSender)).toBe(undefined);
    });

    it('rejects unauthorized sender roles', () => {
        expect(createRouter().dispatch(validTranslate, popupSender)).toBe(
            undefined
        );
        expect(createRouter().dispatch(validTranslate, {})).toBe(undefined);
    });

    it('rejects extra keys, missing keys, and wrong value shapes', () => {
        const router = createRouter();
        expect(
            router.dispatch(
                { ...validTranslate, extra: 'field' },
                contentSender
            )
        ).toBe(undefined);
        expect(
            router.dispatch({ ...validTranslate, cueStart: -1 }, contentSender)
        ).toBe(undefined);
        expect(
            router.dispatch(
                { ...validTranslate, targetLang: ' zh-CN ' },
                contentSender
            )
        ).toBe(undefined);
        expect(router.dispatch({ action: 'translate' }, contentSender)).toBe(
            undefined
        );
    });

    it('applies the contract snapshot budget before parsing', () => {
        const router = new MessageRouter();
        router.handle(sidePanelSelectionSync, () => ({ success: true }));
        const oversized = {
            action: 'sidePanelSelectionSync',
            data: {
                lifecycleGeneration: 1,
                selectionRevision: 1,
                renderRevision: 1,
                reason: 'toggle',
                entries: [{ wordIndex: 0, word: 'x'.repeat(5000) }],
            },
        };
        expect(router.dispatch(oversized, contentSender)).toBe(undefined);
    });

    it('selects the request variant by classified role', async () => {
        const router = new MessageRouter();
        router.handle(analyzeContext, (request) => ({
            success: true as const,
            result: {
                analysis: { summary: 'ok' },
                contextType: 'cultural' as const,
                contextTypes: request.contextTypes,
                isStructured: true as const,
            },
        }));

        const sidepanelRequest = {
            action: 'analyzeContext',
            text: 'word',
            contextTypes: ['cultural'],
            contextType: 'cultural',
            targetLanguage: 'zh-CN',
            requestId: 'req-1',
        };
        await expect(
            router.dispatch(sidepanelRequest, sidepanelSender)
        ).resolves.toMatchObject({ success: true });

        // The content variant requires language+platform and rejects the
        // side-panel shape.
        expect(router.dispatch(sidepanelRequest, contentSender)).toBe(
            undefined
        );
    });

    it('enforces the side-panel contextType consistency rule', () => {
        const router = new MessageRouter();
        router.handle(analyzeContext, () => {
            throw new Error('unreachable');
        });
        expect(
            router.dispatch(
                {
                    action: 'analyzeContext',
                    text: 'word',
                    contextTypes: ['cultural', 'historical'],
                    contextType: 'cultural',
                    targetLanguage: 'zh-CN',
                    requestId: 'req-1',
                },
                sidepanelSender
            )
        ).toBe(undefined);
    });

    it('turns handler failures and malformed handler responses into no-response', async () => {
        const throwing = new MessageRouter();
        throwing.handle(translate, () => {
            throw new Error('handler bug');
        });
        await expect(
            throwing.dispatch(validTranslate, contentSender)
        ).resolves.toBe(undefined);

        const malformed = new MessageRouter();
        malformed.handle(translate, () => ({ nonsense: true }) as never);
        await expect(
            malformed.dispatch(validTranslate, contentSender)
        ).resolves.toBe(undefined);
    });

    it('refuses duplicate registrations for one action', () => {
        const router = createRouter();
        expect(() => router.handle(translate, () => ({}) as never)).toThrow(
            'already registered'
        );
    });
});
