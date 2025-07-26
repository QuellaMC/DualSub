/**
 * Netflix Content Script Entry Point
 * 
 * This file serves as the entry point for the Netflix content script.
 * It instantiates and initializes the NetflixContentScript class.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

(async () => {
    try {
        const { NetflixContentScript } = await import('./NetflixContentScript.js');
        const netflixContentScript = new NetflixContentScript();
        const success = await netflixContentScript.initialize();
        if (success) {
            console.log('[NetflixContent] Content script initialized successfully');
        } else {
            console.error('[NetflixContent] Content script initialization failed');
        }
    } catch (error) {
        console.error('[NetflixContent] Error during initialization:', error);
    }
})();
