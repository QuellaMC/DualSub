import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
    TEST_EXTENSION_ID,
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { MessageRouter } from '@/messaging/router';
import { markServiceReady } from '../readiness';
import { registerLookupHandler } from './handler';

const sidepanelSender = {
    id: TEST_EXTENSION_ID,
    url: `${TEST_EXTENSION_ORIGIN}/sidepanel.html`,
};

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

const request = {
    action: 'lookupWords',
    text: 'a cántaros',
    language: 'es',
    targetLanguage: 'en',
};

beforeAll(() => {
    installExtensionRuntimeIdentity();
    markServiceReady('translation');
});

describe('lookupWords handler', () => {
    it('looks up what the side panel asks for', async () => {
        const router = new MessageRouter();
        const lookup = vi.fn(() =>
            Promise.resolve({
                translation: 'in buckets',
                entries: [],
                source: null,
            })
        );
        registerLookupHandler(router, { lookup });
        await expect(
            router.dispatch(request, sidepanelSender)
        ).resolves.toEqual({
            translation: 'in buckets',
            entries: [],
            source: null,
        });
        expect(lookup).toHaveBeenCalledWith('a cántaros', 'es', 'en');
    });

    it('never looks up for a page', async () => {
        const router = new MessageRouter();
        const lookup = vi.fn();
        registerLookupHandler(router, { lookup });
        await router.dispatch(request, contentSender);
        expect(lookup).not.toHaveBeenCalled();
    });
});
