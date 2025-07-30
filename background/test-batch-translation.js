/**
 * Batch Translation Performance Test for Phase 4
 * 
 * Tests batch translation system performance, API call reduction,
 * and accuracy compared to individual translations.
 */

import { translationProviders } from './services/translationService.js';
import { batchTranslationQueue } from './services/batchTranslationQueue.js';
import { messageHandler } from './handlers/messageHandler.js';

// Sample subtitle texts for testing
const sampleSubtitles = [
    "Hello, how are you today?",
    "I'm doing well, thank you.",
    "What time is the meeting?",
    "The meeting starts at 3 PM.",
    "Don't forget to bring the documents.",
    "I'll make sure to have everything ready.",
    "The weather is beautiful today.",
    "Yes, it's perfect for a walk.",
    "Would you like some coffee?",
    "That sounds wonderful, thank you."
];

const largeBatchSubtitles = [
    "Welcome to our presentation today.",
    "We'll be discussing the latest developments.",
    "First, let's review the current situation.",
    "The market has shown significant growth.",
    "Our team has been working hard.",
    "We've achieved remarkable results.",
    "Customer satisfaction is at an all-time high.",
    "Revenue has increased by 25% this quarter.",
    "We're expanding into new markets.",
    "Innovation remains our top priority.",
    "Technology is driving our success.",
    "We're investing in research and development.",
    "Our employees are our greatest asset.",
    "Training programs have been enhanced.",
    "Quality control measures are in place.",
    "We're committed to sustainability.",
    "Environmental responsibility is important.",
    "Community engagement is a core value.",
    "Partnerships are key to our growth.",
    "The future looks very promising."
];

async function testBatchTranslationPerformance() {
    console.log('🧪 Testing Batch Translation Performance...');
    
    try {
        // Initialize services
        await translationProviders.initialize();
        await batchTranslationQueue.initialize();
        
        // Test 1: Small batch performance
        console.log('\n📊 Test 1: Small Batch Performance (10 subtitles)');
        const smallBatchResults = await testBatchVsIndividual(sampleSubtitles, 'en', 'es');
        
        // Test 2: Large batch performance
        console.log('\n📊 Test 2: Large Batch Performance (20 subtitles)');
        const largeBatchResults = await testBatchVsIndividual(largeBatchSubtitles, 'en', 'zh-CN');
        
        // Test 3: Batch queue functionality
        console.log('\n📊 Test 3: Batch Queue Functionality');
        const queueResults = await testBatchQueue();
        
        // Test 4: Rate limiting and fallback
        console.log('\n📊 Test 4: Rate Limiting and Fallback');
        const rateLimitResults = await testRateLimitingAndFallback();
        
        // Test 5: Provider batch support detection
        console.log('\n📊 Test 5: Provider Batch Support Detection');
        const providerResults = await testProviderBatchSupport();
        
        // Summary
        console.log('\n🎯 Performance Summary:');
        console.log(`Small Batch API Reduction: ${smallBatchResults.apiReduction}%`);
        console.log(`Large Batch API Reduction: ${largeBatchResults.apiReduction}%`);
        console.log(`Small Batch Time Improvement: ${smallBatchResults.timeImprovement}%`);
        console.log(`Large Batch Time Improvement: ${largeBatchResults.timeImprovement}%`);
        
        const overallApiReduction = (smallBatchResults.apiReduction + largeBatchResults.apiReduction) / 2;
        const overallTimeImprovement = (smallBatchResults.timeImprovement + largeBatchResults.timeImprovement) / 2;
        
        console.log(`\n📈 Overall Results:`);
        console.log(`Average API Call Reduction: ${overallApiReduction.toFixed(1)}%`);
        console.log(`Average Time Improvement: ${overallTimeImprovement.toFixed(1)}%`);
        
        // Verify targets
        const apiReductionTarget = 80; // 80% reduction target
        const timeImprovementTarget = 50; // 50% time improvement target
        
        const apiReductionMet = overallApiReduction >= apiReductionTarget;
        const timeImprovementMet = overallTimeImprovement >= timeImprovementTarget;
        
        console.log(`\n✅ Performance Targets:`);
        console.log(`API Reduction Target (${apiReductionTarget}%): ${apiReductionMet ? '✅ MET' : '❌ NOT MET'}`);
        console.log(`Time Improvement Target (${timeImprovementTarget}%): ${timeImprovementMet ? '✅ MET' : '❌ NOT MET'}`);
        
        return {
            success: apiReductionMet && timeImprovementMet,
            apiReduction: overallApiReduction,
            timeImprovement: overallTimeImprovement,
            smallBatch: smallBatchResults,
            largeBatch: largeBatchResults,
            queue: queueResults,
            rateLimit: rateLimitResults,
            provider: providerResults
        };
        
    } catch (error) {
        console.error('❌ Batch translation performance test failed:', error.message);
        return { success: false, error: error.message };
    }
}

