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

const SELECTION = {
    selectionOwnerGeneration: 1,
    selectionRevision: 2,
    renderRevision: 1,
    reason: 'toggle',
    entries: [
        { wordIndex: 0, word: 'hola' },
        { wordIndex: 2, word: 'amigo' },
    ],
};

async function renderBound() {
    const fake = fakePort();
    vi.spyOn(browser.runtime, 'connect').mockReturnValue(fake.port as never);
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
        { id: 12, windowId: 3 },
    ] as never);
    render(<SidePanelApp />);
    await screen.findByRole('heading', { level: 1, name: 'AI Analysis' });
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
    await screen.findByText('hola');
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

const ANSWER = {
    success: true,
    result: {
        analysis: { definition: 'A friendly greeting' },
        contextType: 'cultural',
        contextTypes: ['cultural'],
        isStructured: true,
    },
};

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
    await configService.setMultiple({
        uiLanguage: 'en',
        aiContextEnabled: true,
        aiContextTypes: ['cultural'],
        targetLanguage: 'en',
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('SidePanelApp', () => {
    it('shows the bound tab selection as removable word tags', async () => {
        const fake = await renderBound();
        expect(
            screen.getAllByRole('listitem').map((item) => item.textContent)
        ).toEqual(['hola×', 'amigo×']);

        fireEvent.click(
            screen.getByRole('button', { name: 'Remove amigo at position 2' })
        );
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
            },
        });
        // Nothing changes until content republishes without the word.
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
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
            expect(screen.getAllByRole('listitem')).toHaveLength(1)
        );
    });

    it('analyzes the selected words and renders the structured answer', async () => {
        await renderBound();
        const send = vi
            .spyOn(browser.runtime, 'sendMessage')
            .mockResolvedValue({
                success: true,
                result: {
                    analysis: {
                        definition: 'A friendly greeting',
                        cultural_context: { origins: 'Spain' },
                    },
                    contextType: 'cultural',
                    contextTypes: ['cultural'],
                    isStructured: true,
                },
            } as never);

        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
        expect(
            await screen.findByRole('heading', {
                level: 2,
                name: 'Results for "hola, amigo"',
            })
        ).toBeInTheDocument();
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'analyzeContext',
                text: 'hola amigo',
                contextTypes: ['cultural'],
                contextType: 'cultural',
                targetLanguage: 'en',
            })
        );
        expect(screen.getByText('A friendly greeting')).toBeInTheDocument();
        expect(screen.getByText('Spain')).toBeInTheDocument();
    });

    it('shows the background reason when analysis fails and allows a retry', async () => {
        await renderBound();
        vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({
            success: false,
            error: 'OpenAI API key not configured',
            shouldRetry: false,
        } as never);
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'OpenAI API key not configured'
        );
        expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    });

    it('keeps the words and the answer when the panel rebinds to another tab and back', async () => {
        const fake = await renderBound();
        vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(
            ANSWER as never
        );
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
        await screen.findByText('A friendly greeting');

        await switchTab(fake, 2, 13);
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);

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
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('finishes an analysis into its tab while the user is on another tab', async () => {
        const fake = await renderBound();
        let answer: (value: unknown) => void = () => undefined;
        vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }) as never
        );
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
        await screen.findByText('Analyzing...', { selector: 'p' });

        await switchTab(fake, 2, 13);
        await waitFor(() =>
            expect(
                screen.queryByText('Analyzing...', { selector: 'p' })
            ).toBeNull()
        );
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
        expect(screen.getByRole('button', { name: /Analyze/ })).toBeEnabled();
    });

    it('keeps the answer when the line moves on and drops it for new words', async () => {
        const fake = await renderBound();
        vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(
            ANSWER as never
        );
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
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
                },
            },
        });
        await waitFor(() =>
            expect(screen.queryAllByRole('listitem')).toHaveLength(0)
        );
        expect(screen.getByText('A friendly greeting')).toBeInTheDocument();

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionRevision: 4,
                    renderRevision: 2,
                    entries: [{ wordIndex: 1, word: 'adios' }],
                },
            },
        });
        await screen.findByText('adios');
        expect(screen.queryByText('A friendly greeting')).toBeNull();
    });

    it('forgets a tab whose page navigates away', async () => {
        const fake = await renderBound();
        vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(
            ANSWER as never
        );
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
        await screen.findByText('A friendly greeting');

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: { binding: BINDING, selection: null },
        });
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });

    it('keeps the answer when the same words are selected again', async () => {
        const fake = await renderBound();
        vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(
            ANSWER as never
        );
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
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
        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: { ...SELECTION, selectionRevision: 4 },
            },
        });
        await waitFor(() =>
            expect(screen.getAllByRole('listitem')).toHaveLength(2)
        );
        expect(screen.getByText('A friendly greeting')).toBeInTheDocument();
    });

    it('forgets a tab that comes back with nothing to show', async () => {
        const fake = await renderBound();
        vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(
            ANSWER as never
        );
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
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
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });

    it('drops the answer when the tab shows another document', async () => {
        const fake = await renderBound();
        vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(
            ANSWER as never
        );
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
        await screen.findByText('A friendly greeting');

        fake.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: {
                    ...SELECTION,
                    selectionOwnerGeneration: 2,
                    selectionRevision: 1,
                    entries: [],
                },
            },
        });
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
    });

    it('shows an answer only in the language it was made for', async () => {
        await renderBound();
        vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(
            ANSWER as never
        );
        fireEvent.click(screen.getByRole('button', { name: /Analyze/ }));
        await screen.findByText('A friendly greeting');

        await configService.setMultiple({ targetLanguage: 'ja' });
        await waitFor(() =>
            expect(screen.queryByText('A friendly greeting')).toBeNull()
        );
        await configService.setMultiple({ targetLanguage: 'en' });
        expect(
            await screen.findByText('A friendly greeting')
        ).toBeInTheDocument();
    });

    it('keeps the analyze action disabled while the feature is off', async () => {
        await configService.setMultiple({ aiContextEnabled: false });
        await renderBound();
        expect(screen.getByRole('button', { name: /Analyze/ })).toBeDisabled();
    });
});
