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
import { getDefaultValue } from '@/config/schema';
import { configService } from '@/config/service';
import { installExtensionRuntimeIdentity } from '@/test-utils/extensionRuntime';
import { installPermissionEvents } from '@/test-utils/permissionEvents';
import { resetCatalogsForTests } from '../hooks/useI18n';
import { SITE_VIEW_KEYS } from '../hooks/useSitesOn';
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

/** Opens a row of the style pane by its name. */
function openRow(name: RegExp): void {
    fireEvent.click(
        within(
            screen.getByRole('complementary', { name: 'Subtitle style' })
        ).getByRole('button', { name })
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
    vi.useRealTimers();
});

describe('OptionsApp', () => {
    it('opens on Start, ready to use, with the browser’s language picked', async () => {
        const title = await renderReady();
        expect(title).toHaveTextContent('Start');
        expect(
            await screen.findByText('Working on Netflix and Disney+')
        ).toBeInTheDocument();
        expect(
            screen.getByText('Picked from your browser')
        ).toBeInTheDocument();
        expect(
            screen.getByRole('switch', { name: 'Dual subtitles' })
        ).toHaveAttribute('aria-checked', 'true');
        expect(
            screen.getByRole('img', {
                name: /^Sample subtitles: 뜻이 있는 곳에 길이 있다\./,
            })
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
        fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
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

    it("undoes a choice to what its own write replaced, keeping another page's write", async () => {
        await renderReady();
        const realSet = fakeBrowser.storage.sync.set.bind(
            fakeBrowser.storage.sync
        );
        const elsewhere = Promise.withResolvers<void>();
        let interleaved = false;
        vi.spyOn(fakeBrowser.storage.sync, 'set').mockImplementation(
            (items: Record<string, unknown>) => {
                if (interleaved || !('subtitleFontScale' in items)) {
                    return realSet(items) as never;
                }
                interleaved = true;
                // Another page writes, in its turn, while this write is out.
                void navigator.locks
                    .request('dualsub:settingParts', () =>
                        realSet({ subtitleFontScale: 1.6 })
                    )
                    .then(() => elsewhere.resolve());
                return new Promise((resolve) => setTimeout(resolve, 20)).then(
                    () => realSet(items)
                ) as never;
            }
        );
        fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
        const toast = await screen.findByText('Text size: Large');
        await elsewhere.promise;

        fireEvent.click(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        );
        await waitFor(() =>
            expect(
                screen.queryByText('Text size: Large')
            ).not.toBeInTheDocument()
        );
        expect(await sync('subtitleFontScale')).toBe(1.6);
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

    it("keeps the scope bar when a site's settings cannot be read, so all sites can be picked again", async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#look';
        await renderReady();
        const read = configService.readMultipleResultStrict.bind(configService);
        vi.spyOn(configService, 'readMultipleResultStrict').mockImplementation(
            (keys, options) =>
                options?.site === 'netflix'
                    ? Promise.reject(new Error('storage broken'))
                    : read(keys, options)
        );
        const scopes = (): HTMLElement =>
            screen.getByRole('group', { name: 'Settings for' });
        fireEvent.click(
            within(scopes()).getByRole('button', { name: /^Netflix/ })
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to load settings'
        );

        fireEvent.click(
            within(scopes()).getByRole('button', { name: /^All sites/ })
        );
        expect(
            await screen.findByRole('heading', {
                level: 1,
                name: 'Style',
            })
        ).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says when the preview shows English for a language it has no sample in', async () => {
        await fakeBrowser.storage.sync.set({ targetLanguage: 'th' });
        await renderReady();
        expect(
            screen.getByText(
                'There is no th sample here, so English stands in for it.'
            )
        ).toBeInTheDocument();
    });

    it('shows a stored language the menu does not offer as the one picked', async () => {
        await fakeBrowser.storage.sync.set({ targetLanguage: 'nl' });
        location.hash = '#languages';
        await renderReady();
        expect(document.getElementById('target-language-menu')).toHaveValue(
            'nl'
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
        expect(await screen.findByText('Netflix only.')).toBeInTheDocument();

        nav('Help');
        await screen.findByRole('heading', { level: 1, name: 'Help' });
        expect(screen.queryByText('Netflix only.')).not.toBeInTheDocument();

        nav('Style');
        expect(await screen.findByText('Netflix only.')).toBeInTheDocument();
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
        expect(
            screen.getByRole('img', {
                name: 'Each subtitle appears with the voice.',
            })
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Show earlier/ }));
        expect(await screen.findByText('0.5 s earlier')).toBeInTheDocument();
        expect(await sync('subtitleTimeOffset')).toBe(0.5);
        expect(
            screen.getByRole('img', {
                name: 'Each subtitle appears 0.5 seconds before the voice.',
            })
        ).toBeInTheDocument();

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

    it('shows the advanced options from the top bar and says so', async () => {
        await renderReady();
        expect(
            within(screen.getByRole('navigation')).queryByRole('link', {
                name: 'Advanced',
            })
        ).toBeNull();
        fireEvent.click(
            screen.getByRole('switch', { name: 'Advanced options' })
        );
        expect(
            await screen.findByText('Advanced options are showing')
        ).toBeInTheDocument();
        expect(
            within(screen.getByRole('navigation')).getByRole('link', {
                name: 'Advanced',
            })
        ).toBeInTheDocument();
        expect(
            within(
                screen.getByRole('group', { name: 'Settings for' })
            ).getByRole('button', { name: /^All sites/ })
        ).toHaveAttribute('aria-pressed', 'true');
    });

    it('takes a search for the real size to full screen', async () => {
        await renderReady();
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'real size' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: /^See them at full size/ })
        );
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Full screen' })
            ).toHaveFocus()
        );
    });

    it('offers showing the show’s translation with the original line among the advanced options', async () => {
        location.hash = '#languages';
        await renderReady();
        const pairing = (): HTMLElement | null =>
            screen.queryByRole('switch', {
                name: 'Show it with the original line',
            });
        expect(pairing()).toBeNull();

        fireEvent.click(
            screen.getByRole('switch', { name: 'Advanced options' })
        );
        await waitFor(() =>
            expect(pairing()).toHaveAttribute('aria-checked', 'true')
        );
        fireEvent.click(pairing()!);
        await waitFor(async () =>
            expect(await sync('pairOfficialTranslations')).toBe(false)
        );
        expect(
            await screen.findByText(
                "The show's translation keeps its own timing"
            )
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole('switch', {
                name: "Use the show's own translation",
            })
        );
        await waitFor(() => expect(pairing()).toBeNull());
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
            screen.getByRole('switch', { name: 'Advanced options' })
        );
        nav('Sites');
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Give Netflix its own settings',
            })
        );
        expect(await screen.findByText('Netflix only.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Extra large' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleFontScale: 1.6 },
            })
        );
        expect(await sync('subtitleFontScale')).toBeUndefined();
        expect(await screen.findAllByText('Netflix only')).not.toHaveLength(0);

        fireEvent.click(
            screen.getAllByRole('button', {
                name: 'Use All sites',
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
                name: 'Edit Netflix settings',
            })
        );
        fireEvent.click(
            (
                await screen.findAllByRole('button', {
                    name: 'Use All sites',
                })
            )[0]!
        );
        const toast = await screen.findByText('Back to the All-sites value');
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
                screen.queryByText('Back to the All-sites value')
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
            await screen.findByText('Pick at least one.')
        ).toBeInTheDocument();
        expect(
            screen.getByRole('switch', { name: 'Word explanations' })
        ).toBeDisabled();
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

    it('takes back a kind of explanation clicked again while the first click is saved', async () => {
        await fakeBrowser.storage.sync.set({ aiContextTypes: ['linguistic'] });
        location.hash = '#explanations';
        await renderReady();
        const realSet = fakeBrowser.storage.sync.set.bind(
            fakeBrowser.storage.sync
        );
        const held = Promise.withResolvers<void>();
        let holding = true;
        vi.spyOn(fakeBrowser.storage.sync, 'set').mockImplementation(
            (items: Record<string, unknown>) => {
                if (!holding || !('aiContextTypes' in items)) {
                    return realSet(items) as never;
                }
                holding = false;
                return held.promise.then(() => realSet(items)) as never;
            }
        );
        const culture = within(
            screen.getByRole('group', { name: 'What to explain' })
        ).getByRole('checkbox', { name: 'The culture behind it' });
        fireEvent.click(culture);
        fireEvent.click(culture);
        held.resolve();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(await sync('aiContextTypes')).toEqual(['linguistic']);
        expect(culture).not.toBeChecked();
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

    it("says so on Start when the sites' on/off states cannot be read", async () => {
        const read = configService.readMultipleResultStrict.bind(configService);
        vi.spyOn(configService, 'readMultipleResultStrict').mockImplementation(
            (keys, options) =>
                options?.site === undefined &&
                keys.length === SITE_VIEW_KEYS.length &&
                SITE_VIEW_KEYS.every((key) => keys.includes(key))
                    ? Promise.reject(new Error('broken'))
                    : read(keys, options)
        );
        await renderReady();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't read where DualSub is on."
        );
        expect(screen.getByText('Dual subtitles are on')).toBeInTheDocument();
    });

    it('says where DualSub is on and where it is off', async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { disneyplus: { subtitlesEnabled: false } },
        });
        await renderReady();
        expect(
            await screen.findByText('Working on Netflix, off on Disney+')
        ).toBeInTheDocument();
    });

    it('keeps the export in step with every change, even while storage cannot be read', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        const download = screen.getByRole('button', {
            name: 'Download',
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
        expect(
            await screen.findByRole('heading', { name: 'Set up with OpenAI' })
        ).toBeInTheDocument();
        expect(
            screen.queryByLabelText('Paste it here')
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Change key' }));
        expect(screen.getByLabelText('Paste it here')).toHaveValue('AIza-key');
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

    it('lists no models, and checks no key, at an address the key was not entered for', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.mocked(browser.permissions.contains).mockResolvedValue(
            true as never
        );
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'openai_compatible',
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: 'sk-key',
            openaiCompatibleApiKeyOrigin: 'https://api.openai.com',
        });
        location.hash = '#translation';
        await renderReady();
        expect(await screen.findByLabelText('Paste it here')).toHaveValue('');
        expect(
            screen.getByRole('button', { name: 'Check key' })
        ).toBeDisabled();

        await vi.advanceTimersByTimeAsync(1500);
        const requested = vi
            .mocked(fetch)
            .mock.calls.map(([input]) =>
                input instanceof Request ? input.url : input.toString()
            );
        expect(
            requested.filter((url) => url.startsWith('https://llm.example.com'))
        ).toEqual([]);
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

    it('resets the setup of a key that is only spaces', async () => {
        await fakeBrowser.storage.sync.set({
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: '   ',
            openaiCompatibleApiKeyOrigin: 'https://llm.example.com',
            showAdvancedSettings: true,
        });
        location.hash = '#advanced';
        await renderReady();
        fireEvent.click(
            screen.getByRole('button', { name: 'Reset everything…' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(
            await screen.findByText(
                'Everything is back to the recommended settings'
            )
        ).toBeInTheDocument();
        expect(await sync('openaiCompatibleBaseUrl')).toBe(
            getDefaultValue('openaiCompatibleBaseUrl')
        );
    });

    it('keeps the setup of a key another page saves while a reset waits to write', async () => {
        await fakeBrowser.storage.sync.set({
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
        });
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        // Another page is saving a key, in its turn, when the reset asks for its own.
        const release = Promise.withResolvers<void>();
        const elsewhere = navigator.locks.request(
            'dualsub:settingParts',
            async () => {
                await release.promise;
                await fakeBrowser.storage.local.set({
                    openaiCompatibleApiKey: 'sk-key',
                    openaiCompatibleApiKeyOrigin: 'https://llm.example.com',
                });
            }
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Reset everything…' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        release.resolve();
        await elsewhere;

        expect(
            await screen.findByText(
                'Everything is back to the recommended settings'
            )
        ).toBeInTheDocument();
        expect(await sync('openaiCompatibleBaseUrl')).toBe(
            'https://llm.example.com/v1'
        );
    });

    it('resets the setup of a key entered for another address', async () => {
        await fakeBrowser.storage.sync.set({
            openaiCompatibleBaseUrl: 'https://llm.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: 'sk-key',
            openaiCompatibleApiKeyOrigin: 'https://api.openai.com',
            showAdvancedSettings: true,
        });
        location.hash = '#advanced';
        await renderReady();
        fireEvent.click(
            screen.getByRole('button', { name: 'Reset everything…' })
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

        expect(
            await screen.findByText(
                'Everything is back to the recommended settings'
            )
        ).toBeInTheDocument();
        expect(await sync('openaiCompatibleBaseUrl')).toBe(
            getDefaultValue('openaiCompatibleBaseUrl')
        );
        expect(
            await fakeBrowser.storage.local.get([
                'openaiCompatibleApiKey',
                'openaiCompatibleApiKeyOrigin',
            ])
        ).toEqual({
            openaiCompatibleApiKey: 'sk-key',
            openaiCompatibleApiKeyOrigin: 'https://api.openai.com',
        });
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
        fireEvent.change(screen.getByLabelText('Load from a file'), {
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

    it('says so when the settings a backup holds cannot be read', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        const read = configService.readMultipleResultStrict.bind(configService);
        vi.spyOn(configService, 'readMultipleResultStrict').mockImplementation(
            (keys, options) =>
                options?.includeSensitive !== true &&
                keys.includes('subtitleFontScale') &&
                keys.includes('loggingLevel')
                    ? Promise.reject(new Error('storage broken'))
                    : read(keys, options)
        );
        location.hash = '#advanced';
        await renderReady();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to load settings'
        );
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
        fireEvent.click(screen.getByRole('button', { name: 'Smaller text' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
        fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
        await waitFor(() =>
            expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        );
    });

    it('puts focus on the section a button opens', async () => {
        await renderReady();
        fireEvent.click(
            screen.getByRole('button', { name: 'Change the style' })
        );
        await waitFor(() =>
            expect(
                screen.getByRole('heading', { level: 1, name: 'Style' })
            ).toHaveFocus()
        );
    });

    it('opens a folded or advanced setting from search and focuses it', async () => {
        await renderReady();
        const search = screen.getByRole('searchbox');
        fireEvent.change(search, { target: { value: 'spacing' } });
        fireEvent.click(
            screen.getByRole('button', { name: /^Space between the lines/ })
        );
        await waitFor(() =>
            expect(
                screen.getByRole('slider', { name: 'Spacing' })
            ).toHaveFocus()
        );
        expect(screen.getByRole('button', { name: /^Lines/ })).toHaveAttribute(
            'aria-expanded',
            'true'
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

    it('lands on a searched setting that shows once its section reads its settings', async () => {
        await renderReady();
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'hide' },
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: /^Hide the site's own subtitles/,
            })
        );
        await waitFor(() =>
            expect(
                document
                    .getElementById('site-hide-netflix')
                    ?.contains(document.activeElement)
            ).toBe(true)
        );
    });

    it('takes an address search to the address, or to the service that has one', async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        await fakeBrowser.storage.sync.set({ aiContextProvider: 'gemini' });
        await renderReady();
        const searchAddress = (): void => {
            fireEvent.change(screen.getByRole('searchbox'), {
                target: { value: 'address' },
            });
            fireEvent.click(
                screen.getByRole('button', {
                    name: /^Address, for compatible servers/,
                })
            );
        };
        searchAddress();
        await waitFor(() =>
            expect(document.activeElement).toHaveAttribute(
                'id',
                'explain-provider-openai'
            )
        );

        fireEvent.click(document.activeElement as HTMLElement);
        await waitFor(async () =>
            expect(await sync('aiContextProvider')).toBe('openai')
        );
        searchAddress();
        await waitFor(() =>
            expect(document.activeElement).toHaveAttribute(
                'id',
                'openaiBaseUrl'
            )
        );
    });

    it('opens a finished explanations setup to reach the address choice', async () => {
        await fakeBrowser.storage.local.set({
            showAdvancedSettings: true,
            geminiApiKey: 'AIza-key',
        });
        await fakeBrowser.storage.sync.set({ aiContextProvider: 'gemini' });
        location.hash = '#explanations';
        await renderReady();
        expect(
            await screen.findByRole('button', { name: 'Change key' })
        ).toBeInTheDocument();

        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'address' },
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: /^Address, for compatible servers/,
            })
        );
        await waitFor(() =>
            expect(document.activeElement).toHaveAttribute(
                'id',
                'explain-provider-openai'
            )
        );
    });

    it('opens where its address points, the row holding it open', async () => {
        await fakeBrowser.storage.sync.set({ subtitleStyle: 'custom' });
        location.hash = '#look/look-font/format-look';
        await renderReady();
        await waitFor(() =>
            expect(screen.getByLabelText('Font')).toHaveFocus()
        );
        expect(screen.getByRole('button', { name: /^Look/ })).toHaveAttribute(
            'aria-expanded',
            'true'
        );
        expect(location.hash).toBe('#look');
    });

    it("lands a search for a site's switch on that switch", async () => {
        await renderReady();
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'use dualsub here' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: /^Use DualSub here/ })
        );
        await waitFor(() =>
            expect(document.activeElement).toHaveAttribute('role', 'switch')
        );
        expect(
            document
                .getElementById('site-on-netflix')
                ?.contains(document.activeElement)
        ).toBe(true);
    });

    it('finds the exact timing shift, turning on advanced options to show it', async () => {
        await renderReady();
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'exact shift' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Exact shift/ }));
        await waitFor(() =>
            expect(document.activeElement).toHaveAttribute(
                'id',
                'timing-exact-field'
            )
        );
    });

    it('offers the exact size and height to everyone, in their rows', async () => {
        location.hash = '#look';
        await renderReady();
        expect(
            await screen.findByRole('slider', { name: 'Exact text size' })
        ).toBeInTheDocument();

        openRow(/^Position/);
        expect(
            screen.getByRole('slider', { name: 'Exact height' })
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('slider', { name: 'Exact text size' })
        ).toBeNull();
    });

    it("lands a search for a site's own settings on that site's editing", async () => {
        await renderReady();
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'own settings' },
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: /^Give a site its own settings/,
            })
        );
        await waitFor(() =>
            expect(
                document
                    .getElementById('site-own-netflix')
                    ?.contains(document.activeElement)
            ).toBe(true)
        );
        expect(document.activeElement).toHaveAttribute('type', 'button');
    });

    it('finds the switch for dual subtitles on every site', async () => {
        location.hash = '#help';
        await renderReady();
        fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: 'dual subtitles' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: /^Dual subtitles/ })
        );
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByRole('switch', { name: 'Dual subtitles' })
            )
        );
    });

    it('finds the explanation controls by their labels', async () => {
        await renderReady();
        const search = screen.getByRole('searchbox');
        const open = (words: string, name: RegExp): void => {
            fireEvent.change(search, { target: { value: words } });
            fireEvent.click(screen.getByRole('button', { name }));
        };
        open('what to explain', /^What to explain/);
        await waitFor(() =>
            expect(
                screen.getByRole('checkbox', {
                    name: 'Meaning, and how to use it',
                })
            ).toHaveFocus()
        );
        open('open the explanation panel', /^Open the explanation panel/);
        await waitFor(() =>
            expect(
                screen.getByRole('switch', {
                    name: 'Open the explanation panel when I click a word',
                })
            ).toHaveFocus()
        );
        open('remember answers', /^Remember answers/);
        await waitFor(() =>
            expect(
                screen.getByRole('switch', { name: 'Remember answers' })
            ).toHaveFocus()
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

    it('finds the Vertex setup, showing advanced options to reach it', async () => {
        await renderReady();
        const search = screen.getByRole('searchbox');
        const openResult = (): void => {
            fireEvent.change(search, { target: { value: 'vertex' } });
            fireEvent.click(
                screen.getByRole('button', { name: /^Set up Google Vertex AI/ })
            );
        };
        openResult();
        await waitFor(() =>
            expect(
                screen.getByRole('radio', { name: /^Google Vertex AI/ })
            ).toHaveFocus()
        );

        fireEvent.click(
            screen.getByRole('radio', { name: /^Google Vertex AI/ })
        );
        await waitFor(async () =>
            expect(await sync('selectedProvider')).toBe('vertex_gemini')
        );
        openResult();
        await waitFor(() =>
            expect(document.getElementById('vertex-card')).toContainElement(
                document.activeElement as HTMLElement
            )
        );
    });

    it('opens the custom look from search, or lands on the looks that show it', async () => {
        await fakeBrowser.storage.sync.set({ subtitleStyle: 'platform' });
        await renderReady();
        const search = screen.getByRole('searchbox');
        const openResult = (): void => {
            fireEvent.change(search, { target: { value: 'font' } });
            fireEvent.click(
                screen.getByRole('button', {
                    name: /^Colors and font\s*Style/,
                })
            );
        };
        openResult();
        const looks = await screen.findByRole('button', { name: /^Look/ });
        await waitFor(() => expect(looks).toHaveFocus());
        expect(looks).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Boxed' }));
        await waitFor(async () =>
            expect(await sync('subtitleStyle')).toBe('custom')
        );
        openResult();
        await waitFor(() =>
            expect(screen.getByLabelText('Font')).toHaveFocus()
        );
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
            await screen.findByRole('heading', { level: 1, name: 'Start' })
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
            name: 'Advanced options',
        });

        fireEvent.click(advanced);
        await waitFor(() => expect(heading()).toHaveTextContent('Start'));
        fireEvent.click(advanced);
        await waitFor(async () =>
            expect(
                (await fakeBrowser.storage.local.get('showAdvancedSettings'))
                    .showAdvancedSettings
            ).toBe(true)
        );
        expect(heading()).toHaveTextContent('Start');
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
        const address = screen.getByLabelText(
            'Address, for compatible servers'
        );
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
        const address = screen.getByLabelText(
            'Address, for compatible servers'
        );
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
        fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
        await screen.findByText('Text size: Large');
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1)
        );
        expect(screen.queryByText('Text size: Large')).not.toBeInTheDocument();
    });

    it('keeps the Undo of a choice made twice before it is saved', async () => {
        location.hash = '#look';
        await renderReady();
        openRow(/^Lines/);
        const mine = screen.getByRole('button', { name: 'Translation' });
        fireEvent.click(mine);
        fireEvent.click(mine);
        const toasts = document.querySelector<HTMLElement>('.toast-region')!;
        await waitFor(() =>
            expect(toasts).toHaveTextContent('Translation on top')
        );
        await new Promise((resolve) => setTimeout(resolve, 50));

        fireEvent.click(within(toasts).getByRole('button', { name: 'Undo' }));
        await waitFor(async () =>
            expect(await sync('subtitleLayoutOrder')).toBe('original_top')
        );
    });

    it('keeps the Undo of a size picked twice in a row', async () => {
        location.hash = '#look';
        await renderReady();
        const large = screen.getByRole('button', { name: 'Large' });
        fireEvent.click(large);
        fireEvent.click(large);
        const toast = await screen.findByText('Text size: Large');
        await new Promise((resolve) => setTimeout(resolve, 50));

        fireEvent.click(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        );
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1)
        );
    });

    it('undoes a quick second choice back to the first one', async () => {
        location.hash = '#look';
        await renderReady();
        openRow(/^Lines/);
        fireEvent.click(screen.getByRole('button', { name: 'Translation' }));
        fireEvent.click(screen.getByRole('button', { name: 'Original' }));
        const toasts = document.querySelector<HTMLElement>('.toast-region')!;
        await waitFor(() =>
            expect(toasts).toHaveTextContent('Original on top')
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
        openRow(/^Look/);
        fireEvent.click(screen.getByRole('button', { name: 'Cinema' }));
        const toast = await screen.findByText('Look: Cinema');
        expect(
            within(toast.parentElement!).getByRole('button', { name: 'Undo' })
        ).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Font'), {
            target: { value: 'sans-serif' },
        });
        await waitFor(async () =>
            expect(await sync('subtitleCustomLook')).toMatchObject({
                font: 'sans-serif',
            })
        );
        await waitFor(() =>
            expect(
                screen.queryByRole('button', { name: 'Undo' })
            ).not.toBeInTheDocument()
        );
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        expect(await sync('subtitleCustomLook')).toMatchObject({
            font: 'sans-serif',
        });
    });

    it('takes back an Undo as soon as a later change is asked for', async () => {
        await fakeBrowser.storage.sync.set({ subtitleStyle: 'custom' });
        location.hash = '#look';
        await renderReady();
        openRow(/^Look/);
        fireEvent.click(screen.getByRole('button', { name: 'Cinema' }));
        await screen.findByText('Look: Cinema');

        fireEvent.change(screen.getByLabelText('Font'), {
            target: { value: 'sans-serif' },
        });
        fireEvent.pointerUp(document.body);
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(await sync('subtitleCustomLook')).toMatchObject({
            font: 'sans-serif',
        });
    });

    it('takes back an Undo as soon as a later edit is made, before it is saved', async () => {
        await fakeBrowser.storage.sync.set({ subtitleStyle: 'custom' });
        location.hash = '#look';
        await renderReady();
        openRow(/^Look/);
        fireEvent.click(screen.getByRole('button', { name: 'Cinema' }));
        const toast = await screen.findByText('Look: Cinema');

        // The edit waits for its pause; Ctrl+Z comes before it is saved.
        fireEvent.click(screen.getByRole('switch', { name: 'Bold' }));
        expect(
            within(toast.parentElement!).queryByRole('button', { name: 'Undo' })
        ).not.toBeInTheDocument();
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        fireEvent.keyUp(document.body, { key: 'z', ctrlKey: true });
        await waitFor(async () =>
            expect(await sync('subtitleCustomLook')).toMatchObject({
                font: 'serif',
                bold: true,
            })
        );
    });

    it('offers no Undo for a change that an edit made while it was saved builds on', async () => {
        await fakeBrowser.storage.sync.set({ subtitleStyle: 'custom' });
        location.hash = '#look';
        await renderReady();
        openRow(/^Look/);
        const realSet = fakeBrowser.storage.sync.set.bind(
            fakeBrowser.storage.sync
        );
        const held = Promise.withResolvers<void>();
        let holding = true;
        vi.spyOn(fakeBrowser.storage.sync, 'set').mockImplementation(
            (items: Record<string, unknown>) => {
                if (!holding || !('subtitleCustomLook' in items)) {
                    return realSet(items) as never;
                }
                holding = false;
                return held.promise.then(() => realSet(items)) as never;
            }
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cinema' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Bold' }));
        held.resolve();

        const toast = await screen.findByText('Look: Cinema');
        expect(
            within(toast.parentElement!).queryByRole('button', { name: 'Undo' })
        ).not.toBeInTheDocument();
        fireEvent.pointerUp(document.body);
        await waitFor(async () =>
            expect(await sync('subtitleCustomLook')).toMatchObject({
                font: 'serif',
                bold: true,
            })
        );
    });

    it('turns a switch back when it is pressed again while its first change is saved', async () => {
        await renderReady();
        const advanced = screen.getByRole('switch', {
            name: 'Advanced options',
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
        fireEvent.click(screen.getByRole('button', { name: 'Bigger text' }));
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
            screen.getByRole('group', { name: /Reset all settings/ })
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
        await screen.findByText('Netflix only.');
        fireEvent.change(screen.getByLabelText('Exact text size'), {
            target: { value: '1.45' },
        });
        fireEvent.click(
            screen.getAllByRole('button', {
                name: 'Use All sites',
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
        await screen.findByText('Netflix only.');
        fireEvent.change(screen.getByLabelText('Exact text size'), {
            target: { value: '1.45' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Back to All sites' })
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
            screen.queryByRole('button', { name: 'Extra large' });
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
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Fix it for me',
                description: 'I see subtitles twice',
            })
        );
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
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Fix it for me',
                description: 'I see subtitles twice',
            })
        );
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

    it('shows the show’s translation on its own timing again from Help, and Undo pairs it back', async () => {
        location.hash = '#help';
        await renderReady();
        const fix = (): HTMLElement | null =>
            screen.queryByRole('button', {
                name: 'Fix it for me',
                description: 'The translation goes with the wrong line',
            });
        fireEvent.click(fix()!);
        await waitFor(async () =>
            expect(await sync('pairOfficialTranslations')).toBe(false)
        );
        expect(
            await screen.findByText(
                "The show's translation keeps its own timing"
            )
        ).toBeInTheDocument();
        await waitFor(() => expect(fix()).toBeNull());

        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(fix()).not.toBeNull());
    });

    it('offers the fix for the show’s translation while pairing is on, even where only a site uses that translation', async () => {
        await fakeBrowser.storage.sync.set({
            useOfficialTranslations: false,
            siteProfiles: { netflix: { useOfficialTranslations: true } },
        });
        location.hash = '#help';
        await renderReady();
        expect(
            screen.getByRole('button', {
                name: 'Fix it for me',
                description: 'The translation goes with the wrong line',
            })
        ).toBeInTheDocument();
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
                name: 'Edit Netflix settings',
            })
        );
        await screen.findByText('Netflix only.');
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
                name: 'Edit Netflix settings',
            })
        );
        await screen.findByText('Netflix only.');
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
        expect(
            screen.queryByText('Working on Netflix and Disney+')
        ).not.toBeInTheDocument();
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
        expect(
            await screen.findByText('Working on Netflix and Disney+')
        ).toBeInTheDocument();
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
        expect(
            screen.queryByText('Working on Netflix and Disney+')
        ).not.toBeInTheDocument();
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
        expect(
            screen.queryByText('Working on Netflix and Disney+')
        ).not.toBeInTheDocument();
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
        expect(
            await screen.findByText('Working on Netflix and Disney+')
        ).toBeInTheDocument();
    });

    it('says who translates while the chosen service still needs setting up', async () => {
        await fakeBrowser.storage.sync.set({ selectedProvider: 'deepl' });
        await renderReady();
        expect(
            await screen.findByText('Working on Netflix and Disney+')
        ).toBeInTheDocument();
        expect(
            screen.getByText('Until it is, Microsoft Translator translates.')
        ).toBeInTheDocument();
    });

    it('judges the service by the sites where DualSub runs, not the shared switch alone', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'deepl',
            translationFallback: false,
            subtitlesEnabled: false,
            siteProfiles: { netflix: { subtitlesEnabled: true } },
        });
        await renderReady();
        expect(
            await screen.findByText("DeepL isn't set up yet")
        ).toBeInTheDocument();
        expect(
            screen.getByText("Until it is, subtitles aren't translated.")
        ).toBeInTheDocument();
    });

    it('says subtitles are off, not that the service needs setting up, when every site has them off', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'deepl',
            translationFallback: false,
            siteProfiles: {
                netflix: { subtitlesEnabled: false },
                disneyplus: { subtitlesEnabled: false },
            },
        });
        await renderReady();
        expect(
            await screen.findByText('Dual subtitles are off')
        ).toBeInTheDocument();
        expect(
            screen.queryByText("DeepL isn't set up yet")
        ).not.toBeInTheDocument();
    });

    it('asks for the service where a site keeps a original line to translate from', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'deepl',
            translationFallback: false,
            originalLanguage: 'en',
            targetLanguage: 'en',
            siteProfiles: { netflix: { originalLanguage: 'ko' } },
        });
        await renderReady();
        expect(
            await screen.findByText("DeepL isn't set up yet")
        ).toBeInTheDocument();
        expect(
            screen.getByText("Until it is, subtitles aren't translated.")
        ).toBeInTheDocument();
    });

    it('asks no service of a setup that shows one line', async () => {
        await fakeBrowser.storage.sync.set({
            selectedProvider: 'deepl',
            originalLanguage: 'en',
            targetLanguage: 'en',
        });
        await renderReady();
        expect(
            await screen.findByText('Working on Netflix and Disney+')
        ).toBeInTheDocument();
        expect(
            screen.queryByText("DeepL isn't set up yet")
        ).not.toBeInTheDocument();

        await fakeBrowser.storage.sync.set({ translationFallback: false });
        await waitFor(async () =>
            expect(await sync('translationFallback')).toBe(false)
        );
        expect(
            screen.queryByText("Until it is, subtitles aren't translated.")
        ).not.toBeInTheDocument();
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
        fireEvent.change(screen.getByLabelText('Load from a file'), {
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
        nav('Meanings');
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
        fireEvent.change(screen.getByLabelText('Load from a file'), {
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

    it("puts a backup that loads in part back to what its own turn read, keeping another page's write", async () => {
        await fakeBrowser.storage.local.set({ showAdvancedSettings: true });
        location.hash = '#advanced';
        await renderReady();
        await waitFor(() =>
            expect(document.querySelector('pre.code')).toHaveTextContent(
                '"subtitleFontScale": 1'
            )
        );
        fireEvent.change(screen.getByLabelText('Load from a file'), {
            target: {
                files: [
                    new File(
                        [
                            JSON.stringify({
                                subtitleFontScale: 1.6,
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
        // Another page is writing, in its turn, when the backup asks for its own.
        const release = Promise.withResolvers<void>();
        const elsewhere = navigator.locks.request(
            'dualsub:settingParts',
            async () => {
                await release.promise;
                await fakeBrowser.storage.sync.set({ subtitleFontScale: 1.3 });
            }
        );
        vi.spyOn(browser.storage.local, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        fireEvent.click(replace);
        await new Promise((resolve) => setTimeout(resolve, 20));
        release.resolve();
        await elsewhere;

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
        expect(await sync('subtitleFontScale')).toBe(1.3);
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
                screen.getByRole('button', { name: 'Download' })
            ).toBeEnabled()
        );
        fireEvent.change(screen.getByLabelText('Load from a file'), {
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
        fireEvent.change(screen.getByLabelText('Load from a file'), {
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
                screen.getByRole('button', { name: 'Download' })
            ).toBeEnabled()
        );
        fireEvent.change(screen.getByLabelText('Load from a file'), {
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
        fireEvent.change(screen.getByLabelText('Load from a file'), {
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
            fireEvent.change(screen.getByLabelText('Load from a file'), {
                target: {
                    files: [
                        new File([JSON.stringify(contents)], 'backup.json', {
                            type: 'application/json',
                        }),
                    ],
                },
            });
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
        const input = screen.getByLabelText('Load from a file');
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
