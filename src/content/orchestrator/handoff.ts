import type { PlatformHandoff } from '../platform/types';

/**
 * Session memory only crosses a video change. A restart on the same video
 * (a settings change) must not inherit navigation rules — a demand for a
 * replaced <video> element or a clock identity marked stale — that would
 * make the successor refuse the very player it is still watching.
 */
export function carryHandoff(
    memory: PlatformHandoff,
    fromVideoId: string,
    toVideoId: string | null
): PlatformHandoff | null {
    return toVideoId === fromVideoId ? null : memory;
}
