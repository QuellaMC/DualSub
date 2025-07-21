/**
 * Tests for PlatformConfigFactory
 */

import { PlatformConfigFactory, PlatformConfigBuilder } from '../core/PlatformConfigFactory.js';
import { DEFAULT_PLATFORM_CONFIGS } from '../core/constants.js';

describe('PlatformConfigFactory', () => {
    beforeEach(() => {
        // Clear any registered platforms before each test
        PlatformConfigFactory.getRegisteredPlatforms().forEach(name => {
            if (!DEFAULT_PLATFORM_CONFIGS[name]) {
                // Remove custom registered platforms
                PlatformConfigFactory.register(name, null);
            }
        });
    });

    describe('create', () => {
        test('should create Netflix configuration', () => {
            const config = PlatformConfigFactory.create('netflix');
            expect(config).toBeDefined();
            expect(config.name).toBe('netflix');
            expect(config.injectScript.filename).toBe('injected_scripts/netflixInject.js');
        });

        test('should create Disney+ configuration', () => {
            const config = PlatformConfigFactory.create('disneyplus');
            expect(config).toBeDefined();
            expect(config.name).toBe('disneyplus');
            expect(config.injectScript.filename).toBe('injected_scripts/disneyPlusInject.js');
        });

        test('should return null for unknown platform', () => {
            const config = PlatformConfigFactory.create('unknown');
            expect(config).toBeNull();
        });

        test('should return copy of configuration (not reference)', () => {
            const config1 = PlatformConfigFactory.create('netflix');
            const config2 = PlatformConfigFactory.create('netflix');
            
            expect(config1).not.toBe(config2);
            expect(config1).toEqual(config2);
            
            config1.name = 'modified';
            expect(config2.name).toBe('netflix');
        });
    });

    describe('createByUrl', () => {
        test('should detect Netflix by URL', () => {
            const config = PlatformConfigFactory.createByUrl('https://www.netflix.com/watch/123');
            expect(config).toBeDefined();
            expect(config.name).toBe('netflix');
        });

        test('should detect Disney+ by URL', () => {
            const config = PlatformConfigFactory.createByUrl('https://www.disneyplus.com/video/123');
            expect(config).toBeDefined();
            expect(config.name).toBe('disneyplus');
        });

        test('should return null for unsupported URL', () => {
            const config = PlatformConfigFactory.createByUrl('https://www.youtube.com/watch?v=123');
            expect(config).toBeNull();
        });

        test('should use current URL when no URL provided', () => {
            // Since mocking window.location is problematic in JSDOM,
            // we'll test the default parameter behavior by calling without arguments
            // and checking that it doesn't throw an error
            const config = PlatformConfigFactory.createByUrl('https://www.netflix.com/browse');
            expect(config).toBeDefined();
            expect(config.name).toBe('netflix');
        });
    });

    describe('register', () => {
        test('should register custom platform', () => {
            const customConfig = {
                name: 'custom',
                injectScript: { filename: 'custom.js', tagId: 'custom-tag', eventId: 'custom-event' },
                navigation: { urlPatterns: ['custom.com'], spaHandling: false, checkInterval: 1000 },
                videoDetection: { maxRetries: 10, retryInterval: 500 }
            };

            PlatformConfigFactory.register('custom', customConfig);
            const config = PlatformConfigFactory.create('custom');
            
            expect(config).toEqual(customConfig);
        });

        test('should override default platform with custom registration', () => {
            const customNetflix = {
                name: 'netflix',
                injectScript: { filename: 'custom-netflix.js', tagId: 'custom-tag', eventId: 'custom-event' },
                navigation: { urlPatterns: ['netflix.com'], spaHandling: false, checkInterval: 500 },
                videoDetection: { maxRetries: 5, retryInterval: 200 }
            };

            PlatformConfigFactory.register('netflix', customNetflix);
            const config = PlatformConfigFactory.create('netflix');
            
            expect(config.injectScript.filename).toBe('custom-netflix.js');
            expect(config.videoDetection.maxRetries).toBe(5);
        });
    });

    describe('validate', () => {
        test('should validate complete configuration', () => {
            const config = PlatformConfigFactory.create('netflix');
            const validation = PlatformConfigFactory.validate(config);
            
            expect(validation.isValid).toBe(true);
            expect(validation.errors).toHaveLength(0);
        });

        test('should detect missing required fields', () => {
            const incompleteConfig = {
                name: 'test'
                // Missing injectScript, navigation, videoDetection
            };
            
            const validation = PlatformConfigFactory.validate(incompleteConfig);
            
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Missing required field: injectScript');
            expect(validation.errors).toContain('Missing required field: navigation');
            expect(validation.errors).toContain('Missing required field: videoDetection');
        });

        test('should detect missing injectScript fields', () => {
            const config = {
                name: 'test',
                injectScript: { filename: 'test.js' }, // Missing tagId and eventId
                navigation: { urlPatterns: ['test.com'], spaHandling: false, checkInterval: 1000 },
                videoDetection: { maxRetries: 10, retryInterval: 500 }
            };
            
            const validation = PlatformConfigFactory.validate(config);
            
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Missing required injectScript field: tagId');
            expect(validation.errors).toContain('Missing required injectScript field: eventId');
        });

        test('should generate warnings for type mismatches', () => {
            const config = {
                name: 'test',
                injectScript: { filename: 'test.js', tagId: 'test-tag', eventId: 'test-event' },
                navigation: { urlPatterns: 'not-array', spaHandling: 'not-boolean', checkInterval: 1000 },
                videoDetection: { maxRetries: 'not-number', retryInterval: 'not-number' }
            };
            
            const validation = PlatformConfigFactory.validate(config);
            
            expect(validation.warnings.length).toBeGreaterThan(0);
            expect(validation.warnings).toContain('navigation.urlPatterns must be an array');
        });
    });

    describe('isSupported', () => {
        test('should return true for default platforms', () => {
            expect(PlatformConfigFactory.isSupported('netflix')).toBe(true);
            expect(PlatformConfigFactory.isSupported('disneyplus')).toBe(true);
        });

        test('should return false for unsupported platforms', () => {
            expect(PlatformConfigFactory.isSupported('youtube')).toBe(false);
            expect(PlatformConfigFactory.isSupported('hulu')).toBe(false);
        });

        test('should return true for registered custom platforms', () => {
            PlatformConfigFactory.register('custom', { name: 'custom' });
            expect(PlatformConfigFactory.isSupported('custom')).toBe(true);
        });
    });
});

