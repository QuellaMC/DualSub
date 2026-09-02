// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { browser, type Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { installExtensionRuntimeIdentity } from '@/test-utils/extensionRuntime';
import { resetCatalogsForTests } from '../hooks/useI18n';
import { POPUP_SETTINGS_KEYS, PopupApp } from './PopupApp';

const EN = readFileSync(resolve('public/_locales/en/messages.json'), 'utf8');

function stubEnglishCatalog(): void {
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL) =>
            Promise.resolve(
                String(input).endsWith('/_locales/en/messages.json')
                    ? new Response(EN, { status: 200 })
                    : new Response('', { status: 404 })
            )
        )
    );
}

function stubTabs() {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
        { id: 7 } as unknown as Browser.tabs.Tab,
    ] as never);
    return vi
        .spyOn(browser.tabs, 'sendMessage')
        .mockResolvedValue({ success: true } as never);
}

function previewsSent(
    send: ReturnType<typeof stubTabs>
): Record<string, unknown>[] {
    return send.mock.calls.map(
        (call) => (call[1] as { changes: Record<string, unknown> }).changes
    );
}

async function renderReady() {
    render(<PopupApp />);
    const enable = await screen.findByRole('checkbox', {
        name: 'Enable Dual Subtitles:',
    });
    return { enable };
}

beforeAll(() => {
    installExtensionRuntimeIdentity();
});

beforeEach(async () => {
    resetCatalogsForTests();
    stubEnglishCatalog();
    await fakeBrowser.storage.sync.clear();
    await fakeBrowser.storage.local.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('PopupApp', () => {
    it('renders the stored settings', async () => {
        await fakeBrowser.storage.sync.set({
            subtitlesEnabled: false,
            targetLanguage: 'ja',
            subtitleFontSize: 2,
        });
        await fakeBrowser.storage.local.set({ appearanceAccordionOpen: true });
        stubTabs();
        const { enable } = await renderReady();

        expect(enable).not.toBeChecked();
        expect(
            screen.getByRole('checkbox', { name: 'Use Official Subtitles:' })
        ).toBeChecked();
        expect(
            screen.getByRole('combobox', { name: 'Translate to:' })
        ).toHaveValue('ja');
        expect(screen.getByRole('slider', { name: 'Font Size:' })).toHaveValue(
            '2'
        );
        expect(POPUP_SETTINGS_KEYS).toHaveLength(12);
    });

    it('saves a toggle and shows its status', async () => {
        stubTabs();
        const { enable } = await renderReady();
        fireEvent.click(enable);

        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'Dual Subtitles Disabled. (Refresh Page)'
            )
        );
        expect(await fakeBrowser.storage.sync.get('subtitlesEnabled')).toEqual({
            subtitlesEnabled: false,
        });
        expect(enable).not.toBeChecked();
    });

    it('saves a language choice with a localized status', async () => {
        stubTabs();
        await renderReady();
        fireEvent.change(
            screen.getByRole('combobox', { name: 'Translate to:' }),
            {
                target: { value: 'ja' },
            }
        );

        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'Language Set (Refresh Page): Japanese'
            )
        );
        expect(await fakeBrowser.storage.sync.get('targetLanguage')).toEqual({
            targetLanguage: 'ja',
        });
    });

    it('previews slider movement on the active tab and persists on release', async () => {
        await fakeBrowser.storage.local.set({ appearanceAccordionOpen: true });
        const send = stubTabs();
        await renderReady();
        const slider = screen.getByRole('slider', { name: 'Font Size:' });

        fireEvent.change(slider, { target: { value: '1.5' } });
        await waitFor(() =>
            expect(previewsSent(send)).toEqual([{ subtitleFontSize: 1.5 }])
        );
        expect(await fakeBrowser.storage.sync.get('subtitleFontSize')).toEqual(
            {}
        );

        fireEvent.pointerUp(slider);
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'Font size: 1.5vw.'
            )
        );
        expect(await fakeBrowser.storage.sync.get('subtitleFontSize')).toEqual({
            subtitleFontSize: 1.5,
        });
    });

    it('rolls the page back to the persisted value when a slider commit fails', async () => {
        await fakeBrowser.storage.local.set({ appearanceAccordionOpen: true });
        const send = stubTabs();
        await renderReady();
        vi.spyOn(browser.storage.sync, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        const slider = screen.getByRole('slider', { name: 'Font Size:' });

        fireEvent.change(slider, { target: { value: '1.5' } });
        fireEvent.pointerUp(slider);
        await waitFor(
            () =>
                expect(screen.getByRole('status')).toHaveTextContent(
                    'Failed to save setting. Please try again.'
                ),
            { timeout: 2500 }
        );
        await waitFor(
            () =>
                expect(previewsSent(send)).toEqual([
                    { subtitleFontSize: 1.5 },
                    { subtitleFontSize: 1.1 },
                ]),
            { timeout: 2500 }
        );
        expect(slider).toHaveValue('1.1');
    });

    it('validates the time offset before saving it', async () => {
        await fakeBrowser.storage.local.set({ appearanceAccordionOpen: true });
        stubTabs();
        await renderReady();
        const offset = screen.getByRole('spinbutton', {
            name: 'Time Offset(s):',
        });

        fireEvent.change(offset, { target: { value: 'abc' } });
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'Invalid offset, reverting.'
            )
        );

        fireEvent.change(offset, { target: { value: '1.256' } });
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent(
                'Time offset: 1.26s.'
            )
        );
        expect(
            await fakeBrowser.storage.sync.get('subtitleTimeOffset')
        ).toEqual({ subtitleTimeOffset: 1.26 });
    });

    it('blocks the controls when settings cannot be read', async () => {
        stubTabs();
        vi.spyOn(browser.storage.sync, 'get').mockRejectedValueOnce(
            new Error('storage broken')
        );
        render(<PopupApp />);

        const alert = await screen.findByRole('alert');
        await waitFor(() =>
            expect(alert).toHaveTextContent('Failed to load settings')
        );
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('opens the options page and the repository from the header', async () => {
        stubTabs();
        const openOptions = vi
            .spyOn(browser.runtime, 'openOptionsPage')
            .mockResolvedValue(undefined);
        const create = vi
            .spyOn(browser.tabs, 'create')
            .mockResolvedValue({} as never);
        await renderReady();

        fireEvent.click(screen.getByTitle('Open Advanced Settings'));
        fireEvent.click(screen.getByTitle('View on GitHub'));
        expect(openOptions).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith({
            url: 'https://github.com/QuellaMC/DualSub',
        });
    });
});
