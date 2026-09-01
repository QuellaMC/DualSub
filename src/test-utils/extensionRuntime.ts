import { fakeBrowser } from 'wxt/testing/fake-browser';

export const TEST_EXTENSION_ID = 'abcdefghijklmnop';
export const TEST_EXTENSION_ORIGIN = `chrome-extension://${TEST_EXTENSION_ID}`;

/**
 * Give the fake browser a coherent extension identity for sender
 * classification: id, manifest entrypoints, and getURL. fakeBrowser's own
 * getURL closes over an internal runtime record, so assigning `id` alone is
 * not enough — the stub must replace getURL as well. Call after any
 * fakeBrowser.reset().
 */
export function installExtensionRuntimeIdentity(): void {
    const runtime = fakeBrowser.runtime as {
        id: string;
        getManifest?: () => unknown;
        getURL: (path: string) => string;
    };
    runtime.id = TEST_EXTENSION_ID;
    runtime.getManifest = () => ({
        background: { service_worker: 'background.js' },
        options_ui: { page: 'options.html' },
        action: { default_popup: 'popup.html' },
        side_panel: { default_path: 'sidepanel.html' },
    });
    runtime.getURL = (path: string) =>
        `${TEST_EXTENSION_ORIGIN}/${path.replace(/^\//, '')}`;
}
