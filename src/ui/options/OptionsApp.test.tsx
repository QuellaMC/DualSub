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
    within,
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
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { installExtensionRuntimeIdentity } from '@/test-utils/extensionRuntime';
import { resetCatalogsForTests } from '../hooks/useI18n';
import { OptionsApp } from './OptionsApp';

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

async function renderReady() {
    render(<OptionsApp />);
    return screen.findByRole('heading', { level: 1 });
}

function nav(name: string): void {
    fireEvent.click(
        within(screen.getByRole('navigation')).getByRole('link', { name })
    );
}

async function sync(key: string): Promise<unknown> {
    return (await fakeBrowser.storage.sync.get(key))[key];
}

beforeAll(() => {
    installExtensionRuntimeIdentity();
});

beforeEach(async () => {
    resetCatalogsForTests();
    stubEnglishCatalog();
    location.hash = '';
    await fakeBrowser.storage.sync.clear();
    await fakeBrowser.storage.local.clear();
    await fakeBrowser.storage.session.clear();
    vi.spyOn(browser.permissions, 'contains').mockResolvedValue(false as never);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('OptionsApp', () => {
    it('opens on Start, ready to use, with the browser’s language picked', async () => {
        const title = await renderReady();
        expect(title).toHaveTextContent('Hello! DualSub is ready.');
        expect(screen.getByText('DualSub is ready')).toBeInTheDocument();
        expect(screen.getByText('From your browser')).toBeInTheDocument();
        expect(
            screen.getByRole('switch', { name: 'Dual subtitles' })
        ).toHaveAttribute('aria-checked', 'true');
        expect(
            screen.getByRole('heading', { name: 'Live preview' })
        ).toBeInTheDocument();
    });

    it('saves a choice, says so, and undoes it on request', async () => {
        await renderReady();
        fireEvent.click(screen.getByRole('button', { name: /Large$/ }));
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1.3)
        );
        const toast = await screen.findByText('Text size: Large');
        fireEvent.click(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        );
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1)
        );
    });

    it('moves the subtitles earlier and later in plain words', async () => {
        location.hash = '#timing';
        await renderReady();
        fireEvent.click(screen.getByRole('button', { name: /Show earlier/ }));
        expect(await screen.findByText('0.5 s earlier')).toBeInTheDocument();
        expect(await sync('subtitleTimeOffset')).toBe(0.5);

        fireEvent.click(
            screen.getByRole('button', { name: 'Back to on time' })
        );
        await waitFor(async () =>
            expect(await sync('subtitleTimeOffset')).toBe(0)
        );
    });

    it('finds a setting by what people call it', async () => {
        await renderReady();
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'twice' },
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: /Hide the site's own subtitles/,
            })
        );
        expect(
            await screen.findByRole('heading', { level: 1, name: 'Sites' })
        ).toBeInTheDocument();
    });

    it('keeps credentials available to the setup cards', async () => {
        await fakeBrowser.storage.sync.set({ selectedProvider: 'deepl' });
        await fakeBrowser.storage.local.set({ deeplApiKey: 'secret' });
        await renderReady();
        nav('Translation');
        expect(screen.getByLabelText('Paste it here')).toHaveValue('secret');
    });

    it('names a failing service and who covers for it', async () => {
        await fakeBrowser.storage.sync.set({ selectedProvider: 'deepl' });
        await fakeBrowser.storage.session.set({
            translationHealth: {
                provider: 'deepl',
                problem: 'quota',
                fallback: 'microsoft_edge',
                since: 1,
            },
        });
        location.hash = '#translation';
        await renderReady();
        expect(
            await screen.findByText(/DeepL is not working\./)
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Microsoft Translator is translating meanwhile/)
        ).toBeInTheDocument();
    });

    it('lets a site keep its own value, marks it, and lets it follow all sites again', async () => {
        await renderReady();
        fireEvent.click(
            screen.getByRole('switch', { name: 'Show advanced options' })
        );
        nav('Sites');
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Give Netflix its own settings',
            })
        );
        expect(
            await screen.findByText("You're changing Netflix only.")
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Extra large$/ }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleFontScale: 1.6 },
            })
        );
        expect(await sync('subtitleFontScale')).toBeUndefined();
        expect(await screen.findAllByText('Netflix only')).not.toHaveLength(0);

        fireEvent.click(
            screen.getAllByRole('button', {
                name: 'Use the value for all sites',
            })[0]!
        );
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({})
        );
    });

    it('turns word explanations on only once a key is in', async () => {
        location.hash = '#explanations';
        await renderReady();
        const enable = screen.getByRole('switch', {
            name: 'Word explanations',
        });
        expect(enable).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Paste it here'), {
            target: { value: 'AIza-key' },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
        await waitFor(async () =>
            expect(await sync('aiContextEnabled')).toBe(true)
        );
        expect(
            (await fakeBrowser.storage.local.get('openaiApiKey')).openaiApiKey
        ).toBe('AIza-key');
    });

    it('resets everything but keys, and the reset can be undone', async () => {
        await fakeBrowser.storage.sync.set({
            subtitleFontScale: 2,
            uiLanguage: 'en',
            siteProfiles: { netflix: { subtitleGap: 0.5 } },
        });
        await fakeBrowser.storage.local.set({
            deeplApiKey: 'keep-me',
            showAdvancedSettings: true,
        });
        location.hash = '#advanced';
        await renderReady();
        fireEvent.click(
            screen.getByRole('button', { name: 'Reset everything…' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1)
        );
        expect(await sync('siteProfiles')).toEqual({});
        expect(
            (await fakeBrowser.storage.local.get('deeplApiKey')).deeplApiKey
        ).toBe('keep-me');

        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(2)
        );
        expect(await sync('siteProfiles')).toEqual({
            netflix: { subtitleGap: 0.5 },
        });
    });

    it('shows the stored settings as JSON, without keys', async () => {
        await fakeBrowser.storage.local.set({
            deeplApiKey: 'never-shown',
            showAdvancedSettings: true,
        });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        expect(document.querySelector('pre.code')).not.toHaveTextContent(
            'never-shown'
        );
    });

    it('shows a banner when a save fails and keeps the controls usable', async () => {
        await renderReady();
        vi.spyOn(browser.storage.sync, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        fireEvent.click(screen.getByRole('button', { name: /Small$/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
        fireEvent.click(screen.getByRole('button', { name: /Medium$/ }));
        await waitFor(() =>
            expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        );
    });

    it('puts focus on the section a button opens', async () => {
        await renderReady();
        fireEvent.click(screen.getAllByRole('button', { name: 'Change' })[0]!);
        await waitFor(() =>
            expect(
                screen.getByRole('heading', { level: 1, name: 'Languages' })
            ).toHaveFocus()
        );
    });

    it('opens a folded or advanced setting from search and focuses it', async () => {
        await renderReady();
        const search = screen.getByRole('searchbox');
        fireEvent.change(search, { target: { value: 'spacing' } });
        fireEvent.click(screen.getByRole('button', { name: /^Fine-tune/ }));
        await waitFor(() =>
            expect(
                screen.getByRole('button', {
                    name: 'Fine-tune size, height and spacing',
                })
            ).toHaveFocus()
        );

        fireEvent.change(search, { target: { value: 'pause between' } });
        fireEvent.click(
            screen.getByRole('button', {
                name: /^Pause between translation requests/,
            })
        );
        await waitFor(() =>
            expect(
                screen.getByLabelText(/^Pause between translation requests/)
            ).toHaveFocus()
        );
        expect(
            (await fakeBrowser.storage.local.get('showAdvancedSettings'))
                .showAdvancedSettings
        ).toBe(true);
    });

    it('undoes the last change with Ctrl+Z outside text fields', async () => {
        await renderReady();
        fireEvent.click(screen.getByRole('button', { name: /Large$/ }));
        await screen.findByText('Text size: Large');
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1)
        );
        expect(screen.queryByText('Text size: Large')).not.toBeInTheDocument();
    });

    it('shows the banner when an Undo cannot be saved', async () => {
        await renderReady();
        fireEvent.click(screen.getByRole('button', { name: /Large$/ }));
        const toast = await screen.findByText('Text size: Large');
        vi.spyOn(browser.storage.sync, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        fireEvent.click(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
    });

    it('asks before a reset in place and hands focus back after', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        const reset = screen.getByRole('button', {
            name: 'Reset everything…',
        });
        fireEvent.click(reset);
        const cancel = await screen.findByRole('button', { name: 'Cancel' });
        await waitFor(() => expect(cancel).toHaveFocus());
        expect(
            screen.getByRole('group', { name: /Put every setting back/ })
        ).toBeInTheDocument();
        fireEvent.click(cancel);
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Reset everything…' })
            ).toHaveFocus()
        );
    });

    it('writes an edit to the site it was made for when the scope changes before the write', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        await renderReady();
        nav('Sites');
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Give Netflix its own settings',
            })
        );
        await screen.findByText("You're changing Netflix only.");
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Fine-tune size, height and spacing',
            })
        );
        fireEvent.change(screen.getByLabelText(/^Exact text size/), {
            target: { value: '1.45' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Back to all sites' })
        );
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleFontScale: 1.45 },
            })
        );
        expect(await sync('subtitleFontScale')).toBeUndefined();
    });

    it('fixes doubled subtitles everywhere and gives each site its value back on Undo', async () => {
        await fakeBrowser.storage.sync.set({
            hideOfficialSubtitles: true,
            siteProfiles: { netflix: { hideOfficialSubtitles: false } },
        });
        location.hash = '#help';
        await renderReady();
        fireEvent.click(screen.getByRole('button', { name: 'Fix it for me' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({})
        );
        expect(await sync('hideOfficialSubtitles')).toBe(true);

        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { hideOfficialSubtitles: false },
            })
        );
        expect(await sync('hideOfficialSubtitles')).toBe(true);
    });

    it('shows no untranslated text while its catalog loads', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise<Response>(() => undefined))
        );
        render(<OptionsApp />);
        await waitFor(() =>
            expect(
                document.querySelector('main[aria-busy="true"]')
            ).toBeInTheDocument()
        );
        expect(document.body).not.toHaveTextContent('commonLoading');
    });

    it('blocks the page when settings cannot be read', async () => {
        vi.spyOn(browser.storage.sync, 'get').mockRejectedValue(
            new Error('broken')
        );
        render(<OptionsApp />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to load settings'
        );
    });
});
