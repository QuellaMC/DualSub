/**
 * Entry point for the Disney+ content script.
 *
 * This script initializes and runs the Disney+ specific content script,
 * which is responsible for all platform-specific interactions.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

(async () => {
    console.log('[DisneyPlusContent] Script loading and initializing.');
    try {
        const { DisneyPlusContentScript } = await import(
            './DisneyPlusContentScript.js'
        );
        const disneyPlusContentScript = new DisneyPlusContentScript();
        if (await disneyPlusContentScript.initialize()) {
            console.log(
                '[DisneyPlusContent] Content script initialized successfully.'
            );
        } else {
            console.error(
                '[DisneyPlusContent] Content script initialization failed.'
            );
        }
    } catch (error) {
        console.error(
            '[DisneyPlusContent] An error occurred during initialization:',
            error
        );
    }
})();