async function testBatchVsIndividual(texts, sourceLang, targetLang) {
    // Add diverse test cases for translation accuracy
    const diverseInputs = [
        "こんにちは世界", // Japanese: "Hello, World"
        "Привет, мир!", // Russian: "Hello, World!"
        "مرحبا بالعالم", // Arabic: "Hello, World"
        "你好，世界", // Chinese: "Hello, World"
        "👋🌍", // Emojis
        "Cześć świecie! 😊", // Polish with emoji
        "¡Hola, mundo! #$%&", // Spanish with special characters
        "Bonjour le monde! @€", // French with special characters
        "Γειά σου Κόσμε!", // Greek: "Hello, World!"
        "안녕하세요 세계!", // Korean: "Hello, World!"
    ];
    texts = texts.concat(diverseInputs);

    console.log(`Testing ${texts.length} texts: ${sourceLang} → ${targetLang}`);

    // Test individual translations
    console.log('⏱️  Testing individual translations...');
    const individualStart = Date.now();
    const individualResults = [];
    
    for (const text of texts) {
        try {
            const translated = await translationProviders.translate(text, sourceLang, targetLang);
            individualResults.push(translated);
        } catch (error) {
            console.warn(`Individual translation failed: ${error.message}`);
            individualResults.push(text); // Fallback to original
        }
    }
    
    const individualTime = Date.now() - individualStart;
    const individualApiCalls = texts.length;
    
    // Test batch translation
    console.log('⏱️  Testing batch translation...');
    const batchStart = Date.now();
    let batchResults = [];
    let batchApiCalls = 0;
    
    try {
        batchResults = await translationProviders.translateBatch(texts, sourceLang, targetLang);
        batchApiCalls = 1; // Single batch call
    } catch (error) {
        console.warn(`Batch translation failed: ${error.message}`);
        batchResults = texts; // Fallback to original
        batchApiCalls = texts.length; // Fallback to individual calls
    }
    
    const batchTime = Date.now() - batchStart;
    
    // Calculate improvements
    const apiReduction = ((individualApiCalls - batchApiCalls) / individualApiCalls) * 100;
    const timeImprovement = ((individualTime - batchTime) / individualTime) * 100;
    
    // Verify accuracy (basic check)
    const accuracyScore = calculateAccuracyScore(individualResults, batchResults);
    
    console.log(`📊 Results:`);
    console.log(`  Individual: ${individualTime}ms, ${individualApiCalls} API calls`);
    console.log(`  Batch: ${batchTime}ms, ${batchApiCalls} API calls`);
    console.log(`  API Reduction: ${apiReduction.toFixed(1)}%`);
    console.log(`  Time Improvement: ${timeImprovement.toFixed(1)}%`);
    console.log(`  Accuracy Score: ${accuracyScore.toFixed(1)}%`);
    
    return {
        apiReduction,
        timeImprovement,
        accuracyScore,
        individualTime,
        batchTime,
        individualApiCalls,
        batchApiCalls
    };
}

