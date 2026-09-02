// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
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
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { loadCatalog, resetCatalogsForTests, useI18n } from './useI18n';

const EN = JSON.parse(
    readFileSync(resolve('public/_locales/en/messages.json'), 'utf8')
) as Record<string, { message: string }>;

type Catalogs = Record<string, Record<string, { message: string }>>;

function catalogUrl(folder: string): string {
    return `${TEST_EXTENSION_ORIGIN}/_locales/${folder}/messages.json`;
}

/** Serves catalogs by locale folder; unknown folders get a 404. */
function stubFetch(available: Catalogs): string[] {
    const calls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL) => {
            const url = String(input);
            calls.push(url);
            const folder = /_locales\/([^/]+)\/messages\.json$/.exec(url)?.[1];
            const body = folder ? available[folder] : undefined;
            return Promise.resolve(
                body
                    ? new Response(JSON.stringify(body), { status: 200 })
                    : new Response('', { status: 404 })
            );
        })
    );
    return calls;
}

beforeAll(() => {
    installExtensionRuntimeIdentity();
});

beforeEach(() => {
    resetCatalogsForTests();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('useI18n', () => {
    it('loads the requested catalog from the extension bundle', async () => {
        const calls = stubFetch({
            en: EN,
            ja: { h1Title: { message: 'デュアルサブ' } },
        });
        const { result } = renderHook(() => useI18n('ja'));
        expect(result.current.ready).toBe(false);
        expect(result.current.t('h1Title')).toBe('h1Title');

        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.t('h1Title')).toBe('デュアルサブ');
        expect(calls).toEqual([catalogUrl('ja')]);
    });

    it('maps a hyphenated locale to its folder and falls back to English', async () => {
        const calls = stubFetch({ en: EN });
        const { result } = renderHook(() => useI18n('zh-TW'));
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.t('h1Title')).toBe('DualSub');
        expect(calls).toEqual([catalogUrl('zh_TW'), catalogUrl('en')]);
    });

    it('substitutes %s and %d placeholders in order', async () => {
        stubFetch({ en: { greet: { message: 'Hi %s, %d new, %s' } } });
        const { result } = renderHook(() => useI18n('en'));
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.t('greet', 'Ann', 3)).toBe('Hi Ann, 3 new, %s');
        expect(result.current.t('missing')).toBe('missing');
    });

    it('keeps the latest locale when an older request resolves later', async () => {
        const pending = new Map<string, (body: unknown) => void>();
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (input: string | URL) =>
                    new Promise<Response>((resolve) => {
                        const folder = /_locales\/([^/]+)\//.exec(
                            String(input)
                        )![1]!;
                        pending.set(folder, (body) =>
                            resolve(
                                new Response(JSON.stringify(body), {
                                    status: 200,
                                })
                            )
                        );
                    })
            )
        );
        const { result, rerender } = renderHook(
            ({ locale }: { locale: string }) => useI18n(locale),
            { initialProps: { locale: 'ja' } }
        );
        rerender({ locale: 'ko' });

        pending.get('ko')!({ h1Title: { message: 'KO' } });
        await waitFor(() => expect(result.current.ready).toBe(true));
        pending.get('ja')!({ h1Title: { message: 'JA' } });
        await Promise.resolve();
        expect(result.current.t('h1Title')).toBe('KO');
    });

    it('does not remember a failed locale, so a later load retries it', async () => {
        const available: Catalogs = { en: EN };
        const calls = stubFetch(available);
        expect((await loadCatalog('ja')).h1Title?.message).toBe('DualSub');

        available.ja = { h1Title: { message: 'デュアルサブ' } };
        expect((await loadCatalog('ja')).h1Title?.message).toBe('デュアルサブ');
        expect(calls).toEqual([
            catalogUrl('ja'),
            catalogUrl('en'),
            catalogUrl('ja'),
        ]);
        expect((await loadCatalog('en')).h1Title?.message).toBe('DualSub');
        expect(calls).toHaveLength(3);
    });
});
