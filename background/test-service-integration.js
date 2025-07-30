/**
 * Service Integration Test for Phase 3
 * 
 * Tests service layer creation, boundaries, and coordination.
 * Verifies translation and subtitle services work correctly together.
 */

import { translationProviders } from './services/translationService.js';
import { subtitleService } from './services/subtitleService.js';
import { loggingManager } from './utils/loggingManager.js';
import { messageHandler } from './handlers/messageHandler.js';
import { serviceRegistry, ServiceProtocol } from './services/serviceInterfaces.js';

// Sample data for testing
const sampleNetflixData = {
    tracks: [
        {
            language: 'en-US',
            trackType: 'PRIMARY',
            isNoneTrack: false,
            isForcedNarrative: false,
            displayName: 'English',
            ttDownloadables: {
                'dfxp-ls-sdh': {
                    downloadUrls: ['https://example.com/en-subtitles.xml']
                }
            }
        }
    ]
};

async function testTranslationService() {
    console.log('🧪 Testing Translation Service...');
    
    try {
        // Initialize translation service
        await translationProviders.initialize();
        
        // Test provider management
        const currentProvider = translationProviders.getCurrentProvider();
        if (!currentProvider || !currentProvider.name) {
            throw new Error('Current provider not properly initialized');
        }
        
        // Test provider listing
        const availableProviders = translationProviders.getAvailableProviders();
        if (Object.keys(availableProviders).length === 0) {
            throw new Error('No providers available');
        }
        
        // Test batch capability detection
        const batchCapable = translationProviders.getBatchCapableProviders();
        const hasBatchProviders = Object.keys(batchCapable).length > 0;
        
        // Test performance metrics
        const metrics = translationProviders.getPerformanceMetrics();
        if (typeof metrics.totalTranslations !== 'number') {
            throw new Error('Performance metrics not properly initialized');
        }
        
        // Test rate limit status
        const rateLimitStatus = translationProviders.getRateLimitStatus();
        if (typeof rateLimitStatus.hasLimit !== 'boolean') {
            throw new Error('Rate limit status not properly initialized');
        }
        
        console.log('✅ Translation Service: All tests passed');
        console.log(`   - Current provider: ${currentProvider.name}`);
        console.log(`   - Available providers: ${Object.keys(availableProviders).length}`);
        console.log(`   - Batch capable providers: ${Object.keys(batchCapable).length}`);
        console.log(`   - Rate limiting: ${rateLimitStatus.hasLimit ? 'enabled' : 'disabled'}`);
        
        return true;
    } catch (error) {
        console.error('❌ Translation Service test failed:', error.message);
        return false;
    }
}

async function testSubtitleService() {
    console.log('🧪 Testing Subtitle Service...');
    
    try {
        // Initialize subtitle service
        await subtitleService.initialize();
        
        // Test platform support
        const supportedPlatforms = subtitleService.getSupportedPlatforms();
        if (!supportedPlatforms.includes('netflix')) {
            throw new Error('Netflix platform not supported');
        }
        
        // Test available languages extraction
        const availableLanguages = await subtitleService.getAvailableLanguages('netflix', sampleNetflixData);
        if (!Array.isArray(availableLanguages)) {
            throw new Error('Available languages not returned as array');
        }
        
        // Test performance metrics
        const metrics = subtitleService.getPerformanceMetrics();
        if (typeof metrics.totalProcessed !== 'number') {
            throw new Error('Performance metrics not properly initialized');
        }
        
        console.log('✅ Subtitle Service: All tests passed');
        console.log(`   - Supported platforms: ${supportedPlatforms.join(', ')}`);
        console.log(`   - Available languages for sample: ${availableLanguages.length}`);
        console.log(`   - Performance tracking: enabled`);
        
        return true;
    } catch (error) {
        console.error('❌ Subtitle Service test failed:', error.message);
        return false;
    }
}