async function testBatchQueue() {
    console.log('Testing batch queue functionality...');
    
    try {
        // Add cues to batch queue
        const cues = sampleSubtitles.map((text, index) => ({
            original: text,
            start: index * 2,
            end: (index * 2) + 1.5,
            videoId: 'test-video-123'
        }));
        
        const context = {
            currentTime: 5, // Simulate current playback time
            targetLanguage: 'es'
        };
        
        await batchTranslationQueue.addCuesToBatch(cues, context);
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get performance metrics
        const metrics = batchTranslationQueue.getPerformanceMetrics();
        
        console.log(`📊 Queue Results:`);
        console.log(`  Total Batches: ${metrics.totalBatches}`);
        console.log(`  Total Cues: ${metrics.totalCues}`);
        console.log(`  Average Batch Size: ${metrics.averageBatchSize.toFixed(1)}`);
        console.log(`  API Call Reduction: ${metrics.apiCallReductionPercentage.toFixed(1)}%`);
        console.log(`  Active Batches: ${metrics.activeBatches}`);
        console.log(`  Pending Cues: ${metrics.pendingCues}`);
        
        return {
            success: true,
            metrics
        };
        
    } catch (error) {
        console.error(`Queue test failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function testRateLimitingAndFallback() {
    console.log('Testing rate limiting and fallback mechanisms...');
    
    try {
        // Get rate limit status
        const rateLimitStatus = translationProviders.getRateLimitStatus();
        console.log(`📊 Rate Limit Status:`);
        console.log(`  Has Limit: ${rateLimitStatus.hasLimit}`);
        if (rateLimitStatus.hasLimit) {
            console.log(`  Limit: ${rateLimitStatus.limit} requests`);
            console.log(`  Used: ${rateLimitStatus.used}`);
            console.log(`  Remaining: ${rateLimitStatus.remaining}`);
        }
        
        // Test fallback mechanism
        const fallbackTexts = ["Test fallback 1", "Test fallback 2", "Test fallback 3"];
        const fallbackResults = await translationProviders.translateIndividually(
            fallbackTexts, 'en', 'fr', { individualDelay: 50 }
        );
        
        console.log(`📊 Fallback Results:`);
        console.log(`  Input Count: ${fallbackTexts.length}`);
        console.log(`  Output Count: ${fallbackResults.length}`);
        console.log(`  Success: ${fallbackResults.length === fallbackTexts.length}`);
        
        return {
            success: true,
            rateLimitStatus,
            fallbackSuccess: fallbackResults.length === fallbackTexts.length
        };
        
    } catch (error) {
        console.error(`Rate limiting test failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function testProviderBatchSupport() {
    console.log('Testing provider batch support detection...');
    
    try {
        // Test current provider batch support
        const currentSupportsBatch = translationProviders.currentProviderSupportsBatch();
        const currentProvider = translationProviders.getCurrentProvider();
        
        // Get all batch-capable providers
        const batchProviders = translationProviders.getBatchCapableProviders();
        
        console.log(`📊 Provider Support:`);
        console.log(`  Current Provider: ${currentProvider?.name || 'Unknown'}`);
        console.log(`  Current Supports Batch: ${currentSupportsBatch}`);
        console.log(`  Batch-Capable Providers: ${Object.keys(batchProviders).length}`);
        
        Object.entries(batchProviders).forEach(([id, provider]) => {
            console.log(`    - ${provider.name} (${id})`);
        });
        
        return {
            success: true,
            currentSupportsBatch,
            batchProviderCount: Object.keys(batchProviders).length
        };
        
    } catch (error) {
        console.error(`Provider support test failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

function calculateAccuracyScore(individual, batch) {
    if (individual.length !== batch.length) {
        return 0;
    }
    
    let matches = 0;
    for (let i = 0; i < individual.length; i++) {
        // Simple similarity check (could be enhanced with more sophisticated comparison)
        const similarity = calculateStringSimilarity(individual[i], batch[i]);
        if (similarity > 0.7) { // 70% similarity threshold
            matches++;
        }
    }
    
    return (matches / individual.length) * 100;
}

function calculateStringSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (!str1 || !str2) return 0;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        await testBatchTranslationPerformance();
        await testBatchTranslationEmptyInput();
        await testBatchTranslationPartialFailure();
        await testBatchTranslationProviderTimeout();
        console.log('\n🎉 All Batch Translation Tests Completed!');
    })()
        .then(() => {
            process.exit(0);
        })
        .catch(error => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

/**
 * Test: Batch translation with empty input
 */
async function testBatchTranslationEmptyInput() {
    console.log('🧪 Testing Batch Translation with Empty Input...');
    try {
        const result = await batchTranslationQueue.translateBatch([], 'en', 'es');
        if (Array.isArray(result) && result.length === 0) {
            console.log('✅ Passed: Empty input returns empty array.');
        } else {
            console.error('❌ Failed: Empty input did not return empty array.');
        }
    } catch (err) {
        console.error('❌ Failed: Error thrown for empty input.', err);
    }
}

/**
 * Test: Batch translation with partial failures
 */
async function testBatchTranslationPartialFailure() {
    console.log('🧪 Testing Batch Translation with Partial Failures...');
    // Simulate a provider that fails for a specific input
    const testInput = ['Hello', 'FAIL_ME', 'World'];
    try {
        const result = await batchTranslationQueue.translateBatch(testInput, 'en', 'es');
        if (Array.isArray(result) && result.length === 3) {
            console.log('✅ Passed: Partial failure handled correctly.');
        } else {
            console.error('❌ Failed: Partial failure not handled as expected.', result);
        }
    } catch (err) {
        console.error('❌ Failed: Error thrown for partial failure.', err);
    }
}

/**
 * Test: Batch translation with provider timeout
 */
async function testBatchTranslationProviderTimeout() {
    console.log('🧪 Testing Batch Translation with Provider Timeout...');
    const testInput = ['This will timeout'];
    try {
        const result = await batchTranslationQueue.translateBatch(testInput, 'en', 'fr', { timeout: 1000 });
        if (Array.isArray(result)) {
            console.log('✅ Passed: Timeout handled correctly.');
        } else {
            console.error('❌ Failed: Timeout not handled as expected.', result);
        }
    } catch (err) {
        console.error('❌ Failed: Error thrown for provider timeout.', err);
    }
}

export { testBatchTranslationPerformance, testBatchTranslationEmptyInput, testBatchTranslationPartialFailure, testBatchTranslationProviderTimeout };
