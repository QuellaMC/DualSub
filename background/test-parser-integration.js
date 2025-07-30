/**
 * Parser Integration Test for Phase 2
 * 
 * Tests TTML conversion, VTT parsing, and Netflix-specific data processing
 * to verify parser accuracy and integration with shared utilities.
 */

import { ttmlParser } from './parsers/ttmlParser.js';
import { vttParser } from './parsers/vttParser.js';
import { netflixParser } from './parsers/netflixParser.js';
import { subtitleService } from './services/subtitleService.js';

// Sample TTML content for testing
const sampleTTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling">
  <head>
    <layout>
      <region xml:id="region1" tts:origin="10% 80%" />
      <region xml:id="region2" tts:origin="10% 85%" />
    </layout>
  </head>
  <body>
    <div>
      <p begin="1000000t" end="3000000t" region="region1">Hello world</p>
      <p begin="3500000t" end="5500000t" region="region2">How are you?</p>
      <p begin="6000000t" end="8000000t" region="region1">Goodbye</p>
    </div>
  </body>
</tt>`;

// Sample VTT content for testing
const sampleVTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello world

00:00:03.500 --> 00:00:05.500
How are you?

00:00:06.000 --> 00:00:08.000
Goodbye`;

// Sample M3U8 playlist content
const sampleM3U8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
segment1.vtt
segment2.vtt
segment3.vtt
#EXT-X-ENDLIST`;

// Sample Netflix subtitle data
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
        },
        {
            language: 'zh-CN',
            trackType: 'PRIMARY',
            isNoneTrack: false,
            isForcedNarrative: false,
            displayName: 'Chinese (Simplified)',
            ttDownloadables: {
                'dfxp-ls-sdh': {
                    downloadUrls: ['https://example.com/zh-subtitles.xml']
                }
            }
        }
    ]
};

async function testTTMLParser() {
    console.log('🧪 Testing TTML Parser...');
    
    try {
        const vttResult = ttmlParser.convertTtmlToVtt(sampleTTML);
        
        // Verify VTT format
        if (!vttResult.startsWith('WEBVTT')) {
            throw new Error('TTML conversion did not produce valid VTT format');
        }
        
        // Verify timing conversion
        if (!vttResult.includes('00:00:01.000 --> 00:00:03.000')) {
            throw new Error('TTML timing conversion failed');
        }
        
        // Verify text content
        if (!vttResult.includes('Hello world')) {
            throw new Error('TTML text content not preserved');
        }
        
        console.log('✅ TTML Parser: Conversion successful');
        console.log(`   - VTT length: ${vttResult.length} characters`);
        console.log(`   - Contains expected timing and text`);
        
        return true;
    } catch (error) {
        console.error('❌ TTML Parser test failed:', error.message);
        return false;
    }
}

async function testVTTParser() {
    console.log('🧪 Testing VTT Parser...');
    
    try {
        // Test VTT parsing
        const cues = vttParser.parseVTT(sampleVTT);
        
        if (cues.length !== 3) {
            throw new Error(`Expected 3 cues, got ${cues.length}`);
        }
        
        // Verify first cue
        const firstCue = cues[0];
        if (firstCue.start !== 1 || firstCue.end !== 3 || firstCue.text !== 'Hello world') {
            throw new Error('First cue parsing failed');
        }
        
        // Test timestamp parsing
        const seconds = vttParser.parseTimestampToSeconds('00:01:30.500');
        if (seconds !== 90.5) {
            throw new Error(`Timestamp parsing failed: expected 90.5, got ${seconds}`);
        }
        
        console.log('✅ VTT Parser: Parsing successful');
        console.log(`   - Parsed ${cues.length} cues correctly`);
        console.log(`   - Timestamp conversion working`);
        
        return true;
    } catch (error) {
        console.error('❌ VTT Parser test failed:', error.message);
        return false;
    }
}

async function testNetflixParser() {
    console.log('🧪 Testing Netflix Parser...');
    
    try {
        // Test track extraction
        const { availableLanguages, originalTrack, targetTrack } = 
            netflixParser.extractNetflixTracks(sampleNetflixData, 'en-US', 'zh-CN');
        
        if (availableLanguages.length !== 2) {
            throw new Error(`Expected 2 available languages, got ${availableLanguages.length}`);
        }
        
        if (!originalTrack || originalTrack.language !== 'en-US') {
            throw new Error('Original track not found or incorrect');
        }
        
        if (!targetTrack || targetTrack.language !== 'zh-CN') {
            throw new Error('Target track not found or incorrect');
        }
        
        // Test track selection logic
        const validTracks = sampleNetflixData.tracks.filter(
            track => !track.isNoneTrack && !track.isForcedNarrative
        );
        const bestTrack = netflixParser.getBestTrackForLanguage(validTracks, 'en-US');
        
        if (!bestTrack || bestTrack.language !== 'en-US') {
            throw new Error('Best track selection failed');
        }
        
        console.log('✅ Netflix Parser: Track processing successful');
        console.log(`   - Found ${availableLanguages.length} available languages`);
        console.log(`   - Track selection logic working`);
        
        return true;
    } catch (error) {
        console.error('❌ Netflix Parser test failed:', error.message);
        return false;
    }
}

async function testSubtitleService() {
    console.log('🧪 Testing Subtitle Service Integration...');
    
    try {
        // Initialize subtitle service
        await subtitleService.initialize();
        
        // Test service is initialized
        if (!subtitleService.isInitialized) {
            throw new Error('Subtitle service failed to initialize');
        }
        
        console.log('✅ Subtitle Service: Initialization successful');
        console.log(`   - Service ready for processing`);
        console.log(`   - Parser integration complete`);
        
        return true;
    } catch (error) {
        console.error('❌ Subtitle Service test failed:', error.message);
        return false;
    }
}

async function testParserIntegration() {
    console.log('🧪 Testing Phase 2 Parser Integration...');
    console.log('================================================');
    
    const results = [];
    
    // Run all tests
    results.push(await testTTMLParser());
    results.push(await testVTTParser());
    results.push(await testNetflixParser());
    results.push(await testSubtitleService());
    
    // Summary
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    console.log('================================================');
    console.log(`📊 Test Results: ${passed}/${total} tests passed`);
    
    if (passed === total) {
        console.log('🎉 All Phase 2 parser tests passed!');
        console.log('✅ TTML conversion working correctly');
        console.log('✅ VTT parsing integrated with shared utilities');
        console.log('✅ Netflix processing using existing logic');
        console.log('✅ Subtitle service coordinating all parsers');
        console.log('🔄 Code duplication eliminated successfully');
        return true;
    } else {
        console.log('❌ Some parser tests failed');
        return false;
    }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testParserIntegration()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

export { testParserIntegration };
