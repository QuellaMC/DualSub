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
import { configService } from '@/config/service';
import { installExtensionRuntimeIdentity } from '@/test-utils/extensionRuntime';
import { resetCatalogsForTests } from '../hooks/useI18n';
import { SidePanelApp } from './SidePanelApp';

const EN = readFileSync(resolve('public/_locales/en/messages.json'), 'utf8');

type Frame = { action: string; data: Record<string, unknown> };

function fakePort() {
    const messageListeners = new Set<(message: unknown) => void>();
    const posted: Frame[] = [];
    const port = {
        name: 'sidepanel',
        postMessage: (message: unknown) => {
            posted.push(message as Frame);
        },
        disconnect: vi.fn(),
        onMessage: {
            addListener: (listener: (message: unknown) => void) => {
                messageListeners.add(listener);
            },
            removeListener: vi.fn(),
        },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    return {
        port,
        posted,
        emit(message: unknown) {
            for (const listener of messageListeners) {
                listener(message);
            }
        },
    };
}

const BINDING = { registrationId: 1, tabId: 12, windowId: 3 };

/** Words: hola 0, mi 1, amigo 2. */
const LINE = {
    text: 'hola mi amigo',
    language: 'es',
    translation: 'hello my friend',
};

const SELECTION = {
    session: 'doc-1:1',
    selectionOwnerGeneration: 1,
    selectionRevision: 2,
    renderRevision: 1,
    reason: 'toggle',
    entries: [
        { wordIndex: 0, word: 'hola' },
        { wordIndex: 2, word: 'amigo' },
    ],
    line: LINE,
};

const LOOKUP = {
    translation: 'hello friend',
    entries: [
        {
            term: 'amigo',
            from: null,
            type: 'noun',
            senses: ['friend, pal'],
        },
    ],
    source: 'google',
};

const ANSWER = {
    success: true,
    answer: {
        meaning: 'A friendly greeting',
        register: 'casual',
        examples: [{ text: 'Hola amigo, ¿qué tal?', translation: 'Hi friend' }],
        similar: ['hola compa'],
        tip: 'Use it with friends.',
    },
};

/**
 * The background, by action: lookups and explanations. A reply is a value,
 * or a function that produces one per request.
 */
function background(replies: { lookup?: unknown; analyze?: unknown } = {}) {
    const reply = (value: unknown, fallback: unknown) =>
        Promise.resolve(
            typeof value === 'function'
                ? (value as () => unknown)()
                : (value ?? fallback)
        );
    return vi
        .spyOn(browser.runtime, 'sendMessage')
        .mockImplementation((message: unknown) => {
            const { action } = message as { action: string };
            return (
                action === 'lookupWords'
                    ? reply(replies.lookup, LOOKUP)
                    : action === 'analyzeContext'
                      ? reply(replies.analyze, ANSWER)
                      : Promise.resolve(undefined)
            ) as never;
        });
}

function sent(send: ReturnType<typeof background>, action: string) {
    return send.mock.calls
        .map(([message]) => message as unknown as Record<string, unknown>)
        .filter((message) => message.action === action);
}

const word = (name: string) => screen.getByRole('button', { name });

async function renderBound() {
    const fake = fakePort();
    vi.spyOn(browser.runtime, 'connect').mockReturnValue(fake.port as never);
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
        { id: 12, windowId: 3 },
    ] as never);
    render(<SidePanelApp />);
    await screen.findByText('DualSub');
    await waitFor(() => expect(fake.posted).toHaveLength(1));
    expect(fake.posted[0]).toMatchObject({
        action: 'sidePanelRegister',
        data: BINDING,
    });
    fake.emit({ action: 'sidePanelBindingConfirmed', data: BINDING });
    fake.emit({
        action: 'sidePanelSelectionSync',
        data: { binding: BINDING, selection: SELECTION },
    });
    await screen.findByRole('button', { name: 'hola' });
    await screen.findByRole('button', { name: 'Explain with AI' });
    return fake;
}

