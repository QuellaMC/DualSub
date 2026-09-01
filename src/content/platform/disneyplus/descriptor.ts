import {
    extractDisneyPlusVideoIdFromUrl,
    normalizeDisneyPlusVideoId,
} from '@/shared/routeIdentity';
import type { PlatformDescriptor } from '../types';
import { DisneyPlusAdapter } from './adapter';

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
        return null;
    },
    createAdapter(context, handoff) {
        return new DisneyPlusAdapter(context, handoff);
    },
};
