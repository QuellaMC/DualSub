import {
    extractNetflixVideoIdFromUrl,
    normalizeNetflixVideoId,
} from '@/shared/routeIdentity';
import type { PlatformDescriptor } from '../types';
import { NetflixAdapter } from './adapter';

export const netflixDescriptor: PlatformDescriptor = {
    id: 'netflix',
    capabilities: {
        directMediaControl: true,
        videoReplacedAcrossEpisodes: true,
    },
    parseVideoIdFromUrl: extractNetflixVideoIdFromUrl,
    // Keyed by the event's own movieId: Netflix parses the next episode's
    // tracks while the current one plays, and the cache holds them until
    // the route becomes that movie.
    classifyBridgeEvent(event) {
        if (event.t !== 'subtitle-data') {
            return null;
        }
        const videoId = normalizeNetflixVideoId(event.movieId);
        return videoId ? { kind: 'subtitle', videoId } : null;
    },
    createAdapter(context, handoff) {
        return new NetflixAdapter(context, handoff);
    },
};
