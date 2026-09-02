import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/shared/logger';
import type { AdapterContext, SubtitleLanguages } from '../types';
import { NetflixAdapter, requestedSubtitleLanguages } from './adapter';

const LANGUAGES: SubtitleLanguages = {
    originalLanguage: 'en',
    targetLanguage: 'zh-CN',
    useOfficialTranslations: true,
};

function setup(languages: SubtitleLanguages = LANGUAGES) {
    const sendControl = vi.fn(() => true);
    const logger = createLogger('test');
    const context: AdapterContext = {
        signal: new AbortController().signal,
        videoId: '70283145',
        languages,
        bridge: { connected: true, sendControl },
        config: { get: vi.fn() },
        logger,
    };
    return { adapter: new NetflixAdapter(context, null), sendControl, logger };
}

describe('NetflixAdapter', () => {
    it('asks the page for the original and target languages when official translations are on', () => {
        const { adapter, sendControl } = setup();
        adapter.onBridgeConnected();
        expect(sendControl).toHaveBeenCalledWith({
            t: 'request-subtitle-tracks',
            videoId: '70283145',
            languages: ['en', 'zh-CN'],
        });
    });

    it('asks only for the original language when translation is API-only', () => {
        expect(
            requestedSubtitleLanguages({
                ...LANGUAGES,
                useOfficialTranslations: false,
            })
        ).toEqual(['en']);
    });

    it('turns a resolved track list into a fetch spec and warns on an empty one', () => {
        const { adapter, logger } = setup();
        const warn = vi
            .spyOn(logger, 'warn')
            .mockImplementation(() => undefined);
        const tracks = [{ language: 'en', url: 'https://x' }];
        expect(
            adapter.interpretSubtitleEvent({
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '70283145',
                languages: ['en', 'zh-CN'],
                tracks,
            })
        ).toEqual({ kind: 'netflix-tracks', tracks });
        expect(
            adapter.interpretSubtitleEvent({
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '70283145',
                languages: ['en', 'zh-CN'],
                tracks: [],
            })
        ).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('ignores a resolution answered for other languages', () => {
        const { adapter } = setup();
        expect(
            adapter.interpretSubtitleEvent({
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '70283145',
                languages: ['en', 'ja'],
                tracks: [{ language: 'en', url: 'https://x' }],
            })
        ).toBeNull();
        expect(
            adapter.interpretSubtitleEvent({
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '70283145',
                languages: ['en'],
                tracks: [{ language: 'en', url: 'https://x' }],
            })
        ).toBeNull();
    });

    it('cancels the page request before the session aborts', () => {
        const { adapter, sendControl } = setup();
        adapter.beforeAbort();
        expect(sendControl).toHaveBeenCalledWith({
            t: 'cancel-subtitle-tracks',
        });
    });
});
