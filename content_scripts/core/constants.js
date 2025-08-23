/**
 * Centralized constants for content script configuration and platform settings.
 * This file consolidates settings for video detection, navigation, initialization,
 * and platform-specific configurations to ensure consistency and ease of maintenance.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * Common constants shared across all platform content scripts.
 */
export const COMMON_CONSTANTS = {
    // Video and Player Detection
    MAX_VIDEO_DETECTION_RETRIES: 30,
    VIDEO_DETECTION_INTERVAL: 1000,
    VIDEO_DETECTION_MAX_INTERVAL: 5000,

    // Progress bar detection settings
    MAX_FIND_PROGRESS_BAR_RETRIES: 100,
    FIND_PROGRESS_BAR_INTERVAL: 500,

    // Navigation and Initialization
    URL_CHECK_INTERVAL: 2000,
    NAVIGATION_DELAY: 100,
    PLATFORM_INIT_DELAY: 1000,
    REINIT_DELAY: 1500,

    // Retry and Timeout Settings
    PLATFORM_INIT_MAX_RETRIES: 3,
    PLATFORM_INIT_RETRY_DELAY: 1000,
    PLATFORM_INIT_TIMEOUT: 10000,
    CLEANUP_TIMEOUT: 5000,

    // Logging and Configuration
    TIME_UPDATE_LOG_INTERVAL: 30,
    UI_ONLY_SETTINGS: ['appearanceAccordionOpen'],
};

/**
 * Platform-specific constants for injection and identification.
 */
export const PLATFORM_CONSTANTS = {
    netflix: {
        INJECT_SCRIPT_FILENAME: 'injected_scripts/netflixInject.js',
        INJECT_SCRIPT_TAG_ID: 'netflix-dualsub-injector-script-tag',
        INJECT_EVENT_ID: 'netflix-dualsub-injector-event',
        URL_PATTERNS: ['netflix.com'],
        PLAYER_URL_PATTERN: '/watch/',
        LOG_PREFIX: 'NetflixContent',
    },
    disneyplus: {
        INJECT_SCRIPT_FILENAME: 'injected_scripts/disneyPlusInject.js',
        INJECT_SCRIPT_TAG_ID: 'disneyplus-dualsub-injector-script-tag',
        INJECT_EVENT_ID: 'disneyplus-dualsub-injector-event',
        URL_PATTERNS: ['disneyplus.com'],
        PLAYER_URL_PATTERN: '/video/',
        LOG_PREFIX: 'DisneyPlusContent',
    },
};

/**
 * Default configurations for each supported platform.
 */
export const DEFAULT_PLATFORM_CONFIGS = {
    netflix: {
        name: 'netflix',
        injectScript: {
            filename: PLATFORM_CONSTANTS.netflix.INJECT_SCRIPT_FILENAME,
            tagId: PLATFORM_CONSTANTS.netflix.INJECT_SCRIPT_TAG_ID,
            eventId: PLATFORM_CONSTANTS.netflix.INJECT_EVENT_ID,
        },
        navigation: {
            urlPatterns: PLATFORM_CONSTANTS.netflix.URL_PATTERNS,
            spaHandling: true,
            checkInterval: COMMON_CONSTANTS.URL_CHECK_INTERVAL,
            playerUrlPattern: PLATFORM_CONSTANTS.netflix.PLAYER_URL_PATTERN,
        },
        videoDetection: {
            maxRetries: COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES,
            retryInterval: COMMON_CONSTANTS.VIDEO_DETECTION_INTERVAL,
        },
        logPrefix: PLATFORM_CONSTANTS.netflix.LOG_PREFIX,
    },
    disneyplus: {
        name: 'disneyplus',
        injectScript: {
            filename: PLATFORM_CONSTANTS.disneyplus.INJECT_SCRIPT_FILENAME,
            tagId: PLATFORM_CONSTANTS.disneyplus.INJECT_SCRIPT_TAG_ID,
            eventId: PLATFORM_CONSTANTS.disneyplus.INJECT_EVENT_ID,
        },
        navigation: {
            urlPatterns: PLATFORM_CONSTANTS.disneyplus.URL_PATTERNS,
            spaHandling: false,
            checkInterval: COMMON_CONSTANTS.URL_CHECK_INTERVAL,
            playerUrlPattern: PLATFORM_CONSTANTS.disneyplus.PLAYER_URL_PATTERN,
        },
        videoDetection: {
            maxRetries: COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES,
            retryInterval: COMMON_CONSTANTS.VIDEO_DETECTION_INTERVAL,
        },
        logPrefix: PLATFORM_CONSTANTS.disneyplus.LOG_PREFIX,
    },
};