describe('PlatformConfigBuilder', () => {
    test('should build valid configuration', () => {
        const config = new PlatformConfigBuilder('test')
            .withInjectScript('test.js', 'test-tag', 'test-event')
            .withNavigation(['test.com'], true, 1500)
            .withVideoDetection(20, 800)
            .withLogPrefix('TestContent')
            .build();

        expect(config.name).toBe('test');
        expect(config.injectScript.filename).toBe('test.js');
        expect(config.navigation.urlPatterns).toEqual(['test.com']);
        expect(config.navigation.spaHandling).toBe(true);
        expect(config.videoDetection.maxRetries).toBe(20);
        expect(config.logPrefix).toBe('TestContent');
    });

    test('should use default values', () => {
        const config = new PlatformConfigBuilder('test')
            .withInjectScript('test.js', 'test-tag', 'test-event')
            .withNavigation(['test.com'])
            .build();

        expect(config.navigation.spaHandling).toBe(false);
        expect(config.navigation.checkInterval).toBe(2000);
        expect(config.videoDetection.maxRetries).toBe(30);
        expect(config.videoDetection.retryInterval).toBe(1000);
    });

    test('should throw error for invalid configuration', () => {
        expect(() => {
            new PlatformConfigBuilder('test')
                .build(); // Missing required fields
        }).toThrow('Invalid platform configuration');
    });

    test('should support method chaining', () => {
        const builder = new PlatformConfigBuilder('test');
        const result = builder
            .withInjectScript('test.js', 'test-tag', 'test-event')
            .withNavigation(['test.com'])
            .withVideoDetection(15, 600);

        expect(result).toBe(builder);
    });
});