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
import {
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { configService } from '@/config/service';
import { resetCatalogsForTests } from '../hooks/useI18n';
import { PopupApp } from './PopupApp';

const EN = readFileSync(resolve('public/_locales/en/messages.json'), 'utf8');
const NETFLIX_WATCH = 'https://www.netflix.com/watch/1';

function stubTab(url: string, onPlayer = false) {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
        { id: 7, url } as unknown as Browser.tabs.Tab,
    ] as never);
    vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue({
        onPlayer,
    } as never);
}

async function sync(key: string): Promise<unknown> {
    return (await fakeBrowser.storage.sync.get(key))[key];
}

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
    await fakeBrowser.storage.session.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('PopupApp on a site DualSub works on', () => {
    it('says it is working on the video and turns DualSub off for this site only', async () => {
        await fakeBrowser.storage.sync.set({ targetLanguage: 'ja' });
        stubTab(NETFLIX_WATCH, true);
        render(<PopupApp />);
        expect(
            await screen.findByRole('heading', {
                name: 'Working on this video',
            })
        ).toBeInTheDocument();
        expect(screen.getByText('Your line: Japanese.')).toBeInTheDocument();

        const enabled = screen.getByRole('switch', {
            name: 'Use DualSub here',
        });
        expect(enabled).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(enabled);
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitlesEnabled: false },
            })
        );
        expect(await sync('subtitlesEnabled')).not.toBe(false);
        expect(
            await screen.findByRole('heading', {
                name: 'Dual subtitles are off on Netflix',
            })
        ).toBeInTheDocument();
    });

    it('turns DualSub back on here when the switch is pressed again while its first change is saved', async () => {
        stubTab(NETFLIX_WATCH, true);
        render(<PopupApp />);
        const enabled = await screen.findByRole('switch', {
            name: 'Use DualSub here',
        });
        const realSet = fakeBrowser.storage.sync.set.bind(
            fakeBrowser.storage.sync
        );
        const firstWrite = Promise.withResolvers<void>();
        vi.spyOn(fakeBrowser.storage.sync, 'set').mockImplementationOnce(
            (items: Record<string, unknown>) =>
                firstWrite.promise.then(() => realSet(items)) as never
        );
        const writes = vi.spyOn(configService, 'setMultiple');
        fireEvent.click(enabled);
        // The second press comes in a later task, before the first is saved.
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
        fireEvent.click(enabled);
        firstWrite.resolve();
        await waitFor(() => expect(writes).toHaveBeenCalledTimes(2));
        await Promise.all(
            writes.mock.results.map((write) => write.value as Promise<unknown>)
        );

        expect(await sync('siteProfiles')).not.toEqual({
            netflix: { subtitlesEnabled: false },
        });
        expect(enabled).toHaveAttribute('aria-checked', 'true');
    });

    it('asks for a reload where DualSub is not running in the page yet', async () => {
        vi.spyOn(browser.tabs, 'query').mockResolvedValue([
            { id: 7, url: NETFLIX_WATCH } as unknown as Browser.tabs.Tab,
        ] as never);
        vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(
            new Error(
                'Could not establish connection. Receiving end does not exist.'
            )
        );
        const reload = vi
            .spyOn(browser.tabs, 'reload')
            .mockResolvedValue(undefined);
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        render(<PopupApp />);
        expect(
            await screen.findByRole('heading', {
                name: 'Reload the page to start DualSub',
            })
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole('button', { name: 'Reload the page' })
        );
        await waitFor(() => expect(reload).toHaveBeenCalledWith(7));
        await waitFor(() => expect(close).toHaveBeenCalledOnce());
    });

    it('notices the video once its session starts after the popup opened', async () => {
        stubTab(NETFLIX_WATCH);
        render(<PopupApp />);
        expect(
            await screen.findByRole('heading', { name: 'Ready on Netflix' })
        ).toBeInTheDocument();

        vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
            onPlayer: true,
        } as never);
        expect(
            await screen.findByRole('heading', {
                name: 'Working on this video',
            })
        ).toBeInTheDocument();
    });

    it('is ready before a video plays', async () => {
        stubTab('https://www.disneyplus.com/home');
        render(<PopupApp />);
        expect(
            await screen.findByRole('heading', { name: 'Ready on Disney+' })
        ).toBeInTheDocument();
    });

    it('steps the size through named sizes, timing by half seconds, and the position', async () => {
        stubTab(NETFLIX_WATCH, true);
        render(<PopupApp />);
        fireEvent.click(
            await screen.findByRole('button', { name: 'Bigger text' })
        );
        expect(await screen.findByText('Large')).toBeInTheDocument();
        await waitFor(async () =>
            expect(await sync('subtitleFontScale')).toBe(1.3)
        );

        fireEvent.click(screen.getByRole('button', { name: 'Show earlier' }));
        expect(await screen.findByText('0.5 s earlier')).toBeInTheDocument();
        await waitFor(async () =>
            expect(await sync('subtitleTimeOffset')).toBe(0.5)
        );

        fireEvent.click(screen.getByRole('button', { name: 'Move up' }));
        await waitFor(async () =>
            expect(await sync('subtitleVerticalPosition')).toBe(3.5)
        );
    });

    it("edits the value this site uses and marks the site's own", async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
        });
        stubTab(NETFLIX_WATCH, true);
        render(<PopupApp />);
        expect(await screen.findByText('Extra large')).toBeInTheDocument();
        expect(screen.getByText('Netflix only')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Smaller text' }));
        await waitFor(async () =>
            expect(await sync('siteProfiles')).toEqual({
                netflix: { subtitleFontScale: 1.3 },
            })
        );
        expect(await sync('subtitleFontScale')).toBeUndefined();
    });

    it('changes the languages', async () => {
        stubTab(NETFLIX_WATCH, true);
        render(<PopupApp />);
        fireEvent.change(await screen.findByLabelText('I speak'), {
            target: { value: 'ko' },
        });
        fireEvent.change(screen.getByLabelText(/^The top line shows/), {
            target: { value: 'en' },
        });
        await waitFor(async () =>
            expect(await sync('targetLanguage')).toBe('ko')
        );
        await waitFor(async () =>
            expect(await sync('originalLanguage')).toBe('en')
        );
    });

    it('names a failing translation service and leads to its settings', async () => {
        const create = vi
            .spyOn(browser.tabs, 'create')
            .mockResolvedValue({} as never);
        await fakeBrowser.storage.sync.set({ selectedProvider: 'deepl' });
        await fakeBrowser.storage.session.set({
            translationHealth: {
                provider: 'deepl',
                problem: 'quota',
                fallback: 'microsoft_edge',
                since: 1,
            },
        });
        stubTab(NETFLIX_WATCH, true);
        render(<PopupApp />);
        expect(
            await screen.findByText('DeepL is not working.')
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole('button', { name: 'Go to Translation' })
        );
        expect(create).toHaveBeenCalledWith({
            url: `${TEST_EXTENSION_ORIGIN}/options.html#translation`,
        });
    });

    it('shows a banner when a change cannot be saved', async () => {
        stubTab(NETFLIX_WATCH, true);
        render(<PopupApp />);
        const bigger = await screen.findByRole('button', {
            name: 'Bigger text',
        });
        // Only this save fails, not one another test left behind.
        const realSave = configService.setMultiple.bind(configService);
        let failed = false;
        vi.spyOn(configService, 'setMultiple').mockImplementation(
            (settings, siteWrite) => {
                if (!failed && Object.hasOwn(settings, 'subtitleFontScale')) {
                    failed = true;
                    return Promise.reject(new Error('quota'));
                }
                return realSave(settings, siteWrite);
            }
        );
        fireEvent.click(bigger);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
    });

    it('says so when the settings cannot be read', async () => {
        vi.spyOn(browser.storage.sync, 'get').mockRejectedValue(
            new Error('broken')
        );
        stubTab(NETFLIX_WATCH, true);
        render(<PopupApp />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to load settings'
        );
    });
});

describe('PopupApp anywhere else', () => {
    it('shows what DualSub does and opens the sites', async () => {
        stubTab('https://example.com/');
        render(<PopupApp />);
        expect(
            await screen.findByRole('heading', {
                name: 'DualSub works on these sites',
            })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('img', { name: 'Subtitle preview' })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: 'Open Netflix' })
        ).toHaveAttribute('href', 'https://www.netflix.com/');
        expect(
            screen.getByRole('link', { name: 'Open Disney+' })
        ).toHaveAttribute('href', 'https://www.disneyplus.com/');
    });

    it('opens all settings and help', async () => {
        const openOptions = vi
            .spyOn(browser.runtime, 'openOptionsPage')
            .mockResolvedValue(undefined);
        const create = vi
            .spyOn(browser.tabs, 'create')
            .mockResolvedValue({} as never);
        stubTab('https://example.com/');
        render(<PopupApp />);
        const [header, footer] = await screen.findAllByRole('button', {
            name: 'All settings',
        });
        fireEvent.click(header!);
        fireEvent.click(footer!);
        expect(openOptions).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'Help' }));
        expect(create).toHaveBeenCalledWith({
            url: `${TEST_EXTENSION_ORIGIN}/options.html#help`,
        });
    });
});
