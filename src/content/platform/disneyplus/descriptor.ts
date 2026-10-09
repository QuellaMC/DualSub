import {
    extractDisneyPlusVideoIdFromUrl,
    normalizeDisneyPlusVideoId,
} from '@/shared/routeIdentity';
import type { PlatformDescriptor } from '../types';
import { DisneyPlusAdapter } from './adapter';
import { DISNEY_LOOK, parseDisneyLook } from './appearance';

export const disneyPlusDescriptor: PlatformDescriptor = {
    id: 'disneyplus',
    capabilities: {
        directMediaControl: false,
        videoReplacedAcrossEpisodes: false,
    },
    parseVideoIdFromUrl: extractDisneyPlusVideoIdFromUrl,
    classifyBridgeEvent(event) {
        if (event.t === 'subtitle-url') {
            const videoId = normalizeDisneyPlusVideoId(event.videoId);
            return videoId ? { kind: 'subtitle', videoId } : null;
        }
        if (event.t === 'timeline-update') {
            return {
                kind: 'platform',
                videoId: normalizeDisneyPlusVideoId(event.videoId),
            };
        }
        if (event.t === 'subtitle-appearance') {
            return { kind: 'appearance', appearance: event.appearance };
        }
        return null;
    },
    look: DISNEY_LOOK,
    parsePlatformLook: parseDisneyLook,
    createAdapter(context, handoff) {
        return new DisneyPlusAdapter(context, handoff);
    },
};
