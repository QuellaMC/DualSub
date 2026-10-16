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
import { resetCatalogsForTests } from '../hooks/useI18n';
import { WelcomeApp } from './WelcomeApp';

const EN = readFileSync(resolve('public/_locales/en/messages.json'), 'utf8');

beforeAll(() => {
    installExtensionRuntimeIdentity();
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
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('WelcomeApp', () => {
    it('says DualSub is ready, shows the subtitles to expect, and the three steps', async () => {
        render(<WelcomeApp />);
        expect(
            await screen.findByRole('heading', {
                level: 1,
                name: 'Welcome! DualSub is ready.',
            })
        ).toBeInTheDocument();
        await waitFor(() => expect(document.title).toBe('Welcome to DualSub'));
        expect(
            screen.getByRole('img', { name: 'Subtitle preview' })
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                "We picked your browser's language. Pick another if you like."
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

    it('saves another translation language and opens the settings', async () => {
        const openOptions = vi
            .spyOn(browser.runtime, 'openOptionsPage')
            .mockResolvedValue(undefined);
        render(<WelcomeApp />);
        const language = await screen.findByRole('combobox', {
            name: 'Your subtitles are translated into',
        });
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
                "We picked your browser's language. Pick another if you like."
            )
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
        expect(openOptions).toHaveBeenCalledOnce();
    });

    it("claims no browser language when the browser's are all ones DualSub lacks", async () => {
        vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['nl-NL']);
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('nl-NL');
        render(<WelcomeApp />);
        expect(
            await screen.findByRole('combobox', {
                name: 'Your subtitles are translated into',
            })
        ).toHaveValue('en');
        expect(
            screen.queryByText(
                "We picked your browser's language. Pick another if you like."
            )
        ).not.toBeInTheDocument();
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
        const language = await screen.findByRole('combobox', {
            name: 'Your subtitles are translated into',
        });
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
        const language = await screen.findByRole('combobox', {
            name: 'Your subtitles are translated into',
        });
        vi.spyOn(browser.storage.sync, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        fireEvent.change(language, { target: { value: 'ko' } });
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
    });
});