/** The window's active tab changes: the panel rebinds there, the background
 *  confirms, and projects a bound null state until content republishes. */
async function switchTab(
    fake: ReturnType<typeof fakePort>,
    registrationId: number,
    tabId: number
) {
    fake.emit({ action: 'tabActivated', data: { tabId, windowId: 3 } });
    await waitFor(() =>
        expect(fake.posted.at(-1)).toMatchObject({
            action: 'sidePanelRegister',
            data: { registrationId, tabId, windowId: 3 },
        })
    );
    const binding = { registrationId, tabId, windowId: 3 };
    fake.emit({ action: 'sidePanelBindingConfirmed', data: binding });
    fake.emit({
        action: 'sidePanelSelectionSync',
        data: { binding, selection: null },
    });
    return binding;
}

/** Let queued frames render. */
function settled(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
    installExtensionRuntimeIdentity();
});

beforeEach(async () => {
    // Storage is cleared rather than the whole fake reset: a reset would
    // drop the config service's storage listener, through which settings
    // changes reach the panel.
    await fakeBrowser.storage.sync.clear();
    await fakeBrowser.storage.local.clear();
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
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({
        id: 12,
        url: 'https://www.netflix.com/watch/81234567',
    } as never);
    await configService.setMultiple({
        uiLanguage: 'en',
        aiContextTypes: ['linguistic'],
        aiContextProvider: 'gemini',
        targetLanguage: 'en',
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('SidePanelApp', () => {
    it('shows the line with the picked words pressed, and asks content to change them', async () => {
        background();
        const fake = await renderBound();
        expect(word('hola')).toHaveAttribute('aria-pressed', 'true');
        expect(word('mi')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText('hello my friend')).toBeInTheDocument();
        expect(screen.getByText('Spanish → English')).toBeInTheDocument();

        fireEvent.click(word('amigo'));
        await waitFor(() => expect(fake.posted).toHaveLength(2));
        expect(fake.posted[1]).toEqual({
            action: 'sidePanelUpdateState',
            data: {
                binding: BINDING,
                requestId: 1,
                selectionOwnerGeneration: 1,
                selectionRevision: 2,
                renderRevision: 1,
                wordIndex: 2,
                op: 'remove',
            },
        });
        // Nothing changes until content republishes without the word.
        expect(word('amigo')).toHaveAttribute('aria-pressed', 'true');
        expect(word('mi')).toBeDisabled();
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 3,
                    reason: 'remove',
                    entries: [{ wordIndex: 0, word: 'hola' }],
                },
            },
        });
        fake.emit({
            action: 'sidePanelUpdateState',
            data: {
                binding: BINDING,
                requestId: 1,
                selectionOwnerGeneration: 1,
                status: 'applied',
            },
        });
        await waitFor(() =>
            expect(word('amigo')).toHaveAttribute('aria-pressed', 'false')
        );
        fireEvent.click(word('mi'));
        await waitFor(() => expect(fake.posted).toHaveLength(3));
        expect(fake.posted[2]!.data).toMatchObject({
            wordIndex: 1,
            op: 'add',
            selectionRevision: 3,
        });
    });

    it('looks up the picked words: their translation and dictionary entries', async () => {
        const send = background();
        await renderBound();
        expect(
            await screen.findByRole('heading', { level: 2, name: 'hola amigo' })
        ).toBeInTheDocument();
        expect(await screen.findByText('hello friend')).toBeInTheDocument();
        expect(screen.getByText('friend, pal')).toBeInTheDocument();
        expect(screen.getByText('noun')).toBeInTheDocument();
        expect(screen.getByText('From Google Translate')).toBeInTheDocument();
        expect(sent(send, 'lookupWords')).toEqual([
            {
                action: 'lookupWords',
                text: 'hola amigo',
                language: 'es',
                targetLanguage: 'en',
            },
        ]);
    });

    it('says when the dictionary has nothing for the picked words', async () => {
        background({
            lookup: { translation: 'hello friend', entries: [], source: null },
        });
        await renderBound();
        expect(
            await screen.findByText(
                'No dictionary entry for these words together.'
            )
        ).toBeInTheDocument();
    });

    it('explains the picked words in their line only when asked', async () => {
        const send = background();
        await renderBound();
        await screen.findByText('hello friend');
        expect(sent(send, 'analyzeContext')).toHaveLength(0);

        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        expect(
            await screen.findByText('A friendly greeting')
        ).toBeInTheDocument();
        expect(sent(send, 'analyzeContext')).toEqual([
            {
                action: 'analyzeContext',
                text: 'hola amigo',
                line: 'hola mi amigo',
                language: 'es',
                contextTypes: ['linguistic'],
                targetLanguage: 'en',
            },
        ]);
        expect(screen.getByText('Casual')).toBeInTheDocument();
        expect(screen.getByText('Hi friend')).toBeInTheDocument();
        expect(screen.getByText('hola compa')).toBeInTheDocument();
        expect(screen.getByText('Use it with friends.')).toBeInTheDocument();
        expect(
            screen.getByText('Written by Google Gemini. It can make mistakes.')
        ).toBeInTheDocument();
    });

    it('walks through adding a key when there is none, then explains', async () => {
        let keyed = false;
        const send = background({
            analyze: () =>
                keyed ? ANSWER : { success: false, reason: 'setup' },
        });
        await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        expect(
            await screen.findByRole('heading', {
                name: 'Add a key to explain with AI',
            })
        ).toBeInTheDocument();
        const check = screen.getByRole('button', { name: 'Check and explain' });
        expect(check).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Paste it here'), {
            target: { value: ' AIza-test ' },
        });
        keyed = true;
        fireEvent.click(check);
        expect(
            await screen.findByText('A friendly greeting')
        ).toBeInTheDocument();
        expect(await fakeBrowser.storage.local.get('geminiApiKey')).toEqual({
            geminiApiKey: 'AIza-test',
        });
        expect(sent(send, 'analyzeContext')).toHaveLength(2);
    });

    it('says a refused key was refused, and closes the guide on request', async () => {
        background({ analyze: { success: false, reason: 'auth' } });
        await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'That key didn’t work. Check it, or get a new one.'
        );
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(
            await screen.findByRole('button', { name: 'Explain with AI' })
        ).toBeEnabled();
    });

    it('offers to try again when the AI service did not answer', async () => {
        const send = background({
            analyze: { success: false, reason: 'failed' },
        });
        await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The AI service didn’t answer.'
        );
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() =>
            expect(sent(send, 'analyzeContext')).toHaveLength(2)
        );
    });

    it('keeps the words and the answer when the panel rebinds to another tab and back', async () => {
        background();
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByText('A friendly greeting');

        await switchTab(fake, 2, 13);
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
        expect(screen.queryByRole('button', { name: 'hola' })).toBeNull();

        // Content republishes the same words. A worker restart in between
        // would mint a new owner generation; the words say it is the same
        // answer.
        const binding = await switchTab(fake, 3, 12);
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding,
                selection: { ...SELECTION, selectionOwnerGeneration: 2 },
            },
        });
        expect(
            await screen.findByText('A friendly greeting')
        ).toBeInTheDocument();
        expect(word('hola')).toHaveAttribute('aria-pressed', 'true');
    });

    it('finishes an explanation into its tab while the user is on another tab', async () => {
        let answer: (value: unknown) => void = () => undefined;
        background({
            analyze: () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        });
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByRole('status');

        await switchTab(fake, 2, 13);
        await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
        answer(ANSWER);

        const binding = await switchTab(fake, 3, 12);
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding,
                selection: { ...SELECTION, selectionOwnerGeneration: 2 },
            },
        });
        expect(
            await screen.findByText('A friendly greeting')
        ).toBeInTheDocument();
    });

    it('keeps the lookup and answer, read only, when the line moves on, and drops them for new words', async () => {
        background();
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByText('A friendly greeting');

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 3,
                    renderRevision: 2,
                    reason: 'subtitle-change',
                    entries: [],
                    line: null,
                },
            },
        });
        await waitFor(() => expect(word('hola')).toBeDisabled());
        expect(word('hola')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('A friendly greeting')).toBeInTheDocument();

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 4,
                    renderRevision: 2,
                    entries: [{ wordIndex: 1, word: 'mi' }],
                },
            },
        });
        await waitFor(() =>
            expect(word('mi')).toHaveAttribute('aria-pressed', 'true')
        );
        expect(screen.queryByText('A friendly greeting')).toBeNull();
    });

    it('drops the answer when the same words are picked in another line', async () => {
        const send = background();
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByText('A friendly greeting');
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 3,
                    renderRevision: 2,
                    reason: 'subtitle-change',
                    entries: [],
                    line: null,
                },
            },
        });
        await waitFor(() => expect(word('hola')).toBeDisabled());

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 4,
                    renderRevision: 3,
                    line: {
                        text: 'hola mi amigo de siempre',
                        language: 'es',
                        translation: 'hello my old friend',
                    },
                },
            },
        });
        await waitFor(() => expect(sent(send, 'lookupWords')).toHaveLength(2));
        expect(screen.getByText('hello my old friend')).toBeInTheDocument();
        expect(screen.queryByText('A friendly greeting')).toBeNull();
    });

    it('looks the kept words up again in a new target language', async () => {
        const send = background();
        const fake = await renderBound();
        await screen.findByText('hello friend');
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 3,
                    renderRevision: 2,
                    reason: 'subtitle-change',
                    entries: [],
                    line: null,
                },
            },
        });
        await waitFor(() => expect(word('hola')).toBeDisabled());

        await configService.setMultiple({ targetLanguage: 'fr' });
        await waitFor(() =>
            expect(sent(send, 'lookupWords').at(-1)).toEqual({
                action: 'lookupWords',
                text: 'hola amigo',
                language: 'es',
                targetLanguage: 'fr',
            })
        );
        expect(word('hola')).toBeDisabled();
    });

    it('forgets a tab whose page navigates away', async () => {
        background();
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByText('A friendly greeting');

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: { binding: BINDING, selection: null },
        });
        expect(
            await screen.findByText('Click any word in the subtitles')
        ).toBeInTheDocument();
        expect(screen.queryByText('A friendly greeting')).toBeNull();
    });

    it('brings the lookup and answer back when the same words are picked again', async () => {
        const send = background();
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByText('A friendly greeting');

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 3,
                    reason: 'remove',
                    entries: [],
                },
            },
        });
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: { ...SELECTION, selectionRevision: 4 },
            },
        });
        expect(
            await screen.findByText('A friendly greeting')
        ).toBeInTheDocument();
        expect(sent(send, 'lookupWords')).toHaveLength(1);
    });

    it('forgets a tab that comes back with nothing to show', async () => {
        background();
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByText('A friendly greeting');

        await switchTab(fake, 2, 13);
        const binding = await switchTab(fake, 3, 12);
        await screen.findByText('A friendly greeting');
        // The tab navigated while it was inactive: the background finds
        // nothing to republish and says so with a second null.
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: { binding, selection: null },
        });
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
    });

    it('drops the answer when the tab shows another document', async () => {
        background();
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByText('A friendly greeting');

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    session: 'doc-2:1',
                    selectionOwnerGeneration: 2,
                    selectionRevision: 1,
                    reason: 'subtitle-change',
                    entries: [],
                    line: null,
                },
            },
        });
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
    });

    it('shows an answer only under the AI settings it was made with', async () => {
        background();
        await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByText('A friendly greeting');

        await configService.setMultiple({ geminiModel: 'gemini-other' });
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
        await configService.setMultiple({ geminiModel: 'gemini-3.5-flash' });
        expect(
            await screen.findByText('A friendly greeting')
        ).toBeInTheDocument();
    });

    it('hides a failure from earlier AI settings', async () => {
        background({ analyze: { success: false, reason: 'failed' } });
        await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByRole('alert');

        await configService.setMultiple({ aiContextProvider: 'openai' });
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    it('drops a request when the tab moves to another session with the same words', async () => {
        let answer: (value: unknown) => void = () => undefined;
        background({
            analyze: () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        });
        const fake = await renderBound();
        fireEvent.click(
            screen.getByRole('button', { name: 'Explain with AI' })
        );
        await screen.findByRole('status');

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    session: 'doc-2:1',
                    selectionOwnerGeneration: 2,
                },
            },
        });
        await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
        answer(ANSWER);
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Explain with AI' })
            ).toBeEnabled()
        );
        expect(screen.queryByText('A friendly greeting')).toBeNull();
    });

    it('keeps actions disabled until the background confirms what the tab shows', async () => {
        background();
        const fake = await renderBound();
        await screen.findByText('hello friend');
        await switchTab(fake, 2, 13);
        fake.emit({ action: 'tabActivated', data: { tabId: 12, windowId: 3 } });
        await waitFor(() =>
            expect(fake.posted.at(-1)).toMatchObject({
                action: 'sidePanelRegister',
                data: { registrationId: 3, tabId: 12, windowId: 3 },
            })
        );
        // The remembered words are back on screen; nothing may act on
        // them until the background says they are what the tab shows.
        expect(word('hola')).toBeDisabled();
        expect(
            screen.getByRole('button', { name: 'Explain with AI' })
        ).toBeDisabled();
        const binding = { registrationId: 3, tabId: 12, windowId: 3 };
        fake.emit({ action: 'sidePanelBindingConfirmed', data: binding });
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: { binding, selection: null },
        });
        await settled();
        expect(
            screen.getByRole('button', { name: 'Explain with AI' })
        ).toBeDisabled();
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: { binding, selection: SELECTION },
        });
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Explain with AI' })
            ).toBeEnabled()
        );
        expect(word('hola')).toBeEnabled();
    });

    it('asks for a video on a site DualSub does not work on', async () => {
        vi.mocked(browser.tabs.get).mockResolvedValue({ id: 12 } as never);
        background();
        const fake = fakePort();
        vi.spyOn(browser.runtime, 'connect').mockReturnValue(
            fake.port as never
        );
        vi.spyOn(browser.tabs, 'query').mockResolvedValue([
            { id: 12, windowId: 3 },
        ] as never);
        render(<SidePanelApp />);
        expect(
            await screen.findByText('Open a video on Netflix or Disney+')
        ).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: 'Open Netflix' })
        ).toBeInTheDocument();
    });

    it('names no languages once the tab leaves the video, even with a lookup kept', async () => {
        background();
        const fake = await renderBound();
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 3,
                    renderRevision: 2,
                    reason: 'subtitle-change',
                    entries: [],
                    line: null,
                },
            },
        });
        await waitFor(() => expect(word('hola')).toBeDisabled());

        vi.mocked(browser.tabs.get).mockResolvedValue({
            id: 12,
            url: 'https://www.example.com/',
        } as never);
        await fakeBrowser.tabs.onUpdated.trigger(
            12,
            { url: 'https://www.example.com/' },
            { id: 12 } as never
        );
        expect(
            await screen.findByText('Open a video on Netflix or Disney+')
        ).toBeInTheDocument();
        expect(screen.queryByText('Spanish → English')).toBeNull();
    });

    it('opens help and the Meanings settings from the footer', async () => {
        background();
        const create = vi
            .spyOn(browser.tabs, 'create')
            .mockResolvedValue({} as never);
        await renderBound();
        fireEvent.click(screen.getByRole('button', { name: 'Help' }));
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(create.mock.calls.map(([options]) => options.url)).toEqual([
            expect.stringMatching(/options\.html#help$/),
            expect.stringMatching(/options\.html#explanations$/),
        ]);
    });
});
