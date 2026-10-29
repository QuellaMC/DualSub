import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
    TEST_EXTENSION_ID,
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { MessageRouter } from '@/messaging/router';
import { markServiceReady } from '../readiness';
import { registerAiContextHandler } from './handler';
import { answerSample } from './schemas.test';
import type { AnalysisOutcome, AnalysisRequest } from './service';

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

const REQUEST = {
    action: 'analyzeContext',
    text: 'a cántaros',
    line: 'Está lloviendo a cántaros, no salgas.',
    language: 'es',
    contextTypes: ['cultural'],
    targetLanguage: 'en',
};

function setup(
    analyze: (request: AnalysisRequest) => Promise<AnalysisOutcome> = () =>
        Promise.resolve({
            success: true,
            answer: answerSample(),
            cached: false,
        })
) {
    const router = new MessageRouter();
    const service = { analyze: vi.fn(analyze) };
    registerAiContextHandler(router, service);
    return { router, service };
}

beforeAll(() => {
    installExtensionRuntimeIdentity();
    markServiceReady('aiContextInitialized');
});

describe('analyzeContext handler', () => {
    it('explains the picked words in their line for the side panel', async () => {
        const { router, service } = setup();
        await expect(
            router.dispatch(REQUEST, sidepanelSender)
        ).resolves.toEqual({ success: true, answer: answerSample() });
        expect(service.analyze).toHaveBeenCalledWith({
            text: 'a cántaros',
            line: 'Está lloviendo a cántaros, no salgas.',
            kinds: ['cultural'],
            sourceLanguage: 'es',
            targetLanguage: 'en',
        });
    });

    it('leaves an unknown language for the model to tell, and asks for no kinds', async () => {
        const { router, service } = setup();
        await router.dispatch(
            { ...REQUEST, language: null, contextTypes: [] },
            sidepanelSender
        );
        expect(service.analyze).toHaveBeenCalledWith(
            expect.objectContaining({ sourceLanguage: 'auto', kinds: [] })
        );
    });

    it('passes on why there is no answer', async () => {
        const { router } = setup(() =>
            Promise.resolve({ success: false, reason: 'setup' })
        );
        await expect(
            router.dispatch(REQUEST, sidepanelSender)
        ).resolves.toEqual({ success: false, reason: 'setup' });
    });

    it('never explains for a page, or without the line', async () => {
        const { router, service } = setup();
        await router.dispatch(REQUEST, contentSender);
        const { line: _line, ...lineless } = REQUEST;
        await router.dispatch(lineless, sidepanelSender);
        await router.dispatch(
            { ...REQUEST, contextTypes: ['cultural', 'cultural'] },
            sidepanelSender
        );
        expect(service.analyze).not.toHaveBeenCalled();
    });
});
