import { jest } from '@jest/globals';

let migrateLegacyConfiguration;

describe('migrateLegacyConfiguration', () => {
    beforeEach(async () => {
        jest.resetModules();
        ({ migrateLegacyConfiguration } =
            await import('./configMigrations.js'));
        chrome.storage.sync.get.mockResolvedValue({});
        chrome.storage.local.get.mockResolvedValue({});
        chrome.storage.sync.set.mockResolvedValue();
        chrome.storage.local.set.mockResolvedValue();
        chrome.storage.sync.remove.mockResolvedValue();
        chrome.storage.local.remove.mockResolvedValue();
    });

    it('moves the Vertex token locally and deletes stored private-key material', async () => {
        chrome.storage.sync.get.mockResolvedValue({
            vertexAccessToken: 'short-lived-token',
        });
        chrome.storage.local.get.mockResolvedValue({
            vertexServiceAccount: {
                client_email: 'service@example.test',
                private_key: 'private-key-must-be-removed',
            },
        });

        const result = await migrateLegacyConfiguration();

        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            vertexAccessToken: 'short-lived-token',
        });
        expect(chrome.storage.sync.remove).toHaveBeenCalledWith([
            'vertexAccessToken',
        ]);
        expect(chrome.storage.local.remove).toHaveBeenCalledWith(
            'vertexServiceAccount'
        );
        expect(JSON.stringify(result)).not.toContain('short-lived-token');
        expect(JSON.stringify(result)).not.toContain(
            'private-key-must-be-removed'
        );
    });

    it('does not overwrite a device-local Vertex token', async () => {
        chrome.storage.sync.get.mockResolvedValue({
            vertexAccessToken: 'synced-token',
        });
        chrome.storage.local.get.mockResolvedValue({
            vertexAccessToken: 'newer-local-token',
        });

        await migrateLegacyConfiguration();

        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(chrome.storage.sync.remove).toHaveBeenCalledWith([
            'vertexAccessToken',
        ]);
    });

    it('moves all persistent provider API keys out of sync storage', async () => {
        chrome.storage.sync.get.mockResolvedValue({
            deeplApiKey: 'deepl-secret',
            openaiCompatibleApiKey: 'compatible-secret',
            openaiApiKey: 'openai-secret',
            geminiApiKey: 'gemini-secret',
        });
        chrome.storage.local.get.mockResolvedValue({
            openaiApiKey: 'newer-device-secret',
        });

        const result = await migrateLegacyConfiguration();

        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            deeplApiKey: 'deepl-secret',
            openaiCompatibleApiKey: 'compatible-secret',
            geminiApiKey: 'gemini-secret',
        });
        expect(chrome.storage.sync.remove).toHaveBeenCalledWith([
            'deeplApiKey',
            'openaiCompatibleApiKey',
            'openaiApiKey',
            'geminiApiKey',
        ]);
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it.each([
        'gpt-4.1-mini',
        'gpt-4.1-nano-2025-04-14',
        'gpt-4.1-mini-2025-04-14',
        'gpt-4o-mini-2024-07-18',
        'gpt-4o-2024-08-06',
        'custom-provider-model',
    ])(
        'preserves an existing OpenAI-compatible model %s',
        async (openaiModel) => {
            chrome.storage.sync.get.mockResolvedValue({ openaiModel });

            await migrateLegacyConfiguration();

            expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        }
    );

    it.each(['gemini-1.5-flash', 'gemini-1.5-pro'])(
        'migrates retired Gemini model %s',
        async (geminiModel) => {
            chrome.storage.sync.get.mockResolvedValue({ geminiModel });

            await migrateLegacyConfiguration();

            expect(chrome.storage.sync.set).toHaveBeenCalledWith({
                geminiModel: 'gemini-3.5-flash',
            });
        }
    );

    it.each(['gemini-2.5-flash', 'gemini-2.5-pro'])(
        'preserves supported Gemini model %s',
        async (geminiModel) => {
            chrome.storage.sync.get.mockResolvedValue({ geminiModel });

            await migrateLegacyConfiguration();

            expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        }
    );

    it('repairs the legacy OpenAI base URL', async () => {
        chrome.storage.sync.get.mockResolvedValue({
            openaiBaseUrl: 'https://api.openai.com/',
        });

        await migrateLegacyConfiguration();

        expect(chrome.storage.sync.set).toHaveBeenCalledWith({
            openaiBaseUrl: 'https://api.openai.com/v1',
        });
    });

    it('does not change supported provider selections', async () => {
        chrome.storage.sync.get.mockResolvedValue({
            openaiBaseUrl: 'https://models.example.test/v1',
            openaiModel: 'gpt-5.6-sol',
            geminiModel: 'gemini-3.5-flash',
        });

        await migrateLegacyConfiguration();

        expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });

    it('normalizes a Vertex region that the extension cannot access', async () => {
        chrome.storage.sync.get.mockResolvedValue({
            vertexLocation: 'australia-southeast1',
        });

        await migrateLegacyConfiguration();

        expect(chrome.storage.sync.set).toHaveBeenCalledWith({
            vertexLocation: 'us-central1',
        });
    });

    it('removes retired batch and side-panel settings from both storage areas', async () => {
        chrome.storage.sync.get.mockResolvedValue({
            smartBatching: true,
            maxConcurrentBatches: 4,
            sidePanelEnabled: false,
            sidePanelWordLists: { lists: [] },
            contextModalPosition: 'top',
        });
        chrome.storage.local.get.mockResolvedValue({
            sidePanelLastTabState: { activeTab: 'words-lists' },
            sidePanelSelectionBuckets: { legacy: ['word'] },
            aiContextDebugMode: true,
        });

        const result = await migrateLegacyConfiguration();

        expect(chrome.storage.sync.remove).toHaveBeenCalledWith([
            'maxConcurrentBatches',
            'smartBatching',
            'sidePanelEnabled',
            'sidePanelWordLists',
            'contextModalPosition',
        ]);
        expect(chrome.storage.local.remove).toHaveBeenCalledWith([
            'sidePanelLastTabState',
            'sidePanelSelectionBuckets',
            'aiContextDebugMode',
        ]);
        expect(result.removed).toEqual(
            expect.arrayContaining([
                'sync.sidePanelEnabled',
                'sync.smartBatching',
                'local.sidePanelSelectionBuckets',
                'local.aiContextDebugMode',
            ])
        );
    });

    it('runs only once when startup and install initialization overlap', async () => {
        const first = migrateLegacyConfiguration();
        const second = migrateLegacyConfiguration();

        expect(second).toBe(first);
        await first;
        expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
        expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });

    it('shares a failed attempt, then lets later callers share one successful retry', async () => {
        const migrationError = new Error('sync storage unavailable');
        let rejectFirstAttempt;
        chrome.storage.sync.get
            .mockImplementationOnce(
                () =>
                    new Promise((resolve, reject) => {
                        rejectFirstAttempt = reject;
                    })
            )
            .mockResolvedValue({});

        const first = migrateLegacyConfiguration();
        const concurrent = migrateLegacyConfiguration();
        const firstRejection = expect(first).rejects.toBe(migrationError);
        const concurrentRejection =
            expect(concurrent).rejects.toBe(migrationError);

        expect(concurrent).toBe(first);
        rejectFirstAttempt(migrationError);
        await firstRejection;
        await concurrentRejection;

        const retry = migrateLegacyConfiguration();
        const concurrentRetry = migrateLegacyConfiguration();

        expect(retry).not.toBe(first);
        expect(concurrentRetry).toBe(retry);
        await retry;
        expect(chrome.storage.sync.get).toHaveBeenCalledTimes(2);
        expect(chrome.storage.local.get).toHaveBeenCalledTimes(2);

        expect(migrateLegacyConfiguration()).toBe(retry);
        expect(chrome.storage.sync.get).toHaveBeenCalledTimes(2);
        expect(chrome.storage.local.get).toHaveBeenCalledTimes(2);
    });
});
