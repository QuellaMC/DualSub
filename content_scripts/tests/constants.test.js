/**
 * Tests for content script constants
 */

import { 
    COMMON_CONSTANTS, 
    PLATFORM_CONSTANTS, 
    DEFAULT_PLATFORM_CONFIGS 
} from '../core/constants.js';

describe('Content Script Constants', () => {
    describe('COMMON_CONSTANTS', () => {
        test('should have all required video detection constants', () => {
            expect(COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES).toBe(30);
            expect(COMMON_CONSTANTS.VIDEO_DETECTION_INTERVAL).toBe(1000);
        });

        test('should have navigation constants', () => {
            expect(COMMON_CONSTANTS.URL_CHECK_INTERVAL).toBe(2000);
            expect(COMMON_CONSTANTS.NAVIGATION_DELAY).toBe(100);
        });

        test('should have UI-only settings array', () => {
            expect(Array.isArray(COMMON_CONSTANTS.UI_ONLY_SETTINGS)).toBe(true);
            expect(COMMON_CONSTANTS.UI_ONLY_SETTINGS).toContain('appearanceAccordionOpen');
        });
    });

    describe('PLATFORM_CONSTANTS', () => {
        test('should have Netflix constants', () => {
            const netflix = PLATFORM_CONSTANTS.netflix;
            expect(netflix.INJECT_SCRIPT_FILENAME).toBe('injected_scripts/netflixInject.js');
            expect(netflix.INJECT_SCRIPT_TAG_ID).toBe('netflix-dualsub-injector-script-tag');
            expect(netflix.INJECT_EVENT_ID).toBe('netflix-dualsub-injector-event');
            expect(netflix.URL_PATTERNS).toContain('netflix.com');
            expect(netflix.PLAYER_URL_PATTERN).toBe('/watch/');
            expect(netflix.LOG_PREFIX).toBe('NetflixContent');
        });

        test('should have Disney+ constants', () => {
            const disneyplus = PLATFORM_CONSTANTS.disneyplus;
            expect(disneyplus.INJECT_SCRIPT_FILENAME).toBe('injected_scripts/disneyPlusInject.js');
            expect(disneyplus.INJECT_SCRIPT_TAG_ID).toBe('disneyplus-dualsub-injector-script-tag');
            expect(disneyplus.INJECT_EVENT_ID).toBe('disneyplus-dualsub-injector-event');
            expect(disneyplus.URL_PATTERNS).toContain('disneyplus.com');
            expect(disneyplus.PLAYER_URL_PATTERN).toBe('/video/');
            expect(disneyplus.LOG_PREFIX).toBe('DisneyPlusContent');
        });
    });

    describe('DEFAULT_PLATFORM_CONFIGS', () => {
        test('should have valid Netflix configuration', () => {
            const netflix = DEFAULT_PLATFORM_CONFIGS.netflix;
            expect(netflix.name).toBe('netflix');
            expect(netflix.injectScript.filename).toBe(PLATFORM_CONSTANTS.netflix.INJECT_SCRIPT_FILENAME);
            expect(netflix.navigation.spaHandling).toBe(true);
            expect(netflix.videoDetection.maxRetries).toBe(COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES);
        });

        test('should have valid Disney+ configuration', () => {
            const disneyplus = DEFAULT_PLATFORM_CONFIGS.disneyplus;
            expect(disneyplus.name).toBe('disneyplus');
            expect(disneyplus.injectScript.filename).toBe(PLATFORM_CONSTANTS.disneyplus.INJECT_SCRIPT_FILENAME);
            expect(disneyplus.navigation.spaHandling).toBe(false);
            expect(disneyplus.videoDetection.maxRetries).toBe(COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES);
        });

        test('should have consistent structure across platforms', () => {
            const platforms = Object.values(DEFAULT_PLATFORM_CONFIGS);
            
            platforms.forEach(platform => {
                expect(platform).toHaveProperty('name');
                expect(platform).toHaveProperty('injectScript');
                expect(platform).toHaveProperty('navigation');
                expect(platform).toHaveProperty('videoDetection');
                expect(platform).toHaveProperty('logPrefix');
                
                expect(platform.injectScript).toHaveProperty('filename');
                expect(platform.injectScript).toHaveProperty('tagId');
                expect(platform.injectScript).toHaveProperty('eventId');
                
                expect(platform.navigation).toHaveProperty('urlPatterns');
                expect(platform.navigation).toHaveProperty('spaHandling');
                expect(platform.navigation).toHaveProperty('checkInterval');
                
                expect(platform.videoDetection).toHaveProperty('maxRetries');
                expect(platform.videoDetection).toHaveProperty('retryInterval');
            });
        });
    });
});