import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
    TEST_EXTENSION_ID,
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { MessageRouter } from '@/messaging/router';
import { markServiceReady } from '../readiness';
import {
    ANALYZE_CONTEXT_REJECTED_ERROR,
    registerAiContextHandler,
} from './handler';
import { culturalSample } from './schemas.test';
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

function contentRequest(contextTypes: readonly string[]) {
    return {
        action: 'analyzeContext',
        text: 'hola amigo',
        contextTypes,
        language: 'es',
        targetLanguage: 'en',
        platform: 'netflix',
        requestId: 'r1',
    };
}

function setup(
    analyze: (request: AnalysisRequest) => Promise<AnalysisOutcome>
) {
    const router = new MessageRouter();
    const service = { analyze: vi.fn(analyze) };
    registerAiContextHandler(router, service);
    return { router, service };
}

const success = (request: AnalysisRequest): Promise<AnalysisOutcome> =>
    Promise.resolve({
        success: true,
        analysis: { definition: `${request.type}:${request.text}` },
        cached: false,
    });

beforeAll(() => {
    installExtensionRuntimeIdentity();
    markServiceReady('aiContextInitialized');
});

describe('analyzeContext handler', () => {
    it('analyzes one requested type verbatim with the content language', async () => {
        const { router, service } = setup(success);
        const response = await router.dispatch(
            contentRequest(['linguistic']),
            contentSender
        );
        expect(response).toEqual({
            success: true,
            result: {
                analysis: { definition: 'linguistic:hola amigo' },
                contextType: 'linguistic',
                contextTypes: ['linguistic'],
                isStructured: true,
            },
        });
        expect(service.analyze).toHaveBeenCalledWith({
            text: 'hola amigo',
            type: 'linguistic',
            sourceLanguage: 'es',
            targetLanguage: 'en',
        });
    });

    it('collapses the full type set into one combined analysis', async () => {
        const { router, service } = setup(success);
        const response = await router.dispatch(
            contentRequest(['historical', 'cultural', 'linguistic']),
            contentSender
        );
        expect(response).toMatchObject({
            success: true,
            result: { contextType: 'all' },
        });
        expect(service.analyze).toHaveBeenCalledTimes(1);
        expect(service.analyze.mock.calls[0]![0].type).toBe('all');
    });

    it('merges a two-type subset from two provider calls', async () => {
        const sample = culturalSample();
        const { router, service } = setup((request) =>
            Promise.resolve({
                success: true,
                analysis:
                    request.type === 'cultural'
                        ? sample
                        : { definition: 'other', examples: ['x'] },
                cached: false,
            })
        );
        const response = (await router.dispatch(
            {
                action: 'analyzeContext',
                text: 'hola',
                contextTypes: ['cultural', 'historical'],
                targetLanguage: 'en',
                requestId: 'r2',
            },
            sidepanelSender
        )) as { result: { analysis: Record<string, unknown> } };
        expect(service.analyze).toHaveBeenCalledTimes(2);
        expect(service.analyze.mock.calls[0]![0].sourceLanguage).toBe('auto');
        expect(response).toMatchObject({
            success: true,
            result: { contextType: 'combined' },
        });
        expect(response.result.analysis.definition).toBe('A greeting');
        expect(response.result.analysis.historical_analysis).toEqual({
            examples: ['x'],
        });
    });

    it('stops a subset at the first failure and relays the reason', async () => {
        const { router, service } = setup((request) =>
            Promise.resolve(
                request.type === 'cultural'
                    ? {
                          success: false,
                          error: 'Rate limited',
                          shouldRetry: false,
                      }
                    : { success: true, analysis: {}, cached: false }
            )
        );
        const response = await router.dispatch(
            contentRequest(['cultural', 'linguistic']),
            contentSender
        );
        expect(response).toEqual({
            success: false,
            error: 'Rate limited',
            shouldRetry: false,
        });
        expect(service.analyze).toHaveBeenCalledTimes(1);
    });

    it('rejects a content request that claims another platform', async () => {
        const { router, service } = setup(success);
        const response = await router.dispatch(
            { ...contentRequest(['cultural']), platform: 'disneyplus' },
            contentSender
        );
        expect(response).toEqual({
            success: false,
            error: ANALYZE_CONTEXT_REJECTED_ERROR,
            shouldRetry: false,
        });
        expect(service.analyze).not.toHaveBeenCalled();
    });

    it('ignores requests from unclassified senders', async () => {
        const { router, service } = setup(success);
        expect(
            await router.dispatch(contentRequest(['cultural']), {
                id: 'someone-else',
                url: 'https://www.netflix.com/watch/1',
            })
        ).toBeUndefined();
        expect(service.analyze).not.toHaveBeenCalled();
    });
});
