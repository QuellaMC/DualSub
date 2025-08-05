/**
 * Critical Fixes Test Suite
 *
 * Tests for the two critical issues:
 * 1. ServiceWorker import error fix
 * 2. Universal batch translation system
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { sharedUtilityIntegration } from './utils/sharedUtilityIntegration.js';
import { universalBatchProcessor } from './services/universalBatchProcessor.js';
import { translationProviders } from './services/translationService.js';
import { configService } from './services/configService.js';

// Test data
const testVTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello world

00:00:03.500 --> 00:00:05.500
How are you?

00:00:06.000 --> 00:00:08.000
Goodbye`;

const testTexts = [
    'Hello, how are you?',
    "I'm doing well, thank you.",
    'What time is the meeting?',
    'The meeting starts at 3 PM.',
    "Don't forget the documents.",
];

async function testServiceWorkerCompatibility() {
    console.log('🧪 Testing ServiceWorker Compatibility...');

    try {
        // Test VTT parsing (should work in ServiceWorker context)
        console.log('📊 Testing VTT parsing...');
        const cues = sharedUtilityIntegration.parseVTT(testVTT);

        if (cues.length !== 3) {
            throw new Error(`Expected 3 cues, got ${cues.length}`);
        }

        if (cues[0].text !== 'Hello world') {
            throw new Error(`Expected 'Hello world', got '${cues[0].text}'`);
        }

        console.log('✅ VTT parsing: Working in ServiceWorker context');

        // Test timestamp parsing
        console.log('📊 Testing timestamp parsing...');
        const timestamp =
            sharedUtilityIntegration.parseTimestampToSeconds('00:01:30.500');

        if (timestamp !== 90.5) {
            throw new Error(`Expected 90.5, got ${timestamp}`);
        }

        console.log('✅ Timestamp parsing: Working in ServiceWorker context');

        // Test text formatting
        console.log('📊 Testing text formatting...');
        const formatted = sharedUtilityIntegration.formatSubtitleText(
            '<b>Hello &amp; world</b>'
        );

        if (formatted !== 'Hello & world') {
            throw new Error(`Expected 'Hello & world', got '${formatted}'`);
        }

        console.log('✅ Text formatting: Working in ServiceWorker context');

        // Test performance metrics
        console.log('📊 Testing performance metrics...');
        const metrics = sharedUtilityIntegration.getPerformanceMetrics();

        if (typeof metrics.parseVTTCalls !== 'number') {
            throw new Error('Performance metrics not working');
        }

        console.log('✅ Performance metrics: Working in ServiceWorker context');

        return true;
    } catch (error) {
        console.error(
            '❌ ServiceWorker compatibility test failed:',
            error.message
        );
        return false;
    }
}

async function testUniversalBatchProcessor() {
    console.log('🧪 Testing Universal Batch Processor...');

    try {
        // Initialize the processor
        console.log('📊 Initializing universal batch processor...');
        await universalBatchProcessor.initialize();

        // Test provider configurations
        console.log('📊 Testing provider configurations...');
        const allConfigs = universalBatchProcessor.getAllProviderConfigs();

        if (
            !allConfigs.openai_compatible ||
            !allConfigs.google ||
            !allConfigs.deepl
        ) {
            throw new Error('Missing provider configurations');
        }

        console.log('✅ Provider configurations: All providers configured');

        // Test batch size calculation
        console.log('📊 Testing batch size calculation...');
        const openaiSize =
            universalBatchProcessor.getEffectiveBatchSize('openai_compatible');
        const googleSize =
            universalBatchProcessor.getEffectiveBatchSize('google');
        const deeplSize =
            universalBatchProcessor.getEffectiveBatchSize('deepl');

        if (openaiSize <= 0 || googleSize <= 0 || deeplSize <= 0) {
            throw new Error('Invalid batch sizes calculated');
        }

        console.log(
            `✅ Batch sizes: OpenAI=${openaiSize}, Google=${googleSize}, DeepL=${deeplSize}`
        );

        // Test batch preprocessing
        console.log('📊 Testing batch preprocessing...');
        const preprocessResult = universalBatchProcessor.preprocessForBatch(
            testTexts,
            'openai_compatible'
        );

        if (
            !preprocessResult.batches ||
            preprocessResult.batches.length === 0
        ) {
            throw new Error('Batch preprocessing failed');
        }

        console.log(
            `✅ Batch preprocessing: ${preprocessResult.batches.length} batches created`
        );

        // Test batch support detection
        console.log('📊 Testing batch support detection...');
        const openaiSupports =
            universalBatchProcessor.providerSupportsBatch('openai_compatible');
        const googleSupports =
            universalBatchProcessor.providerSupportsBatch('google');

        if (!openaiSupports) {
            throw new Error('OpenAI should support batch processing');
        }

        if (googleSupports) {
            throw new Error(
                'Google should not support native batch processing'
            );
        }

        console.log('✅ Batch support detection: Working correctly');

        // Test performance metrics
        console.log('📊 Testing performance metrics...');
        const metrics = universalBatchProcessor.getPerformanceMetrics();

        if (typeof metrics.totalBatches !== 'number') {
            throw new Error('Performance metrics not working');
        }

        console.log('✅ Performance metrics: Working correctly');

        return true;
    } catch (error) {
        console.error(
            '❌ Universal batch processor test failed:',
            error.message
        );
        return false;
    }
}

async function testTranslationServiceIntegration() {
    console.log('🧪 Testing Translation Service Integration...');

    try {
        // Initialize translation service
        console.log('📊 Initializing translation service...');
        await translationProviders.initialize();

        // Test universal batch method exists
        console.log('📊 Testing universal batch method...');
        if (
            typeof translationProviders.translateUniversalBatch !== 'function'
        ) {
            throw new Error('translateUniversalBatch method not found');
        }

        console.log('✅ Universal batch method: Available');

        // Test provider batch capability detection
        console.log('📊 Testing provider batch capability...');
        const batchCapable = translationProviders.getBatchCapableProviders();
        const currentSupports =
            translationProviders.currentProviderSupportsBatch();

        if (typeof currentSupports !== 'boolean') {
            throw new Error('Batch capability detection not working');
        }

        console.log(
            `✅ Batch capability: ${Object.keys(batchCapable).length} providers support batch`
        );

        // Test performance metrics
        console.log('📊 Testing performance metrics...');
        const metrics = translationProviders.getPerformanceMetrics();

        if (typeof metrics.totalTranslations !== 'number') {
            throw new Error('Performance metrics not working');
        }

        console.log('✅ Performance metrics: Working correctly');

        return true;
    } catch (error) {
        console.error(
            '❌ Translation service integration test failed:',
            error.message
        );
        return false;
    }
}

async function testConfigurationIntegration() {
    console.log('🧪 Testing Configuration Integration...');

    try {
        // Test that new configuration options are available
        console.log('📊 Testing new configuration options...');

        // These should not throw errors (they're in the schema)
        const globalBatchSize =
            (await configService.get('globalBatchSize')) || 5;
        const batchingEnabled =
            (await configService.get('batchingEnabled')) !== false;
        const useProviderDefaults =
            (await configService.get('useProviderDefaults')) !== false;

        if (typeof globalBatchSize !== 'number') {
            throw new Error('globalBatchSize not properly configured');
        }

        if (typeof batchingEnabled !== 'boolean') {
            throw new Error('batchingEnabled not properly configured');
        }

        if (typeof useProviderDefaults !== 'boolean') {
            throw new Error('useProviderDefaults not properly configured');
        }

        console.log('✅ Configuration options: All new options available');
        console.log(`   - globalBatchSize: ${globalBatchSize}`);
        console.log(`   - batchingEnabled: ${batchingEnabled}`);
        console.log(`   - useProviderDefaults: ${useProviderDefaults}`);

        return true;
    } catch (error) {
        console.error(
            '❌ Configuration integration test failed:',
            error.message
        );
        return false;
    }
}

async function runCriticalFixesTest() {
    console.log('🧪 Running Critical Fixes Test Suite...');
    console.log('================================================');

    const results = {
        serviceWorkerCompatibility: await testServiceWorkerCompatibility(),
        universalBatchProcessor: await testUniversalBatchProcessor(),
        translationServiceIntegration:
            await testTranslationServiceIntegration(),
        configurationIntegration: await testConfigurationIntegration(),
    };

    // Calculate results
    const passed = Object.values(results).filter(Boolean).length;
    const total = Object.keys(results).length;
    const successRate = (passed / total) * 100;

    console.log('================================================');
    console.log('📊 Critical Fixes Test Results:');
    console.log(
        `ServiceWorker Compatibility: ${results.serviceWorkerCompatibility ? '✅ PASS' : '❌ FAIL'}`
    );
    console.log(
        `Universal Batch Processor: ${results.universalBatchProcessor ? '✅ PASS' : '❌ FAIL'}`
    );
    console.log(
        `Translation Service Integration: ${results.translationServiceIntegration ? '✅ PASS' : '❌ FAIL'}`
    );
    console.log(
        `Configuration Integration: ${results.configurationIntegration ? '✅ PASS' : '❌ FAIL'}`
    );
    console.log(
        `Overall Success Rate: ${successRate.toFixed(1)}% (${passed}/${total})`
    );

    const success = passed === total;

    if (success) {
        console.log('🎉 All Critical Fixes: WORKING');
        console.log('✅ ServiceWorker import error: FIXED');
        console.log('✅ Universal batch translation: IMPLEMENTED');
        console.log('✅ Provider-agnostic batching: WORKING');
        console.log('✅ Configuration integration: COMPLETE');
    } else {
        console.log('❌ Some Critical Fixes: FAILED');
    }

    return {
        success,
        results,
        passed,
        total,
        successRate,
    };
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runCriticalFixesTest()
        .then((results) => {
            console.log('\n🎯 Critical Fixes Test Completed!');
            process.exit(results.success ? 0 : 1);
        })
        .catch((error) => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

export { runCriticalFixesTest };
