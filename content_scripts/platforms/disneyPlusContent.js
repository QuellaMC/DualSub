/**
 * Disney+ Content Script Entry Point
 * 
 * This file serves as the entry point for the Disney+ content script.
 * It instantiates and initializes the DisneyPlusContentScript class.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

(async () => {
    try {
        const { DisneyPlusContentScript } = await import('./DisneyPlusContentScript.js');
        const disneyPlusContentScript = new DisneyPlusContentScript();
        const success = await disneyPlusContentScript.initialize();
        if (success) {
            console.log('[DisneyPlusContent] Content script initialized successfully');
        } else {
            console.error('[DisneyPlusContent] Content script initialization failed');
        }
    } catch (error) {
        console.error('[DisneyPlusContent] Error during initialization:', error);
    }
})();