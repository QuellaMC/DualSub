/**
 * Entry point for the Hulu content script.
 *
 * This script initializes and runs the Hulu-specific content script,
 * which is responsible for all platform-specific interactions.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

(async () => {
    console.log('[HuluContent] Script loading and initializing.');
    try {
        const { HuluContentScript } = await import(
            './HuluContentScript.js'
        );
        const huluContentScript = new HuluContentScript();
        if (await huluContentScript.initialize()) {
            console.log('[HuluContent] Content script initialized successfully.');
        } else {
            console.error('[HuluContent] Content script initialization failed.');
        }
    } catch (error) {
        console.error('[HuluContent] An error occurred during initialization:', error);
    }
})();