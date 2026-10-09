import {
    extractNetflixVideoIdFromUrl,
    normalizeNetflixVideoId,
} from '@/shared/routeIdentity';
import type { PlatformDescriptor } from '../types';
import { NetflixAdapter } from './adapter';
import { NETFLIX_LOOK, parseNetflixLook } from './appearance';

export const netflixDescriptor: PlatformDescriptor = {
    id: 'netflix',
    capabilities: {
        directMediaControl: true,
        videoReplacedAcrossEpisodes: true,
    },
    parseVideoIdFromUrl: extractNetflixVideoIdFromUrl,
    // Keyed by the event's own movieId: a resolution that lands after the
    // route moved on stays cached for the movie it belongs to.
    classifyBridgeEvent(event) {
        if (event.t === 'subtitle-appearance') {
            return { kind: 'appearance', appearance: event.appearance };
        }
        if (event.t !== 'subtitle-data') {
            return null;
        }
        const videoId = normalizeNetflixVideoId(event.movieId);
        return videoId ? { kind: 'subtitle', videoId } : null;
    },
    look: NETFLIX_LOOK,
    parsePlatformLook: parseNetflixLook,
    createAdapter(context, handoff) {
        return new NetflixAdapter(context, handoff);
    },
};
