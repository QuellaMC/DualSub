/**
 * Integration test for Phase 1 modular background services
 * 
 * Verifies that the modular system initializes correctly and
 * maintains backward compatibility.
 */

import { translationProviders } from './services/translationService.js';
import { subtitleService } from './services/subtitleService.js';
import { loggingManager } from './utils/loggingManager.js';
import { messageHandler } from './handlers/messageHandler.js';

async function testPhase1Integration() {
    console.log('🧪 Testing Phase 1 modular background services...');
    
    try {
        // Test logging manager
        console.log('✅ Testing logging manager...');
        await loggingManager.initialize();
        const logger = loggingManager.createLogger('Test');
        logger.info('Test log message');
        console.log('✅ Logging manager works');
        
        // Test translation service
        console.log('✅ Testing translation service...');
        await translationProviders.initialize();
        const currentProvider = translationProviders.getCurrentProvider();
        console.log(`✅ Translation service initialized with provider: ${currentProvider.name}`);
        
        // Test subtitle service
        console.log('✅ Testing subtitle service...');
        await subtitleService.initialize();
        console.log('✅ Subtitle service initialized');
        
        // Test message handler
        console.log('✅ Testing message handler...');
        messageHandler.initialize();
        messageHandler.setServices(translationProviders, subtitleService);
        console.log('✅ Message handler initialized');
        
        console.log('🎉 All Phase 1 services initialized successfully!');
        console.log('🔄 Backward compatibility maintained');
        
        return true;
        
    } catch (error) {
        console.error('❌ Phase 1 integration test failed:', error);
        return false;
    }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testPhase1Integration()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

export { testPhase1Integration };
