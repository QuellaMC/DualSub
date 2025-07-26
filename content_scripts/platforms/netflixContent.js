/**
 * Entry point for the Netflix content script.
 *
 * This script initializes and runs the Netflix-specific content script,
 * which is responsible for all platform-specific interactions.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

(async () => {
    console.log('[NetflixContent] Script loading and initializing.');
    try {
        const { NetflixContentScript } = await import('./NetflixContentScript.js');
        const netflixContentScript = new NetflixContentScript();
        if (await netflixContentScript.initialize()) {
            console.log('[NetflixContent] Content script initialized successfully.');
        } else {
            console.error('[NetflixContent] Content script initialization failed.');
        }
    } catch (error) {
        console.error('[NetflixContent] An error occurred during initialization:', error);
    }
})();
