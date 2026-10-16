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

    it("claims no browser language when the browser's are all ones DualSub lacks", async () => {
        vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['nl-NL']);
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('nl-NL');
        await renderReady();
        expect(screen.queryByText('From your browser')).not.toBeInTheDocument();
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

    it('moves the subtitles one step per press, however quick the presses', async () => {
        location.hash = '#timing';
        await renderReady();
        const earlier = screen.getByRole('button', { name: /Show earlier/ });
        fireEvent.click(earlier);
        fireEvent.click(earlier);
        expect(await screen.findByText('1.0 s earlier')).toBeInTheDocument();
        await waitFor(async () =>
            expect(await sync('subtitleTimeOffset')).toBe(1)
        );
    });

    it("shows a site's scope only where a site keeps settings of its own", async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
        });
        location.hash = '#look';
        await renderReady();
        fireEvent.click(
            within(
                screen.getByRole('group', { name: 'Settings for' })
            ).getByRole('button', { name: /^Netflix/ })
        );
        expect(
            await screen.findByText("You're changing Netflix only.")
        ).toBeInTheDocument();

        nav('Help');
        await screen.findByRole('heading', { level: 1, name: 'Help' });
        expect(
            screen.queryByText("You're changing Netflix only.")
        ).not.toBeInTheDocument();

        nav('How subtitles look');
        expect(
            await screen.findByText("You're changing Netflix only.")
        ).toBeInTheDocument();
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
        // The button waits for the key to be saved.
        const turnOn = await screen.findByRole('button', { name: 'Turn on' });
        await waitFor(() => expect(turnOn).toBeEnabled());
        fireEvent.click(turnOn);
        await waitFor(async () =>
            expect(await sync('aiContextEnabled')).toBe(true)
        );
        expect(
            await fakeBrowser.storage.local.get([
                'openaiApiKey',
                'openaiApiKeyOrigin',
            ])
        ).toEqual({
            openaiApiKey: 'AIza-key',
            openaiApiKeyOrigin: 'https://api.openai.com',
        });
    });

    it('resets everything but keys, and the reset can be undone', async () => {
        await fakeBrowser.storage.sync.set({
            subtitleFontScale: 2,
            uiLanguage: 'en',
            siteProfiles: { netflix: { subtitleGap: 0.5 } },
        });
        await fakeBrowser.storage.sync.set({
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
            openaiCompatibleModel: 'house-model',
            openaiBaseUrl: 'https://explain.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            deeplApiKey: 'keep-me',
            openaiCompatibleApiKey: 'keep-me-too',
            openaiCompatibleApiKeyOrigin: 'https://llm.example.com',
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
        // A kept key keeps its origin and the address and model it was set
        // up with; an address with no key goes back to the recommended one.
        expect(
            (
                await fakeBrowser.storage.local.get(
                    'openaiCompatibleApiKeyOrigin'
                )
            ).openaiCompatibleApiKeyOrigin
        ).toBe('https://llm.example.com');
        expect(await sync('openaiCompatibleBaseUrl')).toBe(
            'https://llm.example.com/v1'
        );
        expect(await sync('openaiCompatibleModel')).toBe('house-model');
        expect(await sync('openaiBaseUrl')).toBe('https://api.openai.com/v1');

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
        expect(
            screen.getByRole('button', {
                name: 'Fine-tune size, height and spacing',
            })
        ).toHaveAttribute('aria-expanded', 'true');

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

    it('lands on the menu language picker from search', async () => {
        await renderReady();
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'menu language' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: /^Language of DualSub's menus/ })
        );
        await waitFor(() =>
            expect(document.getElementById('ui-language')).toHaveFocus()
        );
    });

    it('lands on the choice that shows a searched setting, then on the setting', async () => {
        await renderReady();
        const search = screen.getByRole('searchbox');
        const openResult = (words: string, name: RegExp): void => {
            fireEvent.change(search, { target: { value: words } });
            fireEvent.click(screen.getByRole('button', { name }));
        };
        openResult('deepl', /^Set up DeepL/);
        await waitFor(() =>
            expect(screen.getByRole('radio', { name: /^DeepL/ })).toHaveFocus()
        );

        fireEvent.click(screen.getByRole('radio', { name: /^DeepL/ }));
        await waitFor(async () =>
            expect(await sync('selectedProvider')).toBe('deepl')
        );
        openResult('deepl', /^Set up DeepL/);
        await waitFor(() =>
            expect(document.getElementById('deepl-card')).toContainElement(
                document.activeElement as HTMLElement
            )
        );
    });

    it('opens the custom look from search, or lands on the choice that shows it', async () => {
        await fakeBrowser.storage.sync.set({ subtitleStyle: 'platform' });
        await renderReady();
        const search = screen.getByRole('searchbox');
        const openResult = (): void => {
            fireEvent.change(search, { target: { value: 'font' } });
            fireEvent.click(
                screen.getByRole('button', {
                    name: /^Change colors and font\s*How subtitles look/,
                })
            );
        };
        openResult();
        const ownLook = await screen.findByRole('button', {
            name: /^My own style/,
        });
        await waitFor(() => expect(ownLook).toHaveFocus());

        fireEvent.click(ownLook);
        await waitFor(async () =>
            expect(await sync('subtitleStyle')).toBe('custom')
        );
        openResult();
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Change colors and font' })
            ).toHaveAttribute('aria-expanded', 'true')
        );
        expect(screen.getByLabelText('Font')).toBeInTheDocument();
    });

    it('leaves an advanced section when advanced options go off elsewhere', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        expect(
            screen.getByRole('heading', { level: 1, name: 'Advanced' })
        ).toBeInTheDocument();

        await fakeBrowser.storage.local.set({ showAdvancedSettings: false });
        expect(
            await screen.findByRole('heading', {
                level: 1,
                name: 'Hello! DualSub is ready.',
            })
        ).toBeInTheDocument();
        await waitFor(() => expect(location.hash).toBe('#start'));
    });

    it('uses a key only with the service it was entered for', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'openai_compatible',
            openaiCompatibleBaseUrl:
                'https://generativelanguage.googleapis.com/v1beta/openai',
        });
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: 'AIza-google-key',
            openaiCompatibleApiKeyOrigin:
                'https://generativelanguage.googleapis.com',
        });
        location.hash = '#translation';
        await renderReady();
        const key = screen.getByLabelText('Paste it here');
        expect(key).toHaveValue('AIza-google-key');

        fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
        await waitFor(() => expect(key).toHaveValue(''));
        expect(
            await screen.findByText('Please enter your API key first.')
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Google Gemini' }));
        await waitFor(() => expect(key).toHaveValue('AIza-google-key'));

        fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
        await waitFor(() => expect(key).toHaveValue(''));
        fireEvent.change(key, { target: { value: 'sk-openai' } });
        await waitFor(async () =>
            expect(
                await fakeBrowser.storage.local.get([
                    'openaiCompatibleApiKey',
                    'openaiCompatibleApiKeyOrigin',
                ])
            ).toEqual({
                openaiCompatibleApiKey: 'sk-openai',
                openaiCompatibleApiKeyOrigin: 'https://api.openai.com',
            })
        );
    });

    it('treats a key as missing once another computer moves its address', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'openai_compatible',
            openaiCompatibleBaseUrl: 'https://api.openai.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: 'sk-openai',
            openaiCompatibleApiKeyOrigin: 'https://api.openai.com',
        });
        await renderReady();
        expect(
            screen.queryByText("AI translation isn't set up yet")
        ).not.toBeInTheDocument();

        await fakeBrowser.storage.sync.set({
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
        });
        expect(
            await screen.findByText("AI translation isn't set up yet")
        ).toBeInTheDocument();
        nav('Translation');
        expect(screen.getByLabelText('Paste it here')).toHaveValue('');
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

    it("keeps the page and focus while a site's settings load, then shows that site's", async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
        });
        location.hash = '#look';
        await renderReady();
        const extraLarge = () =>
            screen.queryByRole('button', { name: /Extra large$/ });
        expect(extraLarge()).toHaveAttribute('aria-pressed', 'false');

        const netflix = within(
            screen.getByRole('group', { name: 'Settings for' })
        ).getByRole('button', { name: /^Netflix/ });
        netflix.focus();
        fireEvent.click(netflix);
        expect(extraLarge()).toBeNull();
        await waitFor(() =>
            expect(extraLarge()).toHaveAttribute('aria-pressed', 'true')
        );
        expect(netflix).toHaveFocus();
    });

    it('fixes doubled subtitles everywhere and gives each site its value back on Undo', async () => {
        await fakeBrowser.storage.sync.set({
            hideOfficialSubtitles: true,
            siteProfiles: { netflix: { hideOfficialSubtitles: false } },
        });
        location.hash = '#help';
        await renderReady();
        const set = vi.spyOn(fakeBrowser.storage.sync, 'set');
        fireEvent.click(screen.getByRole('button', { name: 'Fix it for me' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({})
        );
        expect(await sync('hideOfficialSubtitles')).toBe(true);
        expect(set).toHaveBeenCalledOnce();

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

    it("keeps a change made elsewhere when a site's change is undone", async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleFontScale: 1 } },
        });
        location.hash = '#sites';
        await renderReady();
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Edit the Netflix settings',
            })
        );
        await screen.findByText("You're changing Netflix only.");
        fireEvent.click(screen.getByRole('button', { name: /Large$/ }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleFontScale: 1.3 },
            })
        );
        await fakeBrowser.storage.sync.set({
            siteProfiles: {
                netflix: { subtitleFontScale: 1.3, subtitleGap: 0.5 },
                disneyplus: { subtitlesEnabled: false },
            },
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleFontScale: 1, subtitleGap: 0.5 },
                disneyplus: { subtitlesEnabled: false },
            })
        );
    });

    it("puts a site's profiles back exactly on Undo, an own value equal to the shared one included", async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleFontScale: 1 } },
        });
        location.hash = '#sites';
        await renderReady();
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Edit the Netflix settings',
            })
        );
        await screen.findByText("You're changing Netflix only.");
        fireEvent.click(screen.getByRole('button', { name: /Large$/ }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleFontScale: 1.3 },
            })
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleFontScale: 1 },
            })
        );
    });

    it('says when the chosen service still needs setting up and nothing covers', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'deepl',
            translationFallback: false,
        });
        await renderReady();
        expect(screen.getByText("DeepL isn't set up yet")).toBeInTheDocument();
        expect(
            screen.getByText("Until it is, subtitles aren't translated.")
        ).toBeInTheDocument();
        expect(screen.queryByText('DualSub is ready')).not.toBeInTheDocument();
    });

    it('says who translates while the chosen service still needs setting up', async () => {
        await fakeBrowser.storage.sync.set({ selectedProvider: 'deepl' });
        await renderReady();
        expect(screen.getByText('DualSub is ready')).toBeInTheDocument();
        expect(
            screen.getByText('Until it is, Microsoft Translator translates.')
        ).toBeInTheDocument();
    });

    it("hides or shows the sites' own subtitles on every site at once", async () => {
        location.hash = '#sites';
        await renderReady();
        const everywhere = await screen.findByRole('switch', {
            name: "Hide the site's own subtitles",
        });
        expect(everywhere).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(everywhere);
        await waitFor(async () =>
            expect(await sync('hideOfficialSubtitles')).toBe(false)
        );
        expect(
            await screen.findByText("Sites' own subtitles: shown")
        ).toBeInTheDocument();
    });

    it("counts a site's switches among its own settings, and removes them too", async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitlesEnabled: false } },
        });
        location.hash = '#sites';
        await renderReady();
        expect(
            await screen.findByText('Has its own settings')
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove them' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({})
        );
    });

    it('keeps the token expiry and key origins out of the settings JSON along with the keys', async () => {
        await fakeBrowser.storage.local.set({
            showAdvancedSettings: true,
            vertexTokenExpiresAt: 123,
            openaiApiKeyOrigin: 'https://api.openai.com',
        });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        const json = document.querySelector('pre.code');
        expect(json).not.toHaveTextContent('vertexTokenExpiresAt');
        expect(json).not.toHaveTextContent('ApiKeyOrigin');
    });

    it('leaves a key behind when a loaded backup moves its address', async () => {
        await fakeBrowser.storage.local.set({
            showAdvancedSettings: true,
            openaiApiKey: 'sk-openai',
            openaiApiKeyOrigin: 'https://api.openai.com',
        });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        const backup = new File(
            [
                JSON.stringify({
                    openaiBaseUrl: 'https://proxy.example.com/v1',
                    openaiApiKeyOrigin: 'https://proxy.example.com',
                }),
            ],
            'backup.json',
            { type: 'application/json' }
        );
        fireEvent.change(screen.getByLabelText('Load settings from a file'), {
            target: { files: [backup] },
        });
        expect(
            await screen.findByText('Settings that will change: 1.')
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Replace them' }));
        await waitFor(async () =>
            expect(await sync('openaiBaseUrl')).toBe(
                'https://proxy.example.com/v1'
            )
        );
        expect(
            (await fakeBrowser.storage.local.get('openaiApiKeyOrigin'))
                .openaiApiKeyOrigin
        ).toBe('https://api.openai.com');
        nav('Word explanations');
        await waitFor(() =>
            expect(screen.getByLabelText('Paste it here')).toHaveValue('')
        );
    });

    it('puts everything back when a backup can only be loaded in part', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        const backup = new File(
            [
                JSON.stringify({
                    subtitleFontScale: 1.6,
                    showAdvancedSettings: false,
                }),
            ],
            'backup.json',
            { type: 'application/json' }
        );
        fireEvent.change(screen.getByLabelText('Load settings from a file'), {
            target: { files: [backup] },
        });
        const replace = await screen.findByRole('button', {
            name: 'Replace them',
        });
        vi.spyOn(browser.storage.local, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        fireEvent.click(replace);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
        expect(await sync('subtitleFontScale')).toBe(1);
    });

    it('applies the whole backup, counting what changes as the settings change', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        const backup = new File(
            [JSON.stringify({ subtitleFontScale: 1.6, subtitleGap: 0.3 })],
            'backup.json',
            { type: 'application/json' }
        );
        fireEvent.change(screen.getByLabelText('Load settings from a file'), {
            target: { files: [backup] },
        });
        expect(
            await screen.findByText('Settings that will change: 1.')
        ).toBeInTheDocument();

        // Another page changes a setting the backup holds.
        await fakeBrowser.storage.sync.set({ subtitleGap: 0.5 });
        expect(
            await screen.findByText('Settings that will change: 2.')
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Replace them' }));
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1.6)
        );
        expect(await sync('subtitleGap')).toBe(0.3);
    });

    it('refuses a backup holding a value this version cannot use', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        const backup = new File(
            [JSON.stringify({ subtitleFontScale: 1.6, subtitleGap: 99 })],
            'backup.json',
            { type: 'application/json' }
        );
        fireEvent.change(screen.getByLabelText('Load settings from a file'), {
            target: { files: [backup] },
        });
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "That file can't be loaded"
        );
        expect(
            screen.queryByRole('button', { name: 'Replace them' })
        ).not.toBeInTheDocument();
        expect(await sync('subtitleFontScale')).toBeUndefined();
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