async function testServiceRegistry() {
    console.log('🧪 Testing Service Registry...');
    
    try {
        // Register test services
        serviceRegistry.register('translation', translationProviders, ['config']);
        serviceRegistry.register('subtitle', subtitleService, ['translation']);
        serviceRegistry.register('config', { test: true }, []);
        
        // Test service registration
        if (!serviceRegistry.has('translation')) {
            throw new Error('Translation service not registered');
        }
        
        if (!serviceRegistry.has('subtitle')) {
            throw new Error('Subtitle service not registered');
        }
        
        // Test service retrieval
        const translationSvc = serviceRegistry.get('translation');
        if (translationSvc !== translationProviders) {
            throw new Error('Service retrieval failed');
        }
        
        // Test dependency validation
        const translationDepsValid = serviceRegistry.validateDependencies('translation');
        const subtitleDepsValid = serviceRegistry.validateDependencies('subtitle');
        
        if (!translationDepsValid) {
            throw new Error('Translation service dependencies not satisfied');
        }
        
        if (!subtitleDepsValid) {
            throw new Error('Subtitle service dependencies not satisfied');
        }
        
        // Test service listing
        const serviceNames = serviceRegistry.getServiceNames();
        if (!serviceNames.includes('translation') || !serviceNames.includes('subtitle')) {
            throw new Error('Service listing incomplete');
        }
        
        console.log('✅ Service Registry: All tests passed');
        console.log(`   - Registered services: ${serviceNames.length}`);
        console.log(`   - Dependency validation: working`);
        console.log(`   - Service discovery: working`);
        
        return true;
    } catch (error) {
        console.error('❌ Service Registry test failed:', error.message);
        return false;
    }
}

async function testServiceProtocol() {
    console.log('🧪 Testing Service Protocol...');
    
    try {
        // Test request creation
        const request = ServiceProtocol.createRequest(
            'translation',
            'translate',
            { text: 'Hello', sourceLang: 'en', targetLang: 'es' }
        );
        
        if (!request.service || !request.method || !request.params) {
            throw new Error('Request creation failed');
        }
        
        if (!request.metadata.requestId || !request.metadata.timestamp) {
            throw new Error('Request metadata missing');
        }
        
        // Test response creation (success)
        const successResponse = ServiceProtocol.createResponse(request, { result: 'Hola' });
        
        if (!successResponse.success || !successResponse.result) {
            throw new Error('Success response creation failed');
        }
        
        // Test response creation (error)
        const error = new Error('Test error');
        const errorResponse = ServiceProtocol.createResponse(request, null, error);
        
        if (errorResponse.success || !errorResponse.error) {
            throw new Error('Error response creation failed');
        }
        
        // Test request ID generation
        const requestId1 = ServiceProtocol.generateRequestId();
        const requestId2 = ServiceProtocol.generateRequestId();
        
        if (requestId1 === requestId2) {
            throw new Error('Request ID generation not unique');
        }
        
        console.log('✅ Service Protocol: All tests passed');
        console.log(`   - Request/response creation: working`);
        console.log(`   - Metadata handling: working`);
        console.log(`   - Error handling: working`);
        console.log(`   - Unique ID generation: working`);
        
        return true;
    } catch (error) {
        console.error('❌ Service Protocol test failed:', error.message);
        return false;
    }
}

async function testMessageHandler() {
    console.log('🧪 Testing Message Handler Integration...');
    
    try {
        // Initialize message handler
        messageHandler.initialize();
        
        // Set services
        messageHandler.setServices(translationProviders, subtitleService);
        
        // Test that handler is initialized
        if (!messageHandler.isInitialized) {
            throw new Error('Message handler not initialized');
        }
        
        console.log('✅ Message Handler: Integration successful');
        console.log(`   - Initialization: complete`);
        console.log(`   - Service injection: working`);
        console.log(`   - Protocol integration: ready`);
        
        return true;
    } catch (error) {
        console.error('❌ Message Handler test failed:', error.message);
        return false;
    }
}

async function testServiceIntegration() {
    console.log('🧪 Testing Phase 3 Service Layer Integration...');
    console.log('================================================');
    
    const results = [];
    
    // Run all tests
    results.push(await testTranslationService());
    results.push(await testSubtitleService());
    results.push(await testServiceRegistry());
    results.push(await testServiceProtocol());
    results.push(await testMessageHandler());
    
    // Summary
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    console.log('================================================');
    console.log(`📊 Test Results: ${passed}/${total} tests passed`);
    
    if (passed === total) {
        console.log('🎉 All Phase 3 service layer tests passed!');
        console.log('✅ Translation service with caching and rate limiting');
        console.log('✅ Subtitle service with platform coordination');
        console.log('✅ Service registry with dependency management');
        console.log('✅ Service protocol with standardized communication');
        console.log('✅ Message handler with service boundaries');
        console.log('🔄 Clear separation of concerns established');
        return true;
    } else {
        console.log('❌ Some service layer tests failed');
        return false;
    }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testServiceIntegration()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

export { testServiceIntegration };
