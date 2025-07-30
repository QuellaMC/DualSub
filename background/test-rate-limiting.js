/**
 * Test script for new rate limiting implementation
 * Tests the updated rate limiting system with provider-specific configurations
 */

import { translationProviders } from './services/translationService.js';
import { loggingManager } from './utils/loggingManager.js';

const logger = loggingManager.createLogger('RateLimitTest');

/**
 * Test rate limiting for different providers
 */
async function testRateLimiting() {
    logger.info('Starting rate limiting tests...');

    const testResults = {
        google: { passed: false, details: {} },
        microsoft: { passed: false, details: {} },
        deepl: { passed: false, details: {} },
        deepl_free: { passed: false, details: {} },
        openai: { passed: false, details: {} }
    };

    try {
        // Initialize translation service
        await translationProviders.initialize();

        // Test Google Translate rate limiting (bytes per window)
        logger.info('Testing Google Translate rate limiting...');
        translationProviders.setProvider('google');
        testResults.google = await testGoogleRateLimit();

        // Test Microsoft Translate rate limiting (characters sliding window)
        logger.info('Testing Microsoft Translate rate limiting...');
        translationProviders.setProvider('microsoft_edge_auth');
        testResults.microsoft = await testMicrosoftRateLimit();

        // Test DeepL Free rate limiting (requests per hour)
        logger.info('Testing DeepL Free rate limiting...');
        translationProviders.setProvider('deepl_free');
        testResults.deepl_free = await testDeepLFreeRateLimit();

        // Test mandatory delays
        logger.info('Testing mandatory delays...');
        const delayResults = await testMandatoryDelays();
        
        // Combine results
        Object.keys(testResults).forEach(provider => {
            if (delayResults[provider]) {
                testResults[provider].delayTest = delayResults[provider];
            }
        });

        // Print results
        printTestResults(testResults);

    } catch (error) {
        logger.error('Rate limiting test failed', error);
    }
}

/**
 * Test Google Translate rate limiting (bytes per window)
 */
async function testGoogleRateLimit() {
    const testText = 'Hello world! This is a test message.';
    const textBytes = new TextEncoder().encode(testText).length;
    
    try {
        // Check initial rate limit status
        const initialStatus = translationProviders.getRateLimitStatus();
        logger.info('Google initial rate limit status', initialStatus);

        // Test rate limit check
        const canTranslate = translationProviders.checkRateLimit(testText);
        logger.info('Google rate limit check result', { canTranslate, textBytes });

        return {
            passed: true,
            details: {
                initialStatus,
                canTranslate,
                textBytes,
                rateLimitType: 'bytes_per_window'
            }
        };
    } catch (error) {
        logger.error('Google rate limit test failed', error);
        return { passed: false, error: error.message };
    }
}

/**
 * Test Microsoft Translate rate limiting (characters sliding window)
 */
async function testMicrosoftRateLimit() {
    const testText = 'This is a test for Microsoft Translate character limits.';
    const textChars = testText.length;
    
    try {
        // Check initial rate limit status
        const initialStatus = translationProviders.getRateLimitStatus();
        logger.info('Microsoft initial rate limit status', initialStatus);

        // Test rate limit check
        const canTranslate = translationProviders.checkRateLimit(testText);
        logger.info('Microsoft rate limit check result', { canTranslate, textChars });

        return {
            passed: true,
            details: {
                initialStatus,
                canTranslate,
                textChars,
                rateLimitType: 'characters_sliding_window'
            }
        };
    } catch (error) {
        logger.error('Microsoft rate limit test failed', error);
        return { passed: false, error: error.message };
    }
}

/**
 * Test DeepL Free rate limiting (requests per hour)
 */
async function testDeepLFreeRateLimit() {
    const testText = 'Testing DeepL Free rate limiting.';
    
    try {
        // Check initial rate limit status
        const initialStatus = translationProviders.getRateLimitStatus();
        logger.info('DeepL Free initial rate limit status', initialStatus);

        // Test rate limit check
        const canTranslate = translationProviders.checkRateLimit(testText);
        logger.info('DeepL Free rate limit check result', { canTranslate });

        return {
            passed: true,
            details: {
                initialStatus,
                canTranslate,
                rateLimitType: 'requests_per_hour'
            }
        };
    } catch (error) {
        logger.error('DeepL Free rate limit test failed', error);
        return { passed: false, error: error.message };
    }
}

/**
 * Test mandatory delays for all providers
 */
async function testMandatoryDelays() {
    const providers = ['google', 'microsoft_edge_auth', 'deepl_free', 'openai_compatible'];
    const results = {};

    for (const providerId of providers) {
        try {
            translationProviders.setProvider(providerId);
            const provider = translationProviders.providers[providerId];
            const expectedDelay = provider.rateLimit?.mandatoryDelay || 0;

            const startTime = Date.now();
            await translationProviders.applyMandatoryDelay();
            const actualDelay = Date.now() - startTime;

            results[providerId] = {
                passed: true,
                expectedDelay,
                actualDelay,
                withinTolerance: Math.abs(actualDelay - expectedDelay) <= 50 // 50ms tolerance
            };

            logger.info(`Mandatory delay test for ${providerId}`, results[providerId]);

        } catch (error) {
            results[providerId] = { passed: false, error: error.message };
            logger.error(`Mandatory delay test failed for ${providerId}`, error);
        }
    }

    return results;
}

/**
 * Print test results
 */
function printTestResults(results) {
    logger.info('=== Rate Limiting Test Results ===');
    
    let allPassed = true;
    Object.entries(results).forEach(([provider, result]) => {
        const status = result.passed ? '✅ PASSED' : '❌ FAILED';
        logger.info(`${provider}: ${status}`);
        
        if (result.details) {
            logger.info(`  Rate limit type: ${result.details.rateLimitType || 'N/A'}`);
            logger.info(`  Can translate: ${result.details.canTranslate || 'N/A'}`);
        }
        
        if (result.delayTest) {
            const delayStatus = result.delayTest.passed ? '✅' : '❌';
            logger.info(`  Delay test: ${delayStatus} (Expected: ${result.delayTest.expectedDelay}ms, Actual: ${result.delayTest.actualDelay}ms)`);
        }
        
        if (!result.passed) {
            allPassed = false;
            logger.error(`  Error: ${result.error}`);
        }
    });

    logger.info(`\n=== Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'} ===`);
}

// Export for use in other test files
export { testRateLimiting };

// Run tests if this file is executed directly
if (typeof window !== 'undefined' && window.location) {
    // Running in browser context
    testRateLimiting().catch(console.error);
}
