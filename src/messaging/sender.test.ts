import { describe, expect, it } from 'vitest';
import { classifyExtensionMessageSender } from './sender';

const EXTENSION_ID = 'abcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;

const runtime = {
    id: EXTENSION_ID,
    getManifest: () => ({
        background: { service_worker: 'background.js' },
        options_ui: { page: 'options.html' },
        action: { default_popup: 'popup.html' },
        side_panel: { default_path: 'sidepanel.html' },
    }),
    getURL: (path: string) => `${ORIGIN}/${path}`,
};

function contentSender(overrides: Record<string, unknown> = {}) {
    return {
        id: EXTENSION_ID,
        url: 'https://www.netflix.com/watch/81234567',
        origin: 'https://www.netflix.com',
        documentId: 'doc-1',
        documentLifecycle: 'active',
        frameId: 0,
        tab: {
            id: 12,
            windowId: 3,
            active: true,
            url: 'https://www.netflix.com/watch/81234567',
        },
        ...overrides,
    };
}

describe('classifyExtensionMessageSender', () => {
    it('classifies a live top-frame Netflix content sender', () => {
        const classified = classifyExtensionMessageSender(
            contentSender(),
            runtime
        );
        expect(classified).toEqual({
            role: 'content',
            platform: 'netflix',
            tabId: 12,
            windowId: 3,
            documentId: 'doc-1',
            documentLifecycle: 'active',
            origin: 'https://www.netflix.com',
            senderUrl: 'https://www.netflix.com/watch/81234567',
            tabUrl: 'https://www.netflix.com/watch/81234567',
            frameId: 0,
        });
    });

    it('classifies Disney+ content senders by hostname', () => {
        const classified = classifyExtensionMessageSender(
            contentSender({
                url: 'https://www.disneyplus.com/play/abc',
                origin: 'https://www.disneyplus.com',
                tab: {
                    id: 5,
                    windowId: 1,
                    active: true,
                    url: 'https://www.disneyplus.com/play/abc',
                },
            }),
            runtime
        );
        expect(classified?.role).toBe('content');
        expect(
            classified?.role === 'content' ? classified.platform : null
        ).toBe('disneyplus');
    });

    it('classifies extension page roles by exact URL', () => {
        for (const [page, role] of [
            ['background.js', 'background'],
            ['popup.html', 'popup'],
            ['sidepanel.html', 'sidepanel'],
        ] as const) {
            expect(
                classifyExtensionMessageSender(
                    { id: EXTENSION_ID, url: `${ORIGIN}/${page}` },
                    runtime
                )
            ).toEqual({ role });
        }
    });

    it('accepts the options page in its own tab only', () => {
        const base = { id: EXTENSION_ID, url: `${ORIGIN}/options.html` };
        expect(
            classifyExtensionMessageSender(
                { ...base, tab: { url: `${ORIGIN}/options.html` } },
                runtime
            )
        ).toEqual({ role: 'options' });
        expect(
            classifyExtensionMessageSender(
                { ...base, tab: { url: 'https://evil.example/' } },
                runtime
            )
        ).toBeNull();
    });

    it('rejects extension pages that carry a tab record (except options)', () => {
        expect(
            classifyExtensionMessageSender(
                {
                    id: EXTENSION_ID,
                    url: `${ORIGIN}/popup.html`,
                    tab: { id: 1 },
                },
                runtime
            )
        ).toBeNull();
    });

    it.each([
        ['wrong extension id', { id: 'other-extension' }],
        ['subframe', { frameId: 1 }],
        ['prerendering document', { documentLifecycle: 'prerender' }],
        ['missing documentId', { documentId: '' }],
        ['http page', { url: 'http://www.netflix.com/watch/1' }],
        ['explicit port', { url: 'https://www.netflix.com:8443/watch/1' }],
        ['trailing-dot hostname', { url: 'https://www.netflix.com./watch/1' }],
        ['unsupported host', { url: 'https://www.netflix.com.evil.dev/w' }],
        [
            'inactive tab',
            {
                tab: {
                    id: 12,
                    windowId: 3,
                    active: false,
                    url: 'https://www.netflix.com/watch/81234567',
                },
            },
        ],
        [
            'sender/tab platform mismatch',
            {
                tab: {
                    id: 12,
                    windowId: 3,
                    active: true,
                    url: 'https://www.disneyplus.com/play/abc',
                },
            },
        ],
        [
            'sender/tab origin mismatch',
            {
                tab: {
                    id: 12,
                    windowId: 3,
                    active: true,
                    url: 'https://help.netflix.com/watch/81234567',
                },
            },
        ],
        [
            'origin field disagreeing with url',
            { origin: 'https://evil.example' },
        ],
        ['unsafe tab id', { tab: { id: 1.5, windowId: 3, active: true } }],
    ])('rejects a content sender with %s', (_label, overrides) => {
        expect(
            classifyExtensionMessageSender(contentSender(overrides), runtime)
        ).toBeNull();
    });

    it('fails closed on throwing property traps', () => {
        const trapped = new Proxy(contentSender(), {
            getOwnPropertyDescriptor(target, key) {
                if (key === 'tab') {
                    throw new Error('trap');
                }
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
        expect(classifyExtensionMessageSender(trapped, runtime)).toBeNull();
    });

    it('fails closed when runtime endpoints are unavailable', () => {
        expect(
            classifyExtensionMessageSender(contentSender(), {
                id: '',
                getManifest: runtime.getManifest,
                getURL: runtime.getURL,
            })
        ).toBeNull();
        expect(
            classifyExtensionMessageSender(contentSender(), {
                id: EXTENSION_ID,
                getManifest: () => ({}),
                getURL: runtime.getURL,
            })
        ).toBeNull();
    });

    it('never treats accessor properties as data', () => {
        const sender = contentSender();
        Object.defineProperty(sender, 'url', {
            get: () => 'https://www.netflix.com/watch/81234567',
        });
        expect(classifyExtensionMessageSender(sender, runtime)).toBeNull();
    });
});
