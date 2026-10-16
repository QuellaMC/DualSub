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
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDefaultValue } from '@/config/schema';
import { installExtensionRuntimeIdentity } from '@/test-utils/extensionRuntime';
import { installPermissionEvents } from '@/test-utils/permissionEvents';
import { resetCatalogsForTests } from '../hooks/useI18n';
import { WelcomeApp } from './WelcomeApp';

const EN = readFileSync(resolve('public/_locales/en/messages.json'), 'utf8');

beforeAll(() => {
    installExtensionRuntimeIdentity();
    installPermissionEvents();
});

beforeEach(async () => {
    resetCatalogsForTests();
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
    await fakeBrowser.storage.sync.clear();
    await fakeBrowser.storage.local.clear();
    vi.spyOn(browser.permissions, 'contains').mockResolvedValue(false as never);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** Opens the language menu, as "Change" does, and returns it. */
async function changeLanguage(): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    return screen.getByRole('combobox', { name: 'Your language' });
}

describe('WelcomeApp', () => {
    it('says DualSub is ready, what it picked, and the three steps', async () => {
        render(<WelcomeApp />);
        expect(
            await screen.findByRole('heading', {
                level: 1,
                name: "You're all set.",
            })
        ).toBeInTheDocument();
        await waitFor(() => expect(document.title).toBe('Welcome to DualSub'));
        expect(
            screen.getByRole('img', { name: 'Subtitle preview' })
        ).toBeInTheDocument();
        expect(screen.getByText('Your language: English')).toBeInTheDocument();
        expect(
            screen.getByText(
                'Taken from your browser. Your line is always in this language.'
            )
        ).toBeInTheDocument();
        expect(
            screen.getByText("Video's line: the language spoken in each video")
        ).toBeInTheDocument();
        expect(
            screen.getByText('Translation: Microsoft Translator')
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                'Free, no account needed. When a show has its own translation in your language, DualSub uses that instead.'
            )
        ).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: 'Open Netflix' })
        ).toHaveAttribute('href', 'https://www.netflix.com/');
        expect(
            screen.getByRole('link', { name: 'Open Disney+' })
        ).toHaveAttribute('href', 'https://www.disneyplus.com/');
    });

    it('says when its sample shows English for a language it has no sample in', async () => {
        await fakeBrowser.storage.sync.set({ targetLanguage: 'th' });
        render(<WelcomeApp />);
        expect(
            await screen.findByText(
                'There is no th sample here, so English stands in for it.'
            )
        ).toBeInTheDocument();
    });

    it('offers the switch when dual subtitles are off, as another computer may have left them', async () => {
        await fakeBrowser.storage.sync.set({ subtitlesEnabled: false });
        render(<WelcomeApp />);
        expect(
            await screen.findByText('Dual subtitles are off')
        ).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
            'Welcome to DualSub'
        );

        fireEvent.click(screen.getByRole('switch', { name: 'Dual subtitles' }));
        await waitFor(async () =>
            expect(
                (await fakeBrowser.storage.sync.get('subtitlesEnabled'))
                    .subtitlesEnabled
            ).toBe(true)
        );
        expect(
            await screen.findByText('Dual subtitles are on')
        ).toBeInTheDocument();
        expect(
            screen.getByRole('switch', { name: 'Dual subtitles' })
        ).toHaveAttribute('aria-checked', 'true');
    });

    it('offers the switch when every site has dual subtitles off, and turns them on everywhere', async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: {
                netflix: { subtitlesEnabled: false },
                disneyplus: { subtitlesEnabled: false },
            },
        });
        render(<WelcomeApp />);
        expect(
            await screen.findByText('Dual subtitles are off')
        ).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
            'Welcome to DualSub'
        );
        expect(
            screen.getByText(
                /It is off for now: the switch below turns it on\./
            )
        ).toBeInTheDocument();
        expect(
            screen.queryByText(/There is nothing to set up/)
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('switch', { name: 'Dual subtitles' }));
        await waitFor(async () =>
            expect(
                (await fakeBrowser.storage.sync.get('siteProfiles'))
                    .siteProfiles
            ).toEqual({})
        );
        expect(
            await screen.findByRole('heading', {
                level: 1,
                name: "You're all set.",
            })
        ).toBeInTheDocument();
    });

    it('says when the chosen service still needs setting up, and who translates until then', async () => {
        await fakeBrowser.storage.sync.set({ selectedProvider: 'deepl' });
        render(<WelcomeApp />);
        expect(
            await screen.findByText("DeepL isn't set up yet")
        ).toBeInTheDocument();
        expect(
            screen.getByText('Until it is, Microsoft Translator translates.')
        ).toBeInTheDocument();
        expect(
            screen.queryByText('Translation: DeepL')
        ).not.toBeInTheDocument();
        const heading = (): HTMLElement =>
            screen.getByRole('heading', { level: 1 });
        expect(heading()).toHaveTextContent("You're all set.");

        await fakeBrowser.storage.sync.set({ translationFallback: false });
        expect(
            await screen.findByText("Until it is, subtitles aren't translated.")
        ).toBeInTheDocument();
        expect(heading()).toHaveTextContent('Welcome to DualSub');
        expect(
            screen.getByText(/finish setting up the translation service below/)
        ).toBeInTheDocument();

        await fakeBrowser.storage.local.set({ deeplApiKey: 'key:fx' });
        expect(
            await screen.findByText('Translation: DeepL')
        ).toBeInTheDocument();
        expect(heading()).toHaveTextContent("You're all set.");
    });

    it('describes the lines as the saved layout sets them', async () => {
        await fakeBrowser.storage.sync.set({
            subtitleLayoutOrder: 'translation_top',
        });
        render(<WelcomeApp />);
        expect(
            await screen.findByText(
                /yours on top, and the video's own language underneath\./
            )
        ).toBeInTheDocument();

        await fakeBrowser.storage.sync.set({
            subtitleLayoutOrientation: 'row',
        });
        expect(
            await screen.findByText(
                /two lines of subtitles side by side on Netflix and Disney\+/
            )
        ).toBeInTheDocument();
    });

    it('saves another translation language and opens the settings', async () => {
        const openOptions = vi
            .spyOn(browser.runtime, 'openOptionsPage')
            .mockResolvedValue(undefined);
        render(<WelcomeApp />);
        const language = await changeLanguage();
        expect(language).toHaveValue(getDefaultValue('targetLanguage'));
        fireEvent.change(language, { target: { value: 'ja' } });
        await waitFor(async () =>
            expect(
                (await fakeBrowser.storage.sync.get('targetLanguage'))
                    .targetLanguage
            ).toBe('ja')
        );
        expect(
            screen.queryByText(
                'Taken from your browser. Your line is always in this language.'
            )
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(
            await screen.findByText('Your language: Japanese')
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole('button', { name: 'See all settings' })
        );
        expect(openOptions).toHaveBeenCalledOnce();
    });

    it("claims no browser language when the browser's are all ones DualSub lacks", async () => {
        vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['nl-NL']);
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('nl-NL');
        render(<WelcomeApp />);
        expect(await changeLanguage()).toHaveValue('en');
        expect(
            screen.getByText('Your line is always in this language.')
        ).toBeInTheDocument();
    });

    it('shows no untranslated text while its catalog loads', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise<Response>(() => undefined))
        );
        render(<WelcomeApp />);
        await waitFor(() =>
            expect(
                document.querySelector('main[aria-busy="true"]')
            ).toBeInTheDocument()
        );
        expect(document.body).not.toHaveTextContent('commonLoading');
    });

    it('reports only how the latest pick was saved', async () => {
        render(<WelcomeApp />);
        const language = await changeLanguage();
        const realSet = fakeBrowser.storage.sync.set.bind(
            fakeBrowser.storage.sync
        );
        const first = Promise.withResolvers<void>();
        const second = Promise.withResolvers<void>();
        vi.spyOn(browser.storage.sync, 'set')
            .mockImplementationOnce(() => first.promise as never)
            .mockImplementationOnce(
                (items: Record<string, unknown>) =>
                    second.promise.then(() => realSet(items)) as never
            );
        fireEvent.change(language, { target: { value: 'ko' } });
        fireEvent.change(language, { target: { value: 'ja' } });
        first.reject(new Error('quota'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        second.resolve();
        await waitFor(async () =>
            expect(
                (await fakeBrowser.storage.sync.get('targetLanguage'))
                    .targetLanguage
            ).toBe('ja')
        );
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says so when the language cannot be saved', async () => {
        render(<WelcomeApp />);
        const language = await changeLanguage();
        vi.spyOn(browser.storage.sync, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        fireEvent.change(language, { target: { value: 'ko' } });
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
    });
});
