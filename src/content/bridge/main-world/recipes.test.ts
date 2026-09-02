// @vitest-environment happy-dom
import { setUrl } from '@/test-utils/dom';
import { describe, expect, it, vi } from 'vitest';
import type { CapturedEvent } from '../protocol';
import type { InterceptorRecipe } from './interceptor-core';
import { netflixRecipe } from './netflix-recipe';
import { disneyRecipe } from './disney-recipe';

function collect(recipe: InterceptorRecipe, parsed: unknown) {
    const emitted: CapturedEvent[] = [];
    recipe.onParsed?.(parsed, (event) => emitted.push(event));
    return emitted;
}

describe('netflixRecipe', () => {
    it('inspects no JSON: tracks come from the player API on request', () => {
        expect('onParsed' in netflixRecipe).toBe(false);
        expect('onControl' in netflixRecipe).toBe(true);
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
        disneyRecipe.onParsed?.(
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
