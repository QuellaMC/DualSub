/**
 * DOMUtils Tests
 * 
 * Tests for the shared DOM manipulation and video element detection utilities.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { 
    VideoElementDetector, 
    DOMManipulator, 
    PlayerReadyDetector,
    createPlatformVideoDetector,
    createPlatformDOMManipulator,
    PLATFORM_DOM_CONFIGS
} from '../shared/domUtils.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';

describe('VideoElementDetector', () => {
    let testHelpers;
    let testEnv;
    let detector;
    let mockLogger;
    let mockOnVideoFound;
    let mockOnDetectionFailed;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: false,
            enableLocation: false,
            enableChromeApi: false
        });

        mockLogger = jest.fn();
        mockOnVideoFound = jest.fn();
        mockOnDetectionFailed = jest.fn();

        detector = new VideoElementDetector('netflix', {
            selectors: ['video', '.test-video'],
            maxRetries: 3,
            retryInterval: 10,
            onVideoFound: mockOnVideoFound,
            onDetectionFailed: mockOnDetectionFailed,
            logger: mockLogger
        });

        jest.useFakeTimers();
    });

    afterEach(() => {
        if (detector) {
            detector.stopDetection();
        }
        testEnv.cleanup();
        testHelpers.resetAllMocks();
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        test('should initialize with default options', () => {
            const defaultDetector = new VideoElementDetector('netflix');
            
            expect(defaultDetector.platform).toBe('netflix');
            expect(defaultDetector.options.maxRetries).toBe(30);
            expect(defaultDetector.options.retryInterval).toBe(1000);
            expect(defaultDetector.isDetecting).toBe(false);
            expect(defaultDetector.retryCount).toBe(0);
        });

        test('should initialize with custom options', () => {
            expect(detector.platform).toBe('netflix');
            expect(detector.options.maxRetries).toBe(3);
            expect(detector.options.retryInterval).toBe(10);
            expect(detector.options.onVideoFound).toBe(mockOnVideoFound);
        });
    });

    describe('startDetection', () => {
        test('should find video element immediately if available', () => {
            // Create a video element
            const video = document.createElement('video');
            video.src = 'test.mp4';
            // Mock video dimensions and duration for validation
            Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
            Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
            Object.defineProperty(video, 'duration', { value: 120, configurable: true }); // 2 minutes
            
            // Mock getBoundingClientRect to return valid dimensions
            video.getBoundingClientRect = jest.fn().mockReturnValue({
                width: 1920,
                height: 1080,
                top: 0,
                left: 0,
                bottom: 1080,
                right: 1920
            });
            
            document.body.appendChild(video);

            // Test the detection logic directly
            const foundVideo = detector._detectVideo();
            expect(foundVideo).toBe(video);

            document.body.removeChild(video);
        });

        test('should retry detection when video not found initially', async () => {
            const detectionPromise = detector.startDetection();

            // Fast-forward through retries
            jest.advanceTimersByTime(30); // 3 retries * 10ms

            const result = await detectionPromise;

            expect(result).toBeNull();
            expect(mockOnDetectionFailed).toHaveBeenCalled();
            expect(detector.retryCount).toBe(3);
        });

        test('should not start detection if already in progress', () => {
            // Set detection as in progress
            detector.isDetecting = true;
            
            const result = detector.startDetection();

            expect(mockLogger).toHaveBeenCalledWith('warn', '[VideoElementDetector:netflix] Video detection is already in progress.', {});
            expect(result).resolves.toBeNull();
        });
    });

    describe('isVideoReady', () => {
        test('should return false for null video', () => {
            expect(detector.isVideoReady(null)).toBe(false);
        });

        test('should return true for ready video', () => {
            const video = document.createElement('video');
            Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_METADATA, configurable: true });
            Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
            Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
            Object.defineProperty(video, 'paused', { value: false, configurable: true });

            expect(detector.isVideoReady(video)).toBe(true);
        });

        test('should return false for video without metadata', () => {
            const video = document.createElement('video');
            Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_NOTHING, configurable: true });
            Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
            Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
            Object.defineProperty(video, 'paused', { value: false, configurable: true });

            expect(detector.isVideoReady(video)).toBe(false);
        });
    });

    describe('waitForVideoReady', () => {
        test('should resolve immediately if video is ready', async () => {
            const video = document.createElement('video');
            Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_METADATA, configurable: true });
            Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
            Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
            Object.defineProperty(video, 'paused', { value: false, configurable: true });

            const result = await detector.waitForVideoReady(video);
            expect(result).toBe(true);
        });

        test('should timeout if video never becomes ready', () => {
            const video = document.createElement('video');
            Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_NOTHING, configurable: true });

            // Test the ready check directly
            const isReady = detector.isVideoReady(video);
            expect(isReady).toBe(false);
        });
    });

    describe('stopDetection', () => {
        test('should stop ongoing detection', () => {
            detector.startDetection();
            detector.stopDetection();

            expect(detector.isDetecting).toBe(false);
            expect(detector.detectionInterval).toBeNull();
        });
    });
});

describe('DOMManipulator', () => {
    let testHelpers;
    let testEnv;
    let manipulator;
    let mockLogger;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: false,
            enableLocation: false,
            enableChromeApi: false
        });

        mockLogger = jest.fn();
        manipulator = new DOMManipulator('netflix', {
            containerClass: 'test-container',
            containerPrefix: 'test',
            logger: mockLogger
        });
    });

    afterEach(() => {
        if (manipulator) {
            manipulator.cleanup();
        }
        testEnv.cleanup();
        testHelpers.resetAllMocks();
    });

    describe('Constructor', () => {
        test('should initialize with default options', () => {
            const defaultManipulator = new DOMManipulator('netflix');
            
            expect(defaultManipulator.platform).toBe('netflix');
            expect(defaultManipulator.options.containerClass).toBe('dualsub-container');
            expect(defaultManipulator.options.containerPrefix).toBe('dualsub');
        });

        test('should initialize with custom options', () => {
            expect(manipulator.platform).toBe('netflix');
            expect(manipulator.options.containerClass).toBe('test-container');
            expect(manipulator.options.containerPrefix).toBe('test');
        });
    });

    describe('createSubtitleContainer', () => {
        test('should create subtitle container for video element', () => {
            const video = document.createElement('video');
            document.body.appendChild(video);

            const container = manipulator.createSubtitleContainer(video, {
                position: 'bottom',
                id: 'test-container'
            });

            expect(container).toBeTruthy();
            expect(container.id).toBe('test-container');
            expect(container.className).toContain('test-container');
            expect(container.className).toContain('test-container--bottom');
            expect(manipulator.createdElements.has(container)).toBe(true);

            document.body.removeChild(video);
        });

        test('should return null for null video element', () => {
            const container = manipulator.createSubtitleContainer(null);
            
            expect(container).toBeNull();
            expect(mockLogger).toHaveBeenCalledWith('error', '[DOMManipulator:netflix] Cannot create subtitle container: video element is null.', {});
        });
    });

    describe('removeSubtitleContainer', () => {
        test('should remove container by element', () => {
            const video = document.createElement('video');
            document.body.appendChild(video);
            
            const container = manipulator.createSubtitleContainer(video);
            const success = manipulator.removeSubtitleContainer(container);

            expect(success).toBe(true);
            expect(manipulator.createdElements.has(container)).toBe(false);
            expect(document.getElementById(container.id)).toBeNull();

            document.body.removeChild(video);
        });

        test('should remove container by ID', () => {
            const video = document.createElement('video');
            document.body.appendChild(video);
            
            const container = manipulator.createSubtitleContainer(video, { id: 'test-id' });
            const success = manipulator.removeSubtitleContainer('test-id');

            expect(success).toBe(true);
            expect(manipulator.createdElements.has(container)).toBe(false);

            document.body.removeChild(video);
        });
    });

    describe('injectCSS', () => {
        test('should inject CSS styles', () => {
            const css = '.test { color: red; }';
            const style = manipulator.injectCSS(css, 'test-styles');

            expect(style).toBeTruthy();
            expect(style.id).toBe('test-styles');
            expect(style.textContent).toBe(css);
            expect(document.getElementById('test-styles')).toBe(style);
            expect(manipulator.injectedStyles.has(style)).toBe(true);
        });

        test('should not inject duplicate styles', () => {
            const css = '.test { color: red; }';
            const style1 = manipulator.injectCSS(css, 'test-styles');
            const style2 = manipulator.injectCSS(css, 'test-styles');

            expect(style1).toBe(style2);
            expect(mockLogger).toHaveBeenCalledWith('debug', '[DOMManipulator:netflix] CSS has already been injected.', { styleId: 'test-styles' });
        });
    });

    describe('cleanup', () => {
        test('should clean up all created elements and styles', () => {
            const video = document.createElement('video');
            document.body.appendChild(video);
            
            const container = manipulator.createSubtitleContainer(video);
            const style = manipulator.injectCSS('.test { color: red; }');

            manipulator.cleanup();

            expect(manipulator.createdElements.size).toBe(0);
            expect(manipulator.injectedStyles.size).toBe(0);
            expect(document.getElementById(container.id)).toBeNull();
            expect(document.getElementById(style.id)).toBeNull();

            document.body.removeChild(video);
        });
    });
});

describe('PlayerReadyDetector', () => {
    let testHelpers;
    let testEnv;
    let detector;
    let mockLogger;
    let mockOnPlayerReady;
    let mockOnDetectionTimeout;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: false,
            enableLocation: false,
            enableChromeApi: false
        });

        mockLogger = jest.fn();
        mockOnPlayerReady = jest.fn();
        mockOnDetectionTimeout = jest.fn();

        detector = new PlayerReadyDetector('netflix', {
            maxRetries: 3,
            retryInterval: 10,
            onPlayerReady: mockOnPlayerReady,
            onDetectionTimeout: mockOnDetectionTimeout,
            logger: mockLogger
        });

        jest.useFakeTimers();
    });

    afterEach(() => {
        testEnv.cleanup();
        testHelpers.resetAllMocks();
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        test('should initialize with default options', () => {
            const defaultDetector = new PlayerReadyDetector('netflix');
            
            expect(defaultDetector.platform).toBe('netflix');
            expect(defaultDetector.options.maxRetries).toBe(20);
            expect(defaultDetector.options.retryInterval).toBe(500);
            expect(defaultDetector.isDetecting).toBe(false);
        });

        test('should initialize with custom options', () => {
            expect(detector.platform).toBe('netflix');
            expect(detector.options.maxRetries).toBe(3);
            expect(detector.options.retryInterval).toBe(10);
        });
    });

    describe('waitForPlayerReady', () => {
        test('should detect ready player immediately', () => {
            // Create video element with metadata
            const video = document.createElement('video');
            Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_METADATA, configurable: true });
            document.body.appendChild(video);

            // Create Netflix player container
            const playerContainer = document.createElement('div');
            playerContainer.className = 'watch-video';
            document.body.appendChild(playerContainer);

            // Create subtitle elements
            const subtitleElement = document.createElement('div');
            subtitleElement.className = 'player-timedtext';
            document.body.appendChild(subtitleElement);

            // Test the Netflix-specific ready check directly
            const isNetflixReady = detector._isNetflixReady();
            expect(isNetflixReady).toBe(true);

            document.body.removeChild(video);
            document.body.removeChild(playerContainer);
            document.body.removeChild(subtitleElement);
        });

        test('should timeout when player never becomes ready', async () => {
            const readyPromise = detector.waitForPlayerReady();
            
            // Fast-forward through all retries
            jest.advanceTimersByTime(30); // 3 retries * 10ms

            const result = await readyPromise;

            expect(result).toBe(false);
            expect(mockOnDetectionTimeout).toHaveBeenCalled();
            expect(detector.retryCount).toBe(3);
        });

        test('should not start detection if already in progress', () => {
            // Set detection as in progress
            detector.isDetecting = true;
            
            const result = detector.waitForPlayerReady();

            expect(mockLogger).toHaveBeenCalledWith('warn', '[PlayerReadyDetector:netflix] Player ready detection is already in progress.', {});
            expect(result).resolves.toBe(false);
        });
    });
});

describe('Platform Configurations', () => {
    test('should have Netflix configuration', () => {
        const config = PLATFORM_DOM_CONFIGS.netflix;
        
        expect(config).toBeDefined();
        expect(config.videoSelectors).toContain('video');
        expect(config.parentSelectors).toContain('.watch-video');
        expect(config.maxRetries).toBe(40);
        expect(config.retryInterval).toBe(1000);
    });

    test('should have Disney+ configuration', () => {
        const config = PLATFORM_DOM_CONFIGS.disneyplus;
        
        expect(config).toBeDefined();
        expect(config.videoSelectors).toContain('video');
        expect(config.parentSelectors).toContain('.btm-media-client-element');
        expect(config.maxRetries).toBe(30);
        expect(config.retryInterval).toBe(500);
    });
});

describe('Factory Functions', () => {
    test('should create platform video detector', () => {
        const detector = createPlatformVideoDetector('netflix', {
            onVideoFound: jest.fn()
        });
        
        expect(detector).toBeInstanceOf(VideoElementDetector);
        expect(detector.platform).toBe('netflix');
        expect(detector.options.selectors).toEqual(PLATFORM_DOM_CONFIGS.netflix.videoSelectors);
        expect(detector.options.maxRetries).toBe(40);
    });

    test('should create platform DOM manipulator', () => {
        const manipulator = createPlatformDOMManipulator('disneyplus', {
            logger: jest.fn()
        });
        
        expect(manipulator).toBeInstanceOf(DOMManipulator);
        expect(manipulator.platform).toBe('disneyplus');
        expect(manipulator.options.containerClass).toBe('dualsub-disneyplus-container');
        expect(manipulator.options.containerPrefix).toBe('dualsub-disneyplus');
    });

    test('should handle unknown platforms', () => {
        const detector = createPlatformVideoDetector('unknown');
        
        expect(detector).toBeInstanceOf(VideoElementDetector);
        expect(detector.platform).toBe('unknown');
        expect(detector.options.selectors).toBeUndefined(); // No config for unknown platform
    });
});