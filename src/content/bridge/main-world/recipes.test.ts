// @vitest-environment happy-dom
import { setUrl } from '@/test-utils/dom';
import { describe, expect, it, vi } from 'vitest';
import type { CapturedEvent } from '../protocol';
import { netflixRecipe } from './netflix-recipe';
import { disneyRecipe } from './disney-recipe';

function collect(
    recipe: {
        onParsed: (p: unknown, emit: (e: CapturedEvent) => void) => void;
    },
    parsed: unknown
) {
    const emitted: CapturedEvent[] = [];
    recipe.onParsed(parsed, (event) => emitted.push(event));
    return emitted;
}

describe('netflixRecipe', () => {
    it('captures timed-text manifests with a numeric or string movieId', () => {
        expect(
            collect(netflixRecipe, {
                result: {
                    movieId: 81234567,
                    timedtexttracks: [{ language: 'en' }],
                },
            })
        ).toEqual([
            {
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '81234567',
                tracks: [{ language: 'en' }],
            },
        ]);
        expect(
            collect(netflixRecipe, {
                result: { movieId: '7', timedtexttracks: [] },
            })
        ).toHaveLength(1);
    });

    it('ignores unrelated JSON', () => {
        expect(collect(netflixRecipe, { result: { movieId: 1 } })).toEqual([]);
        expect(collect(netflixRecipe, { timedtexttracks: [] })).toEqual([]);
        expect(collect(netflixRecipe, 'string')).toEqual([]);
        expect(collect(netflixRecipe, null)).toEqual([]);
    });
});

describe('disneyRecipe', () => {
    it('captures the master playlist URL keyed by the route video id', () => {
        setUrl('https://www.disneyplus.com/play/abc-123');
        const payload = {
            stream: {
                sources: [
                    {
                        complete: {
                            url: 'https://cdn.media.dssott.com/m.m3u8',
                        },
                    },
                ],
            },
        };
        expect(collect(disneyRecipe, payload)).toEqual([
            {
                t: 'subtitle-url',
                platform: 'disneyplus',
                url: 'https://cdn.media.dssott.com/m.m3u8',
                videoId: 'abc-123',
            },
        ]);
        expect(collect(disneyRecipe, { data: payload })).toHaveLength(1);
    });

    it('drops payloads outside a player route', () => {
        setUrl('https://www.disneyplus.com/home');
        const emit = vi.fn();
        disneyRecipe.onParsed(
            {
                stream: {
                    sources: [{ complete: { url: 'https://x/m.m3u8' } }],
                },
            },
            emit
        );
        expect(emit).not.toHaveBeenCalled();
    });
});
