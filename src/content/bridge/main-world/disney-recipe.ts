import { extractDisneyPlusVideoIdFromPathname } from '@/shared/routeIdentity';
import type { InterceptorRecipe } from './interceptor-core';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readMasterPlaylistUrl(parsed: unknown): string | null {
    if (!isRecord(parsed)) {
        return null;
    }
    const container = isRecord(parsed.data) ? parsed.data : parsed;
    const stream = container.stream;
    if (!isRecord(stream) || !Array.isArray(stream.sources)) {
        return null;
    }
    const source: unknown = stream.sources[0];
    if (!isRecord(source) || !isRecord(source.complete)) {
        return null;
    }
    const url = source.complete.url;
    return typeof url === 'string' && url.length > 0 ? url : null;
}

/** Disney+ playback responses carry the HLS master URL under
 *  `stream.sources[0].complete.url`; the route path identifies the video. */
export const disneyRecipe: InterceptorRecipe = {
    platform: 'disneyplus',
    onParsed(parsed, emit) {
        const url = readMasterPlaylistUrl(parsed);
        if (!url) {
            return;
        }
        const videoId = extractDisneyPlusVideoIdFromPathname(location.pathname);
        if (!videoId) {
            return;
        }
        emit({ t: 'subtitle-url', platform: 'disneyplus', url, videoId });
    },
};
