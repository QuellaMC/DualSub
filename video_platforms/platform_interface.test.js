import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { VideoPlatform } from './platform_interface.js';
import { configService } from '../services/configService.js';

function createDeferred() {
    let resolve;
    const promise = new Promise((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

describe('VideoPlatform shared subtitle utilities', () => {
    let platform;

    beforeEach(() => {
        document.body.replaceChildren();
        platform = new VideoPlatform();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        document.body.replaceChildren();
    });

    test('restores every hidden subtitle container when telemetry throws', () => {
        const first = document.createElement('div');
        const second = document.createElement('span');
        for (const container of [first, second]) {
            container.style.display = 'none';
            container.style.visibility = 'hidden';
            container.style.opacity = '0';
            container.setAttribute('data-dualsub-hidden', 'true');
            document.body.appendChild(container);
        }
        platform.logger = {
            debug: jest.fn(() => {
                throw new Error('TELEMETRY_FAILURE_CANARY');
            }),
        };

        expect(() => platform.showOfficialSubtitleContainers()).not.toThrow();

        for (const container of [first, second]) {
            expect(container.style.display).toBe('');
            expect(container.style.visibility).toBe('');
            expect(container.style.opacity).toBe('');
            expect(container).not.toHaveAttribute('data-dualsub-hidden');
        }
    });

    test('fails closed when a platform has no route-adoption proof', () => {
        expect(
            platform.hasAdoptedPlayerRoute(
                'https://example.test/watch/replacement'
            )
        ).toBe(false);
    });

    test('allows the generic direct-media playback fallback by default', () => {
        expect(platform.allowsDirectMediaPlaybackFallback()).toBe(true);
    });

    test('logs only fixed aggregate telemetry after restoring hidden containers', () => {
        class PrivatePlatformClassCanary extends VideoPlatform {}

        const privacyPlatform = new PrivatePlatformClassCanary();
        const log = jest.fn();
        privacyPlatform.logger = { debug: log };
        const first = document.createElement('private-subtitle-tag-canary');
        first.className = 'PRIVATE_SUBTITLE_CLASS_CANARY';
        first.textContent = 'PRIVATE_PAGE_CONTENT_CANARY';
        const second = document.createElement('div');
        for (const container of [first, second]) {
            container.setAttribute('data-dualsub-hidden', 'true');
            document.body.appendChild(container);
        }

        privacyPlatform.showOfficialSubtitleContainers();

        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            'Restored official subtitle containers',
            {
                restoredContainerCount: 2,
                restoredAny: true,
            }
        );
        const serializedLogs = JSON.stringify(log.mock.calls);
        for (const canary of [
            'PrivatePlatformClassCanary',
            'PRIVATE-SUBTITLE-TAG-CANARY',
            'PRIVATE_SUBTITLE_CLASS_CANARY',
            'PRIVATE_PAGE_CONTENT_CANARY',
        ]) {
            expect(serializedLogs).not.toContain(canary);
        }
    });

    test('releases config listener ownership when cleanup telemetry throws', () => {
        const unsubscribe = jest.fn();
        platform.storageListener = jest.fn();
        platform.subtitleSelectors = ['.private-subtitle-selector'];
        platform.unsubscribeFromChanges = unsubscribe;
        platform.logger = {
            debug: jest.fn(() => {
                throw new Error('CLEANUP_LOGGER_CANARY');
            }),
        };

        expect(() =>
            platform.cleanupNativeSubtitleSettingsListener()
        ).not.toThrow();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(platform.storageListener).toBeNull();
        expect(platform.subtitleSelectors).toBeNull();
        expect(platform.unsubscribeFromChanges).toBeNull();
    });

    test('retires replacement subscriptions exactly once', () => {
        const unsubscribeA = jest.fn();
        const unsubscribeB = jest.fn();
        jest.spyOn(configService, 'get').mockResolvedValue(false);
        jest.spyOn(configService, 'onChanged')
            .mockReturnValueOnce(unsubscribeA)
            .mockReturnValueOnce(unsubscribeB);

        platform.setupNativeSubtitleSettingsListener(['.subtitle-a']);
        platform.setupNativeSubtitleSettingsListener(['.subtitle-b']);

        expect(unsubscribeA).toHaveBeenCalledTimes(1);
        expect(unsubscribeB).not.toHaveBeenCalled();

        platform.cleanupNativeSubtitleSettingsListener();
        platform.cleanupNativeSubtitleSettingsListener();

        expect(unsubscribeA).toHaveBeenCalledTimes(1);
        expect(unsubscribeB).toHaveBeenCalledTimes(1);
    });

    test('does not commit a deferred native setting after replacement', async () => {
        const deferredSetting = createDeferred();
        jest.spyOn(configService, 'get')
            .mockReturnValueOnce(deferredSetting.promise)
            .mockRejectedValueOnce(new Error('replacement read unavailable'));
        const hideSubtitles = jest.spyOn(
            platform,
            'hideOfficialSubtitleContainers'
        );
        const showSubtitles = jest.spyOn(
            platform,
            'showOfficialSubtitleContainers'
        );

        const pending = platform.handleNativeSubtitlesWithSetting([
            '.subtitle-a',
        ]);
        platform.setupNativeSubtitleSettingsListener(['.subtitle-b']);
        showSubtitles.mockClear();
        deferredSetting.resolve(true);
        await pending;

        expect(platform._hideOfficialSubtitles).toBeUndefined();
        expect(hideSubtitles).not.toHaveBeenCalled();
        expect(showSubtitles).not.toHaveBeenCalled();
    });

    test('terminal native cleanup restores every owned DOM effect', () => {
        const subtitle = document.createElement('div');
        subtitle.className = 'official-subtitle';
        document.body.appendChild(subtitle);
        platform.hideOfficialSubtitleContainers(['.official-subtitle']);

        platform.cleanupNativeSubtitleSettingsListener();

        expect(subtitle.style.display).toBe('');
        expect(subtitle.style.visibility).toBe('');
        expect(subtitle.style.opacity).toBe('');
        expect(subtitle).not.toHaveAttribute('data-dualsub-hidden');
    });

    test('a current replacement subscription reapplies the native setting', async () => {
        const subtitle = document.createElement('div');
        subtitle.className = 'official-subtitle';
        document.body.appendChild(subtitle);
        jest.spyOn(configService, 'get').mockResolvedValue(true);
        jest.spyOn(configService, 'onChanged').mockReturnValue(jest.fn());

        platform.setupNativeSubtitleSettingsListener(['.official-subtitle']);
        await Promise.resolve();
        await Promise.resolve();
        expect(subtitle).toHaveAttribute('data-dualsub-hidden', 'true');

        platform.setupNativeSubtitleSettingsListener(['.official-subtitle']);
        expect(subtitle).not.toHaveAttribute('data-dualsub-hidden');
        await Promise.resolve();
        await Promise.resolve();

        expect(subtitle.style.display).toBe('none');
        expect(subtitle.style.visibility).toBe('hidden');
        expect(subtitle.style.opacity).toBe('0');
        expect(subtitle).toHaveAttribute('data-dualsub-hidden', 'true');
    });
});
