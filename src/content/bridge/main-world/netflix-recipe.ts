import type { InterceptorRecipe } from './interceptor-core';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Netflix delivers timed-text track manifests through JSON responses that
 *  carry `result.timedtexttracks` alongside `result.movieId`. */
export const netflixRecipe: InterceptorRecipe = {
    platform: 'netflix',
    onParsed(parsed, emit) {
        if (!isRecord(parsed) || !isRecord(parsed.result)) {
            return;
        }
        const { timedtexttracks, movieId } = parsed.result;
        if (
            !Array.isArray(timedtexttracks) ||
            (typeof movieId !== 'string' && typeof movieId !== 'number')
        ) {
            return;
        }
        emit({
            t: 'subtitle-data',
            platform: 'netflix',
            movieId: String(movieId),
            tracks: timedtexttracks,
        });
    },
};
