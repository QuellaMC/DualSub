/**
 * Test Data Fixtures
 *
 * Provides standardized test data for subtitle events, Chrome API responses,
 * and other test scenarios to ensure consistent testing patterns.
 */

/**
 * Netflix Test Fixtures
 */
export const NetflixFixtures = {
    /**
     * Standard Netflix subtitle data event
     */
    subtitleDataEvent: {
        detail: {
            type: 'SUBTITLE_DATA_FOUND',
            payload: {
                movieId: '12345',
                timedtexttracks: [
                    {
                        language: 'en',
                        ttDownloadables: {
                            webvtt: {
                                urls: [
                                    {
                                        url: 'https://netflix.com/subtitle/12345/en.vtt',
                                    },
                                ],
                            },
                        },
                    },
                    {
                        language: 'es',
                        ttDownloadables: {
                            webvtt: {
                                urls: [
                                    {
                                        url: 'https://netflix.com/subtitle/12345/es.vtt',
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        },
    },

    /**
     * Netflix inject script ready event
     */
    injectReadyEvent: {
        detail: {
            type: 'INJECT_SCRIPT_READY',
        },
    },

    /**
     * Netflix subtitle data with missing movieId
     */
    invalidSubtitleDataEvent: {
        detail: {
            type: 'SUBTITLE_DATA_FOUND',
            payload: {
                timedtexttracks: [
                    {
                        language: 'en',
                        ttDownloadables: {
                            webvtt: {
                                urls: [
                                    {
                                        url: 'https://netflix.com/subtitle/unknown/en.vtt',
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        },
    },

    /**
     * Netflix subtitle data with missing timedtexttracks
     */
    missingTracksEvent: {
        detail: {
            type: 'SUBTITLE_DATA_FOUND',
            payload: {
                movieId: '12345',
            },
        },
    },

    /**
     * Netflix location configurations
     */
    locations: {
        validPlayer: {
            hostname: 'www.netflix.com',
            pathname: '/watch/12345',
            protocol: 'https:',
            href: 'https://www.netflix.com/watch/12345',
        },
        browse: {
            hostname: 'www.netflix.com',
            pathname: '/browse',
            protocol: 'https:',
            href: 'https://www.netflix.com/browse',
        },
        home: {
            hostname: 'www.netflix.com',
            pathname: '/',
            protocol: 'https:',
            href: 'https://www.netflix.com/',
        },
    },
};

/**
 * Disney Plus Test Fixtures
 */
export const DisneyPlusFixtures = {
    /**
     * Standard Disney Plus subtitle URL event
     */
    subtitleUrlEvent: {
        detail: {
            type: 'SUBTITLE_URL_FOUND',
            videoId: 'abc123',
            url: 'https://disneyplus.com/subtitle/abc123/master.m3u8',
        },
    },

    /**
     * Disney Plus inject script ready event
     */
    injectReadyEvent: {
        detail: {
            type: 'INJECT_SCRIPT_READY',
        },
    },

    /**
     * Disney Plus subtitle URL event without videoId
     */
    invalidSubtitleUrlEvent: {
        detail: {
            type: 'SUBTITLE_URL_FOUND',
            url: 'https://disneyplus.com/subtitle/unknown/master.m3u8',
        },
    },

    /**
     * Disney Plus location configurations
     */
    locations: {
        validPlayer: {
            hostname: 'www.disneyplus.com',
            pathname: '/video/abc123',
            protocol: 'https:',
            href: 'https://www.disneyplus.com/video/abc123',
        },
        browse: {
            hostname: 'www.disneyplus.com',
            pathname: '/browse',
            protocol: 'https:',
            href: 'https://www.disneyplus.com/browse',
        },
        home: {
            hostname: 'www.disneyplus.com',
            pathname: '/',
            protocol: 'https:',
            href: 'https://www.disneyplus.com/',
        },
    },
};

/**
 * Chrome API Response Fixtures
 */
export const ChromeApiFixtures = {
    /**
     * Standard storage configuration
     */
    storageConfig: {
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useNativeSubtitles: true,
        loggingLevel: 'INFO',
        debugMode: false,
    },

    /**
     * Debug mode storage configuration
     */
    debugStorageConfig: {
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useNativeSubtitles: true,
        loggingLevel: 'DEBUG',
        debugMode: true,
    },

    /**
     * Successful VTT processing response
     */
    successfulVttResponse: {
        success: true,
        videoId: '12345',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        vttText:
            'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nTest subtitle\n\n2\n00:00:03.000 --> 00:00:04.000\n测试字幕',
    },

    /**
     * Failed VTT processing response
     */
    failedVttResponse: {
        success: false,
        error: 'Translation service unavailable',
        videoId: '12345',
    },

    /**
     * Network error response
     */
    networkErrorResponse: {
        success: false,
        error: 'Network timeout',
        url: 'https://netflix.com/subtitle/12345/en.vtt',
    },

    /**
     * Quota exceeded error
     */
    quotaExceededError: {
        message: 'QUOTA_BYTES_PER_ITEM quota exceeded',
    },

    /**
     * Permission denied error
     */
    permissionError: {
        message: 'Extension does not have permission to access storage',
    },
};

/**
 * Test Scenario Generators
 */
export class TestScenarioGenerator {
    /**
     * Generate Netflix test scenarios
     * @returns {Array} Array of test scenarios
     */
    static generateNetflixScenarios() {
        return [
            {
                name: 'Valid subtitle data processing',
                location: NetflixFixtures.locations.validPlayer,
                event: NetflixFixtures.subtitleDataEvent,
                chromeResponse: ChromeApiFixtures.successfulVttResponse,
                expectedOutcome: 'success',
            },
            {
                name: 'Missing movieId handling',
                location: NetflixFixtures.locations.validPlayer,
                event: NetflixFixtures.invalidSubtitleDataEvent,
                chromeResponse: null,
                expectedOutcome: 'error',
            },
            {
                name: 'Missing timedtexttracks handling',
                location: NetflixFixtures.locations.validPlayer,
                event: NetflixFixtures.missingTracksEvent,
                chromeResponse: null,
                expectedOutcome: 'error',
            },
            {
                name: 'Background processing failure',
                location: NetflixFixtures.locations.validPlayer,
                event: NetflixFixtures.subtitleDataEvent,
                chromeResponse: ChromeApiFixtures.failedVttResponse,
                expectedOutcome: 'error',
            },
        ];
    }

    /**
     * Generate Disney Plus test scenarios
     * @returns {Array} Array of test scenarios
     */
    static generateDisneyPlusScenarios() {
        return [
            {
                name: 'Valid subtitle URL processing',
                location: DisneyPlusFixtures.locations.validPlayer,
                event: DisneyPlusFixtures.subtitleUrlEvent,
                chromeResponse: ChromeApiFixtures.successfulVttResponse,
                expectedOutcome: 'success',
            },
            {
                name: 'Missing videoId handling',
                location: DisneyPlusFixtures.locations.validPlayer,
                event: DisneyPlusFixtures.invalidSubtitleUrlEvent,
                chromeResponse: null,
                expectedOutcome: 'error',
            },
            {
                name: 'Network error handling',
                location: DisneyPlusFixtures.locations.validPlayer,
                event: DisneyPlusFixtures.subtitleUrlEvent,
                chromeResponse: ChromeApiFixtures.networkErrorResponse,
                expectedOutcome: 'error',
            },
        ];
    }

    /**
     * Generate platform detection scenarios
     * @returns {Array} Array of platform detection scenarios
     */
    static generatePlatformDetectionScenarios() {
        return [
            // Netflix scenarios
            {
                platform: 'netflix',
                location: NetflixFixtures.locations.validPlayer,
                expectedActive: true,
                expectedPlayerActive: true,
            },
            {
                platform: 'netflix',
                location: NetflixFixtures.locations.browse,
                expectedActive: true,
                expectedPlayerActive: false,
            },
            {
                platform: 'netflix',
                location: NetflixFixtures.locations.home,
                expectedActive: true,
                expectedPlayerActive: false,
            },
            // Disney Plus scenarios
            {
                platform: 'disneyplus',
                location: DisneyPlusFixtures.locations.validPlayer,
                expectedActive: true,
                expectedPlayerActive: true,
            },
            {
                platform: 'disneyplus',
                location: DisneyPlusFixtures.locations.browse,
                expectedActive: true,
                expectedPlayerActive: false,
            },
            {
                platform: 'disneyplus',
                location: DisneyPlusFixtures.locations.home,
                expectedActive: true,
                expectedPlayerActive: false,
            },
        ];
    }
}

/**
 * Mock Response Builder
 * Helps build consistent mock responses for different scenarios
 */
export class MockResponseBuilder {
    /**
     * Build Chrome storage response
     * @param {Object} config - Storage configuration
     * @returns {Function} Mock implementation function
     */
    static buildStorageResponse(config = {}) {
        const defaultConfig = { ...ChromeApiFixtures.storageConfig, ...config };
        return (keys, callback) => {
            callback(defaultConfig);
        };
    }

    /**
     * Build Chrome runtime response
     * @param {Object} response - Runtime response
     * @returns {Function} Mock implementation function
     */
    static buildRuntimeResponse(response = {}) {
        const defaultResponse = {
            ...ChromeApiFixtures.successfulVttResponse,
            ...response,
        };
        return (message, callback) => {
            callback(defaultResponse);
        };
    }

    /**
     * Build error response
     * @param {Object} error - Error object
     * @returns {Function} Mock implementation function that simulates error
     */
    static buildErrorResponse(error) {
        return (keys, callback) => {
            // Simulate Chrome runtime error
            global.chrome.runtime.lastError = error;
            callback();
        };
    }
}

export default {
    NetflixFixtures,
    DisneyPlusFixtures,
    ChromeApiFixtures,
    TestScenarioGenerator,
    MockResponseBuilder,
};
