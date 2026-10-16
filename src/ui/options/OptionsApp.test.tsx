// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    act,
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
import { configService } from '@/config/service';
import { installExtensionRuntimeIdentity } from '@/test-utils/extensionRuntime';
import { installPermissionEvents } from '@/test-utils/permissionEvents';
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

let permissionsChanged: ReturnType<typeof installPermissionEvents>;

beforeAll(() => {
    installExtensionRuntimeIdentity();
    permissionsChanged = installPermissionEvents();
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

    it('leaves a setting changed in another tab since alone when undoing', async () => {
        await renderReady();
        fireEvent.click(screen.getByRole('button', { name: /Large$/ }));
        const toast = await screen.findByText('Text size: Large');
        await fakeBrowser.storage.sync.set({ subtitleFontScale: 2 });
        fireEvent.click(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        );
        await waitFor(() =>
            expect(
                screen.queryByText('Text size: Large')
            ).not.toBeInTheDocument()
        );
        expect(await sync('subtitleFontScale')).toBe(2);
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

    it('moves the subtitles from an exact shift typed but not yet entered', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#timing';
        await renderReady();
        fireEvent.change(screen.getByLabelText(/^Exact shift/), {
            target: { value: '2' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Show earlier/ }));
        await waitFor(async () =>
            expect(await sync('subtitleTimeOffset')).toBe(2.5)
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

    it('goes back on time even right after quick presses', async () => {
        location.hash = '#timing';
        await renderReady();
        const earlier = screen.getByRole('button', { name: /Show earlier/ });
        fireEvent.click(earlier);
        fireEvent.click(earlier);
        fireEvent.click(
            screen.getByRole('button', { name: 'Back to on time' })
        );
        await waitFor(async () =>
            expect(await sync('subtitleTimeOffset')).toBe(0)
        );
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(await sync('subtitleTimeOffset')).toBe(0);
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

    it('keeps a site value given back in another tab when following all sites is undone', async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
        });
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#sites';
        await renderReady();
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Edit the Netflix settings',
            })
        );
        fireEvent.click(
            (
                await screen.findAllByRole('button', {
                    name: 'Use the value for all sites',
                })
            )[0]!
        );
        const toast = await screen.findByText(
            'Back to the value for all sites'
        );
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({})
        );
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleFontScale: 2 } },
        });
        fireEvent.click(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        );
        await waitFor(() =>
            expect(
                screen.queryByText('Back to the value for all sites')
            ).not.toBeInTheDocument()
        );
        expect(await sync('siteProfiles')).toEqual({
            netflix: { subtitleFontScale: 2 },
        });
    });

    it('asks for access to a custom explanation address before turning explanations on', async () => {
        await fakeBrowser.storage.sync.set({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'https://llm.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiApiKey: 'sk-key',
            openaiApiKeyOrigin: 'https://llm.example.com',
        });
        location.hash = '#explanations';
        await renderReady();
        const allow = await screen.findByRole('button', {
            name: 'Allow API host',
        });
        expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();

        vi.spyOn(browser.permissions, 'request').mockResolvedValue(
            true as never
        );
        vi.mocked(browser.permissions.contains).mockResolvedValue(
            true as never
        );
        fireEvent.click(allow);
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Turn on' })
            ).toBeEnabled()
        );
    });

    it('names each host access control by its own address', async () => {
        await fakeBrowser.storage.sync.set({
            aiContextProvider: 'openai',
            openaiBaseUrl: 'https://explain.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            showAdvancedSettings: true,
            openaiApiKey: 'sk-key',
            openaiApiKeyOrigin: 'https://explain.example.com',
        });
        location.hash = '#explanations';
        await renderReady();
        const controls = await waitFor(() => {
            const found = [
                ...document.querySelectorAll<HTMLElement>(
                    '.api-host-permission'
                ),
            ];
            expect(found).toHaveLength(2);
            return found;
        });
        const labels = controls.map((control) =>
            control.getAttribute('aria-labelledby')
        );
        expect(new Set(labels).size).toBe(2);
        controls.forEach((control, index) =>
            expect(
                control.querySelector(`[id="${labels[index]}"]`)
            ).not.toBeNull()
        );
    });

    it('keeps explanations off while no kind of explanation is chosen', async () => {
        await fakeBrowser.storage.sync.set({
            aiContextProvider: 'gemini',
            aiContextTypes: [],
        });
        await fakeBrowser.storage.local.set({ geminiApiKey: 'AIza-key' });
        location.hash = '#explanations';
        await renderReady();
        expect(
            await screen.findByText('Pick at least one thing to explain.')
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    });

    it('clears two kinds of explanation clicked one right after the other', async () => {
        await fakeBrowser.storage.sync.set({
            aiContextTypes: ['linguistic', 'cultural', 'historical'],
        });
        location.hash = '#explanations';
        await renderReady();
        const kinds = screen.getByRole('group', { name: 'What to explain' });
        fireEvent.click(
            within(kinds).getByRole('checkbox', {
                name: 'The culture behind it',
            })
        );
        fireEvent.click(
            within(kinds).getByRole('checkbox', { name: 'History and origin' })
        );
        await waitFor(async () =>
            expect(await sync('aiContextTypes')).toEqual(['linguistic'])
        );
    });

    it('removes two filters clicked one right after the other', async () => {
        await fakeBrowser.storage.sync.set({
            subtitleBlacklist: {
                disneyplus: ['--forced--', 'forced=yes'],
                netflix: [],
                generic: [],
            },
        });
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#sites';
        await renderReady();
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Remove the rule --forced--',
            })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Remove the rule forced=yes' })
        );
        await waitFor(async () =>
            expect(await sync('subtitleBlacklist')).toEqual({
                disneyplus: [],
                netflix: [],
                generic: [],
            })
        );
    });

    it('undoes a filter removal without losing a rule added elsewhere since', async () => {
        await fakeBrowser.storage.sync.set({
            subtitleBlacklist: {
                disneyplus: ['--forced--', 'forced=yes'],
                netflix: [],
                generic: [],
            },
        });
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#sites';
        await renderReady();
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Remove the rule --forced--',
            })
        );
        const toast = await screen.findByText(
            'Tracks matching “--forced--” are used again'
        );
        await fakeBrowser.storage.sync.set({
            subtitleBlacklist: {
                disneyplus: ['forced=yes', 'sdh'],
                netflix: [],
                generic: [],
            },
        });
        fireEvent.click(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        );
        await waitFor(async () =>
            expect(await sync('subtitleBlacklist')).toEqual({
                disneyplus: ['forced=yes', 'sdh', '--forced--'],
                netflix: [],
                generic: [],
            })
        );
    });

    it("says so on a site's card when that site's settings cannot be read", async () => {
        const read = configService.readMultipleResultStrict.bind(configService);
        vi.spyOn(configService, 'readMultipleResultStrict').mockImplementation(
            (keys, options) =>
                options?.site === 'netflix'
                    ? Promise.reject(new Error('broken'))
                    : read(keys, options)
        );
        location.hash = '#sites';
        await renderReady();
        const card = (
            await screen.findByRole('heading', { name: 'Netflix' })
        ).closest('.card');
        expect(
            within(card as HTMLElement).getByRole('alert')
        ).toHaveTextContent('Failed to load settings');
        expect(
            screen.getByRole('heading', { name: 'Disney+' })
        ).toBeInTheDocument();
    });

    it("says so on Start when a site's on/off state cannot be read", async () => {
        const read = configService.readMultipleResultStrict.bind(configService);
        vi.spyOn(configService, 'readMultipleResultStrict').mockImplementation(
            (keys, options) =>
                options?.site === 'netflix' && keys.length === 1
                    ? Promise.reject(new Error('broken'))
                    : read(keys, options)
        );
        await renderReady();
        expect(
            await screen.findByText("Netflix: couldn't read")
        ).toBeInTheDocument();
        expect(screen.getByText('Disney+: on')).toBeInTheDocument();
    });

    it('says so on the card for every site when its settings cannot be read', async () => {
        const read = configService.readMultipleResultStrict.bind(configService);
        vi.spyOn(configService, 'readMultipleResultStrict').mockImplementation(
            (keys, options) =>
                options?.site === undefined &&
                keys.length === 2 &&
                keys.includes('hideOfficialSubtitles')
                    ? Promise.reject(new Error('broken'))
                    : read(keys, options)
        );
        location.hash = '#sites';
        await renderReady();
        const card = (
            await screen.findByRole('heading', {
                name: "Hide the site's own subtitles",
            })
        ).closest('.card');
        expect(
            within(card as HTMLElement).getByRole('alert')
        ).toHaveTextContent('Failed to load settings');
    });

    it('keeps the export in step with every change, even while storage cannot be read', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        const download = screen.getByRole('button', {
            name: 'Download settings',
        });
        await waitFor(() => expect(download).toBeEnabled());

        vi.spyOn(browser.storage.sync, 'get').mockRejectedValue(
            new Error('broken')
        );
        await fakeBrowser.storage.sync.set({ subtitleGap: 0.5 });
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleGap": 0.5'
            )
        );
        expect(download).toBeEnabled();
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

    it('keeps a site change made elsewhere when a reset is undone', async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleGap: 0.5 } },
        });
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        fireEvent.click(
            screen.getByRole('button', { name: 'Reset everything…' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({})
        );
        await fakeBrowser.storage.sync.set({
            siteProfiles: { disneyplus: { subtitlesEnabled: false } },
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleGap: 0.5 },
                disneyplus: { subtitlesEnabled: false },
            })
        );
    });

    it('keeps the setup of a key that lands while a reset waits its turn', async () => {
        await fakeBrowser.storage.sync.set({
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
        });
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        // A change still being written holds the reset back in the queue.
        const realSet = fakeBrowser.storage.sync.set.bind(
            fakeBrowser.storage.sync
        );
        const held = Promise.withResolvers<void>();
        vi.spyOn(fakeBrowser.storage.sync, 'set').mockImplementationOnce(
            (items: Record<string, unknown>) =>
                held.promise.then(() => realSet(items)) as never
        );
        fireEvent.change(
            screen.getByLabelText('Detail in the browser console'),
            {
                target: { value: '1' },
            }
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Reset everything…' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: 'sk-key',
            openaiCompatibleApiKeyOrigin: 'https://llm.example.com',
        });
        held.resolve();

        expect(
            await screen.findByText(
                'Everything is back to the recommended settings'
            )
        ).toBeInTheDocument();
        expect(await sync('openaiCompatibleBaseUrl')).toBe(
            'https://llm.example.com/v1'
        );
    });

    it('undoes a backup load whole or not at all, and offers Undo again after a failure', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        // The backup changes a setting in each storage area.
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
        fireEvent.click(
            await screen.findByRole('button', { name: 'Replace them' })
        );
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1.6)
        );

        vi.spyOn(browser.storage.local, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
        expect(await sync('subtitleFontScale')).toBe(1.6);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1)
        );
        expect(
            (await fakeBrowser.storage.local.get('showAdvancedSettings'))
                .showAdvancedSettings
        ).toBe(true);
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

    it('stays where the viewer went while an advanced search result waits for its setting', async () => {
        await renderReady();
        const realSet = fakeBrowser.storage.local.set.bind(
            fakeBrowser.storage.local
        );
        const held = Promise.withResolvers<void>();
        vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementationOnce(
            (items: Record<string, unknown>) =>
                held.promise.then(() => realSet(items)) as never
        );
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'pause between' },
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: /^Pause between translation requests/,
            })
        );
        nav('Help');
        held.resolve();
        await waitFor(async () =>
            expect(
                (await fakeBrowser.storage.local.get('showAdvancedSettings'))
                    .showAdvancedSettings
            ).toBe(true)
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
            'Help'
        );
    });

    it('opens the newest of two advanced search results picked while advanced options turn on', async () => {
        await renderReady();
        const realSet = fakeBrowser.storage.local.set.bind(
            fakeBrowser.storage.local
        );
        const held = Promise.withResolvers<void>();
        vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementationOnce(
            (items: Record<string, unknown>) =>
                held.promise.then(() => realSet(items)) as never
        );
        const search = (query: string, result: RegExp): void => {
            fireEvent.change(screen.getByRole('searchbox'), {
                target: { value: query },
            });
            fireEvent.click(screen.getByRole('button', { name: result }));
        };
        search('pause between', /^Pause between translation requests/);
        search('backup', /^Backup/);
        held.resolve();
        await waitFor(() =>
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
                'Advanced'
            )
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
            'Advanced'
        );
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

    it('stays on Start when advanced options go off and come back on', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        const heading = (): HTMLElement =>
            screen.getByRole('heading', { level: 1 });
        expect(heading()).toHaveTextContent('Advanced');
        const advanced = screen.getByRole('switch', {
            name: 'Show advanced options',
        });

        fireEvent.click(advanced);
        await waitFor(() =>
            expect(heading()).toHaveTextContent('Hello! DualSub is ready.')
        );
        fireEvent.click(advanced);
        await waitFor(async () =>
            expect(
                (await fakeBrowser.storage.local.get('showAdvancedSettings'))
                    .showAdvancedSettings
            ).toBe(true)
        );
        expect(heading()).toHaveTextContent('Hello! DualSub is ready.');
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

    it('enters a key for the address shown when it was typed, while a new one is still being saved', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#explanations';
        await renderReady();
        const stored = Promise.withResolvers<void>();
        const write = browser.storage.sync.set.bind(browser.storage.sync);
        vi.spyOn(browser.storage.sync, 'set').mockImplementationOnce(
            (items: Record<string, unknown>) =>
                stored.promise.then(() => write(items)) as never
        );
        const address = screen.getByLabelText('Service address');
        fireEvent.change(address, {
            target: { value: 'https://llm.example.com/v1' },
        });
        fireEvent.blur(address);
        fireEvent.change(screen.getByLabelText('Paste it here'), {
            target: { value: 'sk-openai' },
        });
        stored.resolve();
        await waitFor(async () =>
            expect(await sync('openaiBaseUrl')).toBe(
                'https://llm.example.com/v1'
            )
        );
        await waitFor(async () =>
            expect(
                await fakeBrowser.storage.local.get([
                    'openaiApiKey',
                    'openaiApiKeyOrigin',
                ])
            ).toEqual({
                openaiApiKey: 'sk-openai',
                openaiApiKeyOrigin: 'https://api.openai.com',
            })
        );
        await waitFor(() =>
            expect(screen.getByLabelText('Paste it here')).toHaveValue('')
        );
    });

    it('enters a key for the address shown when it was typed, whatever is stored meanwhile', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#explanations';
        await renderReady();
        const release = Promise.withResolvers<void>();
        // The entry waits its turn while another page or computer moves the
        // address.
        const elsewhere = navigator.locks.request(
            'dualsub:settingParts',
            () => release.promise
        );
        fireEvent.change(screen.getByLabelText('Paste it here'), {
            target: { value: 'sk-openai' },
        });
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'https://elsewhere.example.com/v1',
        });
        release.resolve();
        await elsewhere;
        await waitFor(async () =>
            expect(
                await fakeBrowser.storage.local.get([
                    'openaiApiKey',
                    'openaiApiKeyOrigin',
                ])
            ).toEqual({
                openaiApiKey: 'sk-openai',
                openaiApiKeyOrigin: 'https://api.openai.com',
            })
        );
    });

    it('enters a key for the service shown when it was typed, while another is still being saved', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'openai_compatible',
            openaiCompatibleBaseUrl:
                'https://generativelanguage.googleapis.com/v1beta/openai',
        });
        location.hash = '#translation';
        await renderReady();
        const stored = Promise.withResolvers<void>();
        const write = browser.storage.sync.set.bind(browser.storage.sync);
        vi.spyOn(browser.storage.sync, 'set').mockImplementationOnce(
            (items: Record<string, unknown>) =>
                stored.promise.then(() => write(items)) as never
        );
        fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
        fireEvent.change(screen.getByLabelText('Paste it here'), {
            target: { value: 'sk-openai' },
        });
        stored.resolve();
        await waitFor(async () =>
            expect(
                await fakeBrowser.storage.local.get([
                    'openaiCompatibleApiKey',
                    'openaiCompatibleApiKeyOrigin',
                ])
            ).toEqual({
                openaiCompatibleApiKey: 'sk-openai',
                openaiCompatibleApiKeyOrigin:
                    'https://generativelanguage.googleapis.com',
            })
        );
    });

    it('keeps a key typed before an address change with the address it was typed for', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#explanations';
        await renderReady();
        fireEvent.change(screen.getByLabelText('Paste it here'), {
            target: { value: 'sk-openai' },
        });
        const address = screen.getByLabelText('Service address');
        fireEvent.change(address, {
            target: { value: 'https://llm.example.com/v1' },
        });
        fireEvent.blur(address);
        await waitFor(async () =>
            expect(await sync('openaiBaseUrl')).toBe(
                'https://llm.example.com/v1'
            )
        );
        expect(
            await fakeBrowser.storage.local.get([
                'openaiApiKey',
                'openaiApiKeyOrigin',
            ])
        ).toEqual({
            openaiApiKey: 'sk-openai',
            openaiApiKeyOrigin: 'https://api.openai.com',
        });
        await waitFor(() =>
            expect(screen.getByLabelText('Paste it here')).toHaveValue('')
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

    it('undoes a quick second choice back to the first one', async () => {
        location.hash = '#look';
        await renderReady();
        fireEvent.click(
            screen.getByRole('button', { name: /^My language on top/ })
        );
        fireEvent.click(
            screen.getByRole('button', { name: /^The video's language on top/ })
        );
        const toasts = document.querySelector<HTMLElement>('.toast-region')!;
        await waitFor(() =>
            expect(toasts).toHaveTextContent("The video's language on top")
        );
        fireEvent.click(within(toasts).getByRole('button', { name: 'Undo' }));
        await waitFor(async () =>
            expect(await sync('subtitleLayoutOrder')).toBe('translation_top')
        );
    });

    it('takes back an Undo once a later change lands', async () => {
        await fakeBrowser.storage.sync.set({ subtitleStyle: 'custom' });
        location.hash = '#look';
        await renderReady();
        fireEvent.click(
            screen.getByRole('button', { name: 'Change colors and font' })
        );
        fireEvent.click(screen.getByRole('button', { name: /Boxed$/ }));
        const toast = await screen.findByText('Look: Boxed');
        expect(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        ).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Font'), {
            target: { value: 'serif' },
        });
        await waitFor(async () =>
            expect(await sync('subtitleCustomLook')).toMatchObject({
                font: 'serif',
            })
        );
        await waitFor(() =>
            expect(
                screen.queryByRole('button', { name: 'Undo' })
            ).not.toBeInTheDocument()
        );
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        expect(await sync('subtitleCustomLook')).toMatchObject({
            font: 'serif',
        });
    });

    it('takes back an Undo as soon as a later change is asked for', async () => {
        await fakeBrowser.storage.sync.set({ subtitleStyle: 'custom' });
        location.hash = '#look';
        await renderReady();
        fireEvent.click(
            screen.getByRole('button', { name: 'Change colors and font' })
        );
        fireEvent.click(screen.getByRole('button', { name: /Boxed$/ }));
        await screen.findByText('Look: Boxed');

        fireEvent.change(screen.getByLabelText('Font'), {
            target: { value: 'serif' },
        });
        fireEvent.pointerUp(document.body);
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(await sync('subtitleCustomLook')).toMatchObject({
            font: 'serif',
        });
    });

    it('turns a switch back when it is pressed again while its first change is saved', async () => {
        await renderReady();
        const advanced = screen.getByRole('switch', {
            name: 'Show advanced options',
        });
        const realSave = configService.setMultiple.bind(configService);
        const firstWrite = Promise.withResolvers<void>();
        vi.spyOn(configService, 'setMultiple').mockImplementationOnce(
            (settings, siteWrite) =>
                firstWrite.promise.then(() => realSave(settings, siteWrite))
        );
        fireEvent.click(advanced);
        // The second press comes in a later task, before the first is saved.
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
        fireEvent.click(advanced);
        firstWrite.resolve();
        await waitFor(async () =>
            expect(
                (await fakeBrowser.storage.local.get('showAdvancedSettings'))
                    .showAdvancedSettings
            ).toBe(false)
        );
        expect(advanced).toHaveAttribute('aria-checked', 'false');
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

    it('drops an edit still waiting to be written when the site follows all sites again', async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
        });
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#look';
        await renderReady();
        fireEvent.click(
            within(
                screen.getByRole('group', { name: 'Settings for' })
            ).getByRole('button', { name: /^Netflix/ })
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
            screen.getAllByRole('button', {
                name: 'Use the value for all sites',
            })[0]!
        );
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({})
        );
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(await sync('siteProfiles')).toEqual({});
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

    it('leaves a hide choice made in another tab alone when the fix is undone', async () => {
        await fakeBrowser.storage.sync.set({
            hideOfficialSubtitles: false,
            siteProfiles: {
                netflix: { hideOfficialSubtitles: false },
                disneyplus: { hideOfficialSubtitles: false },
            },
        });
        location.hash = '#help';
        await renderReady();
        fireEvent.click(screen.getByRole('button', { name: 'Fix it for me' }));
        const undo = await screen.findByRole('button', { name: 'Undo' });
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({})
        );
        // Another tab has Disney+ hide its own subtitles after all.
        await fakeBrowser.storage.sync.set({
            siteProfiles: { disneyplus: { hideOfficialSubtitles: true } },
        });

        fireEvent.click(undo);
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { hideOfficialSubtitles: false },
                disneyplus: { hideOfficialSubtitles: true },
            })
        );
        expect(await sync('hideOfficialSubtitles')).toBe(false);
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

    it('says Vertex needs setting up again once its token has expired', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'vertex_gemini',
            translationFallback: false,
            vertexProjectId: 'my-project-123',
            vertexLocation: 'us-central1',
            vertexModel: 'gemini-2.5-flash',
        });
        await fakeBrowser.storage.local.set({
            vertexAccessToken: 'ya29.token',
            vertexTokenExpiresAt: Date.now() - 1000,
        });
        await renderReady();
        expect(screen.getByText(/isn't set up yet$/)).toBeInTheDocument();
        expect(screen.queryByText('DualSub is ready')).not.toBeInTheDocument();
    });

    it('says Vertex needs setting up again when its token runs out while the page is open', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'vertex_gemini',
            translationFallback: false,
            vertexProjectId: 'my-project-123',
            vertexLocation: 'us-central1',
            vertexModel: 'gemini-2.5-flash',
        });
        await fakeBrowser.storage.local.set({
            vertexAccessToken: 'ya29.token',
            vertexTokenExpiresAt: Date.now() + 2000,
        });
        await renderReady();
        expect(screen.getByText('DualSub is ready')).toBeInTheDocument();
        expect(
            await screen.findByText(
                "Google Vertex AI isn't set up yet",
                {},
                { timeout: 4000 }
            )
        ).toBeInTheDocument();
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

    it('says AI translation still needs setting up until Chrome lets DualSub reach its address', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'openai_compatible',
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
            translationFallback: false,
        });
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: 'sk-key',
            openaiCompatibleApiKeyOrigin: 'https://llm.example.com',
        });
        await renderReady();
        expect(
            await screen.findByText("AI translation isn't set up yet")
        ).toBeInTheDocument();
        expect(screen.queryByText('DualSub is ready')).not.toBeInTheDocument();
    });

    it('says AI translation is set up once access to its address is granted elsewhere', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'openai_compatible',
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
            translationFallback: false,
        });
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: 'sk-key',
            openaiCompatibleApiKeyOrigin: 'https://llm.example.com',
        });
        await renderReady();
        expect(
            await screen.findByText("AI translation isn't set up yet")
        ).toBeInTheDocument();

        vi.mocked(browser.permissions.contains).mockResolvedValue(
            true as never
        );
        permissionsChanged('added', ['https://llm.example.com/*']);
        expect(await screen.findByText('DualSub is ready')).toBeInTheDocument();
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

    it('takes back a backup that loads in part entry by entry, keeping a profile changed elsewhere', async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleGap: 0.5 } },
        });
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Download settings' })
            ).toBeEnabled()
        );
        fireEvent.change(screen.getByLabelText('Load settings from a file'), {
            target: {
                files: [
                    new File(
                        [
                            JSON.stringify({
                                siteProfiles: { netflix: { subtitleGap: 0.7 } },
                                showAdvancedSettings: false,
                            }),
                        ],
                        'backup.json',
                        { type: 'application/json' }
                    ),
                ],
            },
        });
        const replace = await screen.findByRole('button', {
            name: 'Replace them',
        });
        // Another tab gives Disney+ a profile after the profiles are written,
        // just before the local write fails.
        vi.spyOn(browser.storage.local, 'set').mockImplementationOnce(
            () =>
                fakeBrowser.storage.sync
                    .set({
                        siteProfiles: {
                            netflix: { subtitleGap: 0.7 },
                            disneyplus: { subtitleGap: 0.2 },
                        },
                    })
                    .then(() => Promise.reject(new Error('quota'))) as never
        );
        fireEvent.click(replace);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleGap: 0.5 },
                disneyplus: { subtitleGap: 0.2 },
            })
        );
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

    it('undoes a backup load except a setting changed in another tab since', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Download settings' })
            ).toBeEnabled()
        );
        fireEvent.change(screen.getByLabelText('Load settings from a file'), {
            target: {
                files: [
                    new File(
                        [
                            JSON.stringify({
                                subtitleFontScale: 1.6,
                                subtitleGap: 0.5,
                            }),
                        ],
                        'backup.json',
                        { type: 'application/json' }
                    ),
                ],
            },
        });
        fireEvent.click(
            await screen.findByRole('button', { name: 'Replace them' })
        );
        const toast = await screen.findByText('Settings loaded');
        await fakeBrowser.storage.sync.set({ subtitleGap: 0.7 });
        fireEvent.click(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        );
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1)
        );
        expect(await sync('subtitleGap')).toBe(0.7);
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

    it('offers no backup file to load until the settings are read', async () => {
        const read = configService.readMultipleResultStrict.bind(configService);
        vi.spyOn(configService, 'readMultipleResultStrict').mockImplementation(
            (keys, options) =>
                keys.includes('aiContextBurstLimit')
                    ? Promise.reject(new Error('broken'))
                    : read(keys, options)
        );
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        expect(
            screen.getByRole('button', { name: 'Choose a file…' })
        ).toBeDisabled();
    });

    it('refuses a backup holding a site value this version cannot use, and keeps what it does not know', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        const load = (contents: unknown): void => {
            fireEvent.change(
                screen.getByLabelText('Load settings from a file'),
                {
                    target: {
                        files: [
                            new File(
                                [JSON.stringify(contents)],
                                'backup.json',
                                {
                                    type: 'application/json',
                                }
                            ),
                        ],
                    },
                }
            );
        };
        load({ siteProfiles: { netflix: { subtitleFontScale: 999 } } });
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "That file can't be loaded"
        );

        const profiles = {
            netflix: { subtitleFontScale: 1.4, futureSetting: true },
            hulu: { subtitleGap: 0.1 },
        };
        load({ siteProfiles: profiles });
        fireEvent.click(
            await screen.findByRole('button', { name: 'Replace them' })
        );
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual(profiles)
        );
    });

    it('loads only the backup chosen last, however its reads finish', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        const slowRead = Promise.withResolvers<string>();
        const first = new File(['{}'], 'first.json', {
            type: 'application/json',
        });
        first.text = () => slowRead.promise;
        const second = new File(
            [JSON.stringify({ subtitleFontScale: 1.6 })],
            'second.json',
            { type: 'application/json' }
        );
        const input = screen.getByLabelText('Load settings from a file');
        fireEvent.change(input, { target: { files: [first] } });
        fireEvent.change(input, { target: { files: [second] } });
        expect(
            await screen.findByText('Settings that will change: 1.')
        ).toBeInTheDocument();

        slowRead.resolve(
            JSON.stringify({ subtitleFontScale: 1.2, subtitleGap: 0.5 })
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(
            screen.getByText('Settings that will change: 1.')
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Replace them' }));
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1.6)
        );
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
