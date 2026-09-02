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
import { installExtensionRuntimeIdentity } from '@/test-utils/extensionRuntime';
import { resetCatalogsForTests } from '../hooks/useI18n';
import { OptionsApp } from './OptionsApp';
import { OPTIONS_SETTINGS_KEYS } from './types';

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
    return screen.findByRole('heading', { level: 2, name: 'General' });
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
    vi.spyOn(browser.permissions, 'contains').mockResolvedValue(false as never);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('OptionsApp', () => {
    it('loads every options key, credentials included', async () => {
        await fakeBrowser.storage.sync.set({ selectedProvider: 'deepl' });
        await fakeBrowser.storage.local.set({ deeplApiKey: 'secret' });
        await renderReady();
        fireEvent.click(screen.getByRole('link', { name: 'Providers' }));
        expect(screen.getByLabelText('API Key:')).toHaveValue('secret');
        expect(OPTIONS_SETTINGS_KEYS).toContain('vertexTokenExpiresAt');
    });

    it('saves general settings and switches the UI language catalog', async () => {
        await renderReady();
        fireEvent.click(screen.getByLabelText('Hide official subtitles:'));
        await waitFor(async () =>
            expect(
                await fakeBrowser.storage.sync.get('hideOfficialSubtitles')
            ).toEqual({ hideOfficialSubtitles: false })
        );

        fireEvent.change(screen.getByLabelText('Logging Level:'), {
            target: { value: '4' },
        });
        await waitFor(async () =>
            expect(await fakeBrowser.storage.sync.get('loggingLevel')).toEqual({
                loggingLevel: 4,
            })
        );
    });

    it('navigates by sidebar and honors the initial hash', async () => {
        location.hash = '#advanced';
        render(<OptionsApp />);
        expect(
            await screen.findByRole('heading', {
                level: 2,
                name: 'Advanced Settings',
            })
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('link', { name: 'Translation' }));
        expect(
            screen.getByRole('heading', { level: 2, name: 'Translation' })
        ).toBeInTheDocument();
        expect(screen.getByLabelText('Provider:')).toHaveValue(
            'microsoft_edge'
        );
    });

    it('shows a banner when a save fails and keeps the controls usable', async () => {
        await renderReady();
        vi.spyOn(browser.storage.sync, 'set').mockRejectedValueOnce(
            new Error('quota')
        );
        fireEvent.click(screen.getByLabelText('Hide official subtitles:'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Failed to save setting'
        );
        expect(screen.getByLabelText('Hide official subtitles:')).toBeChecked();
    });

    it('blocks the page when settings cannot be read', async () => {
        vi.spyOn(browser.storage.sync, 'get').mockRejectedValueOnce(
            new Error('broken')
        );
        render(<OptionsApp />);
        const alert = await screen.findByRole('alert');
        await waitFor(() =>
            expect(alert).toHaveTextContent('Failed to load settings')
        );
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});
