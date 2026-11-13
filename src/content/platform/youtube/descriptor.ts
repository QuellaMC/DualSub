import {
    extractYouTubeVideoIdFromUrl,
    normalizeYouTubeVideoId,
} from '@/shared/routeIdentity';
import type { PlatformDescriptor } from '../types';
import { YouTubeAdapter } from './adapter';
import { YOUTUBE_LOOK } from './appearance';

export const youtubeDescriptor: PlatformDescriptor = {
    id: 'youtube',
    capabilities: {
        directMediaControl: true,
        // The next video plays in the same player and <video>; the route,
        // not the element, separates sessions.
        videoReplacedAcrossEpisodes: false,
    },
    parseVideoIdFromUrl: extractYouTubeVideoIdFromUrl,
    classifyBridgeEvent(event) {
        if (event.t === 'spoken-language') {
            const videoId = normalizeYouTubeVideoId(event.videoId);
            return videoId
                ? { kind: 'spoken-language', videoId, language: event.language }
                : null;
        }
        if (event.t !== 'subtitle-data') {
            return null;
        }
        const videoId = normalizeYouTubeVideoId(event.videoId);
        return videoId ? { kind: 'subtitle', videoId } : null;
    },
    look: YOUTUBE_LOOK,
    // YouTube reports no appearance settings.
    parsePlatformLook: () => null,
    createAdapter(context) {
        return new YouTubeAdapter(context);
    },
};
